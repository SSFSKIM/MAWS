// The tool-time guard (X34; the P4 spec docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.2 "The tool-time guard"
// and §6 X34; the P4 interface ledger §2; P4-A2's execution document R11): per `maws` tool call, MAWS's own execution
// is the span in a launch's X8 journal from the `mcp_message` frame carrying `tools/call` in to the `control_response`
// frame out that answers it, matched by the control request id. That span measures MAWS and never the model or the
// server: the engine sends `tools/call` only once the model's stream has ended (a server-side hold after the tool_use
// block is upstream of it), and nothing MAWS-side runs before it (research/p4-edit-speed-grounding.md §2.3). Every paid
// live spec that drives an `artifact_*` call reads it after its last turn through `guardToolTime`, and
// test/live/tool-time-heavy.live.test.ts holds the heaviest known cases under it.
// `readToolSpans` is built at A2; A1 builds the same reader (P4 Decision Log 19); the architect keeps one. Both are
// written to the ledger's shape and read a launch's base file with its rotations; this one keeps every span's fields
// whole and returns a call never answered apart (`readToolCalls`), where A1's keeps it as a span with null times.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';

// P4-A2 (X34): the store tools' bound per call, and the median a spec's calls must stay under, half of it. Grounding:
// the owner's sitting of 2026-10-19 timed MAWS's execution of every `artifact_*` call at 0.02 to 0.19 s, at a 1-minute
// load of 108 to 126 on the MacBook's 10 cores (research/p4-edit-speed-grounding.md §2.3), and the latest recorded live
// journals (P3-C 2026-10-15, P3-E1 2026-10-16, P3-E2 2026-10-17, P4-A1's bench shakedowns 2026-10-19) at 1 to 55 ms;
// 1,000 ms is about five times the sitting's slowest. Provisional (P4 Decision Logs 15.2 and 16.3), confirmed or
// re-based from the heavy fixture's first run (test/live/tool-time-heavy.live.test.ts). Its first runs, 2026-10-19, on
// the MacBook (10 cores): four at a 1-minute load of 18 to 25, E1's 24-board design created in 484 to 727 ms, read in
// 136 to 178 ms and published whole in 463 to 611 ms, S6's 100-slide deck created in 241 to 338 ms, read in 45 to 51 ms
// and published whole in 285 to 336 ms, S7b's 200-page document read whole in four calls of 27 to 233 ms and edited by
// a 20-op batch in 49 to 89 ms, the run's median 138 to 178 ms; one at load 83 to 85, the design's create 667 ms and
// publish 851 ms, the deck's 453 and 747 ms, the document's reads 36 to 249 ms and batch 72 ms, the median 216 ms. The
// design's calls are nearest the bound, and at the MacBook's usual load (90 to 126) would reach it.
export const TOOL_TIME_BOUND_MS = 1_000;
export const TOOL_TIME_MEDIAN_MS = 500;

// The thirteen store tools the bound guards (P4 Decision Log 16 (3)).
export const GUARDED_TOOLS = [
  'artifact_create',
  'artifact_read',
  'artifact_edit',
  'artifact_publish',
  'artifact_dataset',
  'artifact_comments',
  'artifact_reply',
  'artifact_resolve',
  'artifact_list',
  'artifact_search',
  'artifact_describe_type',
  'artifact_upload_asset',
  'artifact_list_assets',
] as const;

// P4-A2 (X34): the two tools that render through main's hidden window (P3 §4.8), under a bound of their own, since the
// store bound would guard nothing there; per call, no median (a spec makes one to four of them). Provisional, from the
// latest recorded live journals: P3-C's deck export 290 ms (2026-10-15), P3-E1's design exports 7, 323, 660 and 669 ms
// (2026-10-16), E2's one recorded screenshot 102 ms (spikes/protocol-probe/fixtures/pass3/p1-maws-artifacts.jsonl);
// five times the slowest, rounded up to the half second, as the store bound stands to the sitting's slowest. Re-based
// from the live specs' timings at A2's first live run (M8).
export const RENDER_TOOLS = ['artifact_export', 'artifact_screenshot'] as const;
export const RENDER_TOOL_TIME_BOUND_MS = 3_500;

