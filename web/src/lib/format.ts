// USDT has 6 decimals; strike/cap/CPI are all basis points (1/100 of 1%).

export function formatUsdt(value: bigint | undefined, fractionDigits = 2): string {
  if (value === undefined) return "-";
  const whole = value / 1_000_000n;
  const frac = value % 1_000_000n;
  const num = Number(whole) + Number(frac) / 1_000_000;
  return num.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function parseUsdt(value: string): bigint {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0n;
  return BigInt(Math.round(num * 1_000_000));
}

export function formatBps(bps: bigint | number | undefined, fractionDigits = 2): string {
  if (bps === undefined) return "-";
  const num = Number(bps) / 100;
  return `${num.toFixed(fractionDigits)}%`;
}

export function formatDate(unixSeconds: bigint | number): string {
  return new Date(Number(unixSeconds) * 1000).toLocaleString();
}

/// A short "time left" string for sale / period countdowns. Drops to seconds
/// only in the last minutes, so a two-hour window doesn't flicker a seconds
/// digit at the user for two hours.
export function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return "closed";
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = Math.floor(secondsLeft % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
