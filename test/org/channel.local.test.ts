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
//    hub keeps an event that no longer verifies against the head. A hostile hub that alters what it serves is played on
//    A's own transport (the channel's socket seam): one of `mini`'s says reaches A with its text changed, its signer
//    still listed.
// 2. A's channel draws the exchange folded under the sessions' aliases and machine, the attested DX1 events "attested
//    at migration by mini" and the one past `upTo` unverified from before the move; `studio`'s revoked event and the
//    forged say draw nothing and are counted.
// 3. A sends words. B's second socket (`ProjectSocket`) receives them signed (`sig`) with no `mac`, and A's own channel
//    draws them back from the log as verified words by A; B's device's words, sent through `deviceHuman`, draw as B's.
// 4. The hub stops: the channel is no longer live, and a relaunch over the same profile draws the cache "as of" its last
//    catch-up, with the same entries.
//
// M7b (acceptance 7b): every machine's to-human entries in the same channel, read by main's real channel/machines.ts.
// 5. `studio-b`, a real endpoint (O10's, over its real RL10 socket with sminos's side played by the endpoint suites'
//    `FakeSminos`), keeps a lane A session's sub-less host messages in a real spine journal (the spine's `startChannel`
//    over a real index, as test/endpoint/channel-feed.test.ts runs it behind the endpoint). This Mac's spine, another
//    real journal, records a lane B session's sent message-tool call from its event batch. A's channel draws both by
//    time among the log's entries: the endpoint's through its `channel` feed over O7's link by the hub's relay (a
//    question in the feed's snapshot, a message as its `ev`), with the title its listing gives (sminos's member record,
//    listed by the endpoint, verified into A's rows) and its machine; this Mac's with its record's title.
//    An older peer: `oldstudio`, a second real endpoint whose `h2` withholds `rl2.channel` (the endpoint's own e2e seam
//    for an earlier build), is read through `channel.history` once, with no feed opened and no live update.
// 6. `studio-b`'s endpoint stops and its link drops: its entries stay, "as of" its last live time, beside this Mac's,
//    still live.
// Cases 5 and 6 run before case 4, which stops the hub.
//
// Stand-ins, each where no real piece runs in a suite: sminos on RL10 (the endpoint suites' `FakeSminos`); the engine
// host behind each endpoint (`FakeEngineHost`, which no to-human entry crosses); the services bus around this Mac's
// spine (its `channel.history` handler is called as main's own route calls it, and its `channel.changed` is heard as
// main's taps hear it), since no `mawsd` runs here.
//
// What the tab draws is proved through main's `org.channel.*` answers and changes, folded by the renderer's own pure
// projection (channel/state.ts, channel/project.ts), as the Channel tab does.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { base64urlEncode, historyDigest, keyId, signEvent, signRecord, SIGNING_DOMAINS, type HistoryAttestation, type HistoryAttestations, type HistoryLogPage, type Signed, type SignedOrgState } from 'org-protocol';
import { deviceHuman, ProjectSocket, type LoggedEvent } from 'org-protocol/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAdminKeys } from '../../apps/desk-hub/deploy/admin-device.ts';
import { FakeEndpoint } from '../../apps/desk-hub/fake-machine/endpoint';
import { enrollV2, machineFetch, type V2Machine } from '../../apps/desk-hub/fake-machine/org';
import { encodeEnrollmentCodeV2 } from '../../apps/desk-hub/src/protocol/identity';
import type { LogEvent } from '../../apps/desk-hub/src/protocol/log';
import { enroll } from '../../apps/desk-hub/test/support/clients';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import type { RemoteLink } from '../../src/main/machines/remote/link';
import type { ChannelLink, LocalAnswer } from '../../src/main/org/channel/machines';
import { orgFiles } from '../../src/main/org/files';
import type { OrgSessionService } from '../../src/main/org/org-session';
import { createRegistryFeed, wsSocket, type RegistryFeed } from '../../src/main/org/registry-feed';
import { createRemoteRows, type RemoteRows } from '../../src/main/org/rows';
import { CHANNEL } from '../../src/renderer/src/channel/copy';
import { channelEntries, placeByTime, toHumanEntries, type ChannelEntry, type ExchangeEntry, type SayEntry, type ToHumanEntry, type WordsEntry } from '../../src/renderer/src/channel/project';
import { applyChange, held, openedWith, tailOf, type ChannelHeld, type OpenHeld } from '../../src/renderer/src/channel/state';
import type { ListedSession } from '../../src/renderer/src/stores/sessions';
import { startChannel } from '../../src/services/channel/register';
import { Index } from '../../src/services/index/index';
import type { SessionEvent } from '../../src/shared/graph/events';
import type { AppSessionId, ProjectId, SessionId } from '../../src/shared/graph/ids';
import type { SessionRecord } from '../../src/shared/graph/session';
import type { HostEntry } from '../../src/shared/ipc/schema/channel';
import type { ChannelChanged, OrgRows } from '../../src/shared/ipc/schema/org';
import { addressOf } from '../../src/shared/machine/address';
import type { OrgKey } from '../../src/shared/machine/org-key';
import type { MachineRef } from '../../src/shared/machine/ref';
import { memberNames } from '../../src/shared/org/member-name';
import { fakeServices, mintRef, type FakeServices } from '../endpoint/fake-services';
import { credentials } from '../endpoint/miniflare-hub';
import { memberId, newDevice, type TestDevice } from '../endpoint/org-fixtures';
import { FakeSminos } from '../endpoint/rl10/fake-sminos';
import { FakeEngineHost, Records } from '../endpoint/sub-harness';
import { summary } from '../support/index-fixture';
import { ADMIN, ORG, enrollEndpoint, orgSession, registerThroughPair, registered, relayLink, scratchDir, sleep, startLocalOrg, until, type LocalOrg } from './local-org';

