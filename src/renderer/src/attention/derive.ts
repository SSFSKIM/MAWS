// The attention derivations (C5 execution document, Interfaces "Derivations"; residue *Needs-you ordering and
// grouping*). One attention table feeds the sidebar row, the tab glyph, the Overview card and the OS notification
// (§5.7); these are its pure readings, testable without React.
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import type { ForeignHolder, SessionRecord } from '@shared/graph/session';
import { isActionable, isOpen } from '@shared/attention/kinds';

// The kinds and the open states are shared with main's notifier and dock badge (`@shared/attention/kinds`).
export { ACTIONABLE_KINDS, isActionable, isOpen } from '@shared/attention/kinds';

export interface NeedsYouRow { appSessionId: AppSessionId; oldest: AttentionItem; count: number; tier: 1 | 2 }

const at = (item: AttentionItem) => Date.parse(item.createdAt); // ISO strings of different precision do not compare as text
const oldestOf = (items: AttentionItem[]) => items.reduce((a, b) => (at(b) < at(a) ? b : a));

// One row per session with an open item: tier 1 if any is actionable, else tier 2 (held peer messages only); the row
// shows the oldest item of its tier. Order: tier, then longest wait, then title. Archived sessions, and sessions whose
// record has not arrived yet, have no row.
// The item a session's Needs-you row stands for: the oldest open item of its highest tier (actionable before held
// messages), with the tier and the open count; null when nothing is open. The sidebar's tree row shows the same item.
export function waitingItem(items: AttentionItem[]): Omit<NeedsYouRow, 'appSessionId'> | null {
  const open = items.filter(isOpen);
  if (open.length === 0) return null;
  const actionable = open.filter(isActionable);
  const tier = actionable.length > 0 ? 1 : 2;
  return { oldest: oldestOf(tier === 1 ? actionable : open), count: open.length, tier };
}

export function needsYou(bySession: Map<AppSessionId, AttentionItem[]>, records: Map<AppSessionId, SessionRecord>): NeedsYouRow[] {
  const rows: NeedsYouRow[] = [];
  for (const [appSessionId, items] of bySession) {
    const record = records.get(appSessionId);
    if (!record || record.archived) continue;
    const waiting = waitingItem(items);
    if (waiting) rows.push({ appSessionId, ...waiting });
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

// Who holds a foreign-live session (D-12), as a row or card names it; null for any other holder. A background job reads
// by the short id `claude --bg` printed (`bg · <short>`, as C10's toasts name it), its pid only when no id is known.
export function holderLine(record: SessionRecord): string | null {
  const { holder } = record;
  return holder.kind === 'terminal' || holder.kind === 'background_job' ? foreignLine(holder) : null;
}

function foreignLine(holder: ForeignHolder): string {
  if (holder.kind === 'terminal') return `Terminal · pid ${holder.pid}`;
  if (holder.jobId !== null) return `bg · ${holder.jobId}`;
  return holder.pid === null ? 'Background job' : `bg · pid ${holder.pid}`;
}

// W7 (charter §4.3 as amended 2026-10-01): who else holds a session MAWS runs (the contested state), as the glyph, the
// tab and Session info name it; null when MAWS alone holds it, or does not hold it.
export function contestLine(record: SessionRecord): string | null {
  const { holder } = record;
  return holder.kind === 'self' && holder.contestedBy !== undefined ? foreignLine(holder.contestedBy) : null;
}
