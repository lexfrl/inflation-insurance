"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUp } from "@phosphor-icons/react";
import { useReadContract } from "wagmi";
import { inflationHedgeAbi } from "@/lib/generated";
import { useDemoTarget } from "@/lib/demo-mode";
import { formatBps, formatCountdown, formatUsdt } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { Card } from "@/components/ui";
import { Gauge, Sparkline, payoutCurve, premiumCurve } from "@/components/spark";

/* The dashboard, laid out to match the reference: gradient prompt panel, a row
   of metric cards with inline charts, a summary block, and a right rail. Every
   number is read from the live contract or derived from it with the
   contract's own arithmetic. */

type Period = {
  label: string;
  capBps: bigint;
  saleEnd: bigint;
  periodEnd: bigint;
  loadBps: bigint;
  cpiBucketsBps: readonly bigint[];
  probBps: readonly bigint[];
  totalCollateral: bigint;
  totalPremiums: bigint;
  totalMaxLiability: bigint;
  totalClaimed: bigint;
  settled: boolean;
  settlementCpiBps: bigint;
};

const SAMPLE_NOTIONAL = 1000;
const SAMPLE_STRIKE = 300;

export default function DashboardPage() {
  const { chainId, addresses } = useDemoTarget();
  const now = useNow();

  const { data: periods } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "listPeriods",
    chainId,
    query: { refetchInterval: 6000 },
  });

  const period = periods?.[0] as Period | undefined;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-5">
        <HeroPrompt />
        {period ? <MetricRow period={period} now={now} /> : <MetricSkeleton />}
        {period && <SummaryBlock period={period} />}
      </div>
      <RightRail periods={(periods as Period[] | undefined) ?? []} now={now} />
    </div>
  );
}

/* The reference leads with a prompt box. Ours takes the one number the whole
   product turns on, so the panel is an actual entry point rather than
   decoration. */
function HeroPrompt() {
  const router = useRouter();
  const [spend, setSpend] = useState("1000");

  const go = (strike?: number) => {
    const q = new URLSearchParams({ spend });
    if (strike !== undefined) q.set("strike", String(strike));
    router.push(`/protect?${q.toString()}`);
  };

  return (
    <section
      className="rounded-card px-5 py-10 text-center sm:px-10 sm:py-14"
      style={{ background: "var(--gradient-hero)" }}
    >
      <h1 className="mx-auto max-w-[20ch] text-2xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
        What would inflation cost you this month?
      </h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
        className="mx-auto mt-7 flex max-w-xl items-center gap-2 rounded-card border border-white/15 bg-black/35 p-2 backdrop-blur"
      >
        <input
          value={spend}
          onChange={(e) => setSpend(e.target.value)}
          inputMode="numeric"
          aria-label="Monthly spending in USDT"
          className="w-full bg-transparent px-3 py-2.5 font-mono text-white tnum outline-none placeholder:text-white/40"
          placeholder="What you spend a month"
        />
        <span className="shrink-0 pr-1 text-xs text-white/50">USDT</span>
        <button
          type="submit"
          aria-label="See what cover costs"
          className="shrink-0 rounded-control bg-accent-400 p-2.5 text-white transition-colors hover:bg-accent-300"
        >
          <ArrowUp size={18} weight="bold" />
        </button>
      </form>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {[300, 400, 500].map((s) => (
          <button
            key={s}
            onClick={() => go(s)}
            className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-white/85 transition-colors hover:bg-white/20"
          >
            Cover me above {formatBps(s)}
          </button>
        ))}
      </div>
    </section>
  );
}

function MetricSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="h-[132px] animate-pulse" />
      ))}
    </div>
  );
}

