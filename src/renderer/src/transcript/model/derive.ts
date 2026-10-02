// rowsOf: TranscriptState → Row[] in virtualised order (C6 execution document, Derivation "Groups and rows",
// "Expansion state", "Revisable log", "Requests", "Receipts", "Bash rows", "Time separators"). Rows are derived per
// turn from its retained events and memoised on (version, ui version); the flat list is the concatenation, with
// loose rows placed after the turn they followed and time separators inserted by the thresholds in time.ts.
import type { QueueEntry } from '@shared/engine/session-state-store';
import { ENGINE_COMPAT_NOTICE_KEY } from '@shared/engine/compat-notice'; // W13
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, RequestId, TaskId, ToolUseId } from '@shared/graph/ids';
import { MCP_TOOL, presentationOf, tableRowOf } from './classify';
import { cellOf, editCounts, filePathOf, type ToolRecord, type TurnContext } from './cells';
import { hookNotice, type HookRecord } from './hooks';
import { agentMessageCopy, boundaryCopy, groupSummary, PLUGIN, processExitCopy, reconnectCopy, retryCopy, subagentSentence } from './copy';
import { RESUMED_COPY, RESUMING_COPY } from './copy'; // C12
import { glyphFor } from './glyphs';
import { collectCells, groupItems, phrasesOf, type WorkItem } from './groups';
import { cellId, rowId, turnId as turnIdOf } from './keys';
import type { LiveBlock, TranscriptState, TranscriptUi, TurnState, TurnWork } from './reduce';
import { isEngineOrigin, originOf, RECEIPT_APPLIED, runningTurn, type ReceiptUndo } from './reduce';
import { TOOL_CATEGORIES, type Cell, type ChangedFile, type Row, type RowId, type SubagentRef, type SubagentStatus, type ToolCategory, type TurnId, type TurnSummary } from './rows';
import { needsSeparator, separatorLabel } from './time';
import { isInterruptionMarker, isLocalCommand, localCommandOutput, userTextOf } from './user-text';

type Event<K extends SessionEvent['kind']> = Extract<SessionEvent, { kind: K }>;
type RowOf<K extends Row['kind']> = Extract<Row, { kind: K }>;

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

// ---------------------------------------------------------------------------------------------------------------------
// Public surface

// The flat list is memoised on the identity of its parts (the per-turn row arrays, the order, the loose list, the
// hidden branch and the ui version), so a batch of deltas that changed no turn's version yields the same array.
const flatMemo = new WeakMap<TranscriptState['memo'], { keys: unknown[]; rows: Row[]; times: Map<RowId, Row> }>();

export function rowsOf(state: TranscriptState): Row[] {
  const turnRows = [...state.order, ...(state.hidden?.turns ?? [])].map((id) => rowsOfTurn(state, state.turns.get(id)!));
  const keys = [state.order, state.loose, state.hidden, state.ui.version, ...turnRows];
  const previous = flatMemo.get(state.memo);
  if (previous && previous.keys.length === keys.length && previous.keys.every((key, i) => key === keys[i])) return previous.rows;
  const times = new Map<RowId, Row>();
  const rows = flatten(state, previous?.times ?? new Map(), times);
  flatMemo.set(state.memo, { keys, rows, times });
  return rows;
}

// `before` holds the previous flatten's time separators: an unchanged one is reused, so a re-flatten keeps the
// reference of every row outside the turns that changed.
function flatten(state: TranscriptState, before: Map<RowId, Row>, times: Map<RowId, Row>): Row[] {
  const out: Row[] = [];
  let previousAt: string | null = null;
  const looseAfter = new Map<TurnId | null, SessionEvent[]>();
  for (const event of state.loose) {
    const placement = state.placement.get(event.id);
    if (placement === undefined) continue; // unplaced: nothing to render
    looseAfter.set(placement, [...(looseAfter.get(placement) ?? []), event]);
  }
  // Row ids are unique in the flat list (the virtualiser keys by them). One session's history can reach the model in
  // both event forms (C4's disk follower and C3's live stream carry the same blocks under different event ids), and then
  // a block derives its row, with one id, under both copies of its turn: the first shown wins, and a turn whose rows
  // were all copies shows nothing, not even its divider (debt wave 4, the C8b live run's repeated rows).
  const shown = new Set<RowId>();
  const emit = (all: Row[], subject: 'human' | 'engine' | 'peer' | 'loose', separator: RowId) => {
    const rows = all.some((row) => shown.has(row.id)) ? all.filter((row) => !shown.has(row.id)) : all;
    if (rows !== all && rows.every((row) => row.kind === 'divider')) return;
    for (const row of rows) shown.add(row.id);
    if (rows.length === 0) return;
    if (needsSeparator(previousAt, rows[0].at, subject)) {
      const label = separatorLabel(rows[0].at);
      const turnId = subject === 'loose' ? null : rows[0].turnId;
      const kept = before.get(separator);
      const time: Row = kept?.kind === 'time' && kept.label === label && kept.at === rows[0].at && kept.turnId === turnId ? kept : { id: separator, turnId, at: rows[0].at, kind: 'time', label };
      times.set(separator, time);
      out.push(time);
    }
    out.push(...rows);
    previousAt = rows.at(-1)!.at;
  };
  const emitLoose = (after: TurnId | null) => {
    for (const row of looseRows(state, looseAfter.get(after) ?? [])) {
      emit([row], 'loose', rowId.timeOfRow(row.id));
      if (row.kind === 'boundary' && row.boundaryKind === 'rewind' && row.revealed && state.hidden) {
        for (const id of state.hidden.turns) {
          const turn = state.turns.get(id)!;
          emit(rowsOfTurn(state, turn), turn.origin, rowId.time(turn.id));
        }
      }
    }
  };
  emitLoose(null);
  for (const id of state.order) {
    const turn = state.turns.get(id)!;
    emit(rowsOfTurn(state, turn), turn.origin, rowId.time(turn.id));
    emitLoose(id);
  }
  return out;
}

// The rows of a turn that stay in view when its work area folds, in event order among its work (W1): a prompt the
// engine took into the turn at its next tool boundary (a steer, at its delivery position, so it splits the work around
// it, Codex's persistent unit), a hook that got in the way, the answer, a boundary (compaction, reset, retraction:
// charter §5.3, the visible transcript stays true to the model's context), a slash command's output and an answered
// question's receipt (W4, the owner's ruling: what the human answered stays in view; T3's receipts outlive the fold
// too), and what a plugin said in the transcript (R1: its log lines and load issues, as the terminal keeps them). The
// divider folds everything else, so a turn of a local command alone (`/compact`: its boundary and its output) has no
// work and no "Worked for 0s" divider. A question still counts as work for where the answer starts (WORK_ROWS).
export const isPersistentRow = (row: Row): boolean =>
  row.kind === 'user' || row.kind === 'boundary' || row.kind === 'local_command' || row.kind === 'question' || (row.kind === 'assistant_text' && row.phase === 'answer') || (row.kind === 'error' && (row.scope === 'hook' || row.scope === 'plugin'));

