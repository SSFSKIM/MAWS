// The local lane A driver against the fake bridge (P5 O9 M2, "Proves"): discovery, the bridge's states, the state stream
// and its backoff, watches, each control's body, the delivery lane, decisions, and the guard on the owner's sminos.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { ClientRef } from '@shared/ipc/client';
import { endableClientRef } from '@shared/ipc/client';
import type { LaneAState, PlaneMessage } from '@shared/ipc/schema/lane-a';
import { FULL_CAPABILITIES, startFakeBridge, type FakeBridge } from '../../../test/support/fake-bridge';
import { GitFixture } from '../../../test/support/git-fixture';
import { createLaneADriver, type LaneADriver, type LaneAView } from './driver';

const MACHINE = 'machineref0123456789';
const APP = 'app-1' as AppSessionId;
const ENGINE = 'e5b1c0de-0000-4000-8000-000000000001';
const terminal = { kind: 'terminal' as const, pid: 4242 };

const scratch: string[] = [];
const bridges: FakeBridge[] = [];
const drivers: LaneADriver[] = [];
const tmp = (prefix: string) => {
  const d = mkdtempSync(join('/tmp', prefix)); // short: the socket path must stay under 104 bytes
  scratch.push(d);
  return d;
};

beforeEach(() => {
  vi.stubEnv('SMINOS_HOME', tmp('o9s-'));
  vi.stubEnv('HOME', tmp('o9h-'));
  vi.stubEnv('CLAUDE_CONFIG_DIR', tmp('o9c-'));
  vi.stubEnv('MAWS_USER_DATA', tmp('o9u-'));
});
afterEach(async () => {
  for (const d of drivers.splice(0)) d.stop();
  for (const b of bridges.splice(0)) await b.close().catch(() => {});
  vi.unstubAllEnvs();
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Changed = { appSessionId: string; state: LaneAState | null };
type Plane = { appSessionId: string; watch: string; messages?: PlaneMessage[]; reset?: true; ended?: string };

function harness(home = process.env.SMINOS_HOME!, timing: Record<string, unknown> = {}, transcript: string | null = null) {
  const changes: Changed[] = [];
  const planes: Plane[] = [];
  const driver = createLaneADriver({
    machine: MACHINE,
    home,
    userData: process.env.MAWS_USER_DATA!,
    emit: (name, payload) => (name === 'laneA.changed' ? changes.push(payload as Changed) : planes.push(payload as Plane)),
    log: () => {},
    transcript: async (appId, engine) => (appId === APP && engine === ENGINE ? transcript : null),
    timing: {
      jobsPollMs: 30,
      probeMs: 500, commandWaitMs: 400, requestMs: 500, decisionMs: 500, dirPollMs: 50,
      backoff: { firstMs: 30, maxMs: 120, healthyMs: 60_000 },
      lane: { retryDelaysMs: [20, 40], answerMs: 600, keepMs: 2000, capacity: 8 },
      ...timing,
    },
  });
  drivers.push(driver);
  const state = () => driver.state(APP);
  const live = async () => expect.poll(() => state()?.bridge, { timeout: 3000 }).toBe('live');
  return { driver, changes, planes, state, live, home };
}

async function bridge(options: Partial<Parameters<typeof startFakeBridge>[0]> = {}) {
  const b = await startFakeBridge({ home: process.env.SMINOS_HOME!, session: ENGINE, ...options });
  bridges.push(b);
  return b;
}

const client = (): ClientRef & { end(): void } => endableClientRef(`client-${Math.random()}`);
const messagesOf = (planes: Plane[], watch: string) => planes.filter((p) => p.watch === watch).flatMap((p) => p.messages ?? []);

describe('discovery', () => {
  it('finds a bridge when the session’s holder becomes a terminal, and keeps its state', async () => {
    const b = await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    expect(h.state()).toMatchObject({ appSessionId: APP, engineSessionId: ENGINE, bridge: 'live', reason: null, launch: 'launch-1', sminos: '1.25.0', ops: FULL_CAPABILITIES.ops, controls: FULL_CAPABILITIES.controls });
    expect(h.driver.list()).toHaveLength(1);
    await expect.poll(() => b.subscribers()).toBe(1); // its state stream
  });

  it('finds a bridge whose socket appears after the holder did', async () => {
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await new Promise((r) => setTimeout(r, 100));
    expect(h.state()).toBeNull();
    await bridge();
    await h.live();
  });

  it('leaves a session with no socket, a stale socket, another session’s socket or a path too long without state', async () => {
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    // a stale socket: a file nobody listens on
    mkdirSync(join(process.env.SMINOS_HOME!, 'bridge'), { recursive: true });
    const stale = createServer();
    const path = join(process.env.SMINOS_HOME!, 'bridge', `${ENGINE}.sock`);
    await new Promise<void>((r) => stale.listen(path, () => r()));
    stale.close(); // the file may stay, refusing connections
    writeFileSync(join(process.env.SMINOS_HOME!, 'bridge', `${ENGINE}.json`), '{}'); // a kept file is never probed
    await new Promise((r) => setTimeout(r, 200));
    expect(h.state()).toBeNull();
    rmSync(path, { force: true });
    const other = await startFakeBridge({ home: process.env.SMINOS_HOME!, session: 'another-session' });
    bridges.push(other);
    rmSync(path, { force: true });
    await new Promise((r) => setTimeout(r, 100));
    expect(h.state()).toBeNull();

    const long = tmp(`o9-${'x'.repeat(60)}-`);
    const far = harness(long);
    far.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await new Promise((r) => setTimeout(r, 100));
    expect(far.state()).toBeNull();
  });

  it('is off when the sminos home is refused', async () => {
    await bridge();
    const off = createLaneADriver({ machine: MACHINE, home: Promise.reject(new Error('real home')), userData: process.env.MAWS_USER_DATA!, emit: () => {}, log: () => {} });
    drivers.push(off);
    off.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await new Promise((r) => setTimeout(r, 200));
    expect(off.state(APP)).toBeNull();
    expect(off.list()).toEqual([]);
  });

  it('drops the session, its stream and its state when its holder leaves', async () => {
    const b = await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: { kind: 'none' } });
    expect(h.changes.at(-1)).toEqual({ appSessionId: APP, state: null });
    await expect.poll(() => b.subscribers()).toBe(0);
    expect(h.state()).toBeNull();
  });
});

