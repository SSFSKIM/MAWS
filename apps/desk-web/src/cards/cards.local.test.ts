// The cards client against the real endpoint on the local hub (P5 O13 M4's Proves): acceptance 2's channel half and
// acceptance 3. MAWS's endpoint module runs in this process, enrolled on desk-hub's local runner (a wrangler dev child)
// as the owner's machine `mini`, over the fake engine host (lane B, the engine host's own op commands and ledger) and a
// fake sminos on RL10 (lane A); the phone is a `web-cards` device registered by M3's code path, its passkey a software
// authenticator behind the same `Assert` the browser's `assertWith` makes, and it reaches the machine only through the
// hub's relay (test/local/endpoint.ts). The cases share one world, each on requests of its own; the device's removal
// comes last.
// @vitest-environment node
import * as fs from 'node:fs';
import { join } from 'node:path';
import { actionFingerprint, ChannelError, type Action, type ChannelMessage } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inputSha256 } from 'desk-hub/protocol';
import type { SessionEvent } from '@shared/graph/events';
import { requestDigestOf } from '@shared/host/request-digest';
import { throughTamper } from '../../../../test/endpoint/carriers';
import { item as itemOf } from '../../../../test/endpoint/sub-harness';
import { recording, startWorld, until, type World } from '../../test/local/endpoint';
import { answer, operationFor, retry, seal, type Answer, type Operation } from './answers';
import { cardId, cardKind, laneACard, laneADigest, laneBCards, unanswerable, type Card, type CardSession } from './cards';
import { followCards, subscribeCards, type MachineChannel } from './client';

let world: World;
const APP = 'app-own';
const question = (request: string) => ({ request, session: 'la-1', tool: 'AskUserQuestion', input: { questions: [{ question: 'Which way?', options: [{ label: 'left' }, { label: 'right' }] }] } });
const permission = (request: string, session = 'la-1') => ({ request, session, tool: 'Bash', input: { command: `pnpm test # ${request}` } });
const channels: MachineChannel[] = [];

beforeAll(async () => {
  world = await startWorld();
  world.sminos.restate([question('toolu_q'), permission('toolu_p'), permission('toolu_b', 'la-b')]);
  world.laneB(APP);
  world.host.request(APP, 'question', 'rq-q');
  world.host.request(APP, 'permission', 'rq-p');
}, 180_000);
afterAll(async () => {
  for (const channel of channels.splice(0)) if (!channel.closed) channel.close('done');
  await world?.stop();
});

async function open(...args: Parameters<World['phone']['open']>): Promise<MachineChannel> {
  const channel = await world.phone.open(...args);
  channels.push(channel);
  return channel;
}

/** A `cards` subscription's sets as they come. */
function watch(channel: MachineChannel, session: CardSession) {
  const sets: Card[][] = [];
  const ended: string[] = [];
  const subscription = subscribeCards(channel, session, { cards: (set) => sets.push(set), ended: (reason) => ended.push(reason) });
  return {
    sets,
    ended,
    close: () => subscription.close(),
    /** The first set from `from` on that `test` holds for. */
    until: (test: (set: Card[]) => boolean, what: string, from = 0) => until(() => sets.slice(from).find(test), what),
  };
}

const has = (id: string) => (set: Card[]) => set.some((c) => cardId(c) === id);
const lacks = (id: string) => (set: Card[]) => !set.some((c) => cardId(c) === id);
const find = (set: Card[], id: string) => set.find((c) => cardId(c) === id)!;
const allow: Answer = { kind: 'decision', decision: 'allow' };
const deny: Answer = { kind: 'decision', decision: 'deny' };
const left: Answer = { kind: 'question', answers: { 'Which way?': 'left' } };
const answeredOnce = (entry: string) => world.host.answered.filter((a) => a === entry).length;
const sentAnswers = () => world.host.calls.filter((c) => c.name === 'host.op').map((c) => (c.input as { opId: string; input: { requestId: string; answer: unknown } }));
type Msg = ChannelMessage & Record<string, unknown>;

