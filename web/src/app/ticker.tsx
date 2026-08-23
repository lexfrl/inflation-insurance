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
    <div className="flex items-center gap-6 overflow-x-auto border-b border-surface-700 bg-surface-850 px-5 py-2.5 text-[13px]">
      {items.map((item) => (
        <div key={item.label} className="flex shrink-0 items-baseline gap-2">
          <span className="text-content-500">{item.label}</span>
          <span
            className={`font-mono tnum ${item.tone === "accent" ? "text-accent-400" : "text-content-100"}`}
          >
            {item.value}
          </span>
          {item.note && <span className="text-content-600">{item.note}</span>}
        </div>
      ))}
    </div>
  );
}
