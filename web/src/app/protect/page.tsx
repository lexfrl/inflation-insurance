"use client";

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
import { Button, Callout, Card, Chip, Field, SectionTitle, Stat } from "@/components/ui";
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
      <SectionTitle
        title="Buy cover"
        sub="Choose how much of your monthly spending to cover and the inflation level to cover it above. The price and the payout both come straight from the contract."
      />

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

          {period && <PeriodStrip period={period} />}

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

  return (
    /* Summary and controls in a narrow left column, the chart given the rest
       of the width: the reference layout, and the right one here too, because
       the headline number and the shape it comes from need to be read
       together while the slider moves. */
    <div className="grid gap-4 lg:grid-cols-[330px_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-5 p-5">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-content-600">
              Cost today
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-4xl leading-none text-content-100 tnum">
                {premium === undefined ? "--" : formatUsdt(premium)}
              </span>
              <span className="text-sm text-content-500">USDT</span>
            </div>
            <div className="mt-2 text-sm text-content-300">
              Pays up to{" "}
              <span className="font-mono text-accent-300 tnum">
                {maxPayout === undefined ? "--" : formatUsdt(maxPayout)} USDT
              </span>
            </div>
          </div>
          <Field
            label="Monthly spending to protect"
            hint="Your payout scales with this amount."
          >
            <div className="relative">
              <input
                type="number"
                min={0}
                value={notionalInput}
                onChange={(e) => setNotionalInput(e.target.value)}
                className="w-full rounded-control border border-surface-600 bg-surface-850 px-3 py-2.5 pr-16 font-mono text-content-100 tnum placeholder:text-content-600 focus:border-accent-400"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-content-500">
                USDT
              </span>
            </div>
          </Field>

          <Field
            label="Cover me above"
            hint={`Pays nothing below this. Capped at ${formatBps(period.capBps)}.`}
          >
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl text-accent-300 tnum">{formatBps(strikeBps)}</span>
              <span className="text-xs text-content-600">inflation</span>
            </div>
            <input
              type="range"
              min={0}
              max={capBps - 1}
              value={strikeBps}
              onChange={(e) => setStrikeBps(Number(e.target.value))}
              className="w-full"
              aria-label="Inflation level to cover above"
            />
          </Field>

          <div className="mt-auto flex flex-col gap-3">
            {!isConnected ? (
              <Callout tone="muted">Connect a wallet to buy protection.</Callout>
            ) : !saleOpen ? (
              <Callout tone="muted">The sale window for this period has closed.</Callout>
            ) : needsApproval ? (
              <Button
                disabled={approve.isPending || approveReceipt.isLoading || premium === undefined}
                onClick={() =>
                  approve.writeContract({
                    address: addresses.usdt,
                    abi: mockUsdtAbi,
                    functionName: "approve",
                    // Approve max, not the exact premium: moving the strike
                    // slider changes the quote, which would otherwise force a
                    // second approval mid-demo. MockUSDT is a fake testnet
                    // token, so an unlimited approval carries no real risk.
                    args: [addresses.insurance, maxUint256],
                    chainId,
                  })
                }
                className="w-full"
              >
                {approve.isPending || approveReceipt.isLoading ? "Approving USDT" : "Approve USDT"}
              </Button>
            ) : (
              <Button
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
                className="w-full"
              >
                {buy.isPending || buyReceipt.isLoading ? "Buying protection" : "Buy protection"}
              </Button>
            )}

            {buyReceipt.isSuccess && <Callout tone="positive">Protection purchased.</Callout>}

            {/* Surface write reverts (e.g. "insufficient pool backing" when no
                LP has deposited yet) -- silently swallowing these leaves a
                clicked button that just... does nothing, which is exactly the
                confusing failure mode this caught during testing. Pre-flight
                rejections land in `approve.error`/`buy.error`; a revert that
                still made it on-chain surfaces as `approveReceipt`/`buyReceipt`
                ending in `isError` instead (see lib/tx.ts), so both need
                checking. */}
            {(approve.error || buy.error || approveReverted || buyReverted) && (
              <Callout tone="danger">
                {(approve.error ?? buy.error)?.message.split("\n")[0] ??
                  txErrorMessage(approveReceipt) ??
                  txErrorMessage(buyReceipt) ??
                  "Transaction reverted on-chain."}
              </Callout>
            )}
          </div>
        </Card>

        <QuickFacts period={period} />
      </div>

      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium text-content-100">
              What you receive, at every level of inflation
            </h3>
            <span className="rounded-control border border-surface-700 bg-surface-800 px-2.5 py-1 text-[11px] text-content-500">
              Cover above {formatBps(strikeBps)}
            </span>
          </div>
          <PayoffChart
            capBps={capBps}
            strikeBps={strikeBps}
            notional={Number(notional) / 1_000_000}
            buckets={period.cpiBucketsBps.map(Number)}
            probs={period.probBps.map(Number)}
            settlementCpiBps={period.settled ? Number(period.settlementCpiBps) : null}
          />
          <p className="mt-3 text-xs leading-relaxed text-content-600">
            Bars show where inflation is expected to land, and how likely each outcome is. The
            line is what you receive if it lands there.
          </p>
        </Card>

        <Card className="p-5">
          <ScenarioTable
            period={period}
            strikeBps={strikeBps}
            notional={notional}
            premium={premium}
          />
        </Card>
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
    <Card className="p-5">
      <h3 className="text-sm font-medium text-content-100">Quick facts</h3>
      <dl className="mt-3">
        {facts.map(([k, v], i) => (
          <div
            key={k}
            className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm ${
              i > 0 ? "border-t border-surface-700" : ""
            }`}
          >
            <dt className="shrink-0 text-content-500">{k}</dt>
            <dd className="ml-auto text-right font-mono text-content-100 tnum">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/* What the period itself is, before any of the buying controls. Without this
   the page opened straight onto a form with no sense of what is being bought,
   how long it stays open, or whether anyone is backing it. */
function PeriodStrip({ period }: { period: Period }) {
  const now = useNow();
  const saleLeft = Number(period.saleEnd) - now;
  const backing = period.totalCollateral + period.totalPremiums - period.totalClaimed;
  const soldOut = period.totalMaxLiability >= backing && backing > 0n;

  return (
    <Card className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-4">
      <Stat label="Buying closes in" value={formatCountdown(saleLeft)} />
      <Stat label="Covers inflation up to" value={formatBps(period.capBps)} />
      <Stat label="Money backing payouts" value={formatUsdt(backing)} unit="USDT" tone="accent" />
      <Stat
        label="Cover sold so far"
        value={formatUsdt(period.totalMaxLiability)}
        unit="USDT"
        tone={soldOut ? "positive" : "default"}
      />
    </Card>
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
