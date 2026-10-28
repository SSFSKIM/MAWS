// The cards client (P5 O13 M4, §D): a channel opened through a Machine socket with the package's own handshake, a
// `cards` subscription drawn into cards (snapshots replacing the set whole, lane A's raises and settlements between),
// its credit topped up at half, a channel's close resubscribed through a new channel after backoff; and the suite that
// pins what the phone's code ever sends (Constraints, "Nothing but cards"): every exported function driven against an
// in-memory endpoint that keeps what crossed the channel.
import {
  acceptChannel,
  base64urlEncode,
  ChannelError,
  generateSigningKey,
  memoryOrgView,
  type Action,
  type ByteDuplex,
  type Channel,
  type ChannelMessage,
  type DeviceIdentity,
  type SignedOrgState,
} from 'org-protocol';
import { duplexPair, SoftwareAuthenticator } from 'org-protocol/test-support';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { inputSha256 } from 'desk-hub/protocol';
import type { SessionEvent } from '@shared/graph/events';
import { requestDigestOf } from '@shared/host/request-digest';
import { FakeChannel } from '../../test/channel';
import { endorsedBy, nextOf, rootedOrg, signedBy } from '../../test/org';
import * as answers from './answers';
import { laneACard, laneACards, laneBCards, type Card } from './cards';
import type { MachineSocket } from './carrier';
import type { DeviceRecord } from './device-store';
import * as client from './client';
import { CARDS_CREDIT, followCards, openChannel, subscribeCards, type MachineChannel } from './client';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(probe: () => T | undefined | null | false, what: string, ms = 3000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value !== undefined && value !== null && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(5);
  }
}

const RAISED = { request: 'toolu_1', session: 'la-1', tool: 'Bash', input: { command: 'ls' } };
const ASKED = { request: 'toolu_2', session: 'la-1', tool: 'AskUserQuestion', input: { questions: [{ question: 'Which?', options: [{ label: 'A' }] }] } };
const APP = 'app-1';
const PERMISSION = { id: `${APP}:launch-1:1:0`, sessionId: 'eng-1', at: '', seq: 1, agentId: null, parentToolUseId: null, kind: 'permission.requested', requestId: 'rq-p', toolUseId: 'tu-p', toolName: 'Bash', input: { command: 'git log' } } as unknown as SessionEvent;
const QUESTION = { ...PERMISSION, kind: 'question.requested', requestId: 'rq-q', questions: [{ question: 'Which?', options: [{ label: 'A' }] }] } as unknown as SessionEvent;
const item = (requestId: string, kind: string) => ({ id: `att-${requestId}`, appSessionId: APP, sessionId: 'eng-1', kind, request: { requestId, toolUseId: null, taskId: null, agentId: null }, summary: kind, createdAt: '', state: 'pending', stateChangedAt: '', expiresAt: null });
const pending = (request: SessionEvent, kind: string) => ({ item: item((request as unknown as { requestId: string }).requestId, kind), request, context: { launchId: 'launch-1', engineSessionId: 'eng-1' }, requestDigest: requestDigestOf(APP, request) });
const LANE_A_BODY = { raised: [RAISED, ASKED], launch: 'L1' };
const LANE_B_BODY = { pendingItems: [pending(PERMISSION, 'permission'), pending(QUESTION, 'question')] };

/** A snapshot of `body` on `sub`, as the endpoint pages it: its JSON text in `pages` pieces. */
function snap(sub: string, body: unknown, pages = 1): ChannelMessage[] {
  const text = JSON.stringify(body);
  const size = Math.ceil(text.length / pages);
  return Array.from({ length: pages }, (_, page) => ({ t: 'snap', sub, epoch: 'e1', seq: 0, page, last: page === pages - 1, body: text.slice(page * size, (page + 1) * size) }));
}

const ids = (cards: Card[]) => cards.map((c) => (c.lane === 'A' ? c.raised.request : c.item.request.requestId));

