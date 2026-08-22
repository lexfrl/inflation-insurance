// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./helpers/TestBase.t.sol";
import {InflationHedge} from "../src/InflationHedge.sol";

contract InflationHedgeTest is TestBase {
    // ---------------------------------------------------------------------
    // Pricing: hand-computed against the founder's worked example
    // ---------------------------------------------------------------------

    /// strike=3%, cap=8%, notional=$1000 -> maxPayout=$50 (founder's example).
    /// Premium is hand-computed from the default histogram:
    ///   ev = 4000*0 + 3000*100 + 2000*300 + 1000*500 = 1,400,000
    ///   premium = notional * ev * loadBps / 1e12
    ///           = 1000e6 * 1,400,000 * 12,000 / 1e12 = 16,800,000 (16.8 USDT)
    function test_QuoteMatchesFounderExample() public {
        uint256 periodId = _createDefaultPeriod();

        (uint256 premium, uint256 maxPayout) = insurance.quote(periodId, 1000e6, STRIKE);

        assertEq(maxPayout, 50e6, "maxPayout should match founder's $50 example");
        assertEq(premium, 16_800_000, "premium should match hand-computed EV * load");
    }

    function test_Quote_RevertsWhenStrikeAboveOrEqualCap() public {
        uint256 periodId = _createDefaultPeriod();
        vm.expectRevert("strike >= cap");
        insurance.quote(periodId, 1000e6, CAP);
    }

    /// If all probability mass sits exactly at the cap, expected payout equals
    /// maxPayout exactly; any load factor >= 1x then makes premium >= maxPayout,
    /// which is a real "can't price this" case, not a hypothetical.
    function test_Quote_RevertsWhenUnpriceable() public {
        uint256[] memory buckets = new uint256[](1);
        buckets[0] = CAP;
        uint256[] memory probs = new uint256[](1);
        probs[0] = 10_000;

        InflationHedge.CreatePeriodParams memory p =
            _customParams(CAP, LOAD, buckets, probs, block.timestamp + 1 days, block.timestamp + 2 days, CLAIM_WINDOW);
        uint256 periodId = insurance.createPeriod(p);

        vm.expectRevert("unpriceable: premium >= maxPayout");
        insurance.quote(periodId, 1000e6, STRIKE);
    }

    // ---------------------------------------------------------------------
    // createPeriod validation
    // ---------------------------------------------------------------------

    function test_CreatePeriod_RevertsIfProbabilitiesDontSumToDenom() public {
        uint256[] memory buckets = new uint256[](2);
        buckets[0] = 300;
        buckets[1] = 600;
        uint256[] memory probs = new uint256[](2);
        probs[0] = 4000;
        probs[1] = 4000; // sums to 8000, not 10000

        InflationHedge.CreatePeriodParams memory p =
            _customParams(CAP, LOAD, buckets, probs, block.timestamp + 1 days, block.timestamp + 2 days, CLAIM_WINDOW);

        vm.expectRevert("probabilities must sum to 10000");
        insurance.createPeriod(p);
    }

    function test_CreatePeriod_RevertsIfLoadBelowOne() public {
        (uint256[] memory buckets, uint256[] memory probs) = _defaultHistogram();
        InflationHedge.CreatePeriodParams memory p =
            _customParams(CAP, 9_999, buckets, probs, block.timestamp + 1 days, block.timestamp + 2 days, CLAIM_WINDOW);

        vm.expectRevert("load must be >= 1x");
        insurance.createPeriod(p);
    }

    function test_CreatePeriod_RevertsIfClaimWindowIsZero() public {
        (uint256[] memory buckets, uint256[] memory probs) = _defaultHistogram();
        InflationHedge.CreatePeriodParams memory p =
            _customParams(CAP, LOAD, buckets, probs, block.timestamp + 1 days, block.timestamp + 2 days, 0);

        vm.expectRevert("claim window must be > 0");
        insurance.createPeriod(p);
    }

    // ---------------------------------------------------------------------
    // buyPolicy: timing and cap checks
    // ---------------------------------------------------------------------

    function test_BuyPolicy_RevertsAfterSaleEnd() public {
        uint256 periodId = _createDefaultPeriod();
        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(buyer1);
        vm.expectRevert("sale closed");
        insurance.buyPolicy(periodId, 1000e6, STRIKE);
    }

    function test_BuyPolicy_RevertsIfStrikeAboveCap() public {
        uint256 periodId = _createDefaultPeriod();

        vm.prank(buyer1);
        vm.expectRevert("strike >= cap");
        insurance.buyPolicy(periodId, 1000e6, CAP);
    }

    // ---------------------------------------------------------------------
    // buyPolicy: solvency invariant boundary
    // ---------------------------------------------------------------------

    /// LP backs the pool with exactly 10 USDT. Two purchases exactly consume
    /// all backing available *at the time each is bought*: policy1's
    /// maxPayout exactly equals the collateral; policy2's maxPayout exactly
    /// equals the remaining capacity policy1's own premium opened up. Both
    /// succeed at equality, proving `<=` is honored at the boundary.
    /// (A policy's *own* premium never backs itself -- see the revert test.)
    function test_BuyPolicy_SucceedsAtSolvencyBoundary() public {
        uint256 periodId = _createDefaultPeriod();

        vm.prank(lp1);
        insurance.deposit(periodId, 10e6);

        // maxPayout1 = 200e6 * 500 / 10000 = 10e6 == totalCollateral exactly.
        vm.prank(buyer1);
        insurance.buyPolicy(periodId, 200e6, STRIKE);

        // Remaining capacity after policy1 == policy1's own premium
        // (3,360,000). Size policy2's notional so its maxPayout exactly
        // matches that remaining capacity.
        (uint256 premium1Refetch,) = insurance.quote(periodId, 200e6, STRIKE); // same inputs -> same quote
        uint256 notional2 = (premium1Refetch * 10_000) / 500; // maxPayout2 == premium1Refetch exactly
        (uint256 premium2,) = insurance.quote(periodId, notional2, STRIKE);

        vm.prank(buyer2);
        insurance.buyPolicy(periodId, notional2, STRIKE);

        InflationHedge.Period memory period = insurance.getPeriod(periodId);
        uint256 remaining = period.totalCollateral + period.totalPremiums - period.totalMaxLiability;
        assertEq(remaining, premium2, "remaining capacity should equal policy2's own premium");
    }

    function test_BuyPolicy_RevertsIfInsufficientBacking() public {
        uint256 periodId = _createDefaultPeriod();

        vm.prank(lp1);
        insurance.deposit(periodId, 10e6);

        vm.prank(buyer1);
        insurance.buyPolicy(periodId, 200e6, STRIKE); // fills collateral exactly

        (uint256 premium1,) = insurance.quote(periodId, 200e6, STRIKE);
        uint256 notional2 = (premium1 * 10_000) / 500;
        vm.prank(buyer2);
        insurance.buyPolicy(periodId, notional2, STRIKE); // fills remaining capacity exactly

        InflationHedge.Period memory period = insurance.getPeriod(periodId);
        uint256 remaining = period.totalCollateral + period.totalPremiums - period.totalMaxLiability;

        // Any policy whose maxPayout is 1 more than remaining capacity must
        // revert -- size notional so maxPayout = remaining + 1 exactly
        // (notional is a multiple of 20 so 500/10000 division is exact).
        uint256 notional3 = (remaining + 1) * 20;

        vm.prank(buyer1);
        vm.expectRevert("insufficient pool backing");
        insurance.buyPolicy(periodId, notional3, STRIKE);
    }

    // ---------------------------------------------------------------------
    // deposit: LP dilution guard
    // ---------------------------------------------------------------------

    /// Before the fix, a late LP could deposit after buyers had already paid
    /// premiums into the pool, and immediately own a pro-rata cut of gains
    /// it never underwrote. Closing deposits once underwriting has started
    /// (totalMaxLiability > 0) removes that free-ride window entirely.
    function test_Deposit_RevertsAfterUnderwritingStarted() public {
        uint256 periodId = _createDefaultPeriod();

        vm.prank(lp1);
        insurance.deposit(periodId, 1000e6);

        vm.prank(buyer1);
        insurance.buyPolicy(periodId, 1000e6, STRIKE); // totalMaxLiability > 0 from here on

        vm.prank(lp2);
        vm.expectRevert("underwriting already started");
        insurance.deposit(periodId, 1000e6);
    }

    function test_Deposit_SucceedsBeforeUnderwritingStarted() public {
        uint256 periodId = _createDefaultPeriod();

        vm.prank(lp1);
        insurance.deposit(periodId, 500e6);
        vm.prank(lp2);
        insurance.deposit(periodId, 500e6); // still fine, no policy bought yet

        InflationHedge.Period memory period = insurance.getPeriod(periodId);
        assertEq(period.totalCollateral, 1000e6);
    }

    // ---------------------------------------------------------------------
    // postSettlement timing
    // ---------------------------------------------------------------------

    function test_PostSettlement_RevertsBeforePeriodEnd() public {
        uint256 periodId = _createDefaultPeriod();
        vm.expectRevert("period not ended");
        insurance.postSettlement(periodId, 500);
    }

    function test_PostSettlement_RevertsIfAlreadySettled() public {
        uint256 periodId = _createDefaultPeriod();
        vm.warp(block.timestamp + 2 days + 1);

        insurance.postSettlement(periodId, 500);

        vm.expectRevert("already settled");
        insurance.postSettlement(periodId, 600);
    }

    /// The core of the settlement/claim-deadline fix: claimDeadline is
    /// derived from *this call's* timestamp (settledAt + claimWindowSecs),
    /// not from an absolute deadline fixed back at period creation. Settling
    /// very late must not shrink or skip the claim window -- the buyer still
    /// gets a full claimWindowSecs to claim from whenever settlement actually
    /// posts.
    function test_PostSettlement_ClaimDeadlineIsDerivedFromSettlementTime() public {
        (uint256 periodId, uint256 policyId) = _buyDefaultPolicy();

        // Settle very late -- long after any *fixed* deadline set at
        // creation time would have already passed under the old design.
        vm.warp(block.timestamp + 2 days + 100 days);
        insurance.postSettlement(periodId, 500);

        InflationHedge.Period memory period = insurance.getPeriod(periodId);
        assertEq(period.claimDeadline, block.timestamp + CLAIM_WINDOW, "claim deadline must start at settlement");

        // Pin the exact inversion the old bug caused: right after this late
        // settlement, withdraw() must NOT be immediately callable (it used
        // to be, since the old fixed claimDeadline had already passed) --
        // and claim() must still succeed. Under the old design this
        // ordering was flipped: LPs could drain the pool here while the
        // buyer's claim was permanently unreachable.
        vm.prank(lp1);
        vm.expectRevert("claim window open");
        insurance.withdraw(periodId);

        vm.prank(buyer1);
        insurance.claim(policyId);
        assertTrue(insurance.getPolicy(policyId).claimed);
    }

    // ---------------------------------------------------------------------
    // claim
    // ---------------------------------------------------------------------

    function _buyDefaultPolicy() internal returns (uint256 periodId, uint256 policyId) {
        periodId = _createDefaultPeriod();
        vm.prank(lp1);
        insurance.deposit(periodId, 1000e6);
        vm.prank(buyer1);
        policyId = insurance.buyPolicy(periodId, 1000e6, STRIKE);
    }

    function test_Claim_RevertsIfNotSettled() public {
        (, uint256 policyId) = _buyDefaultPolicy();
        vm.prank(buyer1);
        vm.expectRevert("not settled");
        insurance.claim(policyId);
    }

    function test_Claim_RevertsIfAlreadyClaimed() public {
        (uint256 periodId, uint256 policyId) = _buyDefaultPolicy();
        vm.warp(block.timestamp + 2 days + 1);
        insurance.postSettlement(periodId, 500);

        vm.prank(buyer1);
        insurance.claim(policyId);

        vm.prank(buyer1);
        vm.expectRevert("already claimed");
        insurance.claim(policyId);
    }

    function test_Claim_RevertsAfterClaimDeadline() public {
        (uint256 periodId, uint256 policyId) = _buyDefaultPolicy();
        vm.warp(block.timestamp + 2 days + 1);
        insurance.postSettlement(periodId, 500);

        vm.warp(block.timestamp + CLAIM_WINDOW + 1); // past claimDeadline

        vm.prank(buyer1);
        vm.expectRevert("claim window closed");
        insurance.claim(policyId);
    }

    function test_Claim_PaysCorrectAmount() public {
        (uint256 periodId, uint256 policyId) = _buyDefaultPolicy();
        vm.warp(block.timestamp + 2 days + 1);
        insurance.postSettlement(periodId, 500); // CPI 5% -> excess = 200bps

        uint256 balBefore = usdt.balanceOf(buyer1);
        vm.prank(buyer1);
        insurance.claim(policyId);
        uint256 balAfter = usdt.balanceOf(buyer1);

        // payout = notional * excess / 10000 = 1000e6 * 200 / 10000 = 20e6
        assertEq(balAfter - balBefore, 20e6);
    }

    // ---------------------------------------------------------------------
    // withdraw: pro-rata split across uneven LPs after a partial claim
    // ---------------------------------------------------------------------

    function test_Withdraw_ProRataSplit() public {
        uint256 periodId = _createDefaultPeriod();

        vm.prank(lp1);
        insurance.deposit(periodId, 30e6);
        vm.prank(lp2);
        insurance.deposit(periodId, 70e6);

        vm.prank(buyer1);
        uint256 policyId = insurance.buyPolicy(periodId, 800e6, STRIKE);

        vm.warp(block.timestamp + 2 days + 1);
        insurance.postSettlement(periodId, 500); // CPI 5% -> excess 200bps -> payout 16e6

        vm.prank(buyer1);
        insurance.claim(policyId);

        vm.warp(block.timestamp + CLAIM_WINDOW + 1); // past claimDeadline

        uint256 lp1BalBefore = usdt.balanceOf(lp1);
        vm.prank(lp1);
        insurance.withdraw(periodId);
        uint256 lp1Amount = usdt.balanceOf(lp1) - lp1BalBefore;

        uint256 lp2BalBefore = usdt.balanceOf(lp2);
        vm.prank(lp2);
        insurance.withdraw(periodId);
        uint256 lp2Amount = usdt.balanceOf(lp2) - lp2BalBefore;

        // remaining = totalCollateral(100e6) + totalPremiums(13,440,000) - totalClaimed(16e6) = 97,440,000
        assertEq(lp1Amount, 29_232_000, "LP1 (30%) share of remaining pool");
        assertEq(lp2Amount, 68_208_000, "LP2 (70%) share of remaining pool");
        assertEq(lp1Amount + lp2Amount, 97_440_000, "no dust lost across LPs");
    }

    function test_Withdraw_RevertsIfNotSettled() public {
        uint256 periodId = _createDefaultPeriod();
        vm.prank(lp1);
        insurance.deposit(periodId, 100e6);

        vm.expectRevert("not settled");
        vm.prank(lp1);
        insurance.withdraw(periodId);
    }

    /// At t == claimDeadline exactly, `claim` is still callable (`<=`) but
    /// `withdraw` must not be (`>` only) -- otherwise an LP racing to
    /// withdraw in the same block could drain the pool out from under a
    /// buyer whose claim is still legitimately pending, making that claim
    /// revert on insufficient balance.
    function test_Withdraw_RevertsExactlyAtClaimDeadline_ClaimStillWorks() public {
        (uint256 periodId, uint256 policyId) = _buyDefaultPolicy();
        vm.warp(block.timestamp + 2 days + 1);
        insurance.postSettlement(periodId, 500);

        InflationHedge.Period memory period = insurance.getPeriod(periodId);
        vm.warp(period.claimDeadline); // exactly at the boundary

        vm.prank(lp1);
        vm.expectRevert("claim window open");
        insurance.withdraw(periodId);

        vm.prank(buyer1);
        insurance.claim(policyId); // must still succeed
    }

    function test_Withdraw_RevertsIfAlreadyWithdrawn() public {
        uint256 periodId = _createDefaultPeriod();
        vm.prank(lp1);
        insurance.deposit(periodId, 100e6);

        vm.warp(block.timestamp + 2 days + 1);
        insurance.postSettlement(periodId, 100);
        vm.warp(block.timestamp + CLAIM_WINDOW + 1);

        vm.prank(lp1);
        insurance.withdraw(periodId);

        vm.expectRevert("already withdrawn");
        vm.prank(lp1);
        insurance.withdraw(periodId);
    }
}