const PROJECT = '7c1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const S1 = 'e0ad139c-18bc-45bd-9489-be8653145f80'; // maws-45
const S2 = 'f1be24ad-29cd-46ce-a59a-cf9764256091'; // ci-opt
const S3 = 'a2cf35be-3ade-46ce-a59a-df0875367102'; // oldmini's phase-1 session
const S4 = 'b3d046cf-4bef-47df-b6ab-e01986478213'; // studio's
const B_EMAIL = 'ana@example.com';
/** `mini`'s say that A's transport alters on the way in, and what A is served in its place. */
const ORIGINAL = 'Shard 3 of 8 is green; merging.';
const FORGED = 'Shard 3 of 8 failed; reverting the merge.';

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
/** The offsets whose event A's transport altered. */
const forged = new Set<number>();

/**
 * A's channel socket, a hostile hub's: `ws` as main's default, every `log` frame passed on with the say reading ORIGINAL
 * altered to read FORGED, its signature and signer as stored.
 */
function forgingSocket(url: string, headers: Record<string, string>): ReturnType<typeof wsSocket> {
  const socket = wsSocket(url, headers);
  const forge = (text: string): string => {
    const frame = JSON.parse(text) as { t?: string; events?: { offset: number; event: { text?: string } }[] };
    if (frame.t !== 'log' || !frame.events?.some((e) => e.event.text === ORIGINAL)) return text;
    for (const e of frame.events) {
      if (e.event.text !== ORIGINAL) continue;
      e.event.text = FORGED;
      forged.add(e.offset);
    }
    return JSON.stringify(frame);
  };
  return {
    on(event: string, listener: (...args: never[]) => void) {
      if (event === 'message') socket.on('message', (text: string) => (listener as (text: string) => void)(forge(text)));
      else socket.on(event as 'open', listener as () => void);
    },
    send: (text: string) => socket.send(text),
    close: () => socket.close(),
  } as ReturnType<typeof wsSocket>;
}

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
function v2(from: V2Machine, session: string, seq: number, body: Record<string, unknown>): Promise<LogEvent> {
  const now = new Date().toISOString();
  return signEvent({ org: ORG, project: PROJECT }, { ts: now, created: now, writer: `${from.name}/${session}`, seq, ...body }, from.key.privateKey, from.key.pub) as unknown as Promise<LogEvent>;
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

// ---- M7b: every machine's to-human entries ----------------------------------------------------------------------------

/** This Mac, as main names it to the channel's machines. */
const LOCAL = mintRef();
const LOCAL_NAME = 'o8-macbook';
const CHECKOUT = '/w/o8-channel';
const T0 = Date.now();
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
/** studio-b's lane A session, and oldstudio's, as sminos records them (their listings' titles). */
const LA = { session: 'c5f2b7a3-4d6e-4f80-9a1b-2c3d4e5f6071', alias: 'shard-runner', title: 'Rerun the flaky shards of the o8 channel suite' };
const LA_OLD = { session: 'd6a3c8b4-5e7f-4091-8b2c-3d4e5f607182', alias: 'importer', title: 'Import the nightly clinical shards' };
/** This Mac's lane B session, its record's title. */
const LANE_B_TITLE = 'Write the migration notes';
const TEXT = {
  question: 'Ship the shard fix tonight, or wait for the second review?',
  laneA: 'Shard 3 of 8 is green on studio-b.',
  laneB: 'Migration notes drafted: docs/migrations/channel-cache-bound.md.',
  older: 'The nightly import finished on oldstudio.',
  olderLater: 'oldstudio says this after its one read.',
};

/** A real endpoint enrolled in the org, its spine's journal real, sminos's side of its RL10 socket played. */
type RealMachine = { name: string; ref: MachineRef; endpoint: Endpoint; services: FakeServices; index: Index; stopJournal(): void; sminos: FakeSminos | null; stopped: boolean };
const machines: RealMachine[] = [];
let studioB: RealMachine;
let oldStudio: RealMachine;

/**
 * `name`'s endpoint (O10's, over the hub), the journal its seam hands lane A's entries to: the spine's `startChannel` over
 * a real index, its `channel.history` served through the machine's dispatch and its `channel.changed` relayed as mawsd's
 * front relays the spine's events (test/endpoint/channel-feed.test.ts's `journal`). `env`: the endpoint's own.
 */
async function realMachine(name: string, env?: Record<string, string>): Promise<RealMachine> {
  const services = fakeServices();
  const host = new FakeEngineHost();
  host.serve(services);
  host.spine!.serve(services);
  const records = new Records();
  const endpoint: Endpoint = createEndpoint({
    build: 'o8-m7b-local',
    sleep: (ms) => sleep(Math.min(ms, 50)),
    ...(env === undefined ? {} : { env }),
    authorization: { records, checkouts: { known: (path) => endpoint.rl10.members.known(path) }, settingsMode: () => 'default' },
  });
  records.bindLaneA(endpoint.rl10.members);
  const index = new Index(join(scratch.dir(`${name}-spine`), 'index.sqlite'));
  const journal = startChannel({
    index,
    onEvent: (() => () => {}) as never,
    onEmitted: (() => () => {}) as never,
    register: ((command: string, handler: (input: unknown) => unknown) => host.spine!.handle(command, (input) => handler(input))) as never,
    emit: ((event: string, payload: unknown) => (host.emitMachine(event, payload), true)) as never,
    log,
  });
  services.channel = journal;
  const machine: RealMachine = { name, ref: services.machine.ref, endpoint, services, index, stopJournal: () => journal.stop(), sminos: null, stopped: false };
  machines.push(machine);
  await endpoint.start(services);
  await enrollEndpoint(org, endpoint, machine.ref, name);
  await until(() => endpoint.hub.connected, `${name}’s hub link`);
  endpoint.hub.openProject(PROJECT, { hello: () => ({ name: 'o8-channel', have: {} }), down: () => {} }); // relayed, so its sessions are listed
  return machine;
}

/** sminos on `m`'s RL10 socket, as test/endpoint/sub-harness.ts's `sminos` plays it: hello, the machine, its lane A session's member record. */
async function sminosOn(m: RealMachine, session: typeof LA): Promise<FakeSminos> {
  const path = join(m.services.machine.stateDir, 'rl10.json');
  await until(() => existsSync(path), `${m.name}’s rl10.json`);
  const info = JSON.parse(readFileSync(path, 'utf8')) as { socket: string; token: string };
  const s = await FakeSminos.open(info.socket);
  m.sminos = s;
  const policy = { read_only: false, ceiling: 'settings' };
  s.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token: info.token, sminos: { version: 'test' }, policy });
  await s.next((x) => x.t === 'welcome', 'welcome');
  s.send({ t: 'session', message: { project: PROJECT, machine: m.name, session: null, kind: 'machine', sub: null, n: null, body: { online: true, policy, checkouts: [{ path: CHECKOUT, branch: 'main' }], desk: {} } } });
  s.send({ t: 'member', ...session, project: PROJECT, lane: 'A', state: 'idle', cwd: CHECKOUT, launch: 'L1', owners: ['@machine'], ownersProof: [], origin: { kind: 'terminal' } });
  s.send({ t: 'restated' });
  await until(() => m.endpoint.rl10.members.get(session.session) !== null, `${m.name}’s member record`);
  return s;
}