describe('the bridge’s states', () => {
  it('is observer for a lane B verdict, none for a sminos with no controls, each with its reason', async () => {
    const b = await bridge({ lane: 'match' });
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await expect.poll(() => h.state()?.bridge).toBe('observer');
    expect(h.state()?.reason).toBe('MAWS controls this session');
    expect(b.subscribers()).toBe(0); // no stream: nothing to drive
    expect(await h.driver.interrupt(APP)).toEqual({ state: 'refused', code: 'no-bridge', message: 'MAWS controls this session' });

    b.setStatus({ lane: undefined, capabilities: { ...FULL_CAPABILITIES, sminos: '1.10.0', controls: undefined } });
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: { kind: 'terminal', pid: 9 } }); // another process: probed again
    await expect.poll(() => h.state()?.bridge).toBe('none');
    expect(h.state()?.reason).toMatch(/sminos \(1\.10\.0\) predates MAWS’s controls: update sminos, then run \/reload-plugins/);
  });

  it('turns a starting bridge live through its stream, with no holder or directory change', async () => {
    const b = await bridge({ ready: false, readyWaitMs: 5000 });
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await expect.poll(() => h.state()?.bridge).toBe('starting');
    expect(h.state()?.reason).toBe('the session’s bridge is starting');
    b.setReady(true);
    await h.live();
  });

  it('retries a starting bridge’s refused subscription with backoff until it is ready', async () => {
    const b = await bridge({ ready: false, readyWaitMs: 50 });
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await expect.poll(() => h.state()?.bridge).toBe('starting');
    await new Promise((r) => setTimeout(r, 300)); // several 503s
    b.setReady(true);
    await h.live();
  });

  it('resubscribes its state stream after an end, and the fresh snapshot carries on', async () => {
    const b = await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    b.reset();
    b.raise({ request: 'toolu_1', tool: 'Bash', input: { command: 'ls' } }); // raised while no stream holds
    await expect.poll(() => h.state()?.pending.map((p) => p.request), { timeout: 3000 }).toEqual(['toolu_1']);
    await expect.poll(() => b.subscribers()).toBe(1);
  });

  it('follows the main turn, a subagent’s turn leaving it running, and the override', async () => {
    const b = await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    b.emit({ type: 'turn', phase: 'start', turnId: 't1', agentId: null });
    await expect.poll(() => h.state()?.turn.running).toBe(true);
    b.emit({ type: 'turn', phase: 'start', turnId: 't2', agentId: 'a1' });
    b.emit({ type: 'turn', phase: 'complete', turnId: 't2', agentId: 'a1' });
    b.emit({ type: 'model', model: 'claude-haiku-4-5', effort: 'low' });
    await expect.poll(() => h.state()?.override).toEqual({ model: 'claude-haiku-4-5', effort: 'low' });
    expect(h.state()?.turn.running).toBe(true);
    b.emit({ type: 'turn', phase: 'complete', turnId: 't1', agentId: null });
    await expect.poll(() => h.state()?.turn.running).toBe(false);
  });
});

