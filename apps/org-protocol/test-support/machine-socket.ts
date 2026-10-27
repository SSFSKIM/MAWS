// The app's Machine socket (O11 M6; the reference client's since M7), `/api/machines/<ref or name>/socket`: it opens
// channels through the hub, sends their data, and keeps what each received, in order. The bytes are whatever the caller
// gives: RL2's sealed frames are O10's, and the hub cannot tell random bytes from them.
import { closeReasonName, decodeChannelFrame, encodeChannelFrame, openTag, CHANNEL_CLOSE, type ChannelCloseReason, type RelayPresence } from '../src/relay.ts';
import { newSocket, opened, socketUrl } from './socket.ts';

export const machineSocketPath = (machine: string) => `/api/machines/${encodeURIComponent(machine)}/socket`;

export class RelayApp {
  /** Each channel's data received, in order, kept while the channel is open and after. */
  readonly received = new Map<number, Uint8Array[]>();
  /** Each channel's close as it came, in order. */
  readonly closes: Array<{ channel: number; reason: ChannelCloseReason | null }> = [];
  /** The hub's presence frames, in order. */
  readonly presence: RelayPresence[] = [];
  /** How many `pong`s answered its pings. */
  pongs = 0;
  /** How the socket closed, once it has. */
  ended: { code: number; reason: string } | undefined;
  private readonly answers = new Map<number, (channel: number) => void>();
  private nextTag = 1;
  /** Called with each data payload as it arrives (the measurement's clock). */
  onData: ((channel: number, payload: Uint8Array) => void) | undefined;

  private readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
  }

  /** Opens the socket with `headers` (a member's Access credentials) and resolves once it is open (`openMs` at most; an
   * upgrade unanswered past it fails the opening). */
  static async open(hub: string, machine: string, headers: Record<string, string>, openMs = 10_000): Promise<RelayApp> {
    const socket = newSocket(socketUrl(hub, machineSocketPath(machine)), headers);
    const app = new RelayApp(socket);
    socket.addEventListener('message', (event) => app.receive(event.data as string | ArrayBuffer));
    socket.addEventListener('close', (event) => (app.ended = { code: event.code, reason: event.reason }));
    await opened(socket, `Machine ${machine}`, openMs);
    return app;
  }

  private receive(data: string | ArrayBuffer): void {
    if (typeof data === 'string') {
      if (data === 'pong') return void this.pongs++;
      const frame = JSON.parse(data) as { t?: string };
      if (frame.t === 'presence') this.presence.push(frame as RelayPresence);
      return;
    }
    const frame = decodeChannelFrame(data);
    if (!frame) return;
    if (frame.type === 'open') {
      const tag = openTag(frame.payload);
      const answer = tag === null ? undefined : this.answers.get(tag);
      if (tag !== null) this.answers.delete(tag);
      this.received.set(frame.channel, []);
      answer?.(frame.channel);
      return;
    }
    if (frame.type === 'close') {
      this.closes.push({ channel: frame.channel, reason: closeReasonName(frame.payload) });
      return;
    }
    const payload = frame.payload.slice();
    this.received.get(frame.channel)?.push(payload);
    this.onData?.(frame.channel, payload);
  }

  /** Opens a channel, `payload` its first bytes to the endpoint, and resolves with the id the hub assigned. A refused
   * open resolves too, and its close follows at once (`closes`). */
  openChannel(payload: Uint8Array = new Uint8Array(0)): Promise<number> {
    const tag = this.nextTag++;
    const assigned = new Promise<number>((resolve) => this.answers.set(tag, resolve));
    this.socket.send(encodeChannelFrame('open', tag, payload));
    return assigned;
  }

  send(channel: number, payload: Uint8Array): void {
    this.socket.send(encodeChannelFrame('data', channel, payload));
  }

  /** Sends a message as given, framed or not (the suites' oversized one). */
  sendRaw(message: Uint8Array | string): void {
    this.socket.send(message);
  }

  closeChannel(channel: number, reason: ChannelCloseReason = 'closed'): void {
    this.socket.send(encodeChannelFrame('close', channel, CHANNEL_CLOSE[reason]));
  }

  ping(): void {
    this.socket.send('ping');
  }

  close(): void {
    this.socket.close(1000, 'done');
  }

  /** Waits until `probe` answers something other than undefined. */
  async until<T>(probe: () => T | undefined, what: string, ms = 10_000): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
      const value = probe();
      if (value !== undefined) return value;
      if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

/** What an echo check measured. */
export type EchoCheck = { channel: number; frames: number; bytes: number; ms: number };

/** The payloads an echo check sends: `count` frames from 1 B to `maxBytes`, the first and last at the two bounds and
 * the rest skewed small, each filled from its index so a reordered or altered one cannot match. */
export function echoPayloads(count: number, maxBytes = 256 * 1024): Uint8Array[] {
  return Array.from({ length: count }, (_, i) => {
    const size = i === 0 ? 1 : i === count - 1 ? maxBytes : 1 + Math.floor(Math.random() ** 3 * maxBytes);
    const out = new Uint8Array(size);
    for (let j = 0; j < size; j++) out[j] = (i * 31 + j * 7) & 0xff;
    return out;
  });
}

/**
 * Acceptance 3's frames through an echoing endpoint (`FakeEndpoint`'s default): opens a channel, sends `payloads` on it
 * back to back, and resolves once each came back byte-identical and in order; throws on the first that did not, or
 * when they have not all come back within `ms`.
 */
export async function echoCheck(app: RelayApp, payloads: Uint8Array[], ms = 120_000): Promise<EchoCheck> {
  const channel = await app.openChannel();
  const started = Date.now();
  for (const payload of payloads) app.send(channel, payload);
  await app.until(() => {
    if (app.closes.some((c) => c.channel === channel)) throw new Error(`channel ${channel} closed: ${app.closes.find((c) => c.channel === channel)!.reason}`);
    return (app.received.get(channel)?.length ?? 0) >= payloads.length ? true : undefined;
  }, `${payloads.length} echoes`, ms);
  const back = app.received.get(channel)!;
  for (const [i, payload] of payloads.entries()) {
    const echoed = back[i];
    if (echoed.length !== payload.length || echoed.some((byte, j) => byte !== payload[j])) throw new Error(`frame ${i} (${payload.length} B) came back altered or out of order`);
  }
  app.closeChannel(channel);
  return { channel, frames: payloads.length, bytes: payloads.reduce((sum, p) => sum + p.length, 0), ms: Date.now() - started };
}
