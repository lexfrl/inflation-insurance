// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CpiInsurance} from "../src/CpiInsurance.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/// @notice Deploys MockUSDC + CpiInsurance and logs both addresses for
///         web/.env.local. Does not create any periods -- see Demo.s.sol for
///         a full lifecycle run, or create periods manually via `cast send`
///         (needed for a real Base Sepolia demo, since `vm.warp` only affects
///         local anvil, not a live public chain).
contract Deploy is Script {
    function run() external returns (MockUSDC usdc, CpiInsurance insurance) {
        vm.startBroadcast();

        usdc = new MockUSDC();
        insurance = new CpiInsurance(IERC20(address(usdc)));

        vm.stopBroadcast();

        console.log("Deployer / owner:", msg.sender);
        console.log("MockUSDC:", address(usdc));
        console.log("CpiInsurance:", address(insurance));
    }
}