describe('watches', () => {
  it('seeds each watch from its own snapshot; a second, opened mid-reply, starts from the streamed text', async () => {
    const b = await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    const first = h.driver.watch(APP, client()).watch;
    await expect.poll(() => messagesOf(h.planes, first).map((m) => m.kind)).toEqual(['snapshot']);
    b.emit({ type: 'step', phase: 'start', turnId: 't1', agentId: null, step: 1 });
    b.emit({ type: 'chunk', turnId: 't1', agentId: null, step: 1, chunkIndex: 0, chunk: { index: 0, delta: { text: 'Hello' } } });
    await expect.poll(() => messagesOf(h.planes, first).map((m) => m.kind)).toEqual(['snapshot', 'chunk']);
    const second = h.driver.watch(APP, client()).watch;
    await expect.poll(() => messagesOf(h.planes, second).length).toBe(1);
    const snap = messagesOf(h.planes, second)[0]!;
    expect(snap).toMatchObject({ kind: 'snapshot', sub: second, n: 0, machine: MACHINE, session: ENGINE });
    expect((snap.body as { streaming: { blocks: { text: string }[] }[] }).streaming[0]!.blocks[0]!.text).toBe('Hello');
    // that turn aborts with no step end: the second watch closes the step its snapshot named
    b.emit({ type: 'turn', phase: 'complete', turnId: 't1', agentId: null, reason: 'aborted' });
    await expect.poll(() => messagesOf(h.planes, second).map((m) => m.kind)).toEqual(['snapshot', 'step-end']);
    expect(messagesOf(h.planes, second)[1]!.body).toEqual({ turnId: 't1', agentId: null, step: 1 });
    expect(messagesOf(h.planes, first).map((m) => m.kind)).toEqual(['snapshot', 'chunk', 'step-end']);
  });

  it('announces a reset when a watch’s stream ends, then its fresh snapshot; ends at unwatch and at the page’s end', async () => {
    const b = await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    const page = client();
    const { watch } = h.driver.watch(APP, page);
    await expect.poll(() => messagesOf(h.planes, watch).length).toBe(1);
    await expect.poll(() => b.subscribers()).toBe(2);
    b.reset();
    await expect.poll(() => h.planes.filter((p) => p.watch === watch).map((p) => (p.reset ? 'reset' : p.messages?.[0]?.kind))).toEqual(['snapshot', 'reset', 'snapshot']);
    page.end(); // the page's clientGone
    await expect.poll(() => b.subscribers()).toBe(1);
    const other = h.driver.watch(APP, client()).watch;
    await expect.poll(() => b.subscribers()).toBe(2);
    h.driver.unwatch(APP, other);
    await expect.poll(() => b.subscribers()).toBe(1);
  });

  it('ends a watch when its session leaves lane A, and refuses one on a session with no bridge', async () => {
    await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    const { watch } = h.driver.watch(APP, client());
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: { kind: 'none' } });
    expect(h.planes.at(-1)).toEqual({ appSessionId: APP, watch, ended: 'the session left the terminal' });
    expect(() => h.driver.watch(APP, client())).toThrow(/no bridge/);
  });
});

