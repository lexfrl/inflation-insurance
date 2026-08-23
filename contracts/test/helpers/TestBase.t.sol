// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {InflationHedge} from "../../src/InflationHedge.sol";
import {MockUSDT} from "../../src/MockUSDT.sol";
import {MockYieldVault} from "../../src/MockYieldVault.sol";

/// @notice Shared fixtures for InflationHedge tests: deployment, funded
///         actors, and a default histogram matching the founder's worked
///         example (strike=3%, cap=8%, $1000 notional -> $50 max payout).
abstract contract TestBase is Test {
    InflationHedge internal insurance;
    MockUSDT internal usdt;
    MockYieldVault internal yieldVault;

    address internal lp1 = makeAddr("lp1");
    address internal lp2 = makeAddr("lp2");
    address internal buyer1 = makeAddr("buyer1");
    address internal buyer2 = makeAddr("buyer2");

    uint256 internal constant STRIKE = 300; // 3.00%
    uint256 internal constant CAP = 800; // 8.00%
    uint256 internal constant LOAD = 12_000; // 1.2x raw EV
    uint256 internal constant CLAIM_WINDOW = 3 days;

    function setUp() public virtual {
        usdt = new MockUSDT();
        insurance = new InflationHedge(IERC20(address(usdt)));
        // Deployed but deliberately NOT wired in: every suite that does not
        // call `_enableVault` keeps running with the integration switched off,
        // which is both a zero-regression guarantee and a live pin on the
        // "no vault configured" path that most deployments will actually use.
        yieldVault = new MockYieldVault(IERC20(address(usdt)));

        _fund(lp1, 1_000_000e6);
        _fund(lp2, 1_000_000e6);
        _fund(buyer1, 1_000_000e6);
        _fund(buyer2, 1_000_000e6);
    }

    function _fund(address who, uint256 amount) internal {
        usdt.mint(who, amount);
        vm.prank(who);
        usdt.approve(address(insurance), type(uint256).max);
    }

    /// @dev Histogram: {2%, 4%, 6%, 8%} with probabilities {40%, 30%, 20%, 10%}.
    ///      Sums to 10000 bps, deliberately puts meaningful mass above and
    ///      below a 3% strike so quote() exercises the full EV loop.
    function _defaultHistogram() internal pure returns (uint256[] memory buckets, uint256[] memory probs) {
        buckets = new uint256[](4);
        buckets[0] = 200;
        buckets[1] = 400;
        buckets[2] = 600;
        buckets[3] = 800;

        probs = new uint256[](4);
        probs[0] = 4000;
        probs[1] = 3000;
        probs[2] = 2000;
        probs[3] = 1000;
    }

    function _defaultParams(uint256 saleEnd, uint256 periodEnd, uint256 claimWindowSecs)
        internal
        pure
        returns (InflationHedge.CreatePeriodParams memory p)
    {
        (uint256[] memory buckets, uint256[] memory probs) = _defaultHistogram();
        p = InflationHedge.CreatePeriodParams({
            label: "Argentina CPI, Sep 2026",
            capBps: CAP,
            saleEnd: saleEnd,
            periodEnd: periodEnd,
            claimWindowSecs: claimWindowSecs,
            loadBps: LOAD,
            cpiBucketsBps: buckets,
            probBps: probs
        });
    }

    /// @dev Creates a period with sale closing in 1 day, CPI period ending in
    ///      2 days, and a 3-day claim window that starts once settlement
    ///      actually posts.
    function _createDefaultPeriod() internal returns (uint256 periodId) {
        InflationHedge.CreatePeriodParams memory p =
            _defaultParams(block.timestamp + 1 days, block.timestamp + 2 days, CLAIM_WINDOW);
        periodId = insurance.createPeriod(p);
    }

    function _customParams(
        uint256 capBps,
        uint256 loadBps,
        uint256[] memory buckets,
        uint256[] memory probs,
        uint256 saleEnd,
        uint256 periodEnd,
        uint256 claimWindowSecs
    ) internal pure returns (InflationHedge.CreatePeriodParams memory p) {
        p = InflationHedge.CreatePeriodParams({
            label: "custom",
            capBps: capBps,
            saleEnd: saleEnd,
            periodEnd: periodEnd,
            claimWindowSecs: claimWindowSecs,
            loadBps: loadBps,
            cpiBucketsBps: buckets,
            probBps: probs
        });
    }

    /// @dev Wires the mock vault in at the given cap. Unpranked because the
    ///      test contract itself is the Ownable owner.
    function _enableVault(uint256 investBps) internal {
        insurance.setVault(IERC4626(address(yieldVault)));
        insurance.setInvestBps(investBps);
    }

    /// @dev The standard invested fixture: LP funds $1,000, one buyer takes
    ///      the founder's-example policy ($50 max payout), sale closes, and
    ///      the unsold $966.80 of capacity goes into the vault.
    function _investedPeriod() internal returns (uint256 periodId, uint256 policyId) {
        periodId = _createDefaultPeriod();

        vm.prank(lp1);
        insurance.deposit(periodId, 1_000e6);

        vm.prank(buyer1);
        policyId = insurance.buyPolicy(periodId, 1_000e6, STRIKE);

        vm.warp(insurance.getPeriod(periodId).saleEnd);
        insurance.investIdle(periodId);
    }
}
