// THROWAWAY (deleted in M3 with prototype-rows.tsx). The anchoring spike's deliberately naive derivation from X1
// events to X3 rows, so G1 measures the list and the markdown stack rather than the reducer (M2 owns the real one):
// one row per block or lifecycle event, tool calls folded into fixed groups, per-turn row arrays memoised on the
// turn's version and its expansion state, and a live buffer per streaming block that only its row reads, so a delta
// never re-derives a turn or changes the row array.
import type { SessionEvent } from '@shared/graph/events';
import type { ApiMessageId, ToolUseId } from '@shared/graph/ids';
import { cellId, rowId, turnId as turnIdOf } from '../transcript/model/keys';
import { TOOL_CATEGORIES, type Cell, type ChangedFile, type Row, type RowId, type ToolCategory, type TurnId, type TurnSummary } from '../transcript/model/rows';

type Event<K extends SessionEvent['kind']> = Extract<SessionEvent, { kind: K }>;
type GroupRow = Extract<Row, { kind: 'group' }>;
type SubagentRow = Extract<Row, { kind: 'subagent' }>;

interface Turn {
  id: TurnId;
  n: number;
  startedAt: string;
  endedAt: string | null;
  time: Row | null;
  user: Row | null;
  work: Row[]; // thinking, text, group and subagent rows in arrival order; answer rows are split off at derivation
  trailing: Row[]; // boundaries after the turn ended
  cells: Map<ToolUseId, { group: GroupRow; index: number }>;
  subagents: Map<string, SubagentRow>; // by parent tool use id
  files: ChangedFile[];
  toolCalls: number;
  denied: number;
  version: number;
  memo: Row[] | null; // cleared by any change to the turn or its expansion state
}

const HOUR = 3_600_000;
const EMPTY_BY_CATEGORY = Object.fromEntries(TOOL_CATEGORIES.map((category) => [category, 0])) as Record<ToolCategory, number>;
const CATEGORY: Record<string, ToolCategory> = {
  Skill: 'skills', ToolSearch: 'skills', Edit: 'files', Write: 'files', Read: 'exploration', Glob: 'exploration', Grep: 'exploration',
  Bash: 'commands', WebFetch: 'web', WebSearch: 'web',
};
const categoryOf = (name: string): ToolCategory => (name.startsWith('mcp__') ? 'mcp' : (CATEGORY[name] ?? 'other'));

