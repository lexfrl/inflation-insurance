"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowSquareOut,
  ArrowUp,
  CaretLeft,
  CaretRight,
  ChartPieSlice,
  FileText,
  Minus,
  Star,
  TrendUp,
} from "@phosphor-icons/react";
import { Sparkline } from "@/components/spark";
import * as demo from "@/lib/demo-data";

/* The reference dashboard's block set, at the sizes measured off the Figma
   node tree rather than eyeballed from a screenshot:
     section title   20 tall, its card 28 below the title's top edge
     surface card    12 radius, 1px hairline, 16 inner padding
     two-up row      540 + 16 + 540
     index tile      260 x 142 on a 276 pitch
     table row       57 tall under a 32 tall header
     rail card       320 wide
   Everything rendered here is demo data (see lib/demo-data.ts) -- these blocks
   deliberately contain no contract reads, so nothing invented can be mistaken
   for an on-chain value. */

/* ---------- shared shells ---------- */

export function SectionHead({
  title,
  caption,
  chip,
}: {
  title: string;
  caption?: string;
  chip?: string;
}) {
  return (
    <div className="flex h-5 items-center justify-between">
      <div className="flex items-center gap-2">
        <h3 className="text-[14px] font-semibold leading-5 text-tn-800">{title}</h3>
        {chip && (
          <span className="rounded-full bg-card-alt px-1.5 py-0.5 text-[10px] uppercase leading-none tracking-[0.08em] text-text-muted">
            {chip}
          </span>
        )}
      </div>
      {caption && <span className="text-[11px] leading-4 text-text-muted">{caption}</span>}
    </div>
  );
}

