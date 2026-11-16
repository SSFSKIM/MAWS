// The record line's words where MAWS draws the to-human view (UX wave U2b; the execution document, Interfaces §M,
// "Which run a line reads" and "The label's rule"; decisions 27, 28 and 31). Pure. A closed stretch's line reads its
// newest call while the stretch still grows, the summary the to-human mod stored for it once it does not, else nothing
// (`› working record`). The summaries are the mod's, read from its file by the owner service and held by the window
// (`stores/folds.ts`); MAWS makes none and names no model. Each clause names the function of the mod it ports, read on
// the mod's branch at e511aad9 (`to-human/hooks/mods/folds.tsx` and `message.tsx`, by line), the commit the shared
// table of cases (`fold-label-cases.json`, which `label-cases.test.ts` runs) was taken from.
import type { SessionEvent } from '@shared/graph/events';
import type { StoredRun } from '@shared/owner/folds';
import type { TurnState } from '../../transcript/model/reduce';
import type { Cell, Row, TurnId } from '../../transcript/model/rows';
import { assistantInput, messageCarrier, noticeCarrier, sentInput } from '../../transcript/surface/adapters';
import type { Stretch } from './mirror';

/**
 * What a mount hands the mirror for its record lines: the runs the mod's file holds, oldest first, as the window last
 * read them; whether the session's turn runs; and the session's turns, where a row's ids and its calls' inputs are read
 * (§M, "Where the ids and the inputs come from"). No switch is among them: a stored summary is read whatever the
 * summaries' switch says (card 11, "Only new folds").
 */
export interface StretchLabels {
  stored: readonly StoredRun[];
  running: boolean; // the session's turn is running
  turns?: ReadonlyMap<TurnId, TurnState>;
}

type Turns = ReadonlyMap<TurnId, TurnState> | undefined;

// `rowKey` (message.tsx, 194): an id shaped as a row's uuid is known by its first 24 characters, since the engine can
// draw a kept row under another form of it; any other id (a call's) whole.
const ROW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const rowKey = (id: string) => (ROW_ID.test(id) ? id.slice(0, 24) : id);

// ---------------------------------------------------------------------------------------------------------------------
// The ids the transcript keeps a row under.

const callIds = (cell: Cell): string[] => (cell.toolUseId === null ? [] : [...(cell.reads ?? [cell.toolUseId])]);

/**
 * The ids the transcript keeps a row under, which are the ids the row asks its site under (§E): a call's tool-use id
 * (for a run, each member's; for a merged read, each member read's), a text's and a thought's message uuid, an
 * arrival's carrier's. For each kind it reads what the row's own ask reads rather than working the id out a second
 * time: a text's from `assistantInput`, an arrival's from the carrier its ask finds in the turn's events
 * (`messageCarrier`, `noticeCarrier`), a message the agent sent from `sentInput`. A run's ask, and that of a call whose
 * tool joins runs, goes under `group:<first call>`, which names no row of the transcript file: such a row is kept under
 * the calls the ask carries. A row that asks no site is kept under the id the transcript file holds of it, or none.
 */
export function keptIdsOf(row: Row, turn: TurnState | undefined): string[] {
  switch (row.kind) {
    case 'user': return row.messageUuid === null ? [] : [row.messageUuid];
    case 'assistant_text': return row.messageUuid === null ? [] : [assistantInput(row, turn)?.instanceId ?? row.messageUuid];
    case 'thinking': return row.messageUuid === null ? [] : [row.messageUuid]; // `thinkingInput`: the thought's own uuid, bare
    case 'cell': return callIds(row);
    case 'group': return row.cells.flatMap(callIds);
    case 'to_human': case 'agent_list': case 'browser_action': case 'question': return [row.toolUseId]; // `callInput`, `questionInput`
    case 'agent_message': {
      if (turn === undefined) return [];
      const sent = sentInput(row, turn, undefined);
      if (sent !== null) return [sent.instanceId];
      const carrier = messageCarrier(row, turn);
      return carrier?.messageUuid ? [carrier.messageUuid] : [];
    }
    case 'notice': {
      // a notice with no carrier asks under an anchored id (`<anchor>~<row>`) that the file names no row by: kept under none
      const carrier = turn === undefined ? null : noticeCarrier(row, turn)?.carrier;
      return carrier?.messageUuid ? [carrier.messageUuid] : [];
    }
    // rows that ask no site, kept under a call's id or a record's uuid
    case 'subagent': return row.agents.flatMap((agent) => (agent.toolUseId === null ? [] : [agent.toolUseId]));
    case 'ask': case 'plan': case 'delivery': case 'artifact': return [row.toolUseId];
    case 'local_command': return row.messageUuid === null ? [] : [row.messageUuid];
    // rows the transcript file holds no id of as theirs: MAWS's own lines, a request's slot and the browser's activity
    // (their calls are rows of their own), the person's `!` command as MAWS draws it
    case 'time': case 'divider': case 'receipt': case 'record_fold': case 'activity': case 'gap': case 'boundary': case 'error':
    case 'side_thread': case 'request_slot': case 'browser_activity': case 'bash':
      return [];
  }
}

