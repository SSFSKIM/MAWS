// The link's acts (P5 O7 M1, "Acts"): the opId lifecycle against a channel the test plays, with fake timers.
import { generateSigningKey, isAction, MESSAGE_MAX_BYTES, OP_HORIZON_S, type Action, type DeviceMessage, type EndpointMessage } from 'org-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';
import type { SignedIn } from '../../org/session';
import { ActTable, type ActOutcome, type ActRequest } from './acts';
import { timingOf } from './timing';

const REF = 'mini_0000000000000000000000' as MachineRef;
const CONTEXT = { lane: 'B' as const, launchId: 'launch-1', engineSessionId: 'eng-1' };
const SEND: ActRequest = { action: 'session.send', session: 'app-1', context: CONTEXT, args: { appSessionId: 'app-1', content: 'hi' } };

type Signer = SignedIn['stepUp']['sign'];

async function harness(options: { sign?: Signer } = {}) {
  const sent: DeviceMessage[] = [];
  // The current channel, and the capabilities its peer listed in `h2`.
  const channel = { current: true, peer: ['rl2.executor.machine'] as string[] };
  const key = await generateSigningKey();
  const signs: unknown[] = [];
  const sign: Signer =
    options.sign ??
    (async (request) => {
      const at = new Date().toISOString();
      const action = { v: 1, org: 'org-1', device: 'd1', nonce: 'A'.repeat(22), created: at, opId: request.opId!, opCreated: request.opCreated!, ...request, stepUp: 'B'.repeat(86) } as Action;
      return { ok: true, action };
    });
  const signedIn = { identity: { org: 'org-1', member: 'm1', device: 'd1', clientClass: 'native-mac', channelKey: key, build: 't', capabilities: [] }, stepUp: { sign: (r: Parameters<Signer>[0]) => (signs.push(r), sign(r)) }, view: null, hub: null } as unknown as SignedIn;
  const table = new ActTable({
    machine: REF,
    signedIn: () => signedIn,
    send: (message) => (channel.current ? (sent.push(message), true) : false),
    current: () => channel.current,
    peerCapabilities: () => (channel.current ? channel.peer : null),
    timing: timingOf(),
    now: () => Date.now(),
    log: () => {},
  });
  const acts = () => sent.filter((m): m is Extract<DeviceMessage, { t: 'act' }> => m.t === 'act');
  const queries = () => sent.filter((m) => m.t === 'query');
  const answer = (message: EndpointMessage) => table.receive(message);
  const drop = () => {
    channel.current = false;
    table.onLost();
  };
  const reconnect = () => {
    channel.current = true;
    table.onCurrent();
  };
  return { table, sent, acts, queries, answer, drop, reconnect, signs, channel };
}

const settled = async (outcome: Promise<ActOutcome>) => {
  let value: ActOutcome | null = null;
  void outcome.then((v) => (value = v));
  await vi.advanceTimersByTimeAsync(0);
  return value as ActOutcome | null;
};

beforeEach(() => void vi.useFakeTimers({ now: Date.parse('2026-10-28T12:00:00.000Z') }));
afterEach(() => void vi.useRealTimers());

