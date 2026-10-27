// What the deployment's RL1 commands share (O11 M8): synthetic sealed frames, an endpoint that echoes them, and a reader
// of the echoes an app's channel gets back.
//
// RL2 is O10's: its frames are AES-256-GCM, a 64-bit sequence number and at most 256 KiB of plaintext under a 16-byte
// tag (remote layer §4.2, Interfaces RL2). The hub relays them unread and cannot tell random bytes from them, so a
// synthetic frame is the sequence number, then random bytes for the ciphertext and the tag: exactly RL2's size.
import { randomFillSync } from 'node:crypto';
import type { Rl1Welcome } from 'org-protocol';
import type { RelayApp } from 'org-protocol/test-support';
import { FakeEndpoint, type FakeEndpointOptions } from '../fake-machine/endpoint';
import type { V2Machine } from '../fake-machine/org';
import { ADMIT_MS } from './org-admin';

/** RL2's bytes around the plaintext: the 64-bit sequence number and the AES-GCM tag. */
export const SEALED_OVERHEAD = 8 + 16;

/** A synthetic sealed frame of `plaintext` bytes, numbered `seq`: `[u64 seq][random ciphertext][random tag]`. */
export function sealedFrame(plaintext: number, seq: number): Uint8Array {
  const frame = randomFillSync(new Uint8Array(plaintext + SEALED_OVERHEAD));
  new DataView(frame.buffer).setBigUint64(0, BigInt(seq));
  return frame;
}

/** The sequence number a sealed frame carries. */
export const frameSeq = (frame: Uint8Array): number => Number(new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getBigUint64(0));

export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;

/** `promise`, or a rejection naming `what` after `ms`; no timer is left behind. */
export async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`no ${what} within ${ms} ms`)), ms)));
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The machine's endpoint, echoing every channel's data back on it and keeping none of it (FakeEndpoint's own echo keeps
 * each payload, which a measurement's thousands of 256 KiB frames would pile up).
 */
export function echoingEndpoint(hub: string, machine: Pick<V2Machine, 'credentials' | 'ref'>, options: Partial<FakeEndpointOptions> = {}): FakeEndpoint {
  const endpoint: FakeEndpoint = new FakeEndpoint({
    hub,
    credentials: machine.credentials,
    ref: machine.ref,
    channels: { data: (channel, payload) => endpoint.sendData(channel, payload) },
    ...options,
  });
  return endpoint;
}

/** Connects `endpoint`, its upgrade tried again every 2 s while Access refuses a service token minted a moment ago. */
export async function connectEndpoint(endpoint: FakeEndpoint, admitMs = ADMIT_MS): Promise<Rl1Welcome> {
  const deadline = Date.now() + admitMs;
  for (;;) {
    try {
      return await endpoint.connect();
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

/** The echoes one channel of an app's socket gets back, in order, each taken once; it keeps no copy in the app. */
export class EchoReader {
  private readonly queue: Uint8Array[] = [];
  private waiting: ((payload: Uint8Array) => void) | undefined;

  constructor(
    private readonly app: RelayApp,
    private readonly channel: number,
  ) {
    app.onData = (at, payload) => {
      if (at !== channel) return;
      app.received.get(channel)?.splice(0);
      const waiting = this.waiting;
      this.waiting = undefined;
      if (waiting) waiting(payload);
      else this.queue.push(payload);
    };
  }

  /** The next echo, or a rejection after `ms` (the channel closed, the socket dropped, or the hub held it). */
  next(ms = 10_000): Promise<Uint8Array> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return within(new Promise<Uint8Array>((resolve) => (this.waiting = resolve)), ms, `echo on channel ${this.channel}`).finally(() => (this.waiting = undefined));
  }

  /** Stops reading: the app's data hook is released. */
  stop(): void {
    this.app.onData = undefined;
  }
}

/** Opens a channel on `app`, resolving with the id the hub assigned within `ms`. A refused open is answered too, its
 * close following as another message, so it surfaces at the channel's first echo, which never comes. */
export function openedChannel(app: RelayApp, ms = 10_000): Promise<number> {
  return within(app.openChannel(), ms, 'channel open');
}
