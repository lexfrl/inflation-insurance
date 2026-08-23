"use client";

import { useReadContract } from "wagmi";
import { inflationHedgeAbi } from "@/lib/generated";
import { useDemoTarget } from "@/lib/demo-mode";
import { formatBps, formatCountdown, formatUsdt } from "@/lib/format";
import { useNow } from "@/lib/useNow";

/* The metrics strip under the top bar, following the Truflation reference.
   Every figure is read from the live contract -- there is no decorative
   placeholder here, because a ticker of invented numbers is worse than no
   ticker at all. Renders nothing until a period exists, rather than showing
   an empty rail. */
export function Ticker() {
  const { chainId, addresses } = useDemoTarget();
  const now = useNow();

  const { data: periods } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "listPeriods",
    chainId,
    query: { refetchInterval: 8000 },
  });

  const period = periods?.[0] as
    | {
        capBps: bigint;
        saleEnd: bigint;
        totalCollateral: bigint;
        totalPremiums: bigint;
        totalMaxLiability: bigint;
        totalClaimed: bigint;
        cpiBucketsBps: readonly bigint[];
        probBps: readonly bigint[];
      }
    | undefined;

  if (!period) return null;

  const backing = period.totalCollateral + period.totalPremiums - period.totalClaimed;
  const saleLeft = Number(period.saleEnd) - now;

  const items: { label: string; value: string; note?: string; tone?: "accent" }[] = [
    { label: "Covers up to", value: formatBps(period.capBps) },
    { label: "Backing payouts", value: `${formatUsdt(backing, 0)} USDT`, tone: "accent" },
    { label: "Cover sold", value: `${formatUsdt(period.totalMaxLiability, 0)} USDT` },
    { label: "Buying closes", value: formatCountdown(saleLeft) },
    ...period.cpiBucketsBps.map((b, i) => ({
      label: `Inflation ${formatBps(b, 0)}`,
      value: formatBps(period.probBps[i] ?? 0n, 0),
      note: "chance",
    })),
  ];

  return (
    /* The strip scrolls rather than wraps, so the right edge is masked: a
       hard clip mid-word reads as a broken layout, a fade reads as "there is
       more this way". */
    <div
      className="flex h-ticker items-center gap-6 overflow-x-auto text-[13px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{
        maskImage: "linear-gradient(to right, #000 0, #000 calc(100% - 48px), transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to right, #000 0, #000 calc(100% - 48px), transparent 100%)",
      }}
    >
      {items.map((item) => (
        <div key={item.label} className="flex shrink-0 items-baseline gap-2">
          <span className="text-text-muted">{item.label}</span>
          <span
            className={`font-mono tnum ${item.tone === "accent" ? "text-accent" : "text-text"}`}
          >
            {item.value}
          </span>
          {item.note && <span className="text-text-dim">{item.note}</span>}
        </div>
      ))}
    </div>
  );
}