// A row's ids, with the key each is compared by, read once for each row and turn: the rows of a settled turn keep their
// identity across derivations.
interface Kept { turn: TurnState | undefined; ids: readonly string[]; keys: readonly string[] }
const keptMemo = new WeakMap<Row, Kept>();
function keptOf(row: Row, turns: Turns): Kept {
  const turn = row.turnId === null ? undefined : turns?.get(row.turnId);
  const known = keptMemo.get(row);
  if (known !== undefined && known.turn === turn) return known;
  const ids = keptIdsOf(row, turn);
  const kept = { turn, ids, keys: ids.map(rowKey) };
  keptMemo.set(row, kept);
  return kept;
}

// A call as its turn's records hold it: its tool, its raw input and whether its result has come. Built once for each
// turn's event list, which the reducer replaces whenever it changes.
interface CallRecord { tool: string; input: unknown; done: boolean }
interface TurnCalls { records: ReadonlyMap<string, CallRecord>; open: boolean } // open: a call of the turn has no result
const callsMemo = new WeakMap<readonly SessionEvent[], TurnCalls>();
function callsOf(turn: TurnState): TurnCalls {
  const known = callsMemo.get(turn.events);
  if (known !== undefined) return known;
  const records = new Map<string, CallRecord>();
  for (const e of turn.events) {
    if (e.kind === 'tool.use') records.set(e.toolUseId, { tool: e.toolName, input: e.input, done: false });
    else if (e.kind === 'tool.result') {
      const record = records.get(e.toolUseId);
      if (record !== undefined) record.done = true;
    }
  }
  const calls = { records, open: [...records.values()].some((record) => !record.done) };
  callsMemo.set(turn.events, calls);
  return calls;
}

// ---------------------------------------------------------------------------------------------------------------------
// Places: a row's position in the conversation, for MAWS its order among the rows it holds (§M). A row kept under
// several ids (a run's calls, a merged read's reads) holds them in order, each its own place, as the mod's view places
// each kept row of the file; the row's own place is its first id's, as the mod knows a group by its first call. A row
// kept under no id still takes a place, so a run never passes over it unseen.

interface Places {
  ofRow: Map<Row, number>;
  ofId: Map<string, number>; // by `rowKey`: the first place an id is kept at
  size: number; // how many places the rows hold
}
const placesMemo = new WeakMap<readonly Row[], { turns: Turns; places: Places }>();
function placesOf(rows: readonly Row[], turns: Turns): Places {
  const known = placesMemo.get(rows);
  if (known !== undefined && known.turns === turns) return known.places;
  const places: Places = { ofRow: new Map(), ofId: new Map(), size: 0 };
  let at = 0;
  for (const row of rows) {
    places.ofRow.set(row, at);
    const { keys } = keptOf(row, turns);
    for (const key of keys) {
      if (!places.ofId.has(key)) places.ofId.set(key, at);
      at += 1;
    }
    if (keys.length === 0) at += 1;
  }
  places.size = at;
  placesMemo.set(rows, { turns, places });
  return places;
}

