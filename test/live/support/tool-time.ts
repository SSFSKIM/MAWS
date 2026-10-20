// X34's journal reader (P4 spec §4.2 "The tool-time guard", §6 X34; the P4 interface ledger §2; built by P4-A1 per P4
// Decision Log 19, so the parity bench's arm and A2's guard read MAWS's tool time one way): per `maws` tool call, the
// span in a launch's X8 journal from the `mcp_message` frame carrying `tools/call` in to the `control_response` frame
// out that answers it, matched by the control request id. That span is MAWS's own execution, by construction: the
// engine sends `tools/call` only after the model's stream has ended (a server-side hold after the tool_use block is
// upstream of it), and nothing MAWS-side runs before it. A2 adds the bounds and `expectToolTime` beside this reader.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';

export interface ToolSpan {
  toolUseId: string | null; // the engine's tool_use id (`_meta["claudecode/toolUseId"]`), null when the frame carries none
  name: string; // the MCP tool name as called (`artifact_edit`), without the engine's `mcp__maws__` prefix
  requestSeq: number; // the `tools/call` row's seq
  responseSeq: number | null; // the answering `control_response` row's seq; null when the journal holds no answer
  startedAt: string; // the `tools/call` row's `at`
  answeredAt: string | null; // the answer's `at`; null when unanswered
  ms: number | null; // answeredAt − startedAt; null when unanswered (a guard names such a call rather than passing it)
}

type ToolsCall = { type?: string; request_id?: string; request?: { subtype?: string; message?: { method?: string; params?: { name?: string; _meta?: Record<string, unknown> } } } };
type Answer = { type?: string; response?: { request_id?: string } };

// The launch's files in order: the given file, and when it is a base file (`<launchId>.jsonl`) its rotations
// (`<launchId>.<n>.jsonl`, the writer's continuation at JOURNAL_MAX_BYTES, seq continuing), so a call answered after a
// rotation is still one span.
function launchFiles(journalPath: string): string[] {
  const base = /^(.+?)\.jsonl$/.exec(basename(journalPath));
  const dir = dirname(journalPath);
  if (!base || /\.\d+$/.test(base[1]!) || !existsSync(dir)) return [journalPath];
  const rotation = new RegExp(`^${base[1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)\\.jsonl$`);
  const rotations = readdirSync(dir)
    .map((name) => ({ name, n: Number(rotation.exec(name)?.[1] ?? NaN) }))
    .filter((file) => Number.isInteger(file.n))
    .sort((a, b) => a.n - b.n)
    .map((file) => join(dir, file.name));
  return [journalPath, ...rotations];
}

function rowsOf(file: string): JournalRow[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => parseJournalRow(JSON.parse(line)));
}

// Every `tools/call` of the launch in journal order, each with its answer. Other `mcp_message` methods (`tools/list`,
// notifications) are not tool calls and are left out.
export function readToolSpans(journalPath: string): ToolSpan[] {
  const spans: ToolSpan[] = [];
  const open = new Map<string, ToolSpan>();
  for (const row of launchFiles(journalPath).flatMap(rowsOf)) {
    if (row.direction === 'in') {
      const frame = row.frame as ToolsCall;
      const message = frame.request?.message;
      if (frame.type !== 'control_request' || frame.request?.subtype !== 'mcp_message' || message?.method !== 'tools/call' || typeof frame.request_id !== 'string') continue;
      const toolUseId = message.params?._meta?.['claudecode/toolUseId'];
      const span: ToolSpan = { toolUseId: typeof toolUseId === 'string' ? toolUseId : null, name: String(message.params?.name ?? ''), requestSeq: row.seq, responseSeq: null, startedAt: row.at, answeredAt: null, ms: null };
      spans.push(span);
      open.set(frame.request_id, span);
    } else if (row.direction === 'out') {
      const frame = row.frame as Answer;
      const requestId = frame.response?.request_id;
      if (frame.type !== 'control_response' || typeof requestId !== 'string') continue;
      const span = open.get(requestId);
      if (!span) continue;
      open.delete(requestId);
      Object.assign(span, { responseSeq: row.seq, answeredAt: row.at, ms: Date.parse(row.at) - Date.parse(span.startedAt) });
    }
  }
  return spans;
}
