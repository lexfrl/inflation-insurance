"use client";

import { ShieldCheck } from "@phosphor-icons/react";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { maxUint256 } from "viem";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { inflationHedgeAbi, mockUsdtAbi } from "@/lib/generated";
import { useDemoTarget } from "@/lib/demo-mode";
import { formatBps, formatCountdown, formatUsdt, parseUsdt } from "@/lib/format";
import { txErrorMessage, txReverted } from "@/lib/tx";
import { useNow } from "@/lib/useNow";
import { PayoffChart } from "@/components/payoff-chart";
import { Button, Callout, Card, Chip } from "@/components/ui";
import { MyPolicies } from "@/components/policies";

type Period = {
  label: string;
  capBps: bigint;
  saleEnd: bigint;
  periodEnd: bigint;
  claimDeadline: bigint;
  loadBps: bigint;
  cpiBucketsBps: readonly bigint[];
  probBps: readonly bigint[];
  totalCollateral: bigint;
  totalPremiums: bigint;
  totalMaxLiability: bigint;
  totalShares: bigint;
  settlementCpiBps: bigint;
  settled: boolean;
  totalClaimed: bigint;
};

/* useSearchParams needs a Suspense boundary above it for prerendering, so the
   page body is split out and wrapped here. */
export default function BuyerPage() {
  return (
    <Suspense fallback={<Card className="h-[420px] animate-pulse" />}>
      <BuyerPageBody />
    </Suspense>
  );
}

function BuyerPageBody() {
  const { address, isConnected } = useAccount();
  const { chainId, addresses } = useDemoTarget();

  const {
    data: periods,
    isError: periodsFailed,
    refetch: refetchPeriods,
  } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "listPeriods",
    chainId,
    query: { refetchInterval: 4000 },
  });

  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  // Derived, not effect-driven: defaults to the first period once periods
  // load, but a user click always wins once they've made a choice.
  const effectiveSelectedPeriodId = selectedPeriodId ?? (periods && periods.length > 0 ? 0 : null);

  const period =
    effectiveSelectedPeriodId !== null ? (periods?.[effectiveSelectedPeriodId] as Period | undefined) : undefined;
  const now = useNow();
  const saleOpen = period ? now < Number(period.saleEnd) : false;

  return (
    <div className="flex flex-col gap-8">
      {/* An unreachable RPC never resolves this read, so gating the skeleton
          on `data === undefined` alone leaves it pulsing forever. That is
          also the exact failure a judge sees on a flaky connection, so it
          gets a real message and a way out rather than an endless shimmer. */}
      {periodsFailed ? (
        <Card className="flex flex-col items-center gap-4 p-10 text-center">
          <div>
            <p className="text-content-100">Can&apos;t reach the network right now.</p>
            <p className="mt-2 text-sm text-content-500">
              The contract read failed. Check that your wallet is on the right network, then try
              again.
            </p>
          </div>
          <Button variant="secondary" onClick={() => refetchPeriods()}>
            Retry
          </Button>
        </Card>
      ) : periods === undefined ? (
        <Card className="h-[420px] animate-pulse" />
      ) : periods.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-content-100">No protection period is open yet.</p>
          <p className="mt-2 text-sm text-content-500">
            An operator opens each period with its CPI terms before cover can be bought.
          </p>
        </Card>
      ) : (
        <>
          {/* Only shown when there is a choice to make. The macket's section
              carries no selector at all, and with a single demo period a chip
              row is furniture, not navigation. */}
          {periods.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {periods.map((p, i) => (
                <Chip
                  key={i}
                  active={effectiveSelectedPeriodId === i}
                  onClick={() => setSelectedPeriodId(i)}
                >
                  {(p as Period).label}
                </Chip>
              ))}
            </div>
          )}

          {period && effectiveSelectedPeriodId !== null && (
            <BuyForm
              periodId={effectiveSelectedPeriodId}
              period={period}
              saleOpen={saleOpen}
              isConnected={isConnected}
              onBought={() => refetchPeriods()}
            />
          )}
        </>
      )}

      {address && <MyPolicies address={address} />}
    </div>
  );
}