// W1: a message held in MAWS's queue until the running turn ends, as the dimmed bubble the transcript's tail shows
// for it (Claude Desktop's pattern); it becomes its own turn when the queue releases it.
export function heldRow(entry: Pick<QueueEntry, 'queueId' | 'content' | 'createdAt'>): RowOf<'user'> {
  const text = userTextOf(entry.content);
  return { id: rowId.held(entry.queueId), turnId: null, at: entry.createdAt, kind: 'user', messageUuid: null, text: text.text, attachments: text.attachments, placeholders: text.placeholders, lines: text.lines, editable: false, steer: false, dropped: false, pending: 'held' };
}

// W1: what the session's transcript shows around its derived rows: no bubble for a prompt held back into MAWS's queue
// (the engine reports it cancelled, and it is not lost: it waits in the queue), and the held messages at the tail.
export function withQueueTail(rows: Row[], withdrawn: ReadonlySet<string>, tail: readonly Row[]): Row[] {
  const kept = withdrawn.size === 0 ? rows : rows.filter((row) => !(row.kind === 'user' && row.messageUuid !== null && withdrawn.has(row.messageUuid) && (row.dropped || row.pending !== undefined)));
  return tail.length === 0 ? kept : [...kept, ...tail];
}

export function turnSummary(turn: TurnState): TurnSummary {
  return deriveTurn(turn, null).summary;
}

// The group phrases of a whole turn ("Edited 3 files, ran 2 commands"): the turn summary popover's category segment.
// Denied and stopped calls did not run, so they are counted as tool calls but phrase nothing.
export function turnPhrases(turn: TurnState): string {
  return groupSummary(phrasesOf(deriveTurn(turn, null).cells.filter((cell) => cell.classification.denial === null)));
}

// One turn's rows with its work area expanded (groups and cells as the reader left them), derived outside the memo:
// what a jump into a collapsed turn looks for, at the cost of that turn alone.
export function expandedTurnRows(state: TranscriptState, id: TurnId): Row[] {
  const turn = state.turns.get(id);
  if (!turn) return [];
  const ui: TranscriptUi = { ...state.ui, expandedTurns: new Set([...state.ui.expandedTurns, id]), collapsedTurns: new Set() };
  return deriveTurn(turn, { ...state, ui }).rows;
}

// A state whose every turn, group and cell is expanded and every rewound branch revealed: the snapshot suite's view.
export function withAllExpanded(state: TranscriptState): TranscriptState {
  const turns = [...state.order, ...(state.hidden?.turns ?? [])];
  const ui: TranscriptUi = { ...state.ui, expandedTurns: new Set(turns), collapsedTurns: new Set(), expandedGroups: new Set(), expandedCells: new Set(), revealedBoundaries: new Set(), global: state.ui.global + 1, version: state.ui.version + 1 };
  const first = rowsOf({ ...state, ui });
  for (const row of first) {
    if (row.kind === 'group') {
      ui.expandedGroups.add(row.id);
      for (const cell of row.cells) ui.expandedCells.add(cell.id);
    } else if (row.kind === 'cell') ui.expandedCells.add(row.id);
    else if (row.kind === 'boundary' && row.boundaryKind === 'rewind') ui.revealedBoundaries.add(row.id);
  }
  ui.version += 1;
  ui.global += 1;
  return { ...state, ui };
}

// ---------------------------------------------------------------------------------------------------------------------
// Per-turn derivation

function rowsOfTurn(state: TranscriptState, turn: TurnState): Row[] {
  let memo = state.memo.get(turn.id);
  const stamp = state.ui.stamps.get(turn.id) ?? 0;
  if (!memo || memo.version !== turn.version || memo.uiVersion !== state.ui.global || memo.uiStamp !== stamp) {
    const derived = deriveTurn(turn, state);
    memo = { version: turn.version, uiVersion: state.ui.global, uiStamp: stamp, rows: derived.rows, work: derived.work };
    state.memo.set(turn.id, memo);
  }
  const { receipts, spills } = state.ui;
  if (receipts.size === 0 && spills.size === 0) return memo.rows;
  if (memo.overlay?.receipts !== receipts || memo.overlay.spills !== spills) memo.overlay = { receipts, spills, rows: overlay(state.ui, memo.rows) };
  return memo.overlay.rows;
}

// What the walk over a turn's events produces before grouping: cells and rows in event order.
type Item =
  | WorkItem
  // Placeholders the walk leaves and the resolution pass fills, once every event of the turn has been seen.
  | { kind: 'tool'; toolUseId: ToolUseId }
  | { kind: 'hook'; hookId: string }
  | { kind: 'request'; toolUseId: ToolUseId }
  | { kind: 'subagents'; group: SubagentGroup }
  | { kind: 'steer'; row: RowOf<'user'> }; // a prompt folded into this turn: a persistent row at its delivery position (W1)

interface SubagentGroup { id: RowId; at: string; apiMessageId: string | null; refs: SubagentRef[]; statuses: Map<TaskId, SubagentStatus>; lastTool: Map<TaskId, string | null>; phase: string | null }
interface Pending { kind: 'question' | 'plan'; use: Event<'tool.use'>; answers: Record<string, string> | null; outcome: RowOf<'plan'>['outcome']; feedback: string | null; requestId: RequestId | null }

const isAborted = (reason: string | null) => reason !== null && reason.startsWith('aborted');

interface TurnDerivation {
  rows: Row[]; // as disclosed by the reader's expansion state
  summary: TurnSummary;
  cells: Cell[]; // every cell of the work area, disclosed or not
  work: TurnWork; // what the turn did, disclosed or not
}

// How many per-turn derivations ran (instrumentation: the memo tests pin that readers of the memo derive nothing).
export const turnDerivations = { count: 0 };

