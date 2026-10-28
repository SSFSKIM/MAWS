// The real endpoint on the local hub, for the cards client's suites (P5 O13 M4): desk-hub's local runner (wrangler
// dev's Miniflare behind the stand-in for Access, `test/endpoint/local-hub.ts`), its org rooted by `OrgAdmin` as the
// owner's Mac roots one; MAWS's endpoint module (`createEndpoint`) enrolled on it the v2 way and listed as the owner's
// machine `mini`, assembled as O10's `test/endpoint/sub-harness.ts` assembles it: the fake engine host behind its
// dispatch (lane B), with the engine host's own op commands over a real ledger file, and a fake sminos on the real RL10
// socket (lane A) that keeps a ledger of its own; and the owner's phone, a `web-cards` device registered by M3's code
// path (the device controller, its stores in memory) with a software authenticator in the browser passkey's place,
// approved as `deployment admin pair` approves it. The phone reaches the endpoint only through the hub's relay.
//
// The org: the owner (the local runner's admin, signed in by the stand-in's default identity), who owns the machine and
// holds the admin device a1 and the phone; B, a second member with one Mac, who owns `la-b` and `app-b`.
import { base64urlEncode, encodePairingCode, endorseDevice, generateSigningKey, type Action, type ByteDuplex, type DeviceIdentity, type SignedOrgState } from 'org-protocol';
import { SoftwareAuthenticator } from 'org-protocol/test-support';
import { ORG_STATE_PATH, PENDING_DEVICES_PATH, type OrgStateView, type PendingDevice } from 'desk-hub/protocol';
import { create } from 'zustand';
import type { HandlerContext } from '@shared/ipc/client';
import type { HostResponse } from '@shared/ipc/host-protocol';
import { OpLedger } from '@shared/host/op-ledger';
import type { CommandInput } from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import { judgeEntry } from '../../../desk-hub/deploy/admin';
import { opCommands } from '../../../../src/engine-host/ops';
import { createEndpoint, type Endpoint } from '../../../../src/endpoint';
import { fakeServices, type FakeServices } from '../../../../test/endpoint/fake-services';
import { startLocalHub, LOCAL_ORG, type LocalHub, type Member } from '../../../../test/endpoint/local-hub';
import { newDevice, revokedDevice } from '../../../../test/endpoint/org-fixtures';
import type { FakeSminos } from '../../../../test/endpoint/rl10/fake-sminos';
import { FakeEngineHost, laneAMember, plane, PROJECT, Records, sminos, type Fixture, type HostSession } from '../../../../test/endpoint/sub-harness';
import type { Me } from '../../src/hub/me';
import type { Assert } from '../../src/cards/cards-passkey';
import { machineSocket, type MachineSocket } from '../../src/cards/carrier';
import { cardsIdentity, openChannel, type MachineChannel, type OpenOptions } from '../../src/cards/client';
import { memoryDeviceStore, type DeviceRecord } from '../../src/cards/device-store';
import { memoryOrgPersistence, OrgStore } from '../../src/cards/org-store';
import { DeviceController, type DeviceView } from '../../src/cards/register';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function until<T>(probe: () => T | null | false | undefined | Promise<T | null | false | undefined>, what: string, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== null && value !== false && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(10);
  }
}

const ok = (value: unknown): HostResponse => ({ t: 'res', id: '0', ok: true, value });
const no = (code: 'invalid_input'): HostResponse => ({ t: 'res', id: '0', ok: false, error: { code, message: code } });

// ---- sminos's side of lane A, with a ledger -------------------------------------------------------------------------

type Op = { member: string; device: string; fingerprint: string; session: string; outcome?: unknown };

/**
 * The fake sminos answering as sminos's ledger does (O12 phase 2): a `query` with the op's binding and state, a first
 * copy's `rpc` run once (its effect recorded, the request settled), a later copy of the same op answered its stored
 * result under the copy's own nonce. `outcomes` makes the next copy of a request fail or be refused in place of its
 * effect, the failure with the words sminos would add (which the endpoint must not pass on: a lane A failure reaches
 * the device by its code alone).
 */
