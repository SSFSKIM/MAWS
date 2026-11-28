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

/**
 * One question as the transcript holds it, from the call that added it: the call whose row holds its line now (the
 * last that added or revised it), each revision's option labels as the entry that set it gave them, and its outcome,
 * the latest standing. An add that names an id the transcript already holds is a new question (a fork whose id floor
 * could not be read starts again at q1, the C3 plan's §I), so an id names the latest of its occurrences.
 */
interface Occurrence {
  owner: ToolUseId;
  labels: Map<number, string[]>;
  outcome: HeldOutcome | undefined;
}

/** What one transcript knows of its sheet calls' questions, append-only along the lineage, as the reducer's `index` is. */
export interface SheetIndex {
  calls: Map<ToolUseId, unknown>; // a sheet call's input, by its tool use
  current: Map<string, Occurrence>; // a question's id: its latest occurrence, which a revise, a withdrawal or a delivery reaches
  lines: Map<ToolUseId, Map<string, Occurrence>>; // a call's lines: the occurrence each of its ids is
}

export const emptySheetIndex = (): SheetIndex => ({ calls: new Map(), current: new Map(), lines: new Map() });

/** Whether a tool use is a call in the sheet's form: the question presentation's tool, its input the sheet's (§2.1). */
export const isSheetUse = (use: Event<'tool.use'>): boolean => presentationOf(use.toolName) === 'question' && isSheetCall(use.input);

/** A sheet call seen: its input is kept for its result. */
export function noteSheetCall(index: SheetIndex, use: Event<'tool.use'>): void {
  if (isSheetUse(use)) index.calls.set(use.toolUseId, use.input);
}

/**
 * A sheet call's result: each question it revised has its line in this call now, each it added is a new question
 * whose line is here, and each it withdrew is withdrawn. Answers the calls whose rows changed, the earlier owner of a
 * moved line among them.
 */
export function noteSheetResult(index: SheetIndex, result: Event<'tool.result'>): ToolUseId[] {
  const input = index.calls.get(result.toolUseId);
  if (input === undefined || result.isError) return [];
  const { entries, withdrew } = callEntries(input, resultText(result.content));
  const touched = new Set<ToolUseId>();
  const own = index.lines.get(result.toolUseId) ?? new Map<string, Occurrence>();
  for (const entry of entries) {
    if (entry.id === null) continue;
    // a result read again is the same call's: its lines stay the occurrences they were
    const occurrence = own.get(entry.id) ?? (entry.outcome === 'revised' ? index.current.get(entry.id) : undefined) ?? { owner: result.toolUseId, labels: new Map<number, string[]>(), outcome: undefined };
    if (occurrence.owner !== result.toolUseId) touched.add(occurrence.owner);
    occurrence.owner = result.toolUseId;
    occurrence.labels.set(entry.outcome === 'revised' ? entry.revision! : 1, entry.options);
    own.set(entry.id, occurrence);
    index.current.set(entry.id, occurrence);
  }
  if (own.size > 0) index.lines.set(result.toolUseId, own);
  for (const id of withdrew) {
    const occurrence = index.current.get(id);
    if (occurrence === undefined) continue;
    occurrence.outcome = { how: 'withdrawn' };
    touched.add(occurrence.owner);
  }
  return [...touched];
}

/** A delivery's blocks: each answered or dismissed question's outcome. Answers the calls that hold their lines. */
export function noteSheetDeliveries(index: SheetIndex, deliveries: readonly SheetDelivery[]): ToolUseId[] {
  const touched = new Set<ToolUseId>();
  const held = (id: string, outcome: HeldOutcome) => {
    const occurrence = index.current.get(id);
    if (occurrence === undefined) return;
    occurrence.outcome = outcome;
    touched.add(occurrence.owner);
  };
  for (const delivery of deliveries) {
    for (const answered of delivery.answered) held(answered.id, { how: 'answered', revision: answered.revision, picks: answered.picks, text: answered.text });
    for (const id of delivery.dismissed) held(id, { how: 'dismissed' });
  }
  return [...touched];
}

/**
 * A held outcome as a line reads it. An answer's receipt is `receiptOf` of the labels its picks name among the options
 * of the entry that set the answered revision in this transcript, and of its text. The answer stands whatever its
 * preview reads: a text that opens with spaces keeps them, as the record's receipt does.
 */
function outcomeOf(occurrence: Occurrence): SheetRowLine['outcome'] {
  const held = occurrence.outcome;
  if (held === undefined) return null;
  if (held.how !== 'answered') return { how: held.how };
  const labels = occurrence.labels.get(held.revision) ?? [];
  const picked = held.picks.flatMap((place) => (labels[place - 1] === undefined ? [] : [labels[place - 1]!]));
  return { how: 'answered', receipt: receiptOf(picked, held.text) };
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
    const occurrence = entry.id === null ? undefined : index?.lines.get(use.toolUseId)?.get(entry.id);
    const place = entry.outcome === 'refused' ? 'refused' : occurrence !== undefined && occurrence.owner !== use.toolUseId ? 'revised_below' : 'here';
    const outcome = place === 'here' && occurrence !== undefined ? outcomeOf(occurrence) : null;
    return { id: entry.id, entry: entry.entry, header: entry.header, sentence: questionSentence(entry.question), revises: named(use.input, at), place, outcome };
  });
  return { ...base, state, lines, withdrew, notDone, error: null };
}