/** The first message `match` holds for, after sending `message` (within 10 s). */
async function reply(channel: MachineChannel, message: ChannelMessage, match: (m: Msg) => boolean): Promise<Msg> {
  const seen: string[] = [];
  let off = () => {};
  const got = new Promise<Msg>((resolve, reject) => {
    const timer = setTimeout(() => (off(), reject(new Error(`no answer to ${message.t} within 10 s; seen ${seen.join(', ')}`))), 10_000);
    off = channel.onMessage((m) => {
      seen.push(m.t);
      if (!match(m as Msg)) return;
      clearTimeout(timer);
      off();
      resolve(m as Msg);
    });
  });
  await channel.send(message);
  return got;
}

/** What the endpoint said to an `act` sent as is: `ok`, or its refusal. */
async function acted(channel: MachineChannel, action: Action): Promise<string> {
  const ack = await reply(channel, { t: 'act', action }, (m) => m.t === 'ack' && m.opId === action.opId);
  return ack.state === 'accepted' ? 'ok' : (ack.reason as string);
}

/** An operation of any action, sealed by the phone as an answer is. */
function sealedAs(fields: Pick<Action, 'action' | 'args'> & Partial<Pick<Action, 'session' | 'context'>>): Promise<Action> {
  const now = Date.now();
  const operation: Operation = { v: 1, org: world.phone.identity.org, machine: world.ref, device: world.phone.identity.device, opId: `op-${crypto.randomUUID()}`, opCreated: new Date(now).toISOString(), ...fields };
  return seal(operation, world.phone.assert, now);
}

/** `card`'s answer as the client builds it, `change`d before it is sealed. */
function changed(card: Card, given: Answer, change: (op: Operation) => void): Promise<Action> {
  const op = operationFor(world.phone.identity, world.ref, card, given, Date.now());
  change(op);
  return seal(op, world.phone.assert, Date.now());
}

/** The phone's credential's signature counter as the endpoint keeps it. */
function counter(): number {
  const file = join(world.services.machine.stateDir, 'webauthn.json');
  return fs.existsSync(file) ? ((JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, number>)[world.phone.passkey.credentialId] ?? 0) : 0;
}

describe('the channel', () => {
  it('opens through the hub’s relay, and the endpoint’s caps names the phone’s class', async () => {
    const channel = await open();
    const caps = await until(() => channel.caps, 'the caps');
    expect(caps).toMatchObject({ t: 'caps', clientClass: 'web-cards', device: world.phone.record.deviceId, member: world.admin.id });
    expect(world.endpoint.status().channels.relayed).toBeGreaterThan(0);
  });
});