/** sminos's sub-less host message of `session` (its host store's `(writer, seq)`), as RL10 carries one to the endpoint. */
function hostMessage(m: RealMachine, session: string, seq: number, ts: string, event: Record<string, unknown>): Record<string, unknown> {
  const writer = `${m.name}/${session}`;
  return { t: 'session', message: { project: PROJECT, machine: m.name, session, kind: 'host', sub: null, n: null, body: { id: { writer, seq }, event: { ts, writer, seq, from: 'main', ...event } } } };
}

/** What `m`'s journal holds of the project, newest first. */
const journaled = (m: RealMachine): HostEntry[] => m.index.channel.history({ project: PROJECT, limit: 200 }, Date.now()).entries;

/**
 * This Mac's spine: the same `startChannel` over a real index, lane B fed by the engine host's event batches. Its
 * `channel.history` handler is called as main's own route calls it, and its `channel.changed` heard as main's taps hear
 * it, since no services bus runs here. One lane B session, in a checkout whose org project is the channel's.
 */
function localSpine() {
  const index = new Index(join(scratch.dir('local-spine'), 'index.sqlite'));
  const batches = new Set<(payload: unknown) => void>();
  const changed = new Set<(payload: { project: string; entry: HostEntry }) => void>();
  let history: ((input: unknown) => unknown) | null = null;
  const channel = startChannel({
    index,
    onEvent: ((event: string, listener: (payload: unknown) => void) => {
      if (event !== 'session.eventBatch') return () => {};
      batches.add(listener);
      return () => void batches.delete(listener);
    }) as never,
    onEmitted: (() => () => {}) as never,
    register: ((command: string, handler: (input: unknown) => unknown) => void (command === 'channel.history' && (history = handler))) as never,
    emit: ((_event: string, payload: { project: string; entry: HostEntry }) => (changed.forEach((listener) => listener(payload)), true)) as never,
    log,
  });
  const directory = join(scratch.root, 'checkout');
  mkdirSync(directory);
  const engineSessionId = '0e1f2a3b-4c5d-4e6f-8a7b-8c9d0e1f2a3b' as SessionId;
  const record = index.sessions.upsertFromSummary(summary({ directory, sessionId: engineSessionId, customTitle: LANE_B_TITLE })).record;
  index.projects.setOrg(record.projectId as ProjectId, { key: `smns:${PROJECT}` as OrgKey, name: 'o8-channel', source: 'smns', smnsId: PROJECT });
  const appSessionId = record.appId;
  let seq = 0;
  const ev = (when: string, body: Record<string, unknown>) => ({ id: `ev-${++seq}`, sessionId: engineSessionId, at: when, seq, agentId: null, parentToolUseId: null, ...body }) as unknown as SessionEvent;
  return {
    index,
    appSessionId,
    record: (): SessionRecord => index.sessions.get(appSessionId)!,
    history: async (input: unknown): Promise<LocalAnswer> => (history === null ? { ok: false, code: 'unknown_command' } : { ok: true, value: history(input) }),
    onChanged(listener: (payload: { project: string; entry: HostEntry }) => void): () => void {
      changed.add(listener);
      return () => void changed.delete(listener);
    },
    /** The session sends `text` through the to-human tool at `when`, and the tool's result says it went. */
    message(when: string, text: string): void {
      const events = [
        ev(when, { kind: 'tool.use', toolUseId: 'toolu_o8', toolName: 'mcp__to-human__message', input: { text }, apiMessageId: 'api-o8', messageUuid: 'mu-o8' }),
        ev(when, { kind: 'tool.result', toolUseId: 'toolu_o8', content: [{ type: 'text', text: 'sent' }], isError: false, structured: null, spillPath: null, denial: null, safeguard: 'not_evaluated', messageUuid: 'res-o8' }),
      ];
      for (const listener of [...batches]) listener({ appSessionId, events });
    },
    dispose(): void {
      channel.stop();
      index.close();
    },
  };
}
let spine: ReturnType<typeof localSpine>;

