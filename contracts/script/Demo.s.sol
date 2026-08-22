// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CpiInsurance} from "../src/CpiInsurance.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/// @notice Three-phase end-to-end lifecycle demo, driven by REAL elapsed
///         time rather than `vm.warp`.
///
/// @dev `vm.warp` only affects Foundry's local simulation of a script -- it
///      does not, and cannot, change a real chain's clock (anvil included:
///      Foundry validates every script against a real broadcast-equivalent
///      replay even in dry-run mode, and that replay ignores warps). A
///      single script that warps past `saleEnd`/`periodEnd`/`claimDeadline`
///      internally can never actually be broadcast, on any chain. So this
///      demo is split into three real transactions, meant to be run minutes
///      apart (see script/demo.sh, which sleeps the right amount for local
///      anvil). The same three functions work unmodified against Base
///      Sepolia -- just wait for real time to pass between phases there too.
///
/// Usage:
///   see script/demo.sh for the fully orchestrated local-anvil run.
contract Demo is Script {
    uint256 internal constant SALE_WINDOW = 30 seconds;
    uint256 internal constant PERIOD_WINDOW = 45 seconds; // must be > SALE_WINDOW
    uint256 internal constant CLAIM_WINDOW = 180 seconds; // must be > PERIOD_WINDOW

    /// Phase 1: deploy, create period, LP deposits, buyer buys a policy.
    /// Prints USDC_ADDRESS / INSURANCE_ADDRESS / PERIOD_ID / POLICY_ID lines
    /// for script/demo.sh to parse and feed into phases 2 and 3.
    function deployAndOpen() external {
        vm.startBroadcast();

        MockUSDC usdc = new MockUSDC();
        CpiInsurance insurance = new CpiInsurance(IERC20(address(usdc)));

        usdc.mint(msg.sender, 1_000_000e6);
        usdc.approve(address(insurance), type(uint256).max);

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

        CpiInsurance.CreatePeriodParams memory p = CpiInsurance.CreatePeriodParams({
            label: "DEMO: Argentina CPI",
            capBps: 800,
            saleEnd: block.timestamp + SALE_WINDOW,
            periodEnd: block.timestamp + PERIOD_WINDOW,
            claimDeadline: block.timestamp + CLAIM_WINDOW,
            loadBps: 12_000,
            cpiBucketsBps: buckets,
            probBps: probs
        });
        uint256 periodId = insurance.createPeriod(p);
        insurance.deposit(periodId, 1_000e6);

        (uint256 premium, uint256 maxPayout) = insurance.quote(periodId, 1_000e6, 300);
        uint256 policyId = insurance.buyPolicy(periodId, 1_000e6, 300);

        vm.stopBroadcast();

        console.log("USDC_ADDRESS", address(usdc));
        console.log("INSURANCE_ADDRESS", address(insurance));
        console.log("PERIOD_ID", periodId);
        console.log("POLICY_ID", policyId);
        console.log("QUOTE_PREMIUM", premium);
        console.log("QUOTE_MAX_PAYOUT", maxPayout);
        console.log("PERIOD_END_UNIX", block.timestamp + PERIOD_WINDOW);
        console.log("CLAIM_DEADLINE_UNIX", block.timestamp + CLAIM_WINDOW);
    }

    /// Phase 2: run once real time has passed `periodEnd`. Owner posts the
    /// CPI settlement, buyer claims.
    function settle(address insuranceAddr, uint256 periodId, uint256 policyId, uint256 cpiBps) external {
        vm.startBroadcast();

        CpiInsurance insurance = CpiInsurance(insuranceAddr);
        insurance.postSettlement(periodId, cpiBps);

        MockUSDC usdc = MockUSDC(address(insurance.usdc()));
        uint256 balBefore = usdc.balanceOf(msg.sender);
        insurance.claim(policyId);
        uint256 payout = usdc.balanceOf(msg.sender) - balBefore;

        vm.stopBroadcast();

        console.log("SETTLED_CPI_BPS", cpiBps);
        console.log("CLAIM_PAYOUT", payout);
    }

    /// Creates an additional period on an ALREADY-DEPLOYED CpiInsurance with
    /// caller-supplied window lengths, instead of the hardcoded 30/45/180s
    /// used by `deployAndOpen`. Use this for a period a human clicks through
    /// live in the frontend -- e.g. 900/1200/3600 seconds -- since a real
    /// wallet-connect + approve + buy flow cannot fit inside 30 seconds.
    /// Does NOT deposit or buy anything; drive those from the UI.
    function createPeriodOnly(
        address insuranceAddr,
        string calldata label,
        uint256 saleSecs,
        uint256 periodSecs,
        uint256 claimSecs
    ) external returns (uint256 periodId) {
        require(periodSecs > saleSecs, "periodSecs must exceed saleSecs");
        require(claimSecs > periodSecs, "claimSecs must exceed periodSecs");

        vm.startBroadcast();

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

        CpiInsurance insurance = CpiInsurance(insuranceAddr);
        CpiInsurance.CreatePeriodParams memory p = CpiInsurance.CreatePeriodParams({
            label: label,
            capBps: 800,
            saleEnd: block.timestamp + saleSecs,
            periodEnd: block.timestamp + periodSecs,
            claimDeadline: block.timestamp + claimSecs,
            loadBps: 12_000,
            cpiBucketsBps: buckets,
            probBps: probs
        });
        periodId = insurance.createPeriod(p);

        vm.stopBroadcast();

        console.log("PERIOD_ID", periodId);
        console.log("PERIOD_END_UNIX", block.timestamp + periodSecs);
        console.log("CLAIM_DEADLINE_UNIX", block.timestamp + claimSecs);
    }

    /// Phase 3: run once real time has passed `claimDeadline`. LP withdraws
    /// its share of what's left in the pool.
    function withdrawPhase(address insuranceAddr, uint256 periodId) external {
        vm.startBroadcast();

        CpiInsurance insurance = CpiInsurance(insuranceAddr);
        MockUSDC usdc = MockUSDC(address(insurance.usdc()));

        uint256 balBefore = usdc.balanceOf(msg.sender);
        insurance.withdraw(periodId);
        uint256 amount = usdc.balanceOf(msg.sender) - balBefore;

        vm.stopBroadcast();

        console.log("LP_WITHDREW", amount);
    }
}