describe('a cards subscription', () => {
  it('asks for the cards view from no cursor under 1 MiB of credit, and draws each snapshot whole, its pages joined', async () => {
    const channel = new FakeChannel();
    const sets: Card[][] = [];
    subscribeCards(channel, { lane: 'A', id: 'la-1' }, { cards: (set) => sets.push(set), ended: () => {} });
    const [sub] = channel.of('sub');
    expect(sub).toEqual({ t: 'sub', sub: sub.sub, session: { lane: 'A', id: 'la-1' }, view: 'cards', cursor: null, credit: CARDS_CREDIT });
    expect(CARDS_CREDIT).toBe(1024 * 1024);
    for (const m of snap(sub.sub as string, LANE_A_BODY, 3)) channel.deliver(m);
    await until(() => sets.length === 1, 'the cards');
    expect(sets[0]).toEqual((await laneACards(LANE_A_BODY)).cards);
    for (const m of snap(sub.sub as string, { raised: [ASKED], launch: 'L2' })) channel.deliver(m);
    await until(() => sets.length === 2, 'the replacing set');
    expect(sets[1]).toEqual((await laneACards({ raised: [ASKED], launch: 'L2' })).cards);
  });

  it('adds a lane A raise and removes a settlement between snapshots, under the snapshot’s launch', async () => {
    const channel = new FakeChannel();
    const sets: Card[][] = [];
    subscribeCards(channel, { lane: 'A', id: 'la-1' }, { cards: (set) => sets.push(set), ended: () => {} });
    const sub = channel.of('sub')[0].sub as string;
    for (const m of snap(sub, { raised: [RAISED], launch: 'L1' })) channel.deliver(m);
    const raise = { ...RAISED, request: 'toolu_3' };
    channel.deliver({ t: 'ev', sub, epoch: 'e1', seq: 1, body: { project: 'p', machine: 'mini', session: 'la-1', kind: 'raised', sub: null, n: null, body: raise } });
    channel.deliver({ t: 'ev', sub, epoch: 'e1', seq: 2, body: { project: 'p', machine: 'mini', session: 'la-1', kind: 'settled', sub: null, n: null, body: { request: 'toolu_1', outcome: 'allow' } } });
    channel.deliver({ t: 'ev', sub, epoch: 'e1', seq: 3, body: { kind: 'raised', body: RAISED } }); // the same request again: kept once
    channel.deliver({ t: 'ev', sub: 'another', epoch: 'e1', seq: 1, body: { kind: 'raised', body: { ...RAISED, request: 'toolu_9' } } });
    await until(() => sets.length === 4, 'four sets');
    expect(sets.map(ids)).toEqual([['toolu_1'], ['toolu_1', 'toolu_3'], ['toolu_3'], ['toolu_3', 'toolu_1']]);
    expect(sets[1][1]).toMatchObject({ lane: 'A', launch: 'L1' });
  });

  it('replaces a held lane A card a raise republishes changed, its digest over the new input, and draws nothing for one republished unchanged', async () => {
    const channel = new FakeChannel();
    const sets: Card[][] = [];
    subscribeCards(channel, { lane: 'A', id: 'la-1' }, { cards: (set) => sets.push(set), ended: () => {} });
    const sub = channel.of('sub')[0].sub as string;
    const old = { ...RAISED, input: { command: 'old' } };
    for (const m of snap(sub, { raised: [old, ASKED], launch: 'L1' })) channel.deliver(m);
    channel.deliver({ t: 'ev', sub, epoch: 'e1', seq: 1, body: { kind: 'raised', body: old } }); // unchanged: nothing drawn
    const changed = { ...RAISED, input: { command: 'new' } };
    channel.deliver({ t: 'ev', sub, epoch: 'e1', seq: 2, body: { kind: 'raised', body: changed } });
    await until(() => sets.length === 2, 'two sets');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sets).toHaveLength(2);
    expect(sets[1]).toEqual([await laneACard(changed, 'L1'), sets[0][1]]);
    expect(sets[1][0].lane === 'A' && sets[1][0].digest.input_sha256).toBe(await inputSha256(changed.input));
  });

  it('draws lane B’s snapshot with each card’s digests', async () => {
    const channel = new FakeChannel();
    const sets: Card[][] = [];
    subscribeCards(channel, { lane: 'B', id: APP }, { cards: (set) => sets.push(set), ended: () => {} });
    for (const m of snap(channel.of('sub')[0].sub as string, LANE_B_BODY)) channel.deliver(m);
    await until(() => sets.length === 1, 'the cards');
    expect(sets[0]).toEqual(await laneBCards(APP, LANE_B_BODY));
  });

  it('tops its credit up once half of it is spent, by what was spent', async () => {
    const channel = new FakeChannel();
    subscribeCards(channel, { lane: 'A', id: 'la-1' }, { cards: () => {}, ended: () => {} });
    const sub = channel.of('sub')[0].sub as string;
    const big = { ...RAISED, input: { command: 'x'.repeat(200 * 1024) } };
    const sent: number[] = [];
    for (let i = 0; i < 2; i++) {
      const m = { t: 'ev', sub, epoch: 'e1', seq: i + 1, body: { kind: 'raised', body: { ...big, request: `toolu_${i}` } } };
      sent.push(new TextEncoder().encode(JSON.stringify(m)).length);
      channel.deliver(m);
    }
    expect(channel.of('credit')).toEqual([]);
    const last = { t: 'ev', sub, epoch: 'e1', seq: 3, body: { kind: 'raised', body: { ...big, request: 'toolu_2' } } };
    sent.push(new TextEncoder().encode(JSON.stringify(last)).length);
    channel.deliver(last);
    await until(() => channel.of('credit').length === 1, 'the top-up');
    expect(channel.of('credit')).toEqual([{ t: 'credit', sub, bytes: sent.reduce((a, b) => a + b, 0) }]);
  });

  it('ends with the endpoint’s reason, or the channel’s, and sends `unsub` only when the phone closes it', async () => {
    const channel = new FakeChannel();
    const ended: string[] = [];
    subscribeCards(channel, { lane: 'A', id: 'la-1' }, { cards: () => {}, ended: (reason) => ended.push(reason) });
    channel.deliver({ t: 'ended', sub: channel.of('sub')[0].sub, reason: 'removed' });
    await until(() => ended.length === 1, 'the end');
    expect(ended).toEqual(['removed']);

    const other = new FakeChannel();
    const ended2: string[] = [];
    subscribeCards(other, { lane: 'A', id: 'la-1' }, { cards: () => {}, ended: (reason) => ended2.push(reason) });
    other.close('app-gone');
    await until(() => ended2.length === 1, 'the end');
    expect(ended2).toEqual(['app-gone']);

    const third = new FakeChannel();
    const sets: Card[][] = [];
    const subscription = subscribeCards(third, { lane: 'A', id: 'la-1' }, { cards: (set) => sets.push(set), ended: () => {} });
    subscription.close();
    expect(third.of('unsub')).toEqual([{ t: 'unsub', sub: third.of('sub')[0].sub }]);
    for (const m of snap(third.of('sub')[0].sub as string, LANE_A_BODY)) third.deliver(m);
    await sleep(20);
    expect(sets).toEqual([]);
  });
});