export class LaneASminos {
  readonly ops = new Map<string, Op>();
  /** Every answer that took effect: `<rpc> <session> <request>`. */
  readonly effects: string[] = [];
  readonly outcomes = new Map<string, unknown>();
  #read = 0;
  readonly #timer: ReturnType<typeof setInterval>;

  constructor(readonly s: FakeSminos) {
    this.#timer = setInterval(() => this.#drain(), 5);
  }

  /** The project's pending set, restated whole. */
  restate(raised: Array<Record<string, unknown>>): void {
    this.s.send({ t: 'pending', project: PROJECT, raised });
  }

  raise(raised: Record<string, unknown>): void {
    this.s.send(plane('raised', raised, { session: raised.session as string }));
  }

  settle(session: string, request: string, outcome = 'allow'): void {
    this.s.send(plane('settled', { request, winner: 'web', outcome, by: 'web' }, { session }));
  }

  stop(): void {
    clearInterval(this.#timer);
  }

  #drain(): void {
    for (; this.#read < this.s.received.length; this.#read++) {
      const frame = this.s.received[this.#read];
      if (frame.t === 'query') this.#query(frame.opId as string);
      if (frame.t === 'rpc') this.#rpc(frame.rpc as Record<string, unknown>);
    }
  }

  #query(opId: string): void {
    const op = this.ops.get(opId);
    if (op === undefined) return this.s.send({ t: 'queried', opId, state: 'not-received' });
    const state = op.outcome === undefined ? 'in-progress' : 'done';
    this.s.send({ t: 'queried', opId, state, ...(op.outcome === undefined ? {} : { outcome: op.outcome }), member: op.member, device: op.device, fingerprint: op.fingerprint, target: { kind: 'session', session: op.session } });
  }

  #rpc(rpc: Record<string, unknown>): void {
    const opId = rpc.opId as string;
    const args = rpc.args as { session: string; digest?: { request: string } };
    const known = this.ops.get(opId);
    const result = (outcome: unknown) => this.s.send({ t: 'rpc-result', project: PROJECT, opId, nonce: rpc.nonce, outcome });
    if (known !== undefined) return result(known.outcome);
    const request = args.digest?.request ?? '';
    const forced = this.outcomes.get(request);
    this.outcomes.delete(request);
    let outcome: unknown = forced;
    if (outcome === undefined) {
      this.effects.push(`${rpc.rpc} ${args.session} ${request}`);
      outcome = { state: 'done', result: {} };
      this.settle(args.session, request, rpc.rpc === 'decide' ? (rpc.args as { decision: string }).decision : 'answered');
    }
    this.ops.set(opId, { member: rpc.member as string, device: rpc.device as string, fingerprint: rpc.fingerprint as string, session: args.session, outcome });
    result(outcome);
  }
}

// ---- The phone ----------------------------------------------------------------------------------------------------