describe('a cold cards subscription, and its answers', () => {
  it('shows a question and a permission already pending on each lane, each answerable, the lane B digests agreeing', async () => {
    const channel = await open();
    const a = watch(channel, { lane: 'A', id: 'la-1' });
    const b = watch(channel, { lane: 'B', id: APP });
    const setA = await a.until((set) => has('toolu_q')(set) && has('toolu_p')(set), 'lane A’s cards');
    const setB = await b.until((set) => has('rq-q')(set) && has('rq-p')(set), 'lane B’s cards');
    expect(setA.map(cardId).sort()).toEqual(['toolu_p', 'toolu_q']); // never B's `toolu_b`, on a session not the owner's
    for (const card of [...setA, ...setB]) expect(unanswerable(card), cardId(card)).toBeNull();
    expect(find(setA, 'toolu_q')).toMatchObject({ lane: 'A', launch: 'L1' });
    const q = find(setB, 'rq-q') as Extract<Card, { lane: 'B' }>;
    expect(q.digest).not.toBeNull();
    expect(q.digest).toEqual(q.endpointDigest);
    expect(q.digest).toEqual(requestDigestOf(APP, world.host.session(APP).requests.get('rq-q')!));
    a.close();
    b.close();
  });

  it('answers a question and denies a permission on each lane: each done, its effect once, the assertion verified at the endpoint, lane B’s payloads in §D’s forms', async () => {
    const channel = await open();
    const a = watch(channel, { lane: 'A', id: 'la-1' });
    const b = watch(channel, { lane: 'B', id: APP });
    const setA = await a.until(has('toolu_q'), 'lane A’s cards');
    const setB = await b.until(has('rq-q'), 'lane B’s cards');
    const before = counter();
    const done = async (card: Card, given: Answer) => (await answer(channel, world.phone.identity, card, given, world.phone.assert)).outcome;

    expect(await done(find(setA, 'toolu_q'), left)).toMatchObject({ state: 'done' });
    expect(await done(find(setA, 'toolu_p'), deny)).toMatchObject({ state: 'done' });
    expect(world.sminos.effects).toEqual(['answer la-1 toolu_q', 'decide la-1 toolu_p']);
    await a.until((set) => lacks('toolu_q')(set) && lacks('toolu_p')(set), 'lane A’s cards settled');

    expect(await done(find(setB, 'rq-q'), left)).toMatchObject({ state: 'done' });
    expect(await done(find(setB, 'rq-p'), deny)).toMatchObject({ state: 'done' });
    expect([answeredOnce(`${APP} rq-q`), answeredOnce(`${APP} rq-p`)]).toEqual([1, 1]);
    await b.until((set) => lacks('rq-q')(set) && lacks('rq-p')(set), 'lane B’s cards settled');

    // The engine host received each answer byte for byte in §D's form.
    expect(sentAnswers().map((s) => JSON.stringify(s.input.answer))).toEqual(['{"kind":"question","answers":{"Which way?":"left"}}', '{"kind":"permission","decision":"deny"}']);
    // Each of the four assertions verified at the endpoint, its counter kept there.
    expect(counter()).toBe(before + 4);
    a.close();
    b.close();
  });

  it('takes a lane B Allow with scope once, and refuses one with scope session `class`', async () => {
    world.host.request(APP, 'permission', 'rq-once');
    world.host.request(APP, 'permission', 'rq-session');
    const channel = await open();
    const b = watch(channel, { lane: 'B', id: APP });
    const set = await b.until((s) => has('rq-once')(s) && has('rq-session')(s), 'the permissions');
    expect((await answer(channel, world.phone.identity, find(set, 'rq-once'), allow, world.phone.assert)).outcome).toMatchObject({ state: 'done' });
    expect(JSON.stringify(sentAnswers().at(-1)!.input.answer)).toBe('{"kind":"permission","decision":"allow","scope":"once"}');
    const session = await changed(find(set, 'rq-session'), allow, (op) => void ((op.args.answer as Record<string, unknown>).scope = 'session'));
    expect(await acted(channel, session)).toBe('class');
    expect(answeredOnce(`${APP} rq-session`)).toBe(0);
    b.close();
  });
});

describe('lane A’s cards as sminos raises them', () => {
  it('answers the ask mod’s async question, raised under its MCP name, as a question', async () => {
    const asked = { ...question('toolu_async'), tool: 'mcp__sminos__AskUserQuestion', async: true };
    world.sminos.raise(asked);
    const channel = await open();
    const a = watch(channel, { lane: 'A', id: 'la-1' });
    const card = find(await a.until(has('toolu_async'), 'the async question'), 'toolu_async');
    expect(cardKind(card)).toBe('question');
    expect((await answer(channel, world.phone.identity, card, left, world.phone.assert)).outcome).toMatchObject({ state: 'done' });
    expect(world.sminos.effects.filter((e) => e.endsWith('toolu_async'))).toEqual(['answer la-1 toolu_async']);
    await a.until(lacks('toolu_async'), 'the question settled');
    a.close();
  });

  it('redraws a card sminos republishes changed under its id, and answers it over the new input’s digest', async () => {
    const old = { ...permission('toolu_changed'), input: { command: 'old' } };
    const changed = { ...old, input: { command: 'new' } };
    world.sminos.raise(old);
    const channel = await open();
    const a = watch(channel, { lane: 'A', id: 'la-1' });
    await a.until(has('toolu_changed'), 'the card');
    const from = a.sets.length;
    world.sminos.raise(changed);
    const redrawn = (set: Card[]) => set.some((c) => c.lane === 'A' && c.raised.request === 'toolu_changed' && (c.raised.input as { command: string }).command === 'new');
    const card = find(await a.until(redrawn, 'the card redrawn', from), 'toolu_changed') as Extract<Card, { lane: 'A' }>;
    expect(a.sets.slice(from).map((set) => set.filter((c) => cardId(c) === 'toolu_changed').length)).not.toContain(2);
    expect(card.digest).toEqual(await laneADigest(changed));
    expect((await answer(channel, world.phone.identity, card, allow, world.phone.assert)).outcome).toMatchObject({ state: 'done' });
    const sent = world.sminos.s.received.filter((f) => f.t === 'rpc' && (f.rpc as { args: { digest?: { request: string } } }).args.digest?.request === 'toolu_changed');
    expect(sent.map((f) => (f.rpc as { args: { digest: { input_sha256: string } } }).args.digest.input_sha256)).toEqual([await inputSha256(changed.input)]);
    expect(world.sminos.effects.filter((e) => e.endsWith('toolu_changed'))).toEqual(['decide la-1 toolu_changed']);
    a.close();
  });
});

