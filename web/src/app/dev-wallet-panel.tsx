"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { LOCAL_TEST_ACCOUNTS, isLocalDev } from "@/lib/wagmi";

/// Dev-only: lets you sign transactions as any of anvil's pre-funded default
/// accounts without a browser wallet extension. These are wagmi `mock`
/// connectors -- unhandled RPC methods (eth_sendTransaction, personal_sign)
/// get forwarded straight to anvil, which signs for its own default accounts
/// itself. No private key exists in this codebase or ever passes through it.
///
/// Renders nothing when NEXT_PUBLIC_CHAIN_ID isn't the local anvil chain, so
/// this can never appear in a Base Sepolia / production build.
export function DevWalletPanel() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (!isLocalDev) return null;

  const mockConnectors = connectors.filter((c) => c.type === "mock");
  if (mockConnectors.length === 0) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-2">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-amber-400">Local test wallets (anvil only):</span>
        {LOCAL_TEST_ACCOUNTS.map((account, i) => {
          const connector = mockConnectors[i];
          const isActive = isConnected && address?.toLowerCase() === account.address.toLowerCase();
          if (!connector) return null;
          return (
            <button
              key={account.address}
              disabled={isPending || isActive}
              onClick={() => connect({ connector })}
              className={`rounded-full px-3 py-1 ${
                isActive ? "bg-amber-500 text-black" : "bg-black/30 text-amber-200 hover:bg-black/50"
              }`}
            >
              {account.label}
            </button>
          );
        })}
        {isConnected && (
          <button onClick={() => disconnect()} className="rounded-full bg-black/30 px-3 py-1 text-amber-200 hover:bg-black/50">
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
