// What the Info tab says of a session's context use and cost, from DX4 `usage` (the Decision Log, 2026-10-15): the one
// source of both on the web. Null — the session has no bridge, or none has reported yet — reads "unavailable (no
// bridge)"; a piece the usage leaves out (the window's fill before a response reported it; the cost where the engine
// keeps no ledger) reads unavailable on its own; undefined is not known yet (before the first snapshot).
import { formatCompactCount as compact } from '@shared/app/date-format';
import type { Usage } from 'desk-hub/protocol';

export const UNAVAILABLE = 'unavailable';
export const NO_BRIDGE = 'unavailable (no bridge)';
const PENDING = '…';

export function contextLine(usage: Usage | null | undefined): string {
  if (usage === undefined) return PENDING;
  if (usage === null) return NO_BRIDGE;
  const { tokens, window, percent } = usage.context;
  if (tokens === undefined) return `${UNAVAILABLE} · ${compact(window)} window`;
  const share = percent ?? Math.round((tokens / window) * 100);
  return `${compact(tokens)} of ${compact(window)} (${share}%)`;
}

export function costLine(usage: Usage | null | undefined): string {
  if (usage === undefined) return PENDING;
  if (usage === null) return NO_BRIDGE;
  if (usage.cost === null) return UNAVAILABLE;
  const { usd } = usage.cost;
  return `$${usd.toFixed(usd > 0 && usd < 0.01 ? 4 : 2)}`;
}
