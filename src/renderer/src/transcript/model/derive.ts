// rowsOf: TranscriptState → Row[] in virtualised order (C6 execution document, Derivation "Groups and rows",
// "Expansion state", "Revisable log", "Requests", "Receipts", "Bash rows", "Time separators"). Rows are derived per
// turn from its retained events and memoised on (version, ui version); the flat list is the concatenation, with
// loose rows placed after the turn they followed and time separators inserted by the thresholds in time.ts.
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, RequestId, TaskId, ToolUseId } from '@shared/graph/ids';
import { presentationOf, tableRowOf } from './classify';
import { cellOf, editCounts, filePathOf, hookCell, type HookRecord, type ToolRecord, type TurnContext } from './cells';
import { agentMessageCopy, boundaryCopy, groupSummary, processExitCopy, reconnectCopy, retryCopy, subagentSentence } from './copy';
import { collectCells, groupItems, phrasesOf, type WorkItem } from './groups';
import { cellId, rowId, turnId as turnIdOf } from './keys';
import type { LiveBlock, TranscriptState, TranscriptUi, TurnState } from './reduce';
import { isEngineOrigin } from './reduce';
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
const flatMemo = new WeakMap<TranscriptState['memo'], { keys: unknown[]; rows: Row[] }>();

export function rowsOf(state: TranscriptState): Row[] {
  const turnRows = [...state.order, ...(state.hidden?.turns ?? [])].map((id) => rowsOfTurn(state, state.turns.get(id)!));
  const keys = [state.order, state.loose, state.hidden, state.ui.version, ...turnRows];
  const previous = flatMemo.get(state.memo);
  if (previous && previous.keys.length === keys.length && previous.keys.every((key, i) => key === keys[i])) return previous.rows;
  const rows = flatten(state);
  flatMemo.set(state.memo, { keys, rows });
  return rows;
}