describe('following a session’s cards', () => {
  it('resubscribes through a new channel after a channel’s close, each time from a snapshot', async () => {
    const channels: FakeChannel[] = [];
    const sets: string[][] = [];
    const current: Array<MachineChannel | null> = [];
    const follow = followCards(
      async () => {
        const c = new FakeChannel();
        channels.push(c);
        return c;
      },
      { lane: 'A', id: 'la-1' },
      { cards: (set) => sets.push(ids(set) as string[]), ended: () => {}, channel: (c) => current.push(c) },
      { delay: () => 10 },
    );
    await until(() => channels[0]?.of('sub').length === 1, 'the first sub');
    for (const m of snap(channels[0].of('sub')[0].sub as string, { raised: [RAISED], launch: 'L1' })) channels[0].deliver(m);
    await until(() => sets.length === 1, 'the first set');
    channels[0].close('app-gone');
    await until(() => channels[1]?.of('sub').length === 1, 'the resubscription');
    expect(channels[1].of('sub')[0]).toMatchObject({ cursor: null, view: 'cards' });
    for (const m of snap(channels[1].of('sub')[0].sub as string, { raised: [RAISED, ASKED], launch: 'L1' })) channels[1].deliver(m);
    await until(() => sets.length === 2, 'the set again');
    expect(sets).toEqual([['toolu_1'], ['toolu_1', 'toolu_2']]);
    expect(current).toEqual([channels[0], null, channels[1]]);
    follow.close();
    expect(channels[1].of('unsub')).toHaveLength(1);
    expect(channels[1].closed).toBe(true);
  });

  it('stops at an end the session gives (`removed`, `unavailable`) or a refusal of the device, and retries what passes', async () => {
    const ended: string[] = [];
    const channels: FakeChannel[] = [];
    followCards(
      async () => {
        const c = new FakeChannel();
        channels.push(c);
        return c;
      },
      { lane: 'A', id: 'la-1' },
      { cards: () => {}, ended: (reason) => ended.push(reason) },
      { delay: () => 10 },
    );
    await until(() => channels[0]?.of('sub').length === 1, 'the sub');
    channels[0].deliver({ t: 'ended', sub: channels[0].of('sub')[0].sub, reason: 'removed' });
    await until(() => ended.length === 1, 'the end');
    expect(ended).toEqual(['removed']);
    await sleep(40);
    expect(channels).toHaveLength(1);
    expect(channels[0].closed).toBe(true);

    let tries = 0;
    const refused: string[] = [];
    followCards(
      async () => {
        tries += 1;
        if (tries === 1) throw new Error('machine socket: not connected within 30000 ms');
        if (tries === 2) throw new ChannelError('timeout');
        throw new ChannelError('unknown-device');
      },
      { lane: 'A', id: 'la-1' },
      { cards: () => {}, ended: (reason) => refused.push(reason) },
      { delay: () => 10 },
    );
    await until(() => refused.length === 1, 'the refusal');
    expect(refused).toEqual(['unknown-device']);
    expect(tries).toBe(3);
  });
});