export interface ToolSpan {
  toolUseId: string | null; // the engine's tool_use id (`_meta["claudecode/toolUseId"]`), null when the frame carries none
  name: string; // the MCP tool name as called (`artifact_edit`), without the engine's `mcp__maws__` prefix
  requestSeq: number; // the `tools/call` row's seq
  responseSeq: number; // the answering `control_response` row's seq
  startedAt: string; // the `tools/call` row's `at`
  answeredAt: string; // the answer's `at`
  ms: number; // answeredAt − startedAt
}

// A `tools/call` the journal holds no answer to: once the spec's last turn has ended, only a call the engine withdrew
// (MAWS answers nothing to a cancelled request; tool-server/server.ts `cancel`), counted beside the spans, never timed.
export type UnansweredCall = Pick<ToolSpan, 'toolUseId' | 'name' | 'requestSeq' | 'startedAt'>;

type ToolsCall = { type?: string; request_id?: string; request?: { subtype?: string; message?: { method?: string; params?: { name?: string; _meta?: Record<string, unknown> } } } };
type Answer = { type?: string; response?: { request_id?: string } };

// A launch's files in order: the given file and, when it is a base file (`<launchId>.jsonl`), its rotations
// (`<launchId>.<n>.jsonl`, the writer's continuation past JOURNAL_MAX_BYTES with the seq continuing), so a call answered
// after a rotation is still one span.
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

// Every `tools/call` of a launch (its journal's path, or rows already read), in journal order: the answered ones as
// spans, the rest apart. Other `mcp_message` methods (`tools/list`, notifications) are not tool calls and are left out,
// and only an `out` `control_response` answers (a recording's `in` echo of it does not).
export function readToolCalls(journal: string | readonly JournalRow[]): { spans: ToolSpan[]; unanswered: UnansweredCall[] } {
  const rows = typeof journal === 'string' ? launchFiles(journal).flatMap(rowsOf) : journal;
  const calls: (UnansweredCall & Partial<ToolSpan>)[] = [];
  const open = new Map<string, UnansweredCall & Partial<ToolSpan>>();
  for (const row of rows) {
    if (row.direction === 'in') {
      const frame = row.frame as ToolsCall;
      const message = frame.request?.message;
      if (frame.type !== 'control_request' || frame.request?.subtype !== 'mcp_message' || message?.method !== 'tools/call' || typeof frame.request_id !== 'string') continue;
      const toolUseId = message.params?._meta?.['claudecode/toolUseId'];
      const call = { toolUseId: typeof toolUseId === 'string' ? toolUseId : null, name: String(message.params?.name ?? ''), requestSeq: row.seq, startedAt: row.at };
      calls.push(call);
      open.set(frame.request_id, call);
    } else if (row.direction === 'out') {
      const frame = row.frame as Answer;
      const requestId = frame.response?.request_id;
      const call = frame.type === 'control_response' && typeof requestId === 'string' ? open.get(requestId) : undefined;
      if (!call) continue;
      open.delete(requestId!);
      Object.assign(call, { responseSeq: row.seq, answeredAt: row.at, ms: Date.parse(row.at) - Date.parse(call.startedAt) });
    }
  }
  return { spans: calls.filter((call): call is ToolSpan => call.ms !== undefined), unanswered: calls.filter((call) => call.ms === undefined) };
}

// The ledger's reader: the answered calls' spans (the unanswered ones through `readToolCalls`).
export function readToolSpans(journal: string | readonly JournalRow[]): ToolSpan[] {
  return readToolCalls(journal).spans;
}

export interface ToolTimeStats {
  calls: number; // the set's spans
  medianMs: number; // 0 when there are none
  maxMs: number;
}

