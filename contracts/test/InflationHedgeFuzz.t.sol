// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./helpers/TestBase.t.sol";
import {InflationHedge} from "../src/InflationHedge.sol";

contract InflationHedgeFuzzTest is TestBase {
    /// Histogram with 1bp of mass at the cap and the rest at 0: keeps premium
    /// a tiny, predictable fraction of maxPayout across the whole strike/cap
    /// range, so quote() never hits its own "unpriceable" guard and we can
    /// fuzz maxPayout in isolation.
    function _lowPremiumHistogram() internal pure returns (uint256[] memory buckets, uint256[] memory probs) {
        buckets = new uint256[](2);
        buckets[0] = 0;
        buckets[1] = 10_000; // placeholder, overwritten per-call with capBps
        probs = new uint256[](2);
        probs[0] = 9_999;
        probs[1] = 1;
    }

    function _createLowPremiumPeriod(uint256 capBps) internal returns (uint256 periodId) {
        (uint256[] memory buckets, uint256[] memory probs) = _lowPremiumHistogram();
        buckets[1] = capBps;
        InflationHedge.CreatePeriodParams memory p =
            _customParams(capBps, LOAD, buckets, probs, block.timestamp + 1 days, block.timestamp + 2 days, CLAIM_WINDOW);
        periodId = insurance.createPeriod(p);
    }

    /// maxPayout = notional * (cap - strike) / 10000, and (cap - strike) <=
    /// 10000, so maxPayout can never exceed notional -- this must hold for
    /// every valid strike/cap/notional combination.
    function testFuzz_MaxPayoutNeverExceedsNotional(uint256 notionalSeed, uint256 strikeSeed, uint256 capSeed)
        public
    {
        uint256 capBps = bound(capSeed, 1, 10_000);
        uint256 strikeBps = bound(strikeSeed, 0, capBps - 1);
        uint256 notional = bound(notionalSeed, 1e6, 1e24);

        uint256 periodId = _createLowPremiumPeriod(capBps);

        (, uint256 maxPayout) = insurance.quote(periodId, notional, strikeBps);

        assertLe(maxPayout, notional, "maxPayout must never exceed notional");
    }

    /// Payout is non-decreasing in the settled CPI value: a bigger inflation
    /// shock can never pay out less than a smaller one, for the same policy.
    function testFuzz_PayoutMonotonicInCpi(uint256 cpiASeed, uint256 cpiBSeed) public {
        uint256 cpiA = bound(cpiASeed, 0, 10_000);
        uint256 cpiB = bound(cpiBSeed, cpiA, 10_000); // guarantee cpiA <= cpiB

        uint256 notional = 1000e6;

        // Period A settles at cpiA. Warp target is read back from the
        // period's own `periodEnd` rather than re-deriving it from
        // `block.timestamp` a second time later in this function -- keeps
        // the two settlements' warp targets independent of each other no
        // matter how the compiler orders/caches timestamp reads.
        uint256 periodA = _createLowPremiumPeriod(CAP);
        vm.prank(lp1);
        insurance.deposit(periodA, 1000e6);
        vm.prank(buyer1);
        uint256 policyA = insurance.buyPolicy(periodA, notional, STRIKE);
        vm.warp(insurance.getPeriod(periodA).periodEnd + 1);
        insurance.postSettlement(periodA, cpiA);
        uint256 balBeforeA = usdt.balanceOf(buyer1);
        vm.prank(buyer1);
        insurance.claim(policyA);
        uint256 payoutA = usdt.balanceOf(buyer1) - balBeforeA;

        // Period B settles at cpiB, otherwise identical.
        uint256 periodB = _createLowPremiumPeriod(CAP);
        vm.prank(lp2);
        insurance.deposit(periodB, 1000e6);
        vm.prank(buyer2);
        uint256 policyB = insurance.buyPolicy(periodB, notional, STRIKE);
        vm.warp(insurance.getPeriod(periodB).periodEnd + 1);
        insurance.postSettlement(periodB, cpiB);
        uint256 balBeforeB = usdt.balanceOf(buyer2);
        vm.prank(buyer2);
        insurance.claim(policyB);
        uint256 payoutB = usdt.balanceOf(buyer2) - balBeforeB;

        assertLe(payoutA, payoutB, "payout must be monotonic in settled CPI");
    }

    /// A short random sequence of deposits and purchases must never leave the
    /// pool under-collateralized: either the invariant holds after every
    /// successful buyPolicy, or the call reverted.
    function testFuzz_SolvencySequence(uint256 depositSeed, uint256[3] memory notionalSeeds, uint256[3] memory strikeSeeds)
        public
    {
        uint256 periodId = _createLowPremiumPeriod(CAP);

        uint256 depositAmt = bound(depositSeed, 1e6, 10_000e6);
        vm.prank(lp1);
        insurance.deposit(periodId, depositAmt);

        address[3] memory buyers = [buyer1, buyer2, lp2]; // lp2 also funded/approved in setUp

        for (uint256 i = 0; i < 3; i++) {
            uint256 notional = bound(notionalSeeds[i], 1e6, 1_000_000e6);
            uint256 strikeBps = bound(strikeSeeds[i], 0, CAP - 1);

            vm.prank(buyers[i]);
            try insurance.buyPolicy(periodId, notional, strikeBps) returns (uint256) {
                InflationHedge.Period memory period = insurance.getPeriod(periodId);
                assertLe(
                    period.totalMaxLiability,
                    period.totalCollateral + period.totalPremiums,
                    "solvency invariant must hold after every successful purchase"
                );
            } catch {
                // Reverted purchase (insufficient backing or unpriceable) is fine.
            }
        }
    }
}