describe('an act', () => {
  it('is built from the session, sent, accepted and done', async () => {
    const h = await harness();
    const handle = h.table.act(SEND, null);
    expect(handle.progress()).toBe('sent');
    const [m] = h.acts();
    expect(isAction(m.action)).toBe(true);
    expect(m.action).toMatchObject({ org: 'org-1', device: 'd1', machine: REF, action: 'session.send', session: 'app-1', context: CONTEXT, opId: handle.opId, opCreated: handle.opCreated });
    h.answer({ t: 'ack', opId: handle.opId, state: 'accepted' });
    expect(handle.progress()).toBe('accepted');
    h.answer({ t: 'done', opId: handle.opId, outcome: { state: 'done', result: { queueId: 'q1' } } });
    expect(await settled(handle.outcome)).toEqual({ state: 'done', result: { queueId: 'q1' } });
  });

  it('is refused by an ack that refuses a copy no other copy preceded', async () => {
    const h = await harness();
    const handle = h.table.act(SEND, null);
    h.answer({ t: 'ack', opId: handle.opId, state: 'refused', reason: 'grade' });
    expect(await settled(handle.outcome)).toEqual({ state: 'refused', reason: 'grade' });
  });

  it('is refused locally, malformed, for a session without its context or args that are not an object', async () => {
    const h = await harness();
    expect(await settled(h.table.act({ action: 'session.send', session: 'app-1', args: {} }, null).outcome)).toEqual({ state: 'refused', reason: 'malformed' });
    expect(await settled(h.table.act({ action: 'session.send', args: 'text' }, null).outcome)).toEqual({ state: 'refused', reason: 'malformed' });
    expect(h.sent).toEqual([]);
  });

  it('defaults its executor by name', async () => {
    const h = await harness();
    h.drop();
    for (const action of ['sminos.steer', 'endpoint.grant', 'session.send']) h.table.act({ action, args: {} }, null);
    h.reconnect();
    h.drop();
    h.reconnect(); // each was sent, then lost, and is resealed: never acked, within its window
    expect(h.acts().map((m) => m.action.action)).toEqual(['sminos.steer', 'endpoint.grant', 'session.send', 'sminos.steer', 'endpoint.grant', 'session.send']);
    vi.advanceTimersByTime(10_000); // no ack: queried, each to its executor
    expect(h.queries().map((m) => (m as { executor: string }).executor)).toEqual(['sminos', 'endpoint', 'engine-host']);
  });
});