describe('jobs', () => {
  const row = (r: unknown) => `${JSON.stringify(r)}\n`;
  const shell = (n: number) =>
    row({ type: 'assistant', uuid: `a${n}`, timestamp: `T${n}`, message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${n}`, name: 'Bash', input: { command: `sleep ${n}`, description: `sleep ${n}` } }] } }) +
    row({ type: 'user', uuid: `u${n}`, timestamp: `T${n}`, toolUseResult: { backgroundTaskId: `bshell00${n}` }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${n}`, content: 'Command running in background' }] } });
  const ended = (n: number, status: string) =>
    row({ type: 'attachment', uuid: `n${n}`, timestamp: `E${n}`, attachment: { type: 'queued_command', commandMode: 'task-notification', prompt: `<task-notification><task-id>bshell00${n}</task-id><status>${status}</status></task-notification>` } });
  const jobsOf = (planes: Plane[], watch: string) =>
    messagesOf(planes, watch).filter((m) => m.kind === 'snapshot' || m.kind === 'subagents').map((m) => (m.body as { jobs: { taskId: string; status: string }[] }).jobs.map((j) => `${j.taskId} ${j.status}`));

  async function watched(transcriptRows: string) {
    const path = join(tmp('o9t-'), 'session.jsonl');
    writeFileSync(path, transcriptRows);
    const b = await bridge();
    const h = harness(undefined, {}, path);
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    const { watch } = h.driver.watch(APP, client());
    await expect.poll(() => jobsOf(h.planes, watch).flat().includes('bshell001 running')).toBe(true);
    return { b, h, path, watch };
  }

  it('carries the transcript’s jobs to a watch, and a subagents message each time they change', async () => {
    const { h, path, watch } = await watched(shell(1));
    appendFileSync(path, shell(2));
    await expect.poll(() => jobsOf(h.planes, watch).at(-1)).toEqual(['bshell001 running', 'bshell002 running']);
    appendFileSync(path, ended(1, 'completed'));
    await expect.poll(() => jobsOf(h.planes, watch).at(-1)).toEqual(['bshell001 completed', 'bshell002 running']);
    const last = messagesOf(h.planes, watch).at(-1)!;
    expect(last).toMatchObject({ kind: 'subagents', sub: watch, body: { subagents: [], mcp: [] } });
    const sent = jobsOf(h.planes, watch).length;
    await new Promise((r) => setTimeout(r, 120)); // polls with nothing new send nothing
    expect(jobsOf(h.planes, watch)).toHaveLength(sent);
  });

  it('says a running job exited when the session’s holder ends, before the watch ends', async () => {
    const { h, watch } = await watched(shell(1) + shell(2) + ended(2, 'failed'));
    await expect.poll(() => jobsOf(h.planes, watch).at(-1)).toEqual(['bshell001 running', 'bshell002 failed']);
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: { kind: 'none' } });
    const mine = h.planes.filter((p) => p.watch === watch);
    expect(mine.at(-1)).toEqual({ appSessionId: APP, watch, ended: 'the session left the terminal' });
    expect(jobsOf(h.planes, watch).at(-1)).toEqual(['bshell001 exited', 'bshell002 failed']);
  });

  it('says a running job exited when the session’s bridge goes', async () => {
    const { b, h, watch } = await watched(shell(1));
    await b.close();
    await expect.poll(() => h.planes.some((p) => p.watch === watch && p.ended !== undefined), { timeout: 3000 }).toBe(true);
    expect(jobsOf(h.planes, watch).at(-1)).toEqual(['bshell001 exited']);
  });

  it('stops only a job the transcript holds running; a task it doesn’t hold is the bridge’s to judge', async () => {
    const { b, h } = await watched(shell(1) + shell(2) + ended(2, 'killed'));
    expect(await h.driver.stopTask(APP, 'bshell002')).toEqual({ state: 'refused', code: 'not-running', message: expect.stringMatching(/not running/) as unknown });
    expect(await h.driver.stopTask(APP, 'bshell001')).toMatchObject({ state: 'done' });
    expect(await h.driver.stopTask(APP, 'b-agents1')).toMatchObject({ state: 'done' }); // a subagent's, say
    expect(b.commands.map((c) => c.body)).toEqual([{ op: 'stop', taskId: 'bshell001' }, { op: 'stop', taskId: 'b-agents1' }]);
  });

  it('reads the transcript at a stop no watch follows', async () => {
    const path = join(tmp('o9t-'), 'session.jsonl');
    writeFileSync(path, shell(1) + ended(1, 'completed'));
    const b = await bridge();
    const h = harness(undefined, {}, path);
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    expect(await h.driver.stopTask(APP, 'bshell001')).toMatchObject({ state: 'refused', code: 'not-running' });
    expect(b.commands).toEqual([]);
  });
});

describe('controls', () => {
  async function liveBridge(options: Partial<Parameters<typeof startFakeBridge>[0]> = {}) {
    const b = await bridge(options);
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    return { b, h };
  }

  it('posts each control’s exact body with the launch', async () => {
    const { b, h } = await liveBridge();
    b.answer('command', () => ({ status: 200, body: { ok: true, result: { queued: true, route: 'run', id: 'cmd-x' } } }));
    b.answer('btw', () => ({ status: 200, body: { ok: true, result: { started: true, id: 'cmd-y' } } }));
    b.answer('compact', () => ({ status: 200, body: { ok: true, result: { started: true } } }));
    expect(await h.driver.interrupt(APP)).toMatchObject({ state: 'done' });
    expect(await h.driver.command(APP, 'rename', 'o9')).toEqual({ state: 'done', result: { queued: true, route: 'run', id: 'cmd-x' } });
    expect(await h.driver.btw(APP, 'why?')).toEqual({ state: 'done', result: { started: true, id: 'cmd-y' } });
    const compact = await h.driver.compact(APP, 'keep the file list');
    expect(compact).toMatchObject({ state: 'done', result: { started: true } });
    expect((compact as { result: { id: string } }).result.id).toMatch(/^cmd-/); // the op's id in its later compact messages
    await h.driver.compact(APP);
    await h.driver.stopAgent(APP, 'agent-1');
    await h.driver.tell(APP, 'agent-1', 'stop there');
    await h.driver.stopTask(APP, 'task-1');
    expect(b.commands.map((c) => c.body)).toEqual([
      { op: 'interrupt' },
      { op: 'command', name: 'rename', args: 'o9' },
      { op: 'btw', prompt: 'why?' },
      { op: 'compact', instructions: 'keep the file list' },
      { op: 'compact' },
      { op: 'stop-agent', agentId: 'agent-1' },
      { op: 'tell', agentId: 'agent-1', text: 'stop there' },
      { op: 'stop', taskId: 'task-1' },
    ]);
  });

  it('is refused launch for a session’s earlier process', async () => {
    const { b, h } = await liveBridge();
    b.setStatus({ launch: 'launch-2' }); // the child is another launch now; the driver still holds the first
    expect(await h.driver.interrupt(APP)).toMatchObject({ state: 'refused', code: 'launch' });
  });

  it('answers unknown on a 504 or a lost socket, naming the op’s id when the bridge gave one', async () => {
    const { b, h } = await liveBridge();
    b.answer('interrupt', () => ({ status: 504, body: { error: 'the session did not answer within 10000 ms' } }));
    expect(await h.driver.interrupt(APP)).toMatchObject({ state: 'unknown', why: 'timeout', id: expect.stringMatching(/^cmd-/) as unknown });
    b.answer('btw', () => ({ drop: true }));
    expect(await h.driver.btw(APP, 'q')).toEqual({ state: 'unknown', why: 'gone' });
    expect(b.commands.filter((c) => c.op === 'btw')).toHaveLength(1); // never retried
  });

  it('changes the model alone, keeping the effort read fresh, and the effort alone', async () => {
    const { b, h } = await liveBridge();
    b.emit({ type: 'model', model: null, effort: 'high' }); // set in the terminal meanwhile
    expect(await h.driver.model(APP, { model: 'claude-haiku-4-5' })).toMatchObject({ state: 'done' });
    expect(await h.driver.model(APP, { effort: 'low' })).toMatchObject({ state: 'done' });
    expect(b.commands.map((c) => c.body)).toEqual([
      { op: 'read', what: 'status' },
      { op: 'model', model: 'claude-haiku-4-5', effort: 'high' },
      { op: 'read', what: 'status' },
      { op: 'model', model: 'claude-haiku-4-5', effort: 'low' },
    ]);
  });

  it('reads a kind the bridge serves, and refuses rows locally', async () => {
    const { b, h } = await liveBridge();
    b.answer('read', (body) => ({ status: 200, body: { ok: true, result: { what: body.what } } }));
    expect(await h.driver.read(APP, 'mcp')).toEqual({ ok: true, result: { what: 'mcp' } });
    expect(await h.driver.read(APP, 'rows')).toMatchObject({ ok: false, code: 'unsupported' });
    expect(b.commands.at(-1)?.body).toEqual({ op: 'read', what: 'mcp' });
  });
});

