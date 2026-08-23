"use client";

/* Small inline charts for the metric cards, in the shape the reference uses.
 *
 * The series are real, not decorative. `premiumCurve` walks every strike from
 * zero to the cap and prices it with the same arithmetic `InflationHedge.quote`
 * uses on-chain -- expected payout across the period's own CPI histogram,
 * times the load factor. Spot-checked against the deployed contract: 1,000
 * covered above 3% on the 8% cap period quotes 16.80 both ways.
 *
 * The authoritative number a user transacts on still comes from `quote()`.
 * This is only for drawing the shape between those points. */

export function premiumCurve(
  buckets: number[],
  probs: number[],
  capBps: number,
  loadBps: number,
  notional: number,
  steps = 48,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const strike = (capBps * i) / steps;
    let ev = 0;
    for (let b = 0; b < buckets.length; b++) {
      const covered = Math.min(Math.max(buckets[b] - strike, 0), Math.max(capBps - strike, 0));
      ev += ((probs[b] ?? 0) / 10_000) * covered;
    }
    out.push({ x: strike, y: (ev * notional * (loadBps / 10_000)) / 10_000 });
  }
  return out;
}

export function payoutCurve(
  capBps: number,
  strikeBps: number,
  notional: number,
  steps = 48,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const cpi = (capBps * 1.15 * i) / steps;
    const covered = Math.min(Math.max(cpi - strikeBps, 0), Math.max(capBps - strikeBps, 0));
    out.push({ x: cpi, y: (covered * notional) / 10_000 });
  }
  return out;
}

export function Sparkline({
  points,
  tone = "accent",
  className = "h-10 w-full",
}: {
  points: { x: number; y: number }[];
  tone?: "accent" | "positive" | "danger";
  className?: string;
}) {
  if (points.length < 2) return null;
  const W = 120;
  const H = 36;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const sx = (x: number) => ((x - xMin) / (xMax - xMin || 1)) * W;
  // A flat series would otherwise divide by zero and collapse onto the axis.
  const sy = (y: number) => H - ((y - yMin) / (yMax - yMin || 1)) * (H - 2) - 1;

  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
  const area = `${d} L ${W} ${H} L 0 ${H} Z`;
  const stroke =
    tone === "positive"
      ? "var(--color-signal-positive)"
      : tone === "danger"
        ? "var(--color-signal-danger)"
        : "var(--color-accent-400)";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      <path d={area} fill={stroke} opacity="0.12" />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/* The reference's semicircular gauge, used here for how much of the pool the
   cover already sold could be called on to pay. */
export function Gauge({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(1, value));
  const R = 34;
  const CX = 44;
  const CY = 40;
  const arc = (from: number, to: number) => {
    const a1 = Math.PI * (1 + from);
    const a2 = Math.PI * (1 + to);
    const x1 = CX + R * Math.cos(a1);
    const y1 = CY + R * Math.sin(a1);
    const x2 = CX + R * Math.cos(a2);
    const y2 = CY + R * Math.sin(a2);
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  };

  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 88 48" className="h-12 w-[88px]" aria-hidden="true">
        <path d={arc(0, 1)} fill="none" stroke="var(--color-surface-700)" strokeWidth="7" strokeLinecap="round" />
        <path
          d={arc(0, Math.max(pct, 0.001))}
          fill="none"
          stroke="var(--color-accent-400)"
          strokeWidth="7"
          strokeLinecap="round"
        />
      </svg>
      <div>
        {/* A real but tiny share rounds to "0%", which reads as a broken
            widget rather than as "barely any of the pool is committed". */}
        <div className="font-mono text-lg text-content-100 tnum">
          {pct > 0 && pct * 100 < 1 ? "<1%" : `${(pct * 100).toFixed(0)}%`}
        </div>
        <div className="text-[11px] text-content-600">{label}</div>
      </div>
    </div>
  );
}
