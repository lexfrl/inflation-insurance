"use client";

import { useSyncExternalStore } from "react";
import { foundry } from "wagmi/chains";
import { activeChain, contractAddresses, isLocalDev } from "./wagmi";

const STORAGE_KEY = "ipc-shield:demo-mode-enabled";

// A tiny localStorage-backed external store, read via `useSyncExternalStore`
// rather than `useState` + `useEffect`: it needs to read something
// (localStorage) that doesn't exist during SSR without causing a hydration
// mismatch, which `useSyncExternalStore`'s server-snapshot argument handles
// for free. One flag, shared by dev-wallet-panel.tsx (which offers the
// toggle) and useDemoTarget below (which every page's reads/writes key off
// of) -- deliberately not two independent stores.
const listeners = new Set<() => void>();
let cache: boolean | null = null;
function getSnapshot() {
  if (cache === null) cache = localStorage.getItem(STORAGE_KEY) === "1";
  return cache;
}
function getServerSnapshot() {
  return false;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function setDemoModeEnabled(enabled: boolean) {
  cache = enabled;
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  listeners.forEach((listener) => listener());
}

/// Whether the off-by-default demo-mode toggle is on. First paint (server +
/// pre-hydration client) always renders "off", so a production visitor's
/// initial HTML never reveals this exists. Meaningless when the build
/// already targets local anvil -- see `useDemoTarget` below, which is what
/// callers actually want.
export function useDemoModeEnabled() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/// Anvil's deterministic contract addresses for a *fresh* local anvil run
/// through `forge script Deploy.s.sol` (deployer = account 0, starting at
/// nonce 0) -- matches `.env.local`. A constant is honest here because that
/// determinism is exactly why local dev never had to configure these: only
/// used when demo mode retargets a non-local build to local anvil.
const LOCAL_CONTRACT_ADDRESSES = {
  usdt: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  insurance: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
} as const;

/// The chain id / contract addresses the app should read and write against
/// right now. In local dev this is always the build's own local target --
/// the toggle doesn't apply, matching prior behavior. In a non-local build
/// it's the build's own target (e.g. Base Sepolia) unless demo mode is
/// switched on, in which case everything retargets to local anvil: for
/// demoing the deployed frontend, opened in a browser on a machine that
/// also has `anvil` + these contracts running locally (see
/// dev-wallet-panel.tsx and README).
export function useDemoTarget() {
  const demoModeEnabled = useDemoModeEnabled();
  const useLocal = isLocalDev || demoModeEnabled;
  return {
    isLocalTarget: useLocal,
    chainId: useLocal ? foundry.id : activeChain.id,
    addresses: useLocal ? LOCAL_CONTRACT_ADDRESSES : contractAddresses,
  };
}
