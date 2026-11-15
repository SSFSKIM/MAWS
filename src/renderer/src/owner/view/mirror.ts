// The mirror (UX wave U2b; the execution document, Interfaces §B and §C): MAWS's own application of the to-human
// mod's fold, for every route where no mod draws MAWS's view. A pure pass over the rows the transcript draws: every row
// is classed as the mod classes the row it would be asked about, and the work between two rows the person reads (a
// stretch) is one `› working record` line until the reader opens it, then the plain transcript's rows with
// `‹ fold to report` under the last. Each clause names the function of the mod it ports, read at 0.8.2
// (`to-human/hooks/mods/to-human.tsx`, by line). The mod's row kinds (`RowKind`, 319) are `user`, `marked`, `mixed`
// and `record`; here they are `stays`, `stays`, `mixed` and `folds`, and `none` for a row of no stretch.
//
// It scans for no message to decide whether the view is in force: its callers apply it only while the store's
// `noTurnFold` is set, the view is the report and MAWS draws it (`ui.modDraws` unset), so it never projects rows a
// closed turn withheld.
import { marksOfText } from '../../transcript/model/owner-marks';
import { rowId } from '../../transcript/model/keys';
import type { TranscriptState, TranscriptUi } from '../../transcript/model/reduce';
import type { CellId, Row, RowId, TurnId } from '../../transcript/model/rows';

export type ViewClass = 'stays' | 'folds' | 'mixed' | 'none';

// The report is the view while the session's lane is on, unless the reader chose the transcript for the tab.
export const reportViewOf = (ui: Pick<TranscriptUi, 'ownerLane' | 'view'> | undefined): boolean => ui?.ownerLane === true && ui.view !== 'transcript';

// The rows of the session's open turn whose streaming text already carries a mark, as one string (a stable selector
// value: the view re-projects when it changes, not with every delta).
export function liveMarkedRowIds(state: TranscriptState | undefined): string {
  const turn = state?.current ? state.turns.get(state.current) : undefined;
  if (!turn) return '';
  const ids: string[] = [];
  for (const block of turn.live.values()) if (!block.completed && block.blockType === 'text' && marksOfText(block.buffer, true).marked) ids.push(block.rowId);
  return ids.join('\n');
}

/**
 * The live marks of what a transcript draws: the store's streaming blocks (`liveMarkedRowIds`, given as `stored`), and
 * the live rows handed in from outside the store (lane A's stream, the desk's), which carry their current text inline.
 * A native live row's own markdown is its first delta and stale, so a live row is marked exactly when its id is here.
 */
export function liveMarksOf(stored: string, outside: readonly Row[]): string {
  const ids = outside.filter((row) => row.kind === 'assistant_text' && row.live && marksOfText(row.markdown, true).marked).map((row) => row.id);
  return ids.length === 0 ? stored : [...(stored === '' ? [] : [stored]), ...ids].join('\n');
}

/** Whether the mirror applies to the tab's rows: the view is in force, is the report, and MAWS draws it. */
export const mirrorsView = (ui: Pick<TranscriptUi, 'ownerLane' | 'view' | 'noTurnFold' | 'modDraws'> | undefined): boolean =>
  ui?.noTurnFold === true && reportViewOf(ui) && ui.modDraws !== true;

const liveSet = (liveMarked: string | undefined): ReadonlySet<string> | null => (liveMarked === undefined ? null : new Set(liveMarked === '' ? [] : liveMarked.split('\n')));

type TextRow = Extract<Row, { kind: 'assistant_text' }>;

// `AssistantMessage`'s reading of a text (`spanRows`, 1411): its marks are its messages, words outside them its own
// record. A live row is marked by the live grammar (`liveMarked`; inline when no string is given); while it streams it
// is drawn whole, as the authored live text is, so it is never mixed until it completes.
function textClass(row: TextRow, live: ReadonlySet<string> | null): ViewClass {
  if (row.live) return (live === null ? marksOfText(row.markdown, true).marked : live.has(row.id)) ? 'stays' : 'folds';
  const marks = marksOfText(row.markdown);
  return !marks.marked ? 'folds' : marks.unmarked ? 'mixed' : 'stays';
}

