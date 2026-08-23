"use client";

import { useId } from "react";

import { useEasedNumber } from "@/lib/useEased";

/* The whole product argument in one picture.
 *
 * A binary CPI market pays a flat $1 whether inflation lands at 3.01% or 12%.
 * This contract pays `clamp(CPI - strike, 0, cap - strike) x notional`, so the
 * payout tracks how much the shock actually hurt, up to the cap. That is the
 * difference between a bet and a hedge, and it is a shape, not a sentence --
 * hence a chart rather than another paragraph of copy.
 *
 * The bars behind the curve are the same discrete CPI histogram the contract
 * prices against (`cpiBucketsBps` / `probBps`), so the user is looking at the
 * actual pricing input rather than a decorative sparkline. Nothing here is
 * recomputed as an independent source of truth: `quote()` on-chain remains
 * authoritative for premium and max payout, and this only draws the payoff
 * geometry those numbers come from.
 */

type Props = {
  capBps: number;
  strikeBps: number;
  /** Notional in whole USDT (not 6-decimal base units). */
  notional: number;
  /** Discrete CPI outcomes the period is priced against, in bps. */
  buckets: number[];
  /** Probability of each bucket, in bps (sums to 10000). */
  probs: number[];
  /** Settled CPI in bps, once the operator has posted it. */
  settlementCpiBps?: number | null;
  className?: string;
};

const W = 680;
const H = 360;
const PAD = { l: 58, r: 18, t: 30, b: 48 };

