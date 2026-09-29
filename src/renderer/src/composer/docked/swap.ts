// What takes the composer's place (C7 execution document, M4 decisions and "Placements"): the oldest card another child
// docked (C10's trust and relay-down cards) first, then the session's oldest open answerable request (the five kinds; a
// dialog only once its payload reads as one of the two declared kinds, so an undeclared or invalid one never swaps the
// editor out). The oldest open item that is actionable but not answerable here (an undeclared dialog, an error, an
// interruption, auto mode unavailable) shows as a notice above the frame instead. Pure.
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AttentionId } from '@shared/graph/ids';
import { isActionable, isOpen } from '@shared/attention/kinds';
import { declaredDialog } from '../../request-card/variants/dialog-kinds';

export interface Swap {
  item: AttentionItem | null; // the request that docks (when no foreign card does)
  notice: AttentionItem | null; // shown above the frame, never in its place
  waiting: number; // how many more answerable requests wait behind the docked one
  unread: AttentionItem[]; // dialogs whose request is not loaded yet (the composer loads them to know their kind)
}

const at = (item: AttentionItem) => Date.parse(item.createdAt);
const byAge = (a: AttentionItem, b: AttentionItem) => at(a) - at(b);

export function swapOf(items: readonly AttentionItem[], requests: ReadonlyMap<AttentionId, SessionEvent | null>): Swap {
  const open = items.filter(isOpen).sort(byAge);
  const unread: AttentionItem[] = [];
  const answerable: AttentionItem[] = [];
  const notices: AttentionItem[] = [];
  for (const item of open) {
    if (item.kind === 'dialog') {
      if (!requests.has(item.id)) {
        unread.push(item);
        continue;
      }
      const request = requests.get(item.id) ?? null;
      const declared = request?.kind === 'dialog.requested' && declaredDialog(request.dialogKind, request.payload).ok;
      (declared ? answerable : notices).push(item);
    } else if (item.kind === 'permission' || item.kind === 'question' || item.kind === 'plan' || item.kind === 'elicitation') answerable.push(item);
    else if (isActionable(item)) notices.push(item);
  }
  return { item: answerable[0] ?? null, notice: notices[0] ?? null, waiting: Math.max(0, answerable.length - 1), unread };
}
