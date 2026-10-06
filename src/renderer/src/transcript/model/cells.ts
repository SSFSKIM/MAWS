// Tool records → X3 cells (C6 execution document, "X3 — rows, cells and detail"): the detail variant per tool, the
// status, the label from the copy table and the classification with its overrides. derive.ts collects the records
// while walking a turn's events and folds the cells into groups.
import type { SafeguardVerdict } from '@shared/graph/enums';
import type { ContentBlock, SessionEvent } from '@shared/graph/events';
import type { TaskId, ToolUseId } from '@shared/graph/ids';
import { ShowPaneResultSchema } from '@shared/maws/tools'; // E1
import { ArtifactListResultSchema, ArtifactScreenshotResultSchema } from '@shared/maws/tools'; // E2
import { classifyTool, MAWS_TOOL_USE, MCP_TOOL, tableRowOf, type ClassifyContext } from './classify';
import { baseName, cellLabel, hostOf, PANE_CELL, thinkingLabel } from './copy';
import { ARTIFACT_CELL } from './copy'; // E2
import { cellId } from './keys';
import type { Cell, CellDetail, ChangedFile, Hunk, Spill, ToolCategory, Truncation } from './rows';

type Event<K extends SessionEvent['kind']> = Extract<SessionEvent, { kind: K }>;

export interface ToolRecord {
  use: Event<'tool.use'>;
  result: Event<'tool.result'> | null;
  safeguard: SafeguardVerdict;
  elapsedSeconds: number;
  humanDecision: boolean;
  backgroundTaskId: TaskId | null;
  backgroundDone: boolean;
}

export interface TurnContext {
  closed: boolean;
  terminalReason: string | null;
  lastAt: string; // the turn's latest event time, for running durations
}

export const TRUNCATE_OVER = 64 * 1024;
const SHOWN_HEAD = 32 * 1024;
const SHOWN_TAIL = 16 * 1024;

export const truncationOf = (text: string): Truncation | null =>
  text.length > TRUNCATE_OVER ? { shownHead: SHOWN_HEAD, shownTail: SHOWN_TAIL, omittedBytes: text.length - SHOWN_HEAD - SHOWN_TAIL } : null;

// The same bound for output made of parts (MCP result blocks, diff lines), which render whole: past the cap, the parts
// that fit the head budget (the first always) and those that fit the tail budget from the end (the last always), the
// rest omitted between them. `head` and `tail` count parts; null when everything fits.
export function partsTruncationOf(sizes: readonly number[]): { head: number; tail: number } | null {
  if (sizes.reduce((total, size) => total + size, 0) <= TRUNCATE_OVER) return null;
  let head = 0;
  for (let used = 0; head < sizes.length && (head === 0 || used + sizes[head] <= SHOWN_HEAD); head += 1) used += sizes[head];
  let tail = 0;
  for (let used = 0; head + tail < sizes.length && (tail === 0 || used + sizes[sizes.length - 1 - tail] <= SHOWN_TAIL); tail += 1) used += sizes[sizes.length - 1 - tail];
  return { head, tail };
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);

// The text of a result: a string, or the text blocks of a block list joined.
export function resultText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content.filter((block) => block.type === 'text').map((block) => str(block.text)).join('\n');
}

// E1 start: a result's text as JSON (a `maws` tool answers with its result pretty-printed), null when it is not JSON;
// the engine's own refusal of a call before it ran (`<tool_use_error>…</tool_use_error>`, its validation errors), the
// inner text, null for any other text; and an error result's text as a row shows it, the refusal's tags stripped.
export function resultJson(content: string | ContentBlock[]): unknown {
  try {
    return JSON.parse(resultText(content));
  } catch {
    return null;
  }
}
const TOOL_USE_ERROR = /^\s*<tool_use_error>([\s\S]*)<\/tool_use_error>\s*$/;
export const engineRefusalOf = (text: string): string | null => TOOL_USE_ERROR.exec(text)?.[1]!.trim() ?? null;
export const toolErrorText = (text: string): string => engineRefusalOf(text) ?? text.trim();
// E1 end

// E2 start (Design §9, Decision Log 23): a `maws` result's JSON from the first text block that parses as a JSON object,
// null when none does. Beside an image block the engine adds a text block of its own pointing at the saved original
// (M0: `[image, "[Image: source: …]", <server JSON>]`), which `resultJson`'s joined text would not parse.
export function firstJsonBlock(content: string | ContentBlock[]): unknown {
  const texts = typeof content === 'string' ? [content] : content.filter((block) => block.type === 'text').map((block) => str(block.text));
  for (const text of texts) {
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value;
    } catch {
      // not JSON: the next block
    }
  }
  return null;
}
// E2 end