/** A carrier that can be cut as a dropped connection is: both ends see it end. */
export class Cuttable implements ByteDuplex {
  readonly #ends: Array<(reason: string) => void> = [];
  #cut = false;
  constructor(private readonly inner: ByteDuplex) {
    inner.onClose?.((reason) => this.#end(reason));
  }
  send(bytes: Uint8Array): void {
    if (!this.#cut) this.inner.send(bytes);
  }
  onBytes(listener: (bytes: Uint8Array) => void): void {
    this.inner.onBytes((bytes) => {
      if (!this.#cut) listener(bytes);
    });
  }
  onClose(listener: (reason: string) => void): void {
    this.#ends.push(listener);
  }
  close(reason: string): void {
    this.#cut = true;
    this.inner.close(reason);
  }
  /** The connection drops: the phone's channel ends, and the hub closes the channel at the endpoint. */
  cut(): void {
    this.close('dropped');
    this.#end('dropped');
  }
  #end(reason: string): void {
    this.#cut = true;
    for (const listener of this.#ends.splice(0)) listener(reason);
  }
}

export type Phone = {
  record: DeviceRecord;
  orgStore: OrgStore;
  identity: DeviceIdentity;
  passkey: SoftwareAuthenticator;
  /** The passkey's gesture, as `assertWith` makes it in the browser: an assertion for the hub's origin. */
  assert: Assert;
  /** The phone's Machine socket to the machine. */
  socket: MachineSocket;
  /** Every carrier the phone dialed, newest last. */
  carriers: Cuttable[];
  /** A channel to the machine through the hub's relay; `wrap` splices something into a carrier's path. */
  open(options?: OpenOptions & { wrap?: (io: ByteDuplex) => ByteDuplex }): Promise<MachineChannel>;
};

export type World = {
  hub: LocalHub;
  admin: Member;
  endpoint: Endpoint;
  services: FakeServices;
  host: FakeEngineHost;
  records: Records;
  ref: string;
  sminos: LaneASminos;
  phone: Phone;
  /** The second member. */
  B: string;
  /** Answers `host.op` in the engine host's place while set (null: the engine host's own commands answer). */
  hostOp: ((input: Record<string, unknown>) => HostResponse | null) | null;
  /** A lane B session owned as `owners` says, its engine session id `engine` (null: not yet prompted). */
  laneB(appSessionId: string, owners?: string[], engine?: string | null): HostSession;
  /** The phone's device taken out of the state, its keys revoked. */
  removePhone(): Promise<SignedOrgState>;
  stop(): Promise<void>;
};

/** Starts the world; a failure on the way stops what was started. */
export async function startWorld(): Promise<World> {
  const stops: Array<() => unknown> = [];
  const stop = async () => {
    for (const run of stops.splice(0).reverse()) {
      try {
        await run();
      } catch (error) {
        console.error('desk-web local endpoint: stopping', error);
      }
    }
  };
  try {
    return await build(stops, stop);
  } catch (error) {
    await stop();
    throw error;
  }
}

async function build(stops: Array<() => unknown>, stop: () => Promise<void>): Promise<World> {
  const hub = await startLocalHub();
  stops.push(() => hub.stop());
  const admin = await hub.admin();
  const B = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const b1 = await newDevice('b1');
  await admin.amend('member B', (s) => void s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] }));

  // The machine: the endpoint module enrolled the v2 way and listed as the owner's.
  const services = fakeServices();
  stops.push(() => services.cleanup());
  const host = new FakeEngineHost();
  host.serve(services);
  const records = new Records();
  const world = { hostOp: null } as Pick<World, 'hostOp'>;
  // The engine host's own op commands over a ledger file of their own, `host.opQuery` included (the fake engine host
  // routes `host.op` alone).
  const ops = opCommands({
    ledger: OpLedger.open(services.machine.stateDir, 'cards-host-ops.jsonl'),
    handler: (name) => (name === 'session.answer' ? (input) => Promise.resolve(answerOn(host, input as { appSessionId: string; requestId: string })) : undefined),
    status: (id) => {
      const s = host.sessions.get(id);
      return s === undefined || s.engineSessionId === null ? null : { launchId: s.launchId, engineSessionId: s.engineSessionId };
    },
    pending: (id, requestId) => pendingOf(host.sessions.get(id), requestId),
  });
  const fake = services.dispatch;
  services.dispatch = async (owner, name, input) => {
    if (owner !== 'engine-host' || (name !== 'host.op' && name !== 'host.opQuery')) return fake(owner, name, input);
    host.calls.push({ name, input });
    const forced = name === 'host.op' ? world.hostOp?.(input as Record<string, unknown>) : null;
    if (forced !== null && forced !== undefined) return forced;
    // The runtime checks every input against the registry before a handler sees it.
    const checked = validateCommandInput(name, input);
    if (!checked.ok) return no('invalid_input');
    return ok(name === 'host.op' ? await ops.op(checked.value as CommandInput<'host.op'>, { client: {} } as HandlerContext) : await ops.opQuery(checked.value as CommandInput<'host.opQuery'>));
  };
  let endpoint: Endpoint | null = null;
  endpoint = createEndpoint({
    build: 'cards-local',
    sleep: (ms) => sleep(Math.min(ms, 50)),
    env: {},
    authorization: { records, checkouts: { known: (path) => endpoint?.rl10.members.known(path) ?? false }, settingsMode: () => 'default' },
  });
  const started = endpoint;
  records.bindLaneA(started.rl10.members);
  await started.start(services);
  stops.push(() => started.stop());
  const issued = await admin.code();
  const enrolling = started.cli('enroll', ['--name', 'mini', '--wait', '30', '--json'], issued.code);
  if ((await admin.awaitPosted(issued.enrollment)) === null) throw new Error('the endpoint posted no key');
  await admin.list(issued.enrollment, issued.k);
  const enrolled = await enrolling;
  if (enrolled.code !== 0) throw new Error(`enroll: ${enrolled.code} ${enrolled.out}`);
  await until(() => started.hub.connected, 'the hub link’s welcome', 30_000);
  const ref = services.machine.ref;

