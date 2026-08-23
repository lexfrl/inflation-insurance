"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartLineUp, Coins, Gauge, ShieldCheck, SlidersHorizontal } from "@phosphor-icons/react";
import { Wordmark } from "@/components/logo";

/* Persistent left rail. Every measurement here is read off the Figma node
   tree rather than eyeballed, which is what the previous pass got wrong:
     rail          220 wide
     logo block     64 tall, 20px side padding
     nav gutter     12px (px-3), first item 8px below the logo block
     nav item      195 x 36, stacked on a 38px pitch (36 + 2 gap)
     footer block  separated by a 1px rule, same 195 x 36 items
   Every destination stays visible whether or not a wallet is attached -- the
   pages themselves ask for a connection when they need one, which keeps the
   shell from reflowing under the user. */
const LINKS = [
  { href: "/", label: "How it works", Icon: ChartLineUp },
  { href: "/profile", label: "Dashboard", Icon: Gauge },
  { href: "/protect", label: "Buy cover", Icon: ShieldCheck },
  { href: "/earn", label: "Earn", Icon: Coins },
] as const;

const itemBase =
  "group relative flex h-9 w-[195px] items-center gap-3 rounded-control pl-3 pr-2 text-[13px] transition-colors [transition-duration:var(--dur-fast)]";

/* The active rail item gets a 2px amber bar in the gutter rather than a louder
   fill: on a dark ground a filled row already reads as selected, and the bar is
   what makes it scannable at a glance without shouting. */
function RailItem({
  href,
  label,
  Icon,
  active,
  muted = false,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; weight?: "fill" | "regular" }>;
  active: boolean;
  muted?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`${itemBase} ${
        active
          ? "bg-surface-2 font-medium text-ink"
          : `${muted ? "text-dim" : "text-muted"} hover:bg-surface-2 hover:text-ink`
      }`}
    >
      <span
        aria-hidden
        className={`absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent transition-opacity ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />
      <Icon size={18} weight={active ? "fill" : "regular"} />
      {label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-rail shrink-0 overflow-y-auto border-r border-line bg-page lg:flex lg:flex-col">
      <div className="flex h-16 items-center px-5">
        <Link href="/" aria-label="Hedgy home">
          <Wordmark />
        </Link>
      </div>

      <div className="px-3 pt-2">
        <Link
          href="/protect"
          className="flex h-9 w-[195px] items-center justify-center rounded-control bg-accent text-[13px] font-semibold text-on-accent transition-colors [transition-duration:var(--dur-fast)] hover:bg-accent-hover"
        >
          Buy cover
        </Link>
      </div>

      {/* gap-[2px] is the macket's 38px pitch expressed as 36 + 2. */}
      <nav className="flex flex-1 flex-col gap-[2px] px-3 pt-3">
        <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">
          Menu
        </p>
        {LINKS.map(({ href, label, Icon }) => (
          <RailItem key={href} href={href} label={label} Icon={Icon} active={pathname === href} />
        ))}
      </nav>

      <div className="border-t border-line px-3 py-3">
        <RailItem
          href="/admin"
          label="Operator"
          Icon={SlidersHorizontal}
          active={pathname === "/admin"}
          muted
        />
        {/* Anyone opening this on a laptop should be able to tell at a glance
            that it is pointed at a local chain, not at anything with money on it. */}
        <p className="mt-2 flex items-center gap-2 px-3 text-[10px] text-dim">
          <span className="size-1.5 rounded-full bg-up-400" />
          Demo network
        </p>
      </div>
    </aside>
  );
}

/* Small screens get the same destinations as a scrollable row instead of a
   rail, so the shell does not simply vanish below the lg breakpoint. */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line bg-page px-4 py-2 lg:hidden">
      {LINKS.map(({ href, label, Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-control px-3 py-1.5 text-[13px] ${
              active ? "bg-surface-2 font-medium text-ink" : "text-muted"
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
