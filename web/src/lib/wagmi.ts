import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "viem";
import { baseSepolia, foundry } from "wagmi/chains";

// `foundry` (wagmi/viem's built-in chain-id-31337 definition) covers local
// anvil. Base Sepolia is the real testnet target (see README). Both are
// registered so the same build can be pointed at either via
// NEXT_PUBLIC_CHAIN_ID without a rebuild.
export const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? foundry.id);
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? foundry.rpcUrls.default.http[0];

export const activeChain = chainId === baseSepolia.id ? baseSepolia : foundry;

export const config = getDefaultConfig({
  appName: "Inflation Insurance",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
  chains: [foundry, baseSepolia],
  transports: {
    [foundry.id]: http(chainId === foundry.id ? rpcUrl : undefined),
    [baseSepolia.id]: http(chainId === baseSepolia.id ? rpcUrl : undefined),
  },
  ssr: true,
});

export const contractAddresses = {
  usdc: process.env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}`,
  insurance: process.env.NEXT_PUBLIC_INSURANCE_ADDRESS as `0x${string}`,
};
