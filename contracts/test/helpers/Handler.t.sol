// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InflationHedge} from "../../src/InflationHedge.sol";
import {MockUSDT} from "../../src/MockUSDT.sol";

/// @notice Bounds a random call sequence (deposit / buyPolicy / settle / claim
///         / withdraw) against a single InflationHedge period to valid-ish
///         inputs, for Foundry's stateful invariant fuzzer. Reverting calls
///         are swallowed (try/catch) rather than treated as a handler bug --
///         forge-std's invariant runner still surfaces a genuine contract
///         revert as a failure of whatever invariant it breaks.
contract Handler is Test {
    InflationHedge public insurance;
    MockUSDT public usdt;
    uint256 public periodId;
    address public owner;

    address[] internal actors;
    uint256[] internal boughtPolicyIds;

    uint256 public ghost_totalWithdrawn;
    bool public ghost_settled;
    // Counts of successful claim()/withdraw() calls, not just their USDT
    // amounts -- lets the invariant test's afterInvariant() hook assert the
    // fuzzed campaign actually reached "settled, buyer claims, LP withdraws"
    // at least once, rather than only checking properties that would also
    // hold vacuously if that state space were never explored.
    uint256 public ghost_successfulClaims;
    uint256 public ghost_successfulWithdrawals;
    uint256 public ghost_successfulDeposits;
    uint256 public ghost_successfulBuys;
    uint256 public ghost_successfulSettles;

    constructor(InflationHedge _insurance, MockUSDT _usdt, uint256 _periodId) {
        insurance = _insurance;
        usdt = _usdt;
        periodId = _periodId;
        owner = _insurance.owner();

        for (uint256 i = 0; i < 4; i++) {
            address actor = address(uint160(uint256(keccak256(abi.encode("actor", i)))));
            actors.push(actor);
            usdt.mint(actor, 10_000_000e6);
            vm.prank(actor);
            usdt.approve(address(insurance), type(uint256).max);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    /// Deposits close once underwriting has started (mirrors the contract's
    /// own "underwriting already started" guard). Without this early return,
    /// every post-first-sale deposit call in the fuzzed sequence would revert
    /// via the try/catch below and be silently swallowed -- `fail_on_revert
    /// = false` in foundry.toml means the invariant *suite* would stay green
    /// while quietly losing all deposit-path coverage past that point. This
    /// guard keeps the handler's call distribution matching what's actually
    /// reachable, so the fuzzer keeps exercising deposits (just only in the
    /// window they're still legal) instead of wasting runs on calls that
    /// only ever revert.
    function deposit(uint256 actorSeed, uint256 amountSeed) external {
        if (insurance.getPeriod(periodId).totalMaxLiability > 0) return;

        address who = _actor(actorSeed);
        uint256 amount = bound(amountSeed, 1e6, 1_000_000e6);

        vm.prank(who);
        try insurance.deposit(periodId, amount) {
            ghost_successfulDeposits++;
        } catch {}
    }

    function buyPolicy(uint256 actorSeed, uint256 notionalSeed, uint256 strikeSeed) external {
        address who = _actor(actorSeed);
        uint256 notional = bound(notionalSeed, 1e6, 1_000_000e6);
        uint256 strikeBps = bound(strikeSeed, 0, 799); // period cap is fixed at 800

        vm.prank(who);
        try insurance.buyPolicy(periodId, notional, strikeBps) returns (uint256 policyId) {
            boughtPolicyIds.push(policyId);
            ghost_successfulBuys++;
        } catch {}
    }

    /// Settlement only fires once the period has actually ended, and only
    /// once -- mirrors the real admin flow, just triggered opportunistically
    /// by the fuzzer instead of on a real calendar.
    function settle(uint256 cpiSeed) external {
        InflationHedge.Period memory period = insurance.getPeriod(periodId);
        if (block.timestamp < period.periodEnd) {
            vm.warp(period.periodEnd);
        }
        if (period.settled) return;

        uint256 cpiBps = bound(cpiSeed, 0, 12_000); // allow above-cap prints too
        // postSettlement is onlyOwner. Without this prank, the call is made
        // as the Handler contract itself (not the actual owner) and always
        // reverts with OwnableUnauthorizedAccount -- silently swallowed by
        // the catch below, exactly like any other invalid call. That made
        // settle() (and everything downstream of it: claim, withdraw)
        // permanently unreachable through this handler, which is invisible
        // in forge's per-selector revert counts since they only count the
        // *outer* handler call, never an inner reverted try.
        vm.prank(owner);
        try insurance.postSettlement(periodId, cpiBps) {
            ghost_settled = true;
            ghost_successfulSettles++;
        } catch {}
    }

    function claim(uint256 policyIdSeed) external {
        if (boughtPolicyIds.length == 0) return;
        uint256 policyId = boughtPolicyIds[policyIdSeed % boughtPolicyIds.length];
        InflationHedge.Policy memory policy = insurance.getPolicy(policyId);

        vm.prank(policy.owner);
        try insurance.claim(policyId) {
            ghost_successfulClaims++;
        } catch {}
    }

    function withdraw(uint256 actorSeed) external {
        address who = _actor(actorSeed);
        InflationHedge.Period memory period = insurance.getPeriod(periodId);
        // withdraw requires block.timestamp > claimDeadline (strictly), so
        // land one second past it, not exactly on it. Gated on `settled`,
        // not just comparing against claimDeadline directly: claimDeadline
        // reads 0 before settlement, and `block.timestamp <= 0` is always
        // false once the chain has advanced past genesis, so an unguarded
        // comparison would never warp pre-settlement -- collapsing the
        // fuzzer's reachable timeline to just what `settle` warps to
        // (exactly periodEnd), and starving this handler of the
        // "settled, still within claim window" and "past claim window"
        // states `claim`/`withdraw` are actually meant to race across.
        if (period.settled && block.timestamp <= period.claimDeadline) {
            vm.warp(period.claimDeadline + 1);
        }

        uint256 balBefore = usdt.balanceOf(who);
        vm.prank(who);
        try insurance.withdraw(periodId) {
            ghost_totalWithdrawn += usdt.balanceOf(who) - balBefore;
            ghost_successfulWithdrawals++;
        } catch {}
    }
}