describe('what the endpoint refuses', () => {
  it('refuses an assertion replayed, one over another action’s digest, and an answer on a session the member doesn’t own, running nothing', async () => {
    world.host.request(APP, 'permission', 'rq-replay');
    world.host.request(APP, 'permission', 'rq-borrow');
    const { channel, acts } = recording(await open());
    const b = watch(channel, { lane: 'B', id: APP });
    const set = await b.until((s) => has('rq-replay')(s) && has('rq-borrow')(s), 'the permissions');
    expect((await answer(channel, world.phone.identity, find(set, 'rq-replay'), allow, world.phone.assert)).outcome).toMatchObject({ state: 'done' });
    expect(await acted(channel, acts[0])).toBe('replayed');
    // Another action's assertion: its challenge is that action's digest.
    const borrowed = { ...(await seal(operationFor(world.phone.identity, world.ref, find(set, 'rq-borrow'), allow, Date.now()), world.phone.assert, Date.now())), webauthn: acts[0].webauthn };
    expect(await acted(channel, borrowed)).toBe('step-up');
    expect([answeredOnce(`${APP} rq-replay`), answeredOnce(`${APP} rq-borrow`)]).toEqual([1, 0]);

    // B's sessions: their cards are refused the phone, and answers built as the client builds them are refused.
    const theirs = await reply(channel, { t: 'sub', sub: 'theirs', session: { lane: 'A', id: 'la-b' }, view: 'cards', cursor: null, credit: 1024 }, (m) => m.sub === 'theirs' && (m.t === 'ended' || m.t === 'subbed'));
    expect(theirs).toMatchObject({ t: 'ended', reason: 'class' });
    const theirsA = await laneACard(permission('toolu_b', 'la-b'), 'LB');
    const outcomeA = (await answer(channel, world.phone.identity, theirsA, allow, world.phone.assert)).outcome;
    const appB = world.laneB('app-b', [world.B]);
    const request = world.host.request('app-b', 'permission', 'rq-b');
    const [theirsB] = await laneBCards('app-b', { pendingItems: [{ item: itemOf(appB, 'rq-b', 'permission'), request, context: { launchId: appB.launchId, engineSessionId: appB.engineSessionId }, requestDigest: requestDigestOf('app-b', request) }] });
    expect(unanswerable(theirsB)).toBeNull();
    const outcomeB = (await answer(channel, world.phone.identity, theirsB, allow, world.phone.assert)).outcome;
    // M8 refuses these at the session's floor (step 4), before its web-cards ownership check (step 7) is reached.
    expect([outcomeA, outcomeB]).toEqual([
      { state: 'refused', reason: 'grade' },
      { state: 'refused', reason: 'grade' },
    ]);
    expect(world.sminos.effects.filter((e) => e.includes('la-b'))).toEqual([]);
    expect(world.host.answered.filter((e) => e.startsWith('app-b'))).toEqual([]);
    b.close();
  });

  it('refuses an answer to a request whose input changed under its card `digest-mismatch`, and runs it not', async () => {
    const event = world.host.request(APP, 'permission', 'rq-changed');
    const channel = await open();
    const b = watch(channel, { lane: 'B', id: APP });
    const set = await b.until(has('rq-changed'), 'the permission');
    // The engine host's pending request changes with nothing told: the card still draws the old input.
    world.host.session(APP).requests.set('rq-changed', { ...event, input: { command: 'rm -rf ~' } } as unknown as SessionEvent);
    expect((await answer(channel, world.phone.identity, find(set, 'rq-changed'), allow, world.phone.assert)).outcome).toEqual({ state: 'refused', reason: 'digest-mismatch' });
    expect(answeredOnce(`${APP} rq-changed`)).toBe(0);
    b.close();
  });

  it('refuses every item of acceptance 3’s list `class`', async () => {
    world.host.request(APP, 'permission', 'rq-list');
    world.sminos.raise(permission('toolu_list'));
    const channel = await open();
    const a = watch(channel, { lane: 'A', id: 'la-1' });
    const b = watch(channel, { lane: 'B', id: APP });
    const cardB = find(await b.until(has('rq-list'), 'the lane B permission'), 'rq-list');
    const cardA = find(await a.until(has('toolu_list'), 'the lane A permission'), 'toolu_list');
    const contextB = (cardB as Extract<Card, { lane: 'B' }>).context;
    const ctxB = { lane: 'B' as const, launchId: contextB.launchId, engineSessionId: contextB.engineSessionId! };
    const ctxA = { lane: 'A' as const, session: 'la-1', launch: 'L1' };
    const acts: Array<[string, () => Promise<Action>]> = [
      ['session.send', () => sealedAs({ action: 'session.send', session: APP, context: ctxB, args: { appSessionId: APP, content: 'hi' } })],
      ['session.steer', () => sealedAs({ action: 'session.steer', session: APP, context: ctxB, args: { appSessionId: APP, content: 'hi' } })],
      ['sminos.steer', () => sealedAs({ action: 'sminos.steer', session: 'la-1', context: ctxA, args: { session: 'la-1', text: 'go on' } })],
      ['sminos.spawn', () => sealedAs({ action: 'sminos.spawn', args: { checkout: '/work/m8', brief: 'go' } })],
      ['sminos.command', () => sealedAs({ action: 'sminos.command', session: 'la-1', context: ctxA, args: { session: 'la-1', name: 'compact', args: '' } })],
      ['endpoint.grant', () => sealedAs({ action: 'endpoint.grant', args: { grant: {} } })],
      ['session.answer with updatedInput', () => changed(cardB, allow, (op) => void ((op.args.answer as Record<string, unknown>).updatedInput = { command: 'ls' }))],
      ['session.answer with scope session', () => changed(cardB, allow, (op) => void ((op.args.answer as Record<string, unknown>).scope = 'session'))],
      ['sminos.decide with a message', () => changed(cardA, deny, (op) => void (op.args.message = 'no'))],
      ['sminos.decide with a scope', () => changed(cardA, allow, (op) => void (op.args.scope = 'session'))],
    ];
    const refusals: Record<string, string> = {};
    for (const [name, make] of acts) refusals[name] = await acted(channel, await make());
    refusals['sub full'] = (await reply(channel, { t: 'sub', sub: 'full', session: { lane: 'A', id: 'la-1' }, view: 'full', cursor: null, credit: 1024 }, (m) => m.sub === 'full' && (m.t === 'ended' || m.t === 'subbed'))).reason as string;
    refusals['call session.events'] = ((await reply(channel, { t: 'call', id: 'events', name: 'session.events', input: { appSessionId: APP, afterSeq: null, limit: null } }, (m) => m.t === 'result' && m.id === 'events')).error as { code: string }).code;
    expect(refusals).toEqual(Object.fromEntries([...acts.map(([name]) => name), 'sub full', 'call session.events'].map((name) => [name, 'class'])));
    expect(answeredOnce(`${APP} rq-list`)).toBe(0);
    expect(world.sminos.effects.filter((e) => e.endsWith('toolu_list'))).toEqual([]);
    a.close();
    b.close();
  });

  // Acceptance 3 says a query of any operation on a session is refused `grade`. M8 refuses lane A's (sminos's binding
  // names no RPC, `sminosBinding`) but answers the device's query of its own lane B answer (`session.answer` is in
  // `QUERYABLE_BY_WEB_CARDS`): pinned as M8 has it, for the document. This client never sends `query`.
  it('refuses the phone’s query of its own lane A answer `grade`, and answers one of its own lane B answer', async () => {
    const channel = await open();
    const [laneA] = world.sminos.ops.keys();
    const queriedA = await reply(channel, { t: 'query', opId: laneA, opCreated: new Date().toISOString(), executor: 'sminos' }, (m) => m.t === 'queried' && m.opId === laneA);
    expect(queriedA).toMatchObject({ state: 'refused', reason: 'grade' });
    expect(queriedA.outcome).toBeUndefined();
    const own = sentAnswers()[0];
    const opCreated = (world.host.calls.find((c) => c.name === 'host.op')!.input as { opCreated: string }).opCreated;
    const queriedB = await reply(channel, { t: 'query', opId: own.opId, opCreated, executor: 'engine-host' }, (m) => m.t === 'queried' && m.opId === own.opId);
    expect(queriedB).toMatchObject({ state: 'done', outcome: { state: 'done', result: { outcome: 'delivered' } } });
  });
});

