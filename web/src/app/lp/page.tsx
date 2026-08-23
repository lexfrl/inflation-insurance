"use client";

import { useEffect, useState } from "react";
import { maxUint256 } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { inflationHedgeAbi, mockUsdtAbi } from "@/lib/generated";
import { useDemoTarget } from "@/lib/demo-mode";
import { formatBps, formatDate, formatUsdt, parseUsdt } from "@/lib/format";
import { txErrorMessage, txReverted } from "@/lib/tx";
import { useNow } from "@/lib/useNow";
import { Button, Callout, Card, Chip, Field, SectionTitle, Stat } from "@/components/ui";

type Period = {
  label: string;
  capBps: bigint;
  saleEnd: bigint;
  claimDeadline: bigint;
  totalCollateral: bigint;
  totalPremiums: bigint;
  totalMaxLiability: bigint;
  totalClaimed: bigint;
  settled: boolean;
};

export default function LpPage() {
  const { address, isConnected } = useAccount();
  const { chainId, addresses } = useDemoTarget();

  const { data: periods, refetch: refetchPeriods } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "listPeriods",
    chainId,
    query: { refetchInterval: 4000 },
  });

  const [selected, setSelected] = useState(0);
  const period = periods?.[selected] as Period | undefined;

  return (
    <div className="flex flex-col gap-8">
      <SectionTitle
        title="Underwrite a period"
        sub="Deposit USDT to back a protection period. You earn the premiums buyers pay, minus whatever they claim if inflation clears their cover level."
      />

      {periods === undefined ? (
        <Card className="h-64 animate-pulse" />
      ) : periods.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-paper-100">No periods to underwrite yet.</p>
          <p className="mt-2 text-sm text-paper-500">
            Deposits open when an operator creates a period, and close the moment the first policy sells.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {periods.map((p, i) => (
              <Chip key={i} active={selected === i} onClick={() => setSelected(i)}>
                {(p as Period).label}
              </Chip>
            ))}
          </div>

          {period && (
            <PoolPanel
              periodId={selected}
              period={period}
              address={address}
              isConnected={isConnected}
              onChanged={() => refetchPeriods()}
            />
          )}
        </>
      )}
    </div>
  );
}