const imageBlocks = (content: string | ContentBlock[]) => (typeof content === 'string' ? [] : content.filter((block) => block.type === 'image'));

export function isImageResult(result: Event<'tool.result'> | null): boolean {
  if (!result) return false;
  return imageBlocks(result.content).length > 0 || record(result.structured).isImage === true;
}

// A spilled result: its size when the engine reported it (Bash's `persistedOutputSize`, in bytes), unloaded until the
// reader asks (the store folds the load state in; derive.ts).
function spillOf(result: Event<'tool.result'> | null): Spill | null {
  if (!result?.spillPath) return null;
  const size = record(result.structured).persistedOutputSize;
  return { path: result.spillPath, bytes: typeof size === 'number' && Number.isSafeInteger(size) && size > 0 ? size : null, state: 'not_loaded', content: null };
}

const EXIT_CODE = /[Ee]xit code:? (\d+)/;

// `structuredPatch` hunks as the engine emits them; `+`/`-` line counts fall back to the input strings.
function hunksOf(structured: unknown): Hunk[] {
  const patch = record(structured).structuredPatch;
  if (!Array.isArray(patch)) return [];
  return patch.map((hunk) => {
    const h = record(hunk);
    return { oldStart: num(h.oldStart) ?? 0, oldLines: num(h.oldLines) ?? 0, newStart: num(h.newStart) ?? 0, newLines: num(h.newLines) ?? 0, lines: Array.isArray(h.lines) ? h.lines.map((line) => str(line)) : [] };
  });
}

const lineCount = (text: string) => (text.length === 0 ? 0 : text.split('\n').length);

export function editCounts(toolName: string, input: Record<string, unknown>, structured: unknown): { hunks: Hunk[]; added: number; removed: number; change: ChangedFile['change'] } {
  const hunks = hunksOf(structured);
  let added = 0;
  let removed = 0;
  if (hunks.length > 0) {
    for (const hunk of hunks) for (const line of hunk.lines) {
      if (line.startsWith('+')) added += 1;
      else if (line.startsWith('-')) removed += 1;
    }
  } else if (toolName === 'Write') {
    added = lineCount(str(input.content));
  } else if (toolName === 'MultiEdit' && Array.isArray(input.edits)) {
    for (const edit of input.edits) {
      added += lineCount(str(record(edit).new_string));
      removed += lineCount(str(record(edit).old_string));
    }
  } else {
    added = lineCount(str(input.new_string));
    removed = lineCount(str(input.old_string));
  }
  const type = record(structured).type;
  const change: ChangedFile['change'] = toolName === 'Write' && (type === 'create' || record(structured).originalFile === null) ? 'create' : type === 'delete' ? 'delete' : 'update';
  return { hunks, added, removed, change };
}

export const filePathOf = (input: Record<string, unknown>) => str(input.file_path, str(input.notebook_path, str(input.path)));

function readRange(input: Record<string, unknown>): [number, number] | null {
  const offset = num(input.offset);
  const limit = num(input.limit);
  if (offset === null && limit === null) return null;
  const start = offset ?? 1;
  return [start, limit === null ? start : start + limit - 1];
}

function detailOf(rec: ToolRecord, status: Cell['status']): CellDetail {
  const { use, result } = rec;
  const input = record(use.input);
  const structured = result?.structured ?? null;
  const s = record(structured);
  const text = result ? resultText(result.content) : '';
  if (isImageResult(result)) {
    const images = imageBlocks(result!.content).map((block) => {
      const source = record(block.source);
      const mediaType = str(source.media_type, 'image/*');
      return { dataUrl: `data:${mediaType};base64,${str(source.data)}`, mediaType, alt: null };
    });
    return { kind: 'image', images, caption: filePathOf(input) || null };
  }
  const mcp = MCP_TOOL.exec(use.toolName);
  if (mcp) return { kind: 'mcp', server: mcp[1], tool: mcp[2], input: use.input, result: result?.content ?? '', structured, spill: spillOf(result) };
  switch (use.toolName) {
    case 'Bash': case 'BashOutput': case 'KillShell': case 'Monitor': {
      const stdout = typeof s.stdout === 'string' ? s.stdout : text;
      const stderr = str(s.stderr);
      const parsed = EXIT_CODE.exec(text);
      const exitCode = parsed ? Number(parsed[1]) : status === 'done' ? 0 : null;
      return {
        kind: 'shell', command: str(input.command, use.toolName), description: typeof input.description === 'string' ? input.description : null, cwd: typeof input.cwd === 'string' ? input.cwd : null,
        stdout, stderr, exitCode, interrupted: s.interrupted === true, backgroundTaskId: rec.backgroundTaskId, truncated: truncationOf(stdout), spill: spillOf(result),
      };
    }
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': {
      const counts = editCounts(use.toolName, input, structured);
      return { kind: 'edit', filePath: str(s.filePath, filePathOf(input)), change: counts.change, hunks: counts.hunks, added: counts.added, removed: counts.removed };
    }
    case 'Read': case 'NotebookRead': case 'LS':
      return { kind: 'read', files: [{ path: filePathOf(input), range: readRange(input) }], preview: text || null, truncated: truncationOf(text) };
    case 'Grep': case 'Glob':
      return { kind: 'search', query: str(input.pattern), scope: typeof input.path === 'string' ? input.path : null, matches: null, output: text, truncated: truncationOf(text) };
    case 'WebFetch': case 'WebSearch':
      return { kind: 'web', url: typeof input.url === 'string' ? input.url : null, query: typeof input.query === 'string' ? input.query : null, output: text, truncated: truncationOf(text) };
    default:
      return { kind: 'generic', input: use.input, result: result?.content ?? '', structured, isError: result?.isError ?? false, spill: spillOf(result), truncated: truncationOf(text) };
  }
}

