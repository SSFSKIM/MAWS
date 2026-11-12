// A session's reach against desk-hub's Worker in Miniflare (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-
// interface.md, M6b's "Proves" and Interfaces §Q; acceptance 6), on the local org the O8 suites share (./local-org.ts):
// rooted by O13's real `deployment admin`, app A registered through its `pair`, and a real endpoint enrolled in the org,
// owned by A, relaying the project. Member B is added by the admin, and B's own app registers with a pairing code naming
// B, its first device listed by the admin unendorsed (as test/org/sign-in.local.test.ts registers its second member).
//
// 0. B's rows (the app's own rows.ts, from the feed's first opening) draw S, listed, from the hub alone; from case 1 on
//    they also read the machine's channel listings over B's own link (`endpoint.listings`), as the app's do.
// 1. A makes lane A session S private through the app's own `org.policy.set` (src/main/org/policy.ts: `record.policy`
//    read before and after Touch ID, the act signed once and sent over O7's link by the hub's relay). sminos records it
//    and says so in S's member frame, and the endpoint withdraws S's public listing: B's rows, the hub's feed and the
//    channel's listings read by the app's own rows.ts, lose S, and the hub lists it to B no more.
// 2. A shares S with B as Can message (`list`). B's rows gain S from the machine's channel listings alone, its audience
//    naming A and B, at the revision the share left; the hub still lists nothing of it.
// 3. B's agent can message S but not converse with it: B's `sminos.send` act (graded `converse`) is refused `grade` by
//    the endpoint, and nothing of it reaches sminos.
// 4. A record rpc its proof doesn't bind is refused by sminos, and A's save shows the refusal: the rpc changed between
//    the endpoint and sminos to another change than the one signed, to a malformed proof, or to another machine's.
// 5. This Mac's own sessions too: the endpoint is A's own Mac to a second `org.policy.*` (its `local`), whose acts and
//    read go through the endpoint's local door (`endpoint.local.act` and `.call`, as mawsd's machine socket serves
//    them). A widens lane B session `app-b` to Org can view; sminos's record moves, and `record.policy` reads it back.
// 6. M5b (the architect's ruling 1 on its refresh): B, shared S at `approve` but no owner, forces `record.owners` on S
//    through the app's own path. The endpoint refuses it `grade` (`record.*` is `manage`, the owners' alone), and nothing
//    reaches sminos.
// 7. M5b: A adds B as an owner of S over A's link, and of lane B session `app-c` through the local door. `app-c`'s record
//    was placed by its spawn act (Decision Log 190 (b)), which its `ownersProof` holds ahead of the owner act sminos
//    appends. The next listings, S's from the channel and `app-c`'s from the hub, name both A and B; adding B again
//    changes nothing.
//
// Stand-ins, each where no real piece runs in a suite: sminos on RL10 (the endpoint suites' `FakeSminos`, driven here by
// `SminosRecords`, which executes §Q's contract: the admission query answered `not-received`, then each `record.*` rpc
// held to its proof's binding as sminos holds it (refused `bad-shape` otherwise) and applied to its own record of the session `args.session` names as `set_visibility` applies it, the revision bumped by a
// change and by nothing else, the session's member frame sent again with its `access`, `shares` and `policyRev`, and
// `rpc-result` answering `done {changed, policyRev}`; `record.owners` as the desk track's executor runs it,
// sminos_visibility.py's `add_owner`: the member added to `owners` and the verified act appended verbatim to
// `ownersProof`, the revision bumped and the session re-listed, and a member who is an owner already changing nothing);
// the engine host and spine behind the endpoint (`FakeEngineHost`, which places lane B's `app-b` on its engine session for
// the members join, and names `app-c` on the engine session after its `/clear`, its spine record naming A's spawn);
// mawsd's machine socket, whose two door commands are the endpoint module's `local` called directly.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { base64urlEncode, canonicalize, encodePairingCode, isAction, type Device, type Listing, type Signed } from 'org-protocol';
import type { PendingDevice } from 'desk-hub/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import type { RemoteLink } from '../../src/main/machines/remote/link';
import { orgFiles } from '../../src/main/org/files';
import type { OrgSessionService } from '../../src/main/org/org-session';
import { createOrgPolicies, type OrgPolicies } from '../../src/main/org/policy';
import { createRegistryFeed, type RegistryFeed } from '../../src/main/org/registry-feed';
import { createRemoteRows, NO_ROW_KEYS, type ListingsLink, type RemoteRows } from '../../src/main/org/rows';
import type { OrgPolicy, OrgRows } from '../../src/shared/ipc/schema/org';
import { addressOf } from '../../src/shared/machine/address';
import type { MachineRef } from '../../src/shared/machine/ref';
import { fakeServices, mintRef, type FakeServices } from '../endpoint/fake-services';
import { FakeSminos, type Frame } from '../endpoint/rl10/fake-sminos';
import { FakeEngineHost, Records } from '../endpoint/sub-harness';
import { ORG, enrollEndpoint, orgSession, registerThroughPair, registered, relayLink, scratchDir, sleep, startLocalOrg, until, type LocalOrg } from './local-org';

