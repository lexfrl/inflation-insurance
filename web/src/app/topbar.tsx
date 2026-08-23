"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Wordmark } from "@/components/logo";

const TITLES: Record<string, string> = {
  "/": "How it works",
  "/profile": "Dashboard",
  "/protect": "Buy cover",
  "/earn": "Earn",
  "/admin": "Operator",
};

export function Topbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 flex h-[60px] items-center justify-between gap-4 border-b border-surface-700 bg-surface-850/90 px-5 backdrop-blur">
      {/* The wordmark lives in the rail on desktop; below lg the rail is gone,
          so it comes back here rather than leaving the bar unbranded. */}
      <Link href="/" className="lg:hidden" aria-label="Hedgy home">
        <Wordmark />
      </Link>
      <h1 className="hidden text-sm font-medium text-content-300 lg:block">
        {TITLES[pathname] ?? "Hedgy"}
      </h1>
      <ConnectButton showBalance={false} />
    </header>
  );
}
