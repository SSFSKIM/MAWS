// What the Info tab says of a session's context use and cost, from DX4 `usage` (the Decision Log, 2026-10-15): the one
// source of both on the web. Null — the session has no bridge, or none has reported yet — reads "not reported yet" while bridged, otherwise "unavailable (no
// bridge)"; a piece the usage leaves out (the window's fill before a response reported it; the cost where the engine
// keeps no ledger) reads unavailable on its own; undefined is not known yet (before the first snapshot). And what it says
// of the engine from `read status` (the desk control surface spec's M0): a bridged session whose plugin cannot answer it
// says so and the version it would need, never a spinner (A1).
import { formatCompactCount as compact } from '@shared/app/date-format';
import type { StatusRead, Usage } from 'desk-hub/protocol';
import { NEEDS, type Capability } from '../../conversation/capabilities';
import type { DepthTranscriptState } from '../source/desk-transcript';

export const UNAVAILABLE = 'unavailable';
export const NO_BRIDGE = 'unavailable (no bridge)';
const PENDING = '…';

export function contextLine(usage: Usage | null | undefined, bridged = false): string {
  if (usage === undefined) return PENDING;
  if (usage === null) return bridged ? 'not reported yet' : NO_BRIDGE;
  const { tokens, window, percent } = usage.context;
  if (tokens === undefined) return `${UNAVAILABLE} · ${compact(window)} window`;
  const share = percent ?? Math.round((tokens / window) * 100);
  return `${compact(tokens)} of ${compact(window)} (${share}%)`;
}

export function costLine(usage: Usage | null | undefined, bridged = false): string {
  if (usage === undefined) return PENDING;
  if (usage === null) return bridged ? 'not reported yet' : NO_BRIDGE;
  if (usage.cost === null) return UNAVAILABLE;
  const { usd } = usage.cost;
  return `$${usd.toFixed(usd > 0 && usd < 0.01 ? 4 : 2)}`;
}

export type StatusLines = { engine: string; root: string; repo: string; surfaces: string };

/** The Info tab's engine lines: `can` is the session's `status` capability, `bridged` whether it runs with the bridge. */
export function statusLines(status: DepthTranscriptState['status'], can: Capability, bridged: boolean): StatusLines {
  const all = (text: string): StatusLines => ({ engine: text, root: text, repo: text, surfaces: text });
  if (!can.can) return all(bridged ? `not available from this plugin (needs sminos ≥ ${NEEDS.status.sminos})` : `${UNAVAILABLE} (${can.reason})`);
  const answer: StatusRead | null = status?.answer ?? null;
  if (answer === null) return all(status?.error ? `${UNAVAILABLE} (${status.error})` : PENDING);
  const { version, base } = answer.version;
  const repo = answer.repo ? [answer.repo.remote, answer.repo.branch].filter(Boolean).join(' · ') : '';
  return { engine: base ? `${version} (base ${base})` : version, root: answer.root, repo: repo || 'none', surfaces: answer.surfaces.join(', ') || 'none' };
}

/** A Refresh that failed while an earlier answer is kept: said beside the lines, which stay that answer's. */
export function refreshError(status: DepthTranscriptState['status']): string | null {
  return status?.answer && status.error ? `Refresh failed (${status.error}): showing the last answer` : null;
}