function deriveTurn(turn: TurnState, state: TranscriptState | null): TurnDerivation {
  turnDerivations.count += 1;
  const ui = state?.ui;
  const expanded = ui ? ui.expandedTurns.has(turn.id) || (turn.state === 'open' && !ui.collapsedTurns.has(turn.id)) : false;
  const context: TurnContext = { closed: turn.state === 'closed', terminalReason: turn.ended?.terminalReason ?? null, lastAt: turn.events.at(-1)?.at ?? turn.startedAt };
  const items: Item[] = [];
  const tools = new Map<ToolUseId, ToolRecord>();
  const hooks = new Map<string, HookRecord>();
  const subagents: SubagentGroup[] = [];
  const byTask = new Map<TaskId, SubagentGroup>();
  const byToolUse = new Map<ToolUseId, SubagentGroup>();
  const pendingRows = new Map<ToolUseId, Pending>();
  const retracted = new Set<string>();
  const superseded = new Set<string>();
  const byMarker = new Map<string, LiveBlock>();
  const byComplete = new Map<string, LiveBlock>();
  for (const block of turn.live.values()) {
    if (block.markerEventId) byMarker.set(block.markerEventId, block);
    if (block.completeEventId) byComplete.set(block.completeEventId, block);
  }
  let user: RowOf<'user'> | null = null;
  let model: string | null = null;
  let retry: RowOf<'error'> | null = null;
  let retryAt: string | null = null; // the first api.retry's time: the in-place row keeps its position
  const agentIds = new Map<ToolUseId, AgentId>();

  // *Turn boundaries on this engine*: the reducer retains a `command.lifecycle` on a turn only when it dropped that
  // turn's pending prompt, so its presence is the dropped mark. A prompt the engine folded into this turn
  // (`priority: 'next'`) is the turn's only other prompt message: a steer bubble, which is never dropped.
  let openerDropped = false;
  for (const event of turn.events) {
    if (event.kind === 'boundary.retraction') for (const uuid of event.retractedMessageUuids) retracted.add(uuid);
    if (event.kind === 'assistant.block.complete') for (const uuid of event.supersedes) superseded.add(uuid);
    if (event.kind === 'command.lifecycle') openerDropped = true;
  }
  const dropped = (messageUuid: string | null) => messageUuid !== null && (retracted.has(messageUuid) || superseded.has(messageUuid));
  // W1: a prompt waiting for the engine while another turn runs is a `next` steer (Enter while a turn runs); a `now`
  // one waits only until the engine has stopped that turn. Its bubble sits at the tail, dimmed, until the engine takes
  // it (the reducer re-derives every waiting turn when the running turn changes).
  const waiting = state !== null && turn.state === 'open' && !turn.accepted && runningTurn(state) !== null && !openerDropped;
  const userRow = (event: Event<'user.message'>, id: RowId, editable: boolean, steer = false): RowOf<'user'> => {
    const text = userTextOf(event.content);
    return {
      id, turnId: turn.id, at: event.at, kind: 'user', messageUuid: event.messageUuid, text: text.text, attachments: text.attachments, placeholders: text.placeholders, lines: text.lines, editable, steer, dropped: !steer && openerDropped,
      ...(waiting && !steer && { pending: 'next' as const }),
    };
  };

  const blockRow = (block: LiveBlock, at: string): Item | null => {
    const live = !block.completed;
    if (dropped(block.messageUuid)) return null;
    if (block.blockType === 'text') return { kind: 'text', row: { id: block.rowId, turnId: turn.id, at, kind: 'assistant_text', messageUuid: block.messageUuid, blockIndex: block.blockIndex, markdown: block.buffer, live, phase: 'answer', model: block.model } };
    if (block.blockType === 'thinking') {
      // A completed thinking block with no text (a signature-only block) has nothing to disclose: no row (W1).
      if (!live && block.buffer.trim() === '') return null;
      const durationMs = block.completedAt !== null && block.markerEventId !== null ? Date.parse(block.completedAt) - Date.parse(at) : null;
      return { kind: 'thinking', row: { id: block.rowId, turnId: turn.id, at, kind: 'thinking', messageUuid: block.messageUuid, text: block.buffer, live, durationMs } };
    }
    return null;
  };
  // Consecutive Agent calls from the same assistant message share one row: the immediately preceding item must be
  // that group (a tool call or commentary between two calls makes two rows).
  const subagentGroupFor = (apiMessageId: string | null, at: string, key: RowId): SubagentGroup => {
    const previous = items.at(-1);
    const last = previous?.kind === 'subagents' ? previous.group : null;
    if (last && apiMessageId !== null && last.apiMessageId === apiMessageId) return last;
    const group: SubagentGroup = { id: key, at, apiMessageId, refs: [], statuses: new Map(), lastTool: new Map(), phase: null };
    subagents.push(group);
    items.push({ kind: 'subagents', group });
    return group;
  };
  const addRef = (group: SubagentGroup, ref: SubagentRef) => {
    if (group.refs.some((existing) => existing.taskId === ref.taskId)) return;
    group.refs.push(ref);
    byTask.set(ref.taskId, group);
    if (ref.toolUseId) byToolUse.set(ref.toolUseId, group);
    if (group.refs.length === 1) group.id = rowId.subagent(ref.taskId);
  };

  for (const event of turn.events) {
    switch (event.kind) {
      case 'user.message': {
        if (event.bash?.part === 'input') {
          items.push({ kind: 'row', row: bashRowOf(event, turn.id) });
        } else if (event.bash?.part === 'output') {
          const at = items.findIndex((item) => item.kind === 'row' && item.row.kind === 'bash' && item.row.exitCode === null);
          if (at >= 0) items[at] = { kind: 'row', row: withBashOutput((items[at] as { row: RowOf<'bash'> }).row, event) };
        } else if (isLocalCommand(event.origin, event.content) && !event.isSynthetic) { // a synthetic one is the engine's caveat for the model (W1)
          items.push({ kind: 'row', row: localCommandRow(event, turn.id) });
        } else if (isInterruptionMarker(event.origin, event.content)) {
          // The engine's interrupt marker is never a bubble, whatever turn it landed in: the stopped divider says it.
        } else if (originOf(event.origin) === 'engine') {
          // The engine's own trigger (C4's disk `<task-notification>` record, origin 'task-notification'): an engine turn
          // has no user row; its divider reads Continued and the subagent row says what finished.
        } else if (event.messageUuid !== null && turnIdOf.ofMessage(event.messageUuid) === turn.id && user === null && !dropped(event.messageUuid)) {
          user = userRow(event, rowId.user(event.messageUuid), true);
        } else if (turn.id === turnIdOf.ofEvent(event.id) && user === null && !event.isSynthetic) {
          user = userRow(event, rowId.userOfEvent(event.id), false);
        } else if (!event.isSynthetic && !isInterruptionMarker(event.origin, event.content) && !dropped(event.messageUuid)) {
          items.push({ kind: 'steer', row: userRow(event, event.messageUuid === null ? rowId.userOfEvent(event.id) : rowId.user(event.messageUuid), true, true) });
        }
        break;
      }
      case 'assistant.block.delta': {
        const block = byMarker.get(event.id);
        if (!block) break;
        const item = blockRow(block, event.at);
        if (item) items.push(item);
        break;
      }
      case 'assistant.block.complete': {
        model = event.model;
        const paired = byComplete.get(event.id);
        if (event.block.type === 'tool_use') break;
        if (paired?.markerEventId) break; // emitted at its first delta's position
        if (paired) {
          const item = blockRow(paired, event.at);
          if (item) items.push(item);
        }
        break;
      }
      case 'tool.use': {
        const presentation = presentationOf(event.toolName);
        if (presentation === 'cell') {
          tools.set(event.toolUseId, { use: event, result: null, safeguard: 'not_evaluated', elapsedSeconds: 0, humanDecision: false, backgroundTaskId: null, backgroundDone: false });
          items.push({ kind: 'tool', toolUseId: event.toolUseId });
        } else if (presentation === 'subagent') {
          const input = record(event.input);
          const group = subagentGroupFor(event.apiMessageId, event.at, rowId.subagent(event.toolUseId as string as TaskId));
          addRef(group, {
            taskId: event.toolUseId as string as TaskId, agentId: null, toolUseId: event.toolUseId, name: str(input.description, event.toolName), glyph: glyphFor(event.toolUseId),
            kind: event.toolName === 'Workflow' ? 'workflow' : 'agent', subagentType: typeof input.subagent_type === 'string' ? input.subagent_type : null,
          });
        } else if (presentation === 'agent_message') {
          const input = record(event.input);
          const to = str(input.to);
          const direction = to === 'parent' ? 'from_child' : 'to_child';
          items.push({ kind: 'row', row: { id: rowId.agentMessage(event.id), turnId: turn.id, at: event.at, kind: 'agent_message', direction, from: null, to: null, text: agentMessageCopy(direction, to || null, str(input.message, str(input.content))) } });
        } else {
          pendingRows.set(event.toolUseId, { kind: presentation, use: event, answers: null, outcome: null, feedback: null, requestId: null });
          items.push({ kind: 'request', toolUseId: event.toolUseId });
        }
        break;
      }
      case 'tool.result': {
        const rec = tools.get(event.toolUseId);
        if (rec) rec.result = event;
        const agentId = record(event.structured).agentId;
        if (typeof agentId === 'string') agentIds.set(event.toolUseId, agentId as AgentId);
        const pending = pendingRows.get(event.toolUseId);
        if (pending?.kind === 'question' && pending.answers === null) {
          const answers = record(event.structured).answers;
          if (typeof answers === 'object' && answers !== null) pending.answers = answers as Record<string, string>;
        }
        break;
      }
      case 'tool.safeguard': {
        const rec = tools.get(event.toolUseId);
        if (rec) rec.safeguard = event.verdict;
        break;
      }
      case 'tool.progress': {
        const rec = tools.get(event.toolUseId);
        if (rec) rec.elapsedSeconds = Math.max(rec.elapsedSeconds, event.elapsedSeconds);
        break;
      }
      case 'subagent.started':
      case 'task.started': {
        const kind = event.kind === 'task.started' ? event.taskType : 'local_agent';
        if (kind !== 'local_agent' && kind !== 'local_workflow') {
          const rec = event.toolUseId ? tools.get(event.toolUseId) : undefined;
          if (rec) rec.backgroundTaskId = event.taskId;
          break;
        }
        const existing = event.toolUseId ? byToolUse.get(event.toolUseId) : undefined;
        const group = existing ?? subagentGroupFor(null, event.at, rowId.subagent(event.taskId));
        if (existing && event.toolUseId) {
          // The tool use's placeholder ref (keyed on the tool use id) becomes the task's ref.
          const at = group.refs.findIndex((ref) => ref.toolUseId === event.toolUseId);
          const ref = group.refs[at];
          group.refs[at] = { ...ref, taskId: event.taskId, name: event.description, glyph: glyphFor(event.taskId), subagentType: event.kind === 'subagent.started' ? event.subagentType : ref.subagentType, kind: kind === 'local_workflow' ? 'workflow' : 'agent' };
          byTask.set(event.taskId, group);
          if (at === 0) group.id = rowId.subagent(event.taskId);
        } else {
          addRef(group, { taskId: event.taskId, agentId: null, toolUseId: event.toolUseId, name: event.description, glyph: glyphFor(event.taskId), kind: kind === 'local_workflow' ? 'workflow' : 'agent', subagentType: event.kind === 'subagent.started' ? event.subagentType : null });
        }
        group.statuses.set(event.taskId, 'started');
        break;
      }
      case 'subagent.progress': {
        const group = byTask.get(event.taskId);
        if (!group) break;
        group.statuses.set(event.taskId, 'working');
        group.lastTool.set(event.taskId, event.lastToolName);
        break;
      }
      case 'workflow.progress': {
        const group = byTask.get(event.taskId);
        if (!group) break;
        const phases = Array.isArray(event.progress) ? event.progress.map(record).filter((entry) => entry.type === 'workflow_phase') : [];
        const title = phases.at(-1)?.title;
        group.phase = typeof title === 'string' && title.length > 0 ? title : group.phase;
        group.statuses.set(event.taskId, 'working');
        break;
      }
      case 'subagent.finished':
      case 'task.notification': {
        const group = byTask.get(event.taskId);
        if (group) {
          group.statuses.set(event.taskId, event.status === 'completed' ? 'finished' : event.status === 'failed' ? 'finished_with_errors' : 'stopped');
          break;
        }
        for (const rec of tools.values()) if (rec.backgroundTaskId === event.taskId) rec.backgroundDone = true;
        break;
      }
      case 'task.updated':
        break;
      case 'subagent.message': {
        const name = event.direction === 'to_child' ? event.toAgentId : event.fromAgentId;
        items.push({ kind: 'row', row: { id: rowId.agentMessage(event.id), turnId: turn.id, at: event.at, kind: 'agent_message', direction: event.direction, from: null, to: null, text: agentMessageCopy(event.direction, name, event.text) } });
        break;
      }
      case 'permission.requested':
      case 'question.requested':
      case 'plan.requested':
      case 'dialog.requested':
      case 'elicitation.requested': {
        const toolUseId = 'toolUseId' in event ? event.toolUseId : null;
        const pending = toolUseId ? pendingRows.get(toolUseId) : undefined;
        if (pending) pending.requestId = event.requestId;
        if (state?.pending.has(event.requestId)) items.push({ kind: 'row', row: slotRow(event, turn.id, toolUseId) });
        break;
      }
      case 'permission.resolved': {
        const rec = tools.get(event.toolUseId);
        if (rec && event.resolvedBy === 'user') rec.humanDecision = true;
        break;
      }
      case 'question.answered': {
        const pending = pendingRows.get(event.toolUseId);
        if (pending) pending.answers = event.answers;
        break;
      }
      case 'plan.resolved': {
        const pending = pendingRows.get(event.toolUseId);
        if (pending) {
          pending.outcome = event.outcome;
          pending.feedback = event.feedback;
        }
        break;
      }
      case 'hook.started':
      case 'hook.finished': {
        const existing = hooks.get(event.hookId);
        if (existing) {
          if (event.kind === 'hook.started') existing.started = event;
          else existing.finished = event;
        } else {
          hooks.set(event.hookId, { started: event.kind === 'hook.started' ? event : null, finished: event.kind === 'hook.finished' ? event : null });
          items.push({ kind: 'hook', hookId: event.hookId });
        }
        break;
      }
      case 'boundary.compaction':
      case 'boundary.reset':
      case 'boundary.retraction':
        items.push({ kind: 'row', row: boundaryRow(event, turn.id) });
        break;
      case 'api.retry': {
        const first = retryAt === null;
        retryAt ??= event.at;
        retry = { id: rowId.retry(turn.id), turnId: turn.id, at: retryAt, kind: 'error', severity: 'transient', text: retryCopy(event.attempt, event.maxRetries, event.errorStatus, event.error), attempt: { n: event.attempt, max: event.maxRetries }, scope: 'api', lostAttentionCount: null };
        if (first) items.push({ kind: 'row', row: retry }); // later retries replace this row in place (resolution pass)
        break;
      }
      case 'error.raised':
        items.push({ kind: 'row', row: { id: rowId.error(event.id), turnId: turn.id, at: event.at, kind: 'error', severity: 'error', text: event.message, attempt: null, scope: event.scope, lostAttentionCount: null } });
        break;
      case 'notice.posted':
        if (!supersededByHookRow(event)) items.push({ kind: 'row', row: noticeRow(event, event.text, turn.id) });
        break;
      case 'plugin.log':
      case 'plugin.load_issue':
        items.push({ kind: 'row', row: pluginRow(event, turn.id) });
        break;
      default:
        break;
    }
  }

  // Resolve the placeholders now that every event of the turn has been seen: tool and hook cells, question and plan
  // rows, subagent rows. The retry row updates in place: the last api.retry event's text at the first one's position.
  const retryRow = retry;
  const resolved: (WorkItem | Extract<Item, { kind: 'steer' }> | { kind: 'notice'; row: RowOf<'error'> })[] = [];
  for (const item of items) {
    switch (item.kind) {
      case 'tool': {
        const rec = tools.get(item.toolUseId)!;
        resolved.push({ kind: 'cell', cell: cellOf(rec, context, ui?.expandedCells.has(cellId.tool(rec.use.toolUseId)) ?? false) });
        break;
      }
      case 'hook': {
        // A hook that ran and let things go on, or is still running, shows nothing; one that got in the way is a notice
        // outside the work area, so it stays in view when the turn folds (model/hooks.ts; W1).
        const rec = hooks.get(item.hookId)!;
        const notice = hookNotice(rec);
        const at = (rec.started ?? rec.finished)!;
        if (notice) resolved.push({ kind: 'notice', row: { id: rowId.hook(item.hookId), turnId: turn.id, at: at.at, kind: 'error', attempt: null, scope: 'hook', lostAttentionCount: null, ...notice } });
        break;
      }
      case 'request': {
        const row = requestOrHistoricalRow(pendingRows.get(item.toolUseId)!, turn.id, state);
        if (row) resolved.push({ kind: 'row', row });
        break;
      }
      case 'subagents': {
        if (item.group.refs.length === 0) break;
        for (const ref of item.group.refs) if (ref.toolUseId && agentIds.has(ref.toolUseId)) ref.agentId = agentIds.get(ref.toolUseId)!;
        resolved.push({ kind: 'row', row: subagentRow(item.group, turn.id) });
        break;
      }
      case 'row':
        resolved.push(retryRow && item.row.kind === 'error' && item.row.id === retryRow.id ? { kind: 'row', row: retryRow } : item);
        break;
      default:
        resolved.push(item);
    }
  }
  // Text blocks after the last piece of work are the answer, outside the work area; earlier ones are commentary. A hook,
  // a notice and what a plugin said (R1) are not the model's work: under MessageDisplay and Stop hooks every final text
  // is followed by hook events (pass3/steer-next seq 230-237), and counting them would class the answer as commentary (W1).
  const WORK_ROWS = new Set<Row['kind']>(['subagent', 'agent_message', 'question', 'plan', 'request_slot', 'error']);
  const isWork = (item: (typeof resolved)[number]) => item.kind === 'cell' || (item.kind === 'row' && WORK_ROWS.has(item.row.kind) && !(item.row.kind === 'error' && (item.row.severity === 'notice' || item.row.scope === 'plugin')));
  const lastWork = resolved.map(isWork).lastIndexOf(true);
  // W1: one stream in event order. The rows that stay in view when the work area folds (isPersistentRow: a prompt the
  // engine took into this turn, at its delivery position; a hook that got in the way; the answer; a boundary; a slash
  // command's output) go through the group machine as rows, so a steer splits the work around it; everything else is
  // the work area.
  const ordered: WorkItem[] = [];
  resolved.forEach((item, i) => {
    if (item.kind === 'steer' || item.kind === 'notice') ordered.push({ kind: 'row', row: item.row });
    else if (item.kind === 'text' && i > lastWork) ordered.push({ kind: 'row', row: { ...item.row, phase: 'answer' } });
    else if (item.kind === 'text') ordered.push({ kind: 'text', row: { ...item.row, phase: 'commentary' } });
    else if (item.kind === 'thinking' && i > lastWork) ordered.push({ kind: 'row', row: item.row }); // after the last tool use: a row, not a cell of the last group
    else ordered.push(item);
  });

  const allRows = groupItems(ordered, turn, ui, tools);
  const workRows = allRows.filter((row) => !isPersistentRow(row));
  const cells = collectCells(workRows);
  const files = changedFiles(cells, turn);
  const summary = summaryOf(turn, cells, subagents, model);
  const denials = summary.denials;
  const dividerState: RowOf<'divider'>['state'] = turn.state === 'open' ? 'working' : turn.closedBy !== null ? turn.closedBy : isAborted(turn.ended?.terminalReason ?? null) ? 'stopped' : turn.ended?.isError ? 'failed' : turn.ended ? 'completed' : 'stopped';
  const rows: Row[] = [];
  if (user) rows.push(user);
  // The divider summarises a work area. A turn the owner did not start (engine, peer) always has one, because it is
  // what tells the reader whose turn it was ("Continued for …"; pass2/workflow's engine turn is a single answer); a
  // turn the engine accepted has one while it runs ("Working"), and a pending prompt has none until it starts.
  if (workRows.length > 0 || turn.origin !== 'human' || (turn.state === 'open' && turn.accepted)) {
    const denied = denials.filter((d) => d.disposition === 'denied');
    const firstDenied = denials.find((d) => d.disposition !== 'stopped')?.cellId ?? null;
    rows.push({
      id: rowId.divider(turn.id), turnId: turn.id, at: user?.at ?? turn.startedAt, kind: 'divider', state: dividerState, origin: turn.origin, startedAt: turn.startedAt, endedAt: turn.endedAt,
      toolCalls: summary.toolCalls, denied: denied.length, autoDenied: summary.autoDenied, firstDeniedCell: firstDenied, expanded, summary,
    });
  }
  rows.push(...(expanded ? allRows : allRows.filter(isPersistentRow))); // with no divider there is no work: every row is persistent
  if (files.length > 0) {
    rows.push({
      id: rowId.receipt(turn.id), turnId: turn.id, at: context.lastAt, kind: 'receipt', files, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0),
      ...receiptFields(RECEIPT_APPLIED), // the reader's undo state is laid over in rowsOfTurn
    });
  }
  return { rows, summary, cells, work: workOf(turn, tools, cells, subagents, state?.cwd ?? null) };
}

