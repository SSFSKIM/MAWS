// Desktop surface inputs over X3. Draw-time adapters do not mutate transcript history, folds, or classifications.
// The source turn retains the original X1 tool input and output; the compact cell detail alone is not that contract.
import { carriedOf } from '@shared/engine/arrival-schema';
import { handbackReport, messageText, parsePeerMessage, peerLabel } from '@shared/engine/peer-envelope';
import { engineQuestionsOf, type TranscriptProps, type TranscriptSite } from '@shared/engine/surface-rows';
import type { ContentBlock, SessionEvent } from '@shared/graph/events';
import type { ToolUseId } from '@shared/graph/ids';
import { cellOf, type ToolRecord, type TurnContext } from '../model/cells';
import { rowId } from '../model/keys';
import type { TranscriptState, TurnState } from '../model/reduce';
import type { Cell, CellId, Row, RowId } from '../model/rows';
import { userTextOf } from '../model/user-text';

export interface RowInput<C extends TranscriptSite> { instanceId: string; props: TranscriptProps[C] }
type RowOf<K extends Row['kind']> = Extract<Row, { kind: K }>;
const object = (v: unknown): Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function userInput(row: RowOf<'user'>, turn: TurnState | undefined): RowInput<'UserMessage'> | null {
  if (!turn || row.pending || row.dropped || !row.text.trim()) return null;
  const event = turn.events.find((e) => e.kind === 'user.message' && (row.messageUuid ? e.messageUuid === row.messageUuid : `user:${e.id}` === row.id));
  if (event?.kind !== 'user.message' || event.isSynthetic) return null;
  const origin = event.origin;
  if (origin !== null && !['human', 'composer', 'bridge', 'sdk', 'unclassified'].includes(origin)) return null;
  // MAWS's outgoing SDK prompt is normalized as human. Unstamped history is not evidence of a terminal gesture.
  const kind = origin === 'human' ? 'sdk' : origin === 'composer' || origin === 'bridge' || origin === 'sdk' ? origin : 'unclassified';
  return { instanceId: row.messageUuid ?? row.id, props: { text: row.text, origin: { kind }, isExpanded: true } };
}

export function assistantInput(row: RowOf<'assistant_text'>, turn: TurnState | undefined): RowInput<'AssistantMessage'> | null {
  if (!row.markdown.trim()) return null;
  const identity = row.id.slice(row.id.indexOf(':') + 1);
  const api = identity.slice(0, identity.lastIndexOf(':'));
  const peers = [...(turn?.live.values() ?? [])].filter((b) => b.blockType === 'text' && b.apiMessageId === api);
  const firstIndex = peers.length ? Math.min(...peers.map((b) => b.blockIndex)) : row.blockIndex;
  const sameMessage = peers.filter((b) => b.messageUuid === row.messageUuid);
  const firstMessageBlock = sameMessage.length ? Math.min(...sameMessage.map((b) => b.blockIndex)) : row.blockIndex;
  // The terminal passes messageUuid unqualified (chunk-5s6b4r7q, af -> Qs). MAWS can mount multiple blocks of that
  // UUID together: keep its first identity and qualify later ones so one instance never races another's props.
  const instanceId = row.messageUuid === null ? row.id : row.blockIndex === firstMessageBlock ? row.messageUuid : `${row.messageUuid}:text:${row.blockIndex}`;
  // MessageDisplay may replace tags with ANSI headers that another mod understands. Native markdown is stripped;
  // the hook contract is the engine's delivered block, not MAWS's plain drawing of it.
  const text = peers.find((block) => block.rowId === row.id)?.sourceText ?? row.markdown;
  return { instanceId, props: { text, isFirstOfReply: row.blockIndex === firstIndex } };
}

const toolCache = new WeakMap<SessionEvent[], Map<ToolUseId, ToolRecord>>();
function toolRecords(turn: TurnState): Map<ToolUseId, ToolRecord> {
  const cached = toolCache.get(turn.events);
  if (cached) return cached;
  const records = new Map<ToolUseId, ToolRecord>();
  const removed = new Set<string>();
  for (const e of turn.events) {
    if (e.kind === 'boundary.retraction') for (const uuid of e.retractedMessageUuids) removed.add(uuid);
    if (e.kind === 'assistant.block.complete') for (const uuid of e.supersedes) removed.add(uuid);
  }
  for (const e of turn.events) {
    if (e.kind === 'tool.use' && e.messageUuid !== null && removed.has(e.messageUuid)) continue;
    if (e.kind === 'tool.use') records.set(e.toolUseId, { use: e, result: null, safeguard: 'not_evaluated', elapsedSeconds: 0, humanDecision: false, backgroundTaskId: null, backgroundDone: false });
    else if (e.kind === 'tool.result') { const rec = records.get(e.toolUseId); if (rec) rec.result = e; }
    else if (e.kind === 'tool.progress') { const rec = records.get(e.toolUseId); if (rec) rec.elapsedSeconds = Math.max(rec.elapsedSeconds, e.elapsedSeconds); }
  }
  toolCache.set(turn.events, records);
  return records;
}
const turnContext = (turn: TurnState): TurnContext => ({ closed: turn.state === 'closed', terminalReason: turn.ended?.terminalReason ?? null, lastAt: turn.events.at(-1)?.at ?? turn.startedAt });