  // sminos on RL10: the owner's lane A session `la-1` (the machine's owners) and B's `la-b`.
  const f = { endpoint: started, services } as unknown as Fixture;
  const s = await sminos(f, [laneAMember(), laneAMember({ session: 'la-b', alias: 'bob', title: 'bob', launch: 'LB', owners: [B] })]);
  const lane = new LaneASminos(s);
  stops.push(() => (lane.stop(), s.close()));
  host.attach(true);

  const phone = await registerPhone(hub, admin, ref);
  stops.push(() => phone.socket.close());

  return Object.assign(world, {
    hub,
    admin,
    endpoint: started,
    services,
    host,
    records,
    ref,
    sminos: lane,
    phone,
    B,
    laneB(appSessionId: string, owners = ['@machine'], engine: string | null = `eng-${appSessionId}`) {
      const session = host.add(appSessionId, engine);
      if (engine !== null) records.set({ lane: 'B', session: engine, owners }, appSessionId);
      return session;
    },
    async removePhone() {
      const head = await admin.head();
      const device = head.state.members.find((m) => m.id === admin.id)?.devices.find((d) => d.id === phone.record.deviceId);
      if (device === undefined) throw new Error('the head lists no phone');
      const revoked = await revokedDevice(admin.id, device);
      const signed = await admin.amend('the phone removed', (st) => {
        const member = st.members.find((m) => m.id === admin.id)!;
        member.devices = member.devices.filter((d) => d.id !== phone.record.deviceId);
        st.revoked.push(...revoked);
      });
      return signed!;
    },
    stop,
  });
}

/** A request still listed among the broker's items (the fake engine host's rule). */
function pendingOf(s: HostSession | undefined, requestId: string) {
  if (s === undefined || !s.items.some((i) => (i.request as { requestId: string }).requestId === requestId)) return null;
  return s.requests.get(requestId) ?? null;
}

/** `session.answer` delivered: the request settles, its item leaving the broker's set. */
function answerOn(host: FakeEngineHost, { appSessionId, requestId }: { appSessionId: string; requestId: string }): { outcome: 'delivered' } {
  const s = host.session(appSessionId);
  host.answered.push(`${appSessionId} ${requestId}`);
  host.setItems(appSessionId, s.items.filter((i) => (i.request as { requestId: string }).requestId !== requestId));
  return { outcome: 'delivered' };
}

/**
 * The phone registered through M3's device controller: a pairing code the owner's Mac would print, the device's keys
 * made (the channel key non-extractable), the entry posted with its MAC under the code's secret, the Mac's approval (the
 * entry judged as `deployment admin pair` judges it, endorsed by the admin device and signed into a successor), and the
 * controller's sync reaching `listed`. Its Machine socket to `ref` signs in as the owner, as the browser's Access cookie
 * does.
 */
