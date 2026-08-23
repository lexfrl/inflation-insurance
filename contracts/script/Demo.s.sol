// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {InflationHedge} from "../src/InflationHedge.sol";
import {MockUSDT} from "../src/MockUSDT.sol";
import {MockYieldVault} from "../src/MockYieldVault.sol";

/// @notice Three-phase end-to-end lifecycle demo, driven by REAL elapsed
///         time rather than `vm.warp`.
///
/// @dev `vm.warp` only affects Foundry's local simulation of a script -- it
///      does not, and cannot, change a real chain's clock (anvil included:
///      Foundry validates every script against a real broadcast-equivalent
///      replay even in dry-run mode, and that replay ignores warps). A
///      single script that warps past `saleEnd`/`periodEnd`/the claim window
///      internally can never actually be broadcast, on any chain. So this
///      demo is split into three real transactions, meant to be run minutes
///      apart (see script/demo.sh, which sleeps the right amount for local
///      anvil). The same three functions work unmodified against Base
///      Sepolia -- just wait for real time to pass between phases there too.
///
///      `claimDeadline` is derived by the contract at `postSettlement` time
///      (settlement timestamp + `claimWindowSecs`), not fixed at period
///      creation -- see `InflationHedge.postSettlement` NatSpec. So phase 1
///      only knows the claim *window length*; the actual deadline is read
///      back and printed by phase 2, after settlement posts.
///
/// Usage:
///   see script/demo.sh for the fully orchestrated local-anvil run.
contract Demo is Script {
    uint256 internal constant SALE_WINDOW = 30 seconds;
    // Wide enough that the invest phase gets a comfortable window between
    // `saleEnd` and `periodEnd` rather than a 15-second scramble: idle capital
    // can only be deployed once underwriting has closed and before settlement.
    uint256 internal constant PERIOD_WINDOW = 75 seconds; // must be > SALE_WINDOW
    uint256 internal constant CLAIM_WINDOW = 180 seconds; // claim window length after settlement

    /// Phase 1: deploy, create period, LP deposits, buyer buys a policy.
    /// Prints USDT_ADDRESS / INSURANCE_ADDRESS / PERIOD_ID / POLICY_ID lines
    /// for script/demo.sh to parse and feed into phases 2 and 3.
    function deployAndOpen() external {
        vm.startBroadcast();

        MockUSDT usdt = new MockUSDT();
        InflationHedge insurance = new InflationHedge(IERC20(address(usdt)));
        // Order matters -- see Deploy.s.sol. The vault is deployed last so the
        // insurance contract keeps its deterministic anvil address.
        MockYieldVault yieldVault = new MockYieldVault(IERC20(address(usdt)));
        insurance.setVault(IERC4626(address(yieldVault)));

        usdt.mint(msg.sender, 1_000_000e6);
        usdt.approve(address(insurance), type(uint256).max);

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

        InflationHedge.CreatePeriodParams memory p = InflationHedge.CreatePeriodParams({
            label: "DEMO: Argentina CPI",
            capBps: 800,
            saleEnd: block.timestamp + SALE_WINDOW,
            periodEnd: block.timestamp + PERIOD_WINDOW,
            claimWindowSecs: CLAIM_WINDOW,
            loadBps: 12_000,
            cpiBucketsBps: buckets,
            probBps: probs
        });
        uint256 periodId = insurance.createPeriod(p);
        insurance.deposit(periodId, 1_000e6);

        (uint256 premium, uint256 maxPayout) = insurance.quote(periodId, 1_000e6, 300);
        uint256 policyId = insurance.buyPolicy(periodId, 1_000e6, 300);

        vm.stopBroadcast();

        console.log("USDT_ADDRESS", address(usdt));
        console.log("INSURANCE_ADDRESS", address(insurance));
        console.log("VAULT_ADDRESS", address(yieldVault));
        console.log("PERIOD_ID", periodId);
        console.log("POLICY_ID", policyId);
        console.log("QUOTE_PREMIUM", premium);
        console.log("QUOTE_MAX_PAYOUT", maxPayout);
        console.log("SALE_END_UNIX", block.timestamp + SALE_WINDOW);
        console.log("PERIOD_END_UNIX", block.timestamp + PERIOD_WINDOW);
    }

    /// Phase 1b: run once real time has passed `saleEnd` but before
    /// `periodEnd`. Deploys the period's unsold capacity into the yield vault
    /// and simulates a period's worth of accrual so the demo has something
    /// visible to show. `investIdle` is permissionless -- this is broadcast as
    /// the deployer only because that is the key the script already holds.
    function investPhase(address insuranceAddr, uint256 periodId, uint256 simulatedYield) external {
        vm.startBroadcast();

        InflationHedge insurance = InflationHedge(insuranceAddr);
        (uint256 assets,) = insurance.investIdle(periodId);

        MockYieldVault yieldVault = MockYieldVault(address(insurance.vault()));
        if (simulatedYield > 0) {
            yieldVault.accrueYield(simulatedYield);
        }

        uint256 value = insurance.vaultValue(periodId);

        vm.stopBroadcast();

        console.log("INVESTED_ASSETS", assets);
        console.log("VAULT_VALUE_AFTER_YIELD", value);
    }

    /// Phase 2b: unwinds the vault position back into the pool. Separate from
    /// settlement on purpose -- a vault that cannot redeem right now must
    /// never be able to block the claim window from opening.
    function divestPhase(address insuranceAddr, uint256 periodId) external {
        vm.startBroadcast();

        InflationHedge insurance = InflationHedge(insuranceAddr);
        insurance.divest(periodId, insurance.getPeriod(periodId).vaultShares);

        InflationHedge.Period memory period = insurance.getPeriod(periodId);

        vm.stopBroadcast();

        console.log("VAULT_PRINCIPAL", period.vaultPrincipal);
        console.log("VAULT_PROCEEDS", period.vaultProceeds);
        console.log("VAULT_YIELD", period.vaultProceeds - period.vaultPrincipal);
    }

    /// Phase 2: run once real time has passed `periodEnd`. Owner posts the
    /// CPI settlement (which derives and opens the claim window), buyer
    /// claims. Prints CLAIM_DEADLINE_UNIX now that it's actually known.
    function settle(address insuranceAddr, uint256 periodId, uint256 policyId, uint256 cpiBps) external {
        vm.startBroadcast();

        InflationHedge insurance = InflationHedge(insuranceAddr);
        insurance.postSettlement(periodId, cpiBps);
        uint256 claimDeadline = insurance.getPeriod(periodId).claimDeadline;

        MockUSDT usdt = MockUSDT(address(insurance.usdt()));
        uint256 balBefore = usdt.balanceOf(msg.sender);
        insurance.claim(policyId);
        uint256 payout = usdt.balanceOf(msg.sender) - balBefore;

        vm.stopBroadcast();

        console.log("SETTLED_CPI_BPS", cpiBps);
        console.log("CLAIM_PAYOUT", payout);
        console.log("CLAIM_DEADLINE_UNIX", claimDeadline);
    }

    /// Creates an additional period on an ALREADY-DEPLOYED InflationHedge
    /// with caller-supplied window lengths, instead of the hardcoded
    /// 30/45/180s used by `deployAndOpen`. Use this for a period a human
    /// clicks through live in the frontend -- e.g. 900/1200/3600 seconds --
    /// since a real wallet-connect + approve + buy flow cannot fit inside 30
    /// seconds. Does NOT deposit or buy anything; drive those from the UI.
    function createPeriodOnly(
        address insuranceAddr,
        string calldata label,
        uint256 saleSecs,
        uint256 periodSecs,
        uint256 claimWindowSecs
    ) external returns (uint256 periodId) {
        require(periodSecs > saleSecs, "periodSecs must exceed saleSecs");
        require(claimWindowSecs > 0, "claimWindowSecs must be > 0");

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

        InflationHedge insurance = InflationHedge(insuranceAddr);
        InflationHedge.CreatePeriodParams memory p = InflationHedge.CreatePeriodParams({
            label: label,
            capBps: 800,
            saleEnd: block.timestamp + saleSecs,
            periodEnd: block.timestamp + periodSecs,
            claimWindowSecs: claimWindowSecs,
            loadBps: 12_000,
            cpiBucketsBps: buckets,
            probBps: probs
        });
        periodId = insurance.createPeriod(p);

        vm.stopBroadcast();

        console.log("PERIOD_ID", periodId);
        console.log("PERIOD_END_UNIX", block.timestamp + periodSecs);
    }

    /// Phase 3: run once real time has passed the claim deadline printed by
    /// `settle`. LP withdraws its share of what's left in the pool.
    function withdrawPhase(address insuranceAddr, uint256 periodId) external {
        vm.startBroadcast();

        InflationHedge insurance = InflationHedge(insuranceAddr);
        MockUSDT usdt = MockUSDT(address(insurance.usdt()));

        uint256 balBefore = usdt.balanceOf(msg.sender);
        insurance.withdraw(periodId);
        uint256 amount = usdt.balanceOf(msg.sender) - balBefore;

        vm.stopBroadcast();

        console.log("LP_WITHDREW", amount);
    }
}
