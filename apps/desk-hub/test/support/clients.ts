// Clients for the suites, speaking the hub's protocols through the stand-in as DC4's daemon and DC5's web app will: a
// machine (DX2: its SSE stream down, NDJSON POSTs up, a mirror of each project's log) and a browser (DX3: a project's
// WebSocket). Each keeps every frame it received, in order, and waits for the one a test names.
import type { GridDown, ProjectDown, ProjectUp } from '../../src/protocol/browser';
import type { ProvisioningKeyIssued, ProvisioningKeyRecord, ProvisioningKeyRequest } from '../../src/protocol/identity';
import type { LogEvent, Vector } from '../../src/protocol/log';
import type { DownFrame, UpFrame } from '../../src/protocol/machine';
import { GENERATION_HEADER } from '../../src/protocol/machine';
import { PartAssembler } from '../../src/protocol/parts';
import { credentials, type LocalHub, type Who } from './local';

export type Credentials = { clientId: string; clientSecret: string };

/** Waits until `predicate` holds over `frames`, polling; throws with what arrived when it does not within `ms`. */
async function until<T>(frames: T[], predicate: (frame: T) => boolean, ms: number, what: string, from = 0): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = frames.slice(from).find(predicate);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms; received ${JSON.stringify(frames.slice(-8))}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Asks the hub for a one-time token as `admin` and redeems it for `machine`; the machine's service token. */
export async function enroll(hub: LocalHub, admin: string, machine: string): Promise<Credentials> {
  const token = await enrollmentToken(hub, admin);
  const response = await hub.fetchAs(null, '/machine/enroll', { body: { token, machine } });
  if (response.status !== 200) throw new Error(`redeem ${machine}: ${response.status} ${await response.text()}`);
  const body = (await response.json()) as { client_id: string; client_secret: string };
  return { clientId: body.client_id, clientSecret: body.client_secret };
}

