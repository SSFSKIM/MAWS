// UX wave U3b (docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md, decisions 12 to 14, Interfaces §C;
// ruled R17 and the pre-flight's point (a)): which drawn answer carries Copy, "Fork from here" and its time, the message
// its Fork passes, and what its Copy takes. Placement reads the drawn list, once per change of it; Copy reads the store's
// whole turn at the press, never what is drawn, folded or mounted (ruled, F4).
import type { MessageUuid } from '@shared/graph/ids';
import { expandedTurnRows } from './derive';
import type { TranscriptState } from './reduce';
import type { Row, RowId, TurnId } from './rows';
import { serializeRows } from './serialize';
import { commandLineOf } from './user-text';

/** One answer's action row: its turn (what Copy reads), the message its Fork rewinds to, and whether it offers Fork. */
export interface AnswerAction {
  turnId: TurnId;
  rewindTo: MessageUuid | null;
  fork: boolean;
}

type UserRow = Extract<Row, { kind: 'user' }>;

/**
 * A turn-opening prompt of the owner's: a bubble that opened its turn (a typed command's included) or the consent line;
 * not a steer, a message still waiting or unread, or one the engine dropped, and never a row drawn beside its message
 * (U1c's approval row, which carries `beside`). A command's output is a row of its own kind, so it is never one, wherever
 * it is drawn.
 */
function opensOwnersTurn(row: Row): row is UserRow {
  return row.kind === 'user' && !row.steer && row.pending === undefined && row.unread !== true && !row.dropped && (row as { beside?: unknown }).beside === undefined;
}

const isAnswer = (row: Row): row is Extract<Row, { kind: 'assistant_text' }> & { turnId: TurnId } =>
  row.kind === 'assistant_text' && row.phase === 'answer' && !row.live && row.cut !== true && row.turnId !== null;

const lastCompactions = new WeakMap<readonly Row[], number>();
function lastCompaction(rows: readonly Row[]): number {
  let at = lastCompactions.get(rows);
  if (at === undefined) {
    at = rows.findLastIndex((row) => row.kind === 'boundary' && row.boundaryKind === 'compaction');
    lastCompactions.set(rows, at);
  }
  return at;
}

/**
 * Whether the drawn row at `index` lies above the list's last compaction boundary, where the engine's rewind no longer
 * reaches (Engine facts, 20: it refuses any message from before a compaction). The `/compact` bubble whose own turn holds
 * that boundary does not: the engine writes the command after the compaction it made, and accepts a rewind to it. Asked
 * by `answerActionsOf` for Fork, and by landing 2's Edit rule (ticket 698).
 */
export function aboveLastCompaction(rows: readonly Row[], index: number): boolean {
  const boundary = lastCompaction(rows);
  if (boundary < 0 || index >= boundary) return false;
  const row = rows[index]!;
  return !(row.kind === 'user' && row.turnId !== null && row.turnId === rows[boundary]!.turnId && commandLineOf(row.text)?.command === 'compact');
}

/**
 * Placement only: for each drawn answer row that gets the action row, its turn and the message to fork from (the id of
 * the owner's next turn-opening prompt, or null under the list's last answer). Rows not in the map get none.
 *
 * For each turn-opening prompt, and for the list's end, the last answer drawn before it and after the prompt before,
 * unless a running turn (its turn line working, or a row of it live) has a row from that answer on. Fork is off where the
 * next prompt has no message id, and where it lies above the list's last compaction boundary: so the answer directly above
 * that boundary keeps Fork only against a typed `/compact` bubble (`aboveLastCompaction`'s one exception); the prompt that
 * set off an automatic compaction is written before it, and the answer before that prompt draws none (ruled, M3-4).
 *
 * The branch panel's finding 1: the rows of `discarded` turns (a rewound branch, drawn muted while its rewind is
 * revealed) are read as if they were not in the list: they get no action row and are never a target.
 */
export function answerActionsOf(allRows: readonly Row[], discarded: readonly TurnId[] = []): Map<RowId, AnswerAction> {
  const gone = new Set(discarded);
  const rows = gone.size === 0 ? allRows : allRows.filter((row) => row.turnId === null || !gone.has(row.turnId));
  const running = new Set<TurnId>();
  for (const row of rows) {
    if (row.turnId !== null && ((row.kind === 'divider' && row.state === 'working') || ('live' in row && row.live))) running.add(row.turnId);
  }
  const runsFrom = (from: number, to: number) => rows.slice(from, to).some((row) => row.turnId !== null && running.has(row.turnId));
  const placed: { at: number; next: number }[] = []; // the answer's index, its next prompt's (rows.length: the list's end)
  let answer = -1;
  rows.forEach((row, i) => {
    if (opensOwnersTurn(row)) {
      if (answer >= 0) placed.push({ at: answer, next: i });
      answer = -1;
    } else if (isAnswer(row)) answer = i;
  });
  if (answer >= 0) placed.push({ at: answer, next: rows.length });

  const out = new Map<RowId, AnswerAction>();
  for (const { at, next } of placed) {
    if (runsFrom(at, next)) continue;
    const answerRow = rows[at] as Extract<Row, { kind: 'assistant_text' }> & { turnId: TurnId };
    const prompt = next < rows.length ? (rows[next] as UserRow) : null;
    out.set(answerRow.id, { turnId: answerRow.turnId, rewindTo: prompt?.messageUuid ?? null, fork: prompt === null || (prompt.messageUuid !== null && !aboveLastCompaction(rows, next)) });
  }
  return out;
}

/**
 * What Copy takes: the markdown of every answer block of the turn, from the turn's complete projection, joined as a copy
 * joins rows. Never reads what is drawn, folded or mounted. '' when the store holds no such turn.
 */
export function answerMarkdownOf(state: TranscriptState, turnId: TurnId): string {
  return serializeRows(expandedTurnRows(state, turnId).filter((row) => row.kind === 'assistant_text' && row.phase === 'answer' && row.cut !== true));
}
