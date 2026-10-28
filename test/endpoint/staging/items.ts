// The staging phone run's items (P5 O13 M7: acceptance 1-3 and 5 live on staging, Interfaces §H), each check one report
// line. Everything is raised at once, so each of the owner's sessions counts up from 0 once and pushes once. The second
// device's refusals run straight away on sessions of the harness's own (`la-2`, `app-2`), which the phone is told to
// leave alone, and those cards are withdrawn after; the owner's question and permission per lane (`la-1`, `app-1`) then
// wait for the phone, or, rehearsing, the second device answers them in the phone's place.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { canonicalize, verifyPinnedChain, type Action, type ChannelMessage, type Device, type SignedOrgState } from 'org-protocol';
import type { OrgStateView } from 'desk-hub/protocol';
import { answer, operationFor, seal, type Answer, type Operation } from '../../../apps/desk-web/src/cards/answers';
import { movedToMaws } from '../../../apps/desk-web/src/cards/board';
import { requestDigestOf } from '@shared/host/request-digest';
import { cardId, laneACard, laneBCards, unanswerable, type Card, type CardSession } from '../../../apps/desk-web/src/cards/cards';
import { subscribeCards, type MachineChannel } from '../../../apps/desk-web/src/cards/client';
import { cutOverMachines } from '../../../apps/desk-web/src/cards/machines';
import { capabilities, MOVED_TO_MAWS, VERBS, type CapabilityInput } from '../../../apps/desk-web/src/conversation/capabilities';
import { readPush } from '../../../apps/desk-hub/deploy/push-sink';
import { until } from '../../../apps/desk-web/test/local/endpoint';
import { item as itemOf } from '../sub-harness';
import type { Report } from './report';
import { cardsRunOf, laneBLeg, LANE_B_WAITING } from './run';
import { HARNESS_A, HARNESS_B, OWN_A, OWN_B, RUN_PROJECT, THEIRS_A, THEIRS_B, type Raised, type StagingWorld } from './world';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type Msg = ChannelMessage & Record<string, unknown>;

// ---- What is raised -------------------------------------------------------------------------------------------------

export const questionText = (n: string) => `o13 staging run ${n}: which way?`;

/** The phone's two lane A cards, the second device's three on the harness's session, and one on the second member's. */
export function laneARequests(n: string) {
  const question: Raised = { request: `toolu_q_${n}`, session: OWN_A, tool: 'AskUserQuestion', input: { questions: [{ question: questionText(n), header: 'Way', multiSelect: false, options: [{ label: 'left', description: 'the left one' }, { label: 'right', description: 'the right one' }] }] } };
  const permission = (request: string, command: string, session: string): Raised => ({ request, session, tool: 'Bash', input: { command, description: 'o13 staging phone run' } });
  return {
    owners: [question, permission(`toolu_p_${n}`, `echo o13-phone-${n} permission`, OWN_A)],
    device: [permission(`toolu_replay_${n}`, 'echo replay', HARNESS_A), permission(`toolu_borrow_${n}`, 'echo borrow', HARNESS_A), permission(`toolu_list_${n}`, 'echo list', HARNESS_A)],
    theirs: permission(`toolu_b_${n}`, 'echo the second member', THEIRS_A),
  };
}
/** Lane B's requests: the owner's question and permission (`app-1`), the harness's (`app-2`: acceptance 3's list and
 * acceptance 2's replayed and borrowed assertions), and the second member's (`app-b`). */
const LANE_B = { question: 'rq-q', permission: 'rq-p', list: 'rq-list', replay: 'rq-replay', borrow: 'rq-borrow', theirs: 'rq-b' } as const;

// ---- The second device on a channel -----------------------------------------------------------------------------------