describe('outcomes, and a lost acknowledgement', () => {
  it('reseals an act whose ack a relay withheld under its operation, the ledger answering it with one effect; one rebuilt is `op-conflict`', async () => {
    world.host.request(APP, 'permission', 'rq-lost');
    const b = watch(await open(), { lane: 'B', id: APP });
    const set = await b.until(has('rq-lost'), 'the permission');
    let relay: ReturnType<typeof throughTamper>['relay'] | null = null;
    const tampered = recording(
      await open({
        wrap: (io) => {
          const spliced = throughTamper(io);
          relay = spliced.relay;
          return spliced.device;
        },
      }),
    );
    await until(() => tampered.channel.caps, 'the tampered channel’s caps');
    relay!.tamper('to-device', 'drop'); // the next frame to the phone, the act's ack; the frame after it breaks the channel
    const first = await answer(tampered.channel, world.phone.identity, find(set, 'rq-lost'), allow, world.phone.assert, { ackMs: 3000 });
    expect(first.outcome).toEqual({ state: 'uncertain', why: 'no-ack' });
    await until(() => answeredOnce(`${APP} rq-lost`) === 1, 'the first copy’s effect');
    // The replacement snapshot no longer lists the card; the operation the answer retained is what Retry reseals.
    await b.until(lacks('rq-lost'), 'the replacement snapshot');
    const fresh = recording(await open());
    expect(await retry(fresh.channel, first.operation, world.phone.assert, { now: () => Date.now() + 5_000 })).toMatchObject({ state: 'done' });
    expect(answeredOnce(`${APP} rq-lost`)).toBe(1);
    const [one] = tampered.acts;
    const [two] = fresh.acts;
    expect([two.opId, two.opCreated]).toEqual([one.opId, one.opCreated]);
    expect(two.nonce).not.toBe(one.nonce);
    expect(Date.parse(two.created)).toBeGreaterThan(Date.parse(one.created));
    expect(await actionFingerprint(two)).toBe(await actionFingerprint(one));
    // The same opId built anew from the card: another operation, which the ledger refuses.
    const rebuilt = { ...first.operation, opCreated: new Date(Date.parse(first.operation.opCreated) + 1000).toISOString() };
    expect(await retry(fresh.channel, rebuilt, world.phone.assert)).toEqual({ state: 'refused', reason: 'op-conflict' });
    expect(answeredOnce(`${APP} rq-lost`)).toBe(1);
    b.close();
  });

  it('reads each non-success `done` as what it is, never done: a failed or refused card answerable anew, an in-progress or unknown one retried', async () => {
    const ids = ['rq-failed', 'rq-tombstoned', 'rq-progress', 'rq-unknown'];
    for (const id of ids) world.host.request(APP, 'permission', id);
    world.sminos.raise(permission('toolu_failed'));
    world.sminos.raise(permission('toolu_refused'));
    const channel = await open();
    const a = watch(channel, { lane: 'A', id: 'la-1' });
    const b = watch(channel, { lane: 'B', id: APP });
    const setB = await b.until((s) => ids.every((id) => has(id)(s)), 'the permissions');
    const setA = await a.until((s) => has('toolu_failed')(s) && has('toolu_refused')(s), 'lane A’s permissions');
    const answerOf = (set: Card[], id: string) => answer(channel, world.phone.identity, find(set, id), allow, world.phone.assert);
    const value = (v: unknown) => ({ t: 'res' as const, id: '0', ok: true as const, value: v });

    world.hostOp = () => value({ state: 'done', result: { ok: false, error: { code: 'not_pending', message: 'the engine’s words' } } });
    const failed = await answerOf(setB, 'rq-failed');
    world.hostOp = () => value({ state: 'refused', reason: 'tombstoned' });
    const tombstoned = await answerOf(setB, 'rq-tombstoned');
    world.hostOp = () => value({ state: 'in-progress' });
    const progress = await answerOf(setB, 'rq-progress');
    world.hostOp = () => ({ t: 'res', id: '0', ok: false, error: { code: 'host_unavailable', message: 'away' } });
    const unknown = await answerOf(setB, 'rq-unknown');
    world.hostOp = null;
    expect(failed.outcome).toEqual({ state: 'failed', error: { code: 'not_pending', message: 'the engine’s words' } });
    expect(tombstoned.outcome).toEqual({ state: 'refused', reason: 'tombstoned' });
    expect(progress.outcome).toEqual({ state: 'uncertain', why: 'in-progress' });
    expect(unknown.outcome).toEqual({ state: 'uncertain', why: 'unknown' });
    // Each still pending: the failed and refused answered anew (a new opId), the uncertain retried as they were.
    for (const [id, was] of [['rq-failed', failed], ['rq-tombstoned', tombstoned]] as const) {
      const anew = await answerOf(setB, id);
      expect(anew.outcome, id).toMatchObject({ state: 'done' });
      expect(anew.operation.opId).not.toBe(was.operation.opId);
    }
    for (const [id, was] of [['rq-progress', progress], ['rq-unknown', unknown]] as const) expect(await retry(channel, was.operation, world.phone.assert), id).toMatchObject({ state: 'done' });
    for (const id of ids) expect(answeredOnce(`${APP} ${id}`), id).toBe(1);

    // Lane A: a failure reaches the phone by its code alone, never sminos's words; a refusal by its reason.
    world.sminos.outcomes.set('toolu_failed', { state: 'failed', error: { code: 'not_pending', message: 'sminos’s words about the request' } });
    world.sminos.outcomes.set('toolu_refused', { state: 'refused', reason: 'op-conflict' });
    const failedA = (await answerOf(setA, 'toolu_failed')).outcome;
    const refusedA = (await answerOf(setA, 'toolu_refused')).outcome;
    expect(failedA).toEqual({ state: 'failed', error: { code: 'not_pending' } });
    expect(refusedA).toEqual({ state: 'refused', reason: 'op-conflict' });
    for (const id of ['toolu_failed', 'toolu_refused']) expect((await answerOf(setA, id)).outcome, id).toMatchObject({ state: 'done' });
    expect(world.sminos.effects.filter((e) => e.endsWith('toolu_failed') || e.endsWith('toolu_refused'))).toEqual(['decide la-1 toolu_failed', 'decide la-1 toolu_refused']);
    a.close();
    b.close();
  });
});

