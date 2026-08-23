// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {InflationHedge} from "../src/InflationHedge.sol";

interface IMetaMorphoFactory {
    function MORPHO() external view returns (address);
    function createMetaMorpho(
        address initialOwner,
        uint256 initialTimelock,
        address asset,
        string memory name,
        string memory symbol,
        bytes32 salt
    ) external returns (address);
}

/// @notice Creates a REAL Morpho vault on Base Sepolia over this project's
///         collateral token and points an already-deployed `InflationHedge` at
///         it, so the testnet demo runs against Morpho's own contracts rather
///         than `MockYieldVault`.
///
/// @dev Which Morpho, and why -- verified on-chain rather than taken from the
///      docs, because the docs list Base *mainnet* addresses under the Base
///      Sepolia heading:
///
///        Morpho Blue            0xBBBB...FFCb   deployed on Base Sepolia
///        AdaptiveCurveIRM       0x4641...2687   deployed on Base Sepolia
///        MetaMorpho V1 factory  0xA9c3...1101   deployed on Base Sepolia
///        Vaults V2 factory      0x4501...5857   NO CODE on Base Sepolia
///
///      So the vault created here is a MetaMorpho (Vaults V1) vault. That is
///      still a genuine, unmodified Morpho contract and a genuine ERC-4626,
///      which is all `InflationHedge` depends on.
///
///      IMPORTANT operational caveat, stated plainly: a freshly created
///      MetaMorpho vault has no markets in its supply queue, and MetaMorpho
///      derives `maxDeposit` from the caps of the markets in that queue --
///      so until the owner submits and accepts a cap for at least one Morpho
///      Blue market, the vault takes no deposits and earns nothing. Raising a
///      cap from zero is timelocked, and this factory enforces a one-day
///      minimum, so enabling the first market is a next-day operation. Run
///      this script a day before you need the testnet demo, or keep pointing
///      `InflationHedge` at `MockYieldVault` for the live walkthrough and let
///      `InflationHedgeMorphoFork.t.sol` carry the "real Morpho, real yield"
///      claim against Base mainnet.
contract DeployMorphoVault is Script {
    address internal constant METAMORPHO_FACTORY = 0xA9c3D3a366466Fa809d1Ae982Fb2c46E5fC41101;
    uint256 internal constant MIN_TIMELOCK = 1 days;

    function run(address insuranceAddr, bytes32 salt) external returns (address vaultAddr) {
        InflationHedge insurance = InflationHedge(insuranceAddr);
        address asset = address(insurance.usdt());

        vm.startBroadcast();

        vaultAddr = IMetaMorphoFactory(METAMORPHO_FACTORY).createMetaMorpho(
            msg.sender, MIN_TIMELOCK, asset, "IPC Shield Idle", "ipcIDLE", salt
        );
        insurance.setVault(IERC4626(vaultAddr));

        vm.stopBroadcast();

        console.log("MORPHO_FACTORY", METAMORPHO_FACTORY);
        console.log("MORPHO_BLUE", IMetaMorphoFactory(METAMORPHO_FACTORY).MORPHO());
        console.log("VAULT_ADDRESS", vaultAddr);
        console.log("VAULT_ASSET", asset);
        console.log("VAULT_MAX_DEPOSIT", IERC4626(vaultAddr).maxDeposit(insuranceAddr));
    }
}