function MetricRow({ period, now }: { period: Period; now: number }) {
  const capBps = Number(period.capBps);
  const buckets = period.cpiBucketsBps.map(Number);
  const probs = period.probBps.map(Number);
  const loadBps = Number(period.loadBps);

  const costCurve = useMemo(
    () => premiumCurve(buckets, probs, capBps, loadBps, SAMPLE_NOTIONAL),
    [buckets, probs, capBps, loadBps],
  );
  const payCurve = useMemo(
    () => payoutCurve(capBps, SAMPLE_STRIKE, SAMPLE_NOTIONAL),
    [capBps],
  );

  const costNow = costCurve.find((p) => p.x >= SAMPLE_STRIKE)?.y ?? 0;
  const maxPay = ((capBps - SAMPLE_STRIKE) * SAMPLE_NOTIONAL) / 10_000;
  const backing = period.totalCollateral + period.totalPremiums - period.totalClaimed;
  const used = backing > 0n ? Number(period.totalMaxLiability) / Number(backing) : 0;
  const expected =
    buckets.reduce((acc, b, i) => acc + ((probs[i] ?? 0) / 10_000) * b, 0) / 100;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card className="p-4">
        <div className="text-[11px] uppercase tracking-[0.06em] text-content-600">
          Cover 1,000 above 3%
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="font-mono text-2xl text-content-100 tnum">{costNow.toFixed(2)}</span>
          <span className="text-xs text-content-500">USDT</span>
        </div>
        <Sparkline points={costCurve} className="mt-3 h-9 w-full" />
        <div className="mt-1 text-[11px] text-content-600">Cost at every level</div>
      </Card>

      <Card className="p-4">
        <div className="text-[11px] uppercase tracking-[0.06em] text-content-600">
          Biggest payout
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="font-mono text-2xl text-signal-positive tnum">{maxPay.toFixed(2)}</span>
          <span className="text-xs text-content-500">USDT</span>
        </div>
        <Sparkline points={payCurve} tone="positive" className="mt-3 h-9 w-full" />
        <div className="mt-1 text-[11px] text-content-600">Payout as inflation rises</div>
      </Card>

      <Card className="p-4">
        <div className="text-[11px] uppercase tracking-[0.06em] text-content-600">
          Pool committed
        </div>
        <div className="mt-3">
          <Gauge value={used} label={`of ${formatUsdt(backing, 0)} USDT`} />
        </div>
        <div className="mt-2 text-[11px] text-content-600">
          Cover sold {formatUsdt(period.totalMaxLiability, 0)} USDT
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-[11px] uppercase tracking-[0.06em] text-content-600">
          Buying closes in
        </div>
        <div className="mt-1 font-mono text-2xl text-content-100 tnum">
          {formatCountdown(Number(period.saleEnd) - now)}
        </div>
        <div className="mt-3 border-t border-surface-700 pt-3 text-[11px] text-content-600">
          Expected inflation{" "}
          <span className="font-mono text-content-300 tnum">{expected.toFixed(2)}%</span>
        </div>
        <div className="mt-1 text-[11px] text-content-600">
          Period ends in{" "}
          <span className="font-mono text-content-300 tnum">
            {formatCountdown(Number(period.periodEnd) - now)}
          </span>
        </div>
      </Card>
    </div>
  );
}