export interface ToolInput extends RowInput<'ToolUse'> { cell: Cell; record: ToolRecord; context: TurnContext }
export function toolInputs(cell: Cell, turn: TurnState | undefined): ToolInput[] {
  if (!turn || cell.toolUseId === null) return [];
  const records = toolRecords(turn);
  const all = [...records.values()];
  const at = all.findIndex((r) => r.use.toolUseId === cell.toolUseId);
  if (at < 0) return [];
  // X3 mergeReads merges consecutive Read/NotebookRead/LS calls, one file per call, under the first tool id.
  const count = cell.id.startsWith('cell:reads:') && cell.detail.kind === 'read' ? cell.detail.files.length : 1;
  const context = turnContext(turn);
  return all.slice(at, at + count).map((rec) => {
    const native = count === 1 ? cell : cellOf(rec, context, cell.expanded);
    return { instanceId: rec.use.toolUseId, cell: native, record: rec, context, props: callProps(rec, native) };
  });
}

// A call's ToolUse props, read from its record and the status of its drawn cell.
function callProps(rec: ToolRecord, native: Cell): TranscriptProps['ToolUse'] {
  const output = rec.result ? (rec.result.isError ? rec.result.content : rec.result.structured ?? rec.result.content) : undefined;
  return { tool_use_id: rec.use.toolUseId, tool: rec.use.toolName, input: rec.use.input,
    isRunning: native.status === 'running', isErrored: native.status === 'error' || native.status === 'denied',
    isInterrupted: native.status === 'stopped' || object(output).interrupted === true, ...(output !== undefined && { output }) };
}

// Render output is unknown JSON, not necessarily X1's content-block list.
function outputContent(output: unknown): string | ContentBlock[] {
  if (output === undefined || output === null) return '';
  if (typeof output === 'string') return output;
  if (Array.isArray(output) && output.every((block) => typeof object(block).type === 'string')) return output as ContentBlock[];
  return JSON.stringify(output, null, 2) ?? '';
}

// Answers cross JSON transport; reference and key order do not identify a presentation change.
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>; const b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

export function withToolProps(input: ToolInput, props: TranscriptProps['ToolUse']): Cell {
  if (sameValue(props, input.props)) return input.cell;
  const { record, cell, context } = input;
  const output = props.output;
  const replacedOutput = !sameValue(output, input.props.output);
  // This record exists only for drawing, including output supplied for a still-unresolved call. Never attach it
  // to the turn. Unchanged output retains X1's text/structured pair; replaced output must not retain old spills.
  const result = {
    ...(record.result ?? { ...record.use, kind: 'tool.result' as const, at: context.lastAt, denial: null, safeguard: record.safeguard, spillPath: null }),
    isError: props.isErrored,
    content: !replacedOutput && record.result ? record.result.content : outputContent(output),
    structured: !replacedOutput && record.result ? record.result.structured : typeof output === 'object' && output !== null && !Array.isArray(output) ? output : null,
    ...(replacedOutput && { spillPath: null }),
  };
  const status = props.isInterrupted ? 'stopped' : props.isErrored ? cell.status === 'denied' ? 'denied' : 'error' : props.isRunning ? 'running' : 'done';
  const drawn = cellOf({ ...record, use: { ...record.use, toolName: props.tool, input: props.input }, result }, context, cell.expanded, status);
  // Reader state lives on the native cell, not the historical event. It remains applicable only to the same output/spill.
  if (!replacedOutput && 'spill' in drawn.detail && 'spill' in cell.detail && cell.detail.spill !== null && drawn.detail.spill?.path === cell.detail.spill.path) {
    drawn.detail = { ...drawn.detail, spill: cell.detail.spill };
  }
  const summary = props.tool === input.props.tool && sameValue(props.input, input.props.input) ? cell.summary : undefined;
  return { ...drawn, ...(summary ? { summary } : {}), id: cell.id, classification: cell.classification, agent: cell.agent, startedAt: cell.startedAt, endedAt: cell.endedAt };
}

