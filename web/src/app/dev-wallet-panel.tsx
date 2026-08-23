"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { LOCAL_TEST_ACCOUNTS, isLocalDev } from "@/lib/wagmi";
import { setDemoModeEnabled, useDemoModeEnabled } from "@/lib/demo-mode";

/// Lets you sign transactions as any of anvil's pre-funded default accounts
/// without a browser wallet extension -- these are wagmi `mock` connectors:
/// unhandled RPC methods (eth_sendTransaction, personal_sign) get forwarded
/// straight to anvil, which signs for its own default accounts itself. No
/// private key ever exists in this codebase.
///
/// - On local anvil, this always shows.
/// - Everywhere else (Base Sepolia / production), it's hidden behind an
///   explicit, off-by-default "demo mode" toggle (see lib/demo-mode.ts).
///   Switching it on doesn't just reveal these pills -- it also retargets
///   every page's reads/writes to local anvil (useDemoTarget), since these
///   accounts can only ever be anvil accounts. The intended setup: the
///   deployed production frontend, opened in a browser on a machine that
///   also has `anvil` + the contracts running locally.
export function DevWalletPanel() {
  const { address, isConnected, status } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const demoModeEnabled = useDemoModeEnabled();
  // Collapsed by default: this is developer plumbing, and a loud amber band
  // across the top of every screen is the first thing a demo audience sees.
  const [open, setOpen] = useState(false);

  const toggleDemoMode = (enabled: boolean) => {
    // A wallet connected under the old target (e.g. a real wallet on Base
    // Sepolia, or these same pills already connected to anvil) would
    // otherwise keep issuing reads/writes against whatever chain/addresses
    // it connected under while useDemoTarget's chainId/addresses flip out
    // from under it -- disconnect so the next connect starts clean.
    disconnect();
    setDemoModeEnabled(enabled);
  };

  const showPanel = isLocalDev || demoModeEnabled;

  if (!showPanel) {
    return (
      <div className="border-b border-surface-700 px-5 py-1.5">
        <div className="mx-auto flex max-w-6xl justify-end">
          <button
            onClick={() => toggleDemoMode(true)}
            className="text-[11px] text-content-600 hover:text-content-300"
          >
            Enable local demo mode
          </button>
        </div>
      </div>
    );
  }

  const mockConnectors = connectors.filter((c) => c.type === "mock");
  if (mockConnectors.length === 0) return null;

  // WagmiProvider auto-reconnects on mount by default (needed so a real
  // wallet like MetaMask stays connected across reloads) -- it fires a
  // background `reconnect()` for every page load, racing a manual click
  // on one of these pills right after navigation. The two connect calls
  // fight over the same connector state, and the click routinely loses:
  // it visibly does nothing, and a second click is needed once the
  // reconnect settles. Since these are ephemeral anvil dev accounts with
  // nothing worth restoring, just wait out the reconnect instead of racing
  // it.
  const reconnecting = status === "reconnecting";

  if (!open) {
    return (
      <div className="border-b border-surface-700 bg-surface-900 px-5 py-1.5">
        <div className="mx-auto flex max-w-6xl justify-end">
          <button
            onClick={() => setOpen(true)}
            className="text-[11px] text-content-600 transition-colors hover:text-content-300"
          >
            Dev wallets{reconnecting ? " (reconnecting)" : ""}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-surface-700 bg-surface-800 px-5 py-2">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-content-500">
          {isLocalDev ? "Local test wallets (anvil only)" : "Demo mode: local anvil test wallets"}
          {reconnecting && " (reconnecting...)"}:
        </span>
        {LOCAL_TEST_ACCOUNTS.map((account, i) => {
          const connector = mockConnectors[i];
          const isActive = isConnected && address?.toLowerCase() === account.address.toLowerCase();
          if (!connector) return null;
          return (
            <button
              key={account.address}
              disabled={isPending || isActive || reconnecting}
              onClick={() => connect({ connector })}
              className={`rounded-full px-3 py-1 ${
                isActive ? "bg-accent-400 text-surface-950" : "bg-surface-850 text-content-300 hover:bg-surface-700"
              }`}
            >
              {account.label}
            </button>
          );
        })}
        {isConnected && (
          <button onClick={() => disconnect()} className="rounded-full bg-surface-850 px-3 py-1 text-content-300 hover:bg-surface-700">
            Disconnect
          </button>
        )}
        <button
          onClick={() => setOpen(false)}
          className="ml-auto rounded-full px-3 py-1 text-content-500 hover:text-content-100"
        >
          Hide
        </button>
        {!isLocalDev && (
          <button
            onClick={() => toggleDemoMode(false)}
            className="rounded-full px-3 py-1 text-content-500 hover:text-content-100"
          >
            Exit demo mode
          </button>
        )}
      </div>
    </div>
  );
}
