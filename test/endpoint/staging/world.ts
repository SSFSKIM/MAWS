// The staging phone run's world (P5 O13 M7, Interfaces §H): M4's harness (apps/desk-web/test/local/endpoint.ts, O10's
// test/endpoint/sub-harness.ts) aimed at desk-hub-staging instead of the local hub. MAWS's endpoint module runs in this
// process over the fake services, the fake engine host (lane B: the engine host's own op commands over a real ledger)
// and a fake sminos on the real RL10 socket (lane A), enrolled on staging-ssfskim the v2 way as the scratch machine
// `o13-phone-<n>` and listed by the staging admin device (`OrgAdmin`); the owner's member owns its lane A session
// `la-1` and its lane B session, a second member `o13-b-<n>` (one `native-mac` device, no sign-in) owns `la-b`. The owner's
// second `web-cards` device, `o13-c-<n>`, registers through M3's code path (the device controller, its stores in memory,
// a software authenticator in the browser passkey's place) against staging's pairing exchange, approved as `deployment
// admin pair` approves an entry, and subscribes to push at the run's sink; it answers the owner's cards in the phone's
// place when the run rehearses, and drives acceptance 3's refusals either way. Everything reaches the endpoint through
// the hub's relay, as the owner's Access session.
//
// What it makes is undone by name (sweep.ts) however the run ends; the endpoint's profile is a scratch directory.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { base64urlEncode, encodePairingCode, endorseDevice, generateSigningKey, pairingFingerprint, verifyEnrollmentMac, type Device, type DeviceIdentity, type OrgPins } from 'org-protocol';
import { SoftwareAuthenticator } from 'org-protocol/test-support';
import { encodeEnrollmentCodeV2, ORG_STATE_PATH, PENDING_DEVICES_PATH, type EnrollmentIssued, type EnrollmentKey, type OrgStateView, type PendingDevice } from 'desk-hub/protocol';
import { create } from 'zustand';
import { checkTestHub, readDeployConfig, STAGING_HOST, STAGING_WORKER } from '../../../apps/desk-hub/deploy/config';
import { judgeEntry } from '../../../apps/desk-hub/deploy/admin';
import type { Person } from '../../../apps/desk-hub/deploy/hub';
import { loadAdminDevice, OrgAdmin } from '../../../apps/desk-hub/deploy/org-admin';
import { Cleanup } from '../../../apps/desk-hub/deploy/proof';
import { httpPushSink, userAgent, type PushSink, type UserAgent } from '../../../apps/desk-hub/deploy/push-sink';
import type { Me } from '../../../apps/desk-web/src/hub/me';
import type { Assert } from '../../../apps/desk-web/src/cards/cards-passkey';
import type { Raised } from '../../../apps/desk-web/src/cards/cards';

export type { Raised };
import { machineSocket, type MachineSocket } from '../../../apps/desk-web/src/cards/carrier';
import { cardsIdentity, openChannel, type MachineChannel } from '../../../apps/desk-web/src/cards/client';
import { memoryDeviceStore, type DeviceRecord } from '../../../apps/desk-web/src/cards/device-store';
import { memoryOrgPersistence, OrgStore } from '../../../apps/desk-web/src/cards/org-store';
import { DeviceController, type DeviceView } from '../../../apps/desk-web/src/cards/register';
import { LaneASminos, until } from '../../../apps/desk-web/test/local/endpoint';
import { createEndpoint, type Endpoint } from '../../../src/endpoint';
import { fakeServices, type FakeServices } from '../fake-services';
import { newDevice } from '../org-fixtures';
import { FakeEngineHost, laneAMember, PROJECT, Records, sminos, type Fixture, type HostSession } from '../sub-harness';
import { BoundedPerson, within } from './bounded';
import { cardsCredentialId, cardsDeviceName, machineName, memberEmail, type PhoneRun } from './run';
import { sweepRun } from './sweep';

const CONFIG = join(import.meta.dirname, '../../../apps/desk-hub/deploy/staging.json');
/** The owner's lane A session, whose cards the phone answers, and the second member's, as sminos reports them. */
export const OWN_A = 'la-1';
export const THEIRS_A = 'la-b';
/** The owner's lane A session holding the second device's own cards (acceptance 3's refusals), apart from the phone's. */
export const HARNESS_A = 'la-2';
/** The owner's lane B sessions (their appSessionIds; their engine sessions `eng-<it>`): the phone's, and the harness's. */
export const OWN_B = 'app-1';
export const HARNESS_B = 'app-2';
/** The second member's lane B session: owned by them in the machine's records, never listed, its card built as the
 * client builds one (acceptance 2's answer on a session the member doesn't own). */
