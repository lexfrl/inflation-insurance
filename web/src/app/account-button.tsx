"use client";

import { useEffect, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useDisconnect } from "wagmi";

/* RainbowKit's stock account button opens its own modal (balance, copy
   address, disconnect) but has no concept of switching between accounts a
   wallet already has connected to this site -- wagmi tracks exactly one
   active account per connector, and there's no RPC method for a dapp to
   change that itself. The only way back into "pick an account" is asking
   the wallet to re-run its own connect-accounts flow via
   `wallet_requestPermissions`, which is what "Switch account" below does --
   the wallet still owns the picker UI, this just reopens it without the
   user having to find the extension icon themselves. Demo-account
   workflows (owner / LP / buyer, all one seed phrase in one wallet) are
   exactly the case this is for.
   Everything else -- connect, network switch, copy, disconnect -- still
   goes through RainbowKit via `ConnectButton.Custom`; only the connected
   account's own button/menu is custom here. */
export function AccountButton() {
  const { connector } = useAccount();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canSwitch, setCanSwitch] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const switchAccount = async () => {
    setOpen(false);
    try {
      const provider = (await connector?.getProvider()) as
        | { request: (args: { method: string; params: unknown[] }) => Promise<unknown> }
        | undefined;
      await provider?.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    } catch {
      // Either the wallet doesn't support wallet_requestPermissions (not
      // every connector does), or the user dismissed the picker without
      // changing anything -- either way there's nothing to recover from.
      setCanSwitch(false);
    }
  };

  return (
    <ConnectButton.Custom>
      {({ account, chain, openChainModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        if (!ready) {
          return (
            <div aria-hidden className="pointer-events-none select-none opacity-0">
              <ConnectButton />
            </div>
          );
        }

        if (!connected) {
          return <ConnectButton showBalance={false} />;
        }

        if (chain.unsupported) {
          return (
            <button
              onClick={openChainModal}
              className="rounded-control border border-signal-danger/50 bg-surface-850 px-4 py-2 text-sm font-medium text-signal-danger hover:bg-surface-800"
            >
              Wrong network
            </button>
          );
        }

        return (
          <div className="flex items-center gap-2">
            <button
              onClick={openChainModal}
              className="flex items-center gap-1.5 rounded-control border border-surface-600 bg-surface-850 px-3 py-2 text-sm text-content-100 hover:bg-surface-800"
            >
              {chain.hasIcon && chain.iconUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={chain.iconUrl} alt={chain.name ?? "Chain"} className="h-4 w-4 rounded-full" />
              )}
              {chain.name}
            </button>

            <div ref={menuRef} className="relative">
              <button
                onClick={() => setOpen((v) => !v)}
                className="rounded-control border border-surface-600 bg-surface-850 px-3 py-2 text-sm font-mono tnum text-content-100 hover:bg-surface-800"
              >
                {account.displayName}
              </button>

              {open && (
                <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-56 overflow-hidden rounded-card border border-surface-700 bg-surface-850 py-1 text-sm shadow-[var(--shadow-card)]">
                  <div className="border-b border-surface-700 px-3 py-2 font-mono text-xs tnum text-content-500">
                    {account.address}
                  </div>
                  {canSwitch && (
                    <button
                      onClick={switchAccount}
                      className="block w-full px-3 py-2 text-left text-content-100 hover:bg-surface-800"
                    >
                      Switch account
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(account.address);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="block w-full px-3 py-2 text-left text-content-100 hover:bg-surface-800"
                  >
                    {copied ? "Copied" : "Copy address"}
                  </button>
                  <button
                    onClick={() => {
                      setOpen(false);
                      disconnect();
                    }}
                    className="block w-full px-3 py-2 text-left text-signal-danger hover:bg-surface-800"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
