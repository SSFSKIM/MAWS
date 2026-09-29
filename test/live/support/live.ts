// Support for the live suite (C3 execution document, Acceptance item 3; vitest project `live`, `MAWS_LIVE=1`): the
// gate (MAWS_LIVE, the pinned binary answering its version, the relay answering /api/hello), scratch git repositories
// like the probe's `scratch()`, the default live LaunchSpec (gateway, auto, Sonnet, `--max-budget-usd 0.50`), and a
// raw process runner for the M1 case that speaks to the transport directly (the EngineSession-backed `withSession`
// arrives with M3, when a session exists). Every process runs in a scratch directory under the OS temp dir, never in
// the owner's projects.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import { captureShellEnvironment } from '@shared/host/shell-env';
import type { JournalRow } from '@shared/wire/journal';
import { JOURNAL_MAX_BYTES, JournalWriter } from '../../../src/engine-host/journal';
import { buildLaunch, ENGINE_BIN, ENGINE_VERSION, RELAY_URL, spawnMeta, type LaunchPlan } from '../../../src/engine-host/launch';
import { checkRelay } from '../../../src/engine-host/relay-health';
import { MAX_LINE_CHARS, spawnEngine, type EngineTransport } from '../../../src/engine-host/transport';

export const LIVE_MAX_BUDGET_USD = 0.5;
export const LIVE_APP_VERSION = '0.0.0-live';

// The probe's `redact`, applied when a live run's journal is exported as a pass-3 fixture (M6), never by the
// production writer (the journal is a faithful record; Interfaces, Journal): values of environment keys that look
// secret (8+ characters, longest first so a value containing another is replaced whole), then `sk-ant-…` keys, then
// e-mail addresses other than local placeholders.
export function createRedactor(env: Record<string, string>): (text: string) => string {
  const secrets = Object.entries(env)
    .filter(([key, value]) => /TOKEN|KEY|SECRET|PASSWORD/i.test(key) && value.length >= 8)
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);
  return (text) => {
    let out = text;
    for (const secret of secrets) out = out.split(secret).join('[REDACTED]');
    return out
      .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[REDACTED]')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/g, (m) => (/@(localhost|redacted\.invalid)$/.test(m) ? m : 'owner@redacted.invalid'));
  };
}

// Redacts a journal file's text line by line; `env` defaults to the process environment (the exporter's shell).
export function redactJournal(text: string, env: Record<string, string> = stringEnv(process.env)): string {
  const redact = createRedactor(env);
  return text
    .split('\n')
    .map((line) => redact(line))
    .join('\n');
}

// The provenance every pass-3 fixture C3 exports carries first (M6).
export const PROVENANCE = { charter: 'docs/charter.md', child: 'C3', pin: '87f8c7881119ea670901205dae35917d3751459c' } as const;

// A live journal as a checked-in fixture: the provenance meta row first, at seq 0 so every live row keeps its seq (a
// pin written against the live journal reads the same against the fixture), then the whole file through the probe's
// redaction, the `spawn` row included.
export function exportFixture(journalText: string, env: Record<string, string> = stringEnv(process.env), at = new Date().toISOString()): string {
  const provenance = JSON.stringify({ seq: 0, direction: 'meta', at, frame: { event: 'provenance', ...PROVENANCE } });
  const body = journalText.endsWith('\n') ? journalText : `${journalText}\n`;
  return redactJournal(`${provenance}\n${body}`, env);
}

const isMainResult = (row: JournalRow): row is JournalRow & { frame: { total_cost_usd?: unknown; num_turns?: unknown } } => {
  const frame = row.frame as { type?: unknown; parent_tool_use_id?: unknown } | null;
  return row.direction === 'in' && frame?.type === 'result' && (frame.parent_tool_use_id ?? null) === null;
};

// What one process cost: the engine reports `total_cost_usd` cumulatively per process, so the last main-lane figure
// (the largest) is the process's; turns are the main-lane results that were turns (not `!` echo receipts).
export function journalCost(rows: JournalRow[]): { costUsd: number; turns: number } {
  let costUsd = 0;
  let turns = 0;
  for (const row of rows) {
    if (!isMainResult(row)) continue;
    const cost = row.frame.total_cost_usd;
    if (typeof cost === 'number' && cost > costUsd) costUsd = cost;
    if (typeof row.frame.num_turns === 'number' && row.frame.num_turns > 0) turns += 1;
  }
  return { costUsd, turns };
}