export function Surface({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-card border border-border bg-card ${className}`}>{children}</div>
  );
}

/* Section = 20px title, 8px gap, card. Matches the macket's +28 card offset. */
export function Section({
  title,
  caption,
  chip,
  children,
}: {
  title: string;
  caption?: string;
  chip?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <SectionHead title={title} caption={caption} chip={chip} />
      <div className="mt-2">{children}</div>
    </section>
  );
}

function asPoints(series: number[]) {
  return series.map((y, x) => ({ x, y }));
}

/* Falling inflation is the good direction for a cover buyer's premium, and the
   macket colours it that way: green down, red up. */
function deltaTone(d: number) {
  if (d === 0) return "text-text-muted";
  return d < 0 ? "text-up-500" : "text-down-500";
}
function DeltaText({ d, digits = 2 }: { d: number; digits?: number }) {
  return (
    <span className={`font-mono text-[11px] tnum ${deltaTone(d)}`}>
      {d > 0 ? "+" : ""}
      {d.toFixed(digits)}
    </span>
  );
}

function Tabs({
  items,
  value,
  onChange,
  className = "",
}: {
  items: readonly string[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {items.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`rounded-full px-3 py-2 text-[14px] font-medium leading-5 transition-colors [transition-duration:var(--dur-fast)] ${
            t === value
              ? "bg-accent text-text-invert"
              : "bg-tab-rest text-text hover:bg-tn-200"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

/* 24h chip: 6px radius, 8/4 padding, a 16px arrow in a 20px slot, label at
   14/20 medium.
   The macket does not tint by sign -- it tints by whether the move is good for
   the reader. Its CPI rows show a falling print in green and only activity
   series (retail sales, inventories) turn red on a fall. Every stream here is
   an inflation measure, so falling is the green direction; the arrow still
   follows the actual sign. */
function DeltaChip({
  d,
  suffix = "",
  lowerIsBetter = true,
}: {
  d: number;
  suffix?: string;
  lowerIsBetter?: boolean;
}) {
  const up = d > 0;
  const down = d < 0;
  const good = d === 0 ? null : lowerIsBetter ? down : up;
  const tone =
    good === null
      ? "bg-tn-150 text-tn-500"
      : good
        ? "bg-up-100 text-up-500"
        : "bg-down-100 text-down-500";
  const Icon = up ? ArrowUp : down ? ArrowDown : Minus;
  return (
    <span className={`inline-flex items-center rounded-[6px] px-2 py-1 ${tone}`}>
      <span className="flex w-5 shrink-0 items-center pr-1">
        <Icon size={16} weight="bold" />
      </span>
      <span className="whitespace-nowrap text-[14px] font-medium leading-5">
        {up ? "+" : ""}
        {d.toFixed(2)}
        {suffix}
      </span>
    </span>
  );
}

/* Type pill is outlined, not filled: 1px tn/400, 8/3 padding, 10/13 semibold
   with 0.25 tracking in tn/600. A stream with no type shows a bare dash. */
function TypePill({ type }: { type?: string }) {
  if (!type) return <span className="text-[14px] leading-5 text-tn-400">--</span>;
  return (
    <span className="inline-flex rounded-full border border-tn-400 px-2 py-[3px] text-[10px] font-semibold leading-[13px] tracking-[0.25px] text-tn-600">
      {type}
    </span>
  );
}

/* ---------- market summary: 1096 x 78 ---------- */

export function MarketSummary() {
  return (
    <Section title="Market summary" chip="demo">
      <Surface className="flex h-[78px] flex-col justify-center px-4">
        <p className="text-[13px] leading-5 text-text">{demo.marketSummary}</p>
      </Surface>
    </Section>
  );
}

/* ---------- heatmap: 540 x 409 ---------- */

/* Component 13 lays the treemap out by absolute position inside a 508 x 320
   box, so it is reproduced that way rather than approximated with grid spans.
   The value's type size steps with the tile height, exactly as the macket
   does: the two tall tiles carry a 20px figure, the half-height ones 14, the
   shallowest 12. */
function heatFill(d: number) {
  if (d === 0) return "bg-tn-200 text-tn-800";
  const deep = Math.abs(d) > 0.08;
  if (d < 0) return deep ? "bg-up-500 text-page" : "bg-up-400 text-page";
  return deep ? "bg-down-500 text-page" : "bg-down-400 text-page";
}

export function InflationHeatmap() {
  return (
    <Section title="Inflation heatmap" caption="Basket weight - period delta">
      <Surface className="h-[381px] p-4">
        <div className="relative h-[320px] w-full">
          {demo.heatmap.map((t) => {
            const big = t.h > 100;
            /* The macket only bottom-anchors the figure on the tall tiles. On
               the 51.67 ones it sits directly under the label, which is what
               keeps a two-line label from colliding with it. */
            const shallow = t.h < 60;
            return (
              <div
                key={t.label}
                className={`absolute flex flex-col overflow-hidden p-2 ${heatFill(t.delta)}`}
                style={{
                  left: `${(t.x / 508) * 100}%`,
                  top: `${(t.y / 320) * 100}%`,
                  width: `${(t.w / 508) * 100}%`,
                  height: `${(t.h / 320) * 100}%`,
                }}
              >
                <span className="break-words text-[12px] font-medium leading-[15px]">
                  {t.label}
                </span>
                <span
                  className={`tabular-nums ${shallow ? "mt-px" : "mt-auto"} ${
                    big ? "text-[20px] leading-7" : shallow ? "text-[12px] leading-[17px]" : "text-[14px] leading-5"
                  }`}
                >
                  {t.delta > 0 ? "+" : ""}
                  {t.delta.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Legend: 17 tall, nine 12px swatches on a 14px pitch. */}
        <div className="mt-3 flex h-[17px] items-center gap-2 text-[11px] text-tn-500">
          <span className="tabular-nums">{demo.heatmapRange.lo.toFixed(2)}</span>
          <div className="flex gap-0.5">
            {["bg-down-500","bg-down-400","bg-down-300","bg-down-200","bg-tn-200","bg-up-200","bg-up-300","bg-up-400","bg-up-500"].map((c, i) => (
              <span key={i} className={`size-3 ${c}`} />
            ))}
          </div>
          <span className="tabular-nums">+{demo.heatmapRange.hi.toFixed(2)}</span>
        </div>
      </Surface>
    </Section>
  );
}

/* ---------- index vs official: 540 ---------- */

export function IndexVsOfficial() {
  return (
    <Section title="Hedgy index vs official print">
      <Surface className="p-4">
        {/* Four equal 121-wide columns, 8px gutter, as in the macket. */}
        <div className="grid grid-cols-4 gap-2 text-[11px] uppercase tracking-[0.06em] text-text-muted">
          <span>Index</span>
          <span className="text-right">Hedgy</span>
          <span className="text-right">Official</span>
          <span className="text-right">Gap</span>
        </div>
        {demo.gapRows.map((r) => (
          <div
            key={r.label}
            className="grid h-[45px] grid-cols-4 items-center gap-2 border-b border-border text-[13px] last:border-b-0"
          >
            <span className="text-text">{r.label}</span>
            <span className="text-right font-mono tnum text-text">{r.hedgy}</span>
            <span className="text-right font-mono tnum text-text">{r.official}</span>
            <span className="flex justify-end">
              <span className="rounded-full bg-card-alt px-2 py-0.5">
                <DeltaText d={r.gap} />
              </span>
            </span>
          </div>
        ))}
        <p className="mt-3 text-[12px] leading-[13px] text-text-muted">{demo.gapNote}</p>
        <div className="mt-3 flex flex-col gap-2">
          {demo.gapQuestions.map((q) => (
            <button
              key={q}
              className="flex h-[34px] items-center rounded-control border border-border px-3 text-left text-[12px] text-text-muted transition-colors hover:text-text"
            >
              {q}
            </button>
          ))}
        </div>
      </Surface>
    </Section>
  );
}

/* ---------- top indexes: 260 x 142 tiles ---------- */

/* Component 15: a 260x142 white tile, 1px tn/200 hairline, 12 radius, 16
   padding, three rows on a 12 gap -- a 24 icon beside a 14/20 medium label,
   then the value at 14/20 Semi Bold with the change at 12/16 medium beside it,
   then a 40-tall sparkline across the full 226 width. */
export function TopIndexes() {
  return (
    <Section title="Top indexes">
      <div className="flex gap-4 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {demo.topIndexes.map((t) => (
          <a
            key={t.label}
            className="flex h-[142px] w-[260px] shrink-0 flex-col gap-3 rounded-card border border-tn-200 bg-surface p-4"
          >
            <div className="flex w-full items-center gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-tn-200 text-tn-600">
                <ChartPieSlice size={14} />
              </span>
              <span className="whitespace-nowrap text-[14px] font-medium leading-5 text-tn-800">
                {t.label}
              </span>
            </div>
            <div className="flex w-full items-baseline gap-2">
              <span className="text-[14px] font-semibold leading-5 text-tn-800">{t.value}</span>
              <span
                className={`text-[12px] font-medium leading-4 ${
                  t.delta === 0 ? "text-tn-500" : t.delta < 0 ? "text-up-500" : "text-down-500"
                }`}
              >
                {t.delta > 0 ? "+" : ""}
                {t.delta.toFixed(2)}
              </span>
            </div>
            <Sparkline
              points={asPoints(t.series)}
              tone={t.delta <= 0 ? "positive" : "danger"}
              fill={false}
              strokeWidth={1}
              w={226}
              h={40}
              className="h-10 w-full"
            />
          </a>
        ))}
      </div>
    </Section>
  );
}

/* ---------- trending / recently added: 540 x 369 ---------- */

/* Component 16: the row is a 12/8 padded link on a 4px radius. Title, ticker
   and value are all 16/24 semibold -- the ticker separates itself by colour
   (tn/400) rather than by being smaller, which is why these lists read big and
   calm in the macket instead of dense. The delta below the value is the one
   regular-weight item, 14/20. */
function ListCard({ title, rows }: { title: string; rows: demo.ListRow[] }) {
  return (
    <Surface className="h-[369px] p-4">
      <div className="flex h-[25px] items-center gap-1">
        <ChartPieSlice size={24} className="text-tn-600" />
        <h3 className="text-[14px] font-semibold leading-5 text-tn-800">{title}</h3>
      </div>
      <div className="mt-2 flex flex-col">
        {rows.map((r) => (
          <a
            key={r.title}
            className="flex items-center justify-between gap-4 rounded-[4px] px-3 py-2 transition-colors hover:bg-tn-150"
          >
            <div className="flex min-w-0 items-center gap-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-tn-200 text-tn-600">
                <ChartPieSlice size={16} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[16px] font-semibold leading-6 text-tn-800">
                  {r.title}
                </div>
                {r.sub && (
                  <div className="truncate text-[16px] font-semibold leading-6 text-tn-400">
                    {r.sub}
                  </div>
                )}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[16px] font-semibold leading-6 text-tn-800">{r.value}</div>
              <div
                className={`text-[14px] leading-5 ${
                  r.delta === 0 ? "text-tn-500" : r.delta < 0 ? "text-up-500" : "text-down-500"
                }`}
              >
                {r.delta > 0 ? "+" : ""}
                {r.delta.toFixed(2)}
              </div>
            </div>
          </a>
        ))}
      </div>
    </Surface>
  );
}

export function TrendingPair() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ListCard title="Trending" rows={demo.trending} />
      <ListCard title="Recently added" rows={demo.recentlyAdded} />
    </div>
  );
}

/* ---------- data streams table ---------- */

/* Column widths straight off Component 17, and they add up: 12 + 461.92 + 13
   + 100.69 + 13 + 114.92 + 13 + 122.08 + 13 + 231.39 + 1 = 1096. */
const COL = {
  name: "w-[461.92px]",
  value: "w-[100.69px]",
  delta: "w-[114.92px]",
  type: "w-[122.08px]",
  spark: "w-[231.39px]",
};

export function DataStreams() {
  const [tab, setTab] = useState<string>(demo.streamTabs[0]);
  const rows =
    tab === "All"
      ? demo.streams
      : demo.streams.filter((r) => r.type.toLowerCase() === tab.toLowerCase());

  return (
    <Section title="Data streams & indexes" caption={`${demo.streams.length} streams live`}>
      <div>
        <Tabs items={demo.streamTabs} value={tab} onChange={setTab} />

        <div className="mt-2 overflow-x-auto">
          <div className="min-w-[1096px]">
            {/* Header: 32 tall, sentence case, indented so "Name" lines up with
                the row's title rather than with the star. */}
            <div className="flex h-8 items-center gap-[13px] pl-3 pr-px text-[12px] leading-4 text-text-muted">
              <span className={`${COL.name} shrink-0 pl-[88px]`}>Name</span>
              <span className={`${COL.value} shrink-0 pl-[11px]`}>Value</span>
              <span className={`${COL.delta} shrink-0 pl-[11px]`}>24h %</span>
              <span className={`${COL.type} shrink-0 pl-[11px]`}>Type</span>
              <span className={`${COL.spark} shrink-0`}>Last 30 Days</span>
            </div>

            {rows.map((r) => (
              <div
                key={r.name}
                className="flex items-center gap-[13px] border-b border-tn-200 pb-[11.5px] pl-3 pr-px pt-[12.5px]"
              >
                <div className={`${COL.name} flex shrink-0 items-center gap-2`}>
                  <button
                    aria-label={`Watch ${r.name}`}
                    className="flex h-7 shrink-0 items-center pl-2 pr-[10px] text-tn-400 transition-colors hover:text-tn-600"
                  >
                    <Star size={14} />
                  </button>
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-tn-200 text-tn-600">
                      <ChartPieSlice size={16} />
                    </span>
                    <span className="whitespace-nowrap text-[14px] font-semibold leading-5 text-tn-800">
                      {r.name}
                    </span>
                    {r.ticker && (
                      <span className="whitespace-nowrap pr-1 text-[12px] uppercase leading-4 text-tn-400">
                        {r.ticker}
                      </span>
                    )}
                  </div>
                </div>

                <div className={`${COL.value} shrink-0 pl-[11px] text-[14px] font-semibold leading-5 text-tn-800`}>
                  {r.value}
                </div>
                <div className={`${COL.delta} shrink-0 pl-[11px]`}>
                  <DeltaChip d={r.delta} suffix="%" />
                </div>
                <div className={`${COL.type} shrink-0 pl-[11px]`}>
                  <TypePill type={r.type} />
                </div>
                <div className={`${COL.spark} shrink-0`}>
                  <Sparkline
                    points={asPoints(r.series)}
                    tone={r.delta <= 0 ? "positive" : "danger"}
                    fill={false}
                    strokeWidth={1}
                    w={200}
                    h={24}
                    className="h-6 w-[200px]"
                  />
                </div>
              </div>
            ))}

            {rows.length === 0 && (
              <div className="flex h-[57px] items-center pl-3 text-[14px] text-text-muted">
                No streams of this type in the demo set.
              </div>
            )}
          </div>
        </div>

        <nav className="mt-4 flex h-[30px] items-center justify-center gap-2">
          <button className="grid size-[30px] place-items-center rounded-control text-text-muted hover:bg-card-alt">
            <CaretLeft size={14} />
          </button>
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              className={`grid size-[30px] place-items-center rounded-full text-[14px] leading-5 ${
                n === 1 ? "bg-accent font-medium text-text-invert" : "text-text-muted hover:bg-card-alt"
              }`}
            >
              {n}
            </button>
          ))}
          <button className="grid size-[30px] place-items-center rounded-control text-text-muted hover:bg-card-alt">
            <CaretRight size={14} />
          </button>
        </nav>
      </div>
    </Section>
  );
}