/** O7's roster as main reports it, and its links (by the hub's relay), each seen by the channel through a spy that keeps what it asked. */
const roster: MachineRef[] = [];
const rosterListeners = new Set<() => void>();
const links = new Map<MachineRef, RemoteLink>();
const asked: { feeds: Array<{ machine: MachineRef; feed: string }>; history: MachineRef[] } = { feeds: [], history: [] };
const seen = new Map<MachineRef, ChannelLink>();
function channelLink(ref: MachineRef): ChannelLink | null {
  const link = links.get(ref);
  if (link === undefined) return null;
  const held = seen.get(ref);
  if (held !== undefined) return held;
  const spy: ChannelLink = {
    machine: link.machine,
    get name() {
      return link.name;
    },
    peerCapabilities: () => link.peerCapabilities(),
    call: (name, input, options) => {
      if (name === 'channel.history') asked.history.push(ref);
      return link.call(name, input, options);
    },
    subscribe: (request, sink) => {
      asked.feeds.push({ machine: ref, feed: request.feed ?? 'session' });
      return link.subscribe(request, sink);
    },
    state: () => link.state(),
    onState: (listener) => link.onState(listener),
    onCaps: (listener) => link.onCaps(listener),
  };
  seen.set(ref, spy);
  return spy;
}