function PoolPanel({
  periodId,
  period,
  address,
  isConnected,
  onChanged,
}: {
  periodId: number;
  period: Period;
  address: `0x${string}` | undefined;
  isConnected: boolean;
  onChanged: () => void;
}) {
  const { chainId, addresses } = useDemoTarget();
  const [amountInput, setAmountInput] = useState("1000");
  const amount = parseUsdt(amountInput);
  const now = useNow();
  const saleOpen = now < Number(period.saleEnd);
  const canWithdraw = period.settled && now > Number(period.claimDeadline);

  const { data: position, refetch: refetchPosition } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "lpPosition",
    args: address ? [BigInt(periodId), address] : undefined,
    chainId,
    query: { enabled: !!address },
  });
  const [shares, shareOfPoolBps] = position ?? [undefined, undefined];

  // refetchInterval as a safety net -- the approve effect below also
  // force-refetches on success. See the matching comment on the buyer
  // page's allowance read for why the timer alone isn't enough.
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: addresses.usdt,
    abi: mockUsdtAbi,
    functionName: "allowance",
    args: address ? [address, addresses.insurance] : undefined,
    chainId,
    query: { enabled: !!address, refetchInterval: 4000 },
  });
  const needsApproval = allowance === undefined || allowance < amount;

  const approve = useWriteContract();
  const approveReceipt = useWaitForTransactionReceipt({ hash: approve.data });
  const approveReverted = txReverted(approveReceipt);
  const deposit = useWriteContract();
  const depositReceipt = useWaitForTransactionReceipt({ hash: deposit.data });
  const depositReverted = txReverted(depositReceipt);
  const withdraw = useWriteContract();
  const withdrawReceipt = useWaitForTransactionReceipt({ hash: withdraw.data });
  // Once an LP has withdrawn, `withdraw()` reverts on every subsequent call
  // ("already withdrawn") but still costs gas -- this query then ends in
  // isError (see lib/tx.ts), not isSuccess, so the effect below already
  // skips it; this flag is only needed to surface the error message.
  const withdrawReverted = txReverted(withdrawReceipt);

  useEffect(() => {
    if (approveReceipt.isSuccess) refetchAllowance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveReceipt.isSuccess]);

  useEffect(() => {
    if (depositReceipt.isSuccess || withdrawReceipt.isSuccess) {
      onChanged();
      refetchPosition();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositReceipt.isSuccess, withdrawReceipt.isSuccess]);

  const remaining = period.totalCollateral + period.totalPremiums - period.totalClaimed;

  return (
    <div className="flex flex-col gap-4">
      <Card className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-4">
        <Stat label="Collateral" value={formatUsdt(period.totalCollateral)} unit="USDT" />
        <Stat label="Premiums earned" value={formatUsdt(period.totalPremiums)} unit="USDT" tone="positive" />
        <Stat label="Max liability sold" value={formatUsdt(period.totalMaxLiability)} unit="USDT" />
        <Stat label="Pool remaining" value={formatUsdt(remaining)} unit="USDT" />
      </Card>

      <Card className="p-5">
        {shares !== undefined && shares > 0n && (
          <p className="mb-5 text-sm text-paper-300">
            Your position: <span className="font-mono tnum">{formatUsdt(shares)} USDT</span> deposited,{" "}
            <span className="font-mono tnum">{formatBps(shareOfPoolBps)}</span> of the pool.
          </p>
        )}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Deposit amount" hint="Deposits close as soon as the first policy in this period sells.">
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="w-full rounded-control border border-ink-600 bg-ink-900 px-3 py-2.5 pr-16 font-mono text-paper-100 tnum focus:border-celeste-500"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-paper-500">
                  USDT
                </span>
              </div>
            </Field>
          </div>

          <div className="sm:pb-6">
            {!isConnected ? (
              <span className="text-sm text-paper-500">Connect wallet</span>
            ) : !saleOpen ? (
              <span className="text-sm text-paper-500">Deposits closed</span>
            ) : needsApproval ? (
              <Button
                disabled={approve.isPending || approveReceipt.isLoading || amount === 0n}
                onClick={() =>
                  approve.writeContract({
                    address: addresses.usdt,
                    abi: mockUsdtAbi,
                    functionName: "approve",
                    // Max, not exact amount -- see the buyer page for why.
                    args: [addresses.insurance, maxUint256],
                    chainId,
                  })
                }
              >
                {approve.isPending || approveReceipt.isLoading ? "Approving" : "Approve USDT"}
              </Button>
            ) : (
              <Button
                disabled={deposit.isPending || depositReceipt.isLoading || amount === 0n}
                onClick={() =>
                  deposit.writeContract({
                    address: addresses.insurance,
                    abi: inflationHedgeAbi,
                    functionName: "deposit",
                    args: [BigInt(periodId), amount],
                    chainId,
                  })
                }
              >
                {deposit.isPending || depositReceipt.isLoading ? "Depositing" : "Deposit"}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-5 border-t border-ink-700 pt-5">
          <Button
            variant="secondary"
            disabled={
              !isConnected ||
              !canWithdraw ||
              !shares ||
              withdraw.isPending ||
              withdrawReceipt.isLoading ||
              withdrawReceipt.isSuccess
            }
            onClick={() =>
              withdraw.writeContract({
                address: addresses.insurance,
                abi: inflationHedgeAbi,
                functionName: "withdraw",
                args: [BigInt(periodId)],
                chainId,
              })
            }
            className="w-full"
          >
            {withdraw.isPending || withdrawReceipt.isLoading
              ? "Withdrawing"
              : withdrawReceipt.isSuccess
                ? "Withdrawn"
                : !period.settled
                  ? "Withdraw (available after settlement)"
                  : !canWithdraw
                    ? `Withdraw (available after ${formatDate(period.claimDeadline)})`
                    : "Withdraw my share"}
          </Button>
          {/* Pre-flight rejections land in `.error`; a revert that still made
              it on-chain (e.g. clicking withdraw twice -- "already withdrawn")
              makes the matching receipt query end in isError instead (see
              lib/tx.ts), so both need checking or the second click looks like
              a no-op. */}
          {(approve.error || deposit.error || withdraw.error || approveReverted || depositReverted || withdrawReverted) && (
            <div className="mt-3">
              <Callout tone="danger">
                {(approve.error ?? deposit.error ?? withdraw.error)?.message.split("\n")[0] ??
                  txErrorMessage(approveReceipt) ??
                  txErrorMessage(depositReceipt) ??
                  txErrorMessage(withdrawReceipt) ??
                  "Transaction reverted on-chain."}
              </Callout>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