/** The first message `match` holds for after sending `message`, within 15 s. */
async function reply(channel: MachineChannel, message: ChannelMessage, match: (m: Msg) => boolean): Promise<Msg> {
  const seen: string[] = [];
  let off = () => {};
  const got = new Promise<Msg>((resolve, reject) => {
    const timer = setTimeout(() => (off(), reject(new Error(`no answer to ${message.t} within 15 s; saw ${seen.join(', ') || 'nothing'}`))), 15_000);
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

/** The endpoint's word on an `act` sent as it is: `ok`, or its refusal's reason. */
async function acted(channel: MachineChannel, action: Action): Promise<string> {
  const ack = await reply(channel, { t: 'act', action }, (m) => m.t === 'ack' && m.opId === action.opId);
  return ack.state === 'accepted' ? 'ok' : (ack.reason as string);
}

/** A session's cards as they come, on `channel`. */
function watch(channel: MachineChannel, session: CardSession) {
  const sets: Card[][] = [];
  const ended: string[] = [];
  const sub = subscribeCards(channel, session, { cards: (set) => sets.push(set), ended: (reason) => ended.push(reason) });
  return {
    close: () => sub.close(),
    until: (test: (set: Card[]) => boolean, what: string, ms = 20_000) =>
      until(() => {
        if (ended.length > 0) throw new Error(`${what}: the subscription ended ${ended[0]}`);
        return sets.find(test);
      }, what, ms),
  };
}
/**
 * Acceptance 2's refusals on one lane, by the second device: `first` answered as the client answers, then its act sent
 * again as it was; `second` sealed with `first`'s assertion (another action's: its challenge is that action's digest);
 * `theirs`, a card of a session the member doesn't own, answered as the client answers. Each one's word.
 */
async function refusals(w: StagingWorld, channel: MachineChannel, first: Card, second: Card, theirs: Card): Promise<{ replayed: string; stepUp: string; theirs: string }> {
  const sent: Action[] = [];
  const recordingChannel = new Proxy(channel, {
    get: (target, key) =>
      key === 'send'
        ? (message: ChannelMessage) => {
            if (message.t === 'act') sent.push(structuredClone(message.action as Action));
            return target.send(message);
          }
        : Reflect.get(target, key),
  });
  const allow: Answer = { kind: 'decision', decision: 'allow' };
  const answered = await answer(recordingChannel, w.cards.identity, first, allow, w.cards.assert);
  if (answered.outcome.state !== 'done') throw new Error(`the first answer: ${JSON.stringify(answered.outcome)}`);
  const replayed = await acted(channel, sent[0]);
  const borrowed = { ...(await seal(operationFor(w.cards.identity, w.ref, second, allow, Date.now()), w.cards.assert, Date.now())), webauthn: sent[0].webauthn };
  const stepUp = await acted(channel, borrowed);
  const outcome = (await answer(channel, w.cards.identity, theirs, allow, w.cards.assert)).outcome;
  return { replayed, stepUp, theirs: outcome.state === 'refused' ? outcome.reason : JSON.stringify(outcome) };
}

const has = (...ids: string[]) => (set: Card[]) => ids.every((id) => set.some((c) => cardId(c) === id));
const find = (set: Card[], id: string) => set.find((c) => cardId(c) === id)!;

// ---- Reading the machine's side ---------------------------------------------------------------------------------------

type Rpc = { rpc: string; device: string; opId: string; request: string; args: Record<string, unknown> };
/** Every RPC the endpoint handed sminos for an act, in order. */
function laneARpcs(w: StagingWorld): Rpc[] {
  return w.sminos.s.received
    .filter((f) => f.t === 'rpc')
    .map((f) => {
      const rpc = f.rpc as { rpc: string; device: string; opId: string; args: { digest?: { request: string } } & Record<string, unknown> };
      return { rpc: rpc.rpc, device: rpc.device, opId: rpc.opId, request: rpc.args.digest?.request ?? '', args: rpc.args };
    });
}
type HostOp = { device: string; opId: string; requestId: string; answer: unknown };
/** Every `host.op` the endpoint handed the engine host, in order. */
function laneBOps(w: StagingWorld): HostOp[] {
  return w.host.calls
    .filter((c) => c.name === 'host.op')
    .map((c) => {
      const input = c.input as { device: string; opId: string; input: { requestId: string; answer: unknown } };
      return { device: input.device, opId: input.opId, requestId: input.input.requestId, answer: input.input.answer };
    });
}
/** The endpoint's stored signature counter for a credential (`webauthn.json`); 0 while it keeps none. */
function counter(w: StagingWorld, credentialId: string): number {
  const file = join(w.services.machine.stateDir, 'webauthn.json');
  return fs.existsSync(file) ? ((JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, number>)[credentialId] ?? 0) : 0;
}
const count = <T>(list: T[], test: (x: T) => boolean) => list.filter(test).length;

// ---- The phone ----------------------------------------------------------------------------------------------------------

/** The owner's real phone in the head: the device the run names, or the owner's one `web-cards` device no run made. */
export function phoneOf(head: SignedOrgState, owner: string, named: string | null): Device {
  const mine = head.state.members.find((m) => m.id === owner)?.devices ?? [];
  if (named !== null) {
    const device = mine.find((d) => d.id === named);
    if (device === undefined) throw new Error(`the head lists no device ${named} of the owner's`);
    return device;
  }
  const phones = mine.filter((d) => d.class === 'web-cards' && !(d.passkey !== undefined && cardsRunOf(d.passkey.credentialId) !== null));
  if (phones.length === 0) throw new Error("the head lists no web-cards device of the owner's: pair the phone first (staging-run.sh admin pair --class web-cards)");
  if (phones.length > 1) throw new Error(`the owner has ${phones.length} web-cards devices (${phones.map((d) => d.id).join(', ')}): name the phone with --device <id>`);
  return phones[0];
}

/** What is wrong with a `web-cards` entry as acceptance 1 says it is listed; empty when nothing is. */
export function webCardsProblems(d: Device, rpId: string): string[] {
  return [
    d.class !== 'web-cards' && `class ${d.class}`,
    d.keyStorage !== 'webcrypto' && `keyStorage ${d.keyStorage}`,
    d.stepUpPub !== undefined && 'a stepUpPub',
    d.passkey === undefined && 'no passkey',
    d.passkey !== undefined && d.passkey.rpId !== rpId && `passkey rpId ${d.passkey.rpId}`,
    d.endorsement === undefined && 'no endorsement',
  ].filter((x): x is string => typeof x === 'string');
}

/**
 * What is wrong with the notices a device of the owner's read (acceptance 2's push clause, as O11 M8 framed it for its
 * sink): each of `own` exactly once, exactly `{project, machine, session, kind: 'waiting'}` (`OwnerNotice`, nothing
 * more), and none for `theirs`, sessions the owner does not own. Empty when nothing is.
 */
export function pushProblems(read: unknown[], at: { project: string; machine: string }, own: string[], theirs: string[]): string[] {
  const of = (session: string) => read.filter((p) => (p as { session?: unknown }).session === session);
  const expected = (session: string) => canonicalize({ project: at.project, machine: at.machine, session, kind: 'waiting' });
  return [
    ...own.filter((s) => of(s).length !== 1).map((s) => `${of(s).length} notices for ${s}`),
    ...own.filter((s) => of(s).some((p) => canonicalize(p) !== expected(s))).map((s) => `${s}'s notice read ${JSON.stringify(of(s))}`),
    ...theirs.filter((s) => of(s).length > 0).map((s) => `${of(s).length} notice(s) for ${s}, not the owner's`),
  ];
}

// ---- The run ------------------------------------------------------------------------------------------------------------

export async function runItems(w: StagingWorld, report: Report, print: (line: string) => void): Promise<void> {
  const { run, cards } = w;
  const req = laneARequests(run.n);
  const owner = w.admin.member;
  const rpId = new URL(w.hub).hostname;

  // Acceptance 1: the phone's entry, verified from staging's pins; and the second device's pairing, through M3's code.
  let phone = null as Device | null;
  if (run.mode === 'phone') {
    await report.check('registration', 'the phone’s entry in the head', async () => {
      const view = await w.person.json<OrgStateView>('/api/org/state?since=0');
      const verified = await verifyPinnedChain(view.chain, view.transitions, w.pins);
      if (!verified.ok) throw new Error(`the served chain does not verify from staging's pins: ${verified.code}`);
      const found = phoneOf(verified.head, owner, run.phoneDevice);
      const wrong = webCardsProblems(found, rpId);
      if (wrong.length > 0) throw new Error(`device ${found.id}: ${wrong.join(', ')}`);
      phone = found;
      return `device ${found.id} of the owner's: class web-cards, keyStorage webcrypto, a channelPub, a passkey for ${rpId}, endorsed, no stepUpPub; head version ${verified.head.state.version}, the chain verified from staging's pinned genesis`;
    });
    report.note('registration', "the phone's panel reading *waiting for approval*, then *listed, version n*, is the owner's record; that its channel key is a non-extractable CryptoKey stands on M3's e2e-hub/cards-device.spec.ts");
  }
  await report.check('registration', `${cards.name} paired through staging's pairing exchange (M3's code path)`, async () => {
    const { deviceFingerprint, macFingerprint, listedAt } = cards.pairing;
    if (deviceFingerprint !== macFingerprint) throw new Error(`the device showed ${deviceFingerprint ?? 'no fingerprint'}, the Mac's side ${macFingerprint}`);
    const entry = (await w.admin.read()).state.members.find((m) => m.id === owner)?.devices.find((d) => d.id === cards.record.deviceId);
    if (entry === undefined) throw new Error('the head does not list it');
    const wrong = webCardsProblems(entry, rpId);
    if (wrong.length > 0 || entry.channelPub !== cards.record.channelPub || canonicalize(entry.passkey) !== canonicalize(cards.record.passkey)) throw new Error(`the listed entry is not the one the device posted (${wrong.join(', ')})`);
    return `device ${cards.record.deviceId}: its entry posted with its MAC, judged as admin pair judges it (fingerprint ${macFingerprint} on both sides), listed at version ${listedAt}, the device's pinned sync reading listed`;
  });

  // Everything raised at once: each of the owner's sessions counts up from 0 once.
  w.pending.raise(...req.owners, ...req.device, req.theirs);
  // Lane B's likewise: a rise in a session's count is a new request waiting, which pushes (notify.ts), so its requests
  // are raised while the engine host's link to mawsd is down and told by the whole-set read at the next link
  // (lane-b-pending.ts `restate`), one rise per session. Each answer later moves its count through the per-change path.
  w.host.upstream(false);
  w.host.request(OWN_B, 'question', LANE_B.question);
  w.host.request(OWN_B, 'permission', LANE_B.permission);
  w.host.request(HARNESS_B, 'permission', LANE_B.list);
  w.host.request(HARNESS_B, 'permission', LANE_B.replay);
  w.host.request(HARNESS_B, 'permission', LANE_B.borrow);
  const theirsB = w.host.request(THEIRS_B, 'permission', LANE_B.theirs);
  w.host.upstream(true);
  const presence = () => w.cards.socket.presence()?.pending ?? {};
  const laneAShown = await until(() => (presence()[OWN_A]?.pending ?? 0) >= 2 && (presence()[HARNESS_A]?.pending ?? 0) >= 3, 'the lane A counts at the hub', 30_000).then(
    () => true,
    () => false,
  );
  const fed = laneAShown && (await until(() => (presence()[OWN_B]?.pending ?? 0) > 0, `${OWN_B}'s count`, 15_000).then(() => true, () => false));
  const leg = laneBLeg(fed, run.laneB);
  print(`  lane A counts at the hub: ${laneAShown ? `${OWN_A} ${presence()[OWN_A]?.pending}, ${HARNESS_A} ${presence()[HARNESS_A]?.pending}` : 'none within 30 s'}; lane B: ${fed ? `fed (${OWN_B} ${presence()[OWN_B]?.pending})` : 'no count'}, its leg ${leg}`);

  const channel = await cards.open();
  try {
    const a = watch(channel, { lane: 'A', id: HARNESS_A });
    const b = watch(channel, { lane: 'B', id: HARNESS_B });
    const setA = await a.until(has(...req.device.map((r) => r.request)), "the harness's lane A cards");
    const setB = await b.until(has(LANE_B.list, LANE_B.replay, LANE_B.borrow), "the harness's lane B cards");

    // Acceptance 2's refusals, by the second device, on each lane.
    await report.check('round-trip lane A', 'a replayed assertion, another action’s, and an answer on a session the member doesn’t own, each refused, nothing run', async () => {
      const got = await refusals(w, channel, find(setA, req.device[0].request), find(setA, req.device[1].request), await laneACard(req.theirs, 'LB'));
      const theirsSub = (await reply(channel, { t: 'sub', sub: 'theirs', session: { lane: 'A', id: THEIRS_A }, view: 'cards', cursor: null, credit: 1024 }, (m) => m.sub === 'theirs' && (m.t === 'ended' || m.t === 'subbed'))).reason;
      const ran = count(w.sminos.effects, (e) => e.endsWith(` ${req.device[1].request}`) || e.includes(` ${THEIRS_A} `));
      const said = `replayed: ${got.replayed}; another action's assertion: ${got.stepUp}; a cards sub to ${THEIRS_A}: ${String(theirsSub)}; an answer there: ${got.theirs}; ${ran} run`;
      if (got.replayed !== 'replayed' || got.stepUp !== 'step-up' || theirsSub !== 'class' || got.theirs !== 'grade' || ran > 0) throw new Error(said);
      return said;
    });
    // Lane B's run on the harness's session and the second member's, which need no notifier feed: the cards come over
    // the device's own subscription, and the second member's card is built as the client builds one.
    await report.check('round-trip lane B', 'a replayed assertion, another action’s, and an answer on a session the member doesn’t own, each refused, nothing run', async () => {
      const s = w.laneB.theirs;
      const [theirs] = await laneBCards(THEIRS_B, { pendingItems: [{ item: itemOf(s, LANE_B.theirs, 'permission'), request: theirsB, context: { launchId: s.launchId, engineSessionId: s.engineSessionId }, requestDigest: requestDigestOf(THEIRS_B, theirsB) }] });
      const why = unanswerable(theirs);
      if (why !== null) throw new Error(`${THEIRS_B}'s card is not answerable: ${why.text}`);
      const got = await refusals(w, channel, find(setB, LANE_B.replay), find(setB, LANE_B.borrow), theirs);
      const ran = [count(w.host.answered, (e) => e === `${HARNESS_B} ${LANE_B.replay}`), count(w.host.answered, (e) => e === `${HARNESS_B} ${LANE_B.borrow}`), count(w.host.answered, (e) => e.startsWith(`${THEIRS_B} `))];
      const said = `replayed: ${got.replayed}; another action's assertion: ${got.stepUp}; an answer on ${THEIRS_B}: ${got.theirs}; delivered ${ran.join('/')} (the first answer, the borrowed, the second member's)`;
      if (got.replayed !== 'replayed' || got.stepUp !== 'step-up' || got.theirs !== 'grade' || ran.join('/') !== '1/0/0') throw new Error(said);
      return said;
    });
    report.note('round-trip lane B', "the same refusals on both lanes, offline, are M4's cards.local.test.ts ('what the endpoint refuses')");

    // Acceptance 3: every item of the class's bound refused at the endpoint.
    await report.check('class-bound', 'every act, view and call outside the class refused `class`, a lane A query `grade`, nothing run', async () => {
      const cardA = find(setA, req.device[2].request);
      const cardB = find(setB, LANE_B.list) as Extract<Card, { lane: 'B' }>;
      const why = unanswerable(cardB);
      if (why !== null) throw new Error(`the lane B card is not answerable: ${why.text}`);
      const ctxB = { lane: 'B' as const, launchId: cardB.context.launchId, engineSessionId: cardB.context.engineSessionId! };
      const ctxA = { lane: 'A' as const, session: HARNESS_A, launch: 'L2' };
      const sealedAs = (fields: Pick<Action, 'action' | 'args'> & Partial<Pick<Action, 'session' | 'context'>>) => {
        const now = Date.now();
        const op: Operation = { v: 1, org: cards.identity.org, machine: w.ref, device: cards.identity.device, opId: `op-${crypto.randomUUID()}`, opCreated: new Date(now).toISOString(), ...fields };
        return seal(op, cards.assert, now);
      };
      const changed = (card: Card, given: Answer, change: (op: Operation) => void) => {
        const op = operationFor(cards.identity, w.ref, card, given, Date.now());
        change(op);
        return seal(op, cards.assert, Date.now());
      };
      const allow: Answer = { kind: 'decision', decision: 'allow' };
      const deny: Answer = { kind: 'decision', decision: 'deny' };
      const acts: Array<[string, () => Promise<Action>]> = [
        ['session.send', () => sealedAs({ action: 'session.send', session: HARNESS_B, context: ctxB, args: { appSessionId: HARNESS_B, content: 'hi' } })],
        ['session.steer', () => sealedAs({ action: 'session.steer', session: HARNESS_B, context: ctxB, args: { appSessionId: HARNESS_B, content: 'hi' } })],
        ['sminos.steer', () => sealedAs({ action: 'sminos.steer', session: HARNESS_A, context: ctxA, args: { session: HARNESS_A, text: 'go on' } })],
        ['sminos.spawn', () => sealedAs({ action: 'sminos.spawn', args: { checkout: '/work/m8', brief: 'go' } })],
        ['sminos.command', () => sealedAs({ action: 'sminos.command', session: HARNESS_A, context: ctxA, args: { session: HARNESS_A, name: 'compact', args: '' } })],
        ['endpoint.grant', () => sealedAs({ action: 'endpoint.grant', args: { grant: {} } })],
        ['session.answer with updatedInput', () => changed(cardB, allow, (op) => void ((op.args.answer as Record<string, unknown>).updatedInput = { command: 'ls' }))],
        ['session.answer with scope session', () => changed(cardB, allow, (op) => void ((op.args.answer as Record<string, unknown>).scope = 'session'))],
        ['sminos.decide with a message', () => changed(cardA, deny, (op) => void (op.args.message = 'no'))],
      ];
      const refusals: Record<string, string> = {};
      for (const [name, make] of acts) refusals[name] = await acted(channel, await make());
      refusals['sub full'] = (await reply(channel, { t: 'sub', sub: 'full', session: { lane: 'A', id: HARNESS_A }, view: 'full', cursor: null, credit: 1024 }, (m) => m.sub === 'full' && (m.t === 'ended' || m.t === 'subbed'))).reason as string;
      refusals['call session.events'] = ((await reply(channel, { t: 'call', id: 'events', name: 'session.events', input: { appSessionId: HARNESS_B, afterSeq: null, limit: null } }, (m) => m.t === 'result' && m.id === 'events')).error as { code: string } | undefined)?.code ?? 'answered';
      const laneAOp = laneARpcs(w).find((r) => r.device === cards.record.deviceId)?.opId;
      const queried = laneAOp === undefined ? 'no lane A op of the device to query' : (await reply(channel, { t: 'query', opId: laneAOp, opCreated: new Date().toISOString(), executor: 'sminos' }, (m) => m.t === 'queried' && m.opId === laneAOp)).reason;
      const notClass = Object.entries(refusals).filter(([, reason]) => reason !== 'class');
      const ran = count(w.sminos.effects, (e) => e.endsWith(` ${req.device[2].request}`)) + count(w.host.answered, (e) => e === `${HARNESS_B} ${LANE_B.list}`);
      if (notClass.length > 0 || queried !== 'grade' || ran > 0) throw new Error(`not class: ${JSON.stringify(Object.fromEntries(notClass))}; the lane A query: ${String(queried)}; ${ran} run`);
      return `${Object.keys(refusals).join(', ')}: class; a query of its own lane A answer: grade; nothing run`;
    });
    report.note('class-bound', "that the phone's client builds none of them is M4's never-sends suite (apps/desk-web/src/cards/client.test.ts)");
    a.close();
    b.close();
  } finally {
    // The harness's cards leave the machine's sets (the counts fall: `settled`, which pushes nothing).
    for (const r of req.device) w.pending.drop(r.request);
    w.host.setItems(HARNESS_B, []);
    w.host.setItems(THEIRS_B, []);
    if (!channel.closed) channel.close('done');
  }

  // Acceptance 2's push clause, at the run's sink: the owner's second device.
  const ownSessions = [OWN_A, HARNESS_A, ...(leg === 'run' ? [OWN_B, HARNESS_B] : [])];
  if (w.sink === null) {
    report.hold('push-owner-only', 'NOT SHOWN', 'none' in run.sink ? run.sink.none : 'no sink');
  } else {
    const { sink, ua } = w.sink;
    const pushes = async () => Promise.all(sink.received(ua.endpoint).map((body) => readPush(ua, body))) as Promise<Array<{ session?: string }>>;
    await report.check('push-owner-only', `one notice per owner's session at ${cards.name}'s subscription, none for the second member's`, async () => {
      await until(
        async () => {
          const read = await pushes();
          return ownSessions.every((s) => read.some((p) => p.session === s));
        },
        "a notice for each of the owner's sessions at the sink",
        60_000,
      );
      await sleep(5000);
      const read = await pushes();
      const problems = pushProblems(read, { project: RUN_PROJECT, machine: w.ref }, ownSessions, [THEIRS_A, THEIRS_B]);
      if (problems.length > 0) throw new Error(problems.join('; '));
      return `${read.length} notices, decrypted with the subscription's keys, one for each of ${ownSessions.join(', ')}, each exactly ${canonicalize({ project: RUN_PROJECT, machine: w.ref, session: '<session>', kind: 'waiting' })}; none for ${THEIRS_A} or ${THEIRS_B}`;
    });
  }
  if (phone !== null) {
    const id = (phone as Device).id;
    await report.check('push-owner-only', 'the phone’s push subscription, bound to its device', async () => {
      const { subscriptions } = await w.person.json<{ subscriptions: Array<{ endpoint: string; device?: string }> }>('/api/push/subscriptions');
      const bound = subscriptions.filter((s) => s.device === id);
      if (bound.length === 0) throw new Error(`the hub holds no subscription bound to the phone (${id}): turn notifications on in its Device panel`);
      return `${bound.length} subscription(s) bound to ${id}, at ${[...new Set(bound.map((s) => new URL(s.endpoint).host))].join(', ')}`;
    });
    report.note('push-owner-only', `the phone's notifications (${ownSessions.length}, one per owner's session, each *A session is waiting for your answer*; none for the second member's) are the owner's record and screenshot`);
  }
  report.note('push-owner-only', "that no device of the second member hears the owner's sessions is the hub's member selection, desk-hub's push-owners.test.ts");

  // Acceptance 2's round trip: the owner's cards answered by the phone, or by the second device in its place.
  if (run.mode === 'phone' && phone === null) {
    await report.check('round-trip lane A', 'the phone’s answers', async () => Promise.reject(new Error('no phone in the head: nothing to wait for')));
    if (leg === 'wait') report.hold('round-trip lane B', 'NOT RUN', LANE_B_WAITING);
    else await report.check('round-trip lane B', 'the phone’s answers', async () => Promise.reject(new Error('no phone in the head: nothing to wait for')));
  } else {
    const answering: Device | null = phone;
    const who = answering?.id ?? cards.record.deviceId;
    const credential = answering?.passkey?.credentialId ?? cards.passkey.credentialId;
    const before = counter(w, credential);
    const waitMs = run.mode === 'phone' ? run.answerMs : 60_000;
    if (run.mode === 'phone') {
      print('');
      print(`WAITING up to ${Math.round(run.answerMs / 60_000)} min: on the phone, open ${w.machine}'s session "o13 staging run ${run.n}: yours to answer" (its notification, or Cards):`);
      print(`  answer "${questionText(run.n)}" either way, then Allow or Deny \`echo o13-phone-${run.n} permission\`${leg === 'run' ? '; then the same on "…: yours to answer, lane B"' : ''}. Leave the harness's sessions alone.`);
      print('');
    } else {
      await answerAs(w, { lane: 'A', id: OWN_A }, req.owners.map((r) => r.request), 'allow');
      if (leg === 'run') await answerAs(w, { lane: 'B', id: OWN_B }, [LANE_B.question, LANE_B.permission], 'deny');
    }
    await report.check('round-trip lane A', `the owner's question and permission answered by ${run.mode === 'phone' ? 'the phone' : cards.name}`, async () => {
      const ids = req.owners.map((r) => r.request);
      await until(() => ids.every((id) => w.sminos.effects.some((e) => e.endsWith(` ${id}`))), 'both answers at sminos', waitMs);
      const rpcs = laneARpcs(w).filter((r) => ids.includes(r.request));
      const once = ids.map((id) => count(w.sminos.effects, (e) => e.endsWith(` ${id}`)));
      const ops = new Set(rpcs.filter((r) => r.device === who).map((r) => r.opId));
      if (rpcs.some((r) => r.device !== who) || once.some((c) => c !== 1) || ops.size !== 2) throw new Error(`rpcs ${JSON.stringify(rpcs.map((r) => [r.rpc, r.request, r.device]))}; effects ${once.join('/')}`);
      const q = rpcs.find((r) => r.rpc === 'answer')?.args.answers;
      const p = rpcs.find((r) => r.rpc === 'decide')?.args.decision;
      return `by device ${who}: the question ${JSON.stringify(q)}, the permission ${String(p)}; one effect each at sminos, under ${ops.size} operations; each act run only once the endpoint verified its assertion over the action's digest (the credential's signature counter there ${before} → ${counter(w, credential)}; one that keeps none stays 0)`;
    });
    if (leg === 'run') {
      await report.check('round-trip lane B', `the owner's lane B question and permission answered by ${run.mode === 'phone' ? 'the phone' : cards.name}`, async () => {
        const ids: string[] = [LANE_B.question, LANE_B.permission];
        await until(() => ids.every((id) => w.host.answered.includes(`${OWN_B} ${id}`)), 'both lane B answers at the engine host', waitMs);
        const ops = laneBOps(w).filter((o) => ids.includes(o.requestId));
        const once = ids.map((id) => count(w.host.answered, (e) => e === `${OWN_B} ${id}`));
        if (ops.some((o) => o.device !== who) || once.some((c) => c !== 1)) throw new Error(`host ops ${JSON.stringify(ops.map((o) => [o.requestId, o.device]))}; answers ${once.join('/')}`);
        return `by device ${who}: ${ops.map((o) => JSON.stringify(o.answer)).join(' and ')}, each delivered once through the engine host's op ledger`;
      });
    } else if (leg === 'wait') {
      report.hold('round-trip lane B', 'NOT RUN', LANE_B_WAITING);
    } else {
      await report.check('round-trip lane B', 'the endpoint feeds lane B counts', async () => Promise.reject(new Error(`no count for ${OWN_B} reached the hub's presence within 15 s, and the run requires the feed (--lane-b)`)));
    }
  }
  report.note('round-trip lane A', "lane B's engine is the harness's until mawsd (O2, O10 M10); the run with mawsd, and production's, are O10 M11's and O14's");

  // Acceptance 5's seam, as desk-web reads it from staging's head: the run's machine is a cut-over machine.
  await report.check('freeze-seam', `a session on ${w.machine} read as moved in the frozen view`, async () => {
    const view = await w.person.json<OrgStateView>('/api/org/state');
    const names = (await cutOverMachines(view.head!, view.certificates, new Date())).map((m) => m.name);
    if (!names.includes(w.machine)) throw new Error(`desk-web's cut-over machines, from staging's head, are ${names.join(', ') || 'none'}`);
    const session: CapabilityInput = { alias: OWN_A, machine: w.machine.toUpperCase(), member: true, group: 'working', seat: '', machineOnline: true, presence: { record: { status: 'busy' }, bridge: true } };
    const moved = capabilities({ ...session, movedToMaws: movedToMaws(session.machine, names) });
    const offered = VERBS.filter((verb) => moved[verb].can || moved[verb].reason !== MOVED_TO_MAWS);
    const other = movedToMaws('a-dx6-machine', names);
    if (offered.length > 0 || other) throw new Error(`verbs not refused as moved: ${offered.join(', ') || 'none'}; a machine not cut over read moved: ${other}`);
    return `${names.length} cut-over machine(s) in staging's head, ${w.machine} among them (matched case-blind); every verb (${VERBS.length}) can: false, '${MOVED_TO_MAWS}'; a machine not cut over unaffected`;
  });
  report.note('freeze-seam', "the drawn view (the composer disabled with the reason, no DX6 request sent) stands on M6b's e2e-hub/cards-landing.spec.ts: a cut-over machine sends no DX2 session lane, so staging's frozen views draw none of this machine's sessions");
}

/** The second device answering `requests` on `session` in the phone's place: a question its first options, a permission `decision`. */
async function answerAs(w: StagingWorld, session: CardSession, requests: string[], decision: 'allow' | 'deny'): Promise<void> {
  const channel = await w.cards.open();
  try {
    const cardsOf = watch(channel, session);
    const set = await cardsOf.until(has(...requests), `${session.id}'s cards`);
    for (const id of requests) {
      const card = find(set, id);
      const why = unanswerable(card);
      if (why !== null) throw new Error(`${id} is not answerable: ${why.text}`);
      const questions = questionsOf(card);
      const given: Answer = questions.length > 0 ? { kind: 'question', answers: Object.fromEntries(questions.map((q) => [q.question, q.options[0].label])) } : { kind: 'decision', decision };
      const { outcome } = await answer(channel, w.cards.identity, card, given, w.cards.assert);
      if (outcome.state !== 'done') throw new Error(`${id}: ${JSON.stringify(outcome)}`);
    }
    cardsOf.close();
  } finally {
    if (!channel.closed) channel.close('done');
  }
}

type Question = { question: string; options: Array<{ label: string }> };
function questionsOf(card: Card): Question[] {
  const holder = card.lane === 'A' ? card.raised.input : card.request;
  const questions = (holder as { questions?: unknown }).questions;
  return Array.isArray(questions) ? (questions as Question[]) : [];
}
