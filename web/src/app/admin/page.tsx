"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { inflationHedgeAbi, mockYieldVaultAbi } from "@/lib/generated";
import { useDemoTarget } from "@/lib/demo-mode";
import { txErrorMessage, txReverted } from "@/lib/tx";

// Deliberately rough / unstyled: this is the operator-only surface, not the
// pitch-facing product. Owner-gating is enforced by the contract regardless
// of what this page shows -- the client-side check below only avoids
// confusing a non-owner with forms that would just revert.

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const { chainId, addresses } = useDemoTarget();

  const { data: owner } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "owner",
    chainId,
  });

  const isOwner = !!address && !!owner && address.toLowerCase() === (owner as string).toLowerCase();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="mt-1 text-content-300">
          Owner-only. Create periods, post CPI settlements, and configure the yield venue.
        </p>
      </div>

      {!isConnected ? (
        <p>Connect the owner wallet.</p>
      ) : !isOwner ? (
        <p className="text-signal-warning">
          Connected address is not the contract owner ({owner as string}). Forms below will revert.
        </p>
      ) : null}

      <CreatePeriodForm />
      <PostSettlementForm />
      <VaultConfigForm />
      <AccrueYieldForm />
    </div>
  );
}

function CreatePeriodForm() {
  const [label, setLabel] = useState("DEMO: Argentina CPI");
  const [capBps, setCapBps] = useState("800");
  const [saleSecs, setSaleSecs] = useState("900");
  const [periodSecs, setPeriodSecs] = useState("1200");
  const [claimSecs, setClaimSecs] = useState("3600");
  const [loadBps, setLoadBps] = useState("12000");
  const [buckets, setBuckets] = useState("200,400,600,800");
  const [probs, setProbs] = useState("4000,3000,2000,1000");

  const { chainId, addresses } = useDemoTarget();
  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data });

  const submit = () => {
    const now = Math.floor(Date.now() / 1000);
    write.writeContract({
      address: addresses.insurance,
      abi: inflationHedgeAbi,
      functionName: "createPeriod",
      args: [
        {
          label,
          capBps: BigInt(capBps),
          saleEnd: BigInt(now + Number(saleSecs)),
          periodEnd: BigInt(now + Number(periodSecs)),
          // A duration, not an absolute timestamp -- the contract derives
          // the actual claimDeadline at postSettlement time (settledAt +
          // claimWindowSecs), so late settlement can never shrink or skip
          // the claim window. See InflationHedge.postSettlement NatSpec.
          claimWindowSecs: BigInt(claimSecs),
          loadBps: BigInt(loadBps),
          cpiBucketsBps: buckets.split(",").map((s) => BigInt(s.trim())),
          probBps: probs.split(",").map((s) => BigInt(s.trim())),
        },
      ],
      chainId,
    });
  };

  return (
    <div className="rounded-card border border-surface-700 bg-surface-850 p-6">
      <h2 className="mb-4 font-semibold">Create period</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Label" value={label} onChange={setLabel} />
        <Field label="Cap (bps)" value={capBps} onChange={setCapBps} />
        <Field label="Sale window (secs from now)" value={saleSecs} onChange={setSaleSecs} />
        <Field label="Period window (secs from now)" value={periodSecs} onChange={setPeriodSecs} />
        <Field label="Claim window length (secs, starts at settlement)" value={claimSecs} onChange={setClaimSecs} />
        <Field label="Load (bps, e.g. 12000 = 1.2x EV)" value={loadBps} onChange={setLoadBps} />
        <Field label="CPI buckets (bps, comma-separated)" value={buckets} onChange={setBuckets} />
        <Field label="Probabilities (bps, must sum to 10000)" value={probs} onChange={setProbs} />
      </div>
      <button
        disabled={write.isPending || receipt.isLoading}
        onClick={submit}
        className="mt-4 rounded-control bg-accent px-6 py-2 font-medium text-on-accent disabled:opacity-50"
      >
        {write.isPending || receipt.isLoading ? "Creating..." : "Create period"}
      </button>
      {receipt.isSuccess && <p className="mt-2 text-sm text-signal-positive">Period created.</p>}
      {/* A revert that still made it on-chain (e.g. probabilities not
          summing to 10000) makes this query end in isError instead of
          isSuccess (see lib/tx.ts) -- `write.error` alone misses it. */}
      {(write.error || txReverted(receipt)) && (
        <p className="mt-2 text-sm text-signal-danger">
          {write.error?.message ?? txErrorMessage(receipt) ?? "Transaction reverted on-chain."}
        </p>
      )}
    </div>
  );
}

function PostSettlementForm() {
  const [periodId, setPeriodId] = useState("0");
  const [cpiBps, setCpiBps] = useState("500");

  const { chainId, addresses } = useDemoTarget();
  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data });

  useEffect(() => {}, []);

  return (
    <div className="rounded-card border border-surface-700 bg-surface-850 p-6">
      <h2 className="mb-4 font-semibold">Post CPI settlement</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Period id" value={periodId} onChange={setPeriodId} />
        <Field label="CPI (bps, e.g. 500 = 5.00%)" value={cpiBps} onChange={setCpiBps} />
      </div>
      <button
        disabled={write.isPending || receipt.isLoading}
        onClick={() =>
          write.writeContract({
            address: addresses.insurance,
            abi: inflationHedgeAbi,
            functionName: "postSettlement",
            args: [BigInt(periodId), BigInt(cpiBps)],
            chainId,
          })
        }
        className="mt-4 rounded-control bg-accent px-6 py-2 font-medium text-on-accent disabled:opacity-50"
      >
        {write.isPending || receipt.isLoading ? "Posting..." : "Post settlement"}
      </button>
      {receipt.isSuccess && <p className="mt-2 text-sm text-signal-positive">Settlement posted.</p>}
      {(write.error || txReverted(receipt)) && (
        <p className="mt-2 text-sm text-signal-danger">
          {write.error?.message ?? txErrorMessage(receipt) ?? "Transaction reverted on-chain."}
        </p>
      )}
    </div>
  );
}