// ---- What crosses the channel --------------------------------------------------------------------------------------

const ORIGIN = 'https://desk.example';
let chain: SignedOrgState[];
let identity: DeviceIdentity;
let machine: { ref: string; key: Awaited<ReturnType<typeof generateSigningKey>> };
let authenticator: SoftwareAuthenticator;
let root: Awaited<ReturnType<typeof rootedOrg>>;

beforeAll(async () => {
  const org = await rootedOrg('org-cards');
  root = org;
  machine = { ref: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))), key: await generateSigningKey() };
  const channelKey = await generateSigningKey(false);
  authenticator = new SoftwareAuthenticator(await generateSigningKey(), base64urlEncode(crypto.getRandomValues(new Uint8Array(16))), 'desk.example');
  const phone = await endorsedBy('org-cards', org.member, { id: 'phone-1', class: 'web-cards', keyStorage: 'webcrypto', channelPub: channelKey.pub, passkey: authenticator.passkey }, org.admin);
  const v2 = await signedBy(
    await nextOf(org.genesis, (s) => {
      s.machines.push({ name: 'mini', ref: machine.ref, pub: machine.key.pub, owners: [org.member] });
      s.machineNames.push({ name: 'mini', ref: machine.ref });
      s.members[0].devices.push(phone);
    }),
    org.admin,
  );
  chain = [org.genesis, v2];
  const record: DeviceRecord = { deviceId: 'phone-1', member: org.member, channelKey: channelKey.privateKey, channelPub: channelKey.pub, passkey: authenticator.passkey, pins: org.pins, state: { kind: 'listed', version: 2 } };
  identity = client.cardsIdentity('org-cards', record);
});