export async function enrollmentToken(hub: LocalHub, admin: string, ttl_s?: number): Promise<string> {
  const response = await hub.fetchAs(admin, '/api/enrollments', { body: ttl_s === undefined ? {} : { ttl_s } });
  if (response.status !== 201) throw new Error(`enrollment: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { token: string }).token;
}

/** A provisioning key made by `admin`: its record and its secret, shown this once. */
export async function provisioningKey(
  hub: LocalHub,
  admin: string,
  request: ProvisioningKeyRequest,
): Promise<{ id: string; token: string; key: ProvisioningKeyRecord }> {
  const response = await hub.fetchAs(admin, '/api/provisioning-keys', { body: request });
  if (response.status !== 201) throw new Error(`provisioning key: ${response.status} ${await response.text()}`);
  const issued = (await response.json()) as ProvisioningKeyIssued;
  return { id: issued.key.id, token: issued.token, key: issued.key };
}

/** Redeems a provisioning key's secret for `machine`; the machine's service token. */
export async function enrollThrough(hub: LocalHub, token: string, machine: string): Promise<Credentials> {
  const response = await hub.fetchAs(null, '/machine/enroll', { body: { token, machine } });
  if (response.status !== 200) throw new Error(`redeem ${machine} through a key: ${response.status} ${await response.text()}`);
  const body = (await response.json()) as { client_id: string; client_secret: string };
  return { clientId: body.client_id, clientSecret: body.client_secret };
}

/** A machine's connection, with a mirror of each project's log as the daemon keeps one (one feed per writer). */
export class MachineClient {
  readonly frames: DownFrame[] = [];
  readonly log = new Map<string, Map<string, Map<number, LogEvent>>>();
  generation = 0;
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private ended = false;

  constructor(
    private readonly hub: LocalHub,
    readonly name: string,
    readonly creds: Credentials,
  ) {}

  /** Opens the stream and waits for its welcome. */
  async connect(): Promise<void> {
    const response = await fetch(`${this.hub.url}/machine/stream`, { headers: credentials(this.creds) });
    if (response.status !== 200) throw new Error(`stream: ${response.status} ${await response.text()}`);
    this.ended = false;
    const from = this.frames.length;
    this.reader = response.body!.getReader();
    void this.pump(this.reader);
    const welcome = await this.next((f) => f.t === 'welcome', 'welcome', from);
    this.generation = (welcome as Extract<DownFrame, { t: 'welcome' }>).generation;
  }

  private async pump(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = /^data: (.*)$/m.exec(block);
          if (data) this.receive(JSON.parse(data[1]) as DownFrame);
        }
      }
    } catch {
      // the stream was cut
    }
    if (this.reader === reader) this.ended = true;
  }

  private receive(frame: DownFrame) {
    this.frames.push(frame);
    if (frame.t === 'events') for (const event of frame.events) this.store(frame.project, event);
    // The daemon answers every heartbeat: the only traffic that keeps its lease.
    if (frame.t === 'hb' && this.autoAck) void this.post([{ t: 'hb-ack', generation: this.generation, at: frame.at }]).then((r) => r.arrayBuffer()).catch(() => {});
  }

  /** Whether heartbeats are answered (a suspended daemon's are not). */
  autoAck = true;

  /** Inserts into the mirror, idempotent on (writer, seq), as the daemon's import is. */
  store(project: string, event: LogEvent) {
    let feeds = this.log.get(project);
    if (!feeds) this.log.set(project, (feeds = new Map()));
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

  get isEnded() {
    return this.ended;
  }

  async post(frames: UpFrame[], generation = this.generation): Promise<Response> {
    return fetch(`${this.hub.url}/machine/frames`, {
      method: 'POST',
      headers: { ...credentials(this.creds), 'content-type': 'application/x-ndjson', [GENERATION_HEADER]: String(generation) },
      body: frames.map((frame) => JSON.stringify(frame)).join('\n'),
    });
  }

  async postOk(frames: UpFrame[]): Promise<void> {
    const response = await this.post(frames);
    if (response.status !== 200) throw new Error(`post: ${response.status} ${await response.text()}`);
  }

  /** The handshake: `hello`, the hub's `have`, then the machine's own suffix uploaded. Returns the `have`. */
  async sync(project: string, name = 'demo'): Promise<Extract<DownFrame, { t: 'have' }>> {
    const from = this.frames.length;
    await this.postOk([{ t: 'hello', project, name, have: this.vector(project) }]);
    const have = (await this.next((f) => f.t === 'have' && f.project === project, 'have', from)) as Extract<DownFrame, { t: 'have' }>;
    const suffix = this.ownSuffix(project, have.have);
    if (suffix.length) await this.postOk([{ t: 'events', project, events: suffix }]);
    return have;
  }

  next(predicate: (frame: DownFrame) => boolean, what = 'frame', from = 0, ms = 5000): Promise<DownFrame> {
    return until(this.frames, predicate, ms, `${what} for ${this.name}`, from);
  }

  /** Waits until the mirror's vector for `project` equals `vector`. */
  async reaches(project: string, vector: Vector, ms = 5000): Promise<void> {
    const deadline = Date.now() + ms;
    while (JSON.stringify(sorted(this.vector(project))) !== JSON.stringify(sorted(vector))) {
      if (Date.now() > deadline) throw new Error(`${this.name} at ${JSON.stringify(this.vector(project))}, not ${JSON.stringify(vector)}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async close(): Promise<void> {
    const reader = this.reader;
    this.reader = undefined;
    await reader?.cancel().catch(() => {});
  }
}

export function sorted(vector: Vector): Vector {
  return Object.fromEntries(Object.entries(vector).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** A browser's project socket. It follows a paged resume as DX3 has a browser do: each `more {offset}` is answered with
 * `resume {after: offset}`, unless `followMore` is off (a suite that drives the pages itself). */
export class BrowserClient {
  readonly frames: ProjectDown[] = [];
  private socket!: WebSocket;
  closed = false;
  followMore = true;

  private constructor(readonly who: Who) {}

  static async open(hub: LocalHub, who: Who, project: string): Promise<BrowserClient> {
    const client = new BrowserClient(who);
    const socket = new WebSocket(`${hub.url.replace('http', 'ws')}/api/projects/${project}/socket`, { headers: credentials(who) } as unknown as string[]);
    client.socket = socket;
    socket.addEventListener('message', (event) => {
      const frame = JSON.parse(String(event.data)) as ProjectDown;
      client.frames.push(frame);
      if (frame.t === 'more' && client.followMore) client.send({ t: 'resume', after: frame.offset });
    });
    socket.addEventListener('close', () => (client.closed = true));
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error(`socket to ${project} refused`)));
    });
    await client.next((f) => f.t === 'welcome', 'welcome');
    return client;
  }

  send(frame: ProjectUp) {
    this.socket.send(JSON.stringify(frame));
  }

  next(predicate: (frame: ProjectDown) => boolean, what = 'frame', from = 0, ms = 5000): Promise<ProjectDown> {
    return until(this.frames, predicate, ms, what, from);
  }

  /** Every log event received, by offset. */
  get logged(): Array<{ offset: number; event: LogEvent }> {
    return this.frames.flatMap((f) => (f.t === 'log' ? f.events : []));
  }

  close() {
    this.socket.close(1000, 'done');
  }
}

