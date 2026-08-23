// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {InflationHedge} from "../src/InflationHedge.sol";
import {MockUSDT} from "../src/MockUSDT.sol";
import {MockYieldVault} from "../src/MockYieldVault.sol";

/// @notice Deploys MockUSDT + InflationHedge + a mock yield vault, wires the
///         vault in, and logs every address for web/.env.local. Does not
///         create any periods -- see Demo.s.sol for a full lifecycle run, or
///         create periods manually via `cast send` (needed for a real Base
///         Sepolia demo, since `vm.warp` only affects local anvil, not a live
///         public chain).
///
/// @dev Deployment ORDER is load-bearing and must not be rearranged:
///      MockUSDT (nonce 0) -> InflationHedge (nonce 1) -> MockYieldVault
///      (nonce 2). Anvil's deterministic addresses are the only reason
///      `LOCAL_CONTRACT_ADDRESSES` in `web/src/lib/demo-mode.ts` and the
///      address table in the README can be constants at all. Inserting the
///      vault before `InflationHedge` would silently move the insurance
///      contract to a new address and break demo mode, the README, and every
///      `.env.local` in existence.
///
///      On a real network, point the pool at a real vault instead:
///      `insurance.setVault(&lt;curated ERC-4626 vault&gt;)`. MockYieldVault is a
///      testnet prop, not a yield source.
contract Deploy is Script {
    function run() external returns (MockUSDT usdt, InflationHedge insurance, MockYieldVault yieldVault) {
        vm.startBroadcast();

        usdt = new MockUSDT();
        insurance = new InflationHedge(IERC20(address(usdt)));
        yieldVault = new MockYieldVault(IERC20(address(usdt)));
        insurance.setVault(IERC4626(address(yieldVault)));

        vm.stopBroadcast();

        console.log("Deployer / owner:", msg.sender);
        console.log("MockUSDT:", address(usdt));
        console.log("InflationHedge:", address(insurance));
        console.log("MockYieldVault:", address(yieldVault));
    }
}
