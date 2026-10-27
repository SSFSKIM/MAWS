// Clients for the deployed hub, as its parties meet it through Access: a person (an Access app token, which
// `cloudflared access login` stores and `cloudflared access token` prints, carried as `cf-access-token` the way a
// browser carries its cookie), a machine (its service token), and the enrollment that joins the two. The deployment's
// commands (probe, redeploy-check, measure) are built on these.
import { randomBytes } from 'node:crypto';
import { base64urlEncode } from '../src/protocol/base64url';
import { encodeEnrollmentCode, type EnrollmentIssued, type Redeemed } from '../src/protocol/identity';
import { Link, type Credentials } from '../fake-machine/link';
import type { DownFrame } from '../src/protocol/machine';
import { PartAssembler, type Part } from '../src/protocol/parts';
import { cfApi } from './access';

export class Person {
  constructor(
    readonly hub: string,
    private readonly token: string,
    /** Called before each request, which it refuses by throwing: an interrupted run's (proof.ts, `Cleanup.check`). */
    private readonly gate: () => void = () => {},
  ) {}

  get headers(): Record<string, string> {
    return { 'cf-access-token': this.token };
  }

  /** A request as this person; `signal` ends it, its body's reading included. */
  async fetch(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<Response> {
    this.gate();
    return fetch(`${this.hub}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { ...this.headers, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'manual',
      signal: init.signal,
    });
  }

  async json<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}, status = 200): Promise<T> {
    const response = await this.fetch(path, init);
    const text = await response.text();
    if (response.status !== status) throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status} ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  }

  /** A one-time enrollment token (an admin's). */
  async enrollmentToken(ttl_s = 600): Promise<string> {
    return (await this.json<EnrollmentIssued>('/api/enrollments', { body: { ttl_s } }, 201)).token;
  }

  /** A WebSocket with this person's Access session; resolves once it is open. */
  async socket(path: string): Promise<Socket> {
    this.gate();
    return Socket.open(`${this.hub.replace(/^http/, 'ws')}${path}`, this.headers);
  }
}

/** A WebSocket that keeps every frame it received, joining `part` sets, each frame stamped with its arrival; it follows a
 * paged resume (DX3 `more`). */
export class Socket {
  readonly frames: Array<{ at: number; frame: { t: string } & Record<string, unknown> }> = [];
  closed = false;
  onFrame: ((frame: { t: string } & Record<string, unknown>, at: number) => void) | undefined;
  private parts = new PartAssembler();

  private constructor(private readonly ws: WebSocket) {}

  static open(url: string, headers: Record<string, string>): Promise<Socket> {
    // Node's WebSocket (undici) takes headers in place of the protocols argument.
    const ws = new WebSocket(url, { headers } as unknown as string[]);
    const socket = new Socket(ws);
    ws.addEventListener('message', (event) => {
      const at = Date.now();
      let frame = JSON.parse(String(event.data)) as { t: string } & Record<string, unknown>;
      if (frame.t === 'part') {
        const whole = socket.parts.add(frame as unknown as Part);
        if (whole === undefined) return;
        frame = whole as typeof frame;
      }
      socket.frames.push({ at, frame });
      // A paged resume (DX3): the next page is asked for as each one ends.
      if (frame.t === 'more') socket.send({ t: 'resume', after: frame.offset });
      socket.onFrame?.(frame, at);
    });
    ws.addEventListener('close', () => (socket.closed = true));
    return new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(socket));
      ws.addEventListener('error', () => reject(new Error(`the socket to ${url} was refused`)));
    });
  }

  send(frame: object): void {
    this.ws.send(JSON.stringify(frame));
  }

  async next(predicate: (frame: { t: string } & Record<string, unknown>) => boolean, what: string, ms = 15_000, from = 0) {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = this.frames.slice(from).find((f) => predicate(f.frame));
      if (found) return found.frame;
      if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
      await sleep(20);
    }
  }

  close(): void {
    this.ws.close(1000, 'done');
  }
}

/** How long a stop waits for a pending open, from the first stop: the bound redeploy-check's cleanup holds its steps to. */
export const STOP_WAIT_MS = 15_000;

/**
 * A browser's project socket that reopens after a cut until it is stopped. `open` tries until a socket opens or `stop`
 * is called; `stop` ends the loop, waits for it to settle, and closes the socket, closing one that opens too late. A
 * connection still opening is waited for until `waitMs` after the first stop, and no longer by any later stop: past
 * that, the stopped loop closes its socket when it opens.
 */
export class LogFollower {
  socket: Socket | undefined;
  private stopped = false;
  private opening: Promise<void> | null = null;
  /** When the stops stop waiting for a pending open: set by the first. */
  private abandonAt: number | undefined;

  constructor(
    private readonly person: Pick<Person, 'socket'>,
    private readonly path: string,
    /** Called with each socket that opens, before it is the follower's: set its handlers, resume, resend. */
    private readonly onOpen: (socket: Socket) => void,
    private readonly retryMs = 1000,
  ) {}

  open(): Promise<void> {
    return (this.opening ??= this.loop().finally(() => (this.opening = null)));
  }

  async stop(waitMs = STOP_WAIT_MS): Promise<void> {
    this.stopped = true;
    this.abandonAt ??= Date.now() + waitMs;
    if (this.opening) await settledWithin(this.opening, this.abandonAt - Date.now());
    this.socket?.close();
    this.socket = undefined;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        const socket = await this.person.socket(this.path);
        if (this.stopped) return socket.close();
        this.onOpen(socket);
        this.socket = socket;
        return;
      } catch {
        if (!this.stopped) await sleep(this.retryMs);
      }
    }
  }
}

/** Redeems a token for a machine name at the redeem path, which takes no Access session. */
export async function redeem(hub: string, token: string, machine: string): Promise<Response> {
  return fetch(`${hub}/machine/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, machine }) });
}