const PROJECT = '5b2e8c41-7d3a-4f19-9c6e-0a1b2c3d4e5f';
const CHECKOUT = '/w/o8-policy';
const B_EMAIL = 'bea@example.com';
/** S, lane A, A's by `@machine`; `app-b`, lane B on engine session `eng-b`, A's. */
const S = 'c7d1e2f3-4a5b-4c6d-8e7f-90a1b2c3d4e5';
const APP_B = 'app-o8-policy';
const ENG_B = 'eng-o8-policy';
/**
 * `app-c`, lane B, A's: sminos's record is of engine session `eng-c`, but a `/clear` moved the conversation to `eng-c2`
 * before that record reached the endpoint, so the live rows never name `eng-c` and the endpoint places the record by its
 * spawn act's opId (P5 Decision Log 190 (b), members.ts' `#bySpawn`), the act its `ownersProof` holds first.
 */
const APP_C = 'app-o8-owners';
const ENG_C = 'eng-o8-owners';
const ENG_C2 = 'eng-o8-owners-cleared';
const SPAWN_OP = 'op-o8-owners-spawn';

const scratch = scratchDir('maws-o8-policy-');
const logs: string[] = [];
const log = (line: string) => void logs.push(line);

let org: LocalOrg;
let A: string;
let B: string;
let a: OrgSessionService;
let b: OrgSessionService;
const feeds: RegistryFeed[] = [];
let endpoint: Endpoint;
let services: FakeServices;
let ref: MachineRef;
let records: SminosRecords;
let aLink: RemoteLink;
let bLink: RemoteLink;
let bRows: RemoteRows;
let bLatest: OrgRows | null = null;
/** B's RL2 roster (O7's), and whether B's rows read its machines' channel listings yet. */
const roster: MachineRef[] = [];
const rosterListeners = new Set<() => void>();
let channelRead = false;
/** B's link as B's rows read it: each `endpoint.listings` answer counted. */
let channelAnswers = 0;
const bChannel: ListingsLink = {
  state: () => bLink.state(),
  onState: (listener) => bLink.onState(listener),
  call: async (name, input, options) => {
    const result = await bLink.call(name, input, options);
    if (name === 'endpoint.listings' && result.ok) channelAnswers++;
    return result;
  },
};
/** A's policies for another machine's sessions (the endpoint's, over A's link). */
let remote: OrgPolicies;
/** A's policies with the endpoint as this Mac (its local door). */
let local: OrgPolicies;
const told: OrgPolicy[] = [];
/** `app-c`'s spawn act as its record's `ownersProof` keeps it (the proof file's act: its device, opId and action). */
let spawnAct: Record<string, unknown>;

/** A record act's fields, as sminos requires them all (sminos_rpc.py's ACT_KEYS); `webauthn` may stand beside them. */
const RECORD_ACT_FIELDS = ['v', 'org', 'machine', 'device', 'opId', 'opCreated', 'action', 'args', 'nonce', 'created', 'stepUp'] as const;
type Share = { member: string; grade: string };
type Member = Record<string, unknown> & { session: string; access: string; shares: Share[]; owners: string[]; ownersProof: unknown[]; policyRev: number };

/**
 * sminos's side of §Q on the endpoint's RL10 socket: the session records it keeps (each reported as a `member` frame),
 * and its executors of the three `record.*` rpcs, each act's proof kept as `set_visibility(…, operator=True)` keeps it.
 */
class SminosRecords {
  readonly members = new Map<string, Member>();
  /** Each rpc executed, with the outcome it answered. */
  readonly executed: Array<{ rpc: Record<string, unknown>; outcome: Record<string, unknown> }> = [];
  readonly #ledger = new Map<string, { rpc: Record<string, unknown>; outcome: Record<string, unknown> }>();
  #at = 0;
  readonly #timer: ReturnType<typeof setInterval>;

  constructor(
    readonly s: FakeSminos,
    /** The run's facts a proof is held to: this machine's ref, the run's devices, and lane B's app sessions by id. */
    private readonly binding: { machine: () => string; devices: () => string[]; laneB: ReadonlyMap<string, string> },
  ) {
    this.#timer = setInterval(() => this.#pump(), 10);
  }

  report(member: Member): void {
    this.members.set(member.session, member);
    this.s.send({ t: 'member', ...member });
  }

