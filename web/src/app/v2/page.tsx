"use client";

import { useState } from "react";
import Link from "next/link";
import { useReadContract } from "wagmi";
import { inflationHedgeAbi } from "@/lib/generated";
import { useDemoTarget } from "@/lib/demo-mode";
import { formatBps, formatCountdown, formatUsdt, parseUsdt } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { cafeBasket } from "@/lib/demo-data";

/* The plain-language version of the product.
 *
 * The other page is a data terminal: watchlists, index tables, a payoff curve.
 * That shape serves someone who reads dozens of series a day. A shop owner
 * opens this once a month with one question -- "my costs went up, am I owed
 * anything?" -- so this page answers exactly three things in their words:
 * what it costs, what comes back, and when. Everything else is either folded
 * away or dropped.
 *
 * The visual system is unchanged. Simple is not the same as plain: the type
 * scale, the amber, the mono figures and the spacing all carry over. What
 * changes is the vocabulary and how much is on screen at once.
 *
 * Money still comes from the contract -- `quote()` for the price and the
 * ceiling, the period's own histogram for the outcomes. Only the basket lines
 * are illustrative (see lib/demo-data.ts).
 */

type Period = {
  label: string;
  capBps: bigint;
  saleEnd: bigint;
  cpiBucketsBps: readonly bigint[];
  probBps: readonly bigint[];
};

const LEVELS = [200, 300, 500] as const;
const SPEND_PRESETS = [500, 1000, 2500];

