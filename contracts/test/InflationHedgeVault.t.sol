// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {TestBase} from "./helpers/TestBase.t.sol";
import {InflationHedge} from "../src/InflationHedge.sol";
import {MockYieldVault} from "../src/MockYieldVault.sol";

/// @notice Covers the ERC-4626 yield integration: only unsold capacity is ever
///         deployed, buyers are paid from liquid USDT no matter what the vault
///         does, and vault P&L lands entirely on LPs.
///
///         Fixture arithmetic used throughout, from `_investedPeriod()`:
///         collateral 1,000.00 + premiums 16.80 - liability 50.00
///         = 966.80 USDT of unsold capacity, leaving exactly the 50.00 of
///         buyer liability liquid in the contract.
contract InflationHedgeVaultTest is TestBase {
    uint256 internal constant BPS_DENOM = 10_000;
    uint256 internal constant IDLE = 966_800_000; // 966.80 USDT
    uint256 internal constant LIABILITY = 50e6;
    uint256 internal constant PREMIUM = 16_800_000;

    // ---------------------------------------------------------------------
    // Vault configuration
    // ---------------------------------------------------------------------

    /// @dev One `asset()` read is what turns a fat-fingered vault address from
    ///      a fund-loss event into a failed transaction.
    function test_SetVault_RevertsOnAssetMismatch() public {
        MockYieldVault wrongAsset = new MockYieldVault(IERC20(address(new MockYieldVault(IERC20(address(usdt))))));
        vm.expectRevert("vault asset mismatch");
        insurance.setVault(IERC4626(address(wrongAsset)));
    }

    function test_SetVault_AcceptsZeroToDisable() public {
        _enableVault(BPS_DENOM);
        insurance.setVault(IERC4626(address(0)));
        assertEq(address(insurance.vault()), address(0));
    }

    function test_SetVault_RevertsIfNotOwner() public {
        vm.prank(lp1);
        vm.expectRevert();
        insurance.setVault(IERC4626(address(yieldVault)));
    }

    function test_SetInvestBps_RevertsAboveDenom() public {
        vm.expectRevert("bad invest bps");
        insurance.setInvestBps(BPS_DENOM + 1);
    }

    // ---------------------------------------------------------------------
    // investIdle: the window, and what it is allowed to deploy
    // ---------------------------------------------------------------------

    /// @dev Investing before `saleEnd` would let a buyer arriving afterwards
    ///      push `totalMaxLiability` above the USDT still physically in the
    ///      pool. The window cannot open until underwriting is closed.
    function test_InvestIdle_RevertsBeforeSaleEnd() public {
        _enableVault(BPS_DENOM);
        uint256 periodId = _createDefaultPeriod();

        vm.prank(lp1);
        insurance.deposit(periodId, 1_000e6);

        vm.warp(insurance.getPeriod(periodId).saleEnd - 1);
        vm.expectRevert("sale still open");
        insurance.investIdle(periodId);
    }

    /// @dev Exact boundary: `saleEnd` itself is already closed to `deposit` and
    ///      `buyPolicy` (both require strictly less than), so it is the first
    ///      instant at which the idle figure is frozen and safe to act on.
    function test_InvestIdle_SucceedsExactlyAtSaleEnd() public {
        _enableVault(BPS_DENOM);
        uint256 periodId = _createDefaultPeriod();

        vm.prank(lp1);
        insurance.deposit(periodId, 1_000e6);

        vm.warp(insurance.getPeriod(periodId).saleEnd);
        (uint256 assets,) = insurance.investIdle(periodId);
        assertEq(assets, 1_000e6, "whole pool is idle when nothing was sold");
    }

    function test_InvestIdle_RevertsAfterSettlement() public {
        _enableVault(BPS_DENOM);
        uint256 periodId = _createDefaultPeriod();

        vm.prank(lp1);
        insurance.deposit(periodId, 1_000e6);

        vm.warp(insurance.getPeriod(periodId).periodEnd);
        insurance.postSettlement(periodId, 500);

        vm.expectRevert("already settled");
        insurance.investIdle(periodId);
    }

    function test_InvestIdle_RevertsWhenNoVaultSet() public {
        uint256 periodId = _createDefaultPeriod();

        vm.prank(lp1);
        insurance.deposit(periodId, 1_000e6);

        vm.warp(insurance.getPeriod(periodId).saleEnd);
        vm.expectRevert("no vault");
        insurance.investIdle(periodId);
    }

    /// @dev Single-shot per period. A repeatable invest paired with the
    ///      repeatable `divest` would let anyone grind LP funds down a couple
    ///      of wei per round trip on ERC-4626's floor rounding.
    function test_InvestIdle_RevertsOnSecondCall() public {
        _enableVault(BPS_DENOM);
        (uint256 periodId,) = _investedPeriod();

        vm.expectRevert("already invested");
        insurance.investIdle(periodId);
    }

    /// @dev THE core property. Whatever else happens, the USDT left sitting in
    ///      this contract after investing is exactly the buyers' outstanding
    ///      maximum liability -- which is what keeps the yield venue out of
    ///      the claim path entirely.
    function test_InvestIdle_DeploysOnlyUnsoldCapacity() public {
        _enableVault(BPS_DENOM);
        (uint256 periodId,) = _investedPeriod();

        InflationHedge.Period memory period = insurance.getPeriod(periodId);
        assertEq(period.vaultPrincipal, IDLE, "deployed exactly the unsold capacity");
        assertEq(period.totalMaxLiability, LIABILITY, "fixture liability");
        assertEq(
            usdt.balanceOf(address(insurance)),
            period.totalMaxLiability,
            "liquid USDT must exactly cover outstanding buyer liability"
        );
    }

    function test_InvestIdle_RespectsInvestBps() public {
        _enableVault(5_000); // half of idle
        (uint256 periodId,) = _investedPeriod();

        assertEq(insurance.getPeriod(periodId).vaultPrincipal, IDLE / 2, "half of unsold capacity");
    }

    /// @dev A Vault V2 curator can install a gate that refuses this depositor.
    ///      The failure mode must be "this period earns no yield", never
    ///      "the product is broken".
    function test_InvestIdle_RevertsWhenVaultDepositIsGated() public {
        _enableVault(BPS_DENOM);
        yieldVault.setDepositBlocked(true);

        uint256 periodId = _createDefaultPeriod();
        vm.prank(lp1);
        insurance.deposit(periodId, 1_000e6);
        vm.warp(insurance.getPeriod(periodId).saleEnd);

        vm.expectRevert("deposit gated");
        insurance.investIdle(periodId);

        // The period is untouched and still fully functional.
        assertEq(usdt.balanceOf(address(insurance)), 1_000e6);
    }

    /// @dev The classic ERC-4626 inflation attack: a donation makes an honest
    ///      deposit round down to zero shares. Reverting keeps the USDT rather
    ///      than booking principal against shares we do not hold.
    function test_InvestIdle_RevertsWhenSharesRoundToZero() public {
        _enableVault(BPS_DENOM);
        yieldVault.setMintZeroShares(true);

        uint256 periodId = _createDefaultPeriod();
        vm.prank(lp1);
        insurance.deposit(periodId, 1_000e6);
        vm.warp(insurance.getPeriod(periodId).saleEnd);

        vm.expectRevert("no vault shares");
        insurance.investIdle(periodId);
    }

    /// @dev Permissionless on purpose: the amount is fully determined by pool
    ///      state and the owner's caps, so a caller only chooses the timing.
    function test_InvestIdle_IsPermissionless() public {
        _enableVault(BPS_DENOM);
        uint256 periodId = _createDefaultPeriod();

        vm.prank(lp1);
        insurance.deposit(periodId, 1_000e6);
        vm.warp(insurance.getPeriod(periodId).saleEnd);

        vm.prank(buyer2); // no role of any kind
        insurance.investIdle(periodId);

        assertEq(insurance.getPeriod(periodId).vaultPrincipal, 1_000e6);
    }

    // ---------------------------------------------------------------------
    // claim: the buyer must never be able to be harmed by the yield venue
    // ---------------------------------------------------------------------

    function test_Claim_FullyPaidWhileCapitalIsInVault() public {
        _enableVault(BPS_DENOM);
        (uint256 periodId, uint256 policyId) = _investedPeriod();

        vm.warp(insurance.getPeriod(periodId).periodEnd);
        insurance.postSettlement(periodId, 500); // CPI 5.00%

        uint256 balBefore = usdt.balanceOf(buyer1);
        vm.prank(buyer1);
        insurance.claim(policyId);

        assertEq(usdt.balanceOf(buyer1) - balBefore, 20e6, "payout unaffected by the vault position");
    }

    /// @dev The headline safety claim, tested at its worst case: the vault
    ///      loses every last cent, the buyer is still paid in full because
    ///      their maximum payout never left this contract.
    function test_Claim_FullyPaidAfterTotalVaultLoss() public {
        _enableVault(BPS_DENOM);
        (uint256 periodId, uint256 policyId) = _investedPeriod();

        yieldVault.simulateLoss(usdt.balanceOf(address(yieldVault)));

        vm.warp(insurance.getPeriod(periodId).periodEnd);
        insurance.postSettlement(periodId, 800); // CPI at the cap: maximum payout

        uint256 balBefore = usdt.balanceOf(buyer1);
        vm.prank(buyer1);
        insurance.claim(policyId);

        assertEq(usdt.balanceOf(buyer1) - balBefore, LIABILITY, "max payout still fully covered");
    }

    // ---------------------------------------------------------------------
    // divest: partial, retryable, and pinned to the vault actually used
    // ---------------------------------------------------------------------

    function test_Divest_RevertsWhenNothingInvested() public {
        uint256 periodId = _createDefaultPeriod();
        vm.expectRevert("nothing invested");
        insurance.divest(periodId, 1);
    }

    function test_Divest_RevertsOnTooManyShares() public {
        _enableVault(BPS_DENOM);
        (uint256 periodId,) = _investedPeriod();

        uint256 shares = insurance.getPeriod(periodId).vaultShares;
        vm.expectRevert("too many shares");
        insurance.divest(periodId, shares + 1);
    }

    function test_Divest_IsPermissionless() public {
        _enableVault(BPS_DENOM);
        (uint256 periodId,) = _investedPeriod();

        uint256 shares = insurance.getPeriod(periodId).vaultShares;
        vm.prank(buyer2);
        insurance.divest(periodId, shares);

        assertEq(insurance.getPeriod(periodId).vaultShares, 0);
    }

    /// @dev A curated vault's instantly-redeemable liquidity is routinely a
    ///      fraction of its deposits. Draining across several transactions has
    ///      to work, and `withdraw` has to stay shut until the last share is
    ///      back.
    function test_Divest_PartialLeavesWithdrawBlocked_SecondCallUnblocksIt() public {
        _enableVault(BPS_DENOM);
        (uint256 periodId,) = _investedPeriod();

        uint256 shares = insurance.getPeriod(periodId).vaultShares;
        insurance.divest(periodId, shares / 2);
        assertGt(insurance.getPeriod(periodId).vaultShares, 0, "position only half unwound");

        InflationHedge.Period memory period = insurance.getPeriod(periodId);
        vm.warp(period.periodEnd);
        insurance.postSettlement(periodId, 500);
        vm.warp(insurance.getPeriod(periodId).claimDeadline + 1);

        vm.prank(lp1);
        vm.expectRevert("vault not divested");
        insurance.withdraw(periodId);

        insurance.divest(periodId, insurance.getPeriod(periodId).vaultShares);

        vm.prank(lp1);
        insurance.withdraw(periodId);
    }

    /// @dev Pins the cross-period misattribution bug. This contract holds ONE
    ///      pooled share balance, so if `divest` redeemed from whatever
    ///      `vault` currently points at rather than from the vault the period
    ///      actually deposited into, unwinding an old period would burn a
    ///      newer period's shares of the new vault.
    function test_Divest_AfterVaultRepointed_StillRedeemsOriginalVault() public {
        _enableVault(BPS_DENOM);
        (uint256 periodA,) = _investedPeriod();

        MockYieldVault vault2 = new MockYieldVault(IERC20(address(usdt)));
        insurance.setVault(IERC4626(address(vault2)));

        uint256 periodB = _createDefaultPeriod();
        vm.prank(lp2);
        insurance.deposit(periodB, 500e6);
        vm.warp(insurance.getPeriod(periodB).saleEnd);
        insurance.investIdle(periodB);

        uint256 vault2SharesBefore = vault2.balanceOf(address(insurance));

        insurance.divest(periodA, insurance.getPeriod(periodA).vaultShares);

        assertEq(yieldVault.balanceOf(address(insurance)), 0, "period A drained its own vault");
        assertEq(vault2.balanceOf(address(insurance)), vault2SharesBefore, "period B's shares untouched");
        assertEq(insurance.getPeriod(periodB).vaultShares, vault2SharesBefore, "period B accounting intact");
    }

    // ---------------------------------------------------------------------
    // withdraw: vault P&L lands on LPs, and only on LPs
    // ---------------------------------------------------------------------

    function test_Withdraw_RevertsUntilFullyDivested() public {
        _enableVault(BPS_DENOM);
        (uint256 periodId,) = _investedPeriod();

        vm.warp(insurance.getPeriod(periodId).periodEnd);
        insurance.postSettlement(periodId, 200); // below strike: nothing to claim
        vm.warp(insurance.getPeriod(periodId).claimDeadline + 1);

        vm.prank(lp1);
        vm.expectRevert("vault not divested");
        insurance.withdraw(periodId);
    }

    /// @dev The whole point of the feature: an LP who sold one $50-liability
    ///      policy earns 16.80 of premium plus the vault's yield on the 966.80
    ///      that nobody bought.
    function test_Withdraw_PaysVaultYieldToLps() public {
        _enableVault(BPS_DENOM);
        (uint256 periodId,) = _investedPeriod();

        yieldVault.accrueYield(100e6);

        vm.warp(insurance.getPeriod(periodId).periodEnd);
        insurance.postSettlement(periodId, 200); // below strike: no payout
        insurance.divest(periodId, insurance.getPeriod(periodId).vaultShares);
        vm.warp(insurance.getPeriod(periodId).claimDeadline + 1);

        uint256 balBefore = usdt.balanceOf(lp1);
        vm.prank(lp1);
        insurance.withdraw(periodId);

        // 1,000.00 principal + 16.80 premium + ~100.00 vault yield.
        assertApproxEqAbs(usdt.balanceOf(lp1) - balBefore, 1_000e6 + PREMIUM + 100e6, 2, "principal + premium + yield");
    }

    /// @dev The correct asymmetry: LPs earn the yield, so LPs absorb the loss.
    ///      The buyer in this fixture is paid in full regardless.
    function test_Withdraw_VaultLossIsAbsorbedByLps() public {
        _enableVault(BPS_DENOM);
        (uint256 periodId, uint256 policyId) = _investedPeriod();

        yieldVault.simulateLoss(100e6);

        vm.warp(insurance.getPeriod(periodId).periodEnd);
        insurance.postSettlement(periodId, 500);

        vm.prank(buyer1);
        insurance.claim(policyId); // 20.00 paid out in full

        insurance.divest(periodId, insurance.getPeriod(periodId).vaultShares);
        vm.warp(insurance.getPeriod(periodId).claimDeadline + 1);

        uint256 balBefore = usdt.balanceOf(lp1);
        vm.prank(lp1);
        insurance.withdraw(periodId);

        // 1,000.00 + 16.80 - 20.00 claimed - 100.00 vault loss.
        assertApproxEqAbs(usdt.balanceOf(lp1) - balBefore, 1_000e6 + PREMIUM - 20e6 - 100e6, 2, "LP eats the loss");
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function test_IdleCapacity_MatchesWhatInvestIdleDeploys() public {
        _enableVault(BPS_DENOM);
        uint256 periodId = _createDefaultPeriod();

        vm.prank(lp1);
        insurance.deposit(periodId, 1_000e6);
        vm.prank(buyer1);
        insurance.buyPolicy(periodId, 1_000e6, STRIKE);
        vm.warp(insurance.getPeriod(periodId).saleEnd);

        uint256 quoted = insurance.idleCapacity(periodId);
        (uint256 deployed,) = insurance.investIdle(periodId);

        assertEq(quoted, IDLE, "view matches the fixture arithmetic");
        assertEq(deployed, quoted, "view must not lie to the UI");
        assertEq(insurance.idleCapacity(periodId), 0, "nothing left to deploy once invested");
    }

    function test_VaultValue_ReturnsZeroWhenNothingInvested() public {
        uint256 periodId = _createDefaultPeriod();
        assertEq(insurance.vaultValue(periodId), 0);
    }

    function test_VaultValue_TracksAccruedYield() public {
        _enableVault(BPS_DENOM);
        (uint256 periodId,) = _investedPeriod();

        assertApproxEqAbs(insurance.vaultValue(periodId), IDLE, 2, "starts at principal");

        yieldVault.accrueYield(50e6);
        assertApproxEqAbs(insurance.vaultValue(periodId), IDLE + 50e6, 2, "tracks accrual");
    }
}
