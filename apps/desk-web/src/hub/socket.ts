// A hub socket that stays connected: it reconnects with backoff after every close, joins `part` frames into the frame
// they slice (a set begun on a dead connection is dropped with it), and cuts a frame over the bound into parts on the
// way up (DX2's frame bound, which DX3 shares). What a connection means — resuming, re-subscribing — is its owner's.
import { FRAME_LIMIT, PartAssembler, toWire, type Part } from 'desk-hub/protocol';

export type ConnectionStatus = 'connecting' | 'open';

/** 0.5 s doubling to 15 s, each delay drawn from its upper half so a deploy's reconnecting browsers spread out. */
export function backoff(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(15_000, 500 * 2 ** attempt);
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

export type HubSocketOptions<Down> = {
  url: string;
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

  /** Drops the connection and connects again, as a close from the hub would. */
  restart(): void {
    this.ws?.close();
  }

  private connect(): void {
    this.status('connecting');
    const ws = new WebSocket(this.options.url);
    const assembler = new PartAssembler();
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
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