function statusOf(rec: ToolRecord, turn: TurnContext, disposition: 'denied' | 'auto_denied' | 'stopped' | null): Cell['status'] {
  if (disposition === 'stopped') return 'stopped';
  if (disposition !== null) return 'denied';
  if (!rec.result) return turn.closed ? 'stopped' : 'running';
  if (rec.backgroundTaskId !== null && !rec.backgroundDone && !turn.closed) return 'running';
  return rec.result.isError ? 'error' : 'done';
}

const elapsedMs = (rec: ToolRecord, turn: TurnContext) =>
  rec.result ? Date.parse(rec.result.at) - Date.parse(rec.use.at) : Math.max(rec.elapsedSeconds * 1000, Date.parse(turn.lastAt) - Date.parse(rec.use.at));

function labelOf(rec: ToolRecord, detail: CellDetail, status: Cell['status'], category: ToolCategory, classification: Cell['classification'], turn: TurnContext): string {
  const input = record(rec.use.input);
  if (classification.denial) {
    const subject = detail.kind === 'shell' ? detail.command : detail.kind === 'edit' ? detail.filePath : rec.use.toolName;
    return cellLabel({ kind: 'denied', subject, disposition: classification.denial.disposition, denialKind: classification.denial.kind, reason: classification.denial.reason });
  }
  if (rec.use.toolName === MAWS_TOOL_USE.show_pane) return paneLabel(rec); // E1
  if (rec.use.toolName === MAWS_TOOL_USE.artifact_list) return artifactListLabel(rec); // E2
  if (rec.use.toolName === MAWS_TOOL_USE.artifact_screenshot) return screenshotLabel(rec); // E2
  switch (detail.kind) {
    case 'shell':
      return cellLabel({ kind: 'shell', command: detail.command, status: status === 'denied' ? 'stopped' : status, durationMs: elapsedMs(rec, turn), background: detail.backgroundTaskId !== null && status === 'running' });
    case 'edit':
      return cellLabel({ kind: 'edit', path: detail.filePath, change: detail.change, added: detail.added, removed: detail.removed });
    case 'read':
      return cellLabel({ kind: 'read', paths: detail.files.map((file) => file.path) });
    case 'search':
      return cellLabel({ kind: 'generic', toolName: rec.use.toolName, category, detail: detail.query, scope: detail.scope });
    case 'web':
      return cellLabel({ kind: 'generic', toolName: rec.use.toolName, category, detail: rec.use.toolName === 'WebFetch' ? hostOf(detail.url ?? '') : detail.query });
    default: {
      const s = record(rec.result?.structured);
      const detailText =
        rec.use.toolName === 'Skill' ? (typeof input.skill === 'string' ? input.skill : null)
        : rec.use.toolName === 'ToolSearch' ? String(Array.isArray(s.matches) ? s.matches.length : 0)
        : rec.use.toolName === 'EnterWorktree' ? str(s.path, str(input.path)) || null
        : null;
      return cellLabel({ kind: 'generic', toolName: rec.use.toolName, category, detail: detailText });
    }
  }
}

// E1: a `show_pane` call reads what it opened (a panel tool's title, a main tab's file name) from its result, or the
// host's refusal without the tool's own prefix.
function paneLabel(rec: ToolRecord): string {
  const { result } = rec;
  const pane = str(record(rec.use.input).pane, 'requested');
  if (!result) return PANE_CELL.opening(pane);
  if (result.isError) return PANE_CELL.failed(toolErrorText(resultText(result.content)).replace(/^show_pane: /, ''));
  const parsed = ShowPaneResultSchema.safeParse(resultJson(result.content));
  if (!parsed.success) return PANE_CELL.opened(pane);
  const { opened } = parsed.data;
  return PANE_CELL.opened(opened.kind === 'panel-tool' ? opened.title : baseName(opened.path));
}

