// What one project's connection times for `latency/latency.ts` against the DX3 double: the project from its start until
// its backlog is caught up, the socket from a drop until caught up again, the tab shown again until caught up after the
// reconnect that followed, and an RPC until its result.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { importOrgKey } from 'desk-hub/protocol';
import { DOUBLE_MEMBER, HubDouble } from '../../test/double/hub-double';
import { VECTOR_KEY, VECTOR_PROJECT as PROJECT } from '../../test/vectors';
import { latency, type LatencyPath } from '../latency/latency';
import { memoryLogRecord } from '../log/record';
import { ProjectConnection } from './connection';

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
  vi.unstubAllGlobals();
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

it('times the tab shown again until caught up after the reconnect that followed, and not a return that needed none', async () => {
  const listeners = new Map<string, () => void>();
  const page = { visibilityState: 'visible', addEventListener: (name: string, f: () => void) => listeners.set(name, f), removeEventListener: () => {} };
  vi.stubGlobal('document', page);
  vi.stubGlobal('addEventListener', (name: string, f: () => void) => listeners.set(name, f));
  vi.stubGlobal('removeEventListener', () => {});
  const before = { wake: count('wake.caught-up'), online: count('online.caught-up') };
  const c = await connect();
  await until(() => c.live.getState().caughtUp);

  listeners.get('visibilitychange')!(); // shown again with the socket still up: nothing to time
  await new Promise((r) => setTimeout(r, 100));
  expect(count('wake.caught-up')).toBe(before.wake);

  listeners.get('visibilitychange')!(); // shown again, and the socket turns out to be gone (a phone's woken tab)
  hub.dropConnections();
  await until(() => count('wake.caught-up') === before.wake + 1);

  listeners.get('online')!(); // back online, the socket dropped with the network
  hub.dropConnections();
  await until(() => count('online.caught-up') === before.online + 1);
  expect(count('wake.caught-up')).toBe(before.wake + 1);
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