// What a row's class reads of the other rows: the questions that carry their answer's receipt, and the spawns the
// transcript shows.
interface Context {
  live: ReadonlySet<string> | null;
  receipted: ReadonlySet<string>;
  spawns: ReadonlySet<string>;
}

function contextOf(rows: readonly Row[], liveMarked: string | undefined): Context {
  const receipted = new Set<string>();
  const spawns = new Set<string>();
  for (const row of rows) {
    if (row.kind === 'question' && row.answers !== null) receipted.add(row.toolUseId);
    else if (row.kind === 'ask' && (row.state === 'answered' || row.state === 'cancelled')) receipted.add(row.toolUseId);
    else if (row.kind === 'subagent') for (const agent of row.agents) if (agent.toolUseId !== null) spawns.add(agent.toolUseId);
  }
  return { live: liveSet(liveMarked), receipted, spawns };
}

/** §B, row by row: one exhaustive switch over the row kinds, with no default branch. */
function classOf(row: Row, context: Context): ViewClass {
  switch (row.kind) {
    // `promptRow` (400 to 417): an origin that is not in `DELIVERED` (329) is the person's: a prompt, a steer, one still
    // waiting in the queue's tail. Arrivals are U3's own rows (`agent_message`, `notice`).
    case 'user': return 'stays';
    // The person's own `!` command: the mod is never asked about it. Decided here (card 3).
    case 'bash': return 'stays';
    // `AssistantMessage`: `spanRows` (1411) for its messages; `runStart` (430) for a mixed text, whose own words open
    // with the stretch after it; a text with no message (commentary, an unmarked answer, a reply an interrupt cut) is
    // `record`.
    case 'assistant_text': return textClass(row, context.live);
    // `isRead` (605) for the message tool, drawn by `spanRows`; a call that sent nothing (`isUnsent`, 623) is a `cell`.
    case 'to_human': return 'stays';
    // `recordRow` (1187) at `ToolGroup`, `ToolUse` and `ToolResult`.
    case 'group': return 'folds';
    case 'cell': return 'folds';
    // The engine draws a thought's text through `AssistantMessage` with `isSummary`, which the mod reads as a text with
    // no message: `record`. Decided here for a thought MAWS alone draws (card 5).
    case 'thinking': return 'folds';
    // `isSpawn` (598): `Agent` and `Workflow` stay.
    case 'subagent': return 'stays';
    // `isRead` (605) for `AskUserQuestion` and the ask tools; UC-3 for a waiting form: never inside a record, waiting
    // or answered.
    case 'question': return 'stays';
    case 'ask': return 'stays';
    case 'plan': return 'stays';
    case 'request_slot': return 'stays';
    // `promptRow`: a row with `from` is `record`; a sent message is a tool call (`recordRow`).
    case 'agent_message': return 'folds';
    case 'notice': return noticeClass(row, context);
    // `isApiError` (616): an API error is `marked`; a retry line and a plugin's notice have no site, and a row the mod is
    // never asked about stays. Decided here (card 3): every error stays, at every severity.
    case 'error': return 'stays';
    // The child's table: rows MAWS draws that the mod is never asked about.
    case 'boundary': return 'stays';
    case 'gap': return 'stays';
    case 'local_command': return 'stays';
    case 'artifact': return 'stays';
    case 'delivery': return 'stays';
    case 'side_thread': return 'stays';
    // Tool calls: `recordRow` at `ToolUse`. Decided here (card 3).
    case 'agent_list': return 'folds';
    case 'browser_action': return 'folds';
    // Never asked when no call of this session is behind it; under a call it is that call's work, `recordRow`.
    case 'browser_activity': return row.toolUseId === null ? 'stays' : 'folds';
    // Decision 11: a turn's line and a time separator are members of no stretch; a receipt draws nothing.
    case 'time': return 'none';
    case 'divider': return 'none';
    case 'receipt': return 'none';
    // The mirror's own row.
    case 'record_fold': return 'none';
  }
}

