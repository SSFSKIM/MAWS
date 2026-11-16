// UX wave U1b (docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md, Interfaces §A; decisions 4, 5
// and 15): the one definition of a session's waiting requests that every drawing of them reads (a transcript's rows and
// its end, the card column's card, the jump button), and where each is drawn in one transcript. The list is U1a's
// predicate, `waitsOnAnswer`: an item of the to-human view names no request and is not in it. Pure; no wire.
import type { AttentionItem } from '../graph/attention';
import type { ToolUseId } from '../graph/ids';
import { waitsOnAnswer } from './kinds';

const at = (item: AttentionItem) => Date.parse(item.createdAt);

/** A session's waiting requests, oldest first (`createdAt`, then id): its items for which `waitsOnAnswer` holds. */
export function waitingRequests(items: readonly AttentionItem[]): AttentionItem[] {
  return items.filter(waitsOnAnswer).sort((a, b) => at(a) - at(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The kinds answered in a form in the call's row: `question`, `plan`, `async_input`. Every other kind of the list is a card at the end. */
export const FORM_KINDS: ReadonlySet<AttentionItem['kind']> = new Set<AttentionItem['kind']>(['question', 'plan', 'async_input']);

/** The calls a transcript marks as waiting rows: the call each form-kind request of the list names. */
export function waitingForms(items: readonly AttentionItem[]): ReadonlySet<ToolUseId> {
  const calls = new Set<ToolUseId>();
  for (const item of items) if (FORM_KINDS.has(item.kind) && item.request.toolUseId !== null && waitsOnAnswer(item)) calls.add(item.request.toolUseId);
  return calls;
}

export interface Placed { item: AttentionItem; place: 'row' | 'end' }
/**
 * The list with each request's place in one transcript.
 * `drawn`: the calls whose waiting row that transcript draws now (after its view's projection and its first-row cut).
 * `agent`: null for a session's own transcript, which lists every request of the session; an agent's id for that
 * agent's transcript, which lists only the requests whose `request.agentId` is the id.
 * A form-kind request is at `row` when `drawn` has its call, else at `end`; every other kind is at `end`.
 */
export function placeWaiting(items: readonly AttentionItem[], drawn: ReadonlySet<ToolUseId>, agent: string | null): Placed[] {
  return waitingRequests(items)
    .filter((item) => agent === null || item.request.agentId === agent)
    .map((item) => ({ item, place: FORM_KINDS.has(item.kind) && item.request.toolUseId !== null && drawn.has(item.request.toolUseId) ? 'row' : 'end' }));
}
