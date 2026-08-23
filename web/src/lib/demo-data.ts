/* DEMO DATA -- NOT READ FROM THE CONTRACT.
 *
 * Every value in this file is invented for the hackathon dashboard. It exists
 * so the reference layout can be shown fully populated; it is deliberately
 * quarantined in one module, and nothing here is mixed into a component that
 * also renders an on-chain read. If you are looking for a number and it came
 * from here, it is not real.
 *
 * The shape of each block (row counts, column sets, tile weights) follows the
 * Figma macket so the geometry can be checked against it; the subject matter
 * is Hedgy's own -- inflation baskets a cover buyer would actually hedge.
 */

export const DEMO = true;

export type Move = { label: string; value: string; delta: number };

/* Market summary strip. */
export const marketSummary =
  "Headline inflation has run below the covered level for three consecutive periods. Cover priced above 4% has been the cheapest it has been this quarter.";

/* Heatmap tiles. The macket's treemap is not a CSS grid -- it is twelve
   absolutely positioned rectangles inside a 508 x 320 box on a 2px gutter, and
   the value's type size steps down with the tile. These x/y/w/h values are
   copied straight off Component 13 so the mosaic matches; only the basket
   names and deltas are Hedgy's. */
export type HeatTile = {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  delta: number;
};
export const heatmap: HeatTile[] = [
  { label: "Housing", x: 0, y: 0, w: 253, h: 159, delta: 0 },
  { label: "Transport", x: 255, y: 0, w: 253, h: 105.33, delta: -0.06 },
  { label: "Food & Non-alcoholic Beverages", x: 0, y: 161, w: 253, h: 105.33, delta: -0.11 },
  { label: "Health", x: 255, y: 107.33, w: 253, h: 51.67, delta: 0 },
  { label: "Utilities", x: 255, y: 161, w: 83, h: 105.33, delta: 0 },
  { label: "Recreation & Culture", x: 340, y: 161, w: 83, h: 105.33, delta: 0 },
  { label: "Clothing & Footwear", x: 425, y: 161, w: 83, h: 51.67, delta: 0 },
  { label: "Other", x: 425, y: 214.67, w: 83, h: 51.67, delta: 0 },
  { label: "Household Durables & Daily Use Items", x: 0, y: 268.33, w: 168, h: 51.67, delta: 0 },
  { label: "Communications", x: 170, y: 268.33, w: 83, h: 51.67, delta: 0 },
  { label: "Education", x: 255, y: 268.33, w: 83, h: 51.67, delta: 0 },
  { label: "Alcohol & Tobacco", x: 340, y: 268.33, w: 168, h: 51.67, delta: 0 },
];
export const heatmapRange = { lo: -0.11, hi: 0.11 };

/* Hedgy's own index against the official print, per region. */
export type GapRow = { label: string; hedgy: string; official: string; gap: number };
export const gapRows: GapRow[] = [
  { label: "AR CPI", hedgy: "2.28%", official: "3.40%", gap: -1.12 },
  { label: "AR Core", hedgy: "2.57%", official: "3.67%", gap: -1.1 },
  { label: "AR Regional", hedgy: "2.11%", official: "3.10%", gap: -0.99 },
];
export const gapNote =
  "Shelter costs have not yet fed through to the official basket. The live index has led the official print lower for three consecutive periods.";
export const gapQuestions = [
  "Why does the live index move before the official print?",
  "What happens to my cover if the official figure is revised?",
];

/* Top indexes strip -- 260 x 142 tiles in the macket. */
export type IndexTile = { label: string; value: string; delta: number; series: number[] };
/* A seeded random walk, not a sine. Trig gives every row the identical
   wave, which reads instantly as filler; a walk with a fixed seed stays
   deterministic across renders while letting each series have its own shape. */
function rng(seed: number) {
  let a = seed * 1831565813 + 1;
  return () => {
    a = Math.imul(a ^ (a >>> 15), a | 1);
    a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  };
}

const wobble = (seed: number, drift: number) => {
  const next = rng(seed + 7);
  let v = 50;
  return Array.from({ length: 30 }, (_, i) => {
    v += (next() - 0.5) * 3.2 + drift * 0.55;
    // Keep the walk inside a band so a long drift cannot flatten the others.
    v = Math.max(28, Math.min(72, v));
    return v + (i === 0 ? 0 : 0);
  });
};
export const topIndexes: IndexTile[] = [
  { label: "AR CPI", value: "2.28%", delta: -0.03, series: wobble(0, -0.2) },
  { label: "AR Core", value: "2.57%", delta: -0.1, series: wobble(1, -0.3) },
  { label: "Food basket", value: "3.67%", delta: -0.41, series: wobble(2, -0.5) },
  { label: "Energy", value: "4.70%", delta: -0.8, series: wobble(3, -0.7) },
  { label: "Housing", value: "1.92%", delta: 0.12, series: wobble(4, 0.2) },
  { label: "Transport", value: "3.04%", delta: -0.22, series: wobble(5, -0.4) },
  { label: "Health", value: "2.41%", delta: 0.05, series: wobble(6, 0.1) },
  { label: "Services", value: "3.88%", delta: -0.15, series: wobble(7, -0.25) },
];

