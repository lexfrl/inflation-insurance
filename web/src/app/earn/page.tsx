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
  vaultShares: bigint;
  vaultPrincipal: bigint;
  vaultProceeds: bigint;
};

export default function LpPage() {
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

  const [selected, setSelected] = useState(0);
  const period = periods?.[selected] as Period | undefined;

  return (
    <div className="flex flex-col gap-8">
      <SectionTitle
        title="Earn by backing cover"
        sub="Put up USDT so other people can buy cover. You keep what they pay for it, minus any payouts if inflation runs hot. You are the insurer here. Capacity nobody buys is deployed to a Morpho vault, so idle capital earns a base rate on top."
      />

      {/* Same reasoning as the buyer page: a failed read must not read as
          "still loading" forever. */}
      {periodsFailed ? (
        <Card className="flex flex-col items-center gap-4 p-10 text-center">
          <div>
            <p className="text-content-100">Can&apos;t reach the network right now.</p>
            <p className="mt-2 text-sm text-content-500">
              The contract read failed. Check your network, then try again.
            </p>
          </div>
          <Button variant="secondary" onClick={() => refetchPeriods()}>
            Retry
          </Button>
        </Card>
      ) : periods === undefined ? (
        <Card className="h-64 animate-pulse" />
      ) : periods.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-content-100">No periods to underwrite yet.</p>
          <p className="mt-2 text-sm text-content-500">
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

  // Polled rather than read once: this is the number that visibly ticks up as
  // the vault accrues, which is the whole point of showing it.
  //
  // Its `isError` doubles as a deployment probe, and that is load-bearing.
  // The ABI is generated from source, but the address may still be running a
  // build from before the yield vault existed -- and `listPeriods` does NOT
  // fail loudly in that case. The older struct is four fields shorter, so the
  // newer decoder reads straight into the neighbouring dynamic-array data and
  // returns plausible-looking garbage (vaultShares came back as ~2.9e76
  // against the pre-vault Base Sepolia deployment). That would show a
  // nonsense "working in Morpho" figure and permanently disable withdraw
  // behind "bring capital back first". `vaultValue` is a function that build
  // does not have, so the read reverts -- a reliable signal to hide the whole
  // feature rather than render numbers we know are wrong.
  const {
    data: vaultValue,
    isError: vaultUnavailable,
    refetch: refetchVaultValue,
  } = useReadContract({
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

  // Everything vault-related collapses to "off" against a pre-vault build, so
  // these three are read instead of the raw struct fields everywhere below.
  const yieldEnabled = !vaultUnavailable;
  const vaultShares = yieldEnabled ? period.vaultShares : 0n;
  const vaultPrincipal = yieldEnabled ? period.vaultPrincipal : 0n;
  const vaultProceeds = yieldEnabled ? period.vaultProceeds : 0n;
  const canInvest = yieldEnabled && !saleOpen && !period.settled && (idleCapacity ?? 0n) > 0n;

  // Mirrors the contract's own `withdraw` arithmetic, vault P&L included --
  // without the vault terms this stat silently understates the pool for the
  // whole time capital is deployed.
  const remaining =
    period.totalCollateral + period.totalPremiums + vaultProceeds - vaultPrincipal -
    period.totalClaimed;
  // While shares are open the position is marked to market; once unwound the
  // realised proceeds are the truth. Negative on a lossy vault, which
  // formatUsdt renders correctly as a negative number.
  const yieldEarned =
    vaultShares > 0n
      ? (vaultValue ?? 0n) + vaultProceeds - vaultPrincipal
      : vaultProceeds - vaultPrincipal;

  return (
    <div className="flex flex-col gap-4">
      <Card
        className={`grid grid-cols-2 gap-6 p-5 ${yieldEnabled ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}
      >
        <Stat label="Collateral" value={formatUsdt(period.totalCollateral)} unit="USDT" />
        <Stat label="Paid in by buyers" value={formatUsdt(period.totalPremiums)} unit="USDT" tone="positive" />
        <Stat label="Most you could pay out" value={formatUsdt(period.totalMaxLiability)} unit="USDT" />
        {yieldEnabled && (
          <>
            <Stat label="Working in Morpho" value={formatUsdt(vaultPrincipal)} unit="USDT" />
            <Stat label="Yield earned" value={formatUsdt(yieldEarned)} unit="USDT" tone="positive" />
          </>
        )}
        <Stat label="Pool remaining" value={formatUsdt(remaining)} unit="USDT" />
      </Card>

      <Card className="p-5">
        {shares !== undefined && shares > 0n && (
          <p className="mb-5 text-sm text-content-300">
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
                  className="w-full rounded-control border border-surface-600 bg-surface-850 px-3 py-2.5 pr-16 font-mono text-content-100 tnum focus:border-accent-400"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-content-500">
                  USDT
                </span>
              </div>
            </Field>
          </div>

          <div className="sm:pb-6">
            {!isConnected ? (
              <span className="text-sm text-content-500">Connect wallet</span>
            ) : !saleOpen ? (
              <span className="text-sm text-content-500">Deposits closed</span>
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

        {(canInvest || vaultShares > 0n) && (
          <div className="mt-5 flex flex-col gap-3 border-t border-surface-700 pt-5">
            {canInvest && (
              <Button
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
                className="w-full"
              >
                {invest.isPending || investReceipt.isLoading
                  ? "Deploying"
                  : `Put ${formatUsdt(idleCapacity)} USDT to work in Morpho`}
              </Button>
            )}

            {vaultShares > 0n && (
              <Button
                disabled={!isConnected || divest.isPending || divestReceipt.isLoading}
                onClick={() =>
                  divest.writeContract({
                    address: addresses.insurance,
                    abi: inflationHedgeAbi,
                    functionName: "divest",
                    args: [BigInt(periodId), vaultShares],
                    chainId,
                  })
                }
                className="w-full"
              >
                {divest.isPending || divestReceipt.isLoading ? "Bringing back" : "Bring capital back from Morpho"}
              </Button>
            )}

            {/* Both calls are permissionless by design, so any LP can unstick
                a period without waiting on the operator. Worth saying out
                loud, since every other button here acts on your own money. */}
            <p className="text-center text-xs text-content-600">
              Anyone can run these. The amount is fixed by pool state, not by whoever clicks.
            </p>
          </div>
        )}

        <div className="mt-5 border-t border-surface-700 pt-5">
          <Button
            variant="secondary"
            disabled={
              !isConnected ||
              !canWithdraw ||
              vaultShares > 0n ||
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
                  : vaultShares > 0n
                    ? "Withdraw (bring capital back from Morpho first)"
                    : !canWithdraw
                      ? `Withdraw (available after ${formatDate(period.claimDeadline)})`
                      : "Withdraw my share"}
          </Button>
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
            <div className="mt-3">
              <Callout tone="danger">
                {(
                  approve.error ??
                  deposit.error ??
                  withdraw.error ??
                  invest.error ??
                  divest.error
                )?.message.split("\n")[0] ??
                  txErrorMessage(approveReceipt) ??
                  txErrorMessage(depositReceipt) ??
                  txErrorMessage(withdrawReceipt) ??
                  txErrorMessage(investReceipt) ??
                  txErrorMessage(divestReceipt) ??
                  "Transaction reverted on-chain."}
              </Callout>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
