// O16 M5: the gate's conformance fixture (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, Interfaces §E; D19),
// `spikes/protocol-probe/fixtures/p5/p5-o16-gate.jsonl`, which O12 M4's bridge test replays. Each case runs the engine
// host's real gate and reap against a fake observer on a real Unix socket and records the exchange in both directions,
// in the order it happened, with the moments that are not frames marked as events (the host's signal, a silence, the
// server's restart). This test compares a run with the committed file, frame for frame; `MAWS_RECORD_GATE_FIXTURE=1`
// rewrites the file from the run instead. Timings are shortened for the test (the header names them); every frame is
// as the engine host writes it. D69's cases: a silence healed by a heartbeat on the same connection, an arm met by a
// turn in either order of its late `armed`, and an idle reap's SIGTERM under the lease (the renewal answered; withheld;
// re-armed, where an answer to the older arm confirms nothing) through a stand-in of the session's signal path.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { EngineSessionStatusSchema } from '@shared/engine/status';
import { FakeObserver, type Exchanged } from './fake-observer';
import { Gate, GATE_PROTOCOL, STOP_REASON } from './gate';
import { Reap, type ReapDeps, type ReapReason } from './reap';

const FIXTURE = join(__dirname, '../../../spikes/protocol-probe/fixtures/p5/p5-o16-gate.jsonl');
const LEASE_MS = 400;
const MARGIN_MS = 100;
const SILENCE_MS = 200;
const GRACE_MS = 450; // the end_session grace before an idle reap's SIGTERM: between the arm's renewal (300) and the next (600)
const SESSION = '5f0c2a1e-6b7d-4c3e-9a8f-0123456789ab';
const PID = 4711;
const CHILD = 4712;

type Row = { case: string } & (Exchanged | { event: string; detail?: string });

