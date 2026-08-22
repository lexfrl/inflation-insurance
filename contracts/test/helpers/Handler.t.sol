// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CpiInsurance} from "../../src/CpiInsurance.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";

/// @notice Bounds a random call sequence (deposit / buyPolicy / settle / claim
///         / withdraw) against a single CpiInsurance period to valid-ish
///         inputs, for Foundry's stateful invariant fuzzer. Reverting calls
///         are swallowed (try/catch) rather than treated as a handler bug --
///         forge-std's invariant runner still surfaces a genuine contract
///         revert as a failure of whatever invariant it breaks.
contract Handler is Test {
    CpiInsurance public insurance;
    MockUSDC public usdc;
    uint256 public periodId;

    address[] internal actors;
    uint256[] internal boughtPolicyIds;

    uint256 public ghost_totalWithdrawn;
    bool public ghost_settled;

    constructor(CpiInsurance _insurance, MockUSDC _usdc, uint256 _periodId) {
        insurance = _insurance;
        usdc = _usdc;
        periodId = _periodId;

        for (uint256 i = 0; i < 4; i++) {
            address actor = address(uint160(uint256(keccak256(abi.encode("actor", i)))));
            actors.push(actor);
            usdc.mint(actor, 10_000_000e6);
            vm.prank(actor);
            usdc.approve(address(insurance), type(uint256).max);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function deposit(uint256 actorSeed, uint256 amountSeed) external {
        address who = _actor(actorSeed);
        uint256 amount = bound(amountSeed, 1e6, 1_000_000e6);

        vm.prank(who);
        try insurance.deposit(periodId, amount) {} catch {}
    }

    function buyPolicy(uint256 actorSeed, uint256 notionalSeed, uint256 strikeSeed) external {
        address who = _actor(actorSeed);
        uint256 notional = bound(notionalSeed, 1e6, 1_000_000e6);
        uint256 strikeBps = bound(strikeSeed, 0, 799); // period cap is fixed at 800

        vm.prank(who);
        try insurance.buyPolicy(periodId, notional, strikeBps) returns (uint256 policyId) {
            boughtPolicyIds.push(policyId);
        } catch {}
    }

    /// Settlement only fires once the period has actually ended, and only
    /// once -- mirrors the real admin flow, just triggered opportunistically
    /// by the fuzzer instead of on a real calendar.
    function settle(uint256 cpiSeed) external {
        CpiInsurance.Period memory period = insurance.getPeriod(periodId);
        if (block.timestamp < period.periodEnd) {
            vm.warp(period.periodEnd);
        }
        if (period.settled) return;

        uint256 cpiBps = bound(cpiSeed, 0, 12_000); // allow above-cap prints too
        try insurance.postSettlement(periodId, cpiBps) {
            ghost_settled = true;
        } catch {}
    }

    function claim(uint256 policyIdSeed) external {
        if (boughtPolicyIds.length == 0) return;
        uint256 policyId = boughtPolicyIds[policyIdSeed % boughtPolicyIds.length];
        CpiInsurance.Policy memory policy = insurance.getPolicy(policyId);

        vm.prank(policy.owner);
        try insurance.claim(policyId) {} catch {}
    }

    function withdraw(uint256 actorSeed) external {
        address who = _actor(actorSeed);
        CpiInsurance.Period memory period = insurance.getPeriod(periodId);
        // withdraw requires block.timestamp > claimDeadline (strictly), so
        // land one second past it, not exactly on it.
        if (block.timestamp <= period.claimDeadline) {
            vm.warp(period.claimDeadline + 1);
        }

        uint256 balBefore = usdc.balanceOf(who);
        vm.prank(who);
        try insurance.withdraw(periodId) {
            ghost_totalWithdrawn += usdc.balanceOf(who) - balBefore;
        } catch {}
    }
}