// `promptRow`: an answer's notice is the ask mod's delivery (`ASK_DELIVERY`, 378), the person's, unless its question's
// row carries the receipt, where the mod leaves the question's call in view (`isRead`, 605) and row and notice would
// state one answer twice (R13): it folds. A failed task of a spawn the transcript shows is `marked` (the first clause);
// every other notice (a task's end, a scheduled trigger, the bridge's wake) is `record`, a `task` or `DELIVERED` row.
function noticeClass(row: Extract<Row, { kind: 'notice' }>, context: Context): ViewClass {
  if (row.class === 'answer') return row.toolUseId !== null && context.receipted.has(row.toolUseId) ? 'folds' : 'stays';
  if (row.class === 'task' && row.outcome === 'failed' && row.toolUseId !== null && context.spawns.has(row.toolUseId)) return 'stays';
  return 'folds';
}

/**
 * Whether the rows hold a message to the person: a row that stays or is mixed and is an assistant text or a message
 * tool's call, a live text with an open mark included (the mod's `isFolding`, 1512, once `hasSeenMark` is set).
 */
export function holdsMessage(rows: readonly Row[], liveMarked?: string): boolean {
  const live = liveSet(liveMarked);
  return rows.some((row) => row.kind === 'to_human' || (row.kind === 'assistant_text' && textClass(row, live) !== 'folds'));
}

/**
 * A stretch's key, from its first row (decision 9): the first tool-use id of that row where it holds a call, else the
 * row's id. One call becoming a run keeps its first call, a merged read its first read. A stretch a mixed text heads
 * is keyed by that text, as the mod keys a run by `runStart`. It is the key a press writes; which stretch it then opens
 * is `namesOf`'s.
 */
export function stretchKey(row: Row): string {
  switch (row.kind) {
    case 'group': return row.cells.find((cell) => cell.toolUseId !== null)?.toolUseId ?? row.id;
    case 'cell': case 'agent_list': case 'browser_action': return row.toolUseId ?? row.id;
    case 'agent_message': return row.peer?.toolUseId ?? row.id;
    default: return row.id;
  }
}

// Every key a row answers to: its own (`stretchKey`) and, for a run, the key each of its members had as a row of its
// own, a call's tool-use id and a thought's row id (`cell:think:…` is the thought `think:…` the run took in).
const THOUGHT_CELL = 'cell:';
function namesOf(row: Row): string[] {
  if (row.kind !== 'group') return [stretchKey(row)];
  return [stretchKey(row), ...row.cells.map((cell) => cell.toolUseId ?? (cell.toolName === 'thinking' ? cell.id.slice(THOUGHT_CELL.length) : cell.id))];
}

/**
 * Which stretch an open key opens (the whole-branch review of 2026-11-15): the one that holds a row the key names, by
 * any key that row answers to. A key names a row, not a place, so the stretch the reader opened stays open while MAWS's
 * own derivation reshapes it: a thought taken into the run its first call starts, a run of one call unwrapped when its
 * turn completes, older rows paged in above it. The mod's run is the same run while it starts at the same row of the
 * whole transcript (`runStart`, 430), which the mod reads whole and MAWS reads by pages and regroups, and its unfolding
 * moves with a row whose id changes form (`adopt`). Open, a stretch is keyed by the first open key it holds, so the
 * press on its `‹ fold to report` names a key that is open; closed, by `stretchKey` of its first row.
 */
function keyOf(head: Row | null, members: readonly Row[], open: ReadonlySet<string> | undefined): string {
  if (open !== undefined && open.size > 0) {
    for (const row of head === null ? members : [head, ...members]) for (const name of namesOf(row)) if (open.has(name)) return name;
  }
  return stretchKey(head ?? members[0]);
}

export interface Stretch {
  key: string;
  head: Row | null; // the mixed text that heads it, drawn in sight with only its messages while it is closed
  rows: readonly Row[]; // its folding rows, and the rows of no stretch between them
  turns: ReadonlySet<TurnId>;
}

// A stretch by its rows' indices in the list: its head, its first and last folding rows, its members.
interface Span {
  stretch: Stretch;
  head: number | null;
  first: number; // the first folding row; the head when it has none
  last: number;
  members: number[];
}

interface Layout {
  classes: ViewClass[];
  spans: Span[];
  spanAt: Int32Array; // the span each row is the head or a member of, -1 for none
}

