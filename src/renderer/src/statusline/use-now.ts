// The wall clock, re-read every `intervalMs` while the caller is mounted: the status line's countdowns re-render
// every 5 minutes in the line and every 30 s while a popover is open (C7 execution document, M5).
import { useEffect, useState } from 'react';

export const LINE_TICK_MS = 5 * 60_000;
export const POPOVER_TICK_MS = 30_000;

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
