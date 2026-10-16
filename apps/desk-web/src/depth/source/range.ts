// The stretch of a session's main transcript one fold of its direct channel stands for (DX8's `transcript` slot): the
// rows strictly between two exchange items, cut at span granularity. Each bound is the `src` of the item:
//
// - a `<message>` span, `<row uuid>#<span index>`: the index counts the row's marked spans from 0, as `sminos record`
//   numbers the `message` events it exports from that row (doperpowers' `host_events`), read with the export's grammar
//   (`export-marks.ts`: an unclosed mark is a span to the end of the text). Only the bounding span is left
//   out: unmarked text of the same row before it (a `to`) or after it (a `from`) is working record and is drawn;
// - a question, its call id (`toolUseId ?? request`, composite 43a27604: the transcript's own call): the row holding
//   that `tool_use` is the question, and its `tool_result` (the answer, which the channel draws) belongs to it too. Only
//   the question's own call and result are left out: other work between the call and its answer (a parallel tool's
//   call and result) is working record and is drawn.
//
// A tool's result draws with its call, where the complete transcript draws it: MAWS's reducer routes a result to the
// call it answers and its derivation draws the pair as the call's row, at the call's place. So a fold holding a call
// also holds that call's result when the result was written after the fold's end (a question asked while the tool
// ran), and a fold whose start comes after a call leaves that call's result out — it is drawn in the earlier fold, and
// here it would be a result without its call, which draws nothing. The question's own answer is such a result.
//
// A null bound is open: the transcript's start, or its end (a live session's last fold, which rows arriving later
// extend). A bound no held row names is `missing`; the slot pages older rows in while one may still be found, and
// draws an unresolved bound as open, never less than what lies between.
import type { JsonObject } from 'desk-hub/protocol';
import { exportParts } from './export-marks';

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

/** The index of the row holding a bound's item; -1 when no held row does. */
const locate = (rows: readonly (JsonObject & { uuid: string })[], bound: Bound): number =>
  'row' in bound ? rows.findIndex((row) => row.uuid === bound.row) : rows.findIndex((row) => callsIn(row, bound.call));

const callIds = (rows: readonly JsonObject[]): Set<string> =>
  new Set(rows.flatMap((row) => (row.type === 'assistant' ? contentOf(row).flatMap((b) => (blockOf(b)?.type === 'tool_use' && typeof blockOf(b)?.id === 'string' ? [String(blockOf(b)!.id)] : [])) : [])));
const resultOf = (block: unknown): string | null => (blockOf(block)?.type === 'tool_result' && typeof blockOf(block)?.tool_use_id === 'string' ? String(blockOf(block)!.tool_use_id) : null);

// Each row's result cuts, so the same row cut the same way is the same object: a live row then continues what is drawn.
const resultCuts = new WeakMap<JsonObject, Map<string, JsonObject | null>>();

/**
 * The row with its blocks filtered: `keep` decides each `tool_result` block by the call it answers; with `onlyResults`
 * every other block goes too. The row itself when nothing goes, null when nothing is left.
 */
function filterResults<R extends JsonObject>(row: R, keep: (call: string) => boolean, onlyResults: boolean): R | null {
  if (row.type !== 'user' && onlyResults) return null;
  const blocks = contentOf(row);
  const kept = blocks.filter((b) => {
    const call = resultOf(b);
    return call === null ? !onlyResults : keep(call);
  });
  if (kept.length === blocks.length && blocks.length > 0) return row;
  if (kept.length === 0) return null;
  const key = `${onlyResults ? 'o' : 's'}:${kept.map((b) => resultOf(b) ?? '').join(',')}`;
  let byCut = resultCuts.get(row);
  if (!byCut) resultCuts.set(row, (byCut = new Map()));
  if (!byCut.has(key)) byCut.set(key, { ...row, message: { ...(row.message as JsonObject), content: kept } });
  return byCut.get(key) as R;
}

/**
 * The row's text strictly after its span `after` and before its span `before` (null: no cut), the spans read with the
 * export's own grammar (`export-marks.ts`), so the indices are the ones the bounds carry. The working record around
 * them is kept as written (tag-free outside code); a span inside the stretch (one the log missed) is kept as a
 * `<message>`, which MAWS's Presenter then draws as one.
 */
function cutText(text: string, after: number | null, before: number | null): string {
  let passed = -1; // the index of the last span passed
  let kept = '';
  for (const part of exportParts(text)) {
    if (part.kind === 'span') passed = part.index;
    const inside = part.kind === 'span' ? (after === null || passed > after) && (before === null || passed < before) : (after === null || passed >= after) && (before === null || passed < before);
    if (inside) kept += part.kind === 'span' ? `<message>${part.text}</message>` : part.text;
  }
  return kept.trim();
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
  const middle = rows.slice(first, Math.max(first, stop ?? rows.length));
  // Results of calls made before the fold are drawn with their calls, in an earlier fold; results of the fold's own
  // calls written after its end are drawn here, with them.
  const earlier = callIds(rows.slice(0, first));
  const own = callIds(middle);
  for (const row of middle) {
    const kept = earlier.size === 0 ? row : filterResults(row, (call) => own.has(call) || !earlier.has(call), false);
    if (kept) view.rows.push(kept);
  }
  if (spanTo !== null) {
    const before = cutRow(rows[stop!], null, spanTo);
    if (before) view.rows.push(before);
  }
  if (stop !== null && own.size > 0) {
    for (const row of rows.slice(stop + 1)) {
      const late = filterResults(row, (call) => own.has(call), true);
      if (late) view.rows.push(late);
    }
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