// What the turn did whatever was disclosed, one entry per tool use from the turn's tool records (so the calls a merged
// read cell folds together keep their own names; thinking and hooks are no tool uses; child agents' calls live in
// `children` and are not tool uses of the turn, though their completed edits are its edited files, as on the
// receipt). A file counts as read or edited once its call completed without an error or a denial: a refused or failed
// call touched nothing. An edit carries its cell's own detail (hunks, counts, change). Only calls that read a file
// count as reads: Glob's and LS's `path` are search scopes (directories), so they are no files of the turn; Grep's is
// one too unless its result shows it named a single file (grepFileScope).
const READS = new Set(['Read', 'NotebookRead']);
const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

// Whether a Grep's `path` was a file, read from the engine's structured result (2.1.283's Grep: `{ mode, filenames,
// content, … }`): in `files_with_matches` mode the one filename is the scope itself; in `count` mode the one `path:N`
// line names it. Only a path the result names proves anything: `content` mode's lines (`12:text` for a file,
// `dir/a.ts:12:text` for a directory, and a directory's own path may start with digits) and a search with no match
// prove nothing, so the scope stays out (a directory must never count as a file read).
function grepFileScope(input: Record<string, unknown>, structured: unknown, cwd: string | null): string | null {
  const scope = str(input.path).replace(/\/+$/, '');
  if (!scope) return null;
  const s = record(structured);
  const names = (filename: string) => samePath(scope, filename, cwd);
  const filenames = Array.isArray(s.filenames) ? s.filenames.filter((name): name is string => typeof name === 'string') : [];
  const lines = str(s.content).split('\n').filter((line) => line !== '');
  const mode = str(s.mode, 'files_with_matches');
  if (mode === 'files_with_matches') return filenames.length === 1 && names(filenames[0]) ? scope : null;
  if (mode === 'count') return lines.length === 1 && /:\d+$/.test(lines[0]) && names(lines[0].slice(0, lines[0].lastIndexOf(':'))) ? scope : null;
  return null;
}

