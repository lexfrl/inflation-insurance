"use client";

import { useEffect, useMemo } from "react";
import { useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { inflationHedgeAbi } from "@/lib/generated";
import { useDemoTarget } from "@/lib/demo-mode";
import { formatBps, formatDate, formatUsdt } from "@/lib/format";
import { txErrorMessage, txReverted } from "@/lib/tx";
import { useNow } from "@/lib/useNow";
import { Button, Callout, Card } from "@/components/ui";

/* Shared between the buy page (where a just-bought policy has to appear right
   after the transaction lands) and the profile (where holdings are the whole
   point), so the two can never drift into showing the same position two
   different ways. */

type Period = {
  claimDeadline: bigint;
  settled: boolean;
};

export function MyPolicies({
  address,
  heading = "Your cover",
}: {
  address: `0x${string}`;
  heading?: string;
}) {
  const { chainId, addresses } = useDemoTarget();

  // refetchInterval so a just-bought policy shows up here without needing
  // BuyForm to reach into this sibling component's query -- this is exactly
  // the read a judge is watching right after they click "Buy protection".
  const { data: policyIds } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "getPoliciesOf",
    args: [address],
    chainId,
    query: { refetchInterval: 4000 },
  });

  const contracts = useMemo(
    () =>
      (policyIds ?? []).map((id) => ({
        address: addresses.insurance,
        abi: inflationHedgeAbi,
        functionName: "getPolicy" as const,
        args: [id] as const,
        chainId,
      })),
    [policyIds, addresses.insurance, chainId],
  );

  const { data: policies, refetch } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0 },
  });

  if (!policyIds || policyIds.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-tight text-paper-100">{heading}</h2>
      <div className="flex flex-col gap-3">
        {policyIds.map((id, i) => {
          const policy = policies?.[i]?.result as
            | {
                periodId: bigint;
                owner: `0x${string}`;
                notional: bigint;
                strikeBps: bigint;
                maxPayout: bigint;
                premiumPaid: bigint;
                claimed: boolean;
              }
            | undefined;
          if (!policy) return null;
          return <PolicyRow key={id.toString()} policyId={id} policy={policy} onClaimed={() => refetch()} />;
        })}
      </div>
    </section>
  );
}

function PolicyRow({
  policyId,
  policy,
  onClaimed,
}: {
  policyId: bigint;
  policy: {
    periodId: bigint;
    notional: bigint;
    strikeBps: bigint;
    maxPayout: bigint;
    premiumPaid: bigint;
    claimed: boolean;
  };
  onClaimed: () => void;
}) {
  const { chainId, addresses } = useDemoTarget();

  const { data: period } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "getPeriod",
    args: [policy.periodId],
    chainId,
  });

  const claim = useWriteContract();
  const claimReceipt = useWaitForTransactionReceipt({ hash: claim.data });
  const claimReverted = txReverted(claimReceipt);

  useEffect(() => {
    if (claimReceipt.isSuccess) onClaimed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimReceipt.isSuccess]);

  const now = useNow();
  const settled = (period as Period | undefined)?.settled ?? false;
  const claimDeadline = (period as Period | undefined)?.claimDeadline;
  // claimDeadline is derived by the contract at settlement time (settledAt +
  // claimWindowSecs) -- see InflationHedge.postSettlement. Pre-settlement
  // it's just 0, not "unset" at the type level (it's a bigint, never
  // `undefined`), so this must gate on `settled` too or it renders a claim
  // deadline of the Unix epoch before any period has actually settled.
  const hasClaimDeadline = settled && claimDeadline !== undefined;
  const expired = hasClaimDeadline && now > Number(claimDeadline);

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="font-medium text-paper-100">
            <span className="font-mono tnum">{formatUsdt(policy.notional)} USDT</span> covered above{" "}
            <span className="font-mono tnum text-accent-300">{formatBps(policy.strikeBps)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-paper-500">
            <span>
              Max payout <span className="font-mono tnum">{formatUsdt(policy.maxPayout)}</span>
            </span>
            <span>
              Premium paid <span className="font-mono tnum">{formatUsdt(policy.premiumPaid)}</span>
            </span>
            {hasClaimDeadline && <span>Claim by {formatDate(claimDeadline)}</span>}
          </div>
        </div>
        {policy.claimed ? (
          <span className="shrink-0 text-sm text-paper-600">Claimed</span>
        ) : (
          <Button
            variant={settled && !expired ? "primary" : "secondary"}
            disabled={!settled || expired || claim.isPending || claimReceipt.isLoading}
            onClick={() =>
              claim.writeContract({
                address: addresses.insurance,
                abi: inflationHedgeAbi,
                functionName: "claim",
                args: [policyId],
                chainId,
              })
            }
            className="shrink-0"
          >
            {claim.isPending || claimReceipt.isLoading
              ? "Claiming"
              : !settled
                ? "Awaiting settlement"
                : expired
                  ? "Claim window closed"
                  : "Claim payout"}
          </Button>
        )}
      </div>
      {(claim.error || claimReverted) && (
        <div className="mt-3">
          <Callout tone="danger">
            {claim.error?.message.split("\n")[0] ?? txErrorMessage(claimReceipt) ?? "Transaction reverted on-chain."}
          </Callout>
        </div>
      )}
    </Card>
  );
}
