"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartLineUp, Coins, Gauge, ShieldCheck, SlidersHorizontal } from "@phosphor-icons/react";
import { Wordmark } from "@/components/logo";

/* Persistent left rail, following the Truflation reference. Every destination
   is visible whether or not a wallet is attached -- the pages themselves ask
   for a connection when they need one, which keeps the shell stable instead
   of having navigation appear and disappear under the user. */
const LINKS = [
  { href: "/", label: "How it works", Icon: ChartLineUp },
  { href: "/profile", label: "Dashboard", Icon: Gauge },
  { href: "/protect", label: "Buy cover", Icon: ShieldCheck },
  { href: "/earn", label: "Earn", Icon: Coins },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[228px] shrink-0 border-r border-surface-700 bg-surface-850 lg:flex lg:flex-col">
      <div className="flex h-[60px] items-center px-5">
        <Link href="/" aria-label="Hedgy home">
          <Wordmark />
        </Link>
      </div>

      <div className="px-3 pb-1 pt-2">
        <Link
          href="/protect"
          className="block rounded-control bg-accent-400 py-2 text-center text-sm font-medium text-white transition-colors [transition-duration:var(--dur-fast)] hover:bg-accent-300"
        >
          Buy cover
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-3">
        {LINKS.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-control px-3 py-2 text-sm transition-colors [transition-duration:var(--dur-fast)] ${
                active
                  ? "bg-surface-800 font-medium text-content-100"
                  : "text-content-300 hover:bg-surface-800 hover:text-content-100"
              }`}
            >
              <Icon size={18} weight={active ? "fill" : "regular"} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-surface-700 px-3 py-3">
        <Link
          href="/admin"
          className="flex items-center gap-3 rounded-control px-3 py-2 text-sm text-content-500 transition-colors hover:bg-surface-800 hover:text-content-100"
        >
          <SlidersHorizontal size={18} />
          Operator
        </Link>
      </div>
    </aside>
  );
}

/* Small screens get the same destinations as a scrollable row instead of a
   rail, so the shell does not simply vanish below the lg breakpoint. */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-surface-700 bg-surface-850 px-4 py-2 lg:hidden">
      {LINKS.map(({ href, label, Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-control px-3 py-1.5 text-sm ${
              active ? "bg-surface-800 font-medium text-content-100" : "text-content-300"
            }`}
          >
            <Icon size={16} weight={active ? "fill" : "regular"} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
