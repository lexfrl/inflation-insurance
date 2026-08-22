"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export function Nav() {
  return (
    <header className="border-b border-white/10">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            🛡️ Inflation Insurance
          </Link>
          <nav className="flex gap-4 text-sm text-white/70">
            <Link href="/" className="hover:text-white">
              Protect
            </Link>
            <Link href="/lp" className="hover:text-white">
              Provide Liquidity
            </Link>
            <Link href="/admin" className="hover:text-white">
              Admin
            </Link>
          </nav>
        </div>
        <ConnectButton showBalance={false} />
      </div>
    </header>
  );
}
