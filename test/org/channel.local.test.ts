// The project channel against desk-hub's Worker in Miniflare (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-
// org-interface.md, M7a's "Proves"; acceptance 7a), on the local org the O8 suites share (./local-org.ts): rooted by
// O13's real `deployment admin`, app A registered through its `pair`, a second member B with a device of their own.
// The log is seeded as the hub's own suites seed it (apps/desk-hub/test/app-connection.test.ts, history-attestations.
// test.ts): machines enrolled the v2 way and listed, uploading over RL1 (desk-hub's fake endpoint), and a phase-1 machine's
// writer handed to the project through the hub's phase-one seam.
//
// 1. `mini`'s listed key signs v2 events into the project log: two sessions join, and three `say`s pass between them.
//    `oldmini`, the same Mac before the move, left a DX1 writer of four events, and `mini` attests its first three
//    (a history attestation naming its former name). `studio` signs a `say` too, and the org then revokes its key: the
//    hub keeps an event that no longer verifies against the head, as a hub that forged one would serve it.
// 2. A's channel draws the exchange folded under the sessions' aliases and machine, the attested DX1 events "attested
//    at migration by mini" and the one past `upTo` unverified from before the move; `studio`'s event draws nothing and is
//    counted.
// 3. A sends words. B's second socket (`ProjectSocket`) receives them signed (`sig`) with no `mac`, and A's own channel
//    draws them back from the log as verified words by A; B's device's words, sent through `deviceHuman`, draw as B's.
// 4. The hub stops: the channel is no longer live, and a relaunch over the same profile draws the cache "as of" its last
//    catch-up, with the same entries.
//
// What the tab draws is proved through main's `org.channel.*` answers and changes, folded by the renderer's own pure
// projection (channel/state.ts, channel/project.ts), as the Channel tab does.
import { rmSync } from 'node:fs';
import { base64urlEncode, historyDigest, keyId, signEvent, signRecord, SIGNING_DOMAINS, type HistoryAttestation, type HistoryAttestations, type HistoryLogPage, type Signed, type SignedOrgState } from 'org-protocol';
import { deviceHuman, ProjectSocket, type LoggedEvent } from 'org-protocol/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAdminKeys } from '../../apps/desk-hub/deploy/admin-device.ts';
import { FakeEndpoint } from '../../apps/desk-hub/fake-machine/endpoint';
import { enrollV2, machineFetch, type V2Machine } from '../../apps/desk-hub/fake-machine/org';
import { encodeEnrollmentCodeV2 } from '../../apps/desk-hub/src/protocol/identity';
import { enroll } from '../../apps/desk-hub/test/support/clients';
import type { OrgSessionService } from '../../src/main/org/org-session';
import { createRegistryFeed, type RegistryFeed } from '../../src/main/org/registry-feed';
import { CHANNEL } from '../../src/renderer/src/channel/copy';
import { channelEntries, type ChannelEntry, type ExchangeEntry, type SayEntry, type WordsEntry } from '../../src/renderer/src/channel/project';
import { applyChange, held, openedWith, tailOf, type ChannelHeld, type OpenHeld } from '../../src/renderer/src/channel/state';
import type { ChannelChanged } from '../../src/shared/ipc/schema/org';
import { memberNames } from '../../src/shared/org/member-name';
import { credentials } from '../endpoint/miniflare-hub';
import { memberId, newDevice, type TestDevice } from '../endpoint/org-fixtures';
import { ADMIN, ORG, orgSession, registerThroughPair, registered, scratchDir, startLocalOrg, until, type LocalOrg } from './local-org';

const PROJECT = '7c1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const S1 = 'e0ad139c-18bc-45bd-9489-be8653145f80'; // maws-45
const S2 = 'f1be24ad-29cd-46ce-a59a-cf9764256091'; // ci-opt
const S3 = 'a2cf35be-3ade-46ce-a59a-df0875367102'; // oldmini's phase-1 session
const S4 = 'b3d046cf-4bef-47df-b6ab-e01986478213'; // studio's
const B_EMAIL = 'ana@example.com';

const scratch = scratchDir('maws-o8-channel-');
const profile = scratch.dir('a');
const logs: string[] = [];
const log = (line: string) => void logs.push(line);

