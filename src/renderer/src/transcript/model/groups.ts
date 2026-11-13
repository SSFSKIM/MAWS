// The group state machine (C6 execution document, X3 "classification": `startsGroup`, flush on a standalone row,
// thinking cells inside groups, single-cell unwrap, an active group never unwraps; Copy "group"): the work-area items
// of one turn, in event order, folded into group rows, standalone cell rows and the rows between them. derive.ts
// walks a turn's events into these items and hands them here. UX wave U2 (O-29; the U2a document, decision 18):
// a run's caption is caption.ts's, and a waiting request's slot is no boundary of a run.
import { captionParts, captionText, finishedLines, stepsOfCells } from './caption';
import { thinkingCell } from './cells';
import { rowId } from './keys';
import type { TranscriptUi, TurnState } from './reduce';
import { TOOL_CATEGORIES, type Cell, type Row, type ToolCategory, type TurnId } from './rows';

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
  const thinkingRow = (cell: Cell): Row => thinkingRows.get(cell.id)!;
  const flush = (active: boolean) => {
    if (!open) return;
    const cells = open;
    open = null;
    const wasTool = hasTool;
    hasTool = false;
    const slots = carried;
    carried = [];
    if (!wasTool) {
      for (const cell of cells) rows.push(thinkingRow(cell));
      return;
    }
    const calls = cells.filter((cell) => cell.toolName !== 'thinking');
    if (!active && calls.length === 1) {
      for (const cell of cells) if (cell.toolName === 'thinking') rows.push(thinkingRow(cell));
      rows.push(standaloneRow(calls[0], turn.id));
    } else {
      const id = rowId.group(cells[0].id);
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
