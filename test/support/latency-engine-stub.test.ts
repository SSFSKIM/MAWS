// The local-latency bench's engine (test/support/latency-engine-stub.mjs; P5 O1, M1) proved before any Mac run: the real
// engine host's Session drives it over the real process transport, through the wrapper e2e/local-latency.spec.ts writes,
// from launch to ready, through a context read and two whole turns, and stops it. Every control answer the stub plays is
// read by the host's own response schemas on the way (controls.ts), so a recorded answer the host refuses fails here.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import type { SessionEvent } from '@shared/graph/events';
import { MemoryJournal } from '../../src/engine-host/conformance/scripted-transport';
import { getContextUsage } from '../../src/engine-host/controls';
import { buildLaunch, RELAY_URL } from '../../src/engine-host/launch';
import { EngineSession, SESSION_START_HOOK_MS } from '../../src/engine-host/session';
import { MAX_LINE_CHARS, spawnEngine } from '../../src/engine-host/transport';
import { FIXTURE_ENGINE_VERSION } from './engine-pin';
import { LATENCY_STUB_PACE_MS, markerOf, writeLatencyEngine } from './latency-engine';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function scratch(): { root: string; bin: string; samples: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-latency-stub-')));
  roots.push(root);
  const samples = join(root, 'samples.jsonl');
  return { root, samples, bin: writeLatencyEngine(join(root, 'latency-engine'), samples) };
}
const samplesOf = (path: string) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { turn: number; k: number; writtenAt: number });

