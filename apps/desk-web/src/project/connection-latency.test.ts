// What one project's connection times for `latency/latency.ts` against the DX3 double: the project from its start until
// its backlog is caught up and verified, the socket from a drop until caught up again, the tab shown again until caught
// up after the reconnect that followed, and an RPC until its result.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { importOrgKey } from 'desk-hub/protocol';
import { DOUBLE_MEMBER, HubDouble } from '../../test/double/hub-double';
import { VECTOR_KEY, VECTOR_PROJECT as PROJECT } from '../../test/vectors';
import { latency, type LatencyPath } from '../latency/latency';
import { memoryLogRecord } from '../log/record';
import { ProjectConnection } from './connection';

// The log's verification, held back while `gate.held` is unresolved: a backlog caught up but not yet verified.
const gate = vi.hoisted(() => ({ held: Promise.resolve() }));
vi.mock('../log/verify', async (importOriginal) => {
  const real = await importOriginal<typeof import('../log/verify')>();
  return {
    ...real,
    verifyLogEvent: async (...args: Parameters<typeof real.verifyLogEvent>) => {
      await gate.held;
      return real.verifyLogEvent(...args);
    },
  };
});

const S1 = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const until = async (check: () => boolean, ms = 5000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const count = (path: LatencyPath) => latency.samples().filter((s) => s.path === path).length;

let hub: HubDouble;
let connection: ProjectConnection | null = null;
beforeEach(async () => {
  hub = await HubDouble.start({ orgKey: VECTOR_KEY });
});
afterEach(async () => {
  connection?.stop();
  connection = null;
  gate.held = Promise.resolve();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  await hub.close();
});

async function connect(): Promise<ProjectConnection> {
  connection = new ProjectConnection(PROJECT, { base: hub.url.replace(/^http/, 'ws'), record: memoryLogRecord(), delay: () => 20 });
  connection.setKey(await importOrgKey(VECTOR_KEY));
  await connection.start();
  return connection;
}

it('times the project until caught up once, then the socket from a drop until caught up again', async () => {
  const before = { open: count('project.caught-up'), gap: count('socket.gap') };
  const c = await connect();
  await until(() => count('project.caught-up') === before.open + 1);
  expect(latency.samples().findLast((s) => s.path === 'project.caught-up')!.ref).toBe(PROJECT);
  expect(count('socket.gap')).toBe(before.gap);

  hub.dropConnections(); // a deploy
  await until(() => count('socket.gap') === before.gap + 1);
  expect(c.live.getState().caughtUp).toBe(true);
  expect(count('project.caught-up')).toBe(before.open + 1); // the project's open is timed once
});

it('times the catch-up only once the backlog it brought is verified, the only entries a view draws', async () => {
  await hub.append(PROJECT, { writer: `mini/${S1}`, kind: 'message', from: 'maws-45', to: 'host', text: 'in the backlog', src: 'backlog' });
  let release!: () => void;
  gate.held = new Promise((resolve) => (release = resolve));
  const before = count('project.caught-up');
  const c = await connect();
  await until(() => c.live.getState().caughtUp);
  await new Promise((r) => setTimeout(r, 100));
  expect(c.log.store.getState().entries.map((e) => e.verdict)).toEqual(['pending']);
  expect(count('project.caught-up')).toBe(before); // caught up, not yet drawable

  release();
  await until(() => count('project.caught-up') === before + 1);
  expect(c.log.drawable()).toHaveLength(1);
});

function lifecycle() {
  const listeners = new Map<string, () => void>();
  const page = { visibilityState: 'visible', addEventListener: (name: string, f: () => void) => listeners.set(name, f), removeEventListener: () => {} };
  vi.stubGlobal('document', page);
  vi.stubGlobal('addEventListener', (name: string, f: () => void) => listeners.set(name, f));
  vi.stubGlobal('removeEventListener', () => {});
  return { listeners, page };
}

it('a healthy tab switch opens neither a new socket nor a new subscription, even after a quiet minute with JS still running', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  const { listeners, page } = lifecycle();
  const c = await connect();
  await until(() => c.live.getState().caughtUp);
  c.client.subscribe({ machine: 'mini', session: S1, agentId: null }, { message() {}, interrupted() {}, end() {} });
  await until(() => hub.subscriptions(PROJECT).length === 1);
  const resumes = hub.resumes(PROJECT).length;
  const sub = hub.subscriptions(PROJECT)[0].sub;
  page.visibilityState = 'hidden'; listeners.get('visibilitychange')!();
  vi.advanceTimersByTime(1000);
  page.visibilityState = 'visible'; listeners.get('visibilitychange')!();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(hub.resumes(PROJECT)).toHaveLength(resumes);
  expect(hub.subscriptions(PROJECT)[0].sub).toBe(sub);

  page.visibilityState = 'hidden'; listeners.get('visibilitychange')!();
  vi.advanceTimersByTime(60_000); // The heartbeat kept running, even if this idle session sent no frames.
  page.visibilityState = 'visible'; listeners.get('visibilitychange')!();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(hub.resumes(PROJECT)).toHaveLength(resumes);
  expect(hub.up.filter(({ frame }) => frame.t === 'subscribe')).toHaveLength(1);
});