describe('sends', () => {
  async function liveBridge() {
    const b = await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    return { b, h };
  }
  const writer = `maws/${MACHINE}`;

  it('delivers under the next key and answers entered, with the row', async () => {
    const { b, h } = await liveBridge();
    expect(await h.driver.send(APP, 'list the files')).toEqual({ key: { writer, seq: 1 }, state: 'entered', uuid: 'row-1' });
    expect(await h.driver.send(APP, 'and count them')).toEqual({ key: { writer, seq: 2 }, state: 'entered', uuid: 'row-2' });
    expect(b.commands.map((c) => c.body)).toEqual([
      { op: 'deliver', key: { writer, seq: 1 }, text: 'list the files' },
      { op: 'deliver', key: { writer, seq: 2 }, text: 'and count them' },
    ]);
    expect(h.state()?.deliveries.map((d) => [d.key.seq, d.state])).toEqual([[1, 'entered'], [2, 'entered']]);
  });

  it('refuses a slash text, and ends a refused busy append refused with the reason', async () => {
    const { b, h } = await liveBridge();
    expect(await h.driver.send(APP, '/clear')).toEqual({ key: null, state: 'refused', reason: 'a slash command goes as a command, not as words', code: 'bad-args' });
    b.answer('deliver', (body) => {
      b.emit({ type: 'delivered', key: body.key, outcome: 'submitted' });
      b.emit({ type: 'delivered', key: body.key, outcome: 'refused', reason: 'the row was refused: a hook denied it' });
      return { status: 200, body: { ok: true, result: { submitted: true } } };
    });
    expect(await h.driver.send(APP, 'words')).toEqual({ key: { writer, seq: 1 }, state: 'refused', reason: 'the row was refused: a hook denied it' });
  });

  it('makes a send unconfirmed when the state stream is lost while it is submitted', async () => {
    const { b, h } = await liveBridge();
    b.answer('deliver', () => ({ status: 200, body: { ok: true, result: { submitted: true } } })); // the fate never comes
    const answer = h.driver.send(APP, 'words');
    await expect.poll(() => h.state()?.deliveries[0]?.state).toBe('submitted');
    b.reset();
    expect(await answer).toMatchObject({ key: { writer, seq: 1 }, state: 'unconfirmed' });
  });

  it('retries a timed-out deliver under the same key, the retry answered duplicate', async () => {
    const { b, h } = await liveBridge();
    let posts = 0;
    b.answer('deliver', (body) => {
      posts += 1;
      if (posts === 1) return { status: 504, body: { error: 'the session did not answer' } };
      b.emit({ type: 'delivered', key: body.key, outcome: 'entered', uuid: 'row-late' });
      return { status: 200, body: { ok: true, result: { submitted: true } } };
    });
    // the fake's mark took the first copy, so the retry is answered duplicate before the script runs again
    const answer = await h.driver.send(APP, 'words');
    expect(b.commands.map((c) => c.body)).toEqual([
      { op: 'deliver', key: { writer, seq: 1 }, text: 'words' },
      { op: 'deliver', key: { writer, seq: 1 }, text: 'words' },
    ]);
    expect(answer).toMatchObject({ key: { writer, seq: 1 }, state: 'submitted' });
  });
});

