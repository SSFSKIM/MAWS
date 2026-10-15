// The stretch of a session's main transcript one fold of its direct channel stands for (DX8's `transcript` slot): the
// rows strictly between two exchange items, cut at span granularity. Each bound is the `src` of the item:
//
// - a `<message>` span, `<row uuid>#<span index>`: the index counts the row's marked spans from 0, as `sminos record`
//   numbers the `message` events it exports from that row (doperpowers' `host_events`). Only the bounding span is left
//   out: unmarked text of the same row before it (a `to`) or after it (a `from`) is working record and is drawn;
// - a question, its call id (`toolUseId ?? request`, composite 43a27604: the transcript's own call): the row holding
//   that `tool_use` is the question, and its `tool_result` (the answer, which the channel draws) belongs to it too. Only
//   the question's own call and result are left out: other work between the call and its answer (a parallel tool's
//   call and result) is working record and is drawn.
//
// A null bound is open: the transcript's start, or its end (a live session's last fold, which rows arriving later
// extend). A bound no held row names is `missing`; the slot pages older rows in while one may still be found, and
// draws an unresolved bound as open, never less than what lies between.
import { parse, type Part } from '@shared/owner/to-human-parser';
import type { JsonObject } from 'desk-hub/protocol';

export type Range = { from: string | null; to: string | null };
export type BoundState = 'open' | 'found' | 'missing';
export type RangeView<R extends JsonObject> = { rows: R[]; from: BoundState; to: BoundState };

type Bound = { row: string; span: number } | { call: string };

function boundOf(src: string): Bound {
  const at = src.lastIndexOf('#');
  const span = at > 0 ? Number(src.slice(at + 1)) : NaN;
  return Number.isInteger(span) && span >= 0 ? { row: src.slice(0, at), span } : { call: src };
}

const contentOf = (row: JsonObject): unknown[] => {
  const content = (row.message as JsonObject | undefined)?.content;
  return Array.isArray(content) ? content : [];
};
const blockOf = (block: unknown): JsonObject | null => (typeof block === 'object' && block !== null ? (block as JsonObject) : null);
const callsIn = (row: JsonObject, call: string) => row.type === 'assistant' && contentOf(row).some((b) => blockOf(b)?.type === 'tool_use' && blockOf(b)?.id === call);
const answers = (row: JsonObject, call: string) => row.type === 'user' && contentOf(row).some((b) => blockOf(b)?.type === 'tool_result' && blockOf(b)?.tool_use_id === call);

/** The index of the row holding a bound's item; -1 when no held row does. */
const locate = (rows: readonly (JsonObject & { uuid: string })[], bound: Bound): number =>
  'row' in bound ? rows.findIndex((row) => row.uuid === bound.row) : rows.findIndex((row) => callsIn(row, bound.call));

// Each row without a question's answer, so the same row is the same object: a live row then continues what is drawn.
const unanswered = new WeakMap<JsonObject, Map<string, JsonObject | null>>();

/** The row without the question `call`'s `tool_result` blocks (the row itself when it has none); null when nothing is left. */
function withoutAnswer<R extends JsonObject>(row: R, call: string): R | null {
  if (!answers(row, call)) return row;
  let byCall = unanswered.get(row);
  if (!byCall) unanswered.set(row, (byCall = new Map()));
  if (!byCall.has(call)) {
    const rest = contentOf(row).filter((b) => !(blockOf(b)?.type === 'tool_result' && blockOf(b)?.tool_use_id === call));
    byCall.set(call, rest.length === 0 ? null : { ...row, message: { ...(row.message as JsonObject), content: rest } });
  }
  return byCall.get(call) as R | null;
}

// The grammar's mark names, `to-human` written as `<message>` (its name since contract 2).
const tagOf = (kind: Exclude<Part['kind'], 'plain'>) => (kind === 'to-human' ? 'message' : kind);

/** A part back as the text it was parsed from, closely enough that the grammar reads it the same. */
function textOf(part: Part): string {
  if (part.kind === 'plain') return part.text;
  const choices = (part.choices ?? []).map((c) => `\n<choice${c.recommended ? ' recommended' : ''}>${c.text}</choice>`).join('');
  return `<${tagOf(part.kind)}>${part.text}${choices}</${tagOf(part.kind)}>`;
}