for (const timerFirst of [false, true]) it(`iOS visibility return resnapshots after suspension despite buffered frames arriving first (heartbeat first: ${timerFirst})`, async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  const { listeners, page } = lifecycle();
  const before = count('wake.caught-up');
  let bufferedArrived = false;
  const NativeSocket = globalThis.WebSocket;
  vi.stubGlobal('WebSocket', class extends NativeSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.addEventListener('message', (event) => { if (String(event.data).includes('"buffered":true')) bufferedArrived = true; });
    }
  });
  const c = await connect();
  await until(() => c.live.getState().caughtUp);
  const resumes = hub.resumes(PROJECT).length;
  page.visibilityState = 'hidden'; listeners.get('visibilitychange')!();
  vi.setSystemTime(Date.now() + 60_000); // Wall clock advanced, but no JS timer or lifecycle event ran.
  if (timerFirst) vi.advanceTimersByTime(2000); // The first resumed heartbeat must latch the gap before overwriting it.
  hub.sendSession(PROJECT, { project: PROJECT, machine: 'mini', session: S1, kind: 'presence', sub: null, n: null, body: { record: { status: 'idle', buffered: true }, bridge: true } });
  await until(() => bufferedArrived); // Actual network delivery before visibilitychange, not a fresh liveness signal.
  expect(c.live.getState().presence[S1]).toBeUndefined(); // Do not spend wake time dispatching the suspended generation.
  page.visibilityState = 'visible'; listeners.get('visibilitychange')!();
  await until(() => count('wake.caught-up') === before + 1);
  expect(hub.resumes(PROJECT)).toHaveLength(resumes + 1);
});

it('explicit freeze/resume and online transitions renew state without a long suspension', async () => {
  const { listeners } = lifecycle();
  const before = { wake: count('wake.caught-up'), online: count('online.caught-up') };
  const c = await connect();
  await until(() => c.live.getState().caughtUp);
  listeners.get('freeze')!(); listeners.get('resume')!();
  await until(() => count('wake.caught-up') === before.wake + 1);
  listeners.get('online')!();
  await until(() => count('online.caught-up') === before.online + 1);
});

it('times an RPC from its sending until its result, by its nonce, and not one that failed', async () => {
  const c = await connect();
  await until(() => c.live.getState().connected);
  const before = count('rpc.interrupt');
  const nonce = await c.rpc(DOUBLE_MEMBER.id, 'mini', 'interrupt', { session: S1 });
  await until(() => hub.rpcState(PROJECT, nonce) === 'forwarded');
  expect(count('rpc.interrupt')).toBe(before); // forwarded is not its end
  hub.answerRpc(PROJECT, nonce, { state: 'done', result: { turnId: 't1', stopped: [], running: [] } });
  await until(() => count('rpc.interrupt') === before + 1);
  expect(latency.samples().findLast((s) => s.path === 'rpc.interrupt')!.ref).toBe(nonce);

  const failed = await c.rpc(DOUBLE_MEMBER.id, 'mini', 'interrupt', { session: S1 });
  await until(() => hub.rpcState(PROJECT, failed) === 'forwarded');
  hub.answerRpc(PROJECT, failed, { state: 'failed', error: { code: 'idle', message: 'no turn' } });
  await until(() => c.conversation.store.getState().rpcs[failed]?.state === 'failed');
  expect(count('rpc.interrupt')).toBe(before + 1);
});