describe('a session not yet prompted locally', () => {
  it('draws a card whose session has no engine session id not answerable, and answerable once the status names one', async () => {
    // A session never prompted can't be subscribed to on M8 (its target doesn't resolve); one whose engine session id
    // goes away under a live subscription (a relaunch not yet prompted) is drawn so.
    world.laneB('app-unprompted', ['@machine'], null);
    const channel = await open();
    const cold = watch(channel, { lane: 'B', id: 'app-unprompted' });
    expect(await until(() => cold.ended[0], 'the cold subscription’s end')).toBe('grade');

    const s = world.laneB('app-relaunch');
    world.host.request('app-relaunch', 'permission', 'rq-relaunch');
    const b = watch(channel, { lane: 'B', id: 'app-relaunch' });
    await b.until(has('rq-relaunch'), 'the card');
    const status = () => world.host.emit('session.status', { appSessionId: 'app-relaunch', status: world.host.status(s) });
    s.engineSessionId = null;
    let from = b.sets.length;
    status();
    const waiting = find(await b.until((set) => has('rq-relaunch')(set) && unanswerable(find(set, 'rq-relaunch')) !== null, 'the card not yet actionable', from), 'rq-relaunch');
    expect(unanswerable(waiting)).toEqual({ why: 'not-prompted', text: "this session hasn't been prompted locally yet" });
    s.engineSessionId = 'eng-app-relaunch-2';
    world.records.set({ lane: 'B', session: 'eng-app-relaunch-2', owners: ['@machine'] }, 'app-relaunch');
    from = b.sets.length;
    status();
    const ready = find(await b.until((set) => has('rq-relaunch')(set) && unanswerable(find(set, 'rq-relaunch')) === null, 'the card answerable', from), 'rq-relaunch');
    expect((ready as Extract<Card, { lane: 'B' }>).context.engineSessionId).toBe('eng-app-relaunch-2');
    expect((await answer(channel, world.phone.identity, ready, allow, world.phone.assert)).outcome).toMatchObject({ state: 'done' });
    expect(answeredOnce('app-relaunch rq-relaunch')).toBe(1);
    b.close();
  });
});

