"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

/* Connecting a wallet *is* the sign-up here: there is no account to create,
   no email, no password. So the landing's primary call to action is the
   connect flow itself, and once a wallet is attached it turns into the way
   into the product rather than sitting there offering to connect again. */
/* `onGradient` switches the supporting text to a white ramp. The neutral
   content colours are tuned for the page background and all but vanish on the
   blue hero panel, which is a contrast failure, not a style preference. */
export function GetStarted({ onGradient = false }: { onGradient?: boolean }) {
  const { isConnected } = useAccount();
  const muted = onGradient ? "text-white/75" : "text-content-500";

  if (isConnected) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/profile"
          className="rounded-control bg-accent-400 px-5 py-2.5 text-sm font-medium text-surface-950 transition-[transform,background-color] [transition-duration:var(--dur-fast)] [transition-timing-function:var(--ease-ui)] hover:bg-accent-300 active:translate-y-[1px]"
        >
          Go to your profile
        </Link>
        <span className={`text-sm ${muted}`}>Your wallet is connected.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <ConnectButton label="Connect wallet to start" showBalance={false} />
      <span className={`text-sm ${muted}`}>No sign-up. Your wallet is your account.</span>
    </div>
  );
}
