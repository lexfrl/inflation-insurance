"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUp, ArrowUpRight, ChartPieSlice } from "@phosphor-icons/react";
import { useReadContract } from "wagmi";
import { inflationHedgeAbi } from "@/lib/generated";
import { useDemoTarget } from "@/lib/demo-mode";
import { formatBps, formatCountdown, formatUsdt } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { Card } from "@/components/ui";
import { Gauge, Sparkline, payoutCurve, premiumCurve } from "@/components/spark";
import {
  DataStreams,
  EconomicCalendar,
  IndexVsOfficial,
  InflationHeatmap,
  MarketSummary,
  Reports,
  TopIndexes,
  TopMovers,
  TrendingPair,
  Watchlist,
  Section,
  Surface,
} from "@/components/dashboard-blocks";

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
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1096px)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <HeroPrompt />
        {period ? <MetricRow period={period} now={now} /> : <MetricSkeleton />}
        {period && <SummaryBlock period={period} />}
        {/* Everything below is the reference layout's block set, running on
            demo data -- see lib/demo-data.ts. The blocks above this line read
            the contract; these do not, and the two are kept apart on purpose. */}
        <MarketSummary />
        <div className="grid gap-4 lg:grid-cols-2">
          <InflationHeatmap />
          <IndexVsOfficial />
        </div>
        <TopIndexes />
        <TrendingPair />
        <DataStreams />
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
    /* The panel is a video ground with the gradient kept on top as a scrim:
       the clip is high-contrast ASCII, so white text sitting straight on it
       would flicker as frames change. The scrim holds the contrast steady and
       the copy never has to fight the footage.

       `poster` means the first paint is the still rather than a black box, and
       the clip is muted + playsInline so mobile browsers will start it at all.
       Under prefers-reduced-motion the video is hidden and the poster shows
       through, which keeps the one motion rule this product already follows. */
    <section
      className="relative isolate overflow-hidden rounded-[28px] px-5 py-10 text-center sm:px-10 sm:py-14"
      style={{ backgroundColor: "var(--color-tf-900)" }}
    >
      <video
        className="motion-reduce:hidden absolute inset-0 -z-20 size-full object-cover"
        src="/hero-ascii.mp4"
        poster="/hero-ascii.jpg"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        /* A flat neutral scrim, not the warm gradient: the amber wash read as a
           glow over the footage. This still holds the contrast steady under the
           heading -- the clip is high-contrast ASCII and white text sitting
           straight on it flickers as frames change -- but adds no colour. */
        style={{ backgroundColor: "color-mix(in srgb, var(--color-page) 66%, transparent)" }}
      />
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
          className="shrink-0 rounded-control bg-accent-400 p-2.5 text-on-accent transition-colors hover:bg-accent-300"
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
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[160px] animate-pulse rounded-[12px] bg-tn-150" />
      ))}
    </div>
  );
}

/* The metric row follows the reference's three tile variants rather than one
   generic card:
     Component 8  (1:5362) label + 28/28 figure + white chip + 32-tall spark
     Component 9  (1:5486) title/sub, then a centred eyebrow, figure and CTA
     Component 10 (1:5510) title/sub with a View pill, a 144x79 half-ring, and
                          a two-column legend split by a tn/250 rule
   All three share the same shell: tn/150 ground, 12 radius, 12 padding, a
   12/16 Semi Bold title and a 12/12 regular sub in tn/500. */
const TILE = "flex h-[160px] flex-col rounded-[12px] bg-tn-150 p-3";

function TileHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex w-full items-start justify-between gap-2">
      <div className="flex flex-col gap-[3px]">
        <span className="text-[12px] font-semibold leading-4 text-tn-800">{title}</span>
        {sub && <span className="text-[12px] leading-3 text-tn-500">{sub}</span>}
      </div>
      {action ?? (
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-3 text-tn-600">
          <ArrowUpRight size={12} />
        </span>
      )}
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
  const usedLabel = used > 0 && used * 100 < 1 ? "<1%" : `${(used * 100).toFixed(0)}%`;

  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {/* Component 8 */}
      <div className={`${TILE} justify-between`}>
        <TileHead title="Cover 1,000 above 3%" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[28px] font-semibold leading-7 text-tn-800 tnum">
            {costNow.toFixed(2)}
          </span>
          <span className="rounded-[12px] bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold leading-[15px] text-tn-500">
            USDT
          </span>
        </div>
        <Sparkline points={costCurve} w={238} h={32} className="h-8 w-full" />
      </div>

      {/* Component 8 */}
      <div className={`${TILE} justify-between`}>
        <TileHead title="Biggest payout" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[28px] font-semibold leading-7 text-up-500 tnum">
            {maxPay.toFixed(2)}
          </span>
          <span className="rounded-[12px] bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold leading-[15px] text-tn-500">
            USDT
          </span>
        </div>
        <Sparkline points={payCurve} tone="positive" w={238} h={32} className="h-8 w-full" />
      </div>

      {/* Component 10 */}
      <div className={TILE}>
        <TileHead
          title="Pool committed"
          sub={`of ${formatUsdt(backing, 0)} USDT`}
          action={
            <Link
              href="/earn"
              className="flex shrink-0 items-center gap-1 rounded-full bg-surface-3 px-3 py-1.5 text-[11px] font-semibold leading-[11px] text-tn-800"
            >
              View
              <ArrowUpRight size={12} />
            </Link>
          }
        />
        <Gauge value={used}>
          <span className="text-[10px] font-semibold uppercase leading-3 tracking-[0.8px] text-tn-500">
            Committed
          </span>
          <span className="mt-1 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold leading-[15.95px] text-tn-800 tnum">
            {usedLabel}
          </span>
        </Gauge>
        <div className="mt-auto flex">
          <div className="flex flex-1 flex-col items-center gap-[3px] px-1">
            <div className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-tf-500" />
              <span className="text-[10px] font-semibold uppercase leading-3 tracking-[0.4px] text-tn-500">
                Sold
              </span>
            </div>
            <span className="text-[13px] font-semibold leading-4 text-tn-800 tnum">
              {formatUsdt(period.totalMaxLiability, 0)}
            </span>
          </div>
          <div className="flex flex-1 flex-col items-center gap-[3px] border-l border-tn-250 px-1">
            <div className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-tn-800" />
              <span className="text-[10px] font-semibold uppercase leading-3 tracking-[0.4px] text-tn-500">
                Backing
              </span>
            </div>
            <span className="text-[13px] font-semibold leading-4 text-tn-800 tnum">
              {formatUsdt(backing, 0)}
            </span>
          </div>
        </div>
      </div>

      {/* Component 9 */}
      <div className={TILE}>
        <TileHead title="Buying closes in" sub={period.label} />
        <div className="flex flex-1 flex-col items-center justify-center">
          <span className="text-[10px] font-semibold uppercase leading-3 tracking-[0.8px] text-tn-500">
            Sale closes in
          </span>
          <div className="flex items-baseline gap-1 pt-1">
            <span className="text-[28px] font-semibold leading-8 text-tn-800 tnum">
              {formatCountdown(Number(period.saleEnd) - now)}
            </span>
          </div>
          <div className="pt-2">
            <Link
              href="/protect"
              className="inline-block rounded-full bg-accent px-4 py-2 text-[12px] font-semibold leading-4 text-on-accent"
            >
              Buy cover
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/* These two blocks have no counterpart in the macket -- they are Hedgy's own
   -- so they borrow its card language instead of inventing one: the section
   title sits above a white card on a tn/200 hairline, 16 padding, and the
   inner type runs the same 14/20, 12/16 and 11/16.5 steps as the reference
   blocks. Previously they were grey panels with the heading inside, which is
   why they read as a different product from everything around them. */
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
      <Section title="Where inflation is expected to land">
        <Surface className="p-4">
          <div className="grid grid-cols-2 gap-2">
            {buckets.map((b, i) => {
              const prob = probs[i] ?? 0;
              const intensity = prob / maxProb;
              return (
                <div
                  key={b}
                  className="rounded-[12px] p-3"
                  style={{
                    // Opacity carries the probability, so the tile is a reading
                    // of the histogram rather than an arbitrary colour choice.
                    background: `color-mix(in srgb, var(--color-tf-500) ${(intensity * 14).toFixed(0)}%, var(--color-tn-150))`,
                  }}
                >
                  <div className="text-[20px] font-semibold leading-7 text-tn-800 tnum">
                    {formatBps(b, 0)}
                  </div>
                  <div className="mt-0.5 text-[12px] leading-4 text-tn-500 tnum">
                    {formatBps(prob, 0)} chance
                  </div>
                  <div className="mt-1 text-[11px] leading-[16.5px] text-tn-500">
                    Pays{" "}
                    <span className="tnum">
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
          <p className="mt-3 text-[12px] leading-4 text-tn-500">
            Payouts shown for 1,000 USDT covered above 3%.
          </p>
        </Surface>
      </Section>

      <Section title="What cover costs at each level">
        <Surface className="p-4">
          <div className="grid grid-cols-3 gap-2 text-[11px] uppercase tracking-[0.06em] text-tn-500">
            <span>Cover above</span>
            <span className="text-right">Costs</span>
            <span className="text-right">Pays up to</span>
          </div>
          {strikes.map((st) => (
            <div
              key={st}
              className="grid h-[45px] grid-cols-3 items-center gap-2 border-b border-tn-200 text-[14px] last:border-b-0"
            >
              <span className="font-semibold text-tn-800 tnum">{formatBps(st)}</span>
              <span className="text-right text-tn-800 tnum">{costAt(st).toFixed(2)}</span>
              <span className="text-right font-semibold text-accent tnum">
                {(((capBps - st) * SAMPLE_NOTIONAL) / 10_000).toFixed(2)}
              </span>
            </div>
          ))}
          <p className="mt-3 text-[12px] leading-4 text-tn-500">
            Priced the way the contract prices it: expected payout across the outcomes above, times
            a {(loadBps / 10_000).toFixed(2)}x load.
          </p>
        </Surface>
      </Section>
    </div>
  );
}

function RightRail({ periods, now }: { periods: Period[]; now: number }) {
  const period = periods[0];

  return (
    <aside className="flex flex-col gap-6">
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
          className="mt-4 block rounded-control bg-accent-400 py-2 text-center text-sm font-medium text-on-accent transition-colors hover:bg-accent-300"
        >
          Buy cover
        </Link>
      </Card>

      {/* Demo-data rail blocks, matching the reference's 320-wide column. */}
      <Watchlist />
      <Reports />
      <TopMovers />
      <EconomicCalendar />
    </aside>
  );
}