// Whether the engine's filename is the scope itself. Grep prints a path relative to the session's cwd (absolute outside
// it), so both are resolved against the cwd (the session's latest `session.started`/`session.init`); without one, only
// two spellings of the same form compare, and an absolute and a relative path prove nothing.
function samePath(scope: string, filename: string, cwd: string | null): boolean {
  const absolute = (path: string) => path.startsWith('/');
  if (absolute(scope) !== absolute(filename) && cwd === null) return false;
  const resolve = (path: string) => normalise(absolute(path) || cwd === null ? path : `${cwd}/${path}`);
  return resolve(scope) === resolve(filename);
}

function normalise(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `${path.startsWith('/') ? '/' : ''}${parts.join('/')}`;
}

function workOf(turn: TurnState, tools: Map<ToolUseId, ToolRecord>, cells: Cell[], subagents: SubagentGroup[], cwd: string | null): TurnWork {
  const edits = new Map(cells.flatMap((cell) => (cell.detail.kind === 'edit' && cell.toolUseId !== null ? [[cell.toolUseId, cell.detail] as const] : [])));
  const files: TurnWork['files'] = [];
  const used: TurnWork['tools'] = [];
  for (const { use, result } of tools.values()) {
    const input = record(use.input);
    const { category } = tableRowOf(use.toolName);
    const mcp = MCP_TOOL.exec(use.toolName);
    used.push({ name: use.toolName, category, at: use.at, url: use.toolName === 'WebFetch' && typeof input.url === 'string' ? input.url : null, mcp: mcp ? { server: mcp[1], tool: mcp[2] } : null });
    const completed = result !== null && !result.isError && result.denial === null;
    const grepFile = use.toolName === 'Grep' && completed ? grepFileScope(input, result.structured, cwd) : null;
    const path = grepFile ?? filePathOf(input);
    const kind = READS.has(use.toolName) || grepFile !== null ? 'read' : EDITS.has(use.toolName) ? 'edited' : null;
    if (path && completed && kind) files.push({ path, use: kind, at: use.at, edit: kind === 'edited' ? (edits.get(use.toolUseId) ?? null) : null });
  }
  // The child agents' completed edits the receipt attributes to the turn are edited files of the turn too (C8c), merged
  // in time order; they are not tool uses of the turn (a child's calls live in its own transcript).
  const children = childEdits(turn).map(({ use, edit }) => ({ path: filePathOf(record(use.input)) || edit.filePath, use: 'edited' as const, at: use.at, edit }));
  if (children.length > 0) files.splice(0, files.length, ...[...files, ...children].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)));
  const agents = subagents.flatMap((group) => group.refs.map((ref) => ({ ...ref, status: group.statuses.get(ref.taskId) ?? ('started' as const) })));
  return { files, tools: used, subagents: agents };
}