// `runStart` and `runEnd` (430 to 470): a maximal run of consecutive folding rows, the rows of no stretch between
// them included, headed by the mixed text directly before it (rows of no stretch aside); a mixed text with nothing
// folding after it is a stretch of its own.
function layoutOf(rows: readonly Row[], liveMarked: string | undefined, openKeys?: ReadonlySet<string>): Layout {
  const context = contextOf(rows, liveMarked);
  const classes = rows.map((row) => classOf(row, context));
  const spans: Span[] = [];
  const spanAt = new Int32Array(rows.length).fill(-1);
  let open: { head: number | null; members: number[]; first: number; last: number } | null = null;
  let between: number[] = []; // rows of no stretch after the open run's last folding row
  let mixed: number | null = null; // a mixed text not yet a head, until a row that stays
  const close = () => {
    if (open === null) return;
    const head = open.head === null ? null : rows[open.head];
    const members = open.members.map((i) => rows[i]);
    const turns = new Set<TurnId>();
    for (const row of head === null ? members : [head, ...members]) if (row.turnId !== null && row.kind !== 'divider' && row.kind !== 'time') turns.add(row.turnId);
    const stretch: Stretch = { key: keyOf(head, members, openKeys), head, rows: members, turns };
    const index = spans.length;
    spans.push({ stretch, head: open.head, first: open.first, last: open.last, members: open.members });
    if (open.head !== null) spanAt[open.head] = index;
    for (const i of open.members) spanAt[i] = index;
    open = null;
    between = [];
  };
  const alone = () => {
    if (mixed === null) return;
    open = { head: mixed, members: [], first: mixed, last: mixed };
    mixed = null;
    close();
  };
  classes.forEach((kind, i) => {
    if (kind === 'folds') {
      if (open === null) {
        open = { head: mixed, members: [i], first: i, last: i };
        mixed = null;
      } else {
        open.members.push(...between, i);
        open.last = i;
        between = [];
      }
    } else if (kind === 'none') {
      if (open !== null) between.push(i);
    } else {
      close();
      alone();
      if (kind === 'mixed') mixed = i;
    }
  });
  close();
  alone();
  return { classes, spans, spanAt };
}

/** The stretches of the rows, in order; with the open keys, each open one keyed by the open key it holds. */
export function stretchesOf(rows: readonly Row[], liveMarked?: string, open?: ReadonlySet<string>): Stretch[] {
  return layoutOf(rows, liveMarked, open).spans.map((span) => span.stretch);
}

/**
 * The keys an update carries an opening to (the whole-branch review's second look): an open key no row answers to any
 * more, whose row the update took away, passes to the keys that row answered to that a row of the new rows still
 * answers to. So the opening of a thought with no text, which the derivation keeps only while it streams or inside a run
 * (`groups.ts`, `thoughtRow`), passes to its call when the run of that one call unwraps without it. A key whose row
 * leaves with no successor stays as it is, and opens its stretch again if a row comes to answer to it.
 */
export function carriedKeys(before: readonly Row[], after: readonly Row[], open: ReadonlySet<string> | undefined): string[] {
  if (open === undefined || open.size === 0 || before === after) return [];
  const answered = new Set(after.flatMap(namesOf));
  const carried = new Set<string>();
  for (const key of open) {
    if (answered.has(key)) continue;
    const held = before.find((row) => namesOf(row).includes(key));
    if (held !== undefined) for (const name of namesOf(held)) if (answered.has(name) && !open.has(name)) carried.add(name);
  }
  return [...carried];
}

/** The open keys held by the stretch that holds the row `key` names: folding that stretch takes them all. */
export function openKeysOf(rows: readonly Row[], key: string, open: ReadonlySet<string>, liveMarked?: string): string[] {
  for (const stretch of stretchesOf(rows, liveMarked)) {
    const names = (stretch.head === null ? stretch.rows : [stretch.head, ...stretch.rows]).flatMap(namesOf);
    if (names.includes(key)) return names.filter((name) => open.has(name));
  }
  return [];
}

/**
 * The key of the stretch whose record holds the row or cell `id` out of sight while it is closed: null when the row
 * is in sight anyway (a row that stays, a stretch's head) or no row holds it. With the open keys, an open stretch is
 * named by the open key it holds, so a caller tells an open stretch from a closed one by that key.
 */
