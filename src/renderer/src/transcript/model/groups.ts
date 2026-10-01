// The group state machine (C6 execution document, X3 "classification": `startsGroup`, flush on a standalone row,
// thinking cells inside groups, single-cell unwrap, an active group never unwraps; Copy "group"): the work-area items
// of one turn, in event order, folded into group rows, standalone cell rows and the rows between them. derive.ts
// walks a turn's events into these items and hands them here.
import type { ToolUseId } from '@shared/graph/ids';
import { mergeReads, MERGEABLE_READS, thinkingCell, type ToolRecord } from './cells';
import { activeGroupLabel, groupSummary, hostOf, type GroupPhraseInput } from './copy';
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

export function groupItems(items: WorkItem[], turn: TurnState, ui: TranscriptUi | undefined, tools: Map<ToolUseId, ToolRecord>): Row[] {
  const rows: Row[] = [];
  let open: Cell[] | null = null;
  let hasTool = false;
  const lastAt = turn.events.at(-1)?.at ?? turn.startedAt;
  // Thinking blocks travel through the machine as cells (`cell:think:…`) and come back out as rows when their group
  // never gets a tool cell or unwraps.
  const thinkingRows = new Map<string, RowOf<'thinking'>>();
  const thinkingRow = (cell: Cell): Row => thinkingRows.get(cell.id)!;
  const elapsedOf = (cell: Cell): number => {
    const rec = cell.toolUseId ? tools.get(cell.toolUseId) : undefined;
    return Math.max((rec?.elapsedSeconds ?? 0) * 1000, Date.parse(lastAt) - Date.parse(cell.startedAt));
  };
  const flush = (active: boolean) => {
    if (!open) return;
    const cells = open;
    open = null;
    const wasTool = hasTool;
    hasTool = false;
    if (!wasTool) {
      for (const cell of cells) rows.push(thinkingRow(cell));
      return;
    }
    const visible = cells.filter((cell) => cell.toolName !== 'thinking' && !cell.classification.hidden);
    const hidden = cells.filter((cell) => cell.toolName !== 'thinking' && cell.classification.hidden);
    if (!active && visible.length === 1 && hidden.length === 0) {
      for (const cell of cells) if (cell.toolName === 'thinking') rows.push(thinkingRow(cell));
      rows.push(standaloneRow(visible[0], turn.id));
      return;
    }
    const id = rowId.group(cells[0].id);
    const running = cells.find((cell) => cell.status === 'running' && cell.toolName !== 'thinking');
    rows.push({
      id, turnId: turn.id, at: cells[0].startedAt, kind: 'group', state: active ? 'active' : 'completed', cells, summary: groupSummary(phrasesOf(cells)),
      activeLabel: active ? activeGroupLabel(running ? { toolName: running.toolName, input: tools.get(running.toolUseId!)?.use.input ?? {}, elapsedMs: elapsedOf(running) } : null) : null,
      icon: iconOf(cells), expanded: ui?.expandedGroups.has(id) ?? false,
    });
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
      const last = open.at(-1);
      if (!hasTool) cell.classification = { ...cell.classification, startsGroup: true };
      hasTool = true;
      if (last && MERGEABLE_READS.has(last.toolName) && MERGEABLE_READS.has(cell.toolName) && last.status !== 'running') {
        const merged = mergeReads(last, cell); // a new id (`cell:reads:…`), so its expansion is read under that id
        open[open.length - 1] = { ...merged, expanded: ui?.expandedCells.has(merged.id) ?? false };
      } else open.push(cell);
      continue;
    }
    if (item.kind === 'thinking') {
      const id = `cell:${item.row.id}`;
      thinkingRows.set(id, item.row);
      if (!open) open = [];
      open.push(thinkingCell(id, item.row.text, item.row.live, item.row.at, item.row.durationMs, ui?.expandedCells.has(id) ?? false));
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

export function phrasesOf(cells: Cell[]): GroupPhraseInput {
  const input: GroupPhraseInput = { mcpServers: [], skills: [], toolsLoaded: 0, editedFiles: [], readFiles: [], searches: [], commands: [], webQueries: [], fetchedHosts: [], other: 0 };
  for (const cell of cells) {
    if (cell.toolName === 'thinking' || cell.classification.hidden) continue;
    const detail = cell.detail;
    if (detail.kind === 'mcp') input.mcpServers.push(detail.server);
    else if (cell.toolName === 'Skill') input.skills.push(cell.label.replace(/^Loaded (.*) skill$/, '$1'));
    else if (cell.toolName === 'ToolSearch') input.toolsLoaded += Number(/(\d+)/.exec(cell.label)?.[1] ?? 0);
    else if (detail.kind === 'edit') input.editedFiles.push(detail.filePath);
    else if (detail.kind === 'read') input.readFiles.push(...detail.files.map((file) => file.path));
    else if (detail.kind === 'search') input.searches.push(detail.query);
    else if (detail.kind === 'shell') input.commands.push(detail.command);
    else if (detail.kind === 'web') {
      if (detail.url) input.fetchedHosts.push(hostOf(detail.url));
      else if (detail.query) input.webQueries.push(detail.query);
    } else input.other += 1;
  }
  return input;
}

export const iconOf = (cells: Cell[]): ToolCategory => {
  const present = new Set(cells.filter((cell) => cell.toolName !== 'thinking').map((cell) => cell.category));
  return TOOL_CATEGORIES.find((category) => present.has(category)) ?? 'other';
};

export const collectCells = (rows: Row[]): Cell[] => rows.flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []));
