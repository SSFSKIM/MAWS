// The report view's projection (the P2-C document, Design §7; X18 `reportRows`): a pure function over the rows `rowsOf`
// already derives. A turn with at least one mark draws, at level 0, its prompt, one `owner_record` row in place of its
// work and its unmarked text, then in event order the rows that stay in view when a turn folds (asks, deliveries,
// artifacts, side threads, boundaries, steers, command output, plugin errors, question receipts, the receipt) and its
// marked texts, which the report module draws as cards with their unmarked parts hidden. Opened (level 1), the turn
// draws exactly as the full transcript does, the record row above it as the way back; its divider expanded is level 2.
// A turn with no mark draws as the full transcript, so untagged history and a turn the model forgot to mark are never
// hidden. A streaming block is told apart by its live buffer (`liveMarkedRowIds`), which the rows do not carry.
import { expandedTurnRows, isPersistentRow, turnRows } from '../../transcript/model/derive';
import { rowId } from '../../transcript/model/keys';
import { marksOfText } from '../../transcript/model/owner-marks';
import type { TranscriptState, TranscriptUi } from '../../transcript/model/reduce';
import type { Row, TurnId } from '../../transcript/model/rows';

type TextRow = Extract<Row, { kind: 'assistant_text' }>;

// The report is the view while the session's lane is on, unless the reader chose the transcript for the tab.
export const reportViewOf = (ui: Pick<TranscriptUi, 'ownerLane' | 'view'> | undefined): boolean => ui?.ownerLane === true && ui.view !== 'transcript';

// Whether a row draws at level 0 of a marked turn whose record is closed.
const showsFolded = (row: Row, live: ReadonlySet<string>): boolean =>
  row.kind === 'assistant_text' ? isMarked(row, live) : row.kind === 'receipt' || row.kind === 'time' || (row.kind !== 'divider' && isPersistentRow(row));

const isMarked = (row: TextRow, live: ReadonlySet<string>): boolean => (row.live ? live.has(row.id) : marksOfText(row.markdown).marked);

// Whether a row of a marked turn is out of sight while its record is closed: the store opens the record to jump to it.
export const foldedInReport = (row: Row): boolean => row.turnId !== null && !showsFolded(row, NONE);

const NONE: ReadonlySet<string> = new Set();

// The rows of the session's open turn whose streaming text already carries a mark, as one string (a stable selector
// value: the view re-projects when it changes, not with every delta).
export function liveMarkedRowIds(state: TranscriptState | undefined): string {
  const turn = state?.current ? state.turns.get(state.current) : undefined;
  if (!turn) return '';
  const ids: string[] = [];
  for (const block of turn.live.values()) if (!block.completed && block.blockType === 'text' && marksOfText(block.buffer, true).marked) ids.push(block.rowId);
  return ids.join('\n');
}

export function reportRows(rows: readonly Row[], state: TranscriptState, ui: Pick<TranscriptUi, 'reportOpenTurns'>, liveMarked = ''): Row[] {
  const live: ReadonlySet<string> = liveMarked === '' ? NONE : new Set(liveMarked.split('\n'));
  const out: Row[] = [];
  for (let i = 0; i < rows.length;) {
    const turn = rows[i].turnId;
    let end = i + 1;
    while (end < rows.length && turn !== null && rows[end].turnId === turn) end += 1;
    const own = rows.slice(i, end);
    if (turn === null || !own.some((row) => row.kind === 'assistant_text' && isMarked(row, live))) out.push(...own);
    else out.push(...markedTurn(own, turn, state, ui.reportOpenTurns?.has(turn) ?? false, live));
    i = end;
  }
  return out;
}

function markedTurn(own: Row[], turn: TurnId, state: TranscriptState, open: boolean, live: ReadonlySet<string>): Row[] {
  const divider = own.find((row) => row.kind === 'divider');
  const messages = unmarkedMessages(state, turn);
  // Nothing folded (no work, every word marked): the turn is its marks, with no record to open.
  if (divider === undefined && messages === 0) return own;
  // The record follows the turn's prompt; a turn the owner did not start (no prompt row) opens with it.
  const lead = Math.max(own.findIndex((row) => row.kind !== 'time'), 0);
  const prompt = own[lead].kind === 'user' && !own[lead].steer ? lead + 1 : lead;
  const record: Row = {
    id: rowId.ownerRecord(turn), turnId: turn, at: own[lead].at, kind: 'owner_record', open,
    working: divider?.kind === 'divider' && divider.state === 'working', toolCalls: divider?.kind === 'divider' ? divider.toolCalls : 0, messages,
  };
  const rest = own.slice(prompt);
  return [...own.slice(0, prompt), record, ...(open ? rest : rest.filter((row) => showsFolded(row, live)))];
}

// The turn's assistant texts with words outside any mark, counted over its whole work area whether or not the reader
// disclosed it; kept per derivation of the turn (its rows array), so a projection reads each turn once.
const counted = new WeakMap<Row[], number>();
function unmarkedMessages(state: TranscriptState, turn: TurnId): number {
  const key = turnRows(state, turn);
  if (key === undefined) return 0;
  const known = counted.get(key);
  if (known !== undefined) return known;
  const all = key.some((row) => row.kind === 'divider' && !row.expanded) ? expandedTurnRows(state, turn) : key;
  const count = all.filter((row) => row.kind === 'assistant_text' && marksOfText(row.markdown, row.live).unmarked).length;
  counted.set(key, count);
  return count;
}