export function stretchHolding(rows: readonly Row[], id: RowId | CellId, liveMarked?: string, open?: ReadonlySet<string>): string | null {
  const at = rows.findIndex((row) => row.id === id || (row.kind === 'group' && row.cells.some((cell) => cell.id === id)));
  if (at < 0) return null;
  const layout = layoutOf(rows, liveMarked, open);
  const span = layout.spans[layout.spanAt[at]];
  return span === undefined || span.head === at ? null : span.stretch.key;
}

const recordFold = (stretch: string, open: boolean, at: Row): Row => ({ id: rowId.recordFold(stretch, open), turnId: at.turnId, at: at.at, kind: 'record_fold', stretch, open });

/**
 * The rows of the to-human view: each stretch closed (its head with only its messages, then `› working record` in the
 * place of its first folding row) or open (every row as the plain transcript draws it, then `‹ fold to report` after
 * the last), all closed until the reader opens them (`openStretches`).
 *
 * Decision 11 for the rows of no stretch: a closed turn's line is drawn in its place while a stretch that holds a row
 * of that turn is open; the running turn's line is always drawn, in its place when that is in sight, else (its place
 * inside a closed stretch, or directly before one) directly after that stretch's record line (ruling 5); a separator is
 * drawn when the row after it is drawn, a record line counting for its stretch's first row. A line whose place is
 * inside a closed stretch is drawn after its record line.
 */
export function mirrorRows(rows: readonly Row[], ui: Pick<TranscriptUi, 'openStretches'>, liveMarked?: string): Row[] {
  const { classes, spans, spanAt } = layoutOf(rows, liveMarked, ui.openStretches);
  const opened = (span: Span) => ui.openStretches?.has(span.stretch.key) ?? false;
  const openTurns = new Set<TurnId>();
  for (const span of spans) if (opened(span)) for (const turn of span.stretch.turns) openTurns.add(turn);
  // The closed stretch whose record line covers row i's place: one it is a member of, or (for the running turn's line)
  // the one its next row of a class opens.
  const coveredBy = (i: number, before: boolean): Span | null => {
    const own = spans[spanAt[i]];
    if (own !== undefined) return opened(own) ? null : own;
    if (!before) return null;
    let next = i + 1;
    while (next < rows.length && classes[next] === 'none') next += 1;
    const ahead = spans[spanAt[next] ?? -1];
    return ahead !== undefined && (ahead.head === next || ahead.first === next) && !opened(ahead) ? ahead : null;
  };
  // Whether row i is drawn where it stands (a closed stretch's first folding row counts: its record line stands there).
  const shown = new Uint8Array(rows.length);
  const after = new Map<number, Row[]>(); // the lines drawn directly after a closed stretch's record line, by its first row
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    const span = spans[spanAt[i]];
    if (row.kind === 'time') shown[i] = i + 1 < rows.length && shown[i + 1] === 1 ? 1 : 0;
    else if (row.kind === 'divider') {
      const working = row.state === 'working';
      if (!working && (row.turnId === null || !openTurns.has(row.turnId))) continue;
      const cover = coveredBy(i, working);
      if (cover === null) shown[i] = 1;
      else after.set(cover.first, [row, ...(after.get(cover.first) ?? [])]);
    } else if (classes[i] === 'none') shown[i] = coveredBy(i, false) === null ? 1 : 0;
    else if (span === undefined || opened(span) || span.head === i || span.first === i) shown[i] = 1;
  }
  const out: Row[] = [];
  rows.forEach((row, i) => {
    const span = spans[spanAt[i]];
    if (span === undefined || classes[i] === 'none') {
      if (shown[i] === 1) out.push(row);
      return;
    }
    const open = opened(span);
    if (span.head === i) out.push(open || row.kind !== 'assistant_text' ? row : { ...row, reportOnly: true });
    if (!open && span.first === i) out.push(recordFold(span.stretch.key, false, row), ...(after.get(i) ?? []));
    else if (open && span.head !== i) out.push(row);
    if (open && span.last === i) out.push(recordFold(span.stretch.key, true, row));
  });
  return out;
}
