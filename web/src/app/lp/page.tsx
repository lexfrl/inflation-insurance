"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { cpiInsuranceAbi, mockUsdcAbi } from "@/lib/generated";
import { activeChain, contractAddresses } from "@/lib/wagmi";
import { formatBps, formatDate, formatUsdc, parseUsdc } from "@/lib/format";
import { useNow } from "@/lib/useNow";

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

  const { data: periods, refetch: refetchPeriods } = useReadContract({
    address: contractAddresses.insurance,
    abi: cpiInsuranceAbi,
    functionName: "listPeriods",
    chainId: activeChain.id,
  });

  const [selected, setSelected] = useState(0);
  const period = periods?.[selected] as Period | undefined;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Provide liquidity</h1>
        <p className="mt-1 text-white/60">
          Back a protection period with USDC and earn the premiums buyers pay for coverage,
          minus whatever gets claimed.
        </p>
      </div>

      {!periods || periods.length === 0 ? (
        <p className="text-white/50">No periods yet.</p>
      ) : (
        <>
          <div className="flex gap-2">
            {periods.map((p, i) => (
              <button
                key={i}
                onClick={() => setSelected(i)}
                className={`rounded-full px-4 py-1.5 text-sm ${
                  selected === i ? "bg-white text-black" : "bg-white/10 text-white/70 hover:bg-white/20"
                }`}
              >
                {(p as Period).label}
              </button>
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
  const [amountInput, setAmountInput] = useState("1000");
  const amount = parseUsdc(amountInput);
  const now = useNow();
  const saleOpen = now < Number(period.saleEnd);
  const canWithdraw = period.settled && now > Number(period.claimDeadline);

  const { data: position, refetch: refetchPosition } = useReadContract({
    address: contractAddresses.insurance,
    abi: cpiInsuranceAbi,
    functionName: "lpPosition",
    args: address ? [BigInt(periodId), address] : undefined,
    chainId: activeChain.id,
    query: { enabled: !!address },
  });
  const [shares, shareOfPoolBps] = position ?? [undefined, undefined];

  const { data: allowance } = useReadContract({
    address: contractAddresses.usdc,
    abi: mockUsdcAbi,
    functionName: "allowance",
    args: address ? [address, contractAddresses.insurance] : undefined,
    chainId: activeChain.id,
    query: { enabled: !!address },
  });
  const needsApproval = allowance === undefined || allowance < amount;

  const approve = useWriteContract();
  const approveReceipt = useWaitForTransactionReceipt({ hash: approve.data });
  const deposit = useWriteContract();
  const depositReceipt = useWaitForTransactionReceipt({ hash: deposit.data });
  const withdraw = useWriteContract();
  const withdrawReceipt = useWaitForTransactionReceipt({ hash: withdraw.data });

  useEffect(() => {
    if (depositReceipt.isSuccess || withdrawReceipt.isSuccess) {
      onChanged();
      refetchPosition();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositReceipt.isSuccess, withdrawReceipt.isSuccess]);

  const remaining = period.totalCollateral + period.totalPremiums - period.totalClaimed;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="grid grid-cols-2 gap-4 rounded-xl bg-black/30 p-4 text-center sm:grid-cols-4">
        <Stat label="Collateral" value={`${formatUsdc(period.totalCollateral)} USDC`} />
        <Stat label="Premiums collected" value={`${formatUsdc(period.totalPremiums)} USDC`} />
        <Stat label="Max liability sold" value={`${formatUsdc(period.totalMaxLiability)} USDC`} />
        <Stat label="Pool remaining" value={`${formatUsdc(remaining)} USDC`} />
      </div>

      {shares !== undefined && shares > 0n && (
        <p className="mt-4 text-sm text-white/60">
          Your position: {formatUsdc(shares)} USDC deposited ({formatBps(shareOfPoolBps)} of the pool)
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-white/60">Deposit amount</span>
          <input
            type="number"
            min={0}
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2"
          />
        </label>

        {!isConnected ? (
          <p className="text-white/50">Connect wallet</p>
        ) : !saleOpen ? (
          <span className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white/50">Deposits closed</span>
        ) : needsApproval ? (
          <button
            disabled={approve.isPending || approveReceipt.isLoading || amount === 0n}
            onClick={() =>
              approve.writeContract({
                address: contractAddresses.usdc,
                abi: mockUsdcAbi,
                functionName: "approve",
                args: [contractAddresses.insurance, amount],
                chainId: activeChain.id,
              })
            }
            className="rounded-lg bg-white px-6 py-2 font-medium text-black disabled:opacity-50"
          >
            {approve.isPending || approveReceipt.isLoading ? "Approving..." : "Approve USDC"}
          </button>
        ) : (
          <button
            disabled={deposit.isPending || depositReceipt.isLoading || amount === 0n}
            onClick={() =>
              deposit.writeContract({
                address: contractAddresses.insurance,
                abi: cpiInsuranceAbi,
                functionName: "deposit",
                args: [BigInt(periodId), amount],
                chainId: activeChain.id,
              })
            }
            className="rounded-lg bg-emerald-500 px-6 py-2 font-medium text-black disabled:opacity-50"
          >
            {deposit.isPending || depositReceipt.isLoading ? "Depositing..." : "Deposit"}
          </button>
        )}
      </div>

      <div className="mt-4">
        <button
          disabled={!isConnected || !canWithdraw || !shares || withdraw.isPending || withdrawReceipt.isLoading}
          onClick={() =>
            withdraw.writeContract({
              address: contractAddresses.insurance,
              abi: cpiInsuranceAbi,
              functionName: "withdraw",
              args: [BigInt(periodId)],
              chainId: activeChain.id,
            })
          }
          className="w-full rounded-lg border border-white/20 py-2 text-sm font-medium disabled:opacity-40"
        >
          {withdraw.isPending || withdrawReceipt.isLoading
            ? "Withdrawing..."
            : !period.settled
              ? "Withdraw (available after settlement)"
              : !canWithdraw
                ? `Withdraw (available after ${formatDate(period.claimDeadline)})`
                : "Withdraw my share"}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-white/40">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