/* ---------- right rail blocks: 320 wide ---------- */

/* Component 19: 16/11.6 padded row. The icon sits in a 32 rounded-square
   (8px radius, not a circle) on tn/200 with a 16px accent badge clipped to its
   top-right. Title is Medium 500 at 14/20; the ticker drops to 12/16 regular
   uppercase in tn/500; the value is the only Semi Bold in the row. */
export function Watchlist() {
  return (
    <Section title="Watchlist" caption="demo">
      <Surface className="overflow-hidden">
        {demo.watchlist.map((r) => (
          <a
            key={r.title}
            className="flex items-center justify-between border-b border-border px-4 py-[11.6px] last:border-b-0 hover:bg-tn-150"
          >
            <div className="flex min-w-0 flex-1 items-center gap-[10px]">
              <span className="relative grid size-8 shrink-0 place-items-center rounded-[8px] bg-tn-200 text-tn-600">
                <ChartPieSlice size={20} />
                <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-accent text-text-invert">
                  <TrendUp size={10} weight="bold" />
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium leading-5 text-tn-800">
                  {r.title}
                </div>
                {r.sub && (
                  <div className="truncate text-[12px] uppercase leading-4 text-tn-500">
                    {r.sub}
                  </div>
                )}
              </div>
            </div>
            <div className="shrink-0 pl-2 text-right">
              <div className="text-[14px] font-semibold leading-5 text-tn-800">{r.value}</div>
              <div
                className={`flex items-center justify-end gap-1 text-[12px] font-medium leading-4 ${
                  r.delta === 0 ? "text-tn-500" : r.delta < 0 ? "text-up-500" : "text-down-500"
                }`}
              >
                {r.delta !== 0 &&
                  (r.delta < 0 ? <ArrowDown size={12} weight="bold" /> : <ArrowUp size={12} weight="bold" />)}
                {r.delta > 0 ? "+" : ""}
                {r.delta.toFixed(2)}
              </div>
            </div>
          </a>
        ))}
      </Surface>
    </Section>
  );
}

