// O16 M5: the reap state machine (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M5 and Interfaces §F; holder
// design §8 item 6), over a real gate and a fake observer on a real Unix socket, with a stand-in session: a due row that
// is verified empty arms the fence when an observer is healthy and signals only after `armed`, within the lease less its
// margin, re-checking everything in the step that signals; a turn before the signal cancels (`proceed`, disarmed), one
// after it is told `stop`; an observer that was seen and went silent or away blocks the release; a row on which none
// was ever seen is released on verified-empty alone (owner Q1).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngineSessionStatusSchema, type EngineSessionStatus } from '@shared/engine/status';
import { FakeObserver } from './fake-observer';
import { Gate, STOP_REASON } from './gate';
import { isVerifiedEmpty, Reap, type ReapDeps, type ReapReason, type ReapView } from './reap';

const LEASE = 400;
const MARGIN = 100;
const SILENCE = 200;

function status(over: Partial<EngineSessionStatus> = {}): EngineSessionStatus {
  return EngineSessionStatusSchema.parse({
    appSessionId: 'app-r', engineSessionId: 'eng-r', pid: 700, launchId: 'L1', launchedAt: '2026-10-31T10:00:00.000Z', taskListId: null, cwd: '/w', pendingPlan: null,
    process: 'ready', exit: null, engineState: 'idle', activity: null, turn: null, model: { requested: null, resolved: null }, effort: null,
    permissionMode: { requested: 'default', effective: 'default', refusal: null }, prePlanMode: null,
    gateway: { mode: 'gateway', baseUrl: null, verified: 'routed', autoModeServer: 'unknown', localLane: null },
    subagentModel: null, modelOverrides: {}, engineVersion: '2.1.316', fileCheckpointing: true, bin: '/b/claude', fastMode: { state: null, disabledReason: null },
    plugins: [], pluginErrors: [], pluginWarnings: [], pluginsObservedAt: null, backgroundTasks: [], grants: [], mcpServers: [], heldPeerMessages: [], pendingRequests: 0,
    queue: { length: 0, paused: false }, keepAlive: [], busy: false, lastUsedAt: '2026-10-31T10:00:00.000Z',
    memory: { rssKiB: 1, treeRssKiB: 1, sampledAt: null }, journalPath: '/j', hostHooks: [], lastEventSeq: 7,
    trust: { attested: false, recorded: null }, work: { crons: [], unknown: null, descendants: 0 }, kept: false, ...over,
  });
}
const TURN = { id: 'app:L1:4:0' as never, origin: 'engine' as const, startedAt: '2026-10-31T10:00:00.000Z', acceptedAt: '2026-10-31T10:00:00.000Z', userMessageUuids: [] };
const NONE: ReadonlySet<string> = new Set();