/* The reference's heatmap plus comparison table, in one block. */
function SummaryBlock({ period }: { period: Period }) {
  const capBps = Number(period.capBps);
  const buckets = period.cpiBucketsBps.map(Number);
  const probs = period.probBps.map(Number);
  const loadBps = Number(period.loadBps);
  const maxProb = Math.max(...probs, 1);

  const strikes = [0, 200, 300, 400, 500];
  const curve = premiumCurve(buckets, probs, capBps, loadBps, SAMPLE_NOTIONAL, 400);
  const costAt = (s: number) => curve.find((p) => p.x >= s)?.y ?? 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="text-sm font-medium text-content-100">Where inflation is expected to land</h2>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {buckets.map((b, i) => {
            const p = probs[i] ?? 0;
            const intensity = p / maxProb;
            return (
              <div
                key={b}
                className="rounded-control border border-surface-700 p-4"
                style={{
                  // Opacity carries the probability, so the tile is a reading
                  // of the histogram rather than an arbitrary colour choice.
                  background: `color-mix(in srgb, var(--color-accent-400) ${(intensity * 26).toFixed(0)}%, transparent)`,
                }}
              >
                <div className="font-mono text-lg text-content-100 tnum">{formatBps(b, 0)}</div>
                <div className="mt-1 font-mono text-xs text-content-300 tnum">
                  {formatBps(p, 0)} chance
                </div>
                <div className="mt-2 text-[11px] text-content-600">
                  Pays{" "}
                  <span className="font-mono tnum">
                    {(
                      (Math.min(Math.max(b - SAMPLE_STRIKE, 0), capBps - SAMPLE_STRIKE) *
                        SAMPLE_NOTIONAL) /
                      10_000
                    ).toFixed(2)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-content-600">
          Payouts shown for 1,000 USDT covered above 3%.
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-medium text-content-100">What cover costs at each level</h2>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.06em] text-content-600">
              <th className="pb-2 text-left font-medium">Cover above</th>
              <th className="pb-2 text-right font-medium">Costs</th>
              <th className="pb-2 text-right font-medium">Pays up to</th>
            </tr>
          </thead>
          <tbody>
            {strikes.map((s) => (
              <tr key={s} className="border-t border-surface-700">
                <td className="py-2.5 font-mono text-content-100 tnum">{formatBps(s)}</td>
                <td className="py-2.5 text-right font-mono text-content-300 tnum">
                  {costAt(s).toFixed(2)}
                </td>
                <td className="py-2.5 text-right font-mono text-accent-300 tnum">
                  {(((capBps - s) * SAMPLE_NOTIONAL) / 10_000).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] leading-relaxed text-content-600">
          Priced the way the contract prices it: expected payout across the outcomes above, times
          a {(loadBps / 10_000).toFixed(2)}x load.
        </p>
      </Card>
    </div>
  );
}

function RightRail({ periods, now }: { periods: Period[]; now: number }) {
  const period = periods[0];

  return (
    <aside className="flex flex-col gap-5">
      <Card className="p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-content-100">Periods</h2>
          <Link href="/protect" className="text-xs text-accent-400 hover:text-accent-300">
            Open
          </Link>
        </div>
        {periods.length === 0 ? (
          <p className="text-xs text-content-600">No period is open yet.</p>
        ) : (
          <div className="flex flex-col">
            {periods.map((p, i) => {
              const open = now < Number(p.saleEnd);
              return (
                <div
                  key={i}
                  className={`flex items-center justify-between gap-3 py-2.5 ${
                    i > 0 ? "border-t border-surface-700" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-content-100">{p.label}</div>
                    <div className="text-[11px] text-content-600">
                      Covers to {formatBps(p.capBps)}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 font-mono text-xs tnum ${
                      open ? "text-signal-positive" : "text-content-500"
                    }`}
                  >
                    {open ? formatCountdown(Number(p.saleEnd) - now) : "closed"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {period && (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-medium text-content-100">Best outcomes for you</h2>
          <div className="flex flex-col">
            {[...period.cpiBucketsBps]
              .map((b, i) => ({
                cpi: Number(b),
                prob: Number(period.probBps[i] ?? 0),
                pay:
                  (Math.min(
                    Math.max(Number(b) - SAMPLE_STRIKE, 0),
                    Number(period.capBps) - SAMPLE_STRIKE,
                  ) *
                    SAMPLE_NOTIONAL) /
                  10_000,
              }))
              .sort((a, b) => b.pay - a.pay)
              .map((r, i) => (
                <div
                  key={r.cpi}
                  className={`flex items-center justify-between gap-3 py-2 ${
                    i > 0 ? "border-t border-surface-700" : ""
                  }`}
                >
                  <span className="text-xs text-content-600">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm text-content-100 tnum">
                      {formatBps(r.cpi, 0)}
                    </div>
                    <div className="text-[11px] text-content-600">
                      {formatBps(r.prob, 0)} chance
                    </div>
                  </div>
                  <span
                    className={`shrink-0 font-mono text-sm tnum ${
                      r.pay > 0 ? "text-signal-positive" : "text-content-500"
                    }`}
                  >
                    {r.pay > 0 ? "+" : ""}
                    {r.pay.toFixed(2)}
                  </span>
                </div>
              ))}
          </div>
          <p className="mt-3 text-[11px] text-content-600">For 1,000 covered above 3%.</p>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-medium text-content-100">How it works</h2>
        <ol className="flex flex-col gap-3 text-xs leading-relaxed text-content-300">
          <li>
            <span className="text-content-100">Say what you spend.</span> Your payout scales with
            it.
          </li>
          <li>
            <span className="text-content-100">Pick your level.</span> Inflation below it pays
            nothing.
          </li>
          <li>
            <span className="text-content-100">Get paid automatically</span> when the official
            figure is published.
          </li>
        </ol>
        <Link
          href="/protect"
          className="mt-4 block rounded-control bg-accent-400 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-accent-300"
        >
          Buy cover
        </Link>
      </Card>
    </aside>
  );
}