let org: LocalOrg;
let hubStopped = false;
let a: OrgSessionService;
let feed: RegistryFeed;
let A: string;
let B: string;
let bDevice: TestDevice;
let mini: V2Machine;
let studio: V2Machine;
const endpoints: FakeEndpoint[] = [];
/** B's Project socket, caught up before the seeding: every event the hub stores reaches it. */
let watcher: ProjectSocket;
const sessions: OrgSessionService[] = [];

/** A v2 machine enrolled and listed in the head, owned by A, its RL1 connection open with the project said hello to. */
async function machine(name: string): Promise<{ machine: V2Machine; endpoint: FakeEndpoint }> {
  const keys = await readAdminKeys(org.adminKeys);
  const { token } = (await (await org.hub.fetchAs(ADMIN, '/api/enrollments', { body: {} })).json()) as { token: string };
  const head = (await org.served()).head;
  const code = encodeEnrollmentCodeV2({ hub: org.hub.url, token, roots: [await keyId(keys.stepUp.pub)], recoveryPub: head.state.root.recoveryPub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  const enrolled = await enrollV2(code, name);
  await org.amend((state) => {
    state.machines.push({ name, ref: enrolled.ref, pub: enrolled.key.pub, owners: [org.member] });
    state.machineNames.push({ name, ref: enrolled.ref });
  });
  const endpoint = new FakeEndpoint({ hub: org.hub.url, credentials: enrolled.credentials, ref: enrolled.ref });
  endpoints.push(endpoint);
  await endpoint.connect();
  await endpoint.project(PROJECT, 'o8-channel');
  return { machine: enrolled, endpoint };
}

/** A machine's v2 event from its session's writer, signed by its key (the hub gives it no position: the writer's seq is the machine's). */
function v2(from: V2Machine, session: string, seq: number, body: Record<string, unknown>): Promise<Record<string, unknown> & { writer: string; seq: number }> {
  const now = new Date().toISOString();
  return signEvent({ org: ORG, project: PROJECT }, { ts: now, created: now, writer: `${from.name}/${session}`, seq, ...body }, from.key.privateKey, from.key.pub) as Promise<
    Record<string, unknown> & { writer: string; seq: number }
  >;
}
const joined = (from: V2Machine, session: string, alias: string) => v2(from, session, 1, { kind: 'joined', session, alias, machine: from.name, cwd: '/w/o8-channel' });
async function say(from: V2Machine, session: string, seq: number, to: '*' | { session: string; alias: string }, text: string) {
  const version = (await org.served()).head.state.version;
  return v2(from, session, seq, { kind: 'say', from: from.name, to: to === '*' ? '*' : [to], text, attest: { owners: [A], ownersProof: [], origin: { kind: 'spawn' }, stateVersion: version } });
}

/** A phase-1 `say` from `oldmini`'s session, with a code nothing in the app checks. */
const dx1 = (seq: number) => ({
  ts: new Date(Date.now() + seq).toISOString(),
  writer: `oldmini/${S3}`,
  seq,
  kind: 'say',
  from: 'oldmini',
  to: '*',
  text: `oldmini, before the move: ${seq}`,
  mac: { nonce: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))), value: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) },
});

/** Waits until the watcher holds `count` events of `writer`; a refusal the uploading machine heard fails at once. */
async function stored(writer: string, count: number, endpoint?: FakeEndpoint): Promise<LoggedEvent[]> {
  return until(() => {
    const refused = endpoint?.frames.find((f) => f.t === 'refused');
    if (refused) throw new Error(`the hub refused an upload: ${JSON.stringify(refused)}`);
    const of = watcher.log.filter((e) => e.event.writer === writer);
    return of.length >= count ? of : null;
  }, `${count} events of ${writer} in the log`);
}

const hubHead = async () => (await org.served()).head;
/** Waits until A holds the hub's head. */
async function aSettled(what: string): Promise<SignedOrgState> {
  const head = await hubHead();
  await until(() => (a.current()?.view.head().state.version ?? 0) >= head.state.version, `A at the hub's version ${head.state.version} (${what})`);
  return head;
}