  stop(): void {
    clearInterval(this.#timer);
  }

  #pump(): void {
    for (; this.#at < this.s.received.length; this.#at++) {
      const frame = this.s.received[this.#at];
      if (frame.t === 'query') this.#query(frame);
      else if (frame.t === 'rpc') this.#execute(frame.rpc as Record<string, unknown>);
    }
  }

  /** The admission query (and a lost act's): the ledger's answer, `not-received` for an op it never ran. */
  #query(frame: Frame): void {
    const ran = this.#ledger.get(frame.opId as string);
    if (ran === undefined) return this.s.send({ t: 'queried', opId: frame.opId, state: 'not-received' });
    const args = ran.rpc.args as { session: string };
    this.s.send({ t: 'queried', opId: frame.opId, state: 'done', member: ran.rpc.member, device: ran.rpc.device, fingerprint: ran.rpc.fingerprint, target: { kind: 'session', session: args.session }, outcome: ran.outcome });
  }

  #execute(rpc: Record<string, unknown>): void {
    const outcome = this.#apply(rpc);
    this.#ledger.set(rpc.opId as string, { rpc, outcome });
    this.executed.push({ rpc, outcome });
    this.s.send({ t: 'rpc-result', project: rpc.project, opId: rpc.opId, nonce: rpc.nonce, outcome });
  }

  /** A change made to the next rpc before it is checked: the suite's rejection probes. */
  tamper: ((rpc: Record<string, unknown>) => void) | undefined;
  /** Why each rpc refused for its proof was refused, in order. */
  readonly unbound: string[] = [];

  /**
   * Why `rpc`'s proof is not the act it carries out, or null: §Q's binding as sminos checks it (sminos_rpc.py's
   * proof_refusal and record_proof), made here on its own, never through the endpoint's code. The proof an act in its
   * exact shape (org-protocol's isAction) with exactly a record act's fields (a step-up; no session, context or
   * requestDigest); this machine's (the run's org and machine ref);
   * this op's (its opId, opCreated and device, a device of the run's); a `record.*` act of this rpc's name; naming one
   * target, `session` equal to the rpc's or, lane B, `appSessionId` the app session the rpc's `session` is (stricter
   * than sminos, which can't resolve it); and past the target exactly the rpc's args less `session`, as canonical JSON.
   */
  #unbound(rpc: Record<string, unknown>): string | null {
    const proof = rpc.proof as Record<string, unknown> | undefined;
    const name = rpc.rpc as string;
    if (!isAction(proof)) return 'not an act in its exact shape';
    // a record act's fields, every one required, `webauthn` alone beside them: a step-up, and no session, context or
    // requestDigest (sminos_rpc.py's ACT_KEYS), where isAction leaves stepUp optional and admits the other three
    const fields = Object.keys(proof).filter((k) => k !== 'webauthn');
    if (fields.length !== RECORD_ACT_FIELDS.length || !RECORD_ACT_FIELDS.every((k) => k in proof)) return 'not a record act’s fields: a step-up, and no session, context or requestDigest';
    if (proof.org !== ORG || proof.machine !== this.binding.machine()) return 'not this machine’s';
    if (proof.opId !== rpc.opId || proof.opCreated !== rpc.opCreated || proof.device !== rpc.device || !this.binding.devices().includes(proof.device)) return 'not this op’s';
    if (!name.startsWith('record.') || proof.action !== name) return `not a ${name} act`;
    const rpcArgs = rpc.args as Record<string, unknown>;
    const targets = (['session', 'appSessionId'] as const).filter((k) => k in proof.args);
    if (targets.length !== 1) return 'naming no one target';
    const [target] = targets;
    const named = proof.args[target];
    if (target === 'session' ? named !== rpcArgs.session : this.binding.laneB.get(named as string) !== rpcArgs.session) return 'not for this session';
    const rest = (o: Record<string, unknown>, k: string) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));
    if (canonicalize(rest(proof.args, target)) !== canonicalize(rest(rpcArgs, 'session'))) return 'not this change';
    return null;
  }

  /**
   * `set_visibility` (an access or a share) or `add_owner` (an owner, its act kept in `ownersProof`) on the record
   * `args.session` keys: a change bumps `policyRev` once and is reported; a no-op isn't.
   */
  #apply(rpc: Record<string, unknown>): Record<string, unknown> {
    this.tamper?.(rpc);
    this.tamper = undefined;
    // the verified act is what admits a widening: no proof of this very act, bound to this rpc, no change
    const why = this.#unbound(rpc);
    if (why !== null) {
      this.unbound.push(why);
      return { state: 'refused', reason: 'bad-shape' };
    }
    const args = rpc.args as Record<string, unknown>;
    const member = this.members.get(args.session as string);
    if (member === undefined) return { state: 'refused', reason: 'no-session' };
    const before = JSON.stringify([member.access, member.shares, member.owners]);
    if (rpc.rpc === 'record.access') member.access = args.access as string;
    else if (rpc.rpc === 'record.shares') {
      const shares = member.shares.filter((s) => s.member !== args.member);
      if (args.grade !== null) shares.push({ member: args.member as string, grade: args.grade as string });
      member.shares = shares.sort((x, y) => x.member.localeCompare(y.member));
    } else if (rpc.rpc === 'record.owners') {
      // sminos_records.add_owner: the member added, its verified act appended verbatim; an owner already, nothing
      if (!member.owners.includes(args.member as string)) {
        member.owners = [...member.owners, args.member as string];
        member.ownersProof = [...member.ownersProof, rpc.proof];
      }
    } else return { state: 'refused', reason: 'bad-shape' };
    const changed = JSON.stringify([member.access, member.shares, member.owners]) !== before;
    if (changed) {
      member.policyRev += 1;
      this.report(member);
    }
    return { state: 'done', result: { changed, policyRev: member.policyRev } };
  }
}