export const THEIRS_B = 'app-b';

/** The second `web-cards` device of the owner's: M3's device record and the channel it opens through the hub. */
export type CardsDevice = {
  name: string;
  record: DeviceRecord;
  identity: DeviceIdentity;
  orgStore: OrgStore;
  passkey: SoftwareAuthenticator;
  assert: Assert;
  /** Its Machine socket to the run's machine, which also carries the hub's presence for it. */
  socket: MachineSocket;
  open(): Promise<MachineChannel>;
  /** What the pairing showed: the fingerprint the device's panel drew while pending and the one the Mac computed over
   * the entry it approved, and the version that listed it. */
  pairing: { deviceFingerprint: string | null; macFingerprint: string; listedAt: number };
};

/**
 * sminos's pending set for the run's project, kept as sminos keeps it: what is raised is restated whole, and an answer
 * that took effect (the fake's `effects`) leaves the set, restated again, as sminos restates after a request settles.
 */
export class LaneAPending {
  readonly raised = new Map<string, Raised>();
  #seen = 0;
  readonly #timer: ReturnType<typeof setInterval>;

  constructor(readonly lane: LaneASminos) {
    this.#timer = setInterval(() => this.#follow(), 20);
  }

  raise(...bodies: Raised[]): void {
    for (const body of bodies) this.raised.set(body.request, body);
    this.#restate();
  }

  /** A request withdrawn on the machine (answered there, or the run's leftovers): settled and out of the set. */
  drop(request: string): void {
    const body = this.raised.get(request);
    if (body === undefined) return;
    this.raised.delete(request);
    this.lane.settle(body.session, request, 'closed');
    this.#restate();
  }

  stop(): void {
    clearInterval(this.#timer);
  }

  #follow(): void {
    let changed = false;
    for (; this.#seen < this.lane.effects.length; this.#seen++) {
      const request = this.lane.effects[this.#seen].split(' ')[2];
      changed = this.raised.delete(request) || changed;
    }
    if (changed) this.#restate();
  }

  #restate(): void {
    this.lane.restate([...this.raised.values()] as unknown as Array<Record<string, unknown>>);
  }
}

export type StagingWorld = {
  run: PhoneRun;
  hub: string;
  org: string;
  person: Person;
  admin: OrgAdmin;
  /** The org's pins as the admin device's anchor holds them (`keys.json.org.json`). */
  pins: OrgPins;
  endpoint: Endpoint;
  services: FakeServices;
  host: FakeEngineHost;
  records: Records;
  ref: string;
  machine: string;
  sminos: LaneASminos;
  pending: LaneAPending;
  B: { id: string; email: string };
  cards: CardsDevice;
  /** The run's push sink and `o13-c-<n>`'s subscription there; null without a tunnel. */
  sink: { sink: PushSink; ua: UserAgent } | null;
  /** The owner's lane B sessions, listed at the hub under their appSessionIds: the phone's, and the harness's; and the
   * second member's, unlisted. */
  laneB: { own: HostSession; harness: HostSession; theirs: HostSession };
  cleanup: Cleanup;
  /** What the run's undoing found still current once it ran (`LEFT …` lines): empty when it left nothing. */
  left: string[];
  log(line: string): void;
};

/** The project sminos opens on the hub's log plane, the run's machine's sessions listed in it (sub-harness's). */
export const RUN_PROJECT = PROJECT;

/**
 * The world, built step by step, each step's undoing registered before it runs; a failure on the way runs the cleanup
 * and rethrows. The run's leftovers from an earlier attempt under the same `n` are swept first.
 */
export async function startStagingWorld(run: PhoneRun, log: (line: string) => void): Promise<StagingWorld> {
  const cleanup = new Cleanup(60_000);
  const left: string[] = [];
  try {
    return await build(run, cleanup, log, left);
  } catch (error) {
    await cleanup.run();
    throw error;
  }
}