/* Component 20: 16/12 padded row, 12px gap. A 40 square thumbnail on an 8px
   radius carrying a 1px hairline shadow, then a 14/19.25 medium title and a
   12/16 regular date in tn/500. The macket's thumbnail is an article image;
   Hedgy has none, so the slot keeps its exact box and holds a glyph. */
export function Reports() {
  return (
    <Section title="Reports" caption="demo">
      <Surface className="overflow-hidden">
        {demo.reports.map((r) => (
          <a
            key={r.title}
            className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-tn-150"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-tn-200 text-tn-600 shadow-[0px_0px_0px_1px_rgba(0,0,0,0.05)]">
              <FileText size={18} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1 self-stretch">
              <div className="text-[14px] font-medium leading-[19.25px] text-tn-800">{r.title}</div>
              <div className="text-[12px] leading-4 text-tn-500">{r.date}</div>
            </div>
          </a>
        ))}
      </Surface>
    </Section>
  );
}

/* Component 21: 16/12 padded row, 10px gap, a 16-wide rank column at 11/16.5,
   title Medium 500 at 14/20, slug 11/16.5 regular uppercase, and the change as
   12/16 Semi Bold in the deep green (green/600) rather than the mid one. */
export function TopMovers() {
  const [tab, setTab] = useState<"Gainers" | "Losers">("Gainers");
  const rows = tab === "Gainers" ? demo.movers.gainers : demo.movers.losers;
  return (
    <Section title="Top movers" caption="period">
      <Surface className="overflow-hidden">
        <div className="px-4 pt-3">
          <Tabs
            items={["Gainers", "Losers"]}
            value={tab}
            onChange={(v) => setTab(v as "Gainers" | "Losers")}
          />
        </div>
        {rows.map((m, i) => (
          <a
            key={m.label}
            className="flex items-center gap-[10px] border-b border-border px-4 py-3 last:border-b-0 hover:bg-tn-150"
          >
            <span className="w-4 shrink-0 text-center text-[11px] leading-[16.5px] text-tn-500">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium leading-5 text-tn-800">
                {m.label}
              </div>
              <div className="truncate text-[11px] uppercase leading-[16.5px] text-tn-500">
                {m.value}
              </div>
            </div>
            <span
              className={`shrink-0 text-[12px] font-semibold leading-4 ${
                m.delta >= 0 ? "text-up-600" : "text-down-500"
              }`}
            >
              {m.delta > 0 ? "+" : ""}
              {m.delta.toFixed(2)}%
            </span>
          </a>
        ))}
      </Surface>
    </Section>
  );
}