/** A tab's copy of a channel, as use-channel.ts holds it: changes heard from before the open, applied past its answer. */
function tab(session: OrgSessionService, project: string): { opened: Promise<void>; state(): ChannelHeld; open(): OpenHeld | null; close(): void } {
  let state: ChannelHeld = held();
  let answered = false;
  const early: ChannelChanged[] = [];
  const off = session.onChannel((change) => {
    if (change.project !== project) return;
    if (!answered) early.push(change);
    else state = applyChange(state, change);
  });
  const opened = session.channelOpen(project).then((answer) => {
    state = openedWith(answer);
    answered = true;
    for (const change of early) state = applyChange(state, change);
  });
  return {
    opened,
    state: () => state,
    open: () => (state.phase === 'open' ? state : null),
    close() {
      off();
      session.channelRelease(project);
    },
  };
}
const entriesOf = (h: OpenHeld): ChannelEntry[] => channelEntries({ events: h.events, sessions: h.sessions, tail: tailOf(h), me: A });

beforeAll(async () => {
  org = await startLocalOrg(scratch);
  A = org.member;
  a = orgSession({ userData: profile, build: 'o8-m7a-local', log });
  sessions.push(a);
  await registerThroughPair(org, a);
  feed = createRegistryFeed({ session: a, log });
  a.attach(feed);
  await until(() => registered(a)?.hubAccess === 'connected', 'A’s feed connected');

  // B, a second member with a device of their own.
  const bKeys = await newDevice('b-mac');
  bDevice = { ...bKeys, device: { ...bKeys.device, id: await keyId(bKeys.channel.pub) } }; // a device's id is its channel key's
  B = memberId();
  await org.amend((state) => {
    state.members.push({ id: B, email: B_EMAIL, role: 'member', devices: [bDevice.device] });
  });

  // The machines: `mini` and `studio` listed (each saying hello to the project, which the Registry then holds); B's
  // socket follows the log from before any event.
  const m = await machine('mini');
  mini = m.machine;
  const s = await machine('studio');
  studio = s.machine;
  watcher = await ProjectSocket.open(org.hub.url, credentials(B_EMAIL), PROJECT);
  await watcher.catchUp();

  // `oldmini`, a phase-1 machine: four DX1 events, handed to the project as DX2's stream handed them.
  const old = await enroll(org.hub, ADMIN, 'oldmini');
  expect((await org.hub.fetchAs(old, '/machine/enrollment')).status).toBe(200);
  for (const frame of [
    { t: 'hello', project: PROJECT, name: 'o8-channel', have: {} },
    { t: 'events', project: PROJECT, events: [1, 2, 3, 4].map(dx1) },
  ]) {
    const answered = await org.hub.phaseOneFrames(PROJECT, 'oldmini', old.clientId, 1, [frame]);
    if (answered.applied !== 1 || answered.refused.length) throw new Error(`oldmini ${frame.t}: ${JSON.stringify(answered)}`);
  }
  await stored(`oldmini/${S3}`, 4);

  // `mini`'s two sessions join, and three says pass between them, in one upload (the joins are the sessions' snapshots
  // the hub's reach check reads the addressed session from).
  m.endpoint.upload(PROJECT, [
    await joined(mini, S1, 'maws-45'),
    await joined(mini, S2, 'ci-opt'),
    await say(mini, S1, 2, { session: S2, alias: 'ci-opt' }, 'The cache bound evicts the prefix; can you rerun the shard?'),
    await say(mini, S2, 2, { session: S1, alias: 'maws-45' }, 'Rerunning shard 3 of 8 now.'),
    await say(mini, S1, 3, { session: S2, alias: 'ci-opt' }, 'Thanks, I will hold the merge until it lands.'),
  ]);
  await stored(`mini/${S1}`, 3, m.endpoint);
  await stored(`mini/${S2}`, 2, m.endpoint);

  // `studio`'s say, stored while its key verified; then the org revokes the key.
  s.endpoint.upload(PROJECT, [await say(studio, S4, 1, '*', 'studio says what the org no longer vouches for')]);
  await stored(`studio/${S4}`, 1, s.endpoint);
  const kid = await keyId(studio.key.pub);
  await org.amend((state) => {
    state.machines = state.machines.filter((x) => x.ref !== studio.ref);
    state.revoked.push({ keyId: kid, holder: { machine: studio.ref } });
  });

  // `mini` attests `oldmini`'s first three events under its former name.
  const page = (await (await machineFetch(org.hub.url, mini.credentials, `/machine/projects/${PROJECT}/log?writer=${encodeURIComponent(`oldmini/${S3}`)}&after=0`)).json()) as HistoryLogPage;
  const body: HistoryAttestation = { org: ORG, project: PROJECT, writer: `oldmini/${S3}`, names: ['mini', 'oldmini'], upTo: 3, digest: await historyDigest(page.events.slice(0, 3)), created: new Date().toISOString() };
  const record: Signed<HistoryAttestation> = await signRecord(SIGNING_DOMAINS.historyAttest, body, mini.key.privateKey, mini.key.pub);
  const posted = await machineFetch(org.hub.url, mini.credentials, `/machine/projects/${PROJECT}/attestations`, { record });
  if (posted.status !== 200 && posted.status !== 201) throw new Error(`attestation: ${posted.status} ${await posted.text()}`);

  await aSettled('the seeding');
}, 180_000);