const median = (sorted: number[]): number => {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const fmt = (ms: number) => `${ms.toLocaleString('en-US', { maximumFractionDigits: 1 })} ms`;
const callName = (call: UnansweredCall) => `${call.name} ${call.toolUseId ?? `(seq ${call.requestSeq})`}`;

// The set's numbers and what breaches the bound: every call above `bound`, and the median above `medianBound`.
function measure(spans: readonly ToolSpan[], tools: readonly string[], bound: number, medianBound: number): { stats: ToolTimeStats; problems: string[] } {
  const set = spans.filter((span) => tools.includes(span.name));
  const sorted = set.map((span) => span.ms).sort((a, b) => a - b);
  const stats: ToolTimeStats = { calls: set.length, medianMs: median(sorted), maxMs: sorted.at(-1) ?? 0 };
  const problems = set.filter((span) => span.ms > bound).map((span) => `${callName(span)} took ${fmt(span.ms)}, over the ${fmt(bound)} bound`);
  if (stats.medianMs > medianBound) problems.push(`the median of the ${stats.calls} calls is ${fmt(stats.medianMs)}, over ${fmt(medianBound)}`);
  return { stats, problems };
}

const breach = (problems: string[]) => new Error(`MAWS's tool time is over the X34 bound (test/live/support/tool-time.ts):\n  ${problems.join('\n  ')}`);

// P4-A2 (X34): fails naming every offending call (its tool, its tool_use id and its time) and the median when it is over
// half the bound. `tools` narrows the set (the store tools by default).
export function expectToolTime(spans: readonly ToolSpan[], { bound = TOOL_TIME_BOUND_MS, median: medianBound = TOOL_TIME_MEDIAN_MS, tools = GUARDED_TOOLS }: { bound?: number; median?: number; tools?: readonly string[] } = {}): ToolTimeStats {
  const { stats, problems } = measure(spans, tools, bound, medianBound);
  if (problems.length > 0) throw breach(problems);
  return stats;
}

export interface ToolTimeSummary {
  spans: ToolSpan[]; // every answered tool call of the journal, guarded or not
  guarded: number; // the store tools' spans
  render: number; // the render tools' spans
  medianMs: number; // the store tools'
  maxMs: number; // the store tools'
  renderMaxMs: number;
  unanswered: number; // guarded or render calls with no answer (withdrawn), counted, never held against a bound
  line: string; // the summary as a spec notes it
}

// P4-A2 (X34): the guard a paid live spec runs after its last turn: the store bound and its median over GUARDED_TOOLS,
// RENDER_TOOL_TIME_BOUND_MS per call over RENDER_TOOLS, every other tool ignored; throws one error naming every breach,
// else returns the summary for the spec's notes.
export function guardToolTime(journal: string | readonly JournalRow[]): ToolTimeSummary {
  const { spans, unanswered: open } = readToolCalls(journal);
  const store = measure(spans, GUARDED_TOOLS, TOOL_TIME_BOUND_MS, TOOL_TIME_MEDIAN_MS);
  const render = measure(spans, RENDER_TOOLS, RENDER_TOOL_TIME_BOUND_MS, Number.POSITIVE_INFINITY);
  const problems = [...store.problems, ...render.problems];
  if (problems.length > 0) throw breach(problems);
  const unanswered = open.filter((call) => ([...GUARDED_TOOLS, ...RENDER_TOOLS] as readonly string[]).includes(call.name));
  const line =
    `${store.stats.calls} store calls, median ${fmt(store.stats.medianMs)}, max ${fmt(store.stats.maxMs)} (bound ${fmt(TOOL_TIME_BOUND_MS)}, median ${fmt(TOOL_TIME_MEDIAN_MS)}); ` +
    `${render.stats.calls} render calls, max ${fmt(render.stats.maxMs)} (bound ${fmt(RENDER_TOOL_TIME_BOUND_MS)})` +
    (unanswered.length > 0 ? `; unanswered (withdrawn): ${unanswered.map(callName).join(', ')}` : '');
  return { spans, guarded: store.stats.calls, render: render.stats.calls, medianMs: store.stats.medianMs, maxMs: store.stats.maxMs, renderMaxMs: render.stats.maxMs, unanswered: unanswered.length, line };
}
