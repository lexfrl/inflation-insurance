// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {InflationHedge} from "../src/InflationHedge.sol";
import {MockUSDT} from "../src/MockUSDT.sol";
import {Handler} from "./helpers/Handler.t.sol";

/// @notice Stateful invariant fuzzing over a random sequence of deposit /
///         buyPolicy / settle / claim / withdraw calls against a single
///         period. Two properties must survive every reachable call
///         sequence: the pool can never sell more liability than it can
///         back, and the contract can never pay out more USDT than it holds.
contract InflationHedgeInvariantTest is StdInvariant, Test {
    InflationHedge internal insurance;
    MockUSDT internal usdt;
    Handler internal handler;
    uint256 internal periodId;

    function setUp() public {
        usdt = new MockUSDT();
        insurance = new InflationHedge(IERC20(address(usdt)));

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

        InflationHedge.CreatePeriodParams memory p = InflationHedge.CreatePeriodParams({
            label: "invariant fixture",
            capBps: 800,
            saleEnd: block.timestamp + 1 days,
            periodEnd: block.timestamp + 2 days,
            claimWindowSecs: 3 days,
            loadBps: 12_000,
            cpiBucketsBps: buckets,
            probBps: probs
        });
        periodId = insurance.createPeriod(p);

        handler = new Handler(insurance, usdt, periodId);

        targetContract(address(handler));
    }

    /// The pool must never be able to sell more max liability than it holds
    /// in collateral + collected premiums -- this is the single check that
    /// makes the product solvent by construction.
    function invariant_solvency() public view {
        InflationHedge.Period memory period = insurance.getPeriod(periodId);
        assertLe(period.totalMaxLiability, period.totalCollateral + period.totalPremiums);
    }

    /// The contract must always hold enough USDT to cover what it has
    /// promised but not yet paid out: everything collected, minus what has
    /// already left via claims and LP withdrawals.
    function invariant_contractHoldsEnoughUsdt() public view {
        InflationHedge.Period memory period = insurance.getPeriod(periodId);
        uint256 owed = period.totalCollateral + period.totalPremiums - period.totalClaimed - handler.ghost_totalWithdrawn();
        assertGe(usdt.balanceOf(address(insurance)), owed);
    }

    /// The two invariants above hold vacuously if the fuzzed campaign never
    /// actually reaches "settled, buyer claims, LP withdraws" -- e.g. if the
    /// Handler's own state-dependent guards (deposits closing after the
    /// first sale, withdraw's time-warp only firing post-settlement) turned
    /// out to make that combination unreachable. A per-run afterInvariant()
    /// assertion is the wrong tool to check this: `setUp()` -- and so the
    /// Handler's ghost counters -- resets before every one of the 64
    /// independent runs, and each run is only `depth` (50) random calls, so
    /// most individual runs legitimately never complete the full
    /// deposit -> buy -> settle -> claim -> withdraw ordering by chance
    /// alone. That's sampling noise, not evidence of unreachability.
    ///
    /// This test proves reachability directly and deterministically instead:
    /// drive the exact same Handler through one hand-chosen happy-path
    /// sequence and assert every step actually succeeds. It doubles as a
    /// regression test for the settlement/claim-deadline fix and the
    /// LP-dilution guard, exercised through the same handler machinery the
    /// invariant campaign above uses.
    function test_Handler_HappyPathReachesFullLifecycle() public {
        handler.deposit(0, 1000e6); // actor 0 deposits, pre-underwriting
        handler.buyPolicy(0, 1000e6, 300); // actor 0 buys, opts underwriting
        handler.settle(500); // warps to periodEnd, posts CPI 5.00%
        handler.claim(0); // the one bought policy's owner claims
        handler.withdraw(0); // warps past claimDeadline, actor 0 withdraws

        assertEq(handler.ghost_successfulDeposits(), 1);
        assertEq(handler.ghost_successfulBuys(), 1);
        assertEq(handler.ghost_successfulSettles(), 1);
        assertEq(handler.ghost_successfulClaims(), 1);
        assertEq(handler.ghost_successfulWithdrawals(), 1);
    }
}