// A turn's work, read from the per-turn memo (derived with its rows if the memo is stale).
export function turnWork(state: TranscriptState, turn: TurnState): TurnWork {
  rowsOfTurn(state, turn);
  return state.memo.get(turn.id)!.work;
}

// ---------------------------------------------------------------------------------------------------------------------
// Receipts, summary, rows of other kinds

const receiptFields = (undo: ReceiptUndo) => ({
  state: undo.state,
  canUndo: undo.state === 'applied' && typeof undo.check === 'object' && undo.check?.ok === true,
  canReapply: undo.state === 'undone' && undo.reapply,
});

// A spill the reader loaded (or is loading) reads so in the cell's detail; the same cell when nothing applies.
function withSpillLoad(cell: Cell, spills: TranscriptUi['spills']): Cell {
  const { detail } = cell;
  if (!('spill' in detail) || detail.spill === null) return cell;
  const load = spills.get(detail.spill.path);
  if (!load) return cell;
  return { ...cell, detail: { ...detail, spill: { ...detail.spill, state: load.state, content: load.content } } };
}

// The reader's receipt undo state and loaded spills laid over a turn's derived rows (M5: X3 consumers read the truth).
// They change without a ui version bump (the store's `withReaderState`), so only the turn they touch is rebuilt, and
// only its receipt row and the rows holding a spilled cell; every other row keeps its reference.
function overlay(ui: TranscriptUi, rows: Row[]): Row[] {
  let out: Row[] | null = null;
  const replace = (i: number, row: Row) => {
    if (row === rows[i]) return;
    out ??= rows.slice();
    out[i] = row;
  };
  rows.forEach((row, i) => {
    if (row.kind === 'receipt') {
      const undo = ui.receipts.get(row.id);
      if (undo) replace(i, { ...row, ...receiptFields(undo) });
    } else if (ui.spills.size > 0 && row.kind === 'cell') {
      replace(i, withSpillLoad(row, ui.spills) as Row); // a standalone cell's row is the cell with `kind: 'cell'`
    } else if (ui.spills.size > 0 && row.kind === 'group') {
      const cells = row.cells.map((cell) => withSpillLoad(cell, ui.spills));
      if (cells.some((cell, n) => cell !== row.cells[n])) replace(i, { ...row, cells });
    }
  });
  return out ?? rows;
}

function changedFiles(cells: Cell[], turn: TurnState): ChangedFile[] {
  const files: ChangedFile[] = [];
  // Successful `files` results only: a failed, denied, stopped or still-running edit changed nothing to receipt.
  for (const cell of cells) if (cell.detail.kind === 'edit' && cell.status === 'done') files.push({ path: cell.detail.filePath, change: cell.detail.change, added: cell.detail.added, removed: cell.detail.removed, cellId: cell.id });
  // Child-agent edits are attributed to the turn (the receipt names them; no cell is rendered for them).
  for (const { use, edit } of childEdits(turn)) files.push({ path: edit.filePath, change: edit.change, added: edit.added, removed: edit.removed, cellId: cellId.tool(use.toolUseId) });
  return byPath(files);
}

// The completed `files` calls of the turn's child agents, each with the edit detail its cell would carry (the
// receipt's child entries and the activity projection's, so the two name the same files).
function childEdits(turn: TurnState): { use: Event<'tool.use'>; edit: Extract<Cell['detail'], { kind: 'edit' }> }[] {
  const out: { use: Event<'tool.use'>; edit: Extract<Cell['detail'], { kind: 'edit' }> }[] = [];
  for (const events of turn.children.values()) {
    const uses = new Map(events.filter((e): e is Event<'tool.use'> => e.kind === 'tool.use' && tableRowOf(e.toolName).category === 'files').map((e) => [e.toolUseId, e]));
    for (const event of events) {
      if (event.kind !== 'tool.result' || event.isError || event.denial) continue;
      const use = uses.get(event.toolUseId);
      if (!use) continue;
      const input = record(use.input);
      const { hunks, added, removed, change } = editCounts(use.toolName, input, event.structured);
      out.push({ use, edit: { kind: 'edit', filePath: str(record(event.structured).filePath, filePathOf(input)), change, hunks, added, removed } });
    }
  }
  return out;
}