describe('the latency engine stub', () => {
  it('answers --version in the pinned format, as the engine host probes it', () => {
    const { bin } = scratch();
    expect(execFileSync(bin, ['--version'], { encoding: 'utf8' })).toBe(`${FIXTURE_ENGINE_VERSION} (Claude Code)\n`);
  });

  it('exits 70 naming a control its table does not hold, so a missing answer is a launch failure, not a hang', async () => {
    const { bin } = scratch();
    const child = spawn(bin, ['--input-format', 'stream-json'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: 'r-1', request: { subtype: 'mcp_toggle', serverName: 'x', enabled: false } })}\n`);
    const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
    expect(code).toBe(70);
    expect(stderr).toMatch(/no recorded answer for control_request mcp_toggle/);
  });

  it("reaches ready under the host's Session, answers a context read, plays two whole turns of 300 paced markers, and ends on end_session", { timeout: 60_000 }, async () => {
    const { root, bin, samples } = scratch();
    const spec = LaunchSpecSchema.parse({
      appSessionId: 'latency-bench', cwd: root, additionalDirectories: [], model: null, effort: null, permissionMode: 'default', gateway: 'direct', subagentModel: null,
      resume: null, sessionId: randomUUID(), trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null, replay: null,
    });
    const plan = buildLaunch(spec, { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root }, { relayUrl: RELAY_URL, bin, engineVersion: FIXTURE_ENGINE_VERSION, spawnerPid: process.pid });
    const journal = new MemoryJournal();
    const logs: string[] = [];
    const session = new EngineSession({ spec, plan, spawn: (p) => spawnEngine(p, { maxLineChars: MAX_LINE_CHARS }), journal, log: (m) => logs.push(m), sessionStartHookMs: () => Promise.resolve(SESSION_START_HOOK_MS) });
    const events: SessionEvent[] = [];
    session.on('events', (batch: SessionEvent[]) => events.push(...batch));
    // A poll every 20 ms until `done`, failing after `ms` or when the case ends first (its `finally` aborts every poll).
    const polls = new AbortController();
    const until = (label: string, done: () => boolean, ms = 20_000) => new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + ms;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (error: Error | null) => {
        clearTimeout(timer);
        polls.signal.removeEventListener('abort', cancel);
        if (error) reject(error);
        else resolve();
      };
      const cancel = () => settle(new Error(`cancelled while waiting for ${label}`));
      polls.signal.addEventListener('abort', cancel, { once: true });
      const check = () => {
        if (done()) settle(null);
        else if (Date.now() > deadline) settle(new Error(`timed out after ${ms} ms waiting for ${label}`));
        else timer = setTimeout(check, 20);
      };
      check();
    });
    const meta = () => journal.rows.filter((r) => r.direction === 'meta').map((r) => r.frame as { event: string; verified?: string });
    const statusChecks = () => meta().filter((m) => m.event === 'status_check').map((m) => m.verified);

    try {
      await session.start();
      expect(session.lifecycle).toBe('ready');
      const usage = await getContextUsage(session.control!, { detail: 'summary' });
      expect(usage.totalTokens).toBeGreaterThan(0);

      for (const turn of [1, 2]) {
        await session.send(`latency bench turn ${turn}`);
        await until(`turn ${turn}'s end`, () => events.filter((e) => e.kind === 'turn.ended').length >= turn);
      }
      await until('the third gateway check', () => statusChecks().length >= 3); // the check after the last turn's result answers after it

      const subtypes = journal.rows.filter((r) => r.direction === 'out' && (r.frame as { type?: string }).type === 'control_request').map((r) => (r.frame as { request: { subtype: string } }).request.subtype);
      expect(new Set(subtypes)).toEqual(new Set(['initialize', 'set_max_thinking_tokens', 'get_status', 'get_context_usage']));
      expect(meta().map((m) => m.event)).not.toContain('parse_error');
      expect(statusChecks()).toEqual(['direct', 'direct', 'direct']); // at ready and after each human turn
      expect(events.filter((e) => e.kind === 'frame.unknown' || e.kind === 'error.raised' || e.kind === 'notice.posted')).toEqual([]);
      expect(session.status()).toMatchObject({ process: 'ready', engineSessionId: spec.sessionId, cwd: root, gateway: { verified: 'direct' }, turn: null });

      const messageIds = new Set<string>();
      for (const turn of [1, 2]) {
        const markers = Array.from({ length: 300 }, (_, k) => markerOf(turn, k + 1));
        const userUuid = (events.filter((e) => e.kind === 'turn.started')[turn - 1] as Extract<SessionEvent, { kind: 'turn.started' }>).userMessageUuid;
        const deltas = events.filter((e): e is Extract<SessionEvent, { kind: 'assistant.block.delta' }> => e.kind === 'assistant.block.delta' && e.userMessageUuid === userUuid);
        expect(deltas.map((e) => e.textDelta)).toEqual(markers);
        const complete = events.filter((e): e is Extract<SessionEvent, { kind: 'assistant.block.complete' }> => e.kind === 'assistant.block.complete' && e.userMessageUuids.includes(userUuid!));
        expect(complete).toHaveLength(1);
        expect(complete[0]!.block).toEqual({ type: 'text', text: markers.join('') }); // the completion keeps every streamed marker
        messageIds.add(complete[0]!.apiMessageId);
        const result = events.filter((e): e is Extract<SessionEvent, { kind: 'turn.ended' }> => e.kind === 'turn.ended')[turn - 1]!;
        expect(result).toMatchObject({ result: 'success', isError: false, resultText: markers.join(''), userMessageUuids: [userUuid] });
        const rows = samplesOf(samples).filter((s) => s.turn === turn);
        expect(rows.map((s) => s.k)).toEqual(markers.map((_, k) => k + 1));
        expect(rows.at(-1)!.writtenAt - rows[0]!.writtenAt).toBeGreaterThanOrEqual(299 * LATENCY_STUB_PACE_MS - 5); // paced (Node's timers keep whole milliseconds)
      }
      expect(messageIds.size).toBe(2); // each turn its own message

      const stopped = await session.stop('stop');
      expect(stopped).toMatchObject({ exited: true });
      expect(session.status().exit).toMatchObject({ code: 0 });
      expect(logs.filter((line) => /failed|not handled/.test(line))).toEqual([]);
    } finally {
      polls.abort();
      if (session.lifecycle !== 'exited') await session.stop('stop'); // a failed case still ends its engine
    }
  });
});
