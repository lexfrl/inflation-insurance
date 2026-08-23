import { getDefaultWallets } from "@rainbow-me/rainbowkit";
import { http, createConfig } from "wagmi";
import { baseSepolia, foundry } from "wagmi/chains";
import { mock } from "wagmi/connectors";

// `foundry` (wagmi/viem's built-in chain-id-31337 definition) covers local
// anvil. Base Sepolia is the real testnet target (see README). Both are
// registered so the same build can be pointed at either via
// NEXT_PUBLIC_CHAIN_ID without a rebuild.
export const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? foundry.id);
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? foundry.rpcUrls.default.http[0];

export const activeChain = chainId === baseSepolia.id ? baseSepolia : foundry;
export const isLocalDev = chainId === foundry.id;

/// Anvil's well-known default dev accounts (deterministic across every
/// anvil startup, unless a custom mnemonic is passed). Anvil holds these
/// privately and signs eth_sendTransaction/personal_sign for them itself
/// when asked -- no private key for these ever needs to exist in this
/// codebase. Account 0 is also the contract owner from `forge script
/// Deploy.s.sol` (msg.sender when broadcasting with anvil's default key).
export const LOCAL_TEST_ACCOUNTS = [
  { label: "Owner / Deployer", address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
  { label: "LP 1", address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
  { label: "LP 2", address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" },
  { label: "Buyer 1", address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" },
  { label: "Buyer 2", address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" },
] as const;

const { connectors: walletConnectors } = getDefaultWallets({
  appName: "Hedgy",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
});

// Registered on every build, including a Base Sepolia / production one --
// merely *registering* a connector does nothing by itself (nothing signs or
// sends until one is clicked), and `dev-wallet-panel.tsx` gates whether
// these are ever offered in the UI behind an explicit, off-by-default demo
// toggle (see `lib/demo-mode.ts`) so they never appear to a production
// visitor by accident. What makes these usable from *any* build, not just
// a local-anvil one, is `transports[foundry.id]` below: it always resolves
// to `http://127.0.0.1:8545` when the build doesn't target foundry, so a
// browser on a machine that also has `anvil` running locally can still
// reach it, regardless of where the page itself was served from.
const mockConnectors = LOCAL_TEST_ACCOUNTS.map((a) => mock({ accounts: [a.address as `0x${string}`] }));

export const config = createConfig({
  chains: [foundry, baseSepolia],
  transports: {
    [foundry.id]: http(chainId === foundry.id ? rpcUrl : undefined),
    [baseSepolia.id]: http(chainId === baseSepolia.id ? rpcUrl : undefined),
  },
  connectors: [...walletConnectors, ...mockConnectors],
  ssr: true,
});

export const contractAddresses = {
  usdt: process.env.NEXT_PUBLIC_USDT_ADDRESS as `0x${string}`,
  insurance: process.env.NEXT_PUBLIC_INSURANCE_ADDRESS as `0x${string}`,
};