// A receipt names each file once: later edits of a path add their counts to its first entry, which keeps its cell;
// a file created in the turn stays a create, and one deleted last reads as deleted.
function byPath(files: ChangedFile[]): ChangedFile[] {
  const merged = new Map<string, ChangedFile>();
  for (const file of files) {
    const first = merged.get(file.path);
    if (!first) merged.set(file.path, { ...file });
    else {
      first.added += file.added;
      first.removed += file.removed;
      if (file.change === 'delete') first.change = 'delete';
    }
  }
  return [...merged.values()];
}

function summaryOf(turn: TurnState, cells: Cell[], subagents: SubagentGroup[], model: string | null): TurnSummary {
  const byCategory = Object.fromEntries(TOOL_CATEGORIES.map((category) => [category, 0])) as Record<ToolCategory, number>;
  const denials: TurnSummary['denials'] = [];
  const safeguard = { reviewed: 0, flagged: 0, notEvaluated: 0 };
  let toolCalls = 0;
  for (const cell of cells) {
    if (cell.toolName === 'thinking') continue;
    const count = cell.id.startsWith('cell:reads:') && cell.detail.kind === 'read' ? cell.detail.files.length : 1;
    toolCalls += count;
    byCategory[cell.category] += count;
    if (cell.classification.denial) denials.push({ kind: cell.classification.denial.kind, cellId: cell.id, disposition: cell.classification.denial.disposition, interruption: cell.classification.denial.interruption });
    if (cell.classification.safeguard === 'not_evaluated') safeguard.notEvaluated += 1;
    else {
      safeguard.reviewed += 1;
      if (cell.classification.safeguard === 'flagged') safeguard.flagged += 1;
    }
  }
  const ended = turn.ended;
  return {
    durationMs: ended?.durationMs ?? null, toolCalls, byCategory, denials, autoDenied: denials.filter((d) => d.disposition === 'auto_denied').length, safeguard,
    costUsd: ended?.costUsd ?? null, usage: ended?.usage ?? null, model, childAgents: subagents.reduce((n, group) => n + group.refs.length, 0), terminalReason: ended?.terminalReason ?? null,
  };
}

function subagentRow(group: SubagentGroup, turnId: TurnId): RowOf<'subagent'> {
  // Each child's own state; the row is terminal only when every child is (with errors when any failed, stopped when
  // any was stopped), and working while any child has progressed or ended and another still runs.
  const statuses = group.refs.map((ref) => group.statuses.get(ref.taskId) ?? 'started');
  const terminal = (s: SubagentStatus) => s === 'finished' || s === 'finished_with_errors' || s === 'stopped';
  const done = statuses.every(terminal);
  const status: SubagentStatus = done
    ? statuses.includes('finished_with_errors') ? 'finished_with_errors' : statuses.includes('stopped') ? 'stopped' : 'finished'
    : statuses.every((s) => s === 'started') ? 'started' : 'working';
  const sentence = subagentSentence(group.refs.map((ref) => ref.name), status) + (group.phase && !done ? ` · ${group.phase}` : '');
  return { id: group.id, turnId, at: group.at, kind: 'subagent', agents: group.refs, sentence, status, overflow: Math.max(0, group.refs.length - 4) };
}

function requestOrHistoricalRow(pending: Pending, turnId: TurnId, state: TranscriptState | null): Row | null {
  const { use } = pending;
  const input = record(use.input);
  if (pending.requestId && state?.pending.has(pending.requestId)) return null; // its slot row was emitted at the request's position
  if (pending.kind === 'question') {
    const questions = Array.isArray(input.questions) ? input.questions.map(record).map((q) => ({
      question: str(q.question), header: str(q.header), multiSelect: q.multiSelect === true,
      options: Array.isArray(q.options) ? q.options.map(record).map((o) => ({ label: str(o.label), description: typeof o.description === 'string' ? o.description : null, preview: typeof o.preview === 'string' ? o.preview : null })) : [],
    })) : [];
    return { id: rowId.question(use.toolUseId), turnId, at: use.at, kind: 'question', toolUseId: use.toolUseId, questions, answers: pending.answers };
  }
  return { id: rowId.plan(use.toolUseId), turnId, at: use.at, kind: 'plan', toolUseId: use.toolUseId, plan: str(input.plan), outcome: pending.outcome, feedback: pending.feedback };
}

function slotRow(event: Event<'permission.requested' | 'question.requested' | 'plan.requested' | 'dialog.requested' | 'elicitation.requested'>, turnId: TurnId | null, toolUseId: ToolUseId | null): RowOf<'request_slot'> {
  const requestKind = event.kind.split('.')[0] as RowOf<'request_slot'>['requestKind'];
  const toolName = event.kind === 'permission.requested' ? event.toolName : event.kind === 'question.requested' ? 'AskUserQuestion' : event.kind === 'plan.requested' ? 'ExitPlanMode' : event.kind === 'elicitation.requested' ? event.mcpServerName : null;
  return { id: rowId.slot(event.requestId), turnId, at: event.at, kind: 'request_slot', requestId: event.requestId, toolUseId, requestKind, toolName, requestedAt: event.at };
}

function boundaryRow(event: Event<'boundary.compaction' | 'boundary.reset' | 'boundary.retraction'>, turnId: TurnId | null): RowOf<'boundary'> {
  const base = { id: rowId.boundary(event.id), turnId, at: event.at, kind: 'boundary' as const, hiddenRows: 0, revealed: false };
  switch (event.kind) {
    case 'boundary.compaction':
      return { ...base, boundaryKind: 'compaction', text: boundaryCopy({ kind: 'compaction', preTokens: event.preTokens, postTokens: event.postTokens, trigger: event.trigger, historical: event.historical }), detail: event.logicalParentUuid };
    case 'boundary.reset':
      return { ...base, boundaryKind: 'reset', text: boundaryCopy({ kind: 'reset', trigger: event.trigger }), detail: event.newConversationId };
    case 'boundary.retraction':
      return { ...base, boundaryKind: 'retraction', text: boundaryCopy({ kind: 'retraction', reason: event.reason, fallbackModel: event.fallbackModel }), detail: event.retractedMessageUuids.join(', ') || null };
  }
}

// The engine's local-command echo, tags stripped; the raw text stands when the wrapper is absent (C3 tagged it).
function localCommandRow(event: Event<'user.message'>, turnId: TurnId | null): RowOf<'local_command'> {
  const text = localCommandOutput(event.content) ?? (typeof event.content === 'string' ? event.content : event.content.filter((block) => block.type === 'text').map((block) => str(block.text)).join('\n'));
  return { id: event.messageUuid === null ? rowId.localOfEvent(event.id) : rowId.local(event.messageUuid), turnId, at: event.at, kind: 'local_command', messageUuid: event.messageUuid, text };
}