// Every inbound frame type and `system` subtype a journal carries, with the seqs (M6 records what the live runs produce).
export function frameInventory(rows: JournalRow[]): { systemSubtypes: Map<string, number[]>; types: Map<string, number[]> } {
  const systemSubtypes = new Map<string, number[]>();
  const types = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, key: string, seq: number) => {
    const seqs = map.get(key);
    if (seqs) seqs.push(seq);
    else map.set(key, [seq]);
  };
  for (const row of rows) {
    if (row.direction !== 'in') continue;
    const frame = row.frame as { type?: unknown; subtype?: unknown } | null;
    if (typeof frame?.type !== 'string') continue;
    add(types, frame.type, row.seq);
    if (frame.type === 'system' && typeof frame.subtype === 'string') add(systemSubtypes, frame.subtype, row.seq);
  }
  return { systemSubtypes, types };
}

// The run's cost, journal by journal, and the cap the owner set for a single run (stop and report past it).
export class LiveLedger {
  readonly entries: { label: string; journalPath: string; costUsd: number; turns: number }[] = [];
  constructor(readonly capUsd: number) {}

  add(label: string, journalPath: string, rows: JournalRow[]): { costUsd: number; turns: number } {
    const cost = journalCost(rows);
    this.entries.push({ label, journalPath, ...cost });
    return cost;
  }

  get total(): number {
    return this.entries.reduce((sum, e) => sum + e.costUsd, 0);
  }

  summary(): string {
    return `live cost: total_cost_usd sum = $${this.total.toFixed(2)} across ${this.entries.reduce((sum, e) => sum + e.turns, 0)} turns`;
  }

  assertUnderCap(): void {
    if (this.total >= this.capUsd) throw new Error(`live cost cap $${this.capUsd.toFixed(2)} reached: $${this.total.toFixed(2)} spent; stopping the run`);
  }
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (typeof value === 'string') out[key] = value;
  return out;
}

export interface LiveContext {
  userData: string; // the test's temp userData; journals live under <userData>/engine-host/journal
  scratch(): string; // a fresh git repository with one commit, under the OS temp dir
}