const laneA = (): Member => ({ session: S, alias: 'reach-runner', project: PROJECT, lane: 'A', state: 'idle', title: 'Run the reach checks', cwd: CHECKOUT, launch: 'L1', owners: ['@machine'], ownersProof: [], origin: { kind: 'terminal' }, access: 'listed', shares: [], policyRev: 1 });

/** A session's row in B's rows, or undefined. */
const bRowOf = (session: string) => bLatest?.rows.find((r) => r.session === session && r.machine === ref);
const bRowOfS = () => bRowOf(S);
/** The listings the hub serves B now. */
async function hubListsToB(): Promise<string[]> {
  const { listings } = (await (await org.hub.fetchAs(B_EMAIL, '/api/listings')).json()) as { listings: Signed<Listing>[] };
  return listings.filter((l) => l.body.machine === ref && l.body.fields.state !== 'gone').map((l) => l.body.session);
}

/** A's current revision of `address`'s policy, as the Share sheet opens on it. */
async function revisionOf(policies: OrgPolicies, address: string): Promise<number> {
  const read = await policies.get({ address });
  if (!read.ok || !read.supported) throw new Error(`the policy read: ${JSON.stringify(read)}`);
  const entry = read.policies[0];
  if (!('policyRev' in entry)) throw new Error(`the policy read: ${JSON.stringify(read)}`);
  return entry.policyRev;
}

