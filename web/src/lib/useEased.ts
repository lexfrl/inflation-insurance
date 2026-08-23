"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function getReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
function getServerReducedMotion() {
  return false;
}

/// Whether the visitor asked for reduced motion. Read through
/// `useSyncExternalStore` rather than state + effect for the same reason
/// `demo-mode.ts` does: it needs a browser-only value without a hydration
/// mismatch, and the server-snapshot argument handles that for free.
export function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotion, getServerReducedMotion);
}

/// Eases a number toward `target` instead of snapping to it.
///
/// The strike slider drives the payoff chart's geometry directly, so without
/// this every pixel of drag redraws the curve at a hard cut and the whole
/// thing reads as jitter rather than one shape moving. Timing matches
/// SolPump's motion tokens: ~0.22s with a soft finish.
///
/// Under reduced motion the target is returned untouched, and no animation
/// ever starts.
export function useEasedNumber(target: number, durationMs = 220): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(target);
  // Holds the last value actually painted, so a fast drag chains from wherever
  // the previous animation got to rather than jumping back to its target.
  const paintedRef = useRef(target);

  useEffect(() => {
    if (reduced) return;

    const from = paintedRef.current;
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const next = from + (target - from) * eased;
      paintedRef.current = next;
      // Inside the frame callback, not the effect body: this is the external
      // system (the animation clock) pushing a value in, which is exactly
      // what effects are for.
      setValue(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    });

    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, reduced]);

  return reduced ? target : value;
}
