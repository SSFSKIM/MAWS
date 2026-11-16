// What the composer shows above itself (C7 execution document, M4 "Placements"; UX wave U1b decision 14): the session's
// oldest waiting notice that names no request (an error not seen yet, an interruption, auto mode unavailable). A request
// is drawn in the session's transcript, in its call's row or at the transcript's end, never here and never in the
// editor's place; so is an undeclared dialog or a request whose read failed, with the card's own words. An owner-channel
// question and a must-read stand in the transcript too (P2-C). Pure.
import type { AttentionItem } from '@shared/graph/attention';
import { isActionable, waits } from '@shared/attention/kinds';

const TRANSCRIPT_KINDS: ReadonlySet<AttentionItem['kind']> = new Set(['async_input', 'essential_unread']);
const at = (item: AttentionItem) => Date.parse(item.createdAt);

export function noticeOf(items: readonly AttentionItem[]): AttentionItem | null {
  // the owner's ruling (2026-10-30): an error seen or dismissed is retired, so only an unseen one is a notice here
  const notices = items.filter((item) => waits(item) && isActionable(item) && item.request.requestId === null && !TRANSCRIPT_KINDS.has(item.kind));
  return notices.sort((a, b) => at(a) - at(b))[0] ?? null;
}
