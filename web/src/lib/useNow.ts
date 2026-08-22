"use client";

import { useEffect, useState } from "react";

/// Current unix-seconds timestamp, read only inside an effect (never during
/// render, which the React Compiler correctly flags as impure) and updated
/// on an interval so sale/claim-window gating in the UI stays live.
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    // Both calls happen inside a scheduled callback, not synchronously in
    // the effect body itself -- setTimeout(0) gets an immediate first
    // reading without the "setState directly in effect" lint violation.
    const immediate = setTimeout(tick, 0);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(immediate);
      clearInterval(id);
    };
  }, [intervalMs]);

  return now;
}