/** A's rows (M2's, over its registry feed): the listings that give a lane A session its title. */
let rows: RemoteRows;
let latestRows: OrgRows | null = null;

/** The renderer's names for to-human entries: this Mac's record by address, every row as `listed` (stores/sessions.ts's `applyRows`). */
function toHumanOf(h: OpenHeld): ToHumanEntry[] {
  const records = new Map([[addressOf(LOCAL, spine.appSessionId), spine.record()]]);
  const listed = new Map<AppSessionId, ListedSession>((latestRows?.rows ?? []).map((row) => {
    const appId = addressOf(row.machine, row.session as AppSessionId);
    return [appId, { ...row, appId }];
  }));
  return toHumanEntries({ hosts: h.hosts, machines: h.machines, sessions: h.sessions, records, listed });
}

beforeAll(async () => {
  org = await startLocalOrg(scratch);
  A = org.member;
  spine = localSpine();
  a = orgSession({
    userData: profile,
    build: 'o8-m7a-local',
    log,
    channelSocket: forgingSocket,
    channelMachines: {
      local: LOCAL,
      localName: LOCAL_NAME,
      history: (input) => spine.history(input),
      onChanged: (listener) => spine.onChanged(listener),
      roster: () => roster,
      onRoster: (listener) => {
        rosterListeners.add(listener);
        return () => void rosterListeners.delete(listener);
      },
      link: channelLink,
    },
  });
  sessions.push(a);
  await registerThroughPair(org, a);
  feed = createRegistryFeed({ session: a, log });
  a.attach(feed);
  // M7b: A's rows (M2's), from the feed's first opening, the roster's machines' listings.
  rows = createRemoteRows({
    session: a,
    feed,
    roster: () => roster,
    onRoster: (listener) => {
      rosterListeners.add(listener);
      return () => void rosterListeners.delete(listener);
    },
    localProjects: async () => [],
    onLocalProjects: () => () => {},
    files: orgFiles({ userData: profile, log }),
    emit: (next) => void (latestRows = next),
    log,
  });
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
  // the hub's reach check reads the addressed session from); a fourth, ORIGINAL, is the one A's transport forges.
  m.endpoint.upload(PROJECT, [
    await joined(mini, S1, 'maws-45'),
    await joined(mini, S2, 'ci-opt'),
    await say(mini, S1, 2, { session: S2, alias: 'ci-opt' }, 'The cache bound evicts the prefix; can you rerun the shard?'),
    await say(mini, S2, 2, { session: S1, alias: 'maws-45' }, 'Rerunning shard 3 of 8 now.'),
    await say(mini, S1, 3, { session: S2, alias: 'ci-opt' }, 'Thanks, I will hold the merge until it lands.'),
    await say(mini, S2, 3, { session: S1, alias: 'maws-45' }, ORIGINAL),
  ]);
  await stored(`mini/${S1}`, 3, m.endpoint);
  await stored(`mini/${S2}`, 3, m.endpoint);

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

  // M7b: the project is one of the org's (the reach of a machine's `channel` feed), and two real endpoints keep their
  // lane A sessions' to-human entries: `studio-b` with the feed, `oldstudio` an older peer whose `h2` lacks it.
  await org.amend((state) => void state.projects.push({ id: PROJECT, name: 'o8-channel' }));
  studioB = await realMachine('studio-b');
  oldStudio = await realMachine('oldstudio', { MAWS_E2E: '1', MAWS_E2E_ENDPOINT_WITHOUT: 'rl2.channel' });
  const sB = await sminosOn(studioB, LA);
  const sOld = await sminosOn(oldStudio, LA_OLD);
  // Said before A's channel opens: studio-b's question reaches A in its feed's snapshot, oldstudio's message in its one read.
  sB.send(hostMessage(studioB, LA.session, 1, at(-10), { kind: 'question', to: 'host', text: [TEXT.question], choices: ['Ship tonight', 'Wait for the review'], src: 'toolu_q' }));
  sOld.send(hostMessage(oldStudio, LA_OLD.session, 1, at(-9), { kind: 'message', to: 'host', text: TEXT.older, src: 'u#0' }));
  await until(() => journaled(studioB).length === 1 && journaled(oldStudio).length === 1, 'each endpoint’s first entry journaled');

  // A's links to both, by the hub's relay; then the roster names them.
  for (const m of [studioB, oldStudio]) links.set(m.ref, relayLink({ session: a, machine: { ref: m.ref, name: m.name }, profile, log }));
  await until(() => [...links.values()].every((link) => link.carrier() === 'relay'), 'both links up over the relay', 30_000);
  roster.push(studioB.ref, oldStudio.ref);
  rosterListeners.forEach((listener) => listener());
  await until(() => [LA, LA_OLD].every((s) => latestRows?.rows.some((row) => row.session === s.session && row.title === s.title)), 'both lane A sessions listed in A’s rows');

  await aSettled('the seeding');
}, 180_000);

