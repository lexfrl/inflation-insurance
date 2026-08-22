// USDC has 6 decimals; strike/cap/CPI are all basis points (1/100 of 1%).

export function formatUsdc(value: bigint | undefined, fractionDigits = 2): string {
  if (value === undefined) return "-";
  const whole = value / 1_000_000n;
  const frac = value % 1_000_000n;
  const num = Number(whole) + Number(frac) / 1_000_000;
  return num.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function parseUsdc(value: string): bigint {
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
