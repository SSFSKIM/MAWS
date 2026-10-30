// Machines on RL1 for the suites that drive the log plane, which RL1 carries alone since O14 M5b took DX2's stream
// out of the hub: an org rooted by the admin's device, its machines enrolled the v2 way and listed in the state, each
// with its endpoint socket (`FakeEndpoint`) and a mirror of each project's log as the daemon keeps one (one feed per
// writer), as DX2's test client kept it.
import { base64urlEncode, generateSigningKey, keyId, type SignedOrgState, type SigningKey } from 'org-protocol';
import { FakeEndpoint } from '../../fake-machine/endpoint';
import { enrollV2, type V2Machine } from '../../fake-machine/org';
import { encodeEnrollmentCodeV2 } from '../../src/protocol/identity';
import type { LogEvent, Vector } from '../../src/protocol/log';
import type { DownFrame, UpFrame } from '../../src/protocol/machine';
import { sorted } from './clients';
import { ADMIN, ORG, type LocalHub } from './local';
import { genesis, newDevice, next, signedBy, type TestDevice } from './org';

/** The org of a suite's hub, rooted by the admin's one device: it signs the states that list the suite's machines. */
export class TestOrg {
  private constructor(
    readonly hub: LocalHub,
    /** The admin's member id. */
    readonly admin: string,
    readonly device: TestDevice,
    readonly recovery: SigningKey,
    public head: SignedOrgState,
  ) {}

  /** Roots the hub's org: a genesis of its configured admin, whose device is the root. */
  static async root(hub: LocalHub): Promise<TestOrg> {
    const admin = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
    const device = await newDevice('admin-device');
    const recovery = await generateSigningKey();
    const head = await signedBy(await genesis(ORG, admin, ADMIN, device, recovery), device);
    const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: head });
    if (response.status !== 201) throw new Error(`genesis: ${response.status} ${await response.text()}`);
    return new TestOrg(hub, admin, device, recovery, head);
  }

  /** A suite's org rooted its own way, at its current head; the suite reads `head` back after a change made here. */
  static of(hub: LocalHub, admin: string, device: TestDevice, recovery: SigningKey, head: SignedOrgState): TestOrg {
    return new TestOrg(hub, admin, device, recovery, head);
  }

  /** The head's successor, changed by `edit`, accepted by the hub. */
  async accept(edit: Parameters<typeof next>[1]): Promise<void> {
    const state = await signedBy(await next(this.head, edit), this.device);
    const response = await this.hub.fetchAs(ADMIN, '/api/org/state', { body: state });
    if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
    this.head = state;
  }

  /** A machine enrolled the v2 way under `name`, its key posted; not listed. */
  async enroll(name: string): Promise<V2Machine> {
    const response = await this.hub.fetchAs(ADMIN, '/api/enrollments', { body: {} });
    if (response.status !== 201) throw new Error(`enrollment: ${response.status} ${await response.text()}`);
    const { token } = (await response.json()) as { token: string };
    const k = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    return enrollV2(encodeEnrollmentCodeV2({ hub: this.hub.url, token, roots: [await keyId(this.device.stepUp!.pub)], recoveryPub: this.recovery.pub, k }), name);
  }

  /** A machine enrolled the v2 way and listed in the state, as RL1 needs. */
  async listed(name: string): Promise<V2Machine> {
    const machine = await this.enroll(name);
    await this.accept((s) => {
      s.machines.push({ name, ref: machine.ref, pub: machine.key.pub, owners: [this.admin] });
      s.machineNames.push({ name, ref: machine.ref });
    });
    return machine;
  }

  /** A listed machine on RL1, its endpoint socket open. */
  async machine(name: string): Promise<Rl1Machine> {
    const machine = new Rl1Machine(this.hub, await this.listed(name));
    await machine.connect();
    return machine;
  }
}

/** A listed machine's endpoint, with a mirror of each project's log as the daemon keeps it. */
export class Rl1Machine {
  readonly endpoint: FakeEndpoint;
  private readonly mirror = new Map<string, Map<string, Map<number, LogEvent>>>();
  /** How many of the endpoint's frames the mirror has taken in. */
  private taken = 0;

  constructor(
    hub: LocalHub,
    readonly machine: V2Machine,
  ) {
    this.endpoint = new FakeEndpoint({ hub: hub.url, credentials: machine.credentials, ref: machine.ref });
  }

