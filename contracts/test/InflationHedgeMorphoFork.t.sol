// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {InflationHedge} from "../src/InflationHedge.sol";

/// @notice Runs the yield integration against the real Morpho deployment on
///         Base mainnet, over a real curated vault holding real deposits.
///         Everything else in the suite proves the integration is correct
///         against a mock; this proves the mock is not lying about the shape
///         of a production ERC-4626 vault.
///
/// @dev Two honest limits on what this file proves, stated up front:
///
///      1. The vault below is Gauntlet USDC Prime, a **MetaMorpho (Vaults V1)**
///         vault -- it exposes `MORPHO()` and its `max*` functions behave
///         normally. So this file does NOT prove the "never gate on `max*`"
///         property; Morpho Vaults V2 hardcodes all four to 0, and it is
///         `MockYieldVault` -- which reproduces that deliberately -- that
///         pins it. This file proves real deposits, real share accounting and
///         real accrued interest.
///
///      2. The pool's collateral here is real Base **USDC**, not USDT.
///         `InflationHedge` stores `IERC20 public immutable usdt` and never
///         reads `name`, `symbol` or `decimals` off it -- it is entirely
///         asset-agnostic, and Base USDC is 6-decimal exactly like the USDT
///         this product settles in, so every `e6` amount and the `1e12`
///         scaling in `quote` are bit-identical. Curated Morpho vaults on
///         Base are USDC-denominated, so a USDC-collateralised pool is what
///         a real integration would actually look like on this chain.
///
///      CI safety: the RPC comes from `BASE_RPC_URL` and every test skips
///      loudly when it is unset, so plain `forge test` forks nothing. `vm.skip`
///      rather than a bare `return` on purpose -- a silently passing test
///      makes an integration that has never actually run look green.
contract InflationHedgeMorphoForkTest is Test {
    address internal constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant GAUNTLET_USDC_PRIME = 0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61;

    uint256 internal constant DEPOSIT = 100_000e6; // 100,000 USDC
    uint256 internal constant NOTIONAL = 100_000e6;
    uint256 internal constant STRIKE = 300; // 3.00%
    uint256 internal constant CAP = 800; // 8.00%

    InflationHedge internal insurance;
    IERC20 internal usdc;
    IERC4626 internal morphoVault;

    address internal lp = makeAddr("forkLp");
    address internal buyer = makeAddr("forkBuyer");

    bool internal forked;
    uint256 internal periodId;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;

        // Pinned only when the operator has an archive endpoint. The public
        // Base RPC serves recent state only, so defaulting to latest keeps
        // `BASE_RPC_URL=https://mainnet.base.org forge test` working for
        // anyone; assertions below are all relational so a moving head block
        // never makes them flaky.
        uint256 pinned = vm.envOr("BASE_FORK_BLOCK", uint256(0));
        if (pinned == 0) {
            vm.createSelectFork(rpc);
        } else {
            vm.createSelectFork(rpc, pinned);
        }
        forked = true;

        usdc = IERC20(BASE_USDC);
        morphoVault = IERC4626(GAUNTLET_USDC_PRIME);

        insurance = new InflationHedge(usdc);
        insurance.setVault(morphoVault);
        insurance.setInvestBps(10_000);

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

        periodId = insurance.createPeriod(
            InflationHedge.CreatePeriodParams({
                label: "Argentina CPI, fork fixture",
                capBps: CAP,
                saleEnd: block.timestamp + 1 days,
                periodEnd: block.timestamp + 2 days,
                claimWindowSecs: 3 days,
                loadBps: 12_000,
                cpiBucketsBps: buckets,
                probBps: probs
            })
        );

        _fund(lp, DEPOSIT);
        _fund(buyer, DEPOSIT);
    }

    modifier onlyForked() {
        if (!forked) vm.skip(true, "BASE_RPC_URL not set");
        _;
    }

    /// @dev Base USDC is a FiatTokenV2_2 behind a proxy, and `deal`'s storage
    ///      slot search has been known to miss on that layout. Asserting the
    ///      balance immediately turns a silent zero-balance funding failure
    ///      into an obvious one at the point of cause.
    function _fund(address who, uint256 amount) internal {
        deal(BASE_USDC, who, amount);
        assertEq(usdc.balanceOf(who), amount, "deal failed to fund the account");
        vm.prank(who);
        usdc.approve(address(insurance), type(uint256).max);
    }

    /// Fails fast and legibly if Morpho ever repoints this vault address.
    function test_ForkBase_VaultIsUsdcDenominated() public onlyForked {
        assertEq(morphoVault.asset(), BASE_USDC, "vault must be denominated in the pool's collateral");
        assertGt(morphoVault.totalAssets(), 0, "vault should hold real deposits");
    }

    /// The core safety property, proven against production Morpho: after
    /// deploying idle capital, the USDC physically left in this contract is
    /// exactly the buyers' outstanding maximum liability.
    function test_ForkBase_InvestIdleLeavesBuyerLiabilityFullyLiquid() public onlyForked {
        _openAndInvest();

        InflationHedge.Period memory period = insurance.getPeriod(periodId);
        assertEq(
            usdc.balanceOf(address(insurance)),
            period.totalMaxLiability,
            "liquid USDC must exactly cover outstanding buyer liability"
        );
        assertGt(period.vaultShares, 0, "real vault shares were minted");
    }

    /// Real interest, accrued by real borrowers on real Morpho markets, ends
    /// up in LP hands. Asserted relationally, never against a magic number --
    /// rates move.
    function test_ForkBase_RealMorphoYieldAccruesToLps() public onlyForked {
        _openAndInvest();
        uint256 principal = insurance.getPeriod(periodId).vaultPrincipal;

        vm.warp(block.timestamp + 30 days);
        uint256 grown = insurance.vaultValue(periodId);
        assertGt(grown, principal, "position must be worth more after 30 days");

        // Implied annualised rate, printed for the demo narrative rather than
        // asserted, since it depends on live market conditions.
        console.log("MORPHO_PRINCIPAL_USDC", principal);
        console.log("MORPHO_VALUE_AFTER_30D_USDC", grown);
        console.log("IMPLIED_APY_BPS", ((grown - principal) * 10_000 * 365) / (principal * 30));

        insurance.postSettlement(periodId, 200); // below strike: no claims
        insurance.divest(periodId, insurance.getPeriod(periodId).vaultShares);

        InflationHedge.Period memory period = insurance.getPeriod(periodId);
        assertGt(period.vaultProceeds, period.vaultPrincipal, "redeemed more than deployed");
        assertEq(period.vaultShares, 0, "position fully unwound");

        vm.warp(insurance.getPeriod(periodId).claimDeadline + 1);
        uint256 balBefore = usdc.balanceOf(lp);
        vm.prank(lp);
        insurance.withdraw(periodId);

        uint256 received = usdc.balanceOf(lp) - balBefore;
        assertGt(received, DEPOSIT, "LP got back more than principal: premium plus real Morpho yield");
    }

    /// A curated vault can only ever service part of a large redemption, so
    /// draining across several calls has to work against the real thing too.
    function test_ForkBase_DivestIsPartialCapable() public onlyForked {
        _openAndInvest();

        uint256 shares = insurance.getPeriod(periodId).vaultShares;
        insurance.postSettlement(periodId, 200);

        insurance.divest(periodId, shares / 2);
        assertGt(insurance.getPeriod(periodId).vaultShares, 0, "half still deployed");

        vm.warp(insurance.getPeriod(periodId).claimDeadline + 1);
        vm.prank(lp);
        vm.expectRevert("vault not divested");
        insurance.withdraw(periodId);

        insurance.divest(periodId, insurance.getPeriod(periodId).vaultShares);
        vm.prank(lp);
        insurance.withdraw(periodId);
    }

    function _openAndInvest() internal {
        vm.prank(lp);
        insurance.deposit(periodId, DEPOSIT);

        vm.prank(buyer);
        insurance.buyPolicy(periodId, NOTIONAL, STRIKE);

        vm.warp(insurance.getPeriod(periodId).periodEnd);
        insurance.investIdle(periodId);
    }
}