afterAll(async () => {
  watcher?.close();
  for (const endpoint of endpoints) endpoint.close();
  feed?.close();
  for (const session of sessions) await session.close();
  if (!hubStopped) await org?.stop();
  rmSync(scratch.root, { recursive: true, force: true });
});

describe('the project channel on the local hub', { timeout: 120_000 }, () => {
  let channel: ReturnType<typeof tab>;
  /** The live channel with every stored event judged: the log's events, `studio`'s counted and not drawn. */
  const settled = () =>
    until(() => {
      const h = channel.open();
      return h !== null && h.live && h.events.length + h.unverified === watcher.log.length ? h : null;
    }, 'the channel live, every stored event judged');

  it('holds what the machines signed: v2 events with `sig` and no `mac`, the DX1 writer with `mac` and its attestation', async () => {
    const ofWriter = (writer: string) => watcher.log.filter((e) => e.event.writer === writer).map((e) => e.event);
    for (const event of [...ofWriter(`mini/${S1}`), ...ofWriter(`mini/${S2}`)]) {
      expect(event.sig).toMatchObject({ kid: await keyId(mini.key.pub) });
      expect(event.mac).toBeUndefined();
    }
    for (const event of ofWriter(`oldmini/${S3}`)) {
      expect(event.mac).toBeDefined();
      expect(event.sig).toBeUndefined();
    }
    const { records } = (await (await org.hub.fetchAs(ADMIN, `/api/projects/${PROJECT}/attestations`)).json()) as HistoryAttestations;
    expect(records.map((r) => r.body)).toEqual([expect.objectContaining({ writer: `oldmini/${S3}`, names: ['mini', 'oldmini'], upTo: 3 })]);
  });

  it('draws the exchange folded, the attested DX1 events "attested at migration by mini", and the revoked key’s event uncounted in the stream', async () => {
    channel = tab(a, PROJECT);
    await channel.opened;
    const h = await settled();
    expect(h.unverified).toBe(1);
    const studioOffsets = watcher.log.filter((e) => e.event.writer === `studio/${S4}`).map((e) => e.offset);
    expect(h.events.map((e) => e.offset)).not.toEqual(expect.arrayContaining(studioOffsets));

    const entries = entriesOf(h);
    const exchange = entries.find((e): e is ExchangeEntry => e.kind === 'exchange' && e.label === 'verified')!;
    expect(exchange).toMatchObject({ count: 3, between: [{ session: S1, alias: 'maws-45', machine: 'mini' }, { session: S2, alias: 'ci-opt', machine: 'mini' }] });
    expect(exchange.says.map((s) => s.owners.map((o) => o.id))).toEqual([[A], [A], [A]]);
    expect(`${CHANNEL.exchange(exchange.count)} ${exchange.between[0].alias} ${CHANNEL.and} ${(exchange.between[1] as { alias: string }).alias}`).toBe('3 messages between maws-45 and ci-opt');

    // oldmini's attested three fold as its broadcasts, migrated by mini; the fourth, past `upTo`, is legacy on its own.
    const migrated = entries.find((e): e is ExchangeEntry => e.kind === 'exchange' && e.label === 'migrated')!;
    expect(migrated).toMatchObject({ count: 3, by: 'mini', between: [{ alias: 'oldmini' }, 'everyone'] });
    expect(CHANNEL.migrated(migrated.by!)).toBe('attested at migration by mini');
    const legacy = entries.filter((e): e is SayEntry => e.kind === 'say' && e.label === 'legacy');
    expect(legacy.map((e) => e.text)).toEqual(['oldmini, before the move: 4']);
    // Nothing else draws: the joins give the parties their aliases and machine, and studio's say is held back.
    expect(entries.map((e) => [e.kind, e.label])).toEqual([
      ['exchange', 'migrated'],
      ['say', 'legacy'],
      ['exchange', 'verified'],
    ]);
  });

  it('sends A’s words, which B’s socket receives signed and unmacked and A draws back as verified words by A; B’s device’s words draw as B’s', async () => {
    const text = 'Holding the merge until the shard lands.';
    const sent = await a.channelSend(PROJECT, text);
    if (!sent.ok) throw new Error(`send: ${sent.reason}`);
    const received = await until(() => watcher.log.find((e) => e.event.nonce === sent.nonce), 'A’s words at B’s socket');
    expect(received.event).toMatchObject({ kind: 'human', from: 'human', member: A, writer: `hub/${A}`, to: '*', text, sig: { kid: a.current()!.identity.device } });
    expect(received.event.mac).toBeUndefined();

    const bSocket = await ProjectSocket.open(org.hub.url, credentials(B_EMAIL), PROJECT);
    try {
      await bSocket.catchUp();
      const answer = await bSocket.say(await deviceHuman({ org: ORG, project: PROJECT }, B, bDevice.channel, 'The shard is green.'));
      expect(answer).toMatchObject({ t: 'human-ack' });
    } finally {
      bSocket.close();
    }

    const names = memberNames((await hubHead()).state.members);
    const words = await until(() => {
      const h = channel.open();
      const drawn = h === null ? [] : entriesOf(h).filter((e): e is WordsEntry => e.kind === 'words');
      return h !== null && h.pending.length === 0 && drawn.length === 2 ? drawn : null;
    }, 'both words drawn from the log, nothing pending');
    expect(words).toEqual([
      expect.objectContaining({ offset: received.offset, label: 'verified', member: A, you: true, name: CHANNEL.you, text }),
      expect.objectContaining({ label: 'verified', member: B, you: false, name: names.get(B), text: 'The shard is green.' }),
    ]);
    expect(words.every((w) => w.state === undefined)).toBe(true);
    const events = channel.open()!.events;
    expect(events.find((e) => e.offset === received.offset)).toMatchObject({ label: 'verified', author: { id: A } });
    expect(events.find((e) => e.offset === words[1].offset)).toMatchObject({ label: 'verified', author: { id: B, name: names.get(B) } });
  });

  it('with the hub stopped, draws its cache "as of" its last catch-up, after a relaunch too', async () => {
    const before = await settled();
    expect(before.asOf).not.toBeNull();
    const drawn = entriesOf(before);

    hubStopped = true;
    await org.stop();
    await until(() => channel.open()?.live === false, 'the channel no longer live');
    expect(channel.open()).toMatchObject({ asOf: before.asOf, unverified: 1 });
    channel.close();
    feed.close();
    await a.close();

    // A relaunch over the same profile, the hub away: the cache, verified again at load, "as of" the same catch-up.
    const again = orgSession({ userData: profile, build: 'o8-m7a-local', log });
    sessions.push(again);
    await again.loaded;
    const reopened = tab(again, PROJECT);
    await reopened.opened;
    const h = reopened.open();
    expect(h).toMatchObject({ live: false, asOf: before.asOf, unverified: 1 });
    expect(entriesOf(h!)).toEqual(drawn);
    expect(CHANNEL.asOf('x')).toBe('As of x');
    reopened.close();
  });
});