/* Component 22: 16/12 padded row over a 1px tn/200 rule. The date is a filled
   64-wide rounded-8 block on tn/200 -- region code in accent blue at 11/16.5
   uppercase, the day at 11/11, the time stacked under it at 11/11 medium. The
   body runs an impact chip on a 10% red wash, a 14/19.25 medium title, and a
   12/16 note in tn/500. */
export function EconomicCalendar() {
  const [tab, setTab] = useState<string>(demo.calendarTabs[0]);
  const rows = tab === "All" ? demo.calendar : demo.calendar.filter((c) => c.region === tab);
  return (
    <Section title="Economic calendar" caption="demo">
      <Surface className="overflow-hidden">
        <div className="px-4 pt-3">
          <Tabs items={demo.calendarTabs} value={tab} onChange={setTab} />
        </div>
        {rows.map((c) => (
          <a
            key={`${c.date}-${c.title}`}
            className="flex border-b border-tn-200 px-4 py-3 last:border-b-0 hover:bg-tn-150"
          >
            <div className="flex w-full items-start gap-3">
              <div className="flex w-16 shrink-0 flex-col self-stretch rounded-[8px] bg-tn-200 px-2 py-1.5">
                <span className="text-[11px] font-semibold uppercase leading-[16.5px] text-accent">
                  {c.region}
                </span>
                <span className="pt-0.5 text-[11px] font-semibold leading-[11px] text-tn-800">
                  {c.date}
                </span>
                <span className="pt-1 text-[11px] font-medium leading-[11px] text-tn-500">
                  {c.time}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 self-stretch">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold uppercase leading-[16.5px] tracking-[0.275px] ${
                      c.impact === "high"
                        ? "bg-[rgba(251,90,90,0.1)] text-down-500"
                        : "bg-tn-150 text-tn-500"
                    }`}
                  >
                    {c.impact} impact
                  </span>
                  <ArrowSquareOut size={14} className="shrink-0 text-tn-400" />
                </div>
                <div className="text-[14px] font-medium leading-[19.25px] text-tn-800">
                  {c.title}
                </div>
                <div className="text-[12px] font-medium leading-4 text-tn-500">{c.note}</div>
              </div>
            </div>
          </a>
        ))}
      </Surface>
    </Section>
  );
}
