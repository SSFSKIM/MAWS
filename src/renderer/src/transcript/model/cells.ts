// Tool records → X3 cells (C6 execution document, "X3 — rows, cells and detail"): the detail variant per tool, the
// status, the label from the copy table and the classification with its overrides. derive.ts collects the records
// while walking a turn's events and folds the cells into groups.
import type { SafeguardVerdict } from '@shared/graph/enums';
import type { ContentBlock, SessionEvent } from '@shared/graph/events';
import type { TaskId, ToolUseId } from '@shared/graph/ids';
import { MAWS_SERVER_NAME, ShowPaneResultSchema } from '@shared/maws/tools'; // E1
import { ArtifactScreenshotResultSchema } from '@shared/maws/tools'; // E2
import * as z from 'zod'; // P3-A
import { classifyTool, continuedAfter, HISTORICAL_ARTIFACT_UPDATE_TOOL_USE, isAbortedReason, MAWS_TOOL_USE, MCP_TOOL, stoppedMember, tableRowOf, type ClassifyContext } from './classify';
import { baseName, cellLabel, descriptionLabel, hostOf, PANE_CELL, SHELL_CELL, stoppedLabel, thinkingLabel } from './copy';
import { ARTIFACT_CELL } from './copy'; // E2
import { ARTIFACT_TITLE, type ArtifactCallWords } from './copy'; // UX wave U2
import { shortCommand } from './short-command'; // UX wave U2
import { cellId } from './keys';
import type { TurnState } from './reduce';
import type { Cell, CellDetail, ChangedFile, Hunk, Spill, ToolCategory, Truncation } from './rows';

type Event<K extends SessionEvent['kind']> = Extract<SessionEvent, { kind: K }>;

export interface ToolRecord {
  summary?: string; // optional engine-generated label, keyed by preceding tool-use ids
  use: Event<'tool.use'>;
  result: Event<'tool.result'> | null;
  safeguard: SafeguardVerdict;
  elapsedSeconds: number;
  humanDecision: boolean;
  backgroundTaskId: TaskId | null;
  backgroundDone: boolean;
  // UX wave U4a (decision 33): the engine moved the call to the background so a message sent now could be read
  // (`movedToBackground`), and the process that ran it exited before its task's end was heard (TurnState.agentsEndedAt).
  // Optional: a record made elsewhere (the surface's adapters) is never a moved call.
  moved?: boolean;
  exited?: boolean;
}

export interface TurnContext {
  closed: boolean;
  stopped: boolean; // closed as stopped (`closedAsStopped`)
  continued: ReadonlySet<ToolUseId>; // the rejected calls the model went on after (`continuedAfter`)
  lastAt: string; // the turn's latest event time, for running durations
}

// UX wave U2 (decision 23): a closed turn whose line reads stopped (derive.ts's divider state): closed as stopped by the
// reader (a file's interrupt marker, a process's exit), else by an aborted terminal reason (the wire's, and the end
// another machine's rows get synthesised), else closed with no recorded end.
export const closedAsStopped = (turn: TurnState): boolean =>
  turn.state === 'closed' && (turn.closedBy !== null ? turn.closedBy === 'stopped' : turn.ended === null || isAbortedReason(turn.ended.terminalReason));

// The one place a turn's context is made, for its derivation and for the mods' asks (surface/adapters.ts), so the two
// cannot read a call differently. Made once per revision of the turn: the reducer clones a turn on its first change in a
// batch and bumps its version on every structural one, and a mounted cell's ask must not pass over the turn's events again
const contexts = new WeakMap<TurnState, { version: number; events: number; state: TurnState['state']; closedBy: TurnState['closedBy']; ended: TurnState['ended']; context: TurnContext }>();
export function turnContextOf(turn: TurnState): TurnContext {
  const known = contexts.get(turn);
  if (known && known.version === turn.version && known.events === turn.events.length && known.state === turn.state && known.closedBy === turn.closedBy && known.ended === turn.ended) return known.context;
  const context = { closed: turn.state === 'closed', stopped: closedAsStopped(turn), continued: continuedAfter(turn.events, turn.agentId), lastAt: turn.events.at(-1)?.at ?? turn.startedAt };
  contexts.set(turn, { version: turn.version, events: turn.events.length, state: turn.state, closedBy: turn.closedBy, ended: turn.ended, context });
  return context;
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

// UX wave U4a (decision 33): whether the engine moved a call to the background, read when its result arrives. A shell
// call says so in its structured result; any other call by a task that names it and had not ended by then (an MCP call
// carries no flag). A foreground shell command gets a task too before its result, so a shell call is read by its flag
// alone. The result's text is never read.
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'Monitor']);
export const movedToBackground = (rec: ToolRecord, result: Event<'tool.result'>): boolean =>
  SHELL_TOOLS.has(rec.use.toolName) ? record(result.structured).backgroundedToDeliverMessage === true : rec.backgroundTaskId !== null && !rec.backgroundDone;
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
    const value = jsonObjectOf(text);
    if (value !== null) return value;
  }
  return null;
}

