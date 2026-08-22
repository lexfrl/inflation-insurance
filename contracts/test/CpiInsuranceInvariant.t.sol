// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CpiInsurance} from "../src/CpiInsurance.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Handler} from "./helpers/Handler.t.sol";

/// @notice Stateful invariant fuzzing over a random sequence of deposit /
///         buyPolicy / settle / claim / withdraw calls against a single
///         period. Two properties must survive every reachable call
///         sequence: the pool can never sell more liability than it can
///         back, and the contract can never pay out more USDC than it holds.
contract CpiInsuranceInvariantTest is StdInvariant, Test {
    CpiInsurance internal insurance;
    MockUSDC internal usdc;
    Handler internal handler;
    uint256 internal periodId;

    function setUp() public {
        usdc = new MockUSDC();
        insurance = new CpiInsurance(IERC20(address(usdc)));

        uint256[] memory buckets = new uint256[](4);
        buckets[0] = 200;
        buckets[1] = 400;
        buckets[2] = 600;
        buckets[3] = 800;
        uint256[] memory probs = new uint256[](4);
        probs[0] = 4000;
        probs[1] = 3000;
        probs[2] = 2000;
        probs[3] = 1000;

        CpiInsurance.CreatePeriodParams memory p = CpiInsurance.CreatePeriodParams({
            label: "invariant fixture",
            capBps: 800,
            saleEnd: block.timestamp + 1 days,
            periodEnd: block.timestamp + 2 days,
            claimDeadline: block.timestamp + 5 days,
            loadBps: 12_000,
            cpiBucketsBps: buckets,
            probBps: probs
        });
        periodId = insurance.createPeriod(p);

        handler = new Handler(insurance, usdc, periodId);

        targetContract(address(handler));
    }

    /// The pool must never be able to sell more max liability than it holds
    /// in collateral + collected premiums -- this is the single check that
    /// makes the product solvent by construction.
    function invariant_solvency() public view {
        CpiInsurance.Period memory period = insurance.getPeriod(periodId);
        assertLe(period.totalMaxLiability, period.totalCollateral + period.totalPremiums);
    }

    /// The contract must always hold enough USDC to cover what it has
    /// promised but not yet paid out: everything collected, minus what has
    /// already left via claims and LP withdrawals.
    function invariant_contractHoldsEnoughUsdc() public view {
        CpiInsurance.Period memory period = insurance.getPeriod(periodId);
        uint256 owed = period.totalCollateral + period.totalPremiums - period.totalClaimed - handler.ghost_totalWithdrawn();
        assertGe(usdc.balanceOf(address(insurance)), owed);
    }
}
