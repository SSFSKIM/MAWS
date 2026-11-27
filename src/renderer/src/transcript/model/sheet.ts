// The question sheet's row (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §I; the composite's §8.1 and
// S8): what the transcript alone shows of a call of the sminos tool in the sheet's form. Each call's own lines come from
// its input and its result's text (`callEntries`, X7); what one call's line needs from the rest of the transcript (that
// a later call revised its question, a call withdrew it, a delivery's block answered or dismissed it) is kept per
// transcript in `SheetIndex`, which the reducer feeds in the transcript's order. The reducer bumps the turn that holds a
// question's line when that line's place or outcome moves, as `joinAnswers` does for today's tool. Pure.
import type { SessionEvent } from '@shared/graph/events';
import type { ToolUseId } from '@shared/graph/ids';
import { callEntries, isSheetCall } from '@shared/sheet/call';
import type { SheetDelivery } from '@shared/sheet/delivery';
import { questionSentence, receiptOf } from '@shared/sheet/words';
import { engineRefusalOf, resultText } from './cells';
import { presentationOf } from './classify';
import { rowId } from './keys';
import type { Row, SheetRowLine, TurnId } from './rows';

type Event<K extends SessionEvent['kind']> = Extract<SessionEvent, { kind: K }>;
type SheetRowData = Extract<Row, { kind: 'sheet' }>;

/** A question's outcome as the transcript holds it: a delivery's answer, with the revision it answered; a dismissal; a withdrawal. */
type HeldOutcome = { how: 'answered'; revision: number; picks: number[]; text: string } | { how: 'dismissed' } | { how: 'withdrawn' };

/** What one transcript knows of its sheet calls' questions, append-only along the lineage, as the reducer's `index` is. */
export interface SheetIndex {
  calls: Map<ToolUseId, unknown>; // a sheet call's input, by its tool use
  owners: Map<string, ToolUseId>; // a question's id: the last call that added or revised it
  labels: Map<string, Map<number, string[]>>; // a question's id: each revision's option labels, as the entry that set it gave them
  outcomes: Map<string, HeldOutcome>; // a question's id: its outcome, the latest standing
}

export const emptySheetIndex = (): SheetIndex => ({ calls: new Map(), owners: new Map(), labels: new Map(), outcomes: new Map() });

/** Whether a tool use is a call in the sheet's form: the question presentation's tool, its input the sheet's (§2.1). */
export const isSheetUse = (use: Event<'tool.use'>): boolean => presentationOf(use.toolName) === 'question' && isSheetCall(use.input);

/** A sheet call seen: its input is kept for its result. */
export function noteSheetCall(index: SheetIndex, use: Event<'tool.use'>): void {
  if (isSheetUse(use)) index.calls.set(use.toolUseId, use.input);
}

/**
 * A sheet call's result: each question it added or revised has its line in this call now, and each it withdrew is
 * withdrawn. Answers the calls whose rows changed, the earlier owner of a moved line among them.
 */
export function noteSheetResult(index: SheetIndex, result: Event<'tool.result'>): ToolUseId[] {
  const input = index.calls.get(result.toolUseId);
  if (input === undefined || result.isError) return [];
  const { entries, withdrew } = callEntries(input, resultText(result.content));
  const touched = new Set<ToolUseId>();
  for (const entry of entries) {
    if (entry.id === null) continue;
    const earlier = index.owners.get(entry.id);
    if (earlier !== undefined && earlier !== result.toolUseId) touched.add(earlier);
    index.owners.set(entry.id, result.toolUseId);
    const revisions = index.labels.get(entry.id) ?? new Map<number, string[]>();
    index.labels.set(entry.id, revisions.set(entry.outcome === 'revised' ? entry.revision! : 1, entry.options));
  }
  for (const id of withdrew) {
    index.outcomes.set(id, { how: 'withdrawn' });
    const owner = index.owners.get(id);
    if (owner !== undefined) touched.add(owner);
  }
  return [...touched];
}

/** A delivery's blocks: each answered or dismissed question's outcome. Answers the calls that hold their lines. */
export function noteSheetDeliveries(index: SheetIndex, deliveries: readonly SheetDelivery[]): ToolUseId[] {
  const touched = new Set<ToolUseId>();
  const owned = (id: string) => {
    const owner = index.owners.get(id);
    if (owner !== undefined) touched.add(owner);
  };
  for (const delivery of deliveries) {
    for (const answered of delivery.answered) {
      index.outcomes.set(answered.id, { how: 'answered', revision: answered.revision, picks: answered.picks, text: answered.text });
      owned(answered.id);
    }
    for (const id of delivery.dismissed) {
      index.outcomes.set(id, { how: 'dismissed' });
      owned(id);
    }
  }
  return [...touched];
}

/**
 * A held outcome as a line reads it. An answer's receipt is `receiptOf` of the labels its picks name among the options
 * of the entry that set the answered revision in this transcript, and of its text; an answer that names no label this
 * transcript holds and has no text reads as nothing held.
 */
function outcomeOf(index: SheetIndex, id: string): SheetRowLine['outcome'] {
  const held = index.outcomes.get(id);
  if (held === undefined) return null;
  if (held.how !== 'answered') return { how: held.how };
  const labels = index.labels.get(id)?.get(held.revision) ?? [];
  const picked = held.picks.flatMap((place) => (labels[place - 1] === undefined ? [] : [labels[place - 1]!]));
  const receipt = receiptOf(picked, held.text);
  return receipt.trim() === '' ? null : { how: 'answered', receipt };
}

/** A sheet call's row, from its call, its result when it has one, and what the transcript holds of its questions. */
export function sheetRowOf(use: Event<'tool.use'>, result: Event<'tool.result'> | null, turnId: TurnId, index: SheetIndex | null): SheetRowData {
  const base = { id: rowId.sheet(use.toolUseId), turnId, at: use.at, kind: 'sheet' as const, toolUseId: use.toolUseId };
  const named = (input: unknown, at: number): boolean => {
    const ask = (input as { ask?: unknown }).ask;
    const entry = Array.isArray(ask) ? (ask[at] as { id?: unknown } | undefined) : undefined;
    return typeof entry === 'object' && entry !== null && typeof entry.id === 'string';
  };
  if (result?.isError === true) {
    // the engine refused the whole call (its validation, a denial): no first line, no ids
    const text = resultText(result.content);
    const { entries } = callEntries(use.input, null);
    const lines = entries.map((entry, at): SheetRowLine => ({ id: null, entry: entry.entry, header: entry.header, sentence: questionSentence(entry.question), revises: named(use.input, at), place: 'here', outcome: null }));
    return { ...base, state: 'error', lines, withdrew: [], notDone: null, error: engineRefusalOf(text) ?? text.trim() };
  }
  const { result: read, entries, withdrew, notDone } = callEntries(use.input, result === null ? null : resultText(result.content));
  const state: SheetRowData['state'] = result === null ? 'running' : read === null || read.form === 'unknown' ? 'unknown' : read.form === 'nothing' ? 'nothing' : 'done';
  const lines = entries.map((entry, at): SheetRowLine => {
    const owner = entry.id === null ? undefined : index?.owners.get(entry.id);
    const place = entry.outcome === 'refused' ? 'refused' : owner !== undefined && owner !== use.toolUseId ? 'revised_below' : 'here';
    const outcome = place === 'here' && entry.id !== null && index !== null ? outcomeOf(index, entry.id) : null;
    return { id: entry.id, entry: entry.entry, header: entry.header, sentence: questionSentence(entry.question), revises: named(use.input, at), place, outcome };
  });
  return { ...base, state, lines, withdrew, notDone, error: null };
}
