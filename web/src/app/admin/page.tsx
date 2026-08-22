"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { inflationHedgeAbi } from "@/lib/generated";
import { activeChain, contractAddresses } from "@/lib/wagmi";

// Deliberately rough / unstyled: this is the operator-only surface, not the
// pitch-facing product. Owner-gating is enforced by the contract regardless
// of what this page shows -- the client-side check below only avoids
// confusing a non-owner with forms that would just revert.

export default function AdminPage() {
  const { address, isConnected } = useAccount();

  const { data: owner } = useReadContract({
    address: contractAddresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "owner",
    chainId: activeChain.id,
  });

  const isOwner = !!address && !!owner && address.toLowerCase() === (owner as string).toLowerCase();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="mt-1 text-white/60">Owner-only. Create periods and post CPI settlements.</p>
      </div>

      {!isConnected ? (
        <p>Connect the owner wallet.</p>
      ) : !isOwner ? (
        <p className="text-amber-400">
          Connected address is not the contract owner ({owner as string}). Forms below will revert.
        </p>
      ) : null}

      <CreatePeriodForm />
      <PostSettlementForm />
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

  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data });

  const submit = () => {
    const now = Math.floor(Date.now() / 1000);
    write.writeContract({
      address: contractAddresses.insurance,
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
      chainId: activeChain.id,
    });
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
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
        className="mt-4 rounded-lg bg-white px-6 py-2 font-medium text-black disabled:opacity-50"
      >
        {write.isPending || receipt.isLoading ? "Creating..." : "Create period"}
      </button>
      {receipt.isSuccess && <p className="mt-2 text-sm text-emerald-400">Period created.</p>}
      {write.error && <p className="mt-2 text-sm text-red-400">{write.error.message}</p>}
    </div>
  );
}

function PostSettlementForm() {
  const [periodId, setPeriodId] = useState("0");
  const [cpiBps, setCpiBps] = useState("500");

  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data });

  useEffect(() => {}, []);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <h2 className="mb-4 font-semibold">Post CPI settlement</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Period id" value={periodId} onChange={setPeriodId} />
        <Field label="CPI (bps, e.g. 500 = 5.00%)" value={cpiBps} onChange={setCpiBps} />
      </div>
      <button
        disabled={write.isPending || receipt.isLoading}
        onClick={() =>
          write.writeContract({
            address: contractAddresses.insurance,
            abi: inflationHedgeAbi,
            functionName: "postSettlement",
            args: [BigInt(periodId), BigInt(cpiBps)],
            chainId: activeChain.id,
          })
        }
        className="mt-4 rounded-lg bg-white px-6 py-2 font-medium text-black disabled:opacity-50"
      >
        {write.isPending || receipt.isLoading ? "Posting..." : "Post settlement"}
      </button>
      {receipt.isSuccess && <p className="mt-2 text-sm text-emerald-400">Settlement posted.</p>}
      {write.error && <p className="mt-2 text-sm text-red-400">{write.error.message}</p>}
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
      <span className="text-white/60">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-white/10 bg-black/30 px-3 py-2"
      />
    </label>
  );
}
