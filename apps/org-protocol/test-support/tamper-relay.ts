// In-memory carriers for RL2's suites: `duplexPair`, two ends of one message-oriented link, and `TamperRelay`, a
// hostile relay in the channel's path (acceptance 3) that flips a byte, drops, repeats or reorders a message, or holds
// one for a given time. Each message is delivered on a later turn, in order, as a socket delivers it; a close reaches
// the other end after every message sent before it. A link's turns are timer turns by default, or microtasks
// (`turns: 'microtask'`), which leave the receiver's own asynchronous work no room to finish between two deliveries. WebCrypto-free and runtime-neutral, though only suites use it.
import type { ByteDuplex } from '../src/channel.ts';

type End = {
  bytes: Array<(bytes: Uint8Array) => void>;
  close: Array<(reason: string) => void>;
  closed: boolean;
};

/** What to do with one message: flip a byte (a negative index counts from the end), drop it, deliver it twice, deliver
 * it after the message that follows it, or hold it back for `holdMs` while later ones pass. */
export type Tamper = { flip: number } | 'drop' | 'repeat' | 'reorder' | { holdMs: number };
export type Direction = 'to-endpoint' | 'to-device';
export type Turns = 'timer' | 'microtask';

class Link {
  private readonly ends: [End, End] = [
    { bytes: [], close: [], closed: false },
    { bytes: [], close: [], closed: false },
  ];
  private tail: Promise<void> = Promise.resolve();
  private readonly intercept: (from: 0 | 1, bytes: Uint8Array, deliver: (bytes: Uint8Array) => void) => void;
  private readonly turns: Turns;

  constructor(intercept: (from: 0 | 1, bytes: Uint8Array, deliver: (bytes: Uint8Array) => void) => void = (_, bytes, deliver) => deliver(bytes), turns: Turns = 'timer') {
    this.intercept = intercept;
    this.turns = turns;
  }

  end(side: 0 | 1): ByteDuplex {
    const me = this.ends[side];
    const other = this.ends[side === 0 ? 1 : 0];
    return {
      send: (bytes) => {
        if (me.closed || other.closed) return;
        const copy = Uint8Array.from(bytes);
        this.intercept(side, copy, (out) => this.later(() => !other.closed && other.bytes.forEach((listener) => listener(out))));
      },
      onBytes: (listener) => void me.bytes.push(listener),
      onClose: (listener) => void me.close.push(listener),
      close: (reason) => {
        if (me.closed) return;
        me.closed = true;
        this.later(() => {
          if (other.closed) return;
          other.closed = true;
          other.close.forEach((listener) => listener(reason));
        });
      },
    };
  }

  /** Runs `work` on a later turn, after everything queued before it. */
  later(work: () => void): void {
    if (this.turns === 'microtask') {
      this.tail = this.tail.then(work);
      return;
    }
    this.tail = this.tail.then(() => new Promise<void>((resolve) => setTimeout(() => {
      work();
      resolve();
    }, 0)));
  }
}

/** Two ends of one in-memory link: the device's, then the endpoint's. */
export function duplexPair(options: { turns?: Turns } = {}): [ByteDuplex, ByteDuplex] {
  const link = new Link(undefined, options.turns);
  return [link.end(0), link.end(1)];
}

export class TamperRelay {
  readonly device: ByteDuplex;
  readonly endpoint: ByteDuplex;
  /** Every message as it was sent, before any tampering, by direction. */
  readonly log: Record<Direction, Uint8Array[]> = { 'to-endpoint': [], 'to-device': [] };
  private readonly pending: Record<Direction, Tamper[]> = { 'to-endpoint': [], 'to-device': [] };
  private readonly reordered: Record<Direction, Uint8Array | null> = { 'to-endpoint': null, 'to-device': null };

  constructor() {
    const link = new Link((from, bytes, deliver) => this.pass(from === 0 ? 'to-endpoint' : 'to-device', bytes, deliver));
    this.device = link.end(0);
    this.endpoint = link.end(1);
  }

  /** Tampers with the next message sent in `direction` (a second call, with the one after, and so on). */
  tamper(direction: Direction, how: Tamper): void {
    this.pending[direction].push(how);
  }

  private pass(direction: Direction, bytes: Uint8Array, deliver: (bytes: Uint8Array) => void): void {
    this.log[direction].push(bytes);
    const held = this.reordered[direction];
    const how = this.pending[direction].shift();
    if (held !== null) {
      this.reordered[direction] = null;
      deliver(bytes);
      deliver(held);
      return;
    }
    if (how === undefined) return deliver(bytes);
    if (how === 'drop') return;
    if (how === 'repeat') {
      deliver(bytes);
      deliver(bytes);
      return;
    }
    if (how === 'reorder') {
      this.reordered[direction] = bytes;
      return;
    }
    if ('flip' in how) {
      const altered = Uint8Array.from(bytes);
      const at = how.flip < 0 ? altered.length + how.flip : how.flip;
      altered[at] ^= 0x01;
      return deliver(altered);
    }
    setTimeout(() => deliver(bytes), how.holdMs);
  }
}