beforeAll(async () => {
  org = await startLocalOrg(scratch);
  A = org.member;

  // A's app, registered through `pair`; its Touch ID is the suite's yes.
  a = orgSession({ userData: scratch.dir('a'), build: 'o8-m6b-local', log });
  await registerThroughPair(org, a);
  const aFeed = createRegistryFeed({ session: a, log });
  a.attach(aFeed);
  feeds.push(aFeed);

  // B, added by the admin; B's app registers with a code naming B, and the admin lists its first device unendorsed.
  B = `${'b'.repeat(31)}6`;
  await org.amend((state) => void state.members.push({ id: B, email: B_EMAIL, role: 'member', devices: [] }));
  const head = (await org.served()).head;
  const code = encodePairingCode({ hub: org.hub.url, org: ORG, member: B, roots: head.state.root.keys, recoveryPub: head.state.root.recoveryPub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))) });
  b = orgSession({ userData: scratch.dir('b'), build: 'o8-m6b-local', log, env: { MAWS_DEV_STANDIN_USER: B_EMAIL } });
  await b.loaded;
  if (!b.register(code).ok) throw new Error('B’s register refused');
  await until(() => b.status().state === 'registering' && (b.status() as { step: string }).step === 'approval', 'B’s approval step');
  const { pending } = (await (await org.hub.fetchAs(B_EMAIL, '/api/devices/pending')).json()) as { pending: PendingDevice[] };
  if (pending.length !== 1) throw new Error(`B’s pending entries: ${pending.length}`);
  const { deviceId, class: cls, keyStorage, channelPub, stepUpPub } = pending[0];
  const entry: Device = { id: deviceId, class: cls, keyStorage, channelPub, stepUpPub };
  await org.amend((state) => void state.members.find((m) => m.id === B)!.devices.push(entry));
  await until(() => b.current(), 'B signed in');
  const bFeed = createRegistryFeed({ session: b, log });
  b.attach(bFeed);
  feeds.push(bFeed);
  // B's rows from the feed's first opening, as the app makes them: the hub's listings of the roster's machines, and
  // from the second case on their channel listings, read every second here (60 s in the app).
  bRows = createRemoteRows({
    session: b,
    feed: bFeed,
    roster: () => roster,
    onRoster: (listener) => {
      rosterListeners.add(listener);
      return () => void rosterListeners.delete(listener);
    },
    keys: NO_ROW_KEYS,
    link: (machine) => (channelRead && machine === ref ? bChannel : null),
    files: orgFiles({ userData: scratch.dir('b'), log }),
    emit: (next) => void (bLatest = next),
    timing: { ROWS_CHANNEL_MS: 1000 },
    log,
  });
  await until(() => registered(b)?.hubAccess === 'connected', 'B’s feed connected');

  // The endpoint, A's, its engine host placing `app-b` on `eng-b`, relaying the project.
  services = fakeServices();
  const host = new FakeEngineHost();
  host.serve(services);
  host.spine!.serve(services);
  const lanes = new Records();
  endpoint = createEndpoint({
    build: 'o8-m6b-local',
    sleep: (ms) => sleep(Math.min(ms, 50)),
    authorization: { records: lanes, checkouts: { known: (path) => endpoint.rl10.members.known(path) }, settingsMode: () => 'default' },
  });
  lanes.bindLaneA(endpoint.rl10.members);
  host.add(APP_B, ENG_B);
  host.spine!.set(APP_B, ENG_B);
  lanes.set({ lane: 'B', session: ENG_B, owners: [A], access: 'listed', shares: [] }, APP_B);
  // app-c, spawned by A: the engine host and the spine name it on eng-c2 now, the conversation after its `/clear`
  spawnAct = { device: a.current()!.identity.device, opId: SPAWN_OP, action: 'session.spawn' };
  host.add(APP_C, ENG_C2);
  host.spine!.set(APP_C, ENG_C2, { launchedBy: { member: A, device: spawnAct.device, opId: SPAWN_OP, action: null } });
  lanes.set({ lane: 'B', session: ENG_C, owners: [A], access: 'listed', shares: [] }, APP_C);
  await endpoint.start(services);
  ref = services.machine.ref;
  await enrollEndpoint(org, endpoint, ref, 'o8-policy-mini');
  await until(() => endpoint.hub.connected, 'the endpoint’s hub link');
  endpoint.hub.openProject(PROJECT, { hello: () => ({ name: 'o8-policy', have: {} }), down: () => {} });

  // sminos on its RL10 socket, saying `record`, reporting S and app-b's member.
  const rl10 = join(services.machine.stateDir, 'rl10.json');
  await until(() => existsSync(rl10), 'rl10.json');
  const info = JSON.parse(readFileSync(rl10, 'utf8')) as { socket: string; token: string };
  const s = await FakeSminos.open(info.socket);
  const policy = { read_only: false, ceiling: 'settings' };
  s.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: ['audience', 'record'], token: info.token, sminos: { version: 'test' }, policy });
  const welcome = await s.next((x) => x.t === 'welcome', 'welcome');
  expect(welcome.capabilities).toContain('record');
  s.send({ t: 'session', message: { project: PROJECT, machine: 'o8-policy-mini', session: null, kind: 'machine', sub: null, n: null, body: { online: true, policy, checkouts: [{ path: CHECKOUT, branch: 'main' }], desk: {} } } });
  records = new SminosRecords(s, { machine: () => ref, devices: () => [a.current()!.identity.device, b.current()!.identity.device], laneB: new Map([[APP_B, ENG_B], [APP_C, ENG_C]]) });
  records.report(laneA());
  records.report({ ...laneA(), session: ENG_B, alias: 'notes', lane: 'B', title: 'Write the notes', owners: [A] });
  records.report({ ...laneA(), session: ENG_C, alias: 'owners', lane: 'B', title: 'Gather the owners', owners: [A], ownersProof: [spawnAct] });
  s.send({ t: 'restated' });
  await until(() => endpoint.rl10.members.appSessionId(ENG_B) === APP_B && endpoint.rl10.members.get(S) !== null, 'S and app-b joined');
  await until(() => endpoint.rl10.members.appSessionId(ENG_C) === APP_C, 'app-c placed by its spawn');

  // The endpoint at the head that lists B's device before either link opens.
  const version = (await org.served()).head.state.version;
  await until(() => (endpoint.status().stateVersion ?? 0) >= version, 'the endpoint at the head');

  // A's and B's links to it, by the hub's relay.
  aLink = relayLink({ session: a, machine: { ref, name: 'o8-policy-mini' }, profile: scratch.dir('a'), log });
  bLink = relayLink({ session: b, machine: { ref, name: 'o8-policy-mini' }, profile: scratch.dir('b'), log });
  await until(() => aLink.carrier() === 'relay' && bLink.carrier() === 'relay', 'both links up over the relay', 30_000);

  // B's roster names the machine now; its rows read the hub's listings of it, and its channel once the suite lets them.
  roster.push(ref);
  for (const listener of rosterListeners) listener();

  // A's policies: the endpoint as another machine (over A's link), and as this Mac (its local door).
  const common = { session: a, laneOf: (_machine: MachineRef, session: string) => (session === S ? ('A' as const) : null), acted: () => {}, emit: (p: OrgPolicy) => void told.push(p), log };
  remote = createOrgPolicies({ ...common, local: mintRef(), remote: (machine) => (machine === ref ? aLink : null), door: { act: () => Promise.reject(new Error('not this Mac')), call: () => Promise.reject(new Error('not this Mac')) } });
  local = createOrgPolicies({
    ...common,
    local: ref,
    remote: () => null,
    door: {
      act: (action) => endpoint.local.act(action),
      call: (input) => endpoint.local.call('record.policy', input),
    },
  });
}, 180_000);