interface Sized { value: unknown; nodes: number; chars: number }
// Desktop bounds each string before measuring calls (Sn then Nt, :1132 and :361). Measure while walking, so a
// pathological tool input cannot exhaust the JS stack before the group's depth/node budget rejects it.
function bounded(value: unknown, depth = 1): Sized | null {
  if (depth + 2 >= 32) return null;
  if (typeof value === 'string') {
    const text = value.length <= 65_536 ? value : `${value.slice(0, 65_472)}\n[…truncated ${value.length - 65_472} of ${value.length} characters]`;
    return { value: text, nodes: 1, chars: text.length };
  }
  if (typeof value !== 'object' || value === null) return { value, nodes: 1, chars: 0 };
  let nodes = 1; let chars = 0;
  const entries: [string, unknown][] = [];
  for (const [key, item] of Object.entries(value)) {
    const next = bounded(item, depth + 1);
    if (!next) return null;
    nodes += next.nodes; chars += key.length + next.chars;
    if (nodes > 1500 || chars > 196_608) return null;
    entries.push([key, next.value]);
  }
  return { value: Array.isArray(value) ? entries.map(([, item]) => item) : Object.fromEntries(entries), nodes, chars };
}

export function groupInput(row: RowOf<'group'>, turn: TurnState | undefined, pending: TranscriptState['pending']): RowInput<'ToolGroup'> | null {
  const tools = row.cells.flatMap((cell) => toolInputs(cell, turn));
  if (!tools.length) return null;
  const ids = new Set(tools.map((t) => t.instanceId));
  if ([...pending.values()].some((e) => 'toolUseId' in e && e.toolUseId != null && ids.has(e.toolUseId))) return null;
  if (tools.some((t) => t.props.tool === 'AskUserQuestion' && t.record.result === null)) return null;
  const calls: TranscriptProps['ToolGroup']['calls'] = [];
  let nodes = 0; let chars = 0;
  for (const tool of tools.toReversed()) {
    const { output, ...rest } = tool.props;
    const candidates = output !== undefined && !rest.isRunning && !rest.isErrored ? [{ ...rest, output }, rest] : [rest];
    for (const candidate of candidates) {
      const sized = bounded(candidate);
      if (!sized || nodes + sized.nodes > 1500 || chars + sized.chars > 196_608) continue;
      calls.unshift(sized.value as TranscriptProps['ToolUse']); nodes += sized.nodes; chars += sized.chars; break;
    }
  }
  return { instanceId: `group:${tools[0].instanceId}`, props: { calls, isActive: tools.some((tool) => tool.props.isRunning), isExpanded: false } };
}

export function commandInput(row: RowOf<'local_command'>, state: TranscriptState | undefined): RowInput<'CommandOutput'> | null {
  if (!row.text.trim()) return null;
  let command = ''; let args = '';
  if (state) {
    const events = [...state.turns.values()].flatMap((t) => t.events).concat(state.loose).sort((a, b) => a.at.localeCompare(b.at));
    for (const e of events) {
      if (e.at > row.at || (e.kind === 'user.message' && (row.messageUuid !== null ? e.messageUuid === row.messageUuid : `local:${e.id}` === row.id))) break;
      if (e.kind !== 'user.message' || e.isSynthetic || e.origin === 'local-command') continue;
      const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(userTextOf(e.content).text);
      command = match?.[1] ?? ''; args = match?.[2] ?? '';
    }
  }
  return { instanceId: row.messageUuid ?? row.id, props: { command, args, text: row.text, isErrored: false } };
}

export function resultInput(input: ToolInput): RowInput<'ToolResult'> | null {
  if (input.props.isRunning || input.record.result === null || input.props.output === undefined) return null;
  return { instanceId: input.instanceId, props: { tool_use_id: input.props.tool_use_id, tool: input.props.tool, output: input.props.output, isErrored: input.props.isErrored } };
}

export function questionInput(row: RowOf<'question'>, turn: TurnState | undefined): RowInput<'AskUserQuestion'> {
  const use = turn?.events.find((e) => e.kind === 'tool.use' && e.toolUseId === row.toolUseId);
  const metadata = object(object(use?.kind === 'tool.use' ? use.input : null).metadata);
  return { instanceId: row.toolUseId, props: { tool: 'AskUserQuestion', questions: engineQuestionsOf(row.questions), ...(typeof metadata.source === 'string' && { metadataSource: metadata.source }) } };
}