// The stored runs whose both bounds the rows place (`labelOf`'s placed runs, folds.tsx 547), indexed once at each change
// of the rows or of the runs for the two clauses that read them, so a line's run is found without a pass over the runs:
// `cover`, for each place, the newest run with first <= place <= last (clause 3), painted newest first with each place
// painted once (`next`: the first place at or after an index not yet painted); `byFirst`, the runs by their first's
// place and then in the file's order (clause 4).
interface Placed { run: StoredRun; first: number; last: number }
interface RunIndex { cover: (StoredRun | undefined)[]; byFirst: Placed[] }
const indexMemo = new WeakMap<readonly StoredRun[], { places: Places; index: RunIndex }>();
function indexOf(places: Places, runs: readonly StoredRun[]): RunIndex {
  const known = indexMemo.get(runs);
  if (known !== undefined && known.places === places) return known.index;
  const placed = runs.flatMap((run): Placed[] => {
    const first = places.ofId.get(rowKey(run.first));
    const last = places.ofId.get(rowKey(run.last));
    return first !== undefined && last !== undefined ? [{ run, first, last }] : [];
  });
  const cover: (StoredRun | undefined)[] = new Array(places.size);
  const next = new Int32Array(places.size + 1);
  for (let i = 0; i < next.length; i += 1) next[i] = i;
  const unpainted = (i: number): number => {
    let root = i;
    while (next[root] !== root) root = next[root]!;
    for (let at = i; next[at] !== root; ) { // the path, compressed
      const up = next[at]!;
      next[at] = root;
      at = up;
    }
    return root;
  };
  for (let i = placed.length - 1; i >= 0; i -= 1) {
    const { run, first, last } = placed[i]!;
    for (let at = unpainted(first); at <= last; at = unpainted(at)) {
      cover[at] = run;
      next[at] = at + 1;
    }
  }
  const byFirst = placed.toSorted((a, b) => a.first - b.first); // stable: the file's order among equal firsts
  const index = { cover, byFirst };
  indexMemo.set(runs, { places, index });
  return index;
}

// `labelOf` (folds.tsx 547), §M's one rule, clauses 1 and 3 to 5. Clause 2, the open run, never applies for MAWS: the
// mod alone holds it, and its file holds an open run's summary as a run bounded by the last row it covered, which
// clause 3 or 4 finds.
function runAt(stretch: Stretch, places: Places, index: RunIndex): StoredRun | undefined {
  // 1. `at` is the place of the stretch's head, else of its first row
  const head = stretch.head ?? stretch.rows[0];
  const at = head === undefined ? undefined : places.ofRow.get(head);
  if (at === undefined) return undefined;
  // 3. the newest closed run with both bounds placed and first <= at <= last
  const covering = index.cover[at];
  if (covering !== undefined) return covering;
  // 4. else, of the runs with both bounds placed, the one whose first lies after `at` and at or before the place of the
  // stretch's last row, nearest first; on a tie the earlier in the file's order
  const end = places.ofRow.get(stretch.rows.at(-1) ?? head);
  if (end === undefined) return undefined;
  const { byFirst } = index;
  let low = 0;
  let high = byFirst.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (byFirst[mid]!.first > at) high = mid;
    else low = mid + 1;
  }
  const nearest = byFirst[low];
  // 5. else none: the line reads `working record`
  return nearest !== undefined && nearest.first <= end ? nearest.run : undefined;
}

/** §M's one rule from a line's stretch to its stored run, over the runs in the file's order; no fallback of MAWS's own. */
export function runOf(stretch: Stretch, rows: readonly Row[], runs: readonly StoredRun[], turns?: ReadonlyMap<TurnId, TurnState>): StoredRun | undefined {
  const places = placesOf(rows, turns);
  return runAt(stretch, places, indexOf(places, runs));
}

// ---------------------------------------------------------------------------------------------------------------------
// A call's line: `lineOf` (folds.tsx 188), with `lineFor` (148), `oneLine` (140) and `baseName` (145), clause for clause.

/** How long a line runs before it is cut (`LINE_MAX`, folds.tsx 137). */
const LINE_MAX = 120;

// `oneLine`: newlines become spaces, and past `LINE_MAX` characters it is cut with `…`, between code points.
function oneLine(text: string): string {
  const chars = Array.from(text.replace(/\s*[\r\n]+\s*/g, ' ').trim());
  return chars.length > LINE_MAX ? `${chars.slice(0, LINE_MAX - 1).join('')}…` : chars.join('');
}

const baseName = (path: string) => path.split(/[/\\]/).filter((part) => part !== '').at(-1) ?? path;