// E2 start: an `artifact_list` call reads how many artifacts it listed, an `artifact_screenshot` call what it captured
// (the result's title, version and size), or the host's refusal without the tool's own prefix.
function artifactListLabel(rec: ToolRecord): string {
  const { result } = rec;
  if (!result) return ARTIFACT_CELL.listing;
  if (result.isError) return ARTIFACT_CELL.listFailed(toolErrorText(resultText(result.content)).replace(/^artifact_list: /, ''));
  const parsed = ArtifactListResultSchema.safeParse(firstJsonBlock(result.content));
  return ARTIFACT_CELL.listed(parsed.success ? parsed.data.artifacts.length : null);
}

function screenshotLabel(rec: ToolRecord): string {
  const { result } = rec;
  const id = str(record(rec.use.input).id);
  if (!result) return ARTIFACT_CELL.screenshotting(id);
  if (result.isError) return ARTIFACT_CELL.screenshotFailed(toolErrorText(resultText(result.content)).replace(/^artifact_screenshot: /, ''));
  const parsed = ArtifactScreenshotResultSchema.safeParse(firstJsonBlock(result.content));
  return ARTIFACT_CELL.screenshot(parsed.success ? parsed.data : null, id);
}
// E2 end

// Draw-time rewrites may override status, before deriving both detail and label. Model callers omit it.
export function cellOf(rec: ToolRecord, turn: TurnContext, expanded: boolean, displayStatus?: Cell['status']): Cell {
  const { use, result } = rec;
  const denial = result?.denial ? { kind: result.denial, reason: resultText(result.content).trim() || null } : null;
  const context: ClassifyContext = {
    denial, terminalReason: turn.terminalReason, turnClosed: turn.closed, humanDecision: rec.humanDecision,
    safeguard: result && result.safeguard !== 'not_evaluated' ? result.safeguard : rec.safeguard, imageResult: isImageResult(result), isError: result?.isError ?? false,
  };
  const classification = classifyTool(use.toolName, use.input, context);
  const recordedStatus = statusOf(rec, turn, classification.denial?.disposition ?? null);
  const status = displayStatus ?? recordedStatus;
  const labelClassification = status === recordedStatus ? classification : { ...classification, denial: null };
  const detail = detailOf(rec, status);
  const category = tableRowOf(use.toolName).category;
  const paths = detail.kind === 'read' ? detail.files.map((file) => file.path) : detail.kind === 'edit' ? [detail.filePath] : [];
  return {
    id: cellId.tool(use.toolUseId), toolUseId: use.toolUseId, toolName: use.toolName, category, classification, status,
    label: labelOf(rec, detail, status, category, labelClassification, turn), paths, startedAt: use.at, endedAt: result?.at ?? null, detail, expanded, agent: null,
  };
}

// Consecutive read cells merge into one: every path, the first cell's id under the `cell:reads:` prefix.
export const MERGEABLE_READS = new Set(['Read', 'NotebookRead', 'LS']);

export function mergeReads(into: Cell, next: Cell): Cell {
  const a = into.detail.kind === 'read' ? into.detail : null;
  const b = next.detail.kind === 'read' ? next.detail : null;
  if (!a || !b) return into;
  const files = [...a.files, ...b.files];
  const merged: Cell = {
    ...into, id: into.id.startsWith('cell:reads:') ? into.id : cellId.reads(into.toolUseId as ToolUseId), paths: files.map((file) => file.path),
    detail: { kind: 'read', files, preview: [a.preview, b.preview].filter((p) => p !== null).join('\n') || null, truncated: null },
    status: into.status === 'error' || next.status === 'error' ? 'error' : next.status === 'running' ? 'running' : into.status, endedAt: next.endedAt ?? into.endedAt,
  };
  merged.detail = { ...merged.detail, truncated: merged.detail.kind === 'read' ? truncationOf(merged.detail.preview ?? '') : null } as CellDetail;
  merged.label = cellLabel({ kind: 'read', paths: merged.paths });
  return merged;
}

export function thinkingCell(id: string, text: string, live: boolean, at: string, durationMs: number | null, expanded: boolean): Cell {
  const classification = classifyTool('thinking', null, { denial: null, terminalReason: null, turnClosed: false, humanDecision: false, safeguard: 'not_evaluated', imageResult: false, isError: false });
  return {
    id: id as Cell['id'], toolUseId: null, toolName: 'thinking', category: 'other', classification: { ...classification, hidden: true }, status: live ? 'running' : 'done',
    label: thinkingLabel(live, durationMs), paths: [], startedAt: at, endedAt: live ? null : at, detail: { kind: 'thinking', text, durationMs }, expanded, agent: null,
  };
}
