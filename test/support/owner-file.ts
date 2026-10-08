// The A-15 check every live sitting shares (E11 M6, Decision Log 30's fix round; the standing rule): two readings of the
// owner's ~/.claude.json `projects` keys under /tmp and /private/tmp, compared. A key under one of the run's own scratch
// directories (`ours`) that appears or vanishes is a breach: the run reached the owner's file. Any other key added or
// removed meanwhile is another owner session's, recorded and passed. Used by the shared live harness's closeSession
// (test/live/support/harness.ts) and the app-level sittings (e2e/support/p1-live.ts, e2e/p1-live.spec.ts).
import { underAny } from './claude-env';

export interface A15Delta {
  identical: boolean;
  added: string[];
  removed: string[];
  breach: string[]; // the added and removed keys under the run's own scratch
}

export function compareA15(before: readonly string[], after: readonly string[], ours: readonly string[]): A15Delta {
  const added = after.filter((key) => !before.includes(key));
  const removed = before.filter((key) => !after.includes(key));
  return { identical: added.length === 0 && removed.length === 0, added, removed, breach: [...added, ...removed].filter((key) => underAny(key, ours)) };
}

// The delta as a log line's words.
export function a15DeltaText(delta: A15Delta): string {
  if (delta.identical) return 'identical';
  const verdict = delta.breach.length > 0 ? `BREACH (the sitting’s own): ${JSON.stringify(delta.breach)}` : 'none the sitting’s own (recorded, not a breach)';
  return `added ${JSON.stringify(delta.added)}, removed ${JSON.stringify(delta.removed)}; ${verdict}`;
}