// `lineFor`: the call's line by its tool, or undefined where the input lacks what the line is made of.
function lineFor(tool: string, field: (name: string) => string | undefined): string | undefined {
  switch (tool) {
    case 'Bash':
      return field('description') ?? field('command')?.trim().split('\n')[0];
    case 'Read':
    case 'Edit':
    case 'Write': {
      const path = field('file_path');
      return path === undefined ? undefined : `${tool} ${baseName(path)}`;
    }
    case 'NotebookEdit': {
      const path = field('notebook_path');
      return path === undefined ? undefined : `Edit ${baseName(path)}`;
    }
    case 'Grep':
    case 'Glob': {
      const pattern = field('pattern');
      return pattern === undefined ? undefined : `Search "${pattern}"`;
    }
    case 'SendMessage': {
      const [to, summary] = [field('to'), field('summary')];
      return to === undefined ? undefined : summary === undefined ? `Message to ${to}` : `Message to ${to}: ${summary}`;
    }
    case 'Skill': {
      const skill = field('skill');
      return skill === undefined ? undefined : `Skill ${skill}`;
    }
    case 'ToolSearch': {
      const query = field('query');
      return query === undefined ? undefined : `Tool search "${query}"`;
    }
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  return mcp === null ? undefined : `${mcp[1]}: ${mcp[2]}`;
}

/** One tool call as one line, from the call's name and raw input (`lineOf`); MAWS's own caption of the call is not used. */
export function lineOf(tool: string, input: unknown): string {
  const field = (name: string) => {
    const value = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[name] : undefined;
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  };
  return oneLine(lineFor(tool, field) ?? tool);
}

// ---------------------------------------------------------------------------------------------------------------------
// The label.

// Whether a turn of the stretch holds a call with no result.
function holdsOpenCall(stretch: Stretch, turns: Turns): boolean {
  if (turns === undefined) return false;
  for (const id of stretch.turns) {
    const turn = turns.get(id);
    if (turn !== undefined && callsOf(turn).open) return true;
  }
  return false;
}

/**
 * The live half of `labelFor` (folds.tsx 526: the run's line before its summary while the run is live). To MAWS a
 * stretch is live while one of its calls has no result, or while it is the rows' last stretch and the session's turn
 * runs. Its line is that of its newest call after the row the stored run's `last` names (of its newest call, with no
 * run stored); with none, it has no line and the stored summary reads on. A call's tool and raw input are looked up by
 * its tool-use id in its turn's records.
 */
export function liveLine(stretch: Stretch, covered: StoredRun | undefined, last: boolean, running: boolean, turns?: ReadonlyMap<TurnId, TurnState>): string | undefined {
  const lastRunning = last && running;
  // a settled stretch, the most of them, is told by its turns alone: none holds a call with no result
  if (!lastRunning && !holdsOpenCall(stretch, turns)) return undefined;
  const kept: { key: string; call: CallRecord | undefined }[] = [];
  for (const row of stretch.head === null ? stretch.rows : [stretch.head, ...stretch.rows]) {
    const turn = row.turnId === null ? undefined : turns?.get(row.turnId);
    const calls = turn === undefined ? undefined : callsOf(turn).records;
    const { ids, keys } = keptOf(row, turns);
    ids.forEach((id, i) => kept.push({ key: keys[i]!, call: calls?.get(id) }));
  }
  const live = lastRunning || kept.some(({ call }) => call !== undefined && !call.done);
  if (!live) return undefined;
  // after the row the stored run's last names; a last no row of the stretch holds stands past it, so no call is newer
  let from = 0;
  if (covered !== undefined) {
    const coveredKey = rowKey(covered.last);
    const at = kept.findLastIndex(({ key }) => key === coveredKey);
    from = at < 0 ? kept.length : at + 1;
  }
  const newest = kept.slice(from).findLast(({ call }) => call !== undefined)?.call;
  return newest === undefined ? undefined : lineOf(newest.tool, newest.input);
}

/**
 * A closed stretch's label: its live line, where the stretch is live and has one; else the stored run's summary; else
 * undefined, which reads `working record`. Card 11 ("Only new folds") is answered here: no switch is among its inputs,
 * so a summary made before the switch went off stays.
 */
export function recordLabel(stretch: Stretch, rows: readonly Row[], labels: StretchLabels, last: boolean): string | undefined {
  const covered = runOf(stretch, rows, labels.stored, labels.turns);
  return liveLine(stretch, covered, last, labels.running, labels.turns) ?? covered?.summary;
}

/**
 * The label the mirror writes on each closed stretch's line (`mirrorRows`' last argument), over the rows the mirror runs
 * over; undefined where the mount hands no labels in, whose lines read `working record`.
 */
export function labelsOf(rows: readonly Row[], labels: StretchLabels | undefined): ((stretch: Stretch, last: boolean) => string | undefined) | undefined {
  return labels === undefined ? undefined : (stretch, last) => recordLabel(stretch, rows, labels, last);
}
