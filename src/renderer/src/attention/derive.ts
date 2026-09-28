// The attention derivations (C5 execution document, Interfaces "Derivations"; residue *Needs-you ordering and
// grouping*). One attention table feeds the sidebar row, the tab glyph, the Overview card and the OS notification
// (§5.7); these are its pure readings, testable without React.
import type { AttentionItem } from '@shared/graph/attention';
import type { AttentionKind } from '@shared/graph/enums';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';

export const ACTIONABLE_KINDS: AttentionKind[] = ['permission', 'question', 'plan', 'dialog', 'elicitation', 'auto_mode_unavailable', 'error', 'interrupted'];   // tier 1
const ACTIONABLE = new Set<AttentionKind>(ACTIONABLE_KINDS);

export interface NeedsYouRow { appSessionId: AppSessionId; oldest: AttentionItem; count: number; tier: 1 | 2 }

// An item still waits on a human while pending or delivered (§4.6: delivered is not an alarm state, but it is not
// answered yet either).
export const isOpen = (item: AttentionItem) => item.state === 'pending' || item.state === 'delivered';
export const isActionable = (item: AttentionItem) => ACTIONABLE.has(item.kind);

const at = (item: AttentionItem) => Date.parse(item.createdAt); // ISO strings of different precision do not compare as text
const oldestOf = (items: AttentionItem[]) => items.reduce((a, b) => (at(b) < at(a) ? b : a));

// One row per session with an open item: tier 1 if any is actionable, else tier 2 (held peer messages only); the row
// shows the oldest item of its tier. Order: tier, then longest wait, then title. Archived sessions, and sessions whose
// record has not arrived yet, have no row.
export function needsYou(bySession: Map<AppSessionId, AttentionItem[]>, records: Map<AppSessionId, SessionRecord>): NeedsYouRow[] {
  const rows: NeedsYouRow[] = [];
  for (const [appSessionId, items] of bySession) {
    const record = records.get(appSessionId);
    if (!record || record.archived) continue;
    const open = items.filter(isOpen);
    if (open.length === 0) continue;
    const actionable = open.filter(isActionable);
    const tier = actionable.length > 0 ? 1 : 2;
    rows.push({ appSessionId, oldest: oldestOf(tier === 1 ? actionable : open), count: open.length, tier });
  }
  const title = (id: AppSessionId) => records.get(id)?.title.text ?? '';
  return rows.sort(
    (a, b) =>
      a.tier - b.tier ||
      at(a.oldest) - at(b.oldest) ||
      title(a.appSessionId).localeCompare(title(b.appSessionId)),
  );
}

// ⌘⇧J: the oldest row that is not the current session (§5.7 sends it to the oldest item), so from any row but the
// first it goes to the first, and from the first to the second; a single row is its own answer.
export function nextNeedsYou(rows: NeedsYouRow[], currentAppId: AppSessionId | null): NeedsYouRow | null {
  return rows.find((row) => row.appSessionId !== currentAppId) ?? rows[0] ?? null;
}