/** The staging deployment, by its own configuration: its host held to staging's, never production's. */
export function stagingTarget(): { hub: string; org: string; pinnedGenesis: string } {
  const config = readDeployConfig(CONFIG);
  if (config.worker !== STAGING_WORKER || config.host !== STAGING_HOST) throw new Error(`${CONFIG} is not staging's (${config.worker}, ${config.host})`);
  const hub = `https://${config.host}`;
  checkTestHub(hub, 'run the phone harness');
  if (!config.orgGenesis) throw new Error(`${CONFIG} pins no orgGenesis`);
  return { hub, org: config.org.id, pinnedGenesis: config.orgGenesis };
}

/** The staging admin, signing for the configuration's own org under its pinned genesis. */
export async function stagingAdmin(run: Pick<PhoneRun, 'keysFile' | 'token'>, cleanup: Cleanup, log: (line: string) => void): Promise<{ person: Person; admin: OrgAdmin; hub: string; org: string }> {
  const { hub, org, pinnedGenesis } = stagingTarget();
  const person = new BoundedPerson(hub, run.token, () => cleanup.check());
  const admin = await OrgAdmin.open(person, { org, pinnedGenesis }, await loadAdminDevice(run.keysFile), log);
  return { person, admin, hub, org };
}

/** Lists `value` for the runner's search of the log (`PhoneRun.scanList`): a secret the run handled, never to be logged. */
function handled(run: PhoneRun, value: string | undefined): void {
  if (run.scanList !== null && value) appendFileSync(run.scanList, `${value}\n`, { mode: 0o600 });
}