// The engine's own words for a hook that got in the way, written for the terminal, which the hook's notice row says
// instead (model/hooks.ts; pass3/hooks-blocking seq 32 and 59): the `stop-hook-error` notification ("Stop hook error
// occurred · ctrl+o to see", also sent when a Stop hook re-prompts) and the informational "UserPromptSubmit operation
// blocked by hook: …" (2.1.283 cli.pretty.js 807758, 919121).
const supersededByHookRow = (event: Event<'notice.posted'>) => event.key === 'stop-hook-error' || event.text.startsWith('UserPromptSubmit operation blocked by hook:');

function noticeRow(event: SessionEvent, text: string, turnId: TurnId | null): RowOf<'error'> {
  const row: RowOf<'error'> = { id: rowId.error(event.id), turnId, at: event.at, kind: 'error', severity: 'notice', text, attempt: null, scope: 'notice', lostAttentionCount: null };
  if (event.kind === 'notice.posted' && event.key === ENGINE_COMPAT_NOTICE_KEY) row.action = 'engine_settings'; // W13: Settings › Engine, beside the notice
  return row;
}

// R1: a plugin's log line (a dim notice under its name) or a load issue from init (an error, or a notice for a warning),
// at its arrival position.
function pluginRow(event: Event<'plugin.log'> | Event<'plugin.load_issue'>, turnId: TurnId | null): RowOf<'error'> {
  const base = { id: rowId.error(event.id), turnId, at: event.at, kind: 'error' as const, attempt: null, scope: 'plugin' as const, lostAttentionCount: null };
  if (event.kind === 'plugin.log') return { ...base, severity: 'notice', text: PLUGIN.log(event.plugin, event.text) };
  if (event.level === 'error') return { ...base, severity: 'error', text: PLUGIN.loadError(event.plugin, event.message) };
  return { ...base, severity: 'notice', text: PLUGIN.loadWarning(event.plugin, event.message) };
}

// A `!` command's replayed rows: the input message opens the row, the next output message completes it.
function bashRowOf(input: Event<'user.message'>, turnId: TurnId | null): RowOf<'bash'> {
  const command = input.bash?.part === 'input' ? input.bash.command : '';
  const id = input.messageUuid === null ? rowId.bashOfEvent(input.id) : rowId.bash(input.messageUuid);
  return { id, turnId, at: input.at, kind: 'bash', command, stdout: '', stderr: '', exitCode: null, cwd: null };
}

function withBashOutput(row: RowOf<'bash'>, output: Event<'user.message'>): RowOf<'bash'> {
  if (output.bash?.part !== 'output') return row;
  return { ...row, stdout: output.bash.stdout, stderr: output.bash.stderr, exitCode: output.bash.exitCode };
}

// Rows for the events outside any turn, placed after the turn they followed.
function looseRows(state: TranscriptState, events: SessionEvent[]): Row[] {
  const rows: Row[] = [];
  let episode: { index: number; id: RowId } | null = null; // the open reconnect episode: its row updates in place until it ends
  for (const event of events) {
    switch (event.kind) {
      case 'user.message': {
        if (event.bash?.part === 'input') rows.push(bashRowOf(event, null));
        else if (event.bash?.part === 'output') {
          const at = rows.findIndex((row) => row.kind === 'bash' && row.exitCode === null);
          if (at >= 0) rows[at] = withBashOutput(rows[at] as RowOf<'bash'>, event);
        } else if (isLocalCommand(event.origin, event.content) && !event.isSynthetic) rows.push(localCommandRow(event, null));
        break;
      }
      case 'boundary.compaction':
      case 'boundary.reset':
      case 'boundary.retraction':
        rows.push(boundaryRow(event, null));
        break;
      case 'boundary.rewind': {
        const id = rowId.boundary(event.id);
        const revealed = state.ui.revealedBoundaries.has(id);
        const hiddenRows = state.hidden?.rows ?? 0;
        rows.push({ id, turnId: null, at: event.at, kind: 'boundary', boundaryKind: 'rewind', text: boundaryCopy({ kind: 'rewind', hiddenRows, revealed }), detail: event.prefillText, hiddenRows, revealed });
        break;
      }
      case 'api.retry':
        rows.push({ id: rowId.error(event.id), turnId: null, at: event.at, kind: 'error', severity: 'transient', text: retryCopy(event.attempt, event.maxRetries, event.errorStatus, event.error), attempt: { n: event.attempt, max: event.maxRetries }, scope: 'api', lostAttentionCount: null });
        break;
      case 'error.raised':
        rows.push({ id: rowId.error(event.id), turnId: null, at: event.at, kind: 'error', severity: 'error', text: event.message, attempt: null, scope: event.scope, lostAttentionCount: null });
        break;
      case 'notice.posted':
        if (!supersededByHookRow(event)) rows.push(noticeRow(event, event.text, null));
        break;
      case 'plugin.log':
      case 'plugin.load_issue':
        rows.push(pluginRow(event, null));
        break;
      case 'session.reconnect': {
        const id: RowId = episode?.id ?? rowId.reconnect(event.id);
        const row: RowOf<'error'> = { id, turnId: null, at: event.at, kind: 'error', severity: event.phase === 'failed' ? 'error' : 'transient', text: reconnectCopy(event.phase, event.attempt, event.maxAttempts, event.reason), attempt: { n: event.attempt, max: event.maxAttempts }, scope: 'reconnect', lostAttentionCount: null };
        // C12 start: the resume of a session released under the memory budget reads Resuming… and stays as Resumed, the
        // line that closes the release's own
        const resumed = event.trigger === 'process_exit' && event.phase === 'reconnected';
        if (event.trigger === 'process_exit' && event.phase === 'attempting') row.text = RESUMING_COPY;
        if (resumed) Object.assign(row, { severity: 'notice', text: RESUMED_COPY, attempt: null });
        // C12 end
        if (event.phase === 'reconnected' && !resumed /* C12 */) {
          if (episode) rows.splice(episode.index, 1); // a reconnect that succeeded leaves no row
        } else if (episode) rows[episode.index] = row;
        else {
          rows.push(row);
          episode = { index: rows.length - 1, id };
        }
        if (event.phase !== 'attempting') episode = null; // reconnected or failed: the episode is over
        break;
      }
      case 'process.exited':
        // C4's synthesised end of a holder-less transcript whose last turn never ended (disk-derived, reason unknown)
        // closed that turn in the reducer; nobody witnessed an exit, so it is no notice. C3's exits carry a seq.
        if (event.reason === 'unknown' && event.seq === null) break;
        rows.push({ id: rowId.error(event.id), turnId: null, at: event.at, kind: 'error', severity: event.reason === 'crash' ? 'error' : 'notice', text: processExitCopy(event.reason, event.lostAttentionCount), attempt: null, scope: 'exit', lostAttentionCount: event.lostAttentionCount });
        break;
      case 'permission.requested':
      case 'question.requested':
      case 'plan.requested':
      case 'dialog.requested':
      case 'elicitation.requested':
        if (state.pending.has(event.requestId)) rows.push(slotRow(event, null, 'toolUseId' in event ? event.toolUseId : null));
        break;
      default:
        break;
    }
  }
  return rows;
}

export { isEngineOrigin };
