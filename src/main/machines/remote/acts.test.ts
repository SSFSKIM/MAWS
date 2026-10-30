// The link's acts (P5 O7 M1, "Acts"): the opId lifecycle against a channel the test plays, with fake timers.
import { generateSigningKey, isAction, OP_HORIZON_S, type Action, type DeviceMessage, type EndpointMessage } from 'org-protocol';
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
  const channel = { current: true };
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