afterAll(async () => {
  await bRows?.close();
  aLink?.close();
  bLink?.close();
  for (const feed of feeds) feed.close();
  records?.stop();
  records?.s.close();
  await a?.close();
  await b?.close();
  await endpoint?.stop();
  services?.cleanup();
  await org?.stop();
  rmSync(scratch.root, { recursive: true, force: true });
});

describe('a session’s reach on the local hub', { timeout: 120_000 }, () => {
  const address = () => addressOf(ref, S);

  it('lists S to B while it is listed, from the hub', async () => {
    await until(() => bRowOfS(), 'S in B’s rows from the hub');
    expect(bRowOfS()).toMatchObject({ lane: 'A', owners: [A], mine: false });
    expect(bRowOfS()!.audience).toBeUndefined();
    expect(await hubListsToB()).toContain(S);
  });

  it('A makes S private: sminos records it from A’s act, and B’s rows and the hub lose S', async () => {
    // B's rows read the machine's channel listings from here on, as the app's do at its link up.
    channelRead = true;
    for (const listener of rosterListeners) listener();
    await until(() => channelAnswers > 0, 'B’s first channel listings');
    expect(bRowOfS()).toBeDefined();
    const rev = await revisionOf(remote, address());
    expect(rev).toBe(1);
    const saved = await remote.set({ address: address(), access: 'private', policyRev: rev });
    expect(saved).toMatchObject({ ok: true, results: [{ line: { kind: 'access', access: 'private' }, state: 'done', changed: true, policyRev: 2, elsewhere: false }], policy: { session: S, access: 'private', shares: [], policyRev: 2 } });
    // sminos ran A's act on S's record, its proof the act A's device signed
    const ran = records.executed.at(-1)!;
    expect(ran.rpc).toMatchObject({ rpc: 'record.access', member: A, device: a.current()!.identity.device, args: { session: S, access: 'private' }, proof: { action: 'record.access', args: { session: S, access: 'private' } } });
    expect(ran.rpc).not.toHaveProperty('context');
    expect(records.members.get(S)).toMatchObject({ access: 'private', policyRev: 2 });

    await until(() => bRowOfS() === undefined, 'S gone from B’s rows', 30_000);
    expect(await hubListsToB()).not.toContain(S);
    expect(told.at(-1)).toMatchObject({ ok: true, machine: ref, supported: true });
  });

  it('A shares S with B as Can message: B’s rows gain S from the channel alone, its audience A and B', async () => {
    const rev = await revisionOf(remote, address());
    const saved = await remote.set({ address: address(), shares: [{ member: B, grade: 'list' }], policyRev: rev });
    expect(saved).toMatchObject({ ok: true, results: [{ line: { kind: 'share', member: B, grade: 'list' }, state: 'done', changed: true, policyRev: rev + 1, elsewhere: false }], policy: { access: 'private', shares: [{ member: B, grade: 'list' }], policyRev: rev + 1 } });
    expect(records.executed.at(-1)!.rpc).toMatchObject({ rpc: 'record.shares', args: { session: S, member: B, grade: 'list' } });

    const row = await until(() => bRowOfS(), 'S in B’s rows from the channel', 30_000);
    expect(row.audience).toEqual([A, B].sort());
    expect(row.policyRev).toBe(rev + 1);
    expect(await hubListsToB()).not.toContain(S);

    // the same share again is a no-op: no revision moves
    const again = await remote.set({ address: address(), shares: [{ member: B, grade: 'list' }], policyRev: rev + 1 });
    expect(again).toMatchObject({ ok: true, results: [{ state: 'done', changed: false, policyRev: rev + 1, elsewhere: false }] });
  });

  it('refuses B’s converse act on S: Can message lets B’s agents message it, not converse', async () => {
    const before = records.s.received.length;
    const handle = bLink.act({ action: 'sminos.send', session: S, context: { lane: 'A', session: S, launch: 'L1' }, args: { session: S, text: 'hello from B' }, executor: 'sminos', stepUp: 'never' });
    expect(await handle.outcome).toEqual({ state: 'refused', reason: 'grade' });
    await sleep(200);
    expect(records.s.received.slice(before).filter((f) => f.t === 'query' || f.t === 'rpc' || f.t === 'send')).toEqual([]);
  });

  it('refuses a record rpc its proof doesn’t bind, and A’s save says so: another change, a malformed proof, another machine’s, no step-up, a requestDigest', async () => {
    // Each probe changes the rpc between the endpoint and sminos, where only sminos's own check stands.
    const probes: Array<[string, (rpc: Record<string, unknown>) => void, RegExp]> = [
      ['a change other than the one signed', (rpc) => void ((rpc.args as Record<string, unknown>).access = 'org-converse'), /not this change/],
      ['a malformed proof', (rpc) => void delete (rpc.proof as Record<string, unknown>).nonce, /not an act in its exact shape/],
      ['another machine’s proof', (rpc) => void ((rpc.proof as Record<string, unknown>).machine = mintRef()), /not this machine’s/],
      ['a proof stripped of its step-up', (rpc) => void delete (rpc.proof as Record<string, unknown>).stepUp, /a record act’s fields/],
      ['a proof given a requestDigest', (rpc) => void ((rpc.proof as Record<string, unknown>).requestDigest = { session: S, request: 'r1', tool: 'Bash', input_sha256: '0'.repeat(64) }), /a record act’s fields/],
    ];
    for (const [what, tamper, why] of probes) {
      const before = structuredClone(records.members.get(S)!);
      const rev = await revisionOf(remote, address());
      records.tamper = tamper;
      const saved = await remote.set({ address: address(), access: 'org-view', policyRev: rev });
      expect(saved, what).toMatchObject({ ok: true, results: [{ line: { kind: 'access', access: 'org-view' }, state: 'refused', reason: 'bad-shape' }] });
      expect(records.unbound.at(-1), what).toMatch(why);
      expect(records.executed.at(-1)!.outcome, what).toEqual({ state: 'refused', reason: 'bad-shape' });
      expect(records.members.get(S), what).toEqual(before);
      expect(await revisionOf(remote, address()), what).toBe(rev);
    }
    // and the same act, unchanged, still binds
    expect(records.tamper).toBeUndefined();
  });

  it('changes this Mac’s own session through the local door, by the same act and rule', async () => {
    const at = addressOf(ref, APP_B);
    const rev = await revisionOf(local, at);
    expect(rev).toBe(1);
    const saved = await local.set({ address: at, access: 'org-view', policyRev: rev });
    expect(saved).toMatchObject({ ok: true, results: [{ line: { kind: 'access', access: 'org-view' }, state: 'done', changed: true, policyRev: 2, elsewhere: false }], policy: { session: APP_B, access: 'org-view', shares: [], policyRev: 2 } });
    // the act named the app session as signed, and sminos changed the member the join placed it on
    const ran = records.executed.at(-1)!;
    expect(ran.rpc).toMatchObject({ rpc: 'record.access', member: A, args: { session: ENG_B, access: 'org-view' }, proof: { action: 'record.access', args: { appSessionId: APP_B, access: 'org-view' } } });
    expect(records.members.get(ENG_B)).toMatchObject({ access: 'org-view', policyRev: 2 });
    expect(await endpoint.local.call('record.policy', { session: APP_B })).toEqual({ ok: true, output: { supported: true, policies: [{ session: APP_B, access: 'org-view', shares: [], policyRev: 2 }] } });
  });

  // The architect's ruling 1 on M5b's refresh: the Add owner item is a hint, and the endpoint is what refuses. Every
  // `record.*` act is graded `manage`, which only the session's owners and the machine's hold; a share tops out at
  // `approve`. So B, holding S at `approve`, sends the act through the app's own path, and it never reaches sminos.
  it('refuses B’s owners act on S though B holds a share at approve: the door decides, and the record is unchanged', async () => {
    const rev = await revisionOf(remote, address());
    const shared = await remote.set({ address: address(), shares: [{ member: B, grade: 'approve' }], policyRev: rev });
    expect(shared).toMatchObject({ ok: true, results: [{ line: { kind: 'share', member: B, grade: 'approve' }, state: 'done', changed: true, policyRev: rev + 1 }] });
    expect(records.members.get(S)).toMatchObject({ owners: ['@machine'], shares: [{ member: B, grade: 'approve' }] });

    const before = structuredClone(records.members.get(S)!);
    const sent = records.s.received.length;
    const bPolicies = createOrgPolicies({
      session: b,
      local: mintRef(),
      remote: (machine) => (machine === ref ? bLink : null),
      door: { act: () => Promise.reject(new Error('not this Mac')), call: () => Promise.reject(new Error('not this Mac')) },
      laneOf: (_machine, session) => (session === S ? 'A' : null),
      acted: () => {},
      emit: () => {},
      log,
    });
    const forced = await bPolicies.addOwner({ address: address(), member: B });
    expect(forced).toMatchObject({ ok: true, results: [{ line: { kind: 'owner', member: B }, state: 'refused', reason: 'grade' }] });
    await sleep(200);
    expect(records.s.received.slice(sent).filter((f) => f.t === 'query' || f.t === 'rpc')).toEqual([]);
    expect(records.members.get(S)).toEqual(before);
    expect(await revisionOf(remote, address())).toBe(rev + 1);
  });

  it('A adds B as an owner of lane A session S and lane B session app-c: sminos keeps each act, and the next listings name both', async () => {
    // before: both are A's alone in B's rows (S shared with B, app-c listed)
    await until(() => bRowOf(S) && bRowOf(APP_C), 'S and app-c in B’s rows');
    expect(bRowOf(S)).toMatchObject({ owners: [A], mine: false });
    expect(bRowOf(APP_C)).toMatchObject({ owners: [A], mine: false });

    // S, another machine's session to A: over A's link
    const rev = await revisionOf(remote, address());
    const added = await remote.addOwner({ address: address(), member: B });
    expect(added).toMatchObject({ ok: true, results: [{ line: { kind: 'owner', member: B }, state: 'done', changed: true, policyRev: rev + 1, elsewhere: false }] });
    const ranS = records.executed.at(-1)!;
    expect(ranS.rpc).toMatchObject({ rpc: 'record.owners', member: A, device: a.current()!.identity.device, args: { session: S, add: true, member: B }, proof: { action: 'record.owners', args: { session: S, add: true, member: B } } });
    // the executor's contract: the member beside `@machine`, the act appended verbatim, the revision bumped
    expect(records.members.get(S)).toMatchObject({ owners: ['@machine', B], ownersProof: [ranS.rpc.proof], policyRev: rev + 1 });

    // app-c, this Mac's own session to A: through the local door, to the record its spawn placed
    const at = addressOf(ref, APP_C);
    const revC = await revisionOf(local, at);
    const addedC = await local.addOwner({ address: at, member: B });
    expect(addedC).toMatchObject({ ok: true, results: [{ line: { kind: 'owner', member: B }, state: 'done', changed: true, policyRev: revC + 1, elsewhere: false }] });
    const ranC = records.executed.at(-1)!;
    expect(ranC.rpc).toMatchObject({ rpc: 'record.owners', member: A, args: { session: ENG_C, add: true, member: B }, proof: { action: 'record.owners', args: { appSessionId: APP_C, add: true, member: B } } });
    // the owner act after the spawn act, which the re-listed record is still placed by
    expect(records.members.get(ENG_C)).toMatchObject({ owners: [A, B], ownersProof: [spawnAct, ranC.rpc.proof], policyRev: revC + 1 });

    // the next listings name both: S's (private) from the machine's channel, app-c's (listed) from the hub too
    await until(() => bRowOf(S)?.owners.includes(B) && bRowOf(APP_C)?.owners.includes(B), 'B named an owner in B’s rows', 30_000);
    expect(bRowOf(S)).toMatchObject({ lane: 'A', owners: [A, B], mine: true });
    expect(bRowOf(APP_C)).toMatchObject({ lane: 'B', owners: [A, B], mine: true });
    // app-c's re-list carried both acts, and its listing stayed under the app session its spawn placed it on
    expect(endpoint.rl10.members.get(ENG_C)?.ownersProof).toEqual([spawnAct, ranC.rpc.proof]);
    expect(endpoint.rl10.members.appSessionId(ENG_C)).toBe(APP_C);
    const { listings } = (await (await org.hub.fetchAs(B_EMAIL, '/api/listings')).json()) as { listings: Signed<Listing>[] };
    expect(listings.find((l) => l.body.machine === ref && l.body.session === APP_C)?.body.fields.owners).toEqual([A, B]);

    // an owner added again changes nothing: no revision, no act kept
    const again = await remote.addOwner({ address: address(), member: B });
    expect(again).toMatchObject({ ok: true, results: [{ state: 'done', changed: false, policyRev: rev + 1, elsewhere: false }] });
    expect(records.members.get(S)).toMatchObject({ owners: ['@machine', B], ownersProof: [ranS.rpc.proof], policyRev: rev + 1 });
  });
});