describe('after a lost channel', () => {
  it('reseals an act dropped before its ack within 60 s: same opId and opCreated, a new nonce and created', async () => {
    const h = await harness();
    const handle = h.table.act(SEND, null);
    const first = h.acts()[0].action;
    h.drop();
    expect(handle.progress()).toBe('unknown');
    vi.advanceTimersByTime(5000);
    h.reconnect();
    const second = h.acts()[1].action;
    expect(second).toMatchObject({ opId: first.opId, opCreated: first.opCreated, args: first.args, context: first.context });
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.created).not.toBe(first.created);
    h.answer({ t: 'ack', opId: handle.opId, state: 'accepted' });
    h.answer({ t: 'done', opId: handle.opId, outcome: { state: 'done', result: 1 } });
    expect(await settled(handle.outcome)).toEqual({ state: 'done', result: 1 });
  });

  it('queries an act dropped after its ack', async () => {
    const h = await harness();
    const handle = h.table.act(SEND, null);
    h.answer({ t: 'ack', opId: handle.opId, state: 'accepted' });
    h.drop();
    h.reconnect();
    expect(h.acts()).toHaveLength(1);
    expect(h.queries()).toEqual([{ t: 'query', opId: handle.opId, opCreated: handle.opCreated, executor: 'engine-host' }]);
    h.answer({ t: 'queried', opId: handle.opId, state: 'done', outcome: { state: 'done', result: 'ran' } });
    expect(await settled(handle.outcome)).toEqual({ state: 'done', result: 'ran' });
  });

  it('queries again on the backoff while the answer is in-progress', async () => {
    const h = await harness();
    const handle = h.table.act(SEND, null);
    h.answer({ t: 'ack', opId: handle.opId, state: 'accepted' });
    h.drop();
    h.reconnect();
    h.answer({ t: 'queried', opId: handle.opId, state: 'in-progress' });
    vi.advanceTimersByTime(999);
    expect(h.queries()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(h.queries()).toHaveLength(2);
    h.answer({ t: 'queried', opId: handle.opId, state: 'unavailable' });
    vi.advanceTimersByTime(2000);
    expect(h.queries()).toHaveLength(3);
    h.answer({ t: 'queried', opId: handle.opId, state: 'not-received' });
    expect(await settled(handle.outcome)).toEqual({ state: 'not-sent' });
  });

  it('resolves `expired`, and a refusal with no outcome (`grade`) `unknown`', async () => {
    const h = await harness();
    const a = h.table.act(SEND, null);
    const b = h.table.act(SEND, null);
    for (const x of [a, b]) h.answer({ t: 'ack', opId: x.opId, state: 'accepted' });
    h.drop();
    h.reconnect();
    h.answer({ t: 'queried', opId: a.opId, state: 'expired' });
    h.answer({ t: 'queried', opId: b.opId, state: 'refused', reason: 'grade' });
    expect(await settled(a.outcome)).toEqual({ state: 'unknown', reason: 'expired' });
    expect(await settled(b.outcome)).toEqual({ state: 'unknown', reason: 'grade' });
  });

  it('asks again when the endpoint could not authorize the query now (`refused unavailable`)', async () => {
    const h = await harness();
    const a = h.table.act(SEND, null);
    h.answer({ t: 'ack', opId: a.opId, state: 'accepted' });
    h.drop();
    h.reconnect();
    h.answer({ t: 'queried', opId: a.opId, state: 'refused', reason: 'unavailable' });
    expect(await settled(a.outcome)).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(h.queries()).toHaveLength(2);
    h.answer({ t: 'queried', opId: a.opId, state: 'done', outcome: { state: 'done', result: 'ran' } });
    expect(await settled(a.outcome)).toEqual({ state: 'done', result: 'ran' });
  });

  it('takes a queried refusal with an outcome as the op’s own, terminal', async () => {
    const h = await harness();
    const a = h.table.act(SEND, null);
    h.answer({ t: 'ack', opId: a.opId, state: 'accepted' });
    h.drop();
    h.reconnect();
    h.answer({ t: 'queried', opId: a.opId, state: 'refused', outcome: { state: 'refused', reason: 'digest-mismatch' } });
    expect(await settled(a.outcome)).toEqual({ state: 'refused', reason: 'digest-mismatch' });
  });

  it('queries an ambiguous act whose reseal is refused (`context`, `grade`), and resolves with the first copy’s result', async () => {
    for (const reason of ['context', 'grade']) {
      const h = await harness();
      const handle = h.table.act(SEND, null);
      h.drop();
      h.reconnect();
      expect(h.acts()).toHaveLength(2);
      h.answer({ t: 'ack', opId: handle.opId, state: 'refused', reason });
      expect(await settled(handle.outcome)).toBeNull();
      expect(h.queries()).toHaveLength(1);
      h.answer({ t: 'queried', opId: handle.opId, state: 'done', outcome: { state: 'done', result: 'first' } });
      expect(await settled(handle.outcome)).toEqual({ state: 'done', result: 'first' });
    }
  });

  it('queries an ambiguous act whose reseal is accepted and then refused `unavailable`, staying ambiguous while the query answers `unavailable`', async () => {
    const h = await harness();
    const handle = h.table.act(SEND, null);
    h.drop();
    h.reconnect();
    h.answer({ t: 'ack', opId: handle.opId, state: 'accepted' });
    h.answer({ t: 'done', opId: handle.opId, outcome: { state: 'refused', reason: 'unavailable' } });
    expect(await settled(handle.outcome)).toBeNull();
    expect(h.queries()).toHaveLength(1);
    h.answer({ t: 'queried', opId: handle.opId, state: 'unavailable' });
    vi.advanceTimersByTime(1000);
    expect(h.queries()).toHaveLength(2);
    expect(await settled(handle.outcome)).toBeNull();
    h.answer({ t: 'queried', opId: handle.opId, state: 'done', outcome: { state: 'done', result: 'first' } });
    expect(await settled(handle.outcome)).toEqual({ state: 'done', result: 'first' });
  });

  it('counts no ack within 10 s on a live channel as lost: ambiguous, and queried', async () => {
    const h = await harness();
    const handle = h.table.act(SEND, null);
    vi.advanceTimersByTime(10_000);
    expect(h.queries()).toHaveLength(1);
    h.answer({ t: 'ack', opId: handle.opId, state: 'refused', reason: 'stale' }); // a late refusal settles nothing now
    expect(await settled(handle.outcome)).toBeNull();
  });

  it('queries an accepted act with no done within 60 s', async () => {
    const h = await harness();
    const handle = h.table.act(SEND, null);
    h.answer({ t: 'ack', opId: handle.opId, state: 'accepted' });
    vi.advanceTimersByTime(59_999);
    expect(h.queries()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(h.queries()).toHaveLength(1);
  });

  it('resolves `unknown expired` an act lost with its channel when no channel comes back within the operation horizon', async () => {
    const h = await harness();
    const handle = h.table.act(SEND, null);
    h.answer({ t: 'ack', opId: handle.opId, state: 'accepted' });
    h.drop();
    vi.advanceTimersByTime(OP_HORIZON_S * 1000);
    expect(await settled(handle.outcome)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(await settled(handle.outcome)).toEqual({ state: 'unknown', reason: 'expired' });
  });

  it('refuses `offline`, never sent, an act held past 60 s', async () => {
    const h = await harness();
    h.drop();
    const handle = h.table.act(SEND, null);
    expect(handle.progress()).toBe('waiting');
    vi.advanceTimersByTime(59_000);
    h.reconnect();
    h.drop();
    // it went on the channel at 59 s, so it was sent; a fresh one held the whole window is not
    const held = h.table.act(SEND, null);
    vi.advanceTimersByTime(60_000);
    expect(await settled(held.outcome)).toEqual({ state: 'refused', reason: 'offline' });
    h.reconnect();
    expect(h.acts().filter((m) => m.action.opId === held.opId)).toEqual([]);
    expect(handle.progress()).not.toBe('waiting');
  });

  it('ends the held window at the caller’s `sendBy` (P5 O7 M2: a send’s pending budget): refused `offline` then, never sent after', async () => {
    const h = await harness();
    h.drop();
    const handle = h.table.act({ ...SEND, sendBy: Date.now() + 1000 }, null);
    expect(handle.progress()).toBe('waiting');
    vi.advanceTimersByTime(999);
    expect(await settled(handle.outcome)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(await settled(handle.outcome)).toEqual({ state: 'refused', reason: 'offline' });
    h.reconnect();
    expect(h.acts()).toEqual([]);
    // One whose `sendBy` has already passed is never sent, even on a current channel.
    const late = h.table.act({ ...SEND, sendBy: Date.now() }, null);
    expect(await settled(late.outcome)).toEqual({ state: 'refused', reason: 'offline' });
    expect(h.acts()).toEqual([]);
  });

  it('reseals an act lost before its ack only before its `sendBy`; after it, the act is queried', async () => {
    const h = await harness();
    const handle = h.table.act({ ...SEND, sendBy: Date.now() + 1000 }, null);
    h.drop();
    vi.advanceTimersByTime(1000);
    h.reconnect();
    expect(h.acts().filter((m) => m.action.opId === handle.opId)).toHaveLength(1); // the first copy only
    expect(h.queries()).toHaveLength(1);
  });
});

describe('step-up', () => {
  it('signs a `required` act before its first send, and queries it after a drop: never resealed', async () => {
    const h = await harness();
    const handle = h.table.act({ ...SEND, stepUp: 'required' }, null);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.signs).toHaveLength(1);
    expect(h.signs[0]).toMatchObject({ machine: REF, action: 'session.send', opId: handle.opId, opCreated: handle.opCreated, context: CONTEXT });
    expect(h.acts()[0].action.stepUp).toBeDefined();
    h.drop();
    h.reconnect();
    expect(h.acts()).toHaveLength(1);
    expect(h.queries()).toHaveLength(1);
  });

  it('signs an `if-asked` act after a `step-up` refusal and sends it again under the same opId', async () => {
    const h = await harness();
    const handle = h.table.act(SEND, null);
    expect(h.acts()[0].action.stepUp).toBeUndefined();
    h.answer({ t: 'ack', opId: handle.opId, state: 'refused', reason: 'step-up' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.signs).toHaveLength(1);
    const again = h.acts()[1].action;
    expect(again).toMatchObject({ opId: handle.opId, opCreated: handle.opCreated });
    expect(again.stepUp).toBeDefined();
    h.answer({ t: 'ack', opId: handle.opId, state: 'accepted' });
    h.answer({ t: 'done', opId: handle.opId, outcome: { state: 'done', result: null } });
    expect(await settled(handle.outcome)).toEqual({ state: 'done', result: null });
  });

  it('takes a `step-up` refusal under `never` as final', async () => {
    const h = await harness();
    const handle = h.table.act({ ...SEND, stepUp: 'never' }, null);
    h.answer({ t: 'ack', opId: handle.opId, state: 'refused', reason: 'step-up' });
    expect(await settled(handle.outcome)).toEqual({ state: 'refused', reason: 'step-up' });
    expect(h.signs).toHaveLength(0);
  });

  it('queries a `step-up` refusal of an ambiguous act, never signing it', async () => {
    const h = await harness();
    const handle = h.table.act(SEND, null);
    h.drop();
    h.reconnect();
    h.answer({ t: 'ack', opId: handle.opId, state: 'refused', reason: 'step-up' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.signs).toHaveLength(0);
    expect(h.queries()).toHaveLength(1);
  });

  it('resolves a cancelled confirmation `refused step-up-cancelled`', async () => {
    const h = await harness({ sign: async () => ({ ok: false, reason: 'cancelled' }) });
    const handle = h.table.act({ ...SEND, stepUp: 'required' }, null);
    expect(await settled(handle.outcome)).toEqual({ state: 'refused', reason: 'step-up-cancelled' });
    expect(h.acts()).toEqual([]);
  });
});

describe('the link’s end', () => {
  it('refuses acts never sent and leaves acts sent unknown', async () => {
    const h = await harness();
    const sent = h.table.act(SEND, null);
    h.drop();
    const waiting = h.table.act(SEND, null);
    h.table.close('removed');
    expect(await settled(sent.outcome)).toEqual({ state: 'unknown', reason: 'removed' });
    expect(await settled(waiting.outcome)).toEqual({ state: 'refused', reason: 'removed' });
    expect(await settled(h.table.act(SEND, 'closed').outcome)).toEqual({ state: 'refused', reason: 'closed' });
  });
});

// P5 O7 M2: what the peer could not read is never sent, since the endpoint would close the channel on it (RL2's
// capabilities), and neither is what the channel would refuse to carry (its message limit).
describe('what the peer reads', () => {
  const ACQUIRE: ActRequest = { action: 'session.acquire', args: { appSessionId: 'app-1', reason: 'send' }, executor: 'machine' };

  it('sends a `machine` act to a peer that listed `rl2.executor.machine`, and queries it there', async () => {
    const h = await harness();
    const handle = h.table.act(ACQUIRE, null);
    expect(h.acts().map((m) => m.action.action)).toEqual(['session.acquire']);
    h.answer({ t: 'ack', opId: handle.opId, state: 'accepted' });
    h.drop();
    h.reconnect();
    expect(h.queries()).toEqual([{ t: 'query', opId: handle.opId, opCreated: handle.opCreated, executor: 'machine' }]);
  });

  it('refuses `not-offered`, never sent, a `machine` act for a peer that did not list it', async () => {
    const h = await harness();
    h.channel.peer = [];
    expect(await settled(h.table.act(ACQUIRE, null).outcome)).toEqual({ state: 'refused', reason: 'not-offered' });
    expect(h.sent).toEqual([]);
  });

  it('refuses `not-offered` a `machine` act held for a channel whose peer turns out not to list it', async () => {
    const h = await harness();
    h.drop();
    const handle = h.table.act(ACQUIRE, null);
    h.channel.peer = [];
    h.reconnect();
    expect(await settled(handle.outcome)).toEqual({ state: 'refused', reason: 'not-offered' });
    expect(h.sent).toEqual([]);
  });

  it('leaves `unknown not-offered`, never queried, a `machine` act that went out when the next channel’s peer does not list it', async () => {
    const h = await harness();
    const handle = h.table.act(ACQUIRE, null);
    h.answer({ t: 'ack', opId: handle.opId, state: 'accepted' });
    h.drop();
    h.channel.peer = [];
    h.reconnect();
    expect(await settled(handle.outcome)).toEqual({ state: 'unknown', reason: 'not-offered' });
    expect(h.queries()).toEqual([]);
  });

  it('sends RL2’s first three executors to a peer that listed nothing', async () => {
    const h = await harness();
    h.channel.peer = [];
    for (const action of ['sminos.steer', 'endpoint.grant', 'session.send']) h.table.act({ action, args: {} }, null);
    expect(h.acts().map((m) => m.action.action)).toEqual(['sminos.steer', 'endpoint.grant', 'session.send']);
  });

  /** A `session.send` whose `act` message is `size` bytes of UTF-8 JSON, its padding in one text block. */
  const sized = (size: number): ActRequest => {
    const probe = { ...SEND, args: { appSessionId: 'app-1', content: '' } };
    const base = new TextEncoder().encode(JSON.stringify({ t: 'act', action: { ...SEND, ...shape(probe) } })).length;
    return { ...SEND, args: { appSessionId: 'app-1', content: 'x'.repeat(size - base) } };
  };
  // The fields a built act adds beside the request's, at their final lengths (an opId of 16 bytes, a nonce, two times).
  const shape = (request: ActRequest) => ({ v: 1, org: 'org-1', machine: REF, device: 'd1', opId: 'o'.repeat(22), opCreated: '2026-10-28T12:00:00.000Z', action: request.action, args: request.args, nonce: 'n'.repeat(22), created: '2026-10-28T12:00:00.000Z' });

  it('refuses `too-large`, never sent, an act whose sealed form is over the channel’s message limit, and sends one at it', async () => {
    const h = await harness();
    expect(await settled(h.table.act(sized(MESSAGE_MAX_BYTES + 1), null).outcome)).toEqual({ state: 'refused', reason: 'too-large' });
    expect(h.sent).toEqual([]);
    h.table.act(sized(MESSAGE_MAX_BYTES), null);
    expect(h.acts()).toHaveLength(1);
    expect(new TextEncoder().encode(JSON.stringify(h.acts()[0])).length).toBe(MESSAGE_MAX_BYTES);
  });

  it('refuses `too-large` a `required` act before the person is asked, and one that the signature takes over the limit after', async () => {
    const h = await harness();
    expect(await settled(h.table.act({ ...sized(MESSAGE_MAX_BYTES + 1), stepUp: 'required' }, null).outcome)).toEqual({ state: 'refused', reason: 'too-large' });
    expect(h.signs).toEqual([]);
    const handle = h.table.act({ ...sized(MESSAGE_MAX_BYTES), stepUp: 'required' }, null);
    expect(await settled(handle.outcome)).toEqual({ state: 'refused', reason: 'too-large' });
    expect(h.signs).toHaveLength(1);
    expect(h.sent).toEqual([]);
  });
});

// P5 O7 M4 (the architect's ruling on a spawn that answered `unknown`): an op settled unknown is asked about again, by
// query alone, so a ledger that has since recorded its outcome is heard; past the horizon no ledger answers.
describe('an op asked about again', () => {
  it('sends only a query, never the act, and takes the ledger’s answer as its outcome', async () => {
    const h = await harness();
    const first = h.table.act(SEND, null);
    h.answer({ t: 'ack', opId: first.opId, state: 'accepted' });
    h.drop();
    h.reconnect();
    h.answer({ t: 'queried', opId: first.opId, state: 'refused', reason: 'grade' });
    expect(await settled(first.outcome)).toEqual({ state: 'unknown', reason: 'grade' });
    const sentBefore = h.acts().length;
    const again = h.table.requery({ opId: first.opId, opCreated: first.opCreated, executor: 'engine-host' }, null);
    expect(again.opId).toBe(first.opId);
    expect(h.queries().at(-1)).toMatchObject({ t: 'query', opId: first.opId, opCreated: first.opCreated, executor: 'engine-host' });
    h.answer({ t: 'queried', opId: first.opId, state: 'in-progress' });
    await vi.advanceTimersByTimeAsync(60_000); // asked again on the backoff
    h.answer({ t: 'queried', opId: first.opId, state: 'done', outcome: { state: 'done', result: { queueId: 'q1' } } });
    expect(await settled(again.outcome)).toEqual({ state: 'done', result: { queueId: 'q1' } });
    expect(h.acts()).toHaveLength(sentBefore); // the act itself never again
  });

  it('asks on the next channel when none is current, and settles `unknown` past the horizon or on a link that ended', async () => {
    const h = await harness();
    h.channel.current = false;
    const op = { opId: 'op-x', opCreated: new Date().toISOString(), executor: 'engine-host' as const };
    const later = h.table.requery(op, null);
    expect(h.queries()).toEqual([]);
    h.reconnect();
    expect(h.queries()).toHaveLength(1);
    vi.advanceTimersByTime(OP_HORIZON_S * 1000 + 1);
    expect(await settled(later.outcome)).toEqual({ state: 'unknown', reason: 'expired' });
    const stale = h.table.requery({ ...op, opId: 'op-y', opCreated: new Date(Date.now() - OP_HORIZON_S * 1000 - 1).toISOString() }, null);
    expect(await settled(stale.outcome)).toEqual({ state: 'unknown', reason: 'expired' });
    const closed = h.table.requery({ ...op, opId: 'op-z' }, 'closed');
    expect(await settled(closed.outcome)).toEqual({ state: 'unknown', reason: 'closed' });
  });
});
