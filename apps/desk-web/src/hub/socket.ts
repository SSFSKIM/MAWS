// A hub socket that stays connected: it reconnects with backoff after every close, joins `part` frames into the frame
// they slice (a set begun on a dead connection is dropped with it), and cuts a frame over the bound into parts on the
// way up (DX2's frame bound, which DX3 shares). What a connection means — resuming, re-subscribing — is its owner's.
// Each connect that closes without opening is reported to `access.ts`, which asks whether a lapsed sign-in is why.
import { FRAME_LIMIT, PartAssembler, toWire, type Part } from 'desk-hub/protocol';
import { connectFailed, connectOpened } from './access';

export type ConnectionStatus = 'connecting' | 'open';

/** 0.5 s doubling to 15 s, each delay drawn from its upper half so a deploy's reconnecting browsers spread out. */
export function backoff(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(15_000, 500 * 2 ** attempt);
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

export type HubSocketOptions<Down> = {
  /** Read at every connect, so an owner can change where the next connection goes. */
  url: string | (() => string);
  /** A connection opened: the owner sends what a fresh connection needs. */
  open(): void;
  frame(frame: Down): void;
  status(status: ConnectionStatus): void;
  delay?: (attempt: number) => number;
  frameLimit?: number;
};

export class HubSocket<Down extends { t: string }, Up extends object> {
  private ws: WebSocket | null = null;
  private attempt = 0;
  /** Connects in a row that closed without opening. */
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private last: ConnectionStatus | null = null;

  constructor(private readonly options: HubSocketOptions<Down>) {}

  private status(status: ConnectionStatus): void {
    if (status === this.last) return;
    this.last = status;
    this.options.status(status);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  /** Sends on the open connection; false when there is none (the owner sends again on the next `open`). */
  send(frame: Up): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    for (const text of toWire(frame, this.options.frameLimit ?? FRAME_LIMIT)) ws.send(text);
    return true;
  }

  /** A returning page needs current state, not the old socket's buffered stream or its close handshake. */
  restart(): void {
    if (this.stopped) return;
    const old = this.ws;
    this.ws = null; // Fence already queued events before closing a possibly half-open connection.
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    old?.close();
    this.attempt = 0;
    this.connect();
  }

  private connect(): void {
    this.status('connecting');
    const { url } = this.options;
    const ws = new WebSocket(typeof url === 'string' ? url : url());
    const assembler = new PartAssembler();
    let opened = false;
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      opened = true;
      this.failures = 0;
      connectOpened();
      this.status('open');
      this.options.open();
    };
    ws.onmessage = (message) => {
      if (this.ws !== ws) return;
      this.attempt = 0; // the hub answered: the next drop starts the backoff over
      let frame: Down | Part;
      try {
        frame = JSON.parse(String(message.data)) as Down | Part;
        if (frame.t === 'part') {
          const whole = assembler.add(frame as Part);
          if (whole === undefined) return;
          frame = whole as Down;
        }
      } catch {
        ws.close(); // a frame that is not one: start over on a fresh connection
        return;
      }
      this.options.frame(frame as Down);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      if (!opened) connectFailed(++this.failures);
      this.status('connecting');
      const delay = (this.options.delay ?? backoff)(this.attempt);
      this.attempt++;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.stopped) this.connect();
      }, delay);
    };
  }
}