let root: string;
let gate: Gate;
let path: string;
const observers: FakeObserver[] = [];
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'maws-reap-'));
  path = join(root, 'supervisor', 'gate.sock');
  gate = new Gate({ log: () => {}, silenceMs: SILENCE });
  await gate.listen(path);
});
afterEach(async () => {
  for (const o of observers.splice(0)) if (!o.isClosed) await o.close();
  await gate.close();
  rmSync(root, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => boolean, what: string, ms = 2_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
};

// A stand-in row: its status, interest and tree as a test sets them; what the reap signalled and how it ended.
function scene(opts: { outcome?: 'exited' | 'ignored' } = {}) {
  const s = {
    status: status() as EngineSessionStatus | null,
    interest: false,
    descendants: 0 as number | 'unreadable',
    reaped: [] as ReapReason[],
    cancelled: [] as ReapReason[],
    ignored: 0,
    views: [] as ReapView[],
    logs: [] as string[],
    settle: null as ((outcome: 'exited' | 'ignored') => void) | null,
    channel: gate.channel({ lineage: () => new Set(['eng-r']), pid: () => 700 }),
  };
  const deps: ReapDeps = {
    gate: s.channel,
    current: () => s.status,
    stateful: () => NONE,
    interest: () => s.interest,
    descendants: () => s.descendants,
    reap: (reason) => {
      s.reaped.push(reason);
      if (opts.outcome) return Promise.resolve(opts.outcome);
      return new Promise((resolve) => (s.settle = resolve));
    },
    now: () => Date.now(),
    log: (line) => void s.logs.push(line),
    cancelled: (reason) => void s.cancelled.push(reason),
    ignored: () => void (s.ignored += 1),
    changed: (view) => void s.views.push(view),
    leaseMs: LEASE,
    leaseMarginMs: MARGIN,
  };
  const reap = new Reap('app-r', deps);
  return Object.assign(s, { reap });
}

async function observer(opts: { beat?: boolean } = {}): Promise<FakeObserver> {
  const o = await FakeObserver.connect(path);
  observers.push(o);
  o.hello('eng-r', { pid: 700, childPid: 812 });
  await o.next('welcome');
  if (opts.beat !== false) o.beat(50);
  return o;
}

describe('isVerifiedEmpty', () => {
  it('an idle row with known, empty work and nothing under the engine', () => {
    expect(isVerifiedEmpty(status(), NONE, 0)).toBe(true);
  });

  it.each([
    ['a turn', { turn: TURN }],
    ['a non-ambient task', { backgroundTasks: [{ taskId: 't-1' as never, taskType: 'local_bash', description: 'sleep', ambient: false }] }],
    ['a listed cron', { work: { crons: [{ id: 'c', schedule: '* * * * *', recurring: true, prompt: 'p' }], unknown: null, descendants: 0 } }],
    ['unknown work', { work: { crons: [], unknown: 'resumed', descendants: 0 } }],
    ['a pending request', { pendingRequests: 1 }],
    ['queued messages', { queue: { length: 1, paused: false } }],
    ['the engine working', { engineState: 'running' as const }],
    ['a process not ready', { process: 'initializing' as const }],
  ])('not with %s', (_what, over) => {
    expect(isVerifiedEmpty(status(over as Partial<EngineSessionStatus>), NONE, 0)).toBe(false);
  });

  it('an ambient task holds nothing', () => {
    expect(isVerifiedEmpty(status({ backgroundTasks: [{ taskId: 't-1' as never, taskType: 'dream', description: 'x', ambient: true }] }), NONE, 0)).toBe(true);
  });

  it('not with an unregistered descendant or an unreadable tree, whatever the status says', () => {
    expect(isVerifiedEmpty(status(), NONE, 1)).toBe(false);
    expect(isVerifiedEmpty(status(), NONE, 'unreadable')).toBe(false);
  });
});

describe('no observer ever seen (owner Q1)', () => {
  it('a due row that is verified empty is signalled at once, in the same step', () => {
    const s = scene();
    s.reap.due('idle');
    expect(s.reaped).toEqual(['idle']);
    expect(s.reap.state).toBe('signalled');
    expect(s.reap.observer).toBe('absent');
  });

  it.each([
    ['interest held', (s: ReturnType<typeof scene>) => void (s.interest = true)],
    ['the keep mark', (s: ReturnType<typeof scene>) => void (s.status = status({ kept: true }))],
    ['a turn', (s: ReturnType<typeof scene>) => void (s.status = status({ turn: TURN }))],
    ['a non-ambient task', (s: ReturnType<typeof scene>) => void (s.status = status({ backgroundTasks: [{ taskId: 't' as never, taskType: 'local_bash', description: 'd', ambient: false }] }))],
    ['a listed cron', (s: ReturnType<typeof scene>) => void (s.status = status({ work: { crons: [{ id: 'c', schedule: '* * * * *', recurring: true, prompt: 'p' }], unknown: null, descendants: 0 } }))],
    ['unknown work', (s: ReturnType<typeof scene>) => void (s.status = status({ work: { crons: [], unknown: 'dirty', descendants: 0 } }))],
    ['an unregistered descendant', (s: ReturnType<typeof scene>) => void (s.descendants = 1)],
    ['an unreadable tree', (s: ReturnType<typeof scene>) => void (s.descendants = 'unreadable')],
    ['no row', (s: ReturnType<typeof scene>) => void (s.status = null)],
  ])('no release with %s: the reap is cancelled and the row’s clock restarts', (_what, veto) => {
    const s = scene();
    veto(s);
    s.reap.due('idle');
    expect(s.reaped).toEqual([]);
    expect(s.cancelled).toEqual(['idle']);
    expect(s.reap.state).toBe('idle');
  });

  it('a budget reap ignores interest and the keep mark (they exempt the idle release only), and nothing else', () => {
    const s = scene();
    s.interest = true;
    s.status = status({ kept: true });
    s.reap.due('budget');
    expect(s.reaped).toEqual(['budget']);
    const t = scene();
    t.descendants = 1;
    t.reap.due('budget');
    expect(t.reaped).toEqual([]);
    expect(t.cancelled).toEqual(['budget']);
  });

  it('a second due while a reap is under way does nothing', () => {
    const s = scene();
    s.reap.due('idle');
    s.reap.due('idle');
    s.reap.due('budget');
    expect(s.reaped).toEqual(['idle']);
  });
});

describe('with an observer', () => {
  it('arms before any signal and signals only after armed', async () => {
    const s = scene();
    const o = await observer();
    s.reap.due('idle');
    expect(s.reap.state).toBe('arming');
    expect(s.reaped).toEqual([]);
    expect(await o.next('arm')).toEqual({ t: 'arm', fence: 1, leaseMs: LEASE });
    await sleep(50);
    expect(s.reaped).toEqual([]); // no signal before armed
    o.send({ t: 'armed', fence: 1 });
    await until(() => s.reaped.length === 1, 'the signal');
    expect(s.reap.state).toBe('signalled');
  });

  it('a turn before the signal is answered proceed: the reap is cancelled and the fence disarmed', async () => {
    const s = scene();
    const o = await observer();
    s.reap.due('idle');
    await o.next('arm');
    o.send({ t: 'turn', fence: 1, origin: 'cron' });
    expect(await o.next('proceed')).toEqual({ t: 'proceed', fence: 1 });
    expect(await o.next('disarm')).toEqual({ t: 'disarm', fence: 1 });
    expect(s.reap.state).toBe('idle');
    expect(s.cancelled).toEqual(['idle']);
    o.send({ t: 'armed', fence: 1 }); // a late armed for the cancelled fence
    await sleep(50);
    expect(s.reaped).toEqual([]);
  });

  it('a turn read in the same chunk as the armed that follows it still cancels: the turn is a step of its own', async () => {
    const s = scene();
    const o = await observer();
    s.reap.due('idle');
    await o.next('arm');
    o.sendAll([{ t: 'turn', fence: 1, origin: 'task' }, { t: 'armed', fence: 1 }]);
    expect(await o.next('proceed')).toEqual({ t: 'proceed', fence: 1 });
    await o.next('disarm');
    await sleep(30);
    expect(s.reaped).toEqual([]);
    expect(o.exchanged.filter((e) => e.from === 'host').map((e) => e.frame.t)).toEqual(['welcome', 'arm', 'proceed', 'disarm']);
  });

  it('a turn after the signal is answered stop with the reason text', async () => {
    const s = scene();
    const o = await observer();
    s.reap.due('idle');
    await o.next('arm');
    o.send({ t: 'armed', fence: 1 });
    await until(() => s.reaped.length === 1, 'the signal');
    o.send({ t: 'turn', fence: 1, origin: 'peer', delivery: 'd-1' });
    expect(await o.next('stop')).toEqual({ t: 'stop', fence: 1, reason: STOP_REASON });
    expect(s.reap.state).toBe('signalled');
  });

  it('a turn naming another fence proceeds and leaves the reap as it is', async () => {
    const s = scene();
    const o = await observer();
    s.reap.due('idle');
    await o.next('arm');
    o.send({ t: 'turn', fence: 9, origin: 'query' });
    expect(await o.next('proceed')).toEqual({ t: 'proceed', fence: 9 });
    expect(s.reap.state).toBe('arming');
  });

  it('every veto is read again at the step: one that landed while arming cancels it', async () => {
    const s = scene();
    const o = await observer();
    s.reap.due('idle');
    await o.next('arm');
    s.descendants = 1; // a background job the step's fresh read finds
    o.send({ t: 'armed', fence: 1 });
    expect(await o.next('disarm')).toEqual({ t: 'disarm', fence: 1 });
    expect(s.reaped).toEqual([]);
    expect(s.cancelled).toEqual(['idle']);
  });

  it('interest that arrived while arming cancels an idle reap at the step', async () => {
    const s = scene();
    const o = await observer();
    s.reap.due('idle');
    await o.next('arm');
    s.interest = true;
    o.send({ t: 'armed', fence: 1 });
    await o.next('disarm');
    expect(s.reaped).toEqual([]);
  });

  it('an arm with no answer is disarmed once the lease has run out; the row’s clock restarts', async () => {
    const s = scene();
    const o = await observer();
    s.reap.due('idle');
    await o.next('arm');
    expect(await o.next('disarm', LEASE + 500)).toEqual({ t: 'disarm', fence: 1 });
    expect(s.cancelled).toEqual(['idle']);
    expect(s.reaped).toEqual([]);
  });

  it('never signals past the lease: an armed that comes after the lease less its margin renews the arm with the same fence first', async () => {
    const s = scene();
    const o = await observer();
    s.reap.due('idle');
    await o.next('arm');
    await sleep(LEASE - MARGIN + 50);
    o.send({ t: 'armed', fence: 1 });
    expect(await o.next('arm')).toEqual({ t: 'arm', fence: 1, leaseMs: LEASE }); // the renewal
    await sleep(30);
    expect(s.reaped).toEqual([]);
    o.send({ t: 'armed', fence: 1 });
    await until(() => s.reaped.length === 1, 'the signal after the renewal');
  });

  it('a later reap takes a new fence', async () => {
    const s = scene();
    const o = await observer();
    s.reap.due('idle');
    await o.next('arm');
    o.send({ t: 'turn', fence: 1, origin: 'query' });
    await o.next('disarm');
    s.reap.due('idle');
    expect(await o.next('arm')).toEqual({ t: 'arm', fence: 2, leaseMs: LEASE });
  });

  it('the lease is renewed while the signal runs, so a turn the engine starts before it exits still meets the fence', async () => {
    const s = scene();
    const o = await observer();
    s.reap.due('idle');
    await o.next('arm');
    o.send({ t: 'armed', fence: 1 });
    await until(() => s.reaped.length === 1, 'the signal');
    expect(await o.next('arm', LEASE)).toEqual({ t: 'arm', fence: 1, leaseMs: LEASE });
    s.settle!('exited');
    await sleep(LEASE);
    expect(o.pending().filter((f) => f.t === 'arm')).toEqual([]);
  });
});

describe('an observer seen and then silent or gone', () => {
  it('heartbeat loss while arming cancels the reap; the row is held unhealthy until a fresh hello', async () => {
    const s = scene();
    const o = await observer({ beat: false });
    s.reap.due('idle');
    await o.next('arm');
    await until(() => s.reap.observer === 'unhealthy', 'the silence');
    expect(s.reap.state).toBe('idle');
    expect(s.cancelled).toEqual(['idle']);
    o.send({ t: 'armed', fence: 1 });
    await sleep(50);
    expect(s.reaped).toEqual([]);
    s.reap.due('idle'); // a due that meets an unhealthy observer arms nothing and signals nothing
    expect(s.reap.state).toBe('idle');
    expect(s.reaped).toEqual([]);
    expect(s.views.at(-1)).toEqual({ state: 'idle', observer: 'unhealthy' });
    o.hello('eng-r', { pid: 700 });
    await o.next('welcome');
    expect(s.views.at(-1)).toEqual({ state: 'idle', observer: 'healthy' });
  });

  it('a closed connection holds the row the same way, never falling back to the absent rule', async () => {
    const s = scene();
    const o = await observer();
    await o.close();
    await until(() => s.reap.observer === 'unhealthy', 'the close');
    s.reap.due('idle');
    expect(s.reaped).toEqual([]);
    expect(s.reap.state).toBe('idle');
  });

  it('a turn the observer asks after it lost its connection mid-arm reaches no cancelled reap', async () => {
    const s = scene();
    const o = await observer();
    s.reap.due('idle');
    await o.next('arm');
    await o.close();
    await until(() => s.reap.state === 'idle', 'the cancel');
    const back = await FakeObserver.connect(path);
    observers.push(back);
    back.hello('eng-r', { pid: 700 });
    await back.next('welcome');
    back.send({ t: 'turn', fence: 1, origin: 'task' });
    expect(await back.next('proceed')).toEqual({ t: 'proceed', fence: 1 });
    expect(s.reaped).toEqual([]);
  });
});

describe('the signal’s outcome', () => {
  it('an ignored idle reap disarms, passes through term_ignored to idle, and restarts the row’s clock', async () => {
    const s = scene({ outcome: 'ignored' });
    const o = await observer();
    s.reap.due('idle');
    await o.next('arm');
    o.send({ t: 'armed', fence: 1 });
    expect(await o.next('disarm')).toEqual({ t: 'disarm', fence: 1 });
    expect(s.reap.state).toBe('idle');
    expect(s.ignored).toBe(1);
    expect(s.views.map((v) => v.state)).toContain('term_ignored');
  });

  it('an exited reap leaves the state signalled; dispose ends its timers', async () => {
    const s = scene({ outcome: 'exited' });
    s.reap.due('idle');
    await sleep(10);
    expect(s.reap.state).toBe('signalled');
    s.reap.dispose();
  });

  it('a budget reap is armed the same way, and a turn before its signal clears it as cancelled', async () => {
    const s = scene();
    const o = await observer();
    s.reap.due('budget');
    await o.next('arm');
    o.send({ t: 'turn', fence: 1, origin: 'query' });
    await o.next('proceed');
    expect(s.cancelled).toEqual(['budget']);
    expect(s.reaped).toEqual([]);
  });

  it('cancel() from outside (an explicit stop) disarms an arming reap', async () => {
    const s = scene();
    const o = await observer();
    s.reap.due('idle');
    await o.next('arm');
    s.reap.cancel('stopped');
    expect(await o.next('disarm')).toEqual({ t: 'disarm', fence: 1 });
    expect(s.reap.state).toBe('idle');
  });
});