export function PayoffChart({
  capBps,
  strikeBps,
  notional,
  buckets,
  probs,
  settlementCpiBps = null,
  className = "",
}: Props) {
  const uid = useId().replace(/:/g, "");

  // Dragging the slider moves the kink; easing it means the curve reads as one
  // shape sliding rather than a stack of hard redraws.
  const drawnStrike = useEasedNumber(strikeBps);

  const payoutAt = (cpiBps: number) =>
    (Math.min(Math.max(cpiBps - drawnStrike, 0), Math.max(capBps - drawnStrike, 0)) * notional) / 10_000;

  const maxPayout = payoutAt(capBps);
  // The y axis is scaled to the *ceiling* of this period -- what a strike of
  // zero would pay at the cap -- and NOT to the current maxPayout. Scaling to
  // maxPayout made the axis rescale on every slider tick, so the plateau was
  // always pinned to the top of the frame and moving the strike appeared to
  // do nothing except make everything jump. With a fixed ceiling, raising the
  // strike visibly lowers the plateau, which is the whole point of the
  // control.
  const ceiling = (capBps * notional) / 10_000;
  const yMax = ceiling > 0 ? ceiling : 1;
  const xMax = Math.max(capBps * 1.2, ...(buckets.length ? buckets : [capBps]), 1) * 1.05;

  const x = (bps: number) => PAD.l + (bps / xMax) * (W - PAD.l - PAD.r);
  const y = (payout: number) => H - PAD.b - (payout / yMax) * (H - PAD.t - PAD.b);

  const curve = [
    [x(0), y(0)],
    [x(drawnStrike), y(0)],
    [x(capBps), y(maxPayout)],
    [x(xMax), y(maxPayout)],
  ] as const;
  const curvePoints = curve.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const areaPath = `M ${curvePoints.split(" ").join(" L ")} L ${x(xMax).toFixed(1)},${y(0).toFixed(1)} L ${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

  const maxProb = Math.max(1, ...probs);
  const barW = Math.max(6, (W - PAD.l - PAD.r) / Math.max(buckets.length * 2.4, 1));
  const barZone = (H - PAD.t - PAD.b) * 0.55;

  const settledPayout = settlementCpiBps === null ? null : payoutAt(settlementCpiBps);

  return (
    <figure className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Payout curve: nothing below ${(strikeBps / 100).toFixed(2)} percent inflation, then rising to a maximum of ${maxPayout.toFixed(2)} USDT at ${(capBps / 100).toFixed(2)} percent, where it stops growing.`}
      >
        <defs>
          <linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent-400)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--color-accent-400)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Horizontal reference lines at 0, half and full payout. They label
            the y axis, so they are structure rather than decoration. */}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(yMax * f)}
              y2={y(yMax * f)}
              stroke="var(--color-surface-700)"
              strokeWidth="1"
            />
            <text
              x={PAD.l - 10}
              y={y(yMax * f) + 4}
              textAnchor="end"
              className="fill-content-600 font-mono text-[11px]"
            >
              {(yMax * f).toFixed(maxPayout > 0 && yMax < 10 ? 1 : 0)}
            </text>
          </g>
        ))}

        {/* The pricing histogram, behind the curve: where the market thinks
            CPI actually lands. */}
        {buckets.map((b, i) => {
          const h = ((probs[i] ?? 0) / maxProb) * barZone;
          return (
            <g key={`${b}-${i}`}>
              <rect
                x={x(b) - barW / 2}
                y={H - PAD.b - h}
                width={barW}
                height={h}
                rx="2"
                fill="var(--color-content-600)"
                opacity="0.22"
              />
              <text
                x={x(b)}
                y={H - PAD.b - h - 6}
                textAnchor="middle"
                className="fill-content-600 font-mono text-[10px]"
              >
                {((probs[i] ?? 0) / 100).toFixed(0)}%
              </text>
            </g>
          );
        })}

        {/* Strike: the kink. Everything left of it pays nothing. */}
        <line
          x1={x(drawnStrike)}
          x2={x(drawnStrike)}
          y1={PAD.t}
          y2={H - PAD.b}
          stroke="var(--color-accent-500)"
          strokeWidth="1"
          strokeDasharray="3 4"
        />
        <text
          x={x(drawnStrike) + 6}
          y={PAD.t + 11}
          className="fill-accent-300 font-mono text-[11px]"
        >
          your level {(drawnStrike / 100).toFixed(2)}%
        </text>

        {/* Cap: where the payout stops growing. */}
        <line
          x1={x(capBps)}
          x2={x(capBps)}
          y1={PAD.t}
          y2={H - PAD.b}
          stroke="var(--color-surface-600)"
          strokeWidth="1"
          strokeDasharray="3 4"
        />
        <text x={x(capBps) + 6} y={PAD.t + 11} className="fill-content-600 font-mono text-[11px]">
          covered to {(capBps / 100).toFixed(2)}%
        </text>

        <path d={areaPath} fill={`url(#fill-${uid})`} />
        <polyline
          points={curvePoints}
          fill="none"
          stroke="var(--color-accent-400)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="payoff-line"
        />

        {/* Settled outcome, once the operator has posted CPI: the single dot
            that turns an abstract curve into "this is what you get". */}
        {settlementCpiBps !== null && settledPayout !== null && (
          <g>
            <line
              x1={x(settlementCpiBps)}
              x2={x(settlementCpiBps)}
              y1={y(settledPayout)}
              y2={H - PAD.b}
              stroke="var(--color-signal-warning)"
              strokeWidth="1"
            />
            <circle
              cx={x(settlementCpiBps)}
              cy={y(settledPayout)}
              r="5"
              fill="var(--color-signal-warning)"
              stroke="var(--color-surface-900)"
              strokeWidth="2"
            />
          </g>
        )}

        {/* x axis, ticked at the priced CPI outcomes -- without these the
            bars are unlabelled and nobody can tell which inflation level any
            of them stands for. */}
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={H - PAD.b}
          y2={H - PAD.b}
          stroke="var(--color-surface-600)"
          strokeWidth="1"
        />
        {buckets.map((b, i) => (
          <text
            key={`tick-${b}-${i}`}
            x={x(b)}
            y={H - PAD.b + 15}
            textAnchor="middle"
            className="fill-content-500 font-mono text-[11px]"
          >
            {(b / 100).toFixed(0)}%
          </text>
        ))}
        <text x={PAD.l} y={H - 8} className="fill-content-600 text-[11px]">
          Inflation over the period
        </text>
        {/* Sits above the top gridline, not level with it: at PAD.t it
            overlapped the topmost axis value. */}
        <text
          x={PAD.l - 10}
          y={PAD.t - 12}
          textAnchor="end"
          className="fill-content-600 font-mono text-[11px]"
        >
          USDT
        </text>
      </svg>

      <style>{`
        .payoff-line {
          stroke-dasharray: 1400;
          stroke-dashoffset: 1400;
          animation: payoff-draw 900ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes payoff-draw {
          to { stroke-dashoffset: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .payoff-line { stroke-dasharray: none; stroke-dashoffset: 0; animation: none; }
        }
      `}</style>
    </figure>
  );
}