// ---------------------------------------------------------------------------------------------------------------------
// UX wave U3, first landing (UC-3; docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md, M5, decisions 14 and 15):
// the rows of what entered the session ask the engine's UserMessage site, and a message the agent sent asks ToolUse, as
// the engine's own transcript does, so a mod folds or draws them as it does in the terminal. Read in the engine's bundle
// (`cli.pretty.js` of 2.1.322: `useUserMessageSite` near line 93253 and its callers), its message renderer passes a
// `user` message or a queued command through the site by the carrier's own text: `<cross-session-message>` (the inbox's
// delivery, a peer's or the bridge's wake after an Esc: `UserCrossSessionMessage`, near line 291587), `<agent-message>`
// under a subagent's origin (a subagent's message or hand-back: near line 929249), `<task-notification>` with a
// `<summary>` (near lines 925119 and 925137), and any other text as a plain prompt under the message's own origin (near
// line 925773). A meta row it never draws (the bridge's append, a scheduled fire's prompt: the fire is drawn from its
// `system` row), nor a hook's added context (an attachment it draws as nothing, near line 926265). So a row asks where
// its carrier event holds one of those three envelopes, with the props the engine gives there; a carrier with none asks
// nothing: the host made it (a task's end told while idle; there is no text to give the site), or the engine draws it
// as a plain prompt under an origin X1's event does not keep (the bridge's submitted row, a background session's prompt,
// the bridge's wake and a plugin's answer as its prompt), which a session MAWS runs never receives (probe 3,
// spikes/protocol-probe/findings-uxwave-u3-sminos.txt) and is the only kind of session whose surface is attached.

type ArrivalRow = RowOf<'agent_message'> | RowOf<'notice'>;
type UserMessageEvent = Extract<SessionEvent, { kind: 'user.message' }>;

/** What the row's ask depends on beyond the turn: the tab's revealed jump target (which asks no site), and whether its line is open. */
export interface ArrivalAsk { revealed: RowId | CellId | undefined; expanded: boolean }

/** The UserMessage ask of a message line or a notice; null where it asks none. */
export function arrivalInput(row: ArrivalRow, turn: TurnState | undefined, { revealed, expanded }: ArrivalAsk): RowInput<'UserMessage'> | null {
  if (!turn || row.id === revealed) return null;
  const carrier = row.kind === 'notice' ? noticeCarrier(row, turn) : messageCarrier(row, turn);
  if (carrier === null) return null;
  const props = engineUserProps(messageText(carrier.content), expanded, row.kind === 'agent_message' ? row : null);
  return props === null ? null : { instanceId: carrier.messageUuid ?? row.id, props };
}

/** The ToolUse ask of a message the agent sent: its call's props, as a cell's call asks; null for any other message line. */
export function sentInput(row: RowOf<'agent_message'>, turn: TurnState | undefined, revealed: RowId | CellId | undefined): RowInput<'ToolUse'> | null {
  if (!turn || row.id === revealed || (row.peer !== undefined && row.peer.sender !== null)) return null;
  const toolUseId = row.peer?.toolUseId ?? turn.events.find((e): e is Extract<SessionEvent, { kind: 'tool.use' }> => e.kind === 'tool.use' && rowId.agentMessage(e.id) === row.id)?.toolUseId;
  const rec = toolUseId == null ? undefined : toolRecords(turn).get(toolUseId);
  return rec === undefined ? null : { instanceId: rec.use.toolUseId, props: callProps(rec, cellOf(rec, turnContext(turn), false)) };
}

// The message a line stands for: a peer's by its companion's uuid, a subagent's the envelope its `subagent.message` was read from.
function messageCarrier(row: RowOf<'agent_message'>, turn: TurnState): UserMessageEvent | null {
  const messages = turn.events.filter((e): e is UserMessageEvent => e.kind === 'user.message');
  if (row.peer !== undefined) return row.peer.sender === null || row.peer.messageUuid === null ? null : (messages.find((e) => e.messageUuid === row.peer!.messageUuid) ?? null);
  const at = turn.events.findIndex((e) => e.kind === 'subagent.message' && e.direction === 'from_child' && rowId.agentMessage(e.id) === row.id);
  const source = turn.events[at];
  if (source?.kind !== 'subagent.message') return null;
  for (const e of turn.events.slice(0, at).toReversed()) {
    if (e.kind !== 'user.message') continue;
    const envelope = parsePeerMessage(messageText(e.content));
    if (envelope?.kind === 'agent' && envelope.fromAgentId === source.fromAgentId && envelope.body === source.text) return e;
  }
  return null;
}

