"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Wordmark } from "@/components/logo";

/* "Admin" is an operator surface, not a product tab, so it sits visually
   apart from the two links a real user cares about instead of reading as a
   third equal destination. */
const links = [
  { href: "/", label: "Protect" },
  { href: "/lp", label: "Earn" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-900/85 backdrop-blur">
      <div className="mx-auto flex h-[68px] max-w-4xl items-center justify-between gap-6 px-6">
        <div className="flex items-center gap-7">
          <Link href="/" aria-label="Hedgy home">
            <Wordmark />
          </Link>
          <nav className="flex items-center gap-1">
            {links.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-control px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-ink-800 text-paper-100"
                      : "text-paper-500 hover:text-paper-100"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
            <Link
              href="/admin"
              className="ml-2 hidden text-xs text-paper-600 transition-colors hover:text-paper-300 sm:block"
            >
              Admin
            </Link>
          </nav>
        </div>
        <ConnectButton showBalance={false} />
      </div>
    </header>
  );
}
