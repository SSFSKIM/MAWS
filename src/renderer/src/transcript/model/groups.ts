// The group state machine (C6 execution document, X3 "classification": `startsGroup`, flush on a standalone row,
// thinking cells inside groups, single-cell unwrap, an active group never unwraps; Copy "group"): the work-area items
// of one turn, in event order, folded into group rows, standalone cell rows and the rows between them. derive.ts
// walks a turn's events into these items and hands them here. UX wave U2 (O-29; the U2a document, decision 18):
// a run's caption is caption.ts's, and a waiting request's slot is no boundary of a run. UX wave U2 (O-27, ticket 479;
// decisions 4 and 19, Interfaces §C): a run's row id is made from its first call, every thought enters the machine,
// and what an opened run draws (`runSegments`) and what its one line reads (`runLine`) are read from its cells here.
import type { AttentionItem } from '@shared/graph/attention';
import type { ToolUseId } from '@shared/graph/ids';
import { captionParts, captionText, finishedLines, stepsOfCells } from './caption';
import { thinkingCell } from './cells';
import { rowId } from './keys';
import type { TranscriptUi, TurnState } from './reduce';
import { TOOL_CATEGORIES, type Cell, type CellId, type Row, type ToolCategory, type TurnId } from './rows';

type RowOf<K extends Row['kind']> = Extract<Row, { kind: K }>;

// A work-area item once the turn's placeholders are resolved: text and thinking rows, tool cells, and rows
// of other kinds (subagent, agent message, plan, question, slot, boundary, error, bash, local command).
export type WorkItem =
  | { kind: 'text'; row: RowOf<'assistant_text'> }
  | { kind: 'thinking'; row: RowOf<'thinking'> }
  | { kind: 'cell'; cell: Cell }
  | { kind: 'row'; row: Row };

export function groupItems(items: WorkItem[], turn: TurnState, ui: TranscriptUi | undefined): Row[] {
  const rows: Row[] = [];
  let open: Cell[] | null = null;
  let hasTool = false;
  // UX wave U2 (decision 18): the slots of waiting requests that arrived while a run was open, emitted directly after
  // that run's row in arrival order, whenever the row is made
  let carried: Row[] = [];
  // Thinking blocks travel through the machine as cells (`cell:think:…`) and come back out as rows when their group
  // never gets a tool cell or unwraps.
  const thinkingRows = new Map<string, RowOf<'thinking'>>();
  // A thought that leaves the machine as a row (a group with no call; the single-call unwrap) is dropped there when it
  // finished with no text (W1: nothing to disclose), so a textless thought has a line only inside a run (ticket 479)
  const thoughtRow = (cell: Cell): Row[] => {
    const row = thinkingRows.get(cell.id)!;
    return row.live || row.text.trim() !== '' ? [row] : [];
  };
  const flush = (active: boolean) => {
    if (!open) return;
    const cells = open;
    open = null;
    const wasTool = hasTool;
    hasTool = false;
    const slots = carried;
    carried = [];
    if (!wasTool) {
      for (const cell of cells) rows.push(...thoughtRow(cell));
      return;
    }
    const calls = cells.filter((cell) => cell.toolName !== 'thinking');
    if (!active && calls.length === 1) {
      // decision 19: the call and its thoughts in event order
      for (const cell of cells) rows.push(...(cell.toolName === 'thinking' ? thoughtRow(cell) : [standaloneRow(cell, turn.id)]));
    } else {
      // decision 4: the run's id is its first call's, whatever thoughts lead it (a textless one travels on one host only)
      const id = rowId.group(calls[0].id);
      rows.push({
        id, turnId: turn.id, at: cells[0].startedAt, kind: 'group', state: active ? 'active' : 'completed', cells, summary: captionText(captionParts(stepsOfCells(cells)), true),
        counts: finishedLines(cells), icon: iconOf(cells), expanded: ui?.expandedGroups.has(id) ?? false,
      });
    }
    rows.push(...slots);
  };
  for (const item of items) {
    if (item.kind === 'cell') {
      const cell = item.cell;
      if (cell.toolName === 'thinking') {
        if (!open) open = [];
        open.push(cell);
        continue;
      }
      if (!cell.classification.groupable) {
        flush(false);
        rows.push(standaloneRow(cell, turn.id));
        continue;
      }
      if (!open) open = [];
      if (!hasTool) cell.classification = { ...cell.classification, startsGroup: true };
      hasTool = true;
      open.push(cell); // each call keeps its own input/output disclosure and stable tool-use identity
      continue;
    }
    if (item.kind === 'thinking') {
      const id = `cell:${item.row.id}`;
      thinkingRows.set(id, item.row);
      if (!open) open = [];
      open.push(thinkingCell(id, item.row.text, item.row.live, item.row.at, item.row.durationMs, item.row.recordedMs, ui?.expandedCells.has(id) ?? false));
      continue;
    }
    if (item.kind === 'row' && item.row.kind === 'request_slot' && open !== null && hasTool) {
      carried.push(item.row);
      continue;
    }
    flush(false);
    if (item.kind === 'text' || item.kind === 'row') rows.push(item.row);
  }
  flush(turn.state === 'open');
  return rows;
}

// A standalone cell is a flat `cell` row keyed by its CellId (X3).
const standaloneRow = (cell: Cell, turnId: TurnId): Row => ({ ...cell, id: rowId.cell(cell.id), turnId, at: cell.startedAt, kind: 'cell', classification: { ...cell.classification, startsGroup: false } });