describe('decisions', () => {
  async function raised(raise: Parameters<FakeBridge['raise']>[0]) {
    const b = await bridge();
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    b.raise(raise);
    await expect.poll(() => h.state()?.pending.map((p) => p.request)).toEqual([raise.request]);
    return { b, h };
  }
  const rule = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' };

  it('posts a scoped allow with the request’s one suggestion, by maws, with the launch, after re-reading the request', async () => {
    const { b, h } = await raised({ request: 'toolu_1', tool: 'Bash', input: { command: 'npm test' }, suggestions: [rule] });
    expect(await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'allow', scope: 'session' })).toEqual({ outcome: 'delivered' });
    expect(b.requestReads).toEqual(['toolu_1']);
    expect(b.decisions).toEqual([{ request: 'toolu_1', body: { behavior: 'allow', updatedPermissions: [{ ...rule, destination: 'session' }], by: 'maws', launch: 'launch-1' } }]);
  });

  it('answers a decision on a settled request with its settlement, posting nothing', async () => {
    const { b, h } = await raised({ request: 'toolu_1', tool: 'Bash', input: {} });
    b.settle('toolu_1', 'terminal', 'allow');
    await expect.poll(() => h.state()?.pending).toEqual([]);
    expect(await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'allow', scope: 'once' })).toEqual({
      outcome: 'not_pending', settled: { request: 'toolu_1', winner: 'terminal', outcome: 'allow', by: 'terminal', t: expect.any(Number) as unknown }, message: 'already answered: allow by terminal',
    });
    expect(b.decisions).toEqual([]);
  });

  it('reads the terminal winning the race as its settlement, never an error', async () => {
    const { b, h } = await raised({ request: 'toolu_1', tool: 'Bash', input: {} });
    b.answer('decision', () => ({ status: 409, body: { error: 'the terminal answered it; its settlement follows', winner: 'terminal', by: 'terminal' } }));
    expect(await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'deny' })).toEqual({
      outcome: 'not_pending', settled: { winner: 'terminal', by: 'terminal' }, message: 'the terminal answered it; its settlement follows',
    });
    b.answer('decision', () => ({ status: 409, body: { error: 'the window closed; the terminal answers it', terminalOnly: true } }));
    expect(await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'deny' })).toMatchObject({ outcome: 'not_pending', terminalOnly: true });
  });

  it('refuses a variant lane A can’t carry before anything is posted', async () => {
    const { b, h } = await raised({ request: 'toolu_1', tool: 'Bash', input: {}, suggestions: [rule, rule] });
    expect(await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'allow', scope: 'session' })).toMatchObject({ outcome: 'refused', code: 'unsupported' });
    expect(await h.driver.answer(APP, 'toolu_1', { kind: 'permission', decision: 'deny_and_stop' })).toEqual({ outcome: 'refused', code: 'unsupported', message: 'deny-and-interrupt is answered in the terminal' });
    expect(b.decisions).toEqual([]);
  });

  it('answers a native question with its answers', async () => {
    const { b, h } = await raised({ request: 'toolu_q', tool: 'AskUserQuestion', input: { questions: [{ question: 'Which?' }] } });
    expect(await h.driver.answer(APP, 'toolu_q', { kind: 'question', answers: { 'Which?': 'A' } })).toEqual({ outcome: 'delivered' });
    expect(b.decisions[0]?.body).toEqual({ behavior: 'allow', updatedInput: { answers: { 'Which?': 'A' } }, by: 'maws', launch: 'launch-1' });
  });

  it('reads a decision answered 504 as unknown: an async question’s answer may have gone to the mod', async () => {
    const { b, h } = await raised({ request: 'toolu_plugin_1', tool: 'mcp__sminos__AskUserQuestion', input: { questions: [{ question: 'Which?' }] }, async: true });
    b.answer('decision', () => ({ status: 504, body: { id: 'cmd-9', error: 'the session did not answer within 5000 ms' } }));
    expect(await h.driver.answer(APP, 'toolu_plugin_1', { kind: 'question', answers: { 'Which?': 'A' } })).toEqual({ outcome: 'unknown', why: 'timeout' });
  });
});

