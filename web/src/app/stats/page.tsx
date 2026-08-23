"use client";

import { useEffect, useMemo, useState } from "react";
import { useReadContract, useReadContracts, usePublicClient } from "wagmi";
import { inflationHedgeAbi } from "@/lib/generated";
import { useDemoTarget } from "@/lib/demo-mode";
import { isLocalDev } from "@/lib/wagmi";
import { formatBps, formatDate, formatUsdt } from "@/lib/format";
import { Card, SectionTitle, Stat } from "@/components/ui";

/* Everyone's position, on one page -- every LP's deposit and every buyer's
   policy, across every period. Nothing here is derived or cached: it's read
   straight off the contract, the same as the buyer/LP/admin pages, just
   aggregated instead of scoped to one connected address.

   There's no on-chain "list all LPs" -- `lpShares` is a mapping, not an
   array -- so LPs are discovered from `Deposited` event logs (the contract
   never clears a deposit's history, even after a later withdrawal) and then
   read back individually via `lpPosition`/`lpWithdrawn` for the current
   truth. Policies don't need that: `policyCount` + `getPolicy(id)` already
   enumerate everything directly. */

const DEPLOYMENT_BLOCK_BASE_SEPOLIA = 45_860_988n;

type Period = {
  label: string;
  capBps: bigint;
  saleEnd: bigint;
  periodEnd: bigint;
  totalCollateral: bigint;
  totalPremiums: bigint;
  totalMaxLiability: bigint;
  totalShares: bigint;
  totalClaimed: bigint;
  settled: boolean;
  settlementCpiBps: bigint;
};

type Policy = {
  periodId: bigint;
  owner: `0x${string}`;
  notional: bigint;
  strikeBps: bigint;
  maxPayout: bigint;
  premiumPaid: bigint;
  claimed: boolean;
};

type LpPair = { periodId: bigint; lp: `0x${string}` };

