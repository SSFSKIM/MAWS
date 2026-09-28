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
import { createRedactor, JOURNAL_MAX_BYTES, JournalWriter } from '../../../src/engine-host/journal';
import { buildLaunch, ENGINE_BIN, ENGINE_VERSION, RELAY_URL, spawnMeta, type LaunchPlan } from '../../../src/engine-host/launch';
import { checkRelay } from '../../../src/engine-host/relay-health';
import { MAX_LINE_CHARS, spawnEngine, type EngineTransport } from '../../../src/engine-host/transport';

export const LIVE_MAX_BUDGET_USD = 0.5;
export const LIVE_APP_VERSION = '0.0.0-live';

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

// The live default: the real X6 contract through the gateway, auto mode, Sonnet, a pinned session id and the budget cap.
export function liveSpec(cwd: string, overrides: Partial<LaunchSpec> = {}): LaunchSpec {
  return LaunchSpecSchema.parse({
    appSessionId: `live-${randomUUID().slice(0, 8)}`,
    cwd,
    additionalDirectories: [],
    model: 'sonnet',
    effort: null,
    permissionMode: 'auto',
    gateway: 'gateway',
    subagentModel: null,
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
  const journal = new JournalWriter(join(ctx.userData, 'engine-host', 'journal', spec.appSessionId), plan.launchId, {
    maxBytes: JOURNAL_MAX_BYTES,
    redact: createRedactor(captured),
  });
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