/** The row's text parts strictly after its marked span `after` and before its marked span `before` (null: no cut). */
function cutText(text: string, after: number | null, before: number | null): string {
  let marked = -1; // the index of the last marked span passed
  const kept: Part[] = [];
  for (const part of parse(text)) {
    if (part.kind !== 'plain') marked += 1;
    // A span is inside when its own index is; plain text when the spans passed before it put it there.
    const inside = part.kind !== 'plain' ? (after === null || marked > after) && (before === null || marked < before) : (after === null || marked >= after) && (before === null || marked < before);
    if (inside) kept.push(part);
  }
  return kept.map(textOf).join('').trim();
}

// Each row's cuts, so the same row cut the same way is the same object: a live row then continues what is drawn.
const cuts = new WeakMap<JsonObject, Map<string, JsonObject | null>>();

/** A bounding row cut to what lies inside the range (the same object for the same row and cut); null when nothing does. */
function cutRow<R extends JsonObject>(row: R, after: number | null, before: number | null): R | null {
  let byCut = cuts.get(row);
  if (!byCut) cuts.set(row, (byCut = new Map()));
  const key = `${after}:${before}`;
  if (!byCut.has(key)) byCut.set(key, cut(row, after, before));
  return byCut.get(key) as R | null;
}

function cut<R extends JsonObject>(row: R, after: number | null, before: number | null): R | null {
  const blocks = contentOf(row);
  const texts = blocks.flatMap((b) => (blockOf(b)?.type === 'text' ? [String(blockOf(b)!.text ?? '')] : []));
  if (texts.length !== 1 || blocks.length !== 1) return null; // one content block per row; a span lies in a text one
  const text = cutText(texts[0], after, before);
  if (text === '') return null;
  return { ...row, message: { ...(row.message as JsonObject), content: [{ ...blockOf(blocks[0])!, text }] } };
}

/** The held rows (oldest first) a range draws, and whether each of its bounds was found among them. */
export function rowsInRange<R extends JsonObject & { uuid: string }>(rows: readonly R[], range: Range): RangeView<R> {
  const from = range.from === null ? null : boundOf(range.from);
  const to = range.to === null ? null : boundOf(range.to);
  const at = from === null ? -1 : locate(rows, from);
  const end = to === null ? -1 : locate(rows, to);
  const start = at < 0 ? null : at;
  const stop = end < 0 ? null : end;
  const view: RangeView<R> = { rows: [], from: from === null ? 'open' : start !== null ? 'found' : 'missing', to: to === null ? 'open' : stop !== null ? 'found' : 'missing' };
  const spanFrom = from !== null && 'row' in from && start !== null ? from.span : null;
  const spanTo = to !== null && 'row' in to && stop !== null ? to.span : null;
  const answered = from !== null && 'call' in from && start !== null ? from.call : null;
  if (start !== null && stop !== null && stop < start) return view;
  if (start !== null && start === stop && spanFrom !== null && spanTo !== null) {
    // Both bounds in one row: what lies between its two spans.
    const between = cutRow(rows[start], spanFrom, spanTo);
    if (between) view.rows.push(between);
    return view;
  }
  if (spanFrom !== null) {
    const after = cutRow(rows[start!], spanFrom, null);
    if (after) view.rows.push(after);
  }
  const first = start === null ? 0 : start + 1;
  for (const row of rows.slice(first, Math.max(first, stop ?? rows.length))) {
    const kept = answered === null ? row : withoutAnswer(row, answered);
    if (kept) view.rows.push(kept);
  }
  if (spanTo !== null) {
    const before = cutRow(rows[stop!], null, spanTo);
    if (before) view.rows.push(before);
  }
  return view;
}

/**
 * The bounds a fold says it could not find, once no older page can help: its start when the transcript has no older
 * rows; its end too once its start is held, since the end follows the start (older pages are not asked for then).
 */
export function unresolvedBounds(state: { phase: string; more: boolean; bounds: { from: BoundState; to: BoundState } | null }): { start: boolean; end: boolean } {
  const { bounds } = state;
  if (state.phase !== 'live' || bounds === null) return { start: false, end: false };
  return { start: bounds.from === 'missing' && !state.more, end: bounds.to === 'missing' && (!state.more || bounds.from === 'found') };
}
