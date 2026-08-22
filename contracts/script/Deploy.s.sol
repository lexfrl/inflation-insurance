// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {InflationHedge} from "../src/InflationHedge.sol";
import {MockUSDT} from "../src/MockUSDT.sol";

/// @notice Deploys MockUSDT + InflationHedge and logs both addresses for
///         web/.env.local. Does not create any periods -- see Demo.s.sol for
///         a full lifecycle run, or create periods manually via `cast send`
///         (needed for a real Base Sepolia demo, since `vm.warp` only affects
///         local anvil, not a live public chain).
contract Deploy is Script {
    function run() external returns (MockUSDT usdt, InflationHedge insurance) {
        vm.startBroadcast();

        usdt = new MockUSDT();
        insurance = new InflationHedge(IERC20(address(usdt)));

        vm.stopBroadcast();

        console.log("Deployer / owner:", msg.sender);
        console.log("MockUSDT:", address(usdt));
        console.log("InflationHedge:", address(insurance));
    }
}