describe('following a session across a dropped channel, and the device’s removal', () => {
  it('resubscribes a dropped channel’s cards as a snapshot, losing no card raised while it was down', async () => {
    world.host.request(APP, 'question', 'rq-before');
    const sets: Card[][] = [];
    const current: Array<MachineChannel | null> = [];
    const follow = followCards(() => open(), { lane: 'B', id: APP }, { cards: (set) => sets.push(set), ended: () => {}, channel: (c) => current.push(c) }, { delay: () => 200 });
    await until(() => sets.find(has('rq-before')), 'the first snapshot');
    world.phone.carriers.at(-1)!.cut();
    await until(() => current.at(-1) === null, 'the channel down');
    world.host.request(APP, 'permission', 'rq-while-down');
    const from = sets.length;
    const after = await until(() => sets.slice(from).find((s) => has('rq-before')(s) && has('rq-while-down')(s)), 'the snapshot after the drop');
    expect(after.map(cardId)).toEqual(expect.arrayContaining(['rq-before', 'rq-while-down']));
    expect(current.filter((c) => c !== null)).toHaveLength(2);
    follow.close();
  });

  it('ends a removed device’s subscription and refuses its next handshake', async () => {
    const ended: string[] = [];
    let sets = 0;
    const follow = followCards(() => open(), { lane: 'B', id: APP }, { cards: () => void (sets += 1), ended: (reason) => ended.push(reason) }, { delay: () => 200 });
    await until(() => sets > 0, 'the cards');
    await world.removePhone();
    await until(() => ended.length > 0, 'the end', 20_000);
    expect(ended).toEqual(['removed']);
    const refused: unknown = await world.phone.open().then(
      () => null,
      (error: unknown) => error,
    );
    // The endpoint refuses it (`unknown-device`) by closing the carrier, which the device's end of the package reads as
    // `closed`: a refusal's reason is not shown before the channel is sealed.
    expect(refused).toBeInstanceOf(ChannelError);
    expect((refused as ChannelError).reason).toBe('closed');
    follow.close();
  });
});
