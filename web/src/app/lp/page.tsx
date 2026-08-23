"use client";

import { useEffect, useState } from "react";
import { maxUint256 } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { inflationHedgeAbi, mockUsdtAbi } from "@/lib/generated";
import { useDemoTarget } from "@/lib/demo-mode";
import { formatBps, formatDate, formatUsdt, parseUsdt } from "@/lib/format";
import { txErrorMessage, txReverted } from "@/lib/tx";
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
  vaultShares: bigint;
  vaultPrincipal: bigint;
  vaultProceeds: bigint;
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
      <div>
        <h1 className="text-2xl font-semibold">Provide liquidity</h1>
        <p className="mt-1 text-white/60">
          Back a protection period with USDT and earn the premiums buyers pay for coverage,
          minus whatever gets claimed. Capacity nobody buys is deployed to a Morpho vault, so
          idle capital earns a base rate on top.
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

  // Polled rather than read once: this is the number that visibly ticks up as
  // the vault accrues, which is the whole point of showing it.
  const { data: vaultValue, refetch: refetchVaultValue } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "vaultValue",
    args: [BigInt(periodId)],
    chainId,
    query: { refetchInterval: 4000 },
  });

  const { data: idleCapacity, refetch: refetchIdleCapacity } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "idleCapacity",
    args: [BigInt(periodId)],
    chainId,
    query: { refetchInterval: 4000 },
  });

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
  const invest = useWriteContract();
  const investReceipt = useWaitForTransactionReceipt({ hash: invest.data });
  const investReverted = txReverted(investReceipt);
  const divest = useWriteContract();
  const divestReceipt = useWaitForTransactionReceipt({ hash: divest.data });
  const divestReverted = txReverted(divestReceipt);
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
    if (
      depositReceipt.isSuccess ||
      withdrawReceipt.isSuccess ||
      investReceipt.isSuccess ||
      divestReceipt.isSuccess
    ) {
      onChanged();
      refetchPosition();
      refetchVaultValue();
      refetchIdleCapacity();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    depositReceipt.isSuccess,
    withdrawReceipt.isSuccess,
    investReceipt.isSuccess,
    divestReceipt.isSuccess,
  ]);

  // Mirrors the contract's own `withdraw` arithmetic, vault P&L included --
  // without the vault terms this stat silently understates the pool for the
  // whole time capital is deployed.
  const remaining =
    period.totalCollateral + period.totalPremiums + period.vaultProceeds - period.vaultPrincipal -
    period.totalClaimed;
  // While shares are open the position is marked to market; once unwound the
  // realised proceeds are the truth. Negative on a lossy vault, which
  // formatUsdt renders correctly as a negative number.
  const yieldEarned =
    period.vaultShares > 0n
      ? (vaultValue ?? 0n) + period.vaultProceeds - period.vaultPrincipal
      : period.vaultProceeds - period.vaultPrincipal;
  const canInvest = !saleOpen && !period.settled && (idleCapacity ?? 0n) > 0n;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="grid grid-cols-2 gap-4 rounded-xl bg-black/30 p-4 text-center sm:grid-cols-3">
        <Stat label="Collateral" value={`${formatUsdt(period.totalCollateral)} USDT`} />
        <Stat label="Premiums collected" value={`${formatUsdt(period.totalPremiums)} USDT`} />
        <Stat label="Max liability sold" value={`${formatUsdt(period.totalMaxLiability)} USDT`} />
        <Stat label="Deployed in Morpho" value={`${formatUsdt(period.vaultPrincipal)} USDT`} />
        <Stat label="Yield earned" value={`${formatUsdt(yieldEarned)} USDT`} />
        <Stat label="Pool remaining" value={`${formatUsdt(remaining)} USDT`} />
      </div>

      {shares !== undefined && shares > 0n && (
        <p className="mt-4 text-sm text-white/60">
          Your position: {formatUsdt(shares)} USDT deposited ({formatBps(shareOfPoolBps)} of the pool)
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
                address: addresses.usdt,
                abi: mockUsdtAbi,
                functionName: "approve",
                // Max, not exact amount -- see the buyer page for why.
                args: [addresses.insurance, maxUint256],
                chainId,
              })
            }
            className="rounded-lg bg-white px-6 py-2 font-medium text-black disabled:opacity-50"
          >
            {approve.isPending || approveReceipt.isLoading ? "Approving..." : "Approve USDT"}
          </button>
        ) : (
          <button
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
            className="rounded-lg bg-emerald-500 px-6 py-2 font-medium text-black disabled:opacity-50"
          >
            {deposit.isPending || depositReceipt.isLoading ? "Depositing..." : "Deposit"}
          </button>
        )}
      </div>

      {(canInvest || period.vaultShares > 0n) && (
        <div className="mt-4 flex flex-col gap-2">
          {canInvest && (
            <button
              disabled={!isConnected || invest.isPending || investReceipt.isLoading}
              onClick={() =>
                invest.writeContract({
                  address: addresses.insurance,
                  abi: inflationHedgeAbi,
                  functionName: "investIdle",
                  args: [BigInt(periodId)],
                  chainId,
                })
              }
              className="w-full rounded-lg bg-emerald-500 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              {invest.isPending || investReceipt.isLoading
                ? "Deploying..."
                : `Deploy ${formatUsdt(idleCapacity)} USDT of idle capital to Morpho`}
            </button>
          )}

          {period.vaultShares > 0n && (
            <button
              disabled={!isConnected || divest.isPending || divestReceipt.isLoading}
              onClick={() =>
                divest.writeContract({
                  address: addresses.insurance,
                  abi: inflationHedgeAbi,
                  functionName: "divest",
                  args: [BigInt(periodId), period.vaultShares],
                  chainId,
                })
              }
              className="w-full rounded-lg bg-emerald-500 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              {divest.isPending || divestReceipt.isLoading ? "Unwinding..." : "Pull capital back from Morpho"}
            </button>
          )}

          {/* Both calls are permissionless by design, so any LP can unstick a
              period without waiting on the operator. Worth saying out loud,
              since every other button on this page acts on your own position. */}
          <p className="text-center text-xs text-white/40">
            Anyone can run these -- they are permissionless, and the amount is fixed by pool state.
          </p>
        </div>
      )}

      <div className="mt-4">
        <button
          disabled={
            !isConnected ||
            !canWithdraw ||
            period.vaultShares > 0n ||
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
          className="w-full rounded-lg border border-white/20 py-2 text-sm font-medium disabled:opacity-40"
        >
          {withdraw.isPending || withdrawReceipt.isLoading
            ? "Withdrawing..."
            : withdrawReceipt.isSuccess
              ? "Withdrawn"
              : !period.settled
                ? "Withdraw (available after settlement)"
                : period.vaultShares > 0n
                  ? "Withdraw (pull capital back from Morpho first)"
                  : !canWithdraw
                    ? `Withdraw (available after ${formatDate(period.claimDeadline)})`
                    : "Withdraw my share"}
        </button>
        {/* Pre-flight rejections land in `.error`; a revert that still made
            it on-chain (e.g. clicking withdraw twice -- "already withdrawn")
            makes the matching receipt query end in isError instead (see
            lib/tx.ts), so both need checking or the second click looks like
            a no-op. */}
        {(approve.error ||
          deposit.error ||
          withdraw.error ||
          invest.error ||
          divest.error ||
          approveReverted ||
          depositReverted ||
          withdrawReverted ||
          investReverted ||
          divestReverted) && (
          <p className="mt-2 text-center text-sm text-red-400">
            {(approve.error ?? deposit.error ?? withdraw.error ?? invest.error ?? divest.error)?.message.split(
              "\n",
            )[0] ??
              txErrorMessage(approveReceipt) ??
              txErrorMessage(depositReceipt) ??
              txErrorMessage(withdrawReceipt) ??
              txErrorMessage(investReceipt) ??
              txErrorMessage(divestReceipt) ??
              "Transaction reverted on-chain."}
          </p>
        )}
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