function flatten(state: TranscriptState): Row[] {
  const out: Row[] = [];
  let previousAt: string | null = null;
  const looseAfter = new Map<TurnId | null, SessionEvent[]>();
  for (const event of state.loose) {
    const placement = state.placement.get(event.id);
    if (placement === undefined) continue; // unplaced: nothing to render
    looseAfter.set(placement, [...(looseAfter.get(placement) ?? []), event]);
  }
  const emit = (rows: Row[], subject: 'human' | 'engine' | 'loose', separator: RowId) => {
    if (rows.length === 0) return;
    if (needsSeparator(previousAt, rows[0].at, subject)) out.push({ id: separator, turnId: subject === 'loose' ? null : rows[0].turnId, at: rows[0].at, kind: 'time', label: separatorLabel(rows[0].at) });
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

export function turnSummary(turn: TurnState): TurnSummary {
  return deriveTurn(turn, null).summary;
}

// The group phrases of a whole turn ("Edited 3 files, ran 2 commands"): the turn summary popover's category segment.
// Denied and stopped calls did not run, so they are counted as tool calls but phrase nothing.
export function turnPhrases(turn: TurnState): string {
  return groupSummary(phrasesOf(deriveTurn(turn, null).cells.filter((cell) => cell.classification.denial === null)));
}

// A state whose every turn, group and cell is expanded and every rewound branch revealed: the snapshot suite's view.
export function withAllExpanded(state: TranscriptState): TranscriptState {
  const turns = [...state.order, ...(state.hidden?.turns ?? [])];
  const ui: TranscriptUi = { ...state.ui, expandedTurns: new Set(turns), collapsedTurns: new Set(), expandedGroups: new Set(), expandedCells: new Set(), revealedBoundaries: new Set(), version: state.ui.version + 1 };
  const first = rowsOf({ ...state, ui });
  for (const row of first) {
    if (row.kind === 'group') {
      ui.expandedGroups.add(row.id);
      for (const cell of row.cells) ui.expandedCells.add(cell.id);
    } else if (row.kind === 'cell') ui.expandedCells.add(row.id);
    else if (row.kind === 'boundary' && row.boundaryKind === 'rewind') ui.revealedBoundaries.add(row.id);
  }
  ui.version += 1;
  return { ...state, ui };
}

// ---------------------------------------------------------------------------------------------------------------------
// Per-turn derivation

function rowsOfTurn(state: TranscriptState, turn: TurnState): Row[] {
  const memo = state.memo.get(turn.id);
  if (memo && memo.version === turn.version && memo.uiVersion === state.ui.version) return memo.rows;
  const rows = deriveTurn(turn, state).rows;
  state.memo.set(turn.id, { version: turn.version, uiVersion: state.ui.version, rows });
  return rows;
}

// What the walk over a turn's events produces before grouping: cells and rows in event order.
type Item =
  | WorkItem
  | { kind: 'steer'; row: RowOf<'user'> } // outside the work area, in event order with the answer
  // Placeholders the walk leaves and the resolution pass fills, once every event of the turn has been seen.
  | { kind: 'tool'; toolUseId: ToolUseId }
  | { kind: 'hook'; hookId: string }
  | { kind: 'request'; toolUseId: ToolUseId }
  | { kind: 'subagents'; group: SubagentGroup };

interface SubagentGroup { id: RowId; at: string; apiMessageId: string | null; refs: SubagentRef[]; statuses: Map<TaskId, SubagentStatus>; lastTool: Map<TaskId, string | null>; phase: string | null }
interface Pending { kind: 'question' | 'plan'; use: Event<'tool.use'>; answers: Record<string, string> | null; outcome: RowOf<'plan'>['outcome']; feedback: string | null; requestId: RequestId | null }

const glyphOf = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (Math.imul(hash, 31) + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 8;
};

const isAborted = (reason: string | null) => reason !== null && reason.startsWith('aborted');

function deriveTurn(turn: TurnState, state: TranscriptState | null): { rows: Row[]; summary: TurnSummary; cells: Cell[] } {
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

  const cancelled = new Set<string>(); // steers a `command.lifecycle` cancelled, discarded or refused
  for (const event of turn.events) {
    if (event.kind === 'boundary.retraction') for (const uuid of event.retractedMessageUuids) retracted.add(uuid);
    if (event.kind === 'assistant.block.complete' && event.supersedes) superseded.add(event.supersedes);
    if (event.kind === 'command.lifecycle') cancelled.add(event.commandUuid);
  }
  const dropped = (messageUuid: string | null) => messageUuid !== null && (retracted.has(messageUuid) || superseded.has(messageUuid));
  const openerDropped = turn.ended?.terminalReason === 'cancelled'; // an idle prompt dropped before its init
  // A steer the closing result named was consumed: a late lifecycle cannot un-send it (consumption, not timing).
  const consumed = new Set<string>(turn.ended?.userMessageUuids ?? []);
  const userRow = (event: Event<'user.message'>, id: RowId, editable: boolean, steer: boolean): RowOf<'user'> => {
    const text = userTextOf(event.content);
    const isDropped = steer ? event.messageUuid !== null && cancelled.has(event.messageUuid) && !consumed.has(event.messageUuid) : openerDropped;
    return { id, turnId: turn.id, at: event.at, kind: 'user', messageUuid: event.messageUuid, text: text.text, attachments: text.attachments, lines: text.lines, editable, steer, dropped: isDropped };
  };

  const blockRow = (block: LiveBlock, at: string): Item | null => {
    const live = !block.completed;
    if (dropped(block.messageUuid)) return null;
    if (block.blockType === 'text') return { kind: 'text', row: { id: block.rowId, turnId: turn.id, at, kind: 'assistant_text', messageUuid: block.messageUuid, blockIndex: block.blockIndex, markdown: block.buffer, live, phase: 'answer', model: block.model } };
    if (block.blockType === 'thinking') {
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
        } else if (isLocalCommand(event.origin, event.content)) {
          items.push({ kind: 'row', row: localCommandRow(event, turn.id) });
        } else if (event.messageUuid !== null && turnIdOf.ofMessage(event.messageUuid) === turn.id && user === null && !dropped(event.messageUuid)) {
          user = userRow(event, rowId.user(event.messageUuid), true, false);
        } else if (turn.id === turnIdOf.ofEvent(event.id) && user === null && !event.isSynthetic) {
          user = userRow(event, rowId.userOfEvent(event.id), false, false);
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
            taskId: event.toolUseId as string as TaskId, agentId: null, toolUseId: event.toolUseId, name: str(input.description, event.toolName), glyph: glyphOf(event.toolUseId),
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
          group.refs[at] = { ...ref, taskId: event.taskId, name: event.description, glyph: glyphOf(event.taskId), subagentType: event.kind === 'subagent.started' ? event.subagentType : ref.subagentType, kind: kind === 'local_workflow' ? 'workflow' : 'agent' };
          byTask.set(event.taskId, group);
          if (at === 0) group.id = rowId.subagent(event.taskId);
        } else {
          addRef(group, { taskId: event.taskId, agentId: null, toolUseId: event.toolUseId, name: event.description, glyph: glyphOf(event.taskId), kind: kind === 'local_workflow' ? 'workflow' : 'agent', subagentType: event.kind === 'subagent.started' ? event.subagentType : null });
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
        items.push({ kind: 'row', row: noticeRow(event, event.text, turn.id) });
        break;
      default:
        break;
    }
  }

  // Resolve the placeholders now that every event of the turn has been seen: tool and hook cells, question and plan
  // rows, subagent rows. The retry row updates in place: the last api.retry event's text at the first one's position.
  const retryRow = retry;
  const resolved: (WorkItem | Extract<Item, { kind: 'steer' }>)[] = [];
  for (const item of items) {
    switch (item.kind) {
      case 'tool': {
        const rec = tools.get(item.toolUseId)!;
        resolved.push({ kind: 'cell', cell: cellOf(rec, context, ui?.expandedCells.has(cellId.tool(rec.use.toolUseId)) ?? false) });
        break;
      }
      case 'hook':
        resolved.push({ kind: 'cell', cell: hookCell(hooks.get(item.hookId)!, ui?.expandedCells.has(cellId.hook(item.hookId)) ?? false) });
        break;
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
  // Text blocks after the last piece of work are the answer, outside the work area; earlier ones are commentary.
  const WORK_ROWS = new Set<Row['kind']>(['subagent', 'agent_message', 'question', 'plan', 'request_slot', 'error']);
  const lastWork = resolved.map((item) => item.kind === 'cell' || (item.kind === 'row' && WORK_ROWS.has(item.row.kind))).lastIndexOf(true);
  const answer: Row[] = [];
  const workItems: WorkItem[] = [];
  resolved.forEach((item, i) => {
    if (item.kind === 'steer') answer.push(item.row); // steers and answer in event order, outside the work area
    else if (item.kind === 'text' && i > lastWork) answer.push({ ...item.row, phase: 'answer' });
    else if (item.kind === 'text') workItems.push({ kind: 'text', row: { ...item.row, phase: 'commentary' } });
    else if (item.kind === 'thinking' && i > lastWork) workItems.push({ kind: 'row', row: item.row }); // after the last tool use: a row, not a cell of the last group
    else workItems.push(item);
  });

  const workRows = groupItems(workItems, turn, ui, tools);
  const cells = collectCells(workRows);
  const files = changedFiles(cells, turn);
  const summary = summaryOf(turn, cells, subagents, model);
  const denials = summary.denials;
  const dividerState: RowOf<'divider'>['state'] = turn.state === 'open' ? 'working' : isAborted(turn.ended?.terminalReason ?? null) ? 'stopped' : turn.ended?.isError ? 'failed' : turn.ended ? 'completed' : 'stopped';
  const rows: Row[] = [];
  if (user) rows.push(user);
  if (workRows.length > 0) {
    const denied = denials.filter((d) => d.disposition === 'denied');
    const firstDenied = denials.find((d) => d.disposition !== 'stopped')?.cellId ?? null;
    rows.push({
      id: rowId.divider(turn.id), turnId: turn.id, at: user?.at ?? turn.startedAt, kind: 'divider', state: dividerState, origin: turn.origin, startedAt: turn.startedAt, endedAt: turn.endedAt,
      toolCalls: summary.toolCalls, denied: denied.length, autoDenied: summary.autoDenied, firstDeniedCell: firstDenied, expanded, summary,
    });
    if (expanded) rows.push(...workRows);
  }
  rows.push(...answer);
  if (files.length > 0) {
    rows.push({
      id: rowId.receipt(turn.id), turnId: turn.id, at: context.lastAt, kind: 'receipt', files, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0),
      state: 'applied', canUndo: true, canReapply: false,
    });
  }
  return { rows, summary, cells };
}

// ---------------------------------------------------------------------------------------------------------------------
// Receipts, summary, rows of other kinds

function changedFiles(cells: Cell[], turn: TurnState): ChangedFile[] {
  const files: ChangedFile[] = [];
  // Successful `files` results only: a failed, denied, stopped or still-running edit changed nothing to receipt.
  for (const cell of cells) if (cell.detail.kind === 'edit' && cell.status === 'done') files.push({ path: cell.detail.filePath, change: cell.detail.change, added: cell.detail.added, removed: cell.detail.removed, cellId: cell.id });
  // Child-agent edits are attributed to the turn (the receipt names them; no cell is rendered for them).
  for (const events of turn.children.values()) {
    const uses = new Map(events.filter((e): e is Event<'tool.use'> => e.kind === 'tool.use' && tableRowOf(e.toolName).category === 'files').map((e) => [e.toolUseId, e]));
    for (const event of events) {
      if (event.kind !== 'tool.result' || event.isError || event.denial) continue;
      const use = uses.get(event.toolUseId);
      if (!use) continue;
      const input = record(use.input);
      const counts = editCounts(use.toolName, input, event.structured);
      files.push({ path: str(record(event.structured).filePath, filePathOf(input)), change: counts.change, added: counts.added, removed: counts.removed, cellId: cellId.tool(use.toolUseId) });
    }
  }
  return byPath(files);
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
    if (cell.toolName === 'thinking' || cell.toolName === 'hook') continue;
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
  const statuses = group.refs.map((ref) => group.statuses.get(ref.taskId) ?? 'started');
  const status: SubagentStatus = statuses.every((s) => s === 'finished') ? 'finished' : statuses.some((s) => s === 'finished_with_errors') ? 'finished_with_errors' : statuses.some((s) => s === 'stopped') ? 'stopped' : statuses.some((s) => s === 'working') ? 'working' : 'started';
  const done = statuses.every((s) => s === 'finished' || s === 'finished_with_errors' || s === 'stopped');
  const sentence = subagentSentence(group.refs.map((ref) => ref.name), done ? status : status === 'working' ? 'working' : 'started') + (group.phase && !done ? ` · ${group.phase}` : '');
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

function noticeRow(event: SessionEvent, text: string, turnId: TurnId | null): RowOf<'error'> {
  return { id: rowId.error(event.id), turnId, at: event.at, kind: 'error', severity: 'notice', text, attempt: null, scope: 'notice', lostAttentionCount: null };
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
        } else if (isLocalCommand(event.origin, event.content)) rows.push(localCommandRow(event, null));
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
        rows.push(noticeRow(event, event.text, null));
        break;
      case 'session.reconnect': {
        const id: RowId = episode?.id ?? rowId.reconnect(event.id);
        const row: RowOf<'error'> = { id, turnId: null, at: event.at, kind: 'error', severity: event.phase === 'failed' ? 'error' : 'transient', text: reconnectCopy(event.phase, event.attempt, event.maxAttempts, event.reason), attempt: { n: event.attempt, max: event.maxAttempts }, scope: 'reconnect', lostAttentionCount: null };
        if (episode) rows[episode.index] = row;
        else {
          rows.push(row);
          episode = { index: rows.length - 1, id };
        }
        if (event.phase !== 'attempting') episode = null; // reconnected or failed: the episode is over
        break;
      }
      case 'process.exited':
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