/** An endpoint in memory: each dial a fresh channel it accepts with the package's handshake, keeping every message. */
function memoryEndpoint() {
  const received: ChannelMessage[] = [];
  const channels: Channel[] = [];
  const answer = (channel: Channel, m: ChannelMessage) => {
    if (m.t === 'sub') {
      const body = (m.session as { lane: string }).lane === 'A' ? LANE_A_BODY : LANE_B_BODY;
      void channel.send({ t: 'subbed', sub: m.sub as string, mode: 'snapshot', epoch: 'e1', seq: 0 });
      for (const page of snap(m.sub as string, body)) void channel.send(page);
    }
    if (m.t === 'act') {
      const action = m.action as Action;
      void channel.send({ t: 'ack', opId: action.opId, state: 'accepted' });
      void channel.send({ t: 'done', opId: action.opId, outcome: { state: 'done', result: {} } });
    }
  };
  const socket: MachineSocket = {
    dial: async (): Promise<ByteDuplex> => {
      const [device, endpoint] = duplexPair();
      void acceptChannel(endpoint, { ref: machine.ref, key: machine.key, build: 'memory', capabilities: [] }, memoryOrgView({ chain })).then(({ channel, peer }) => {
        channels.push(channel);
        channel.onMessage((m) => {
          received.push(m);
          answer(channel, m);
        });
        // The channel reads a sealed `close` itself: it is kept here as what ended the channel.
        channel.onClose((reason) => void received.push({ t: 'close', reason }));
        void channel.send({ t: 'caps', member: peer.member, device: peer.device, clientClass: peer.clientClass, machine: { grades: [] }, stateVersion: 2 });
      });
      return device;
    },
    presence: () => null,
    onPresence: () => () => {},
    close: () => {},
  };
  return { received, channels, socket };
}

const opened: MachineChannel[] = [];
afterEach(() => {
  for (const channel of opened.splice(0)) channel.close('done');
});