/** Enrolls a machine as an admin and the machine together would: the service token it is issued. */
export async function enroll(person: Person, machine: string): Promise<Credentials> {
  const response = await redeem(person.hub, await person.enrollmentToken(), machine);
  const text = await response.text();
  if (response.status !== 200) throw new Error(`redeem ${machine}: ${response.status} ${text}`);
  const body = JSON.parse(text) as Redeemed;
  return { clientId: body.client_id, clientSecret: body.client_secret };
}

/** An enrollment code as the web app builds it: the hub never sees `key`. */
export function enrollmentCode(hub: string, org: string, token: string, machine: string, key: Uint8Array): string {
  return encodeEnrollmentCode({ hub, org, token, machine, key: base64urlEncode(key) });
}

export const newOrgKey = (): Uint8Array => new Uint8Array(randomBytes(32));

/**
 * A machine's link that keeps its down frames. A freshly minted service token takes a few seconds to reach Access's
 * edge, which refuses it (401) meanwhile, so the first connect retries a 401 for up to `admitMs`.
 */
export async function machineLink(hub: string, credentials: Credentials, admitMs = 60_000): Promise<{ link: Link; frames: DownFrame[] }> {
  const frames: DownFrame[] = [];
  const link = new Link(hub, credentials, (frame) => frames.push(frame), () => {});
  const deadline = Date.now() + admitMs;
  for (;;) {
    try {
      await link.connect();
      return { link, frames };
    } catch (error) {
      if (!(error instanceof Error && 'status' in error && error.status === 401) || Date.now() > deadline) throw error;
      await sleep(2000);
    }
  }
}

/** The account's Access service tokens, as the hub's own API token reaches them: a throwaway minted and deleted. */
export function serviceTokenApi(token: string, account: string) {
  const api = cfApi(token, account);
  type Token = { id: string; name: string; client_id: string; client_secret?: string };
  return {
    create: (name: string) => api.request<Token & { client_secret: string }>('POST', '/access/service_tokens', { name, duration: '8760h' }),
    delete: (id: string) => api.request('DELETE', `/access/service_tokens/${id}`),
    named: async (name: string) => (await api.request<Token[]>('GET', `/access/service_tokens?name=${encodeURIComponent(name)}`)).filter((t) => t.name === name),
    all: () => api.request<Token[]>('GET', '/access/service_tokens?per_page=1000'),
  };
}

export async function until<T>(read: () => T | undefined, what: string, ms = 15_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(20);
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for `promise` to settle, at most `ms`, leaving no timer behind. */
export async function settledWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  if (ms <= 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = promise.then(
    () => undefined,
    () => undefined,
  );
  await Promise.race([settled, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
}