// A text block's JSON object, null when the text is not JSON or not an object (E4c's `textAfterJson` asks the same).
export function jsonObjectOf(text: string): object | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
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

const textLines = (text: string): string[] => text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/);
const lineCount = (text: string) => textLines(text).length;

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
  if (hunks.length === 0 && toolName === 'Write' && change === 'create') {
    const lines = textLines(str(record(structured).content, str(input.content)));
    added = lines.length;
    hunks.push({ oldStart: 0, oldLines: 0, newStart: 1, newLines: added, lines: lines.map((line) => `+${line}`) });
  }
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
    case 'Bash': case 'PowerShell': case 'BashOutput': case 'KillShell': case 'Monitor': { // SHELL_TOOLS
      const stdout = typeof s.stdout === 'string' ? s.stdout : text;
      const stderr = str(s.stderr);
      const parsed = EXIT_CODE.exec(text);
      const exitCode = parsed ? Number(parsed[1]) : status === 'done' ? 0 : null;
      return {
        kind: 'shell', command: str(input.command, use.toolName), description: typeof input.description === 'string' ? input.description : null, cwd: typeof input.cwd === 'string' ? input.cwd : null,
        ...(use.cwd !== undefined && { rowCwd: use.cwd }), // UX wave U8c-2 (§K): the folder the call's row records, kept apart from the input's
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
  if (rec.moved === true && !rec.backgroundDone) return rec.exited === true ? 'stopped' : 'running'; // UX wave U4a: across its turn's close
  if (rec.backgroundTaskId !== null && !rec.backgroundDone && !turn.closed) return 'running';
  return rec.result.isError ? 'error' : 'done';
}

const elapsedMs = (rec: ToolRecord, turn: TurnContext) =>
  rec.result ? Date.parse(rec.result.at) - Date.parse(rec.use.at) : Math.max(rec.elapsedSeconds * 1000, Date.parse(turn.lastAt) - Date.parse(rec.use.at));

// UX wave U2 (decision 23, R2; Interfaces §D): what a stopped call's row reads, family by family: `Stopped: ` and a shell
// call's description as written (no marks), or else the short form of its command (`Stopped a command` where the rule
// refuses it; a shell tool with no command line of its own, its command field), a file change's path, an artifact's
// title in its marks, an MCP call's shown name, every other tool's name. The refusal that stands alone keeps today's
// subject.
function stoppedRowLabel(rec: ToolRecord, detail: CellDetail, titles: ArtifactTitles): string {
  if (detail.kind === 'shell') {
    const description = detail.description?.trim().split(/\r?\n/, 1)[0];
    if (description) return stoppedLabel(description, false);
    const shell = shellToolOf(rec.use.toolName);
    if (shell === null) return stoppedLabel(detail.command, true);
    const short = shortCommand(detail.command, shell);
    return short === null ? SHELL_CELL.aCommand.stopped : stoppedLabel(short, true);
  }
  if (detail.kind === 'edit') return stoppedLabel(detail.filePath, true);
  const artifact = artifactSubjectOf(rec, titles);
  if (artifact !== null) return stoppedLabel(artifact, false);
  const mcp = MCP_TOOL.exec(rec.use.toolName);
  return stoppedLabel(mcp ? `${mcp[1]} · ${mcp[2]}` : rec.use.toolName, true);
}

// UX wave U2 (O-49): the shell tools whose command line Desktop's rule shortens (its `fu`, for Bash and PowerShell)
export const shellToolOf = (toolName: string): 'Bash' | 'PowerShell' | null => (toolName === 'Bash' || toolName === 'PowerShell' ? toolName : null);

// UX wave U2 start (l6-artifacts-12; the U2a document, Interfaces §D, Reported 4): an artifact is named by the title a
// result in the loaded transcript gave it (a creation, a read, a publication, a list, a search or a screenshot: this
// turn's results, then the earlier turns'), else by the id or handle the call gave. No library is read: an edit's result
// carries no title, the result shapes are frozen (UC-15), and the library differs by machine while the transcript's own
// results are the same on every route.
export type ArtifactTitles = (ref: string) => string | null;
const noTitles: ArtifactTitles = () => null;

const ARTIFACT_PREFIX = `mcp__${MAWS_SERVER_NAME}__`;
const TITLE_GIVING = new Set<string>([
  MAWS_TOOL_USE.artifact_create, MAWS_TOOL_USE.artifact_publish, HISTORICAL_ARTIFACT_UPDATE_TOOL_USE, MAWS_TOOL_USE.artifact_read,
  MAWS_TOOL_USE.artifact_list, MAWS_TOOL_USE.artifact_search, MAWS_TOOL_USE.artifact_screenshot,
]);

// What a run of events' results named: each id and handle a result gave a title to, the latest result's title kept.
// Read leniently (any result of a tool that names artifacts, by the keys its JSON carries), so a result written by an
// older build still names what it named. A screenshot's and a delivery's result carry the artifact's id as
// `deliverableId` and may carry its handle as `id`.
export function artifactTitlesOf(events: readonly SessionEvent[]): Map<string, string> {
  const titles = new Map<string, string>();
  const tools = new Map<ToolUseId, string>();
  const named = (value: unknown) => {
    const item = record(value);
    if (typeof item.title !== 'string' || item.title === '') return;
    for (const key of [item.artifactId, item.deliverableId, item.id, item.handle]) if (typeof key === 'string' && key !== '') titles.set(key, item.title);
  };
  for (const event of events) {
    if (event.kind === 'tool.use') tools.set(event.toolUseId, event.toolName);
    else if (event.kind === 'tool.result' && !event.isError && TITLE_GIVING.has(tools.get(event.toolUseId) ?? '')) {
      const json = record(firstJsonBlock(event.content));
      named(json);
      for (const list of [json.artifacts, json.hits]) if (Array.isArray(list)) list.forEach(named);
    }
  }
  return titles;
}

export const artifactTitleOf = (ref: string, titles: ArtifactTitles): string => titles(ref) ?? ref;

// The plain artifact calls a cell's label names, by their tool name under the `maws` server
type ArtifactCall = keyof typeof ARTIFACT_CELL.calls | 'artifact_list' | 'artifact_screenshot';
function artifactCallOf(toolName: string): ArtifactCall | null {
  if (!toolName.startsWith(ARTIFACT_PREFIX)) return null;
  const name = toolName.slice(ARTIFACT_PREFIX.length);
  return Object.hasOwn(ARTIFACT_CELL.calls, name) || name === 'artifact_list' || name === 'artifact_screenshot' ? (name as ArtifactCall) : null;
}

// The artifact a call names, as its row writes it (its title in its marks); null for a call that names none (a list, a
// search, a kind's description) or a call whose input names nothing
function artifactSubjectOf(rec: ToolRecord, titles: ArtifactTitles): string | null {
  const call = artifactCallOf(rec.use.toolName);
  if (call === null || call === 'artifact_list' || call === 'artifact_search' || call === 'artifact_describe_type') return null;
  const ref = record(rec.use.input)[call === 'artifact_screenshot' ? 'id' : 'artifact'];
  return typeof ref === 'string' && ref !== '' ? ARTIFACT_TITLE(artifactTitleOf(ref, titles)) : null;
}

// An artifact call's row: what it did, while it runs, or that it could not; null where its input does not say what it
// named (the call then reads as any MCP call)
function artifactLabel(rec: ToolRecord, status: 'running' | 'done' | 'error', titles: ArtifactTitles): string | null {
  const call = artifactCallOf(rec.use.toolName);
  if (call === null) return null;
  const input = record(rec.use.input);
  if (call === 'artifact_list') return status === 'running' ? ARTIFACT_CELL.listing : status === 'error' ? ARTIFACT_CELL.listFailed : artifactListLabel(rec);
  if (call === 'artifact_screenshot') {
    const subject = artifactSubjectOf(rec, titles);
    if (subject === null) return null;
    return status === 'running' ? ARTIFACT_CELL.screenshotting(str(input.id)) : status === 'error' ? ARTIFACT_CELL.screenshotFailed(subject) : screenshotLabel(rec);
  }
  const subject = call === 'artifact_search' ? '' : call === 'artifact_describe_type' ? (typeof input.kind === 'string' && input.kind !== '' ? input.kind : null) : artifactSubjectOf(rec, titles);
  if (subject === null) return null;
  const words: ArtifactCallWords = ARTIFACT_CELL.calls[call];
  return status === 'running' ? words.running(subject) : status === 'error' ? words.failed(subject) : words.done(subject, input);
}

// A failed call's reason (decision 13): the first line of its error with the engine's tags stripped (its refusal's, and
// the line it closes an aborted command's output with, `cli.pretty.js:505894` of 2.1.322), and for an artifact call the
// host's own `<tool>: ` before it. The pane-opening call keeps its reason in its own words, which M3 does not touch.
const ENGINE_ERROR_LINE = /^<error>([\s\S]*)<\/error>$/;
function errorOf(rec: ToolRecord): string | undefined {
  if (rec.result === null || rec.use.toolName === MAWS_TOOL_USE.show_pane) return undefined;
  const call = artifactCallOf(rec.use.toolName);
  const text = toolErrorText(resultText(rec.result.content));
  const first = text.split(/\r?\n/).map((part) => part.trim()).find((part) => part !== '');
  const line = first === undefined ? undefined : (ENGINE_ERROR_LINE.exec(first)?.[1].trim() || first);
  return line === undefined ? undefined : call === null ? line : line.replace(new RegExp(`^${call}: `), '') || undefined;
}
// UX wave U2 end

function labelOf(rec: ToolRecord, detail: CellDetail, status: Cell['status'], category: ToolCategory, classification: Cell['classification'], turn: TurnContext, titles: ArtifactTitles): string {
  const input = record(rec.use.input);
  // UX wave U2 (decision 23, R2): a stopped call that does not stand alone as a refusal reads one form on every family;
  // a moved call whose process exited is none of them: it has its result and keeps its moved words (U4a, decision 33)
  if (status === 'stopped' && rec.moved !== true && (classification.denial === null || stoppedMember(classification.denial))) return stoppedRowLabel(rec, detail, titles);
  if (classification.denial) {
    const subject = detail.kind === 'shell' ? detail.command : detail.kind === 'edit' ? detail.filePath : rec.use.toolName;
    return cellLabel({ kind: 'denied', subject, disposition: classification.denial.disposition, denialKind: classification.denial.kind, reason: classification.denial.reason });
  }
  if (rec.moved === true) { // UX wave U4a (decision 33): the same words while it runs, once its task ends and once its process exits
    const mcp = MCP_TOOL.exec(rec.use.toolName);
    const name = detail.kind === 'shell' ? detail.command : mcp ? `${mcp[1]} · ${mcp[2]}` : rec.use.toolName;
    return cellLabel({ kind: 'moved', name, durationMs: elapsedMs(rec, turn) });
  }
  if (rec.use.toolName === MAWS_TOOL_USE.show_pane) return paneLabel(rec); // E1
  // E2, UX wave U2 (l6-artifacts-12): an artifact call names what it did to which artifact
  const artifact = status === 'running' || status === 'done' || status === 'error' ? artifactLabel(rec, status, titles) : null;
  if (artifact !== null) return artifact;
  if ((rec.use.toolName === 'Agent' || rec.use.toolName === 'Task') && typeof input.description === 'string') return descriptionLabel(input.description, status);
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

// E2 start: an `artifact_list` call done reads how many artifacts it listed, an `artifact_screenshot` call done what it
// captured (the result's title, version and size). UX wave U2: their running and failed forms are `artifactLabel`'s.
// P3-A: E2's listing and the library's alike, counted
const LISTED = z.object({ status: z.literal('listed'), artifacts: z.array(z.unknown()) });
function artifactListLabel(rec: ToolRecord): string {
  const parsed = LISTED.safeParse(rec.result && !rec.result.isError ? firstJsonBlock(rec.result.content) : null);
  return ARTIFACT_CELL.listed(parsed.success ? parsed.data.artifacts.length : null);
}

function screenshotLabel(rec: ToolRecord): string {
  const parsed = ArtifactScreenshotResultSchema.safeParse(rec.result && !rec.result.isError ? firstJsonBlock(rec.result.content) : null);
  return ARTIFACT_CELL.screenshot(parsed.success ? parsed.data : null, str(record(rec.use.input).id));
}
// E2 end

// Draw-time rewrites may override status, before deriving both detail and label. Model callers omit it. `titles` names
// an artifact a call names (UX wave U2); a caller with no transcript to read gives none, and the call names its handle.
export function cellOf(rec: ToolRecord, turn: TurnContext, expanded: boolean, displayStatus?: Cell['status'], titles: ArtifactTitles = noTitles): Cell {
  const { use, result } = rec;
  const denial = result?.denial ? { kind: result.denial, reason: resultText(result.content).trim() || null } : null;
  const context: ClassifyContext = {
    denial, turn, continued: turn.continued.has(use.toolUseId), humanDecision: rec.humanDecision,
    safeguard: result && result.safeguard !== 'not_evaluated' ? result.safeguard : rec.safeguard, imageResult: isImageResult(result), isError: result?.isError ?? false,
  };
  const classification = classifyTool(use.toolName, use.input, context);
  const recordedStatus = statusOf(rec, turn, classification.denial?.disposition ?? null);
  const status = displayStatus ?? recordedStatus;
  const labelClassification = status === recordedStatus ? classification : { ...classification, denial: null };
  const detail = detailOf(rec, status);
  const category = tableRowOf(use.toolName).category;
  const paths = detail.kind === 'read' ? detail.files.map((file) => file.path) : detail.kind === 'edit' ? [detail.filePath] : [];
  const label = labelOf(rec, detail, status, category, labelClassification, turn, titles);
  // UX wave U2 (Interfaces §B; decision 14): a stopped call's caption words, and a failed artifact call's, are what its
  // row reads done
  const doneLabel = status === 'stopped' || (status === 'error' && artifactCallOf(use.toolName) !== null) ? labelOf(rec, detailOf(rec, 'done'), 'done', category, { ...classification, denial: null }, turn, titles) : label;
  const error = status === 'error' ? errorOf(rec) : undefined; // UX wave U2 (decision 13)
  return {
    id: cellId.tool(use.toolUseId), toolUseId: use.toolUseId, toolName: use.toolName, category, classification, status,
    label, ...(doneLabel !== label && { doneLabel }), ...(error !== undefined && { error }), ...(rec.summary ? { summary: rec.summary } : {}), ...(rec.moved === true ? { moved: true } : {}), paths, startedAt: use.at, endedAt: result?.at ?? null, detail, expanded, agent: null,
    background: result !== null && recordedStatus === 'running', // UX wave U2 (decision 20)
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

export function thinkingCell(id: string, text: string, live: boolean, at: string, durationMs: number | null, recordedMs: number | null, expanded: boolean): Cell {
  const classification = classifyTool('thinking', null, { denial: null, turn: { closed: false, stopped: false }, continued: false, humanDecision: false, safeguard: 'not_evaluated', imageResult: false, isError: false });
  return {
    id: id as Cell['id'], toolUseId: null, toolName: 'thinking', category: 'other', classification, status: live ? 'running' : 'done',
    label: thinkingLabel(live, durationMs), paths: [], startedAt: at, endedAt: live ? null : at, detail: { kind: 'thinking', text, durationMs, recordedMs }, expanded, agent: null, background: false,
  };
}
