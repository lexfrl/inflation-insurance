"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { inflationHedgeAbi, mockUsdtAbi } from "@/lib/generated";
import { useDemoTarget } from "@/lib/demo-mode";
import { formatBps, formatUsdt } from "@/lib/format";
import { Card, SectionTitle, Stat } from "@/components/ui";
import { MyPolicies } from "@/components/policies";

/* The account page. Connecting a wallet is the whole of registration here, so
   this is what "logged in" looks like: what you hold, what it is worth, and
   the two ways into the product. */

export default function ProfilePage() {
  const { address, isConnected } = useAccount();

  if (!isConnected || !address) {
    return (
      <div className="flex flex-col gap-8">
        <SectionTitle
          title="Your profile"
          sub="Connect a wallet to open your account. There is nothing to sign up for: the wallet is the account, and everything you hold lives on-chain."
        />
        <Card className="flex flex-col items-center gap-4 p-10 text-center">
          <p className="text-paper-300">No wallet connected yet.</p>
          <ConnectButton label="Connect wallet" showBalance={false} />
        </Card>
      </div>
    );
  }

  return <ConnectedProfile address={address} />;
}

function ConnectedProfile({ address }: { address: `0x${string}` }) {
  const { chainId, addresses } = useDemoTarget();

  const { data: usdtBalance } = useReadContract({
    address: addresses.usdt,
    abi: mockUsdtAbi,
    functionName: "balanceOf",
    args: [address],
    chainId,
    query: { refetchInterval: 4000 },
  });

  const { data: policyIds } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "getPoliciesOf",
    args: [address],
    chainId,
    query: { refetchInterval: 4000 },
  });

  const policyContracts = useMemo(
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
  const { data: policies } = useReadContracts({
    contracts: policyContracts,
    query: { enabled: policyContracts.length > 0 },
  });

  const { data: periods } = useReadContract({
    address: addresses.insurance,
    abi: inflationHedgeAbi,
    functionName: "listPeriods",
    chainId,
    query: { refetchInterval: 8000 },
  });

  const lpContracts = useMemo(
    () =>
      (periods ?? []).map((_, i) => ({
        address: addresses.insurance,
        abi: inflationHedgeAbi,
        functionName: "lpPosition" as const,
        args: [BigInt(i), address] as const,
        chainId,
      })),
    [periods, addresses.insurance, address, chainId],
  );
  const { data: lpPositions } = useReadContracts({
    contracts: lpContracts,
    query: { enabled: lpContracts.length > 0 },
  });

  // Totals are summed in base units and formatted once, so nothing is lost to
  // floating point on the way.
  const totals = useMemo(() => {
    let coverHeld = 0n;
    let premiumPaid = 0n;
    let openCount = 0;
    for (const entry of policies ?? []) {
      const p = entry?.result as
        | { maxPayout: bigint; premiumPaid: bigint; claimed: boolean }
        | undefined;
      if (!p) continue;
      coverHeld += p.maxPayout;
      premiumPaid += p.premiumPaid;
      if (!p.claimed) openCount += 1;
    }
    let deposited = 0n;
    for (const entry of lpPositions ?? []) {
      const pos = entry?.result as readonly [bigint, bigint] | undefined;
      if (pos) deposited += pos[0];
    }
    return { coverHeld, premiumPaid, openCount, deposited };
  }, [policies, lpPositions]);

  const short = `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <div className="flex flex-col gap-8">
      <SectionTitle
        title="Your profile"
        sub="Everything here is read from the contract against your wallet address. Nothing is stored on a server."
      />

      <Card className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-paper-600">
            Signed in as
          </div>
          <div className="mt-1 font-mono text-lg text-paper-100">{short}</div>
        </div>
        <div className="sm:text-right">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-paper-600">
            Wallet balance
          </div>
          <div className="mt-1 font-mono text-lg text-paper-100 tnum">
            {formatUsdt(usdtBalance)} <span className="font-sans text-xs text-paper-600">USDT</span>
          </div>
        </div>
      </Card>

      <Card className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-4">
        <Stat label="Cover held" value={String(totals.openCount)} />
        <Stat label="Most you could receive" value={formatUsdt(totals.coverHeld)} unit="USDT" tone="accent" />
        <Stat label="Paid for cover" value={formatUsdt(totals.premiumPaid)} unit="USDT" />
        <Stat label="Backing others" value={formatUsdt(totals.deposited)} unit="USDT" />
      </Card>

      <MyPolicies address={address} heading="Your cover" />

      {lpPositions && lpPositions.some((e) => {
        const pos = e?.result as readonly [bigint, bigint] | undefined;
        return pos && pos[0] > 0n;
      }) && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-paper-100">
            Where you are the insurer
          </h2>
          <div className="flex flex-col gap-3">
            {(periods ?? []).map((p, i) => {
              const pos = lpPositions?.[i]?.result as readonly [bigint, bigint] | undefined;
              if (!pos || pos[0] === 0n) return null;
              const label = (p as { label: string }).label;
              return (
                <Card key={i} className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <div className="font-medium text-paper-100">{label}</div>
                    <div className="mt-1 text-sm text-paper-500">
                      <span className="font-mono tnum">{formatUsdt(pos[0])} USDT</span> in, holding{" "}
                      <span className="font-mono tnum">{formatBps(pos[1])}</span> of the pool
                    </div>
                  </div>
                  <Link href="/earn" className="shrink-0 text-sm text-accent-400 hover:text-accent-300">
                    Manage
                  </Link>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <section className="grid gap-px overflow-hidden rounded-card border border-ink-700 bg-ink-700 sm:grid-cols-2">
        <Link href="/protect" className="group bg-ink-900 p-5 transition-colors hover:bg-ink-850">
          <h3 className="text-sm font-semibold text-paper-100">Buy cover</h3>
          <p className="mt-2 text-sm leading-relaxed text-paper-500">
            Protect a month of spending against a jump in prices.
          </p>
        </Link>
        <Link href="/earn" className="group bg-ink-900 p-5 transition-colors hover:bg-ink-850">
          <h3 className="text-sm font-semibold text-paper-100">Earn by backing cover</h3>
          <p className="mt-2 text-sm leading-relaxed text-paper-500">
            Take the other side. Collect what buyers pay, pay out if inflation runs hot.
          </p>
        </Link>
      </section>
    </div>
  );
}