describe('what the phone sends', () => {
  it('drives every exported function, and nothing crosses but sub, credit, unsub, act of the three answers, pong and close', async () => {
    // Every function the client's modules export is one this suite drives: a new one fails here until it is.
    const fns = (module: object) => Object.entries(module).filter(([, v]) => typeof v === 'function').map(([k]) => k).sort();
    expect(fns(client)).toEqual(['cardsIdentity', 'followCards', 'openChannel', 'socketFor', 'subscribeCards']);
    expect(fns(answers)).toEqual(['AnswerError', 'answer', 'operationFor', 'outcomeOf', 'retry', 'seal']);

    const endpoint = memoryEndpoint();
    const assert = (challenge: Uint8Array) => authenticator.assert(challenge, ORIGIN);
    const channel = await openChannel({ ref: machine.ref }, identity, memoryOrgView({ chain }), { socket: endpoint.socket });
    opened.push(channel);
    expect(channel.machine).toBe(machine.ref);
    await until(() => channel.caps, 'the caps');
    expect(channel.caps).toMatchObject({ t: 'caps', clientClass: 'web-cards', device: 'phone-1', stateVersion: 2 });
    // The endpoint's ping is answered.
    await until(() => endpoint.channels[0], 'the endpoint’s end');
    void endpoint.channels[0].send({ t: 'ping', at: 1 });

    const cards: Card[] = [];
    for (const session of [{ lane: 'A' as const, id: 'la-1' }, { lane: 'B' as const, id: APP }]) {
      const got: Card[][] = [];
      const subscription = subscribeCards(channel, session, { cards: (set) => got.push(set), ended: () => {} });
      await until(() => got.length === 1, `the ${session.lane} cards`);
      cards.push(...got[0]);
      subscription.close();
    }
    const [laneAPermission, laneAQuestion, laneBPermission, laneBQuestion] = cards;
    for (const [card, given] of [
      [laneAQuestion, { kind: 'question', answers: { 'Which?': 'A' } }],
      [laneAPermission, { kind: 'decision', decision: 'allow' }],
      [laneAPermission, { kind: 'decision', decision: 'deny' }],
      [laneBPermission, { kind: 'decision', decision: 'allow' }],
      [laneBPermission, { kind: 'decision', decision: 'deny' }],
      [laneBQuestion, { kind: 'question', answers: { 'Which?': 'A' } }],
    ] as const) {
      const { operation, outcome } = await answers.answer(channel, identity, card, given, assert);
      expect(outcome).toEqual({ state: 'done', result: {} });
      expect(await answers.retry(channel, operation, assert)).toEqual({ state: 'done', result: {} });
    }
    expect(answers.operationFor(identity, machine.ref, laneBQuestion, { kind: 'question', answers: {} }, Date.now()).action).toBe('session.answer');
    expect(answers.outcomeOf({ state: 'done', result: 1 })).toEqual({ state: 'done', result: 1 });
    await answers.seal(answers.operationFor(identity, machine.ref, laneAQuestion, { kind: 'question', answers: {} }, Date.now()), assert, Date.now());
    expect(() => answers.operationFor(identity, machine.ref, { ...laneAQuestion, launch: null } as Card, { kind: 'question', answers: {} }, Date.now())).toThrow(answers.AnswerError);

    // The follower, over the same endpoint.
    const followed: Card[][] = [];
    const follow = followCards(() => openChannel({ ref: machine.ref }, identity, memoryOrgView({ chain }), { socket: endpoint.socket }), { lane: 'B', id: APP }, { cards: (set) => followed.push(set), ended: () => {} });
    await until(() => followed.length === 1, 'the followed cards');
    follow.close();
    channel.close('done');
    await until(() => endpoint.received.filter((m) => m.t === 'close').length === 2, 'both closes');

    const kinds = new Set(endpoint.received.map((m) => m.t));
    expect([...kinds].sort()).toEqual(['act', 'close', 'pong', 'sub', 'unsub']);
    const named = new Set(endpoint.received.filter((m) => m.t === 'act').map((m) => (m.action as Action).action));
    expect([...named].sort()).toEqual(['session.answer', 'sminos.answer', 'sminos.decide']);
    for (const m of endpoint.received.filter((x) => x.t === 'sub')) expect(m).toMatchObject({ view: 'cards', cursor: null });
    for (const m of endpoint.received.filter((x) => x.t === 'act')) {
      const action = m.action as Action;
      expect(action.webauthn).toBeDefined();
      expect(action.stepUp).toBeUndefined();
      const answer = (action.args as { answer?: Record<string, unknown> }).answer;
      if (answer !== undefined) {
        expect(answer.updatedInput).toBeUndefined();
        expect(answer.message).toBeUndefined();
        expect(answer.decision).not.toBe('deny_and_stop');
        expect(answer.scope === undefined || answer.scope === 'once').toBe(true);
      }
      expect((action.args as Record<string, unknown>).message).toBeUndefined();
      expect((action.args as Record<string, unknown>).scope).toBeUndefined();
    }
    // `credit` is the one kind a short run doesn't reach; the subscription suite above pins when it is sent.
  });

  it('names the device by its record, its build `desk-web/<label>`, and keeps one Machine socket per machine until it is closed', () => {
    expect(identity).toEqual({ org: 'org-cards', member: root.member, device: 'phone-1', clientClass: 'web-cards', channelKey: { privateKey: identity.channelKey.privateKey, pub: identity.channelKey.pub }, build: 'desk-web/dev', capabilities: [] });
    expect(identity.channelKey.privateKey.extractable).toBe(false);
    const socket = client.socketFor(machine.ref, 'http://127.0.0.1:9');
    expect(client.socketFor(machine.ref, 'http://127.0.0.1:9')).toBe(socket);
    socket.close();
    const again = client.socketFor(machine.ref, 'http://127.0.0.1:9');
    expect(again).not.toBe(socket);
    again.close();
  });

  it('adopts the states a channel’s `state` message carries, and tells a newer version than the head it holds', async () => {
    const endpoint = memoryEndpoint();
    const org = memoryOrgView({ chain });
    const behind: number[] = [];
    const channel = await openChannel({ ref: machine.ref }, identity, org, { socket: endpoint.socket, onBehind: (version) => behind.push(version) });
    opened.push(channel);
    await until(() => endpoint.channels[0], 'the endpoint’s end');
    // The caps said version 2, the head the phone holds: nothing to tell.
    await sleep(20);
    expect(behind).toEqual([]);
    const v3 = await signedBy(await nextOf(chain[1]), root.admin);
    void endpoint.channels[0].send({ t: 'state', states: [v3], transitions: [] });
    await until(() => org.head().state.version === 3, 'the successor adopted');
    void endpoint.channels[0].send({ t: 'caps', member: identity.member, device: identity.device, clientClass: 'web-cards', machine: { grades: [] }, stateVersion: 4 });
    await until(() => behind.length === 1, 'the newer version told');
    expect(behind).toEqual([4]);
  });
});