async function registerPhone(hub: LocalHub, admin: Member, ref: string): Promise<Phone> {
  const person = hub.person();
  const me = await person.json<Me>('/api/me');
  const head = await admin.head();
  const k = crypto.getRandomValues(new Uint8Array(16));
  const code = encodePairingCode({ hub: hub.url, org: LOCAL_ORG, member: admin.id, roots: head.state.root.keys, recoveryPub: head.state.root.recoveryPub, k: base64urlEncode(k) });
  const origin = new URL(hub.url).origin;
  const rpId = new URL(hub.url).hostname;
  const passkey = new SoftwareAuthenticator(await generateSigningKey(), base64urlEncode(crypto.getRandomValues(new Uint8Array(16))), rpId);
  const source = (since: number) => person.json<OrgStateView>(`${ORG_STATE_PATH}?since=${since}`);
  const orgStore = new OrgStore(LOCAL_ORG, { persistence: memoryOrgPersistence(), source });
  const controller = new DeviceController({
    org: LOCAL_ORG,
    store: memoryDeviceStore(),
    orgStore,
    hub: { orgState: source, postPending: async (request) => (await person.json<{ pending: PendingDevice }>(PENDING_DEVICES_PATH, { body: request }, 201)).pending },
    passkey: async () => passkey.passkey,
    origin,
    rpId,
    view: create<DeviceView>()(() => ({ loaded: false, record: null, fingerprint: null, head: null, refused: null })),
  });
  try {
    await controller.load();
    await controller.register(code, me);
    // The Mac's side: the one entry answering this code, judged and signed in.
    const { pending } = await person.json<{ pending: PendingDevice[] }>(PENDING_DEVICES_PATH);
    const listed = new Set((await admin.head()).state.members.flatMap((m) => m.devices.map((d) => d.id)));
    const answering = [];
    for (const entry of pending) {
      const judged = await judgeEntry(entry, { org: LOCAL_ORG, member: admin.id, k, class: 'web-cards', listed });
      if (judged.ok) answering.push(judged.device);
    }
    if (answering.length !== 1) throw new Error(`${answering.length} entries answered the pairing code`);
    const [device] = answering;
    const endorsement = await endorseDevice(LOCAL_ORG, admin.id, device, admin.device.stepUp.privateKey, admin.device.stepUp.pub);
    await admin.amend('the phone listed', (s) => void s.members.find((m) => m.id === admin.id)!.devices.push({ ...device, endorsement }));
    await until(async () => (await controller.sync()) === 'listed', 'the phone listed', 15_000);
  } finally {
    controller.stop();
  }
  const record = controller.record!;
  const identity = cardsIdentity(LOCAL_ORG, record);
  const headers = person.headers;
  const socket = machineSocket(hub.url, ref, { connect: (url) => new WebSocket(url, { headers } as unknown as string[]), delay: () => 100 });
  const carriers: Cuttable[] = [];
  return {
    record,
    orgStore,
    identity,
    passkey,
    assert: (challenge) => passkey.assert(challenge, origin),
    socket,
    carriers,
    open(options = {}) {
      const { wrap, socket: base = socket, ...rest } = options;
      const dialing: MachineSocket = {
        dial: async () => {
          const carrier = new Cuttable(await base.dial());
          carriers.push(carrier);
          return wrap === undefined ? carrier : wrap(carrier);
        },
        presence: () => base.presence(),
        onPresence: (listener) => base.onPresence(listener),
        close: () => base.close(),
      };
      return openChannel({ ref }, identity, orgStore, { ...rest, socket: dialing });
    },
  };
}

/** `channel`, keeping a copy of each action it sends as it left (for a replay, or another action's assertion). */
export function recording(channel: MachineChannel): { channel: MachineChannel; acts: Action[] } {
  const acts: Action[] = [];
  const recorded: MachineChannel = {
    get id() {
      return channel.id;
    },
    get peer() {
      return channel.peer;
    },
    get closed() {
      return channel.closed;
    },
    get caps() {
      return channel.caps;
    },
    machine: channel.machine,
    send: (message) => {
      if (message.t === 'act') acts.push(structuredClone(message.action as Action));
      return channel.send(message);
    },
    onMessage: (listener) => channel.onMessage(listener),
    onClose: (listener) => channel.onClose(listener),
    close: (reason, stateVersion) => channel.close(reason, stateVersion),
  };
  return { channel: recorded, acts };
}