export async function liveGate(): Promise<{ skip: string } | LiveContext> {
  if (process.env.MAWS_LIVE !== '1') return { skip: 'live tests skipped: MAWS_LIVE is not 1' };
  if (!existsSync(ENGINE_BIN)) return { skip: `live tests skipped: engine binary missing at ${ENGINE_BIN}` };
  let version: string;
  try {
    version = execFileSync(ENGINE_BIN, ['--version'], { encoding: 'utf8', timeout: 15_000 }).trim();
  } catch (error) {
    return { skip: `live tests skipped: ${ENGINE_BIN} --version failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!version.startsWith(ENGINE_VERSION)) return { skip: `live tests skipped: engine reports ${version}, expected ${ENGINE_VERSION}` };
  const health = await checkRelay(RELAY_URL);
  if (!health.ok) return { skip: `live tests skipped: relay at ${RELAY_URL} unreachable — start ClaudeUsage` };
  const userData = mkdtempSync(join(tmpdir(), 'maws-live-'));
  return {
    userData,
    scratch() {
      const dir = mkdtempSync(join(tmpdir(), 'maws-live-scratch-'));
      writeFileSync(join(dir, 'one.txt'), 'ONE\n');
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['add', 'one.txt'], { cwd: dir });
      execFileSync('git', ['-c', 'user.name=Live', '-c', 'user.email=live@localhost', 'commit', '-qm', 'seed'], { cwd: dir });
      return dir;
    },
  };
}

// The live default: the real X6 contract through the gateway, auto mode, Sonnet (subagents too), a pinned session id and
// the budget cap.
export function liveSpec(cwd: string, overrides: Partial<LaunchSpec> = {}): LaunchSpec {
  return LaunchSpecSchema.parse({
    appSessionId: `live-${randomUUID().slice(0, 8)}`,
    cwd,
    additionalDirectories: [],
    model: 'sonnet',
    effort: null,
    permissionMode: 'auto',
    gateway: 'gateway',
    subagentModel: 'sonnet', // the owner's shell exports CLAUDE_CODE_SUBAGENT_MODEL=opus; the live budget is a Sonnet one
    resume: null,
    sessionId: randomUUID(),
    trust: null,
    mcpConfig: null,
    extraSettings: null,
    maxBudgetUsd: LIVE_MAX_BUDGET_USD,
    replay: null,
    ...overrides,
  });
}

type ControlResponse = { subtype: 'success'; request_id: string; response?: unknown } | { subtype: 'error'; request_id: string; error: string };

export interface RawProcess {
  plan: LaunchPlan;
  transport: EngineTransport;
  journal: JournalWriter;
  rows: JournalRow[]; // every row journaled so far, in order
  stderr: string[];
  request(subtype: string, payload?: Record<string, unknown>, timeoutMs?: number): Promise<ControlResponse>;
}

// Spawns the plan with the M1 wiring (journal the spawn row, spawn, journal every frame in and out, correlate control
// responses by request id), runs `fn`, then ends the process (stdin end, 5 s, SIGTERM, 3 s, SIGKILL) and prints the
// journal path. Sends nothing on its own: the caller decides what reaches the engine.
export async function withRawProcess(ctx: LiveContext, spec: LaunchSpec, fn: (p: RawProcess) => Promise<void>): Promise<{ journalPath: string; rows: JournalRow[] }> {
  const captured = await captureShellEnvironment();
  const plan = buildLaunch(spec, captured, { relayUrl: RELAY_URL, engineVersion: ENGINE_VERSION });
  const journal = new JournalWriter(join(ctx.userData, 'engine-host', 'journal', spec.appSessionId), plan.launchId, { maxBytes: JOURNAL_MAX_BYTES });
  const rows: JournalRow[] = [];
  const stderr: string[] = [];
  const pending = new Map<string, (response: ControlResponse) => void>();
  const log = (direction: JournalRow['direction'], frame: unknown) => {
    const row = journal.row(direction, frame);
    rows.push(row);
    return row;
  };

  log('meta', spawnMeta(plan, { appVersion: LIVE_APP_VERSION }));
  const transport = spawnEngine(plan, { maxLineChars: MAX_LINE_CHARS });

  const reading = (async () => {
    for await (const item of transport.frames) {
      if (item.error) {
        log('meta', { event: item.error.kind, message: item.error.message, length: item.error.length, typeGuess: item.error.typeGuess });
        continue;
      }
      log('in', item.frame);
      const frame = item.frame as { type?: string; response?: ControlResponse };
      if (frame.type === 'control_response' && frame.response) pending.get(frame.response.request_id)?.(frame.response);
    }
  })();
  const readingStderr = (async () => {
    for await (const line of transport.stderr) {
      stderr.push(line);
      log('stderr', { text: line });
    }
  })();

  let counter = 0;
  const request = (subtype: string, payload: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<ControlResponse> => {
    const request_id = `${plan.launchId}-${++counter}`;
    return new Promise<ControlResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(request_id);
        reject(new Error(`${subtype} unanswered after ${timeoutMs} ms; stderr: ${stderr.join(' | ')}`));
      }, timeoutMs);
      pending.set(request_id, (response) => {
        clearTimeout(timer);
        pending.delete(request_id);
        resolve(response);
      });
      const frame = { type: 'control_request' as const, request_id, request: { subtype, ...payload } };
      log('out', frame);
      transport.write(frame).catch((error: Error) => {
        clearTimeout(timer);
        pending.delete(request_id);
        reject(error);
      });
    });
  };

  const settle = (ms: number) => Promise.race([transport.exited.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), ms))]);
  try {
    await fn({ plan, transport, journal, rows, stderr, request });
  } finally {
    transport.endInput();
    if (!(await settle(5_000))) {
      transport.kill('SIGTERM');
      if (!(await settle(3_000))) {
        transport.kill('SIGKILL');
        await settle(2_000);
      }
    }
    const exit = await transport.exited;
    await Promise.all([reading, readingStderr]);
    log('meta', { event: 'exit', code: exit.code, signal: exit.signal, reason: 'stop', lostAttentionCount: 0 });
    await journal.close();
    console.log(`   journal: ${journal.path}`);
  }
  return { journalPath: journal.path, rows };
}