const blockText = (block: { type: string; text?: unknown; thinking?: unknown }) => String(block.text ?? block.thinking ?? '');
const duration = (from: string, to: string | null) => {
  const seconds = Math.max(0, Math.round((Date.parse(to ?? from) - Date.parse(from)) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
};

export class PrototypeTranscript {
  private turns: Turn[] = [];
  private byId = new Map<TurnId, Turn>();
  private live = new Map<RowId, { text: string; listeners: Set<() => void> }>();
  private liveRows = new Map<string, RowId>(); // block identity → row id
  private expandedTurns = new Set<TurnId>();
  private collapsedTurns = new Set<TurnId>();
  private expandedGroups = new Set<RowId>();
  private expandedCells = new Set<string>();
  private listeners = new Set<() => void>();
  private flat: Row[] = [];
  private dirty = true;
  deriveMs = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  rows = (): Row[] => {
    if (!this.dirty) return this.flat;
    const started = performance.now();
    this.flat = this.turns.flatMap((turn) => this.rowsOfTurn(turn));
    this.deriveMs = performance.now() - started;
    this.dirty = false;
    return this.flat;
  };
  liveText = (id: RowId) => this.live.get(id)?.text ?? '';
  subscribeLive = (id: RowId, listener: () => void) => {
    const entry = this.live.get(id);
    entry?.listeners.add(listener);
    return () => entry?.listeners.delete(listener);
  };

  turnId = (n: number) => this.turns[n - 1].id;
  turnNumber = (id: TurnId | null) => (id === null ? null : (this.byId.get(id)?.n ?? null));
  isExpanded = (id: TurnId) => {
    const turn = this.byId.get(id);
    return turn !== undefined && this.expanded(turn);
  };

  apply(events: SessionEvent[]): void {
    let structural = false;
    for (const event of events) structural = this.applyOne(event) || structural;
    if (structural) this.changed();
  }

  toggleTurn(id: TurnId): void {
    const turn = this.byId.get(id)!;
    const open = this.expanded(turn);
    (open ? this.expandedTurns : this.collapsedTurns).delete(id);
    (open ? this.collapsedTurns : this.expandedTurns).add(id);
    this.touch(turn);
  }
  toggleGroup(id: RowId, turn: TurnId): void {
    if (!this.expandedGroups.delete(id)) this.expandedGroups.add(id);
    this.touch(this.byId.get(turn)!);
  }
  toggleCell(id: string, turn: TurnId): void {
    if (!this.expandedCells.delete(id)) this.expandedCells.add(id);
    this.touch(this.byId.get(turn)!);
  }
  expandAll(): void {
    for (const turn of this.turns) {
      this.collapsedTurns.delete(turn.id);
      this.expandedTurns.add(turn.id);
      turn.memo = null;
    }
    this.changed();
  }

  private expanded(turn: Turn) {
    return this.expandedTurns.has(turn.id) || (turn.endedAt === null && !this.collapsedTurns.has(turn.id));
  }
  private touch(turn: Turn) {
    turn.memo = null;
    this.changed();
  }
  private changed() {
    this.dirty = true;
    for (const listener of this.listeners) listener();
  }
  private current(): Turn | null {
    return this.turns.at(-1) ?? null;
  }

  // Applies one event; true when the row structure changed.
  private applyOne(event: SessionEvent): boolean {
    if (event.parentToolUseId !== null) return this.applyChild(event);
    const turn = this.current();
    switch (event.kind) {
      case 'turn.started':
        return this.open(event);
      case 'user.message':
        if (!turn || typeof event.content !== 'string') return false;
        turn.user = {
          id: rowId.user(event.messageUuid!), turnId: turn.id, at: event.at, kind: 'user', messageUuid: event.messageUuid, text: event.content,
          attachments: [], lines: event.content.split('\n').length, editable: true,
        };
        return this.bump(turn);
      case 'assistant.block.delta':
        return turn ? this.delta(turn, event) : false;
      case 'assistant.block.complete':
        return turn ? this.complete(turn, event) : false;
      case 'tool.use':
        return turn ? this.toolUse(turn, event) : false;
      case 'tool.result':
        return turn ? this.toolResult(turn, event) : false;
      case 'subagent.started': {
        if (!turn || event.toolUseId === null) return false;
        const row: SubagentRow = {
          id: rowId.subagent(event.taskId), turnId: turn.id, at: event.at, kind: 'subagent', status: 'started', overflow: 0,
          sentence: `${event.description} started working`,
          agents: [{ taskId: event.taskId, agentId: null, toolUseId: event.toolUseId, name: event.description, glyph: 0, kind: 'agent', subagentType: event.subagentType }],
        };
        turn.subagents.set(event.toolUseId, row);
        turn.work.push(row);
        return this.bump(turn);
      }
      case 'subagent.finished': {
        const row = turn?.work.find((r): r is SubagentRow => r.kind === 'subagent' && r.agents[0].taskId === event.taskId);
        if (!turn || !row) return false;
        this.replaceWork(turn, row, { ...row, status: 'finished', sentence: `${row.agents[0].name} finished` });
        return this.bump(turn);
      }
      case 'turn.ended':
        if (!turn) return false;
        turn.endedAt = event.at;
        return this.bump(turn);
      case 'boundary.compaction':
        if (!turn) return false;
        turn.trailing.push({
          id: rowId.boundary(event.id), turnId: null, at: event.at, kind: 'boundary', boundaryKind: 'compaction', hiddenRows: 0, revealed: false,
          text: `Context compacted · ${Math.round(event.preTokens / 1000)}k → ${Math.round((event.postTokens ?? 0) / 1000)}k tokens · ${event.trigger}`, detail: null,
        });
        return this.bump(turn);
      default:
        return false;
    }
  }

  private open(event: Event<'turn.started'>): boolean {
    const previous = this.current();
    const id = event.userMessageUuid ? turnIdOf.ofMessage(event.userMessageUuid) : turnIdOf.ofEvent(event.id);
    const since = previous ? Date.parse(event.at) - Date.parse(previous.endedAt ?? previous.startedAt) : Infinity;
    const turn: Turn = {
      id, n: this.turns.length + 1, startedAt: event.at, endedAt: null, user: null, work: [], trailing: [], cells: new Map(), subagents: new Map(),
      files: [], toolCalls: 0, denied: 0, version: 0, memo: null,
      time: since >= HOUR ? { id: rowId.time(id), turnId: id, at: event.at, kind: 'time', label: new Date(event.at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } : null,
    };
    this.turns.push(turn);
    this.byId.set(id, turn);
    return true;
  }

  private delta(turn: Turn, event: Event<'assistant.block.delta'>): boolean {
    if (event.apiMessageId === null || (event.blockType !== 'text' && event.blockType !== 'thinking')) return false;
    const identity = `${event.apiMessageId}:${event.blockIndex}`;
    const piece = event.textDelta ?? event.thinkingDelta ?? '';
    const existing = this.liveRows.get(identity);
    if (existing) {
      const entry = this.live.get(existing)!;
      entry.text += piece;
      for (const listener of entry.listeners) listener();
      return false;
    }
    const row = this.blockRow(turn, event.apiMessageId, event.blockIndex, event.blockType, '', true, event.at);
    this.liveRows.set(identity, row.id);
    this.live.set(row.id, { text: piece, listeners: new Set() });
    turn.work.push(row);
    return this.bump(turn);
  }

  private complete(turn: Turn, event: Event<'assistant.block.complete'>): boolean {
    const type = event.block.type;
    if (type !== 'text' && type !== 'thinking') return false;
    const text = blockText(event.block);
    const identity = `${event.apiMessageId}:${event.blockIndex}`;
    const row = this.blockRow(turn, event.apiMessageId, event.blockIndex, type, text, false, event.at);
    const liveId = this.liveRows.get(identity);
    if (liveId) {
      this.liveRows.delete(identity);
      this.live.delete(liveId);
      const previous = turn.work.find((r) => r.id === liveId)!;
      this.replaceWork(turn, previous, { ...row, at: previous.at });
    } else turn.work.push(row);
    return this.bump(turn);
  }

  private blockRow(turn: Turn, api: ApiMessageId, index: number, type: 'text' | 'thinking', text: string, live: boolean, at: string): Row {
    return type === 'thinking'
      ? { id: rowId.think(api, index), turnId: turn.id, at, kind: 'thinking', messageUuid: null, text, live, durationMs: null }
      : { id: rowId.text(api, index), turnId: turn.id, at, kind: 'assistant_text', messageUuid: null, blockIndex: index, markdown: text, live, phase: 'commentary', model: null };
  }

  private toolUse(turn: Turn, event: Event<'tool.use'>): boolean {
    if (event.toolName === 'Agent' || event.toolName === 'Task') return false; // the lifecycle is the subagent row
    const category = categoryOf(event.toolName);
    const input = event.input as Record<string, unknown>;
    const subject = String(input.command ?? input.file_path ?? input.pattern ?? input.query ?? input.url ?? input.skill ?? '');
    const cell: Cell = {
      id: cellId.tool(event.toolUseId), toolUseId: event.toolUseId, toolName: event.toolName, category, status: 'running',
      label: `${event.toolName} ${subject}`.trim(), paths: typeof input.file_path === 'string' ? [input.file_path] : [], startedAt: event.at, endedAt: null,
      detail: { kind: 'generic', input: event.input, result: '', structured: null, isError: false, spill: null, truncated: null }, expanded: false, agent: null,
      classification: { groupable: true, hidden: false, category, denial: null, subagentLifecycle: null, startsGroup: false, safeguard: 'not_evaluated', humanDecision: false },
    };
    let group = turn.work.at(-1);
    if (group?.kind !== 'group') {
      group = { id: rowId.group(cell.id), turnId: turn.id, at: event.at, kind: 'group', state: 'active', cells: [], summary: '', activeLabel: null, icon: category, expanded: false };
      turn.work.push(group);
    }
    const next: GroupRow = { ...group, cells: [...group.cells, cell] };
    this.replaceWork(turn, group, next);
    turn.toolCalls += 1;
    return this.bump(turn);
  }

  private toolResult(turn: Turn, event: Event<'tool.result'>): boolean {
    const slot = turn.cells.get(event.toolUseId);
    if (!slot) return false;
    const { group, index } = slot;
    const cell = group.cells[index];
    const output = typeof event.content === 'string' ? event.content : JSON.stringify(event.content);
    const updated: Cell = {
      ...cell, status: event.denial ? 'denied' : event.isError ? 'error' : 'done', endedAt: event.at,
      detail: { kind: 'generic', input: (cell.detail as { input: unknown }).input, result: output, structured: event.structured, isError: event.isError, spill: null, truncated: null },
    };
    if (event.denial) turn.denied += 1;
    const patch = (event.structured as { structuredPatch?: { lines: string[] }[]; filePath?: string } | null)?.structuredPatch;
    if (patch) {
      const lines = patch.flatMap((hunk) => hunk.lines);
      turn.files.push({
        path: String((event.structured as { filePath?: string }).filePath), change: 'update', cellId: cell.id,
        added: lines.filter((line) => line.startsWith('+')).length, removed: lines.filter((line) => line.startsWith('-')).length,
      });
    }
    this.replaceWork(turn, group, { ...group, cells: group.cells.map((c, i) => (i === index ? updated : c)) });
    return this.bump(turn);
  }

  // Child traffic updates its subagent row's line and renders nothing in the parent (X1, S-3).
  private applyChild(event: SessionEvent): boolean {
    const turn = this.current();
    const row = turn?.subagents.get(event.parentToolUseId as string);
    if (!turn || !row || event.kind !== 'tool.use') return false;
    this.replaceWork(turn, row, { ...row, status: 'working', sentence: `${row.agents[0].name} · ${event.toolName}` });
    return this.bump(turn);
  }

  private replaceWork(turn: Turn, previous: Row, next: Row) {
    const at = turn.work.indexOf(previous);
    turn.work[at] = next;
    if (next.kind === 'group') next.cells.forEach((cell, index) => turn.cells.set(cell.toolUseId!, { group: next, index }));
    if (next.kind === 'subagent') turn.subagents.set(next.agents[0].toolUseId!, next);
  }

  private bump(turn: Turn) {
    turn.version += 1;
    turn.memo = null;
    return true;
  }

  private rowsOfTurn(turn: Turn): Row[] {
    if (turn.memo) return turn.memo;
    const expanded = this.expanded(turn);
    const lastWork = turn.work.findLastIndex((row) => row.kind === 'group' || row.kind === 'subagent');
    const work = turn.work.slice(0, lastWork + 1);
    const answers = turn.work.slice(lastWork + 1).map((row) => (row.kind === 'assistant_text' ? { ...row, phase: 'answer' as const } : row));
    const workArea = [...work, ...answers.filter((row) => row.kind === 'thinking')].map((row) => this.withUi(row));
    const answerRows = answers.filter((row) => row.kind !== 'thinking');
    const receipt: Row[] = turn.files.length === 0 ? [] : [{
      id: rowId.receipt(turn.id), turnId: turn.id, at: turn.endedAt ?? turn.startedAt, kind: 'receipt', files: turn.files, state: 'applied', canUndo: true, canReapply: false,
      added: turn.files.reduce((sum, file) => sum + file.added, 0), removed: turn.files.reduce((sum, file) => sum + file.removed, 0),
    }];
    const divider: Row[] = workArea.length === 0 ? [] : [{
      id: rowId.divider(turn.id), turnId: turn.id, at: turn.startedAt, kind: 'divider', state: turn.endedAt ? 'completed' : 'working', origin: 'human',
      startedAt: turn.startedAt, endedAt: turn.endedAt, toolCalls: turn.toolCalls, denied: turn.denied, autoDenied: 0, firstDeniedCell: null, expanded, summary: this.summary(turn),
    }];
    const rows = [
      ...(turn.time ? [turn.time] : []),
      ...(turn.user ? [turn.user] : []),
      ...divider,
      ...(expanded ? workArea : []),
      ...answerRows,
      ...receipt,
      ...turn.trailing,
    ];
    turn.memo = rows;
    return rows;
  }

  private withUi(row: Row): Row {
    if (row.kind !== 'group') return row;
    const expanded = this.expandedGroups.has(row.id);
    const cells = row.cells.map((cell) => (this.expandedCells.has(cell.id) ? { ...cell, expanded: true } : cell));
    const done = row.cells.every((cell) => cell.endedAt !== null);
    return {
      ...row, expanded, cells, state: done ? 'completed' : 'active',
      summary: done ? `${row.cells.length} tool call${row.cells.length === 1 ? '' : 's'}` : `Running ${row.cells.at(-1)!.label}`,
    };
  }

  private summary(turn: Turn): TurnSummary {
    return {
      durationMs: turn.endedAt ? Date.parse(turn.endedAt) - Date.parse(turn.startedAt) : null, toolCalls: turn.toolCalls, byCategory: EMPTY_BY_CATEGORY,
      denials: [], autoDenied: 0, safeguard: { reviewed: 0, flagged: 0, notEvaluated: 0 }, costUsd: null, usage: null, model: null, childAgents: turn.subagents.size, terminalReason: null,
    };
  }

  dividerLabel(row: Extract<Row, { kind: 'divider' }>): string {
    const calls = row.toolCalls === 0 ? '' : ` · ${row.toolCalls} tool call${row.toolCalls === 1 ? '' : 's'}`;
    const denied = row.denied === 0 ? '' : ` · ${row.denied} denied`;
    return row.endedAt ? `Worked for ${duration(row.startedAt, row.endedAt)}${calls}${denied}` : `Working${calls}`;
  }
}
