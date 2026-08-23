"use client";

import { useId } from "react";

import { useEasedNumber } from "@/lib/useEased";

/* The payoff curve, drawn the way section#v2-index (4:5364) draws its index
 * chart: one series as a smooth line over a gradient area, faint horizontal
 * gridlines, value labels down the left, category labels along the bottom, and
 * a small unit caption above the axis. Nothing is annotated inside the plot --
 * the macket keeps the field clean and puts the context in the toolbar and the
 * legend beneath, which is also what fixes the old version's problem of two
 * competing encodings fighting over one unlabelled axis.
 *
 * The shape itself is still the contract's: `clamp(CPI - strike, 0, cap -
 * strike) x notional`. `quote()` on-chain stays authoritative for the premium
 * and the maximum payout; this only draws the geometry those numbers describe.
 */

type Props = {
  capBps: number;
  strikeBps: number;
  /** Notional in whole USDT (not 6-decimal base units). */
  notional: number;
  /** Discrete CPI outcomes the period is priced against, in bps. */
  buckets: number[];
  /** Probability of each bucket, in bps. Not plotted -- the scenario table
      below the chart carries the distribution. */
  probs: number[];
  /** Settled CPI in bps, once the operator has posted it. */
  settlementCpiBps?: number | null;
  className?: string;
};

/* The macket's plot box. */
const W = 1072;
const H = 440;
const PAD = { l: 64, r: 28, t: 34, b: 40 };

export function PayoffChart({
  capBps,
  strikeBps,
  notional,
  buckets,
  settlementCpiBps = null,
  className = "",
}: Props) {
  const uid = useId().replace(/:/g, "");

  // Easing the kink means moving the slider reads as one shape sliding rather
  // than a stack of hard redraws.
  const drawnStrike = useEasedNumber(strikeBps);

  const payoutAt = (cpiBps: number) =>
    (Math.min(Math.max(cpiBps - drawnStrike, 0), Math.max(capBps - drawnStrike, 0)) * notional) /
    10_000;

  const maxPayout = payoutAt(capBps);

  // The axis is scaled to this period's ceiling -- what a strike of zero pays
  // at the cap -- not to the current payout. Scaling to the current value made
  // the axis rescale on every slider tick, so the plateau stayed pinned to the
  // top and moving the strike looked like it did nothing.
  const ceiling = (capBps * notional) / 10_000;
  const yMax = ceiling > 0 ? ceiling : 1;
  const xMax = Math.max(capBps * 1.2, ...(buckets.length ? buckets : [capBps]), 1) * 1.05;

  const x = (bps: number) => PAD.l + (bps / xMax) * (W - PAD.l - PAD.r);
  const y = (payout: number) => H - PAD.b - (payout / yMax) * (H - PAD.t - PAD.b);

  /* Four points describe the whole instrument: flat at zero to the strike, a
     straight rise to the cap, then a plateau. */
  const pts = [
    [x(0), y(0)],
    [x(drawnStrike), y(0)],
    [x(capBps), y(maxPayout)],
    [x(xMax), y(maxPayout)],
  ] as const;
  const line = pts.map(([px, py], i) => `${i ? "L" : "M"} ${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const area = `${line} L ${x(xMax).toFixed(1)} ${y(0).toFixed(1)} L ${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;

  /* Five value gridlines, and a category tick every two percent. */
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f);
  const step = 200;
  const xTicks: number[] = [];
  for (let b = 0; b <= xMax; b += step) xTicks.push(b);

  const settledPayout = settlementCpiBps === null ? null : payoutAt(settlementCpiBps);

  return (
    <figure className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        role="img"
        aria-label={`Payout curve: nothing below ${(strikeBps / 100).toFixed(2)} percent inflation, then rising to a maximum of ${maxPayout.toFixed(2)} USDT at ${(capBps / 100).toFixed(2)} percent, where it stops growing.`}
      >
        <defs>
          <linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.42" />
            <stop offset="55%" stopColor="var(--color-accent)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Unit caption, above the topmost value label. */}
        <text x={PAD.l - 10} y={PAD.t - 12} textAnchor="end" className="fill-dim text-[11px]">
          USDT
        </text>

        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--color-line)"
              strokeWidth="1"
              opacity="0.55"
            />
            <text x={PAD.l - 10} y={y(v) + 4} textAnchor="end" className="fill-muted text-[11px]">
              {v.toFixed(v >= 100 ? 0 : 2)}
            </text>
          </g>
        ))}

        <path d={area} fill={`url(#fill-${uid})`} />
        <path
          d={line}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Where the operator's posted figure landed, once there is one. */}
        {settledPayout !== null && settlementCpiBps !== null && (
          <circle
            cx={x(settlementCpiBps)}
            cy={y(settledPayout)}
            r="4"
            fill="var(--color-accent)"
            stroke="var(--color-surface)"
            strokeWidth="2"
          />
        )}

        {xTicks.map((b) => (
          <text
            key={b}
            x={x(b)}
            y={H - PAD.b + 20}
            textAnchor="middle"
            className="fill-muted text-[11px]"
          >
            {(b / 100).toFixed(0)}%
          </text>
        ))}
      </svg>
    </figure>
  );
}