export default function SimplePage() {
  const { chainId, addresses } = useDemoTarget();
  const now = useNow();
  const [spend, setSpend] = useState("1000");
  const [level, setLevel] = useState<number>(300);

  const { data: periods } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "listPeriods",
    chainId,
    query: { refetchInterval: 8000 },
  });

  const period = (periods as Period[] | undefined)?.[0];
  const notional = parseUsdt(spend);

  const { data: quoteData } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "quote",
    args: [0n, notional, BigInt(level)],
    chainId,
    query: { enabled: !!period && notional > 0n },
  });
  const [premium, maxPayout] = quoteData ?? [undefined, undefined];

  if (!period) {
    return (
      <div className="mx-auto max-w-[680px] py-24 text-center">
        <p className="text-[18px] text-ink">No cover is open right now.</p>
        <p className="mt-2 text-[14px] text-muted">
          A new month opens for cover before each official inflation figure.
        </p>
      </div>
    );
  }

  const capBps = Number(period.capBps);
  const buckets = period.cpiBucketsBps.map(Number);
  const probs = period.probBps.map(Number);
  const spendNum = Number(notional) / 1_000_000;
  const payoutAt = (cpi: number) =>
    (Math.min(Math.max(cpi - level, 0), Math.max(capBps - level, 0)) * spendNum) / 10_000;
  const maxProb = Math.max(...probs, 1);
  const saleLeft = Number(period.saleEnd) - now;

  return (
    <div className="mx-auto flex max-w-[680px] flex-col gap-12 py-10">
      {/* 1 — what this is, in one breath */}
      <header>
        <h1 className="text-[38px] font-semibold leading-[1.15] tracking-tight text-ink">
          Your costs went up.
          <br />
          Get some of it back.
        </h1>
        <p className="mt-4 max-w-[48ch] text-[16px] leading-6 text-muted">
          Pay once at the start of the month. If prices rise more than the level you pick, we pay
          you the difference when the official figure comes out.
        </p>
      </header>

      {/* 2 — the only two questions we ask */}
      <section className="flex flex-col gap-4">
        <div className="rounded-[16px] bg-surface p-6">
          <label className="text-[15px] font-medium text-ink" htmlFor="spend">
            What do you spend a month on supplies?
          </label>
          <div className="mt-4 flex items-center gap-3">
            <div className="relative flex-1">
              <input
                id="spend"
                type="number"
                min={0}
                value={spend}
                onChange={(e) => setSpend(e.target.value)}
                className="h-14 w-full rounded-[12px] bg-surface-2 pl-4 pr-16 font-mono text-[24px] text-ink tnum outline-none focus:ring-1 focus:ring-accent"
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-dim">
                USDT
              </span>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            {SPEND_PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setSpend(String(p))}
                className={`rounded-full px-3 py-1.5 text-[13px] transition-colors ${
                  spend === String(p)
                    ? "bg-surface-3 text-ink"
                    : "bg-surface-2 text-muted hover:text-ink"
                }`}
              >
                {p.toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[16px] bg-surface p-6">
          <p className="text-[15px] font-medium text-ink">Pay me if prices rise more than…</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {LEVELS.filter((l) => l < capBps).map((l) => {
              const active = l === level;
              const ceiling = ((capBps - l) * spendNum) / 10_000;
              return (
                <button
                  key={l}
                  onClick={() => setLevel(l)}
                  aria-pressed={active}
                  className={`rounded-[12px] p-4 text-left transition-colors ${
                    active
                      ? "bg-surface-3 ring-1 ring-accent"
                      : "bg-surface-2 hover:bg-surface-3"
                  }`}
                >
                  <div className={`font-mono text-[26px] tnum ${active ? "text-accent" : "text-ink"}`}>
                    {formatBps(l, 0)}
                  </div>
                  <div className="mt-1 text-[13px] leading-4 text-muted">
                    up to{" "}
                    <span className="font-mono tnum text-ink">{ceiling.toFixed(0)}</span> back
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* 3 — the whole product, as one sentence */}
      <section className="rounded-[16px] bg-surface p-6">
        <p className="text-[20px] leading-8 text-ink">
          You pay{" "}
          <span className="font-mono text-accent tnum">
            {premium === undefined ? "--" : formatUsdt(premium)}
          </span>{" "}
          once. If prices rise more than{" "}
          <span className="font-mono tnum">{formatBps(level)}</span>, you get back up to{" "}
          <span className="font-mono text-accent tnum">
            {maxPayout === undefined ? "--" : formatUsdt(maxPayout)}
          </span>
          .
        </p>
        <p className="mt-4 border-t border-line pt-4 text-[14px] leading-5 text-muted">
          Paid automatically when the official figure is published — you never file a claim.{" "}
          <span className="text-ink">
            You can never lose more than the {premium === undefined ? "--" : formatUsdt(premium)} you
            pay.
          </span>
        </p>
      </section>

      {/* 4 — the ladder, which is the curve without the maths */}
      <section>
        <h2 className="text-[15px] font-medium text-ink">What you would get</h2>
        <div className="mt-4 flex flex-col">
          {buckets.map((b, i) => {
            const pay = payoutAt(b);
            const prob = probs[i] ?? 0;
            return (
              <div
                key={b}
                className="flex items-center gap-4 border-b border-line py-4 last:border-b-0"
              >
                <div className="w-[132px] shrink-0 text-[15px] text-ink">
                  If prices rise <span className="font-mono tnum">{formatBps(b, 0)}</span>
                </div>
                {/* Likelihood as a bar rather than a percentage: "how likely"
                    is a feeling, and a bar is read faster than a number. */}
                <div className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2 sm:block">
                  <div
                    className="h-full rounded-full bg-surface-3"
                    style={{ width: `${(prob / maxProb) * 100}%` }}
                  />
                </div>
                <div className="w-[56px] shrink-0 text-right text-[13px] text-dim tnum">
                  {formatBps(prob, 0)}
                </div>
                <div className="w-[104px] shrink-0 text-right text-[15px]">
                  {pay > 0 ? (
                    <span className="font-mono text-accent tnum">+{pay.toFixed(2)}</span>
                  ) : (
                    <span className="text-dim">nothing</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[13px] leading-5 text-muted">
          Based on covering {spendNum.toLocaleString()} USDT of monthly spending above{" "}
          {formatBps(level)}. Above {formatBps(period.capBps)} the payout stops growing.
        </p>
      </section>

      {/* 5 — why this is worth anything, in goods they buy */}
      <section>
        <h2 className="text-[15px] font-medium text-ink">What got more expensive this month</h2>
        <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {cafeBasket.map((b) => (
            <div key={b.label} className="flex items-baseline justify-between gap-4">
              <span className="text-[15px] text-muted">{b.label}</span>
              <span
                className={`font-mono text-[15px] tnum ${
                  b.delta > 0 ? "text-down-500" : "text-dim"
                }`}
              >
                {b.delta > 0 ? `+${b.delta.toFixed(1)}%` : "no change"}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[13px] leading-5 text-muted">
          Illustrative basket. Payouts settle against the official inflation figure for the period,
          not against this list.
        </p>
      </section>

      {/* 6 — one way forward */}
      <section className="flex flex-col items-start gap-3 border-t border-line pt-8">
        <Link
          href={`/protect?spend=${spend}&strike=${level}`}
          className={`flex h-12 items-center rounded-full px-6 text-[15px] font-semibold transition-colors ${
            saleLeft > 0
              ? "bg-accent text-on-accent hover:bg-accent-hover"
              : "bg-surface-2 text-muted"
          }`}
        >
          {saleLeft > 0
            ? `Get covered for ${premium === undefined ? "--" : formatUsdt(premium)} USDT`
            : "See the next month"}
        </Link>
        <p className="text-[13px] text-muted">
          {saleLeft > 0 ? (
            <>
              Cover for this month closes in{" "}
              <span className="font-mono tnum text-ink">{formatCountdown(saleLeft)}</span>.
            </>
          ) : (
            <>Cover for this month has closed. The next month opens before the official figure.</>
          )}
        </p>
      </section>
    </div>
  );
}