export const iconOf = (cells: Cell[]): ToolCategory => {
  const present = new Set(cells.filter((cell) => cell.toolName !== 'thinking').map((cell) => cell.category));
  return TOOL_CATEGORIES.find((category) => present.has(category)) ?? 'other';
};

export const collectCells = (rows: Row[]): Cell[] => rows.flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []));

// UX wave U2 start (O-27, ticket 479, O-29; the U2a document, Interfaces §C)
// What an opened run draws: blocks of calls, and between them, or under the last, a thought of ten seconds or more by
// the engine's recorded duration (the owner's rule; a measured duration is never read here) or the thought streaming now.
export const THOUGHT_LINE_MS = 10_000;
export type RunSegment =
  | { kind: 'calls'; cells: Cell[] }
  | { kind: 'thought'; id: CellId; at: string; text: string; recordedMs: number | null; live: { block: string; at: string } | null };

const THINK_CELL = 'cell:think:';
const textOf = (cell: Cell) => (cell.detail.kind === 'thinking' ? cell.detail.text : '');
const recordedOf = (cell: Cell) => (cell.detail.kind === 'thinking' ? cell.detail.recordedMs : null);

// A merged thought's text: its members' texts in order, a blank line between, a member with none adding nothing.
export const joinThoughts = (texts: readonly string[]): string => texts.filter((text) => text.trim() !== '').join('\n\n');

// (1) Thoughts with no call between them are one: their recorded durations summed (null when none has one), their
// texts joined, the first member's id and start. (2) One whose last member still streams in an active run is live and
// kept: `live` is that member's block identity (`<apiMessageId>:<blockIndex>`, the turn's live-block key) and start, and
// its `text` the finished members' (the view adds the streaming member's buffer after it). (3) Every other is kept only
// at ten seconds or more. (4) The calls between kept thoughts are one block each. No two thoughts are adjacent, by (1).
export function runSegments(cells: readonly Cell[], active: boolean): RunSegment[] {
  const segments: RunSegment[] = [];
  let calls: Cell[] = [];
  let thought: Cell[] = [];
  const endThought = () => {
    if (thought.length === 0) return;
    const members = thought;
    thought = [];
    const last = members.at(-1)!;
    const streaming = active && last.status === 'running';
    const times = members.map(recordedOf).filter((ms): ms is number => ms !== null);
    const recordedMs = times.length === 0 ? null : times.reduce((sum, ms) => sum + ms, 0);
    if (!streaming && (recordedMs === null || recordedMs < THOUGHT_LINE_MS)) return;
    if (calls.length > 0) segments.push({ kind: 'calls', cells: calls });
    calls = [];
    const settled = streaming ? members.slice(0, -1) : members;
    segments.push({
      kind: 'thought', id: members[0].id, at: members[0].startedAt, text: joinThoughts(settled.map(textOf)), recordedMs,
      live: streaming ? { block: last.id.startsWith(THINK_CELL) ? last.id.slice(THINK_CELL.length) : last.id, at: last.startedAt } : null,
    });
  };
  for (const cell of cells) {
    if (cell.toolName === 'thinking') {
      thought.push(cell);
      continue;
    }
    endThought();
    calls.push(cell);
  }
  endThought();
  if (calls.length > 0) segments.push({ kind: 'calls', cells: calls });
  return segments;
}

// What a run's one line reads, in this order: the call that waits for the person's permission (the request created
// first when several wait; call order between equals); else, while a permission that names no call of the turn holds
// it (`held`), the caption, so a held call never reads as running; else the foreground call that started last of those
// still running; else the caption. A call in the background (`background`: it has its result and still runs) never
// takes the line.
export type RunLine = { kind: 'waiting'; cell: Cell; item: AttentionItem } | { kind: 'running'; cell: Cell } | { kind: 'caption' };
export function runLine(cells: readonly Cell[], waiting: ReadonlyMap<ToolUseId, AttentionItem>, held: boolean): RunLine {
  let wait: { cell: Cell; item: AttentionItem } | null = null;
  for (const cell of cells) {
    const item = cell.toolUseId === null ? undefined : waiting.get(cell.toolUseId);
    if (item?.kind !== 'permission') continue;
    if (wait === null || Date.parse(item.createdAt) < Date.parse(wait.item.createdAt)) wait = { cell, item };
  }
  if (wait !== null) return { kind: 'waiting', ...wait };
  const foreground = cells.filter((cell) => cell.toolUseId !== null && !cell.background && cell.status === 'running');
  if (held || foreground.length === 0) return { kind: 'caption' };
  let latest = foreground[0];
  for (const cell of foreground) if (Date.parse(cell.startedAt) >= Date.parse(latest.startedAt)) latest = cell;
  return { kind: 'running', cell: latest };
}

// Decision 21: a waiting permission that names no call of the turn (`turnCalls`: every tool use of the run's turn, a cell
// or not) and no agent (a subagent's own request is keyed by its own call and must not silence its parent's) holds the
// turn's running calls: they are not running, they wait on that request, whose card is its only sign.
export function heldByPermission(waiting: ReadonlyMap<ToolUseId, AttentionItem>, turnCalls: ReadonlySet<ToolUseId>): boolean {
  for (const [call, item] of waiting) if (item.kind === 'permission' && !turnCalls.has(call) && item.request.agentId === null) return true;
  return false;
}
// UX wave U2 end
