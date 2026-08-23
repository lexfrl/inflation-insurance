"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Wordmark } from "@/components/logo";

/* Top bar geometry from the Figma node tree: the bar is 65 tall, the
   breadcrumb sits 32 in from the left edge, and the control cluster on the
   right is 40 tall -- so the bar is not vertically centred around a 60px box
   the way the previous pass assumed. */
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
    <header className="sticky top-0 z-30 flex h-topbar items-center justify-between gap-4 border-b border-border bg-page/90 pl-8 pr-8 backdrop-blur">
      {/* The wordmark lives in the rail on desktop; below lg the rail is gone,
          so it comes back here rather than leaving the bar unbranded. */}
      <Link href="/" className="lg:hidden" aria-label="Hedgy home">
        <Wordmark />
      </Link>
      <h1 className="hidden text-sm text-text lg:block">{TITLES[pathname] ?? "Hedgy"}</h1>
      <div className="flex h-10 items-center">
        <ConnectButton showBalance={false} />
      </div>
    </header>
  );
}
