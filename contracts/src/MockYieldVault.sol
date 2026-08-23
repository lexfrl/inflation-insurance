// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {MockUSDT} from "./MockUSDT.sol";

/// @title MockYieldVault
/// @notice Testnet-only stand-in for a curated ERC-4626 yield venue such as a
///         Morpho vault. Yield and losses are simulated by open functions so a
///         demo can move the share price on demand instead of waiting for real
///         borrowers to pay interest. NEVER deploy this to a network where it
///         could be mistaken for a real vault holding real deposits.
///
/// @dev This mock deliberately reproduces the two Morpho Vaults V2 behaviours
///      that break naive ERC-4626 integrations, so that `InflationHedge` is
///      tested against them locally rather than discovering them on mainnet:
///      every `max*` function returns 0, and deposits can be gated off. It is
///      therefore stricter than a textbook vault, on purpose -- if
///      `InflationHedge` ever starts gating on `maxDeposit` or `maxRedeem`,
///      every test using this mock fails immediately.
contract MockYieldVault is ERC4626 {
    using SafeERC20 for IERC20;

    address internal constant BURN = address(0xdEaD);

    /// @notice Simulates a Vault V2 `receiveSharesGate` refusing this depositor.
    bool public depositBlocked;
    /// @notice Simulates a vault whose share price has been inflated so far
    ///         that an honest deposit rounds down to zero shares.
    bool public mintZeroShares;
    /// @notice Instantly-redeemable assets. 0 means unlimited. Simulates a
    ///         curated vault whose liquidity is far below its deposits.
    uint256 public liquidityCap;

    constructor(IERC20 asset_) ERC20("Mock Yield Vault", "mYV") ERC4626(asset_) {}

    /// @dev A 6-decimal asset with a 6-decimal offset gives 12-decimal shares,
    ///      which makes the classic donation/inflation attack roughly 1e6x
    ///      more expensive than it could ever be profitable. Costs nothing on
    ///      a mock and keeps the test fixtures honest about real vault
    ///      arithmetic.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    // ---------------------------------------------------------------------
    // Morpho Vaults V2 quirks, reproduced deliberately
    // ---------------------------------------------------------------------

    function maxDeposit(address) public pure override returns (uint256) {
        return 0;
    }

    function maxMint(address) public pure override returns (uint256) {
        return 0;
    }

    function maxWithdraw(address) public pure override returns (uint256) {
        return 0;
    }

    function maxRedeem(address) public pure override returns (uint256) {
        return 0;
    }

    /// @dev OpenZeppelin's `deposit` reverts against the zeroed `maxDeposit`
    ///      above, exactly as a naive integration would against real Vaults
    ///      V2. Overridden here to skip that ceiling check while keeping the
    ///      real share math, which is what an actual V2 vault does.
    ///      `mint` and `withdraw` are deliberately left broken by the zeroed
    ///      maxes: if `InflationHedge` ever reaches for them, it fails loudly.
    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        require(!depositBlocked, "deposit gated");
        uint256 shares = mintZeroShares ? 0 : previewDeposit(assets);
        _deposit(_msgSender(), receiver, assets, shares);
        return shares;
    }

    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        uint256 assets = previewRedeem(shares);
        require(liquidityCap == 0 || assets <= liquidityCap, "insufficient vault liquidity");
        _withdraw(_msgSender(), receiver, owner, assets, shares);
        return assets;
    }

    // ---------------------------------------------------------------------
    // Demo controls
    // ---------------------------------------------------------------------

    /// @notice Raises the share price by minting fresh assets into the vault.
    /// @dev `ERC4626.totalAssets()` is just `asset().balanceOf(this)`, so
    ///      minting in is enough -- no approval and no pre-funded treasury,
    ///      which is what makes this a one-click demo button.
    function accrueYield(uint256 amount) external {
        MockUSDT(asset()).mint(address(this), amount);
    }

    /// @notice Lowers the share price by burning assets out of the vault.
    function simulateLoss(uint256 amount) external {
        IERC20(asset()).safeTransfer(BURN, amount);
    }

    function setDepositBlocked(bool blocked) external {
        depositBlocked = blocked;
    }

    function setMintZeroShares(bool zero) external {
        mintZeroShares = zero;
    }

    function setLiquidityCap(uint256 cap) external {
        liquidityCap = cap;
    }
}