function short(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function StatsPage() {
  const { chainId, addresses } = useDemoTarget();
  const publicClient = usePublicClient({ chainId });

  const { data: periods } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "listPeriods",
    chainId,
    query: { refetchInterval: 10_000 },
  });

  const { data: policyCount } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "policyCount",
    chainId,
    query: { refetchInterval: 10_000 },
  });

  const policyIds = useMemo(
    () => Array.from({ length: policyCount === undefined ? 0 : Number(policyCount) }, (_, i) => BigInt(i)),
    [policyCount],
  );
  const policyContracts = useMemo(
    () =>
      policyIds.map((id) => ({
        address: addresses.insurance,
        abi: inflationHedgeAbi,
        functionName: "getPolicy" as const,
        args: [id] as const,
        chainId,
      })),
    [policyIds, addresses.insurance, chainId],
  );
  const { data: policyResults } = useReadContracts({
    contracts: policyContracts,
    query: { enabled: policyContracts.length > 0 },
  });

  // `Deposited` logs, scanned once per (client, contract) rather than on
  // every render -- `getLogs` isn't a `useReadContract`-style query hook,
  // it's a one-off RPC call this component drives itself.
  const [lpPairs, setLpPairs] = useState<LpPair[] | undefined>(undefined);
  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    (async () => {
      try {
        const logs = await publicClient.getContractEvents({
          address: addresses.insurance,
          abi: inflationHedgeAbi,
          eventName: "Deposited",
          fromBlock: isLocalDev ? 0n : DEPLOYMENT_BLOCK_BASE_SEPOLIA,
          toBlock: "latest",
        });
        const seen = new Map<string, LpPair>();
        for (const log of logs) {
          const args = log.args as { periodId?: bigint; lp?: `0x${string}` };
          if (args.periodId === undefined || !args.lp) continue;
          seen.set(`${args.periodId}-${args.lp.toLowerCase()}`, { periodId: args.periodId, lp: args.lp });
        }
        if (!cancelled) setLpPairs([...seen.values()]);
      } catch {
        if (!cancelled) setLpPairs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient, addresses.insurance]);

  const lpContracts = useMemo(
    () =>
      (lpPairs ?? []).flatMap((p) => [
        {
          address: addresses.insurance,
          abi: inflationHedgeAbi,
          functionName: "lpPosition" as const,
          args: [p.periodId, p.lp] as const,
          chainId,
        },
        {
          address: addresses.insurance,
          abi: inflationHedgeAbi,
          functionName: "lpWithdrawn" as const,
          args: [p.periodId, p.lp] as const,
          chainId,
        },
      ]),
    [lpPairs, addresses.insurance, chainId],
  );
  const { data: lpResults } = useReadContracts({
    contracts: lpContracts,
    query: { enabled: lpContracts.length > 0 },
  });

  const loading = periods === undefined || policyCount === undefined || lpPairs === undefined;

  const totalCollateral = (periods ?? []).reduce((sum, p) => sum + (p as Period).totalCollateral, 0n);
  const totalPremiums = (periods ?? []).reduce((sum, p) => sum + (p as Period).totalPremiums, 0n);
  const uniqueLps = new Set((lpPairs ?? []).map((p) => p.lp.toLowerCase())).size;
  const uniqueBuyers = new Set(
    (policyResults ?? [])
      .map((r) => (r.result as Policy | undefined)?.owner)
      .filter((a): a is `0x${string}` => !!a)
      .map((a) => a.toLowerCase()),
  ).size;

  return (
    <div className="flex flex-col gap-8">
      <SectionTitle
        title="Protocol stats"
        sub="Every position in every period, read straight off the contract -- every LP's deposit, every buyer's policy."
      />

      <Card className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-4">
        <Stat label="Periods" value={String(periods?.length ?? 0)} loading={loading} />
        <Stat label="Total collateral + premiums" value={formatUsdt(totalCollateral + totalPremiums)} unit="USDT" loading={loading} />
        <Stat label="Liquidity providers" value={String(uniqueLps)} loading={loading} />
        <Stat label="Policies / buyers" value={`${policyIds.length} / ${uniqueBuyers}`} loading={loading} />
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-content-100">Periods</h2>
        {!periods || periods.length === 0 ? (
          <Card className="p-6 text-sm text-content-500">No periods created yet.</Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {periods.map((p, i) => {
              const period = p as Period;
              const remaining = period.totalCollateral + period.totalPremiums - period.totalClaimed;
              return (
                <Card key={i} className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-content-100">{period.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        period.settled
                          ? "bg-signal-positive/10 text-signal-positive"
                          : "border border-surface-600 text-content-500"
                      }`}
                    >
                      {period.settled ? `Settled - ${formatBps(period.settlementCpiBps)} CPI` : "Open"}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Stat label="Collateral" value={formatUsdt(period.totalCollateral)} unit="USDT" />
                    <Stat label="Premiums" value={formatUsdt(period.totalPremiums)} unit="USDT" tone="positive" />
                    <Stat label="Max liability" value={formatUsdt(period.totalMaxLiability)} unit="USDT" />
                    <Stat label="Pool remaining" value={formatUsdt(remaining)} unit="USDT" />
                    <Stat
                      label="LP door"
                      value={period.totalMaxLiability > 0n ? "Closed" : "Open"}
                      tone={period.totalMaxLiability > 0n ? "default" : "accent"}
                    />
                    <Stat label="Sale closes" value={formatDate(period.saleEnd)} />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-content-100">Liquidity providers</h2>
        {lpPairs !== undefined && lpPairs.length === 0 ? (
          <Card className="p-6 text-sm text-content-500">No deposits yet.</Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-surface-700 text-left text-xs uppercase tracking-wide text-content-600">
                  <th className="px-4 py-3 font-medium">LP</th>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 font-medium">Deposited</th>
                  <th className="px-4 py-3 font-medium">Share of pool</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(lpPairs ?? []).map((pair, i) => {
                  const position = lpResults?.[i * 2]?.result as [bigint, bigint] | undefined;
                  const withdrawn = lpResults?.[i * 2 + 1]?.result as boolean | undefined;
                  const label = (periods?.[Number(pair.periodId)] as Period | undefined)?.label ?? `Period ${pair.periodId}`;
                  return (
                    <tr key={`${pair.periodId}-${pair.lp}`} className="border-b border-surface-800 last:border-0">
                      <td className="px-4 py-3 font-mono tnum text-content-200" title={pair.lp}>
                        {short(pair.lp)}
                      </td>
                      <td className="px-4 py-3 text-content-300">{label}</td>
                      <td className="px-4 py-3 font-mono tnum text-content-100">
                        {position ? `${formatUsdt(position[0])} USDT` : "-"}
                      </td>
                      <td className="px-4 py-3 font-mono tnum text-content-300">
                        {position ? formatBps(position[1]) : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={withdrawn ? "text-content-500" : "text-signal-positive"}>
                          {withdrawn ? "Withdrawn" : "Active"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-content-100">Policies</h2>
        {policyIds.length === 0 ? (
          <Card className="p-6 text-sm text-content-500">No policies bought yet.</Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-surface-700 text-left text-xs uppercase tracking-wide text-content-600">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Buyer</th>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 font-medium">Notional</th>
                  <th className="px-4 py-3 font-medium">Strike</th>
                  <th className="px-4 py-3 font-medium">Premium paid</th>
                  <th className="px-4 py-3 font-medium">Max payout</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {policyIds.map((id, i) => {
                  const policy = policyResults?.[i]?.result as Policy | undefined;
                  if (!policy) return null;
                  const label = (periods?.[Number(policy.periodId)] as Period | undefined)?.label ?? `Period ${policy.periodId}`;
                  return (
                    <tr key={id.toString()} className="border-b border-surface-800 last:border-0">
                      <td className="px-4 py-3 font-mono tnum text-content-500">{id.toString()}</td>
                      <td className="px-4 py-3 font-mono tnum text-content-200" title={policy.owner}>
                        {short(policy.owner)}
                      </td>
                      <td className="px-4 py-3 text-content-300">{label}</td>
                      <td className="px-4 py-3 font-mono tnum text-content-100">{formatUsdt(policy.notional)} USDT</td>
                      <td className="px-4 py-3 font-mono tnum text-accent-300">{formatBps(policy.strikeBps)}</td>
                      <td className="px-4 py-3 font-mono tnum text-content-300">{formatUsdt(policy.premiumPaid)} USDT</td>
                      <td className="px-4 py-3 font-mono tnum text-content-300">{formatUsdt(policy.maxPayout)} USDT</td>
                      <td className="px-4 py-3">
                        <span className={policy.claimed ? "text-content-500" : "text-signal-positive"}>
                          {policy.claimed ? "Claimed" : "Unclaimed"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}