afterAll(async () => {
  watcher?.close();
  for (const endpoint of endpoints) endpoint.close();
  await rows?.close();
  for (const link of links.values()) link.close();
  feed?.close();
  for (const session of sessions) await session.close();
  for (const m of machines) {
    m.sminos?.close();
    if (!m.stopped) await m.endpoint.stop();
    m.stopJournal();
    m.index.close();
    m.services.cleanup();
  }
  spine?.dispose();
  if (!hubStopped) await org?.stop();
  rmSync(scratch.root, { recursive: true, force: true });
});

describe('the project channel on the local hub', { timeout: 120_000 }, () => {
  let channel: ReturnType<typeof tab>;
  /** The live channel with every stored event judged: the log's events, `studio`'s and the forged one counted and not drawn. */
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

  it('draws the exchange folded, the attested DX1 events "attested at migration by mini", and neither the revoked key’s event nor the forged one in the stream', async () => {
    channel = tab(a, PROJECT);
    await channel.opened;
    const h = await settled();
    // The forgery is the stored say, altered on A's transport alone: B's socket holds it as mini signed it.
    const original = watcher.log.filter((e) => e.event.text === ORIGINAL).map((e) => e.offset);
    expect([...forged]).toEqual(original);
    expect(original).toHaveLength(1);
    expect(h.unverified).toBe(2);
    const studioOffsets = watcher.log.filter((e) => e.event.writer === `studio/${S4}`).map((e) => e.offset);
    for (const offset of [...studioOffsets, ...original]) expect(h.events.map((e) => e.offset)).not.toContain(offset);
    expect(JSON.stringify(h.events)).not.toContain(FORGED);

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
    // Nothing else draws: the joins give the parties their aliases and machine, and studio's say and the forged one are
    // held back.
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

  it('draws a real endpoint’s lane A entries and this Mac’s lane B message by time among the log’s, with their titles and machines (M7b case 5)', async () => {
    // Said while the channel is open: studio-b's message reaches A as its feed's `ev`, this Mac's through main's tap;
    // oldstudio's second message is journaled there, and never asked for.
    spine.message(at(-8), TEXT.laneB);
    studioB.sminos!.send(hostMessage(studioB, LA.session, 2, new Date().toISOString(), { kind: 'message', to: 'host', text: TEXT.laneA, src: 'u#1' }));
    oldStudio.sminos!.send(hostMessage(oldStudio, LA_OLD.session, 2, new Date().toISOString(), { kind: 'message', to: 'host', text: TEXT.olderLater, src: 'u#1' }));
    const h = await until(() => {
      const h = channel.open();
      return h !== null && h.hosts.length === 4 && h.machines.length === 3 ? h : null;
    }, 'four to-human entries from three machines');
    await until(() => journaled(oldStudio).length === 2, 'oldstudio’s second message journaled');

    // main's order: the entries' own time, each with its machine and its session as the spine keyed it.
    expect(h.hosts.map((x) => [x.machine, x.lane, x.session, x.kind, x.text])).toEqual([
      [studioB.ref, 'A', LA.session, 'question', TEXT.question],
      [oldStudio.ref, 'A', LA_OLD.session, 'message', TEXT.older],
      [LOCAL, 'B', spine.appSessionId, 'message', TEXT.laneB],
      [studioB.ref, 'A', LA.session, 'message', TEXT.laneA],
    ]);
    expect(h.machines).toEqual([
      { machine: LOCAL, name: LOCAL_NAME, state: 'live', asOf: expect.any(String) },
      { machine: oldStudio.ref, name: 'oldstudio', state: 'read', asOf: expect.any(String) },
      { machine: studioB.ref, name: 'studio-b', state: 'live', asOf: expect.any(String) },
    ]);

    // The tab's entries: a lane A session named by its listing's title, this Mac's by its record's; the machine each.
    const oldAsOf = h.machines.find((m) => m.machine === oldStudio.ref)!.asOf;
    const toHuman = toHumanOf(h);
    expect(toHuman).toEqual([
      expect.objectContaining({ machine: studioB.ref, name: LA.title, title: null, host: 'question', questions: [expect.objectContaining({ text: TEXT.question, choices: ['Ship tonight', 'Wait for the review'], answer: null })], asOf: null, greyed: false }),
      expect.objectContaining({ machine: oldStudio.ref, name: LA_OLD.title, title: null, host: 'message', text: TEXT.older, asOf: oldAsOf, greyed: false }),
      expect.objectContaining({ machine: LOCAL, name: LANE_B_TITLE, title: null, host: 'message', text: TEXT.laneB, asOf: null, greyed: false }),
      expect.objectContaining({ machine: studioB.ref, name: LA.title, title: null, host: 'message', text: TEXT.laneA, asOf: null, greyed: false }),
    ]);

    // Placed by time among the log's entries: the three said before the seeding's events lead the stream, and
    // studio-b's message, said after A's words, ends it.
    const stream = placeByTime(entriesOf(h), toHuman);
    const keys = toHuman.map((e) => e.key);
    expect(stream.slice(0, 3).map((e) => e.key)).toEqual(keys.slice(0, 3));
    expect(stream.at(-1)!.key).toBe(keys[3]);
    expect(stream.filter((e) => e.kind !== 'to-human').map((e) => e.key)).toEqual(entriesOf(h).map((e) => e.key));
  });

  it('reads an endpoint without `rl2.channel` through `channel.history` once, opening no feed, with no live update', async () => {
    expect(links.get(oldStudio.ref)!.peerCapabilities()).not.toContain('rl2.channel');
    expect(links.get(studioB.ref)!.peerCapabilities()).toContain('rl2.channel');
    expect(asked.feeds.filter((f) => f.machine === oldStudio.ref)).toEqual([]);
    expect(asked.feeds.filter((f) => f.machine === studioB.ref).map((f) => f.feed)).toContain('channel');
    expect(asked.history.filter((ref) => ref === oldStudio.ref)).toHaveLength(1);
    // Its second message is in its journal, and not in the channel: nothing reads it again until the tab's next open.
    expect(journaled(oldStudio).map((e) => e.text)).toEqual([TEXT.olderLater, TEXT.older]);
    const h = channel.open()!;
    expect(h.machines.find((m) => m.machine === oldStudio.ref)).toMatchObject({ state: 'read' });
    expect(h.hosts.filter((x) => x.machine === oldStudio.ref).map((x) => x.text)).toEqual([TEXT.older]);
  });

  it('keeps an endpoint’s entries "as of" its last live time once its link drops, beside this Mac’s live ones (M7b case 6)', async () => {
    const before = channel.open()!.hosts.filter((x) => x.machine === studioB.ref);
    expect(before).toHaveLength(2);
    studioB.stopped = true;
    await studioB.endpoint.stop();
    const h = await until(() => {
      const h = channel.open();
      return h?.machines.find((m) => m.machine === studioB.ref)?.state === 'offline' ? h : null;
    }, 'studio-b offline in the channel');
    const asOf = h.machines.find((m) => m.machine === studioB.ref)!.asOf;
    expect(asOf).not.toBeNull();
    expect(Date.parse(asOf!)).toBeGreaterThanOrEqual(Date.parse(before[1].at));
    expect(Date.parse(asOf!)).toBeLessThanOrEqual(Date.now());
    expect(h.hosts.filter((x) => x.machine === studioB.ref)).toEqual(before);
    expect(h.machines.find((m) => m.machine === LOCAL)).toMatchObject({ state: 'live' });

    const toHuman = toHumanOf(h);
    expect(toHuman.filter((e) => e.machine === studioB.ref).map((e) => [e.name, e.asOf, e.greyed])).toEqual([
      [LA.title, asOf, false],
      [LA.title, asOf, false],
    ]);
    expect(toHuman.find((e) => e.machine === LOCAL)).toMatchObject({ asOf: null, greyed: false });
  });

  it('with the hub stopped, draws its cache "as of" its last catch-up, after a relaunch too', async () => {
    const before = await settled();
    expect(before.asOf).not.toBeNull();
    const drawn = entriesOf(before);

    hubStopped = true;
    await org.stop();
    await until(() => channel.open()?.live === false, 'the channel no longer live');
    expect(channel.open()).toMatchObject({ asOf: before.asOf, unverified: 2 });
    channel.close();
    feed.close();
    await a.close();

    // A relaunch over the same profile, the hub away: the cache, verified again at load, "as of" the same catch-up; the
    // forged bytes it holds still fail.
    const again = orgSession({ userData: profile, build: 'o8-m7a-local', log });
    sessions.push(again);
    await again.loaded;
    const reopened = tab(again, PROJECT);
    await reopened.opened;
    const h = reopened.open();
    expect(h).toMatchObject({ live: false, asOf: before.asOf, unverified: 2 });
    expect(entriesOf(h!)).toEqual(drawn);
    expect(CHANNEL.asOf('x')).toBe('As of x');
    reopened.close();
  });
});
