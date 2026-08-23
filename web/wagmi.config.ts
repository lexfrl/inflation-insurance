import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

// Generates typed React hooks straight from the Foundry build artifacts, so
// the frontend's ABI can never drift from what's actually deployed. Run
// `pnpm wagmi generate` after any contracts/src change + `forge build`.
export default defineConfig({
  out: "src/lib/generated.ts",
  plugins: [
    foundry({
      project: "../contracts",
      include: ["InflationHedge.sol/**", "MockUSDT.sol/**", "MockYieldVault.sol/**"],
    }),
  ],
});
