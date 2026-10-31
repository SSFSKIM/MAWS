// O16 M5: the gate's conformance fixture (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, Interfaces §E; D19),
// `spikes/protocol-probe/fixtures/p5/p5-o16-gate.jsonl`, which O12 M4's bridge test replays. Each case runs the engine
// host's real gate and reap against a fake observer on a real Unix socket and records the exchange in both directions,
// in the order it happened, with the moments that are not frames marked as events (the host's signal, a silence, the
// server's restart). This test compares a run with the committed file, frame for frame; `MAWS_RECORD_GATE_FIXTURE=1`
// rewrites the file from the run instead. Timings are shortened for the test (the header names them); every frame is
// as the engine host writes it.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { EngineSessionStatusSchema } from '@shared/engine/status';
import { FakeObserver, type Exchanged } from './fake-observer';
import { Gate, GATE_PROTOCOL, STOP_REASON } from './gate';
import { Reap, type ReapReason } from './reap';

const FIXTURE = join(__dirname, '../../../spikes/protocol-probe/fixtures/p5/p5-o16-gate.jsonl');
const LEASE_MS = 400;
const MARGIN_MS = 100;
const SILENCE_MS = 200;
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
function scene(name: string, outcome: Promise<'exited' | 'ignored'> = new Promise(() => {})) {
  const rows: Row[] = [];
  const sink = { push: (row: Exchanged) => rows.push({ case: name, ...row }) };
  const mark = (event: string, detail?: string) => rows.push({ case: name, event, ...(detail && { detail }) });
  const channel = gate.channel({ lineage: () => new Set([SESSION]), pid: () => PID });
  const reaped: ReapReason[] = [];
  const reap = new Reap('app-fixture', {
    gate: channel, current: () => IDLE, stateful: () => new Set(), interest: () => false, descendants: () => 0,
    reap: (reason) => {
      reaped.push(reason);
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

  { // a heartbeat lost while the fence is armed cancels the reap; the row is held until a fresh hello
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
    o.hello(SESSION, { pid: PID, childPid: CHILD });
    await o.next('welcome');
    s.mark('healthy', 'heard again by a fresh hello');
    s.mark('due', 'the row is due and verified empty');
    s.reap.due('idle');
    expect(await o.next('arm')).toEqual({ t: 'arm', fence: 2, leaseMs: LEASE_MS });
    await o.close();
    s.channel.close();
    all.push(...s.rows);
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
    timings: { leaseMs: LEASE_MS, leaseMarginMs: MARGIN_MS, silenceMs: SILENCE_MS, production: { leaseMs: 10_000, leaseMarginMs: 1_000, silenceMs: 15_000, heartbeatMs: 5_000, reconnectBackoffMs: 5_000 } },
    rows: '{case, from: observer|host, frame} for a frame; {case, event, detail} for a moment that is not one',
  };
  const text = `${[header, ...rows].map((row) => JSON.stringify(row)).join('\n')}\n`;
  if (process.env.MAWS_RECORD_GATE_FIXTURE === '1') writeFileSync(FIXTURE, text);
  const committed = readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as unknown);
  expect(committed).toEqual([header, ...rows]);
  expect(new Set(rows.map((r) => r.case))).toEqual(new Set(['proceed', 'stop', 'no-answer', 'renew', 'heartbeat-loss', 'server-restart', 'no-row']));
}, 20_000);