async function build(run: PhoneRun, cleanup: Cleanup, log: (line: string) => void, left: string[]): Promise<StagingWorld> {
  const { person, admin, hub, org } = await stagingAdmin(run, cleanup, log);
  const anchor = JSON.parse(readFileSync(`${run.keysFile}.org.json`, 'utf8')) as { roots: string[]; recoveryPub: string };
  const pins: OrgPins = { roots: anchor.roots, recoveryPub: anchor.recoveryPub };
  const name = machineName(run.n);
  log(`staging ${hub}, org ${org} at head version ${admin.head.state.version}; the run's machine ${name}`);
  const before = await sweepRun(admin, person, run.n, () => {});
  if (before.length > 0) throw new Error(`an earlier run ${run.n} left ${before.join('; ')}`);
  cleanup.add(`undo run ${run.n}`, async () => {
    left.push(...(await sweepRun(admin, person, run.n, log)));
    for (const line of left) log(`LEFT ${line}`);
  });

  // The second member: one native-mac device, no sign-in (acceptance's member).
  const B = { id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''), email: memberEmail(run.n) };
  const b1 = await newDevice('b1');
  await admin.amend(`the member ${B.email} added`, (s) => void s.members.push({ id: B.id, email: B.email, role: 'member', devices: [b1.device] }));

  // The machine: the endpoint module, its engine host and records.
  const services = fakeServices(run.profileDir === null ? {} : { profileDir: run.profileDir });
  cleanup.add('remove the endpoint’s scratch profile', async () => services.cleanup());
  const host = new FakeEngineHost();
  host.serve(services);
  const records = new Records();
  let endpoint: Endpoint | null = null;
  endpoint = createEndpoint({
    build: `o13-staging-phone-${run.n}`,
    env: {},
    authorization: { records, checkouts: { known: (path) => endpoint?.rl10.members.known(path) ?? false }, settingsMode: () => 'default' },
  });
  const started = endpoint;
  records.bindLaneA(started.rl10.members);
  await started.start(services);
  cleanup.add('stop the endpoint', () => started.stop());

  // Enrolled the v2 way: the code the admin's app builds, the machine's key checked under its secret, then listed.
  const issued = await person.json<EnrollmentIssued>('/api/enrollments', { body: {} }, 201);
  const k = crypto.getRandomValues(new Uint8Array(32));
  const { root } = admin.head.state;
  const code = encodeEnrollmentCodeV2({ hub, token: issued.token, roots: root.keys, recoveryPub: root.recoveryPub, k: base64urlEncode(k) });
  for (const value of [issued.token, code, base64urlEncode(k)]) handled(run, value);
  const enrolling = started.cli('enroll', ['--name', name, '--wait', '300', '--json'], code);
  const posted = await within(
    async (signal) => {
      const response = await person.fetch(`/api/enrollments/${issued.enrollment.id}/key`, { signal });
      if (response.status === 200) return (await response.json()) as EnrollmentKey;
      await response.body?.cancel();
      await new Promise((r) => setTimeout(r, 1000));
      return null;
    },
    `${name}'s key at the hub (Access admits a new service token within about a minute)`,
    180_000,
  );
  const fields = { name: posted.machine, machinePub: posted.pub, ref: posted.ref, tokenId: issued.enrollment.id };
  if (posted.machine !== name || posted.ref !== services.machine.ref || !(await verifyEnrollmentMac(k, fields, posted.mac))) throw new Error(`the key the hub holds for ${name} is not the one the endpoint posted under the code's secret`);
  await admin.amend(`${name} (ref ${posted.ref}) listed`, (s) => {
    s.machines.push({ name, ref: posted.ref, pub: posted.pub, owners: [admin.member] });
    s.machineNames.push({ name, ref: posted.ref });
  });
  const enrolled = await enrolling;
  if (enrolled.code !== 0) throw new Error(`enroll: exit ${enrolled.code}: ${enrolled.out.slice(0, 300)}`);
  await until(() => started.hub.connected, `${name}'s hub link`, 60_000);
  // The machine's service token, as the endpoint keeps it (read, not opened: opening the state sweeps its temporaries).
  const enrollment = JSON.parse(readFileSync(join(services.machine.stateDir, 'enrollment.json'), 'utf8')) as { credentials?: { clientSecret?: string } };
  handled(run, enrollment.credentials?.clientSecret);
  const ref = services.machine.ref;
  log(`${name} enrolled and listed (ref ${ref}), its hub link up`);

  // sminos on RL10: the owner's lane A session and the second member's, the project opened on the hub's log plane.
  const f = { endpoint: started, services } as unknown as Fixture;
  const s = await sminos(f, [
    laneAMember({ title: `o13 staging run ${run.n}: yours to answer` }),
    laneAMember({ session: HARNESS_A, alias: 'harness', title: `o13 staging run ${run.n}: the harness's own cards, not yours`, launch: 'L2' }),
    laneAMember({ session: THEIRS_A, alias: 'bob', title: `o13 staging run ${run.n}: the second member's`, launch: 'LB', owners: [B.id] }),
  ]);
  const lane = new LaneASminos(s);
  const pending = new LaneAPending(lane);
  cleanup.add('close the fake sminos', async () => {
    pending.stop();
    lane.stop();
    s.close();
  });
  host.attach(true);
  s.send({ t: 'hello', project: PROJECT, name: `o13 staging phone ${run.n}`, have: {} });
  // The owner's lane B sessions: the engine host's, each listed once sminos's member frame joins it to its engine session.
  const laneB = {
    own: listLaneB(OWN_B, `o13 staging run ${run.n}: yours to answer, lane B`),
    harness: listLaneB(HARNESS_B, `o13 staging run ${run.n}: the harness's own lane B cards, not yours`),
    theirs: host.add(THEIRS_B),
  };
  records.set({ lane: 'B', session: laneB.theirs.engineSessionId!, owners: [B.id] }, THEIRS_B);
  function listLaneB(app: string, title: string): HostSession {
    const session = host.add(app);
    records.set({ lane: 'B', session: session.engineSessionId!, owners: ['@machine'] }, app);
    s.send({ t: 'member', session: session.engineSessionId, alias: app, project: PROJECT, lane: 'B', state: 'waiting', title, cwd: '/work/m8', owners: ['@machine'], ownersProof: [], origin: { kind: 'terminal' } });
    return session;
  }

  const cards = await registerCards(run, person, admin, hub, org, ref, cleanup);
  log(`${cards.name} paired and listed at version ${cards.pairing.listedAt} (device ${cards.record.deviceId})`);

  let sink: StagingWorld['sink'] = null;
  if ('url' in run.sink) {
    const opened = await httpPushSink(run.sink.port, run.sink.url);
    cleanup.add('close the push sink', () => opened.close());
    const ua = await userAgent(opened.endpoint(cardsDeviceName(run.n)));
    const { subscription } = await person.json<{ subscription: { device?: string } }>('/api/push/subscriptions', { method: 'PUT', body: { endpoint: ua.endpoint, keys: ua.keys, device: cards.record.deviceId } });
    if (subscription.device !== cards.record.deviceId) throw new Error(`the hub bound the sink's subscription to ${subscription.device ?? 'no device'}`);
    sink = { sink: opened, ua };
    log(`${cards.name}'s push subscription at the run's sink, bound to its device`);
  }

  return { run, hub, org, person, admin, pins, endpoint: started, services, host, records, ref, machine: name, sminos: lane, pending, B, cards, sink, laneB, cleanup, left, log };
}

