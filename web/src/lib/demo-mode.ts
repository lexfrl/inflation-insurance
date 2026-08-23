"use client";

import { foundry } from "wagmi/chains";
import { activeChain, contractAddresses, isLocalDev } from "./wagmi";

/// Anvil's deterministic contract addresses for a *fresh* local anvil run
/// through `forge script Deploy.s.sol` (deployer = account 0, starting at
/// nonce 0) -- matches `.env.local`. A constant is honest here because that
/// determinism is exactly why local dev never had to configure these.
const LOCAL_CONTRACT_ADDRESSES = {
  usdt: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  insurance: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
} as const;

/// The chain id / contract addresses the app should read and write against.
/// Local dev (`pnpm dev` against a local `anvil`) always targets itself;
/// every other build -- Base Sepolia, or any future deploy -- always
/// targets its own real deployed contracts, unconditionally.
///
/// This used to also support an off-by-default "local demo mode" toggle
/// that retargeted a *deployed* build (e.g. the live Vercel frontend) at
/// local anvil, for demoing that frontend against contracts running on the
/// visitor's own machine. Removed: a stray click (or a stale flag left over
/// from someone else's browser) silently pointed the live production site
/// at `localhost:8545`, which then failed every contract read with "Can't
/// reach the network right now" -- indistinguishable from a genuinely
/// broken deploy to anyone who hit it. Not worth the risk for what it saved.
export function useDemoTarget() {
  return {
    chainId: isLocalDev ? foundry.id : activeChain.id,
    addresses: isLocalDev ? LOCAL_CONTRACT_ADDRESSES : contractAddresses,
  };
}
