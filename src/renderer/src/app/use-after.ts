// Whether a condition has held for `ms` without a break (the UX wave, U9: A3's "Loading…" from 300 ms on, nothing before),
// by one timer per stretch it holds; false again the moment it stops holding.
import { useEffect, useState } from 'react';

export function useAfter(on: boolean, ms: number): boolean {
  const [stretch, setStretch] = useState({ on, elapsed: false });
  if (stretch.on !== on) setStretch({ on, elapsed: false }); // a new stretch begins, or ends: a render-phase update
  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => setStretch((current) => (current.on ? { on: true, elapsed: true } : current)), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on && stretch.on && stretch.elapsed;
}
