// UX wave U1c (l4-approvals-12; the U1c document, Design 1 and 3, Interfaces §A and §B): a call auto mode blocked. The
// classifier's own reason, cut out of the text the engine gives the model as Claude Desktop cuts it
// (`web/app/v1/c62da1b56-Cmxkc-l_.js:424-484` of 5.1231.2); the name a grant gives the call, by the engine's rule for
// its "Recently blocked" list (`cli.pretty.js:1242837-1242850, 1242901-1242905` of 2.1.322); and the rule by which a
// blocked row reads approved, waits or is blocked again, read from the transcript's rows alone. A row says it was
// approved only on the reader's mark of the person's own send of the grant (`consent` on a `user` row): never on a
// press, the queue, a later run of the same command, or a row's text.
import type { TranscriptState } from './reduce';
import type { Cell, CellId, Row, TurnId } from './rows';

const OPENING = 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: ';
const AFTER = '. If you have other tasks';
const REASON_MAX = 1000;
export const STAND_IN_REASONS: ReadonlySet<string> = new Set([
  'Blocked by classifier',
  'Blocked by fast classifier',
  'No reason provided',
  'The server-side auto mode classifier judged this action dangerous (it gave no explanation)',
]);

/** The classifier's own reason in a blocked call's result text; null when it gave none (Design 1). */
export function classifierReason(resultText: string): string | null {
  if (!resultText.startsWith(OPENING)) return null;
  const rest = resultText.slice(OPENING.length);
  const end = rest.indexOf(AFTER);
  if (end <= 0) return null;
  const reason = rest.slice(0, end).replace(/\s+/g, ' ').trim();
  if (reason === '' || STAND_IN_REASONS.has(reason)) return null;
  return reason.length > REASON_MAX ? `${reason.slice(0, REASON_MAX).replace(/\s\S*$/, '')}…` : reason;
}

// The shell tools a grant names by their command (the engine's list, read by its use; the U1c document, What is not
// proven 6), which are also those whose command line Desktop's rule shortens (its `fu`; UX wave U2, O-49). Defined here
// and re-exported by cells.ts, so that this module imports nothing of the cells it names.
export const shellToolOf = (toolName: string): 'Bash' | 'PowerShell' | null => (toolName === 'Bash' || toolName === 'PowerShell' ? toolName : null);

/** What a grant names. */
export interface BlockedCall { kind: 'command' | 'call'; subject: string }

// The keys of a shell call's input that leave it named by its command: these two always, these two when set false.
const NAMING_ALWAYS = new Set(['description', 'timeout']);
const NAMING_WHEN_FALSE = new Set(['run_in_background', 'dangerouslyDisableSandbox']);

/** A call's name by the engine's rule; in this landing a plain shell command's, null for every other call (probe C's one place). */
export function blockedCallOf(toolName: string, input: unknown): BlockedCall | null {
  if (shellToolOf(toolName) === null || typeof input !== 'object' || input === null) return null;
  const { command, ...rest } = input as Record<string, unknown>;
  if (typeof command !== 'string' || command === '') return null;
  const flagged = Object.entries(rest).some(([key, value]) => value !== undefined && !NAMING_ALWAYS.has(key) && !(value === false && NAMING_WHEN_FALSE.has(key)));
  return flagged ? null : { kind: 'command', subject: command };
}
export const blockedKey = (call: BlockedCall): string => `${call.kind}\u0000${call.subject}`;

export interface BlockedState { call: BlockedCall; again: boolean; grant: 'none' | 'waiting' | 'read' }
/** Whether the row reads approved: a grant that was read (card 1's one place). */
export const readsApproved = (state: BlockedState): boolean => state.grant === 'read';

/** A call auto mode blocked that has a name, as the model drew it (a mod's draw-time status is not one). */
export const isBlockedCell = (cell: Cell): cell is Cell & { blocked: BlockedCall } =>
  cell.blocked !== undefined && cell.status === 'denied' && cell.classification.denial?.kind === 'automode-blocked';

const NO_TURNS: readonly TurnId[] = [];
/** A transcript's hidden turns, the list `blockedStates` and `approvalsFor` take: the same array while it is unchanged. */
export const hiddenTurnsOf = (state: Pick<TranscriptState, 'hidden'>): readonly TurnId[] => state.hidden?.turns ?? NO_TURNS;

interface Approval { key: string; dropped: boolean; waits: boolean }
const approvalOf = (row: Row): Approval | null =>
  row.kind === 'user' && row.consent !== undefined ? { key: blockedKey(row.consent), dropped: row.dropped, waits: row.pending !== undefined || row.unread === true } : null;
const blockedRowOf = (row: Row): (Cell & { blocked: BlockedCall }) | null => (row.kind === 'cell' && isBlockedCell(row) ? row : null);

const memo = new WeakMap<readonly Row[], { hidden: readonly TurnId[]; states: ReadonlyMap<CellId, BlockedState> }>();

/** Every blocked call's row that has a name and is outside a hidden branch, by its cell id (the rule of Design 3). */
export function blockedStates(rows: readonly Row[], hidden: readonly TurnId[]): ReadonlyMap<CellId, BlockedState> {
  const known = memo.get(rows);
  if (known !== undefined && known.hidden === hidden) return known.states;
  const states = deriveStates(rows, new Set(hidden));
  memo.set(rows, { hidden, states });
  return states;
}

// One pass backward for what stands after each blocked row (its grant), one forward for what stands before it (again).
// An approval row counts when it is not dropped; it was read when it carries no waiting mark.
function deriveStates(rows: readonly Row[], hidden: ReadonlySet<TurnId>): ReadonlyMap<CellId, BlockedState> {
  const shown = rows.filter((row) => row.turnId === null || !hidden.has(row.turnId));
  const grants: BlockedState['grant'][] = [];
  const read = new Set<string>();
  const waiting = new Set<string>();
  for (let i = shown.length - 1; i >= 0; i -= 1) {
    const approval = approvalOf(shown[i]);
    const blocked = blockedRowOf(shown[i]);
    if (approval !== null && !approval.dropped) (approval.waits ? waiting : read).add(approval.key);
    if (blocked === null) continue;
    const key = blockedKey(blocked.blocked);
    grants[i] = read.has(key) ? 'read' : waiting.has(key) ? 'waiting' : 'none';
  }
  const states = new Map<CellId, BlockedState>();
  const before = new Set<string>();
  shown.forEach((row, i) => {
    const approval = approvalOf(row);
    const blocked = blockedRowOf(row);
    if (approval !== null && !approval.dropped) before.add(approval.key);
    if (blocked !== null) states.set(blocked.id, { call: blocked.blocked, again: before.has(blockedKey(blocked.blocked)), grant: grants[i] });
  });
  return states;
}

/** The approval rows for a key outside a hidden branch, read, waiting or dropped: what a press remembers and compares. */
export function approvalsFor(rows: readonly Row[], hidden: readonly TurnId[], key: string): number {
  const hiddenTurns = new Set(hidden);
  return rows.filter((row) => (row.turnId === null || !hiddenTurns.has(row.turnId)) && approvalOf(row)?.key === key).length;
}