let root: string;
let path: string;
let gate: Gate;
const observers: FakeObserver[] = [];
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'maws-gate-fixture-'));
  path = join(root, 'supervisor', 'gate.sock');
  gate = new Gate({ log: () => {}, silenceMs: SILENCE_MS });
  await gate.listen(path);
});
afterEach(async () => {
  for (const o of observers.splice(0)) if (!o.isClosed) await o.close();
  await gate.close();
  rmSync(root, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => boolean, what: string, ms = 3_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
};

const IDLE = EngineSessionStatusSchema.parse({
  appSessionId: 'app-fixture', engineSessionId: SESSION, pid: PID, launchId: 'L1', launchedAt: '2026-10-31T10:00:00.000Z', taskListId: null, cwd: '/w', pendingPlan: null,
  process: 'ready', exit: null, engineState: 'idle', activity: null, turn: null, model: { requested: null, resolved: null }, effort: null,
  permissionMode: { requested: 'default', effective: 'default', refusal: null }, prePlanMode: null,
  gateway: { mode: 'gateway', baseUrl: null, verified: 'routed', autoModeServer: 'unknown', localLane: null },
  subagentModel: null, modelOverrides: {}, engineVersion: '2.1.316', fileCheckpointing: true, bin: '/b/claude', fastMode: { state: null, disabledReason: null },
  plugins: [], pluginErrors: [], pluginWarnings: [], pluginsObservedAt: null, backgroundTasks: [], grants: [], mcpServers: [], heldPeerMessages: [], pendingRequests: 0,
  queue: { length: 0, paused: false }, keepAlive: [], busy: false, lastUsedAt: '2026-10-31T10:00:00.000Z',
  memory: { rssKiB: 1, treeRssKiB: 1, sampledAt: null }, journalPath: '/j', hostHooks: [], lastEventSeq: 7,
  trust: { attested: false, recorded: null }, work: { crons: [], unknown: null, descendants: 0 }, kept: false,
});

// One case's scene: the row's channel and reap on the gate, the recording, and what the reap signalled.
// `signal`: the session's signal path, by default marked as one moment; D69's cases stand in its idle reap's steps.
function scene(name: string, outcome: Promise<'exited' | 'ignored'> = new Promise(() => {}), descendants: () => number = () => 0, signal?: (mark: (event: string, detail?: string) => void, mayTerm: () => Promise<boolean>) => Promise<'exited' | 'ignored' | 'withheld'>) {
  const rows: Row[] = [];
  const sink = { push: (row: Exchanged) => rows.push({ case: name, ...row }) };
  const mark = (event: string, detail?: string) => rows.push({ case: name, event, ...(detail && { detail }) });
  const channel = gate.channel({ lineage: () => new Set([SESSION]), pid: () => PID });
  const reaped: ReapReason[] = [];
  const reap = new Reap('app-fixture', {
    gate: channel, current: () => IDLE, stateful: () => new Set(), interest: () => false, descendants,
    reap: (reason, mayTerm): ReturnType<ReapDeps['reap']> => {
      reaped.push(reason);
      if (signal) return signal(mark, mayTerm);
      mark('signal', 'the engine host signals the engine: end_session, then SIGTERM');
      return outcome;
    },
    now: () => Date.now(), log: () => {}, cancelled: () => {}, ignored: () => {}, changed: () => {},
    leaseMs: LEASE_MS, leaseMarginMs: MARGIN_MS,
  });
  const connect = async () => {
    const o = await FakeObserver.connect(path, { sink });
    observers.push(o);
    return o;
  };
  const hello = async (o: FakeObserver) => {
    o.hello(SESSION, { pid: PID, childPid: CHILD });
    await o.next('welcome');
  };
  return { rows, mark, channel, reap, reaped, connect, hello };
}

// session.ts `reap('idle')` in brief: end_session, its grace, then the SIGTERM only under a confirmed lease (D69).
function idleSignal(exit: Promise<'exited'>, sigterms: { n: number }) {
  return async (mark: (event: string, detail?: string) => void, mayTerm: () => Promise<boolean>): Promise<'exited' | 'withheld'> => {
    mark('end_session', 'the engine host sends end_session');
    await sleep(GRACE_MS);
    if (!(await mayTerm())) {
      mark('sigterm_withheld', 'no confirmed lease at the SIGTERM: none sent, the reap ends and the fence is disarmed');
      return 'withheld';
    }
    sigterms.n += 1;
    mark('sigterm', `the engine host sends SIGTERM under a confirmed lease, ${GRACE_MS} ms after end_session`);
    return exit;
  };
}

async function cases(): Promise<Row[]> {
  const all: Row[] = [];

  { // a turn the engine starts while the fence is armed proceeds, and the reap is cancelled
    const s = scene('proceed');
    const o = await s.connect();
    await s.hello(o);
    o.hb();
    s.mark('due', 'the row is due and verified empty');
    s.reap.due('idle');
    await o.next('arm');
    o.send({ t: 'turn', fence: 1, origin: 'cron' });
    await o.next('proceed');
    await o.next('disarm');
    await o.close();
    s.channel.close();
    all.push(...s.rows);
  }

  { // armed, then the signal, then a turn: stop with the reason, the delivery kept owed
    let exit!: (outcome: 'exited') => void;
    const s = scene('stop', new Promise((resolve) => (exit = resolve)));
    const o = await s.connect();
    await s.hello(o);
    s.mark('due', 'the row is due and verified empty');
    s.reap.due('idle');
    await o.next('arm');
    o.send({ t: 'armed', fence: 1 });
    await until(() => s.reaped.length === 1, 'the signal');
    o.send({ t: 'turn', fence: 1, origin: 'peer', delivery: 'dlv-1' });
    expect(await o.next('stop')).toEqual({ t: 'stop', fence: 1, reason: STOP_REASON });
    exit('exited');
    s.mark('exit', 'the engine exits; its row closes the observer');
    s.reap.dispose();
    s.channel.close();
    await o.closed;
    all.push(...s.rows);
  }

  { // the observer has answered armed, and its turn proceeds before any signal: here the host awaits the armed of its
    // renewal (the first came after the lease less its margin), so the turn cancels the reap
    const s = scene('armed-renewing-turn-proceed');
    const o = await s.connect();
    await s.hello(o);
    o.beat(50); // throughout; their count is timing, so the recording keeps none of them
    s.mark('heartbeats', 'the observer beats throughout this case (not recorded)');
    s.mark('due', 'the row is due and verified empty');
    s.reap.due('idle');
    await o.next('arm');
    s.mark('wait', `the observer answers after the lease less its margin (${LEASE_MS - MARGIN_MS} ms)`);
    await sleep(LEASE_MS - MARGIN_MS + 30);
    o.send({ t: 'armed', fence: 1 });
    await o.next('arm'); // the renewal
    o.send({ t: 'turn', fence: 1, origin: 'query' });
    expect(await o.next('proceed')).toEqual({ t: 'proceed', fence: 1 });
    await o.next('disarm');
    expect(s.reaped).toEqual([]);
    await o.close();
    s.channel.close();
    all.push(...s.rows.filter((r) => !('frame' in r && r.frame.t === 'hb')));
  }

  { // armed and a turn in one chunk, and the step's re-read after armed finds work under the engine: the reap is
    // cancelled (disarm) and the turn, read next, proceeds; nothing was signalled
    let work = 0;
    const s = scene('armed-veto-turn-proceed', undefined, () => work);
    const o = await s.connect();
    await s.hello(o);
    o.hb();
    s.mark('due', 'the row is due and verified empty');
    s.reap.due('idle');
    await o.next('arm');
    work = 1;
    s.mark('veto', 'a process of the session\'s work starts under the engine before the step');
    o.sendAll([{ t: 'armed', fence: 1 }, { t: 'turn', fence: 1, origin: 'peer', delivery: 'dlv-2' }]);
    await o.next('disarm');
    expect(await o.next('proceed')).toEqual({ t: 'proceed', fence: 1 });
    expect(s.reaped).toEqual([]);
    await o.close();
    s.channel.close();
    all.push(...s.rows);
  }

  { // an arm the observer never answers is disarmed once the lease has run out
    const s = scene('no-answer');
    const o = await s.connect();
    await s.hello(o);
    s.mark('due', 'the row is due and verified empty');
    s.reap.due('idle');
    await o.next('arm');
    s.mark('wait', `no armed within the lease (${LEASE_MS} ms)`);
    await o.next('disarm', LEASE_MS + 1_000);
    await o.close();
    s.channel.close();
    all.push(...s.rows);
  }

  { // an armed that arrives after the lease less its margin is renewed with the same fence before the signal, and the
    // lease is renewed while the signal runs
    let exit!: (outcome: 'exited') => void;
    const s = scene('renew', new Promise((resolve) => (exit = resolve)));
    const o = await s.connect();
    await s.hello(o);
    o.beat(50); // throughout; their count is timing, so the recording keeps none of them
    s.mark('heartbeats', 'the observer beats throughout this case (not recorded)');
    s.mark('due', 'the row is due and verified empty');
    s.reap.due('idle');
    await o.next('arm');
    s.mark('wait', `the observer answers after the lease less its margin (${LEASE_MS - MARGIN_MS} ms)`);
    await sleep(LEASE_MS - MARGIN_MS + 30);
    o.send({ t: 'armed', fence: 1 });
    await o.next('arm'); // the renewal
    o.send({ t: 'armed', fence: 1 });
    await until(() => s.reaped.length === 1, 'the signal');
    s.mark('wait', `the signal outlives the lease less its margin (${LEASE_MS - MARGIN_MS} ms)`);
    await o.next('arm', LEASE_MS); // renewed while the signal runs
    o.send({ t: 'armed', fence: 1 });
    exit('exited');
    s.mark('exit', 'the engine exits; its row closes the observer');
    s.reap.dispose();
    s.channel.close();
    await o.closed;
    all.push(...s.rows.filter((r) => !('frame' in r && r.frame.t === 'hb')));
  }

  { // a heartbeat lost while the fence is armed cancels the reap; the row is held until it is heard again, here by a
    // heartbeat on the same connection (D69: no second hello), which re-arms nothing
    const s = scene('heartbeat-loss');
    const o = await s.connect();
    await s.hello(o);
    o.hb();
    s.mark('due', 'the row is due and verified empty');
    s.reap.due('idle');
    await o.next('arm');
    s.mark('silence', `no heartbeat for the silence window (${SILENCE_MS} ms): unhealthy, the reap cancelled`);
    await o.next('disarm', SILENCE_MS + 1_000);
    s.mark('due', 'due again: the unhealthy observer holds the row, nothing is armed');
    s.reap.due('idle');
    await sleep(50);
    o.hb();
    await until(() => s.reap.observer === 'healthy', 'the heal');
    expect(o.pending()).toEqual([]);
    s.mark('healthy', 'heard again by a heartbeat on the same connection; nothing is re-armed');
    s.mark('due', 'the row is due and verified empty');
    s.reap.due('idle');
    expect(await o.next('arm')).toEqual({ t: 'arm', fence: 2, leaseMs: LEASE_MS });
    await o.close();
    s.channel.close();
    all.push(...s.rows);
  }

  { // D69: an arm that meets a turn already under way; the observer still answers the arm, here before the host's answer
    // to the turn: the turn cancels the reap (proceed, disarm) and the late armed changes nothing
    const s = scene('turn-armed-proceed');
    const o = await s.connect();
    await s.hello(o);
    o.hb();
    s.mark('due', 'the row is due and verified empty');
    s.reap.due('idle');
    await o.next('arm');
    o.send({ t: 'turn', fence: 1, origin: 'cron' });
    o.send({ t: 'armed', fence: 1 });
    expect(await o.next('proceed')).toEqual({ t: 'proceed', fence: 1 });
    expect(await o.next('disarm')).toEqual({ t: 'disarm', fence: 1 });
    await sleep(50);
    expect([s.reap.state, s.reaped, o.pending()]).toEqual(['idle', [], []]);
    s.mark('unchanged', 'the late armed changes nothing: the reap stays idle, nothing armed or signalled');
    await o.close();
    s.channel.close();
    all.push(...s.rows);
  }

  { // D69: the same, its armed sent after the host's proceed and disarm
    const s = scene('turn-proceed-armed');
    const o = await s.connect();
    await s.hello(o);
    o.hb();
    s.mark('due', 'the row is due and verified empty');
    s.reap.due('idle');
    await o.next('arm');
    o.send({ t: 'turn', fence: 1, origin: 'cron' });
    expect(await o.next('proceed')).toEqual({ t: 'proceed', fence: 1 });
    expect(await o.next('disarm')).toEqual({ t: 'disarm', fence: 1 });
    o.send({ t: 'armed', fence: 1 });
    await sleep(50);
    expect([s.reap.state, s.reaped, o.pending()]).toEqual(['idle', [], []]);
    s.mark('unchanged', 'the late armed changes nothing: the reap stays idle, nothing armed or signalled');
    await o.close();
    s.channel.close();
    all.push(...s.rows);
  }

  { // D69: the lease renewed while signalled and its renewal answered: the SIGTERM goes in at its due time, no re-arm
    let exit!: (outcome: 'exited') => void;
    const sigterms = { n: 0 };
    const s = scene('sigterm-confirmed', undefined, undefined, idleSignal(new Promise((resolve) => (exit = resolve)), sigterms));
    const o = await s.connect();
    await s.hello(o);
    o.beat(50); // throughout; their count is timing, so the recording keeps none of them
    s.mark('heartbeats', 'the observer beats throughout this case (not recorded)');
    s.mark('due', 'the row is due and verified empty');
    s.reap.due('idle');
    await o.next('arm');
    o.send({ t: 'armed', fence: 1 });
    await until(() => s.reaped.length === 1, 'the signal');
    s.mark('wait', `the signal outlives the arm's lease less its margin (${LEASE_MS - MARGIN_MS} ms)`);
    await o.next('arm', LEASE_MS); // the renewal while signalled
    o.send({ t: 'armed', fence: 1 }); // answered: the lease stays confirmed
    await until(() => sigterms.n === 1, 'the SIGTERM');
    expect(o.pending()).toEqual([]);
    exit('exited');
    s.mark('exit', 'the engine exits; its row closes the observer');
    s.reap.dispose();
    s.channel.close();
    await o.closed;
    all.push(...s.rows.filter((r) => !('frame' in r && r.frame.t === 'hb')));
  }

  { // D69: the renewal unanswered: at the SIGTERM's due time the host re-arms, and with no armed within the lease less
    // its margin it sends no SIGTERM; the reap ends and the fence is disarmed
    const sigterms = { n: 0 };
    const s = scene('sigterm-withheld', undefined, undefined, idleSignal(new Promise(() => {}), sigterms));
    const o = await s.connect();
    await s.hello(o);
    o.beat(50);
    s.mark('heartbeats', 'the observer beats throughout this case (not recorded)');
    s.mark('due', 'the row is due and verified empty');
    s.reap.due('idle');
    await o.next('arm');
    o.send({ t: 'armed', fence: 1 });
    await until(() => s.reaped.length === 1, 'the signal');
    s.mark('wait', `the signal outlives the arm's lease less its margin (${LEASE_MS - MARGIN_MS} ms)`);
    await o.next('arm', LEASE_MS); // the renewal, left unanswered
    s.mark('unanswered', 'the observer leaves the renewal unanswered');
    await o.next('arm', LEASE_MS); // the re-arm at the SIGTERM's due time
    s.mark('wait', `no armed for the re-arm within the lease less its margin (${LEASE_MS - MARGIN_MS} ms)`);
    expect(await o.next('disarm', LEASE_MS + 1_000)).toEqual({ t: 'disarm', fence: 1 });
    expect([sigterms.n, s.reap.state]).toEqual([0, 'idle']);
    await o.close();
    s.channel.close();
    all.push(...s.rows.filter((r) => !('frame' in r && r.frame.t === 'hb')));
  }

  { // D69: re-armed at the SIGTERM's due time with the renewal unanswered; the observer then answers both arms in order:
    // the first answer is the renewal's and confirms nothing, the second is the re-arm's and the SIGTERM goes in
    let exit!: (outcome: 'exited') => void;
    const sigterms = { n: 0 };
    const s = scene('sigterm-rearmed', undefined, undefined, idleSignal(new Promise((resolve) => (exit = resolve)), sigterms));
    const o = await s.connect();
    await s.hello(o);
    o.beat(50);
    s.mark('heartbeats', 'the observer beats throughout this case (not recorded)');
    s.mark('due', 'the row is due and verified empty');
    s.reap.due('idle');
    await o.next('arm');
    o.send({ t: 'armed', fence: 1 });
    await until(() => s.reaped.length === 1, 'the signal');
    s.mark('wait', `the signal outlives the arm's lease less its margin (${LEASE_MS - MARGIN_MS} ms)`);
    await o.next('arm', LEASE_MS); // the renewal, not yet answered
    await o.next('arm', LEASE_MS); // the re-arm at the SIGTERM's due time
    o.send({ t: 'armed', fence: 1 }); // the renewal's
    await sleep(50);
    expect(sigterms.n).toBe(0);
    s.mark('unconfirmed', 'the answer to the older arm confirms nothing: no SIGTERM');
    o.send({ t: 'armed', fence: 1 }); // the re-arm's
    await until(() => sigterms.n === 1, 'the SIGTERM');
    exit('exited');
    s.mark('exit', 'the engine exits; its row closes the observer');
    s.reap.dispose();
    s.channel.close();
    await o.closed;
    all.push(...s.rows.filter((r) => !('frame' in r && r.frame.t === 'hb')));
  }

  { // the server's restart (the engine host replaced): the connection closes, the observer reconnects and says hello again
    const s = scene('server-restart');
    const o = await s.connect();
    await s.hello(o);
    s.mark('server_restart', 'the engine host is replaced: the gate closes and a new one listens at the same path');
    await gate.close();
    await o.closed;
    gate = new Gate({ log: () => {}, silenceMs: SILENCE_MS });
    await gate.listen(path);
    const t = scene('server-restart');
    t.rows.push(...s.rows);
    s.rows.length = 0;
    t.mark('backoff', 'the observer reconnects after its 5 s backoff');
    const again = await t.connect();
    await t.hello(again);
    t.mark('due', 'the row is due and verified empty');
    t.reap.due('idle');
    await again.next('arm');
    await again.close();
    t.channel.close();
    all.push(...t.rows);
  }

  { // a hello for a session no row holds is closed with nothing written
    const s = scene('no-row');
    s.channel.close();
    const o = await s.connect();
    o.hello('00000000-0000-4000-8000-000000000000', { pid: null, childPid: null });
    await o.closed;
    s.mark('closed', 'the gate closes the connection, writing nothing');
    all.push(...s.rows);
  }
  return all;
}

it('the recorded exchanges are the gate’s, case by case', async () => {
  const rows = await cases();
  const header = {
    fixture: 'p5-o16-gate', protocol: GATE_PROTOCOL, source: 'src/engine-host/holder/gate-fixture.test.ts',
    timings: { leaseMs: LEASE_MS, leaseMarginMs: MARGIN_MS, silenceMs: SILENCE_MS, endSessionGraceMs: GRACE_MS, production: { leaseMs: 10_000, leaseMarginMs: 1_000, silenceMs: 15_000, heartbeatMs: 5_000, reconnectBackoffMs: 5_000, endSessionGraceMs: 3_000 } },
    rows: '{case, from: observer|host, frame} for a frame; {case, event, detail} for a moment that is not one',
  };
  const text = `${[header, ...rows].map((row) => JSON.stringify(row)).join('\n')}\n`;
  if (process.env.MAWS_RECORD_GATE_FIXTURE === '1') writeFileSync(FIXTURE, text);
  const committed = readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as unknown);
  expect(committed).toEqual([header, ...rows]);
  expect(new Set(rows.map((r) => r.case))).toEqual(new Set(['proceed', 'stop', 'armed-renewing-turn-proceed', 'armed-veto-turn-proceed', 'no-answer', 'renew', 'heartbeat-loss', 'turn-armed-proceed', 'turn-proceed-armed', 'sigterm-confirmed', 'sigterm-withheld', 'sigterm-rearmed', 'server-restart', 'no-row']));
}, 30_000);