// The synthetic message whose arrival the notice draws: the first that gives its id, as the derivation keeps the first.
function noticeCarrier(row: RowOf<'notice'>, turn: TurnState): UserMessageEvent | null {
  for (const e of turn.events) {
    if (e.kind !== 'user.message' || !e.isSynthetic || e.arrival === undefined) continue;
    const ids = e.arrival.map((entry, n) => {
      const known = carriedOf([entry])[0];
      return known === undefined || known.class === 'consent' ? null : rowId.notice(known.class === 'task' ? known.runId : null, e.messageUuid ?? e.id, n);
    });
    if (ids.includes(row.id)) return e;
  }
  return null;
}

// The engine's props for a carrier's text; null where its transcript passes the text through no UserMessage site that
// MAWS can give the props of. `isExpanded` is the line's open state, as the engine's is its expanded view (ctrl+o).
function engineUserProps(text: string, isExpanded: boolean, line: RowOf<'agent_message'> | null): TranscriptProps['UserMessage'] | null {
  const envelope = parsePeerMessage(text);
  const inner = envelope === null ? null : envelopeText(text, envelope.kind === 'agent' ? 'agent-message' : 'cross-session-message');
  if (envelope?.kind === 'cross-session' && inner !== null) {
    return { text: inner, origin: { kind: 'peer' }, isExpanded, from: { name: speakerName(peerLabel(envelope.from, envelope.fromName), 'peer') } };
  }
  if (envelope?.kind === 'agent' && inner !== null) {
    // A subagent by the name its origin gives (the agent's type), else its id; a hand-back by its report alone.
    return { text: envelope.handback ? (handbackReport(inner) ?? inner) : inner, origin: { kind: 'peer' }, isExpanded, from: { name: speakerName(line?.from?.subagentType ?? envelope.fromAgentId, 'agent') } };
  }
  if (envelope === null && text.includes('<task-notification')) {
    // Two forms the engine draws otherwise (near line 926168): an artifact room's view (nothing) and a call's late result.
    if (text.startsWith('<task-notification>\n<task-type>artifact-room-view</task-type>\n') || LATE_RESULT.test(text)) return null;
    // The carrier's first <summary> and the task's fields beside it: the engine draws a carrier of several blocks once.
    const summary = tagText(text, 'summary');
    if (summary === null) return null; // the engine draws nothing for it
    const duration = Number(tagText(text, 'duration_ms'));
    const field = (name: string) => tagText(text, name) || undefined;
    const task = { id: field('task-id'), status: field('status'), type: field('task-type'), toolUseId: field('tool-use-id'), durationMs: Number.isFinite(duration) && duration > 0 ? duration : undefined };
    return { text: summary.replace(/&(?:amp|lt|gt);/g, (entity) => ENTITIES[entity]!), origin: { kind: 'task-notification' }, isExpanded, task: Object.fromEntries(Object.entries(task).filter(([, value]) => value !== undefined)) };
  }
  return null;
}

// The engine's headers before an envelope (2.1.322's `Tme`), cut as its renderers cut them.
const ENVELOPE_HEADERS = ['Another Claude session sent a message while you were working:\n', 'Another Claude session sent a message:\n', 'A peer session sent a message while you were working:\n'];
// What lies inside an envelope, as the engine's renderers give it to the site: its header and its trailer cut, then its
// tags (`G` near line 291571 for a peer's, `pT` near line 929220 for an agent's). Null for a text that does not open
// with the envelope after a header (the `<system-reminder>` form the model read is not the one the engine draws).
function envelopeText(text: string, tag: string): string | null {
  const header = ENVELOPE_HEADERS.find((h) => text.startsWith(h));
  let body = header === undefined ? text : text.slice(header.length);
  if (!body.startsWith(`<${tag}`)) return null;
  const close = `</${tag}>`;
  const end = body.lastIndexOf(close);
  if (end >= 0) body = body.slice(0, end + close.length);
  return body.replace(new RegExp(`^<${tag}[^>]*>\\n`), '').replace(new RegExp(`\\n</${tag}>$`), '');
}

const LATE_RESULT = /^<task-notification>\n<tool-use-id>[^\n]*<\/tool-use-id>\n<task-type>tool_call<\/task-type>\n/; // `fMt`, near line 433387
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>' };
// The text of a carrier's first element of the name, as the engine's task renderer reads it; null when it has none.
const tagText = (text: string, name: string): string | null => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1] ?? null;
// A speaker's name as the engine draws it (`sw`, near line 648548): format and control characters dropped, trimmed, cut to 64.
function speakerName(name: string, fallback: string): string {
  const clean = [...name.replace(/[\p{Cf}\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/gu, '').trim()];
  return clean.length === 0 ? fallback : clean.length > 64 ? `${clean.slice(0, 64).join('')}…` : clean.join('');
}