/* Trending / recently added lists -- 508-wide rows in the macket. */
export type ListRow = { title: string; sub?: string; value: string; delta: number };
export const trending: ListRow[] = [
  { title: "AR CPI", sub: "HedgyCPI-AR", value: "2.28%", delta: -0.03 },
  { title: "Cover sold this period", value: "45 USDT", delta: 0.05 },
  { title: "Food basket", sub: "HedgyFood-AR", value: "3.67%", delta: -0.41 },
  { title: "Pool utilisation", value: "0.06%", delta: 0.0 },
];
export const recentlyAdded: ListRow[] = [
  { title: "Regional CPI - Cordoba", value: "2.94%", delta: 0.04 },
  { title: "Regional CPI - Rosario", value: "3.11%", delta: 0.05 },
  { title: "Rent index - Buenos Aires", sub: "Monthly, operator-posted", value: "5.20%", delta: 0.1 },
  { title: "Energy tariff index", value: "6.33%", delta: 0.0 },
];

/* Data streams table. */
export const streamTabs = [
  "All",
  "Hedgy indexes",
  "Inflation",
  "Economic",
  "Regional",
  "Baskets",
  "Feeds",
] as const;
export type StreamRow = {
  name: string;
  ticker?: string;
  value: string;
  delta: number;
  type: string;
  series: number[];
};
export const streams: StreamRow[] = [
  { name: "AR CPI", ticker: "HedgyCPI-AR", value: "2.28%", delta: -0.03, type: "Inflation", series: wobble(1, -0.2) },
  { name: "AR Core CPI", ticker: "HedgyCore-AR", value: "2.57%", delta: -0.01, type: "Inflation", series: wobble(2, -0.15) },
  { name: "Food basket", ticker: "HedgyFood-AR", value: "3.67%", delta: -0.41, type: "Basket", series: wobble(3, -0.5) },
  { name: "Energy tariffs", ticker: "HedgyNRG-AR", value: "4.70%", delta: -0.8, type: "Basket", series: wobble(4, -0.7) },
  { name: "Housing index", ticker: "HedgyHome-AR", value: "1.92%", delta: 0.12, type: "Regional", series: wobble(5, 0.2) },
  { name: "Transport index", ticker: "HedgyMove-AR", value: "3.04%", delta: -0.22, type: "Inflation", series: wobble(6, -0.3) },
  { name: "Health index", ticker: "HedgyMed-AR", value: "2.41%", delta: 0.05, type: "Basket", series: wobble(7, 0.1) },
  { name: "Services index", ticker: "HedgySvc-AR", value: "3.88%", delta: -0.15, type: "Inflation", series: wobble(8, -0.2) },
  { name: "Rent - Buenos Aires", ticker: "HedgyRent-BA", value: "5.20%", delta: 0.1, type: "Regional", series: wobble(9, 0.3) },
  { name: "Regional CPI - Cordoba", ticker: "HedgyCPI-CB", value: "2.94%", delta: 0.04, type: "Regional", series: wobble(10, 0.1) },
];

/* Right rail. */
export const watchlist: ListRow[] = [
  { title: "AR CPI", sub: "HedgyCPI-AR", value: "2.28%", delta: -0.03 },
  { title: "Food basket", sub: "HedgyFood-AR", value: "3.67%", delta: -0.41 },
  { title: "Energy tariffs", sub: "HedgyNRG-AR", value: "4.70%", delta: -0.8 },
  { title: "Housing index", sub: "HedgyHome-AR", value: "1.92%", delta: 0.12 },
  { title: "Services index", sub: "HedgySvc-AR", value: "3.88%", delta: -0.15 },
];

export type Report = { title: string; date: string };
export const reports: Report[] = [
  { title: "Settlement note - period 1, official CPI posted", date: "Aug 11, 2026" },
  { title: "Pool performance and premium load review", date: "Jul 29, 2026" },
  { title: "Methodology: how the covered level is priced", date: "Jul 13, 2026" },
];

export const movers: { gainers: Move[]; losers: Move[] } = {
  gainers: [
    { label: "Rent - Buenos Aires", value: "5.20%", delta: 17.54 },
    { label: "Energy tariffs", value: "4.70%", delta: 6.77 },
    { label: "Regional CPI - Rosario", value: "3.11%", delta: 5.9 },
    { label: "Services index", value: "3.88%", delta: 3.49 },
    { label: "Health index", value: "2.41%", delta: 2.3 },
  ],
  losers: [
    { label: "Food basket", value: "3.67%", delta: -4.41 },
    { label: "Transport index", value: "3.04%", delta: -2.2 },
    { label: "AR CPI", value: "2.28%", delta: -1.31 },
    { label: "AR Core CPI", value: "2.57%", delta: -0.99 },
    { label: "Housing index", value: "1.92%", delta: -0.4 },
  ],
};

export type CalendarEntry = {
  region: string;
  date: string;
  time: string;
  title: string;
  note: string;
  impact: "high" | "medium";
};
export const calendar: CalendarEntry[] = [
  { region: "AR", date: "Aug 26", time: "12:30", title: "Core CPI, monthly", note: "Forecast 0.20 / Previous 0.10", impact: "high" },
  { region: "AR", date: "Sep 4", time: "12:30", title: "Headline CPI, monthly", note: "Forecast 12 / Previous -23", impact: "high" },
  { region: "AR", date: "Sep 4", time: "12:30", title: "Unemployment rate", note: "Forecast 4.20 / Previous 4.10", impact: "medium" },
  { region: "AR", date: "Sep 10", time: "12:30", title: "Producer price index", note: "Previous 0", impact: "high" },
  { region: "AR", date: "Sep 11", time: "06:00", title: "GDP, quarterly", note: "Previous 0.30", impact: "medium" },
];
export const calendarTabs = ["All", "AR", "US", "UK", "IN"] as const;