// Fix wave 1, finding 1: an operation keeps the launch it was admitted under through every post and retry.
describe('the launch an operation was admitted under', () => {
  async function liveBridge() {
    const b = await bridge();
    const h = harness(undefined, { lane: { retryDelaysMs: [300, 300], answerMs: 3000, keepMs: 2000, capacity: 8 } });
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    await expect.poll(() => b.subscribers()).toBe(1);
    return { b, h };
  }
  const writer = `maws/${MACHINE}`;

  it('refuses a send’s retry launch once the session’s process changed, never retargeting it', async () => {
    const { b, h } = await liveBridge();
    b.answer('deliver', () => {
      b.setStatus({ launch: 'launch-2' }); // a new process holds the session; rediscovery reads it before the retry
      b.reset();
      return { status: 504, body: { error: 'the session did not answer' } };
    });
    const answer = h.driver.send(APP, 'words');
    await expect.poll(() => h.state()?.launch).toBe('launch-2');
    expect(await answer).toMatchObject({ key: { writer, seq: 1 }, state: 'refused', code: 'launch' });
    expect(b.commands.filter((c) => c.op === 'deliver')).toHaveLength(1); // the retry was fenced before the mod
  });

  it('recovers a send whose bridge child restarted within the same launch', async () => {
    const { b, h } = await liveBridge();
    let next: FakeBridge | null = null;
    b.answer('deliver', () => {
      setTimeout(() => void b.close().then(async () => (next = await bridge({ launch: 'launch-1' }))), 0);
      return { drop: true };
    });
    const answer = h.driver.send(APP, 'words');
    await expect.poll(() => next?.commands.length ?? 0, { timeout: 3000 }).toBe(1);
    expect(next!.commands[0]!.body).toEqual({ op: 'deliver', key: { writer, seq: 1 }, text: 'words' });
    expect((await answer).state).not.toBe('refused');
  });

  // Fix wave 2: discovery closing an active state stream is a lost stream too.
  it('makes a submitted send unconfirmed when discovery drops its bridge and a replacement comes up under the same launch', async () => {
    const { b, h } = await liveBridge();
    b.answer('deliver', () => ({ status: 200, body: { ok: true, result: { submitted: true } } })); // no fate follows
    const answer = h.driver.send(APP, 'words');
    await expect.poll(() => h.state()?.deliveries[0]?.state).toBe('submitted');
    rmSync(b.socket); // the socket goes while the old stream stays open: discovery finds no bridge and closes it
    await expect.poll(() => h.state(), { timeout: 3000 }).toBeNull();
    await bridge({ launch: 'launch-1' }); // the replacement, under the same launch
    await h.live();
    expect(await answer).toMatchObject({ key: { writer, seq: 1 }, state: 'unconfirmed' });
    expect(h.state()?.deliveries[0]).toMatchObject({ state: 'unconfirmed' });
  });

  it('posts a model change’s read and change under one launch', async () => {
    const { b, h } = await liveBridge();
    b.answer('read', async () => {
      b.setStatus({ launch: 'launch-2' });
      b.reset();
      await expect.poll(() => h.state()?.launch).toBe('launch-2'); // rediscovered between the read and the change
      return { status: 200, body: { ok: true, result: { override: null } } };
    });
    expect(await h.driver.model(APP, { effort: 'low' })).toMatchObject({ state: 'refused', code: 'launch' });
    expect(b.commands.map((c) => c.op)).toEqual(['read']);
  });
});

// P5 O9 M6: what main's attention and digest read of each session.
describe('the view main’s own consumers follow', () => {
  it('tells each change, the stream’s currency and the main loop’s tool, and null when the session leaves', async () => {
    const b = await bridge();
    const h = harness();
    const views: (LaneAView | null)[] = [];
    h.driver.onChange((appId, view) => appId === APP && views.push(view));
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await expect.poll(() => views.at(-1)?.fresh, { timeout: 3000 }).toBe(true);
    b.raise({ request: 'toolu_r1', tool: 'Bash', input: { command: 'ls' } });
    await expect.poll(() => views.at(-1)?.state.pending.map((p) => p.request)).toEqual(['toolu_r1']);
    b.emit({ type: 'turn', phase: 'start', turnId: 't1', agentId: null });
    b.emit({ type: 'tool', phase: 'call', toolUseId: 'u1', tool: 'Read', agentId: null, input: { file_path: '/a/b.ts' } });
    await expect.poll(() => views.at(-1)?.tool).toEqual({ tool: 'Read', input: { file_path: '/a/b.ts' }, running: true });
    b.reset(); // the stream ends: what it said of the requests is no longer current, until its next snapshot
    await expect.poll(() => views.some((v) => v !== null && !v.fresh && v.state.pending.length === 1)).toBe(true);
    await expect.poll(() => views.at(-1)?.fresh, { timeout: 3000 }).toBe(true);
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: { kind: 'none' } });
    expect(views.at(-1)).toBeNull();
  });
});