/** Polls `probe` until it answers something other than undefined; throws when it has not within `ms`. */
export async function waitFor<T>(probe: () => T | undefined | Promise<T | undefined>, ms = 5000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** A member's grid socket (DX3's registry socket), joining a grid sent as parts. */
export class GridClient {
  readonly frames: GridDown[] = [];
  /** The size in bytes of every message the socket carried, parts included. */
  readonly wire: number[] = [];
  private readonly parts = new PartAssembler();
  private socket!: WebSocket;
  static async open(hub: LocalHub, who: string): Promise<GridClient> {
    const client = new GridClient();
    client.socket = new WebSocket(`${hub.url.replace('http', 'ws')}/api/registry/socket`, { headers: { 'x-desk-standin-user': who } } as unknown as string[]);
    client.socket.addEventListener('message', (event) => {
      const text = String(event.data);
      client.wire.push(Buffer.byteLength(text));
      const frame = JSON.parse(text) as GridDown;
      if (frame.t !== 'part') return void client.frames.push(frame);
      const whole = client.parts.add(frame);
      if (whole !== undefined) client.frames.push(whole as GridDown);
    });
    await new Promise<void>((resolve, reject) => {
      client.socket.addEventListener('open', () => resolve());
      client.socket.addEventListener('error', () => reject(new Error('grid socket refused')));
    });
    await waitFor(() => (client.frames.length > 0 ? true : undefined), 15_000);
    return client;
  }
  next(predicate: (frame: GridClient['frames'][number]) => boolean, what: string) {
    return waitFor(() => this.frames.find(predicate), 5000).catch(() => {
      throw new Error(`no ${what}; got ${JSON.stringify(this.frames.slice(-5))}`);
    });
  }
  close() {
    this.socket.close(1000, 'done');
  }
}

/** A refusal as a machine reads it (§6 of the provisioning-keys spec): `<status> access` for Access's denial (401 with
 * its HTML page naming `Cloudflare Access`), else `<status> <the JSON error>` (the Worker's), else the status and text. */
export async function refusal(response: Response): Promise<string> {
  const text = await response.text();
  if ((response.headers.get('content-type') ?? '').startsWith('text/html') && text.includes('Cloudflare Access')) return `${response.status} access`;
  try {
    return `${response.status} ${(JSON.parse(text) as { error: string }).error}`;
  } catch {
    return `${response.status} ${text.slice(0, 80)}`;
  }
}