  get name(): string {
    return this.machine.name;
  }

  get creds(): V2Machine['credentials'] {
    return this.machine.credentials;
  }

  /** Every frame the hub sent the endpoint, in order: RL1's own and the log plane's. */
  get frames(): DownFrame[] {
    return this.endpoint.frames as unknown as DownFrame[];
  }

  get generation(): number {
    return this.endpoint.generation;
  }

  /** Whether heartbeats are sent (a suspended endpoint's are not): the only traffic that keeps its lease. */
  set heartbeats(on: boolean) {
    this.endpoint.heartbeats = on;
  }

  async connect(): Promise<void> {
    await this.endpoint.connect();
  }

  /** Each frame up, in order, on the socket. */
  send(frames: UpFrame[]): void {
    for (const frame of frames) this.endpoint.sendText(frame);
  }

  /** Each project's log as the machine holds it: what it wrote (`store`) and every event the hub sent it. */
  get log(): Map<string, Map<string, Map<number, LogEvent>>> {
    const frames = this.endpoint.frames;
    for (; this.taken < frames.length; this.taken++) {
      const frame = frames[this.taken] as unknown as DownFrame;
      if (frame.t === 'events') for (const event of frame.events) this.store(frame.project, event);
    }
    return this.mirror;
  }

  /** Inserts into the mirror, idempotent on (writer, seq), as the daemon's import is. */
  store(project: string, event: LogEvent): void {
    let feeds = this.mirror.get(project);
    if (!feeds) this.mirror.set(project, (feeds = new Map()));
    let feed = feeds.get(event.writer);
    if (!feed) feeds.set(event.writer, (feed = new Map()));
    feed.set(event.seq, event);
  }

  vector(project: string): Vector {
    const out: Vector = {};
    for (const [writer, feed] of this.log.get(project) ?? []) out[writer] = Math.max(...feed.keys());
    return out;
  }

  /** The machine's own writers' events the hub lacks, as the daemon uploads them. */
  ownSuffix(project: string, have: Vector): LogEvent[] {
    const out: LogEvent[] = [];
    for (const [writer, feed] of this.log.get(project) ?? []) {
      if (!writer.startsWith(`${this.name}/`)) continue;
      for (const seq of [...feed.keys()].sort((a, b) => a - b)) if (seq > (have[writer] ?? 0)) out.push(feed.get(seq)!);
    }
    return out;
  }

  /** The handshake: `hello`, the hub's `have`, then the machine's own suffix uploaded. Returns the `have`. */
  async sync(project: string, name = 'demo'): Promise<Extract<DownFrame, { t: 'have' }>> {
    const have = await this.endpoint.project(project, name, () => this.vector(project));
    const suffix = this.ownSuffix(project, have.have);
    if (suffix.length) this.endpoint.upload(project, suffix);
    return have;
  }

  /** The hub's vector for `project` once every frame sent before it is applied: a `hello`'s `have` is answered in the
   * project's frame order, after them. */
  async settled(project: string, name = 'demo'): Promise<Vector> {
    const from = this.frames.length;
    this.send([{ t: 'hello', project, name, have: this.vector(project) }]);
    return ((await this.next((f) => f.t === 'have' && f.project === project, 'the settling have', from)) as Extract<DownFrame, { t: 'have' }>).have;
  }

  async next(predicate: (frame: DownFrame) => boolean, what = 'frame', from = 0, ms = 5000): Promise<DownFrame> {
    return (await this.endpoint.next((f) => predicate(f as unknown as DownFrame), `${what} for ${this.name}`, from, ms)) as unknown as DownFrame;
  }

  /** Waits until the mirror's vector for `project` equals `vector`. */
  async reaches(project: string, vector: Vector, ms = 5000): Promise<void> {
    const deadline = Date.now() + ms;
    while (JSON.stringify(sorted(this.vector(project))) !== JSON.stringify(sorted(vector))) {
      if (Date.now() > deadline) throw new Error(`${this.name} at ${JSON.stringify(this.vector(project))}, not ${JSON.stringify(vector)}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** Drops the socket from this side, as an endpoint that went away; `connect` opens it again. */
  drop(): void {
    this.endpoint.drop(1000, 'dropped');
  }

  close(): void {
    this.endpoint.close();
  }
}