/**
 * `o13-c-<n>` registered as the phone registers (M3): a pairing code the owner's Mac would print, the device's keys
 * made by the controller (the channel key non-extractable), its entry posted with its MAC under the code's secret,
 * the Mac's approval (the entry judged as `deployment admin pair` judges it, endorsed by the admin device and signed
 * into a successor), and the controller's pinned sync reaching `listed`.
 */
async function registerCards(run: PhoneRun, person: Person, admin: OrgAdmin, hub: string, org: string, ref: string, cleanup: Cleanup): Promise<CardsDevice> {
  const me = await person.json<Me>('/api/me');
  const head = await admin.read();
  const k = crypto.getRandomValues(new Uint8Array(16));
  const code = encodePairingCode({ hub, org, member: admin.member, roots: head.state.root.keys, recoveryPub: head.state.root.recoveryPub, k: base64urlEncode(k) });
  for (const value of [code, base64urlEncode(k)]) handled(run, value);
  const origin = new URL(hub).origin;
  const rpId = new URL(hub).hostname;
  const passkey = new SoftwareAuthenticator(await generateSigningKey(), cardsCredentialId(run.n), rpId);
  const source = (since: number) => person.json<OrgStateView>(`${ORG_STATE_PATH}?since=${since}`);
  const orgStore = new OrgStore(org, { persistence: memoryOrgPersistence(), source });
  const view = create<DeviceView>()(() => ({ loaded: false, record: null, fingerprint: null, head: null, refused: null }));
  const controller = new DeviceController({
    org,
    store: memoryDeviceStore(),
    orgStore,
    hub: { orgState: source, postPending: async (request) => (await person.json<{ pending: PendingDevice }>(PENDING_DEVICES_PATH, { body: request }, 201)).pending },
    passkey: async () => passkey.passkey,
    origin,
    rpId,
    view,
  });
  const pair = async (): Promise<CardsDevice['pairing']> => {
    await controller.load();
    await controller.register(code, me);
    const deviceFingerprint = view.getState().fingerprint;
    const { pending } = await person.json<{ pending: PendingDevice[] }>(PENDING_DEVICES_PATH);
    const listed = new Set(head.state.members.flatMap((m) => m.devices.map((d) => d.id)));
    const answering: Array<Omit<Device, 'endorsement'>> = [];
    for (const entry of pending) {
      const judged = await judgeEntry(entry, { org, member: admin.member, k, class: 'web-cards', listed });
      if (judged.ok) answering.push(judged.device);
    }
    if (answering.length !== 1) throw new Error(`${answering.length} pending entries answered the pairing code`);
    const [device] = answering;
    const macFingerprint = await pairingFingerprint(org, admin.member, device);
    const endorsement = await endorseDevice(org, admin.member, device, admin.device.stepUp.privateKey, admin.device.stepUp.pub);
    const signed = await admin.amend(`${cardsDeviceName(run.n)} (device ${device.id}) listed`, (s) => void s.members.find((m) => m.id === admin.member)!.devices.push({ ...device, endorsement }));
    await within(async () => (await controller.sync()) === 'listed', `${cardsDeviceName(run.n)} listed`, 30_000);
    return { deviceFingerprint, macFingerprint, listedAt: signed!.state.version };
  };
  let pairing: CardsDevice['pairing'];
  try {
    pairing = await pair();
  } finally {
    controller.stop();
  }
  const record = controller.record!;
  const identity = cardsIdentity(org, record);
  const headers = person.headers;
  const socket = machineSocket(hub, ref, { connect: (url) => new WebSocket(url, { headers } as unknown as string[]), delay: () => 2000 });
  cleanup.add(`close ${cardsDeviceName(run.n)}'s Machine socket`, async () => socket.close());
  return {
    name: cardsDeviceName(run.n),
    record,
    identity,
    orgStore,
    passkey,
    assert: (challenge) => passkey.assert(challenge, origin),
    socket,
    open: () => openChannel({ ref }, identity, orgStore, { socket }),
    pairing,
  };
}