function BuyForm({
  periodId,
  period,
  saleOpen,
  isConnected,
  onBought,
}: {
  periodId: number;
  period: Period;
  saleOpen: boolean;
  isConnected: boolean;
  onBought: () => void;
}) {
  const { address } = useAccount();
  const { chainId, addresses } = useDemoTarget();
  const params = useSearchParams();
  // Seeded once from the dashboard's prompt panel, then owned by this form.
  const [notionalInput, setNotionalInput] = useState(() => params.get("spend") ?? "1000");
  const [strikeBps, setStrikeBps] = useState(() => Number(params.get("strike") ?? 300));

  const notional = parseUsdt(notionalInput);
  const capBps = Number(period.capBps);

  const { data: quoteData } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "quote",
    args: [BigInt(periodId), notional, BigInt(strikeBps)],
    chainId,
    query: { enabled: notional > 0n && strikeBps < capBps },
  });
  const [premium, maxPayout] = quoteData ?? [undefined, undefined];

  // refetchInterval as a safety net, but the approve effect below also
  // force-refetches on success -- a bare timer left the button stuck on
  // "Approve USDT" for a full account's first approve during testing,
  // because this read only starts polling once `address` is defined, and
  // its first tick can land before the approve tx even lands.
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: addresses.usdt,
    abi: mockUsdtAbi,
    functionName: "allowance",
    args: address ? [address, addresses.insurance] : undefined,
    chainId,
    query: { enabled: !!address, refetchInterval: 4000 },
  });

  const needsApproval = premium !== undefined && (allowance === undefined || allowance < premium);

  const approve = useWriteContract();
  const approveReceipt = useWaitForTransactionReceipt({ hash: approve.data });
  const approveReverted = txReverted(approveReceipt);
  const buy = useWriteContract();
  const buyReceipt = useWaitForTransactionReceipt({ hash: buy.data });
  const buyReverted = txReverted(buyReceipt);

  useEffect(() => {
    if (approveReceipt.isSuccess) refetchAllowance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveReceipt.isSuccess]);

  useEffect(() => {
    // A reverted buyPolicy() (e.g. "insufficient pool backing") makes this
    // query end in isError, not isSuccess -- see lib/tx.ts. Only refresh
    // policies on a real win.
    if (buyReceipt.isSuccess) onBought();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyReceipt.isSuccess]);

  /* Which figure the headline shows. The macket's summary card carries two
     metric toggles under the number (MOM / YOY); these are the two figures a
     cover buyer actually flips between. */
  const [metric, setMetric] = useState<"cost" | "payout">("cost");

  const action = !isConnected ? (
    <Callout tone="muted">Connect a wallet</Callout>
  ) : !saleOpen ? (
    <Callout tone="muted">Sale closed</Callout>
  ) : needsApproval ? (
    <button
      disabled={approve.isPending || approveReceipt.isLoading || premium === undefined}
      onClick={() =>
        approve.writeContract({
          address: addresses.usdt,
          abi: mockUsdtAbi,
          functionName: "approve",
          // Approve max, not the exact premium: changing the strike changes
          // the quote, which would otherwise force a second approval mid-demo.
          // MockUSDT is a fake testnet token, so this carries no real risk.
          args: [addresses.insurance, maxUint256],
          chainId,
        })
      }
      className="flex h-9 items-center rounded-full bg-accent px-4 text-[12px] font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
    >
      {approve.isPending || approveReceipt.isLoading ? "Approving" : "Approve USDT"}
    </button>
  ) : (
    <button
      disabled={buy.isPending || buyReceipt.isLoading || premium === undefined}
      onClick={() =>
        buy.writeContract({
          address: addresses.insurance,
          abi: inflationHedgeAbi,
          functionName: "buyPolicy",
          args: [BigInt(periodId), notional, BigInt(strikeBps)],
          chainId,
        })
      }
      className="flex h-9 items-center rounded-full bg-accent px-4 text-[12px] font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
    >
      {buy.isPending || buyReceipt.isLoading ? "Buying" : "Buy cover"}
    </button>
  );

  return (
    /* section#v2-index (4:5210): a 320 rail beside a 1104 chart card on a 16
       gutter, and nothing above it. The rail is exactly two cards -- a 193-tall
       summary (4:5212) and Quick Facts (4:5256) -- so the buying controls live
       in the chart card's toolbar, which is the row the macket fills with its
       own actions. The strike is set by the footer range pills, which is that
       section's range selector doing the job it already does. */
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <div className="shimmer-ring flex h-[193px] flex-col gap-4 rounded-[16px] bg-surface p-5">
          <div className="flex w-full items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
              <ShieldCheck size={14} />
            </span>
            <span className="text-[14px] font-semibold leading-[19.25px] text-ink">
              Cover above {formatBps(strikeBps)}
            </span>
            <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium leading-5 text-muted">
              USDT
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <p className="font-mono text-[35px] leading-9 text-ink tnum">
              {metric === "cost"
                ? premium === undefined
                  ? "--"
                  : formatUsdt(premium)
                : maxPayout === undefined
                  ? "--"
                  : formatUsdt(maxPayout)}
            </p>
            <p className="text-[14px] leading-5 text-muted">
              {metric === "cost" ? "cost today" : `most it can pay, at ${formatBps(period.capBps)}`}
            </p>
          </div>

          {/* Two flex-1 pills on the tn/100 fill, 12/8 padding, 12 radius. */}
          <div className="mt-auto flex w-full gap-2">
            {(["cost", "payout"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                aria-pressed={metric === m}
                className={`flex flex-1 items-center justify-between rounded-[12px] bg-surface-2 px-3 py-2 text-[12px] leading-4 transition-colors ${
                  metric === m ? "text-accent" : "text-muted hover:text-ink"
                }`}
              >
                {m === "cost" ? "COST" : "PAYOUT"}
                <span
                  className={`size-1.5 rounded-full ${metric === m ? "bg-accent" : "bg-transparent"}`}
                />
              </button>
            ))}
          </div>
        </div>

        <QuickFacts period={period} />
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-[16px] bg-surface px-4 pt-6">
          {/* div.v2-toolbar (4:5338): 48 tall, actions right-aligned at 36. */}
          <div className="flex h-12 items-start justify-end">
            <div className="flex h-9 items-center gap-2">
              <label className="relative flex h-9 w-[150px] items-center">
                <span className="sr-only">Monthly spending to protect</span>
                <input
                  type="number"
                  min={0}
                  value={notionalInput}
                  onChange={(e) => setNotionalInput(e.target.value)}
                  className="h-9 w-full rounded-full bg-surface-2 pl-3 pr-12 font-mono text-[12px] text-ink tnum outline-none focus:ring-1 focus:ring-accent"
                />
                <span className="pointer-events-none absolute right-3 text-[11px] text-dim">
                  USDT
                </span>
              </label>
              {action}
            </div>
          </div>

          <div className="h-[440px]">
            <PayoffChart
              capBps={capBps}
              strikeBps={strikeBps}
              notional={Number(notional) / 1_000_000}
              buckets={period.cpiBucketsBps.map(Number)}
              probs={period.probBps.map(Number)}
              settlementCpiBps={period.settled ? Number(period.settlementCpiBps) : null}
              className="h-full w-full"
            />
          </div>

          <div className="flex h-[38px] flex-wrap items-center justify-between gap-2 pb-1">
            <span className="flex h-[34px] items-center gap-2 rounded-[8px] border border-line px-3">
              <span className="size-3 rounded-[3px] bg-accent" />
              <span className="text-[14px] leading-5 text-ink">What you receive, in USDT</span>
            </span>

            {/* ul.flex (4:5402): 28-tall pills on a 2px gap; the selected one is
                an accent fill with a 1px tinted shadow, the rest sit at half
                opacity. This is the strike control. */}
            <ul className="flex items-center gap-0.5">
              {[0, 200, 300, 400, 500]
                .filter((st) => st < capBps)
                .map((st) => {
                  const active = st === strikeBps;
                  return (
                    <li key={st}>
                      <button
                        onClick={() => setStrikeBps(st)}
                        aria-pressed={active}
                        className={`flex h-7 items-center justify-center rounded-full px-2.5 text-[12px] font-semibold leading-4 ${
                          active
                            ? "bg-accent text-on-accent shadow-[0px_1px_1px_rgba(255,195,76,0.22)]"
                            : "text-muted opacity-50 hover:opacity-100"
                        }`}
                      >
                        {formatBps(st, 0)}
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>
        </div>

        {/* Write failures have to be visible: a clicked button that silently
            does nothing is the exact confusing failure this caught in testing.
            Pre-flight rejections land in `approve.error`/`buy.error`; a revert
            that still made it on-chain surfaces as `isError` on the receipt. */}
        {(buyReceipt.isSuccess || approve.error || buy.error || approveReverted || buyReverted) && (
          <div className="flex flex-col gap-2">
            {buyReceipt.isSuccess && <Callout tone="positive">Protection purchased.</Callout>}
            {(approve.error || buy.error || approveReverted || buyReverted) && (
              <Callout tone="danger">
                {(approve.error ?? buy.error)?.message.split("\n")[0] ??
                  txErrorMessage(approveReceipt) ??
                  txErrorMessage(buyReceipt) ??
                  "Transaction reverted on-chain."}
              </Callout>
            )}
          </div>
        )}

        <div className="rounded-[16px] bg-surface p-5">
          <ScenarioTable
            period={period}
            strikeBps={strikeBps}
            notional={notional}
            premium={premium}
          />
        </div>
      </div>
    </div>
  );
}

/* The reference's "Quick Facts" panel: the terms of the thing you are looking
   at, stated plainly, straight from the period on-chain. */
function QuickFacts({ period }: { period: Period }) {
  const now = useNow();
  const facts: [string, string][] = [
    ["Period", period.label],
    ["Covers inflation up to", formatBps(period.capBps)],
    ["Buying closes in", formatCountdown(Number(period.saleEnd) - now)],
    ["Period ends in", formatCountdown(Number(period.periodEnd) - now)],
    ["Outcomes priced", String(period.cpiBucketsBps.length)],
    ["Pricing load", `${(Number(period.loadBps) / 10_000).toFixed(2)}x expected value`],
    [
      "Settlement",
      period.settled ? `${formatBps(period.settlementCpiBps)} posted` : "Awaiting the official figure",
    ],
  ];

  return (
    <div className="rounded-[16px] bg-surface p-5">
      <p className="text-[14px] font-semibold leading-5 text-tn-800">Quick facts</p>
      <dl className="mt-2">
        {facts.map(([k, v], i) => (
          <div
            key={k}
            className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-[14px] leading-5 ${
              i > 0 ? "border-t border-tn-200" : ""
            }`}
          >
            <dt className="shrink-0 text-tn-500">{k}</dt>
            <dd className="ml-auto text-right font-semibold text-tn-800 tnum">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}


/* The payoff curve says what the shape is; this says what it means in money.
   Every row is one of the CPI outcomes the period is actually priced against,
   so the reader sees the probability, the payout, and whether that leaves
   them ahead of the premium -- which is the question they are really asking. */
function ScenarioTable({
  period,
  strikeBps,
  notional,
  premium,
}: {
  period: Period;
  strikeBps: number;
  notional: bigint;
  premium: bigint | undefined;
}) {
  const capBps = Number(period.capBps);
  const rows = period.cpiBucketsBps.map((bucket, i) => {
    const cpi = Number(bucket);
    const covered = Math.min(Math.max(cpi - strikeBps, 0), Math.max(capBps - strikeBps, 0));
    // Same arithmetic the contract uses, in the same 6-decimal base units, so
    // rounding matches what `claim()` would actually pay.
    const payout = (notional * BigInt(covered)) / 10_000n;
    const net = premium === undefined ? undefined : payout - premium;
    return { cpi, prob: Number(period.probBps[i] ?? 0), payout, net };
  });

  return (
    <div>
      <div className="mb-2 text-sm font-medium text-content-300">What you would get</div>
      <div className="overflow-hidden rounded-control border border-surface-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-800 text-[11px] uppercase tracking-[0.06em] text-content-500">
              <th className="px-3 py-2 text-left font-medium">Inflation</th>
              <th className="px-3 py-2 text-right font-medium">Chance</th>
              <th className="px-3 py-2 text-right font-medium">You get</th>
              <th className="px-3 py-2 text-right font-medium">After cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cpi} className="border-t border-surface-700">
                <td className="px-3 py-2 font-mono text-content-100 tnum">{formatBps(r.cpi)}</td>
                <td className="px-3 py-2 text-right font-mono text-content-500 tnum">
                  {formatBps(r.prob, 0)}
                </td>
                <td className="px-3 py-2 text-right font-mono tnum text-content-100">
                  {formatUsdt(r.payout)}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono tnum ${
                    r.net === undefined
                      ? "text-content-600"
                      : r.net > 0n
                        ? "text-signal-positive"
                        : "text-content-500"
                  }`}
                >
                  {r.net === undefined
                    ? "-"
                    : `${r.net > 0n ? "+" : ""}${formatUsdt(r.net)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