/// Points idle capital at an ERC-4626 venue and caps how much of a period's
/// unsold capacity may be deployed. Reads the live values back first, so the
/// operator sees current state before changing it.
function VaultConfigForm() {
  const [vaultAddr, setVaultAddr] = useState("");
  const [investBps, setInvestBps] = useState("10000");

  const { chainId, addresses } = useDemoTarget();

  const { data: currentVault, refetch: refetchVault } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "vault",
    chainId,
  });
  const { data: currentBps, refetch: refetchBps } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "investBps",
    chainId,
  });

  const setVault = useWriteContract();
  const setVaultReceipt = useWaitForTransactionReceipt({ hash: setVault.data });
  const setBps = useWriteContract();
  const setBpsReceipt = useWaitForTransactionReceipt({ hash: setBps.data });

  useEffect(() => {
    if (setVaultReceipt.isSuccess) refetchVault();
    if (setBpsReceipt.isSuccess) refetchBps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setVaultReceipt.isSuccess, setBpsReceipt.isSuccess]);

  return (
    <div className="rounded-card border border-surface-700 bg-surface-850 p-6">
      <h2 className="mb-4 font-semibold">Yield venue</h2>

      <p className="mb-4 text-sm text-content-300">
        Current vault: {(currentVault as string) ?? "-"} &middot; invest cap: {currentBps?.toString() ?? "-"} bps
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Vault address (0x0 disables)"
          value={vaultAddr}
          onChange={setVaultAddr}
        />
        <Field label="Invest cap (bps of unsold capacity)" value={investBps} onChange={setInvestBps} />
      </div>

      <div className="mt-4 flex gap-3">
        <button
          onClick={() =>
            setVault.writeContract({
              address: addresses.insurance,
              abi: inflationHedgeAbi,
              functionName: "setVault",
              args: [vaultAddr as `0x${string}`],
              chainId,
            })
          }
          className="rounded-control bg-accent px-6 py-2 font-medium text-on-accent"
        >
          {setVault.isPending || setVaultReceipt.isLoading ? "Setting..." : "Set vault"}
        </button>
        <button
          onClick={() =>
            setBps.writeContract({
              address: addresses.insurance,
              abi: inflationHedgeAbi,
              functionName: "setInvestBps",
              args: [BigInt(investBps || "0")],
              chainId,
            })
          }
          className="rounded-control bg-accent px-6 py-2 font-medium text-on-accent"
        >
          {setBps.isPending || setBpsReceipt.isLoading ? "Setting..." : "Set invest cap"}
        </button>
      </div>

      {(setVaultReceipt.isSuccess || setBpsReceipt.isSuccess) && (
        <p className="mt-2 text-sm text-signal-positive">Updated.</p>
      )}
      {(setVault.error || setBps.error || txReverted(setVaultReceipt) || txReverted(setBpsReceipt)) && (
        <p className="mt-2 text-sm text-signal-danger">
          {(setVault.error ?? setBps.error)?.message ??
            txErrorMessage(setVaultReceipt) ??
            txErrorMessage(setBpsReceipt) ??
            "Transaction reverted on-chain."}
        </p>
      )}
    </div>
  );
}

/// Demo-only. Moves the mock vault's share price so the LP page's "Yield
/// earned" stat visibly ticks up without waiting on real borrowers. Calls
/// MockYieldVault, so it does nothing against a real Morpho vault.
function AccrueYieldForm() {
  const [amount, setAmount] = useState("25");

  const { chainId, addresses } = useDemoTarget();

  const { data: currentVault } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "vault",
    chainId,
  });

  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data });

  return (
    <div className="rounded-card border border-surface-700 bg-surface-850 p-6">
      <h2 className="mb-4 font-semibold">Simulate vault yield (demo only)</h2>

      <p className="mb-4 text-sm text-content-300">
        Only works against MockYieldVault. A real Morpho vault accrues from real borrowers and
        ignores this entirely.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Yield to accrue (USDT)" value={amount} onChange={setAmount} />
      </div>

      <button
        disabled={!currentVault}
        onClick={() =>
          write.writeContract({
            address: currentVault as `0x${string}`,
            abi: mockYieldVaultAbi,
            functionName: "accrueYield",
            args: [BigInt(Math.round(Number(amount || "0") * 1e6))],
            chainId,
          })
        }
        className="mt-4 rounded-control bg-accent px-6 py-2 font-medium text-on-accent disabled:opacity-50"
      >
        {write.isPending || receipt.isLoading ? "Accruing..." : "Accrue yield"}
      </button>

      {receipt.isSuccess && <p className="mt-2 text-sm text-signal-positive">Yield accrued.</p>}
      {(write.error || txReverted(receipt)) && (
        <p className="mt-2 text-sm text-signal-danger">
          {write.error?.message ?? txErrorMessage(receipt) ?? "Transaction reverted on-chain."}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-content-300">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-control border border-surface-700 bg-surface-900 px-3 py-2"
      />
    </label>
  );
}