// P5 O9 M7: an upload through the bridge's `media` op, saved under the session's own directory (a scratch repository).
describe('media', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const PDF = Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64');
  const files = [{ name: 'shot.png', mediaType: 'image/png', data: PNG }, { name: 'notes.pdf', mediaType: 'application/pdf', data: PDF }];

  async function liveIn(cwd: string, options: Partial<Parameters<typeof startFakeBridge>[0]> = {}) {
    const b = await bridge({ sessionInfo: { session: ENGINE, cwd, model: 'claude-opus-4-5', version: '2.1.300' }, ...options });
    const h = harness();
    h.driver.observe({ appId: APP, engineSessionId: ENGINE, holder: terminal });
    await h.live();
    return { b, h };
  }

  async function repo(): Promise<GitFixture> {
    const f = await GitFixture.create();
    scratch.push(f.root, f.home);
    return f;
  }

  it('reads where the session works, saves the files there and posts media naming them, the exclude entry added and the root recorded', async () => {
    const f = await repo();
    const { b, h } = await liveIn(f.root);
    const result = await h.driver.media(APP, files);
    const root = join(f.root, '.claude', 'desk-uploads', ENGINE);
    expect(result).toMatchObject({ state: 'done', result: { root } });
    const upload = (result as { result: { upload: string } }).result.upload;
    expect(upload).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(b.commands.map((c) => c.body)).toEqual([
      { op: 'read', what: 'status' },
      {
        op: 'media', upload, root, files: [
          { n: 0, path: join(root, `${upload}.0.png`), name: 'shot.png', mediaType: 'image/png' },
          { n: 1, path: join(root, `${upload}.1.pdf`), name: 'notes.pdf', mediaType: 'application/pdf' },
        ],
      },
    ]);
    expect(readFileSync(join(root, `${upload}.0.png`)).toString('base64')).toBe(PNG);
    expect(readFileSync(join(root, `${upload}.1.pdf`)).toString('base64')).toBe(PDF);
    expect(readFileSync(join(f.root, '.git', 'info', 'exclude'), 'utf8')).toContain('**/.claude/desk-uploads/');
    expect(JSON.parse(readFileSync(join(process.env.MAWS_USER_DATA!, 'lane-a', 'uploads.json'), 'utf8')).roots).toEqual([{ path: root, session: ENGINE, at: expect.any(String) as unknown }]);
  });

  it('refuses what the bridge would not take before anything is written or posted', async () => {
    const f = await repo();
    const { b, h } = await liveIn(f.root);
    expect(await h.driver.media(APP, Array.from({ length: 5 }, () => files[0]!))).toMatchObject({ state: 'refused', code: 'bad-args' });
    expect(await h.driver.media(APP, [{ name: 'fake.png', mediaType: 'image/png', data: PDF }])).toMatchObject({ state: 'refused', code: 'bad-args', message: expect.stringContaining('fake.png') as unknown });
    expect(b.commands).toEqual([]);
    expect(existsSync(join(f.root, '.claude'))).toBe(false);
  });

  it('takes the files back when the bridge refuses the upload', async () => {
    const f = await repo();
    const { b, h } = await liveIn(f.root);
    b.answer('media', () => ({ status: 200, body: { ok: false, error: 'the upload could not be kept in the session state' } }));
    expect(await h.driver.media(APP, files)).toMatchObject({ state: 'refused', message: 'the upload could not be kept in the session state' });
    expect(existsSync(join(f.root, '.claude', 'desk-uploads', ENGINE))).toBe(false);
  });

  it('posts a lost answer again under the same upload, a duplicate meaning the bridge holds it; all lost is unknown and the files stay', async () => {
    const f = await repo();
    const { b, h } = await liveIn(f.root);
    let posts = 0;
    b.answer('media', (body) => (++posts === 1 ? { status: 504, body: { error: 'the session did not answer' } } : { status: 200, body: { ok: true, result: { duplicate: true, upload: body.upload } } }));
    expect(await h.driver.media(APP, files)).toMatchObject({ state: 'done' });
    const sent = b.commands.filter((c) => c.op === 'media').map((c) => c.body.upload);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);

    b.answer('media', () => ({ drop: true }));
    const lost = await h.driver.media(APP, [files[0]!]);
    expect(lost).toMatchObject({ state: 'unknown', why: 'timeout' });
    const upload = (lost as { id: string }).id;
    expect(b.commands.filter((c) => c.op === 'media' && c.body.upload === upload)).toHaveLength(3);
    expect(existsSync(join(f.root, '.claude', 'desk-uploads', ENGINE, `${upload}.0.png`))).toBe(true);
  });

  it('is refused, with the bridge’s reason, for a session whose bridge closes media', async () => {
    const f = await repo();
    const closed = { ...FULL_CAPABILITIES, controls: { ...FULL_CAPABILITIES.controls, media: { available: false, reason: 'this engine takes no desk uploads' } } };
    const { b, h } = await liveIn(f.root, { capabilities: closed });
    expect(await h.driver.media(APP, files)).toEqual({ state: 'refused', code: 'unsupported', message: 'this engine takes no desk uploads' });
    expect(b.commands).toEqual([]);
  });

  it('fences the read of where the session works by the launch, so nothing is saved for another process', async () => {
    const f = await repo();
    const { b, h } = await liveIn(f.root);
    b.setStatus({ launch: 'launch-2' });
    expect(await h.driver.media(APP, files)).toMatchObject({ state: 'refused', code: 'launch' });
    expect(b.commands).toEqual([]); // the fake fences before it records, as the child does before it acts
    expect(existsSync(join(f.root, '.claude'))).toBe(false);
  });
});
