// The endpoint's forward table (P5 O7 M3, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Forwarding" and
// Interfaces §N, §O's `forward.open`): a port of the machine's loopback that a device may reach through `tcp` streams.
// `forward.open {port}` (the endpoint's own act, endpoint-actions.ts) opens one and names it; each `tcp` stream naming it
// is one connection to `127.0.0.1:<port>` (streams.ts).
//
// A forward is the device's, keyed by `(device, forward)`, not a channel's: it is held by the channels its act and its
// streams came on, and when the last of them closes it is kept for RESUME_MS (120 s, RL3's resume window), so the device's
// next channel opens streams naming it with no new act (and, for a non-owner, no new prompt). Past the window it is
// forgotten and a stream naming it is `unknown`: the device runs a fresh `forward.open`. One whose member no longer holds
// `shell` is removed at once (streams.ts's re-check), and so are its streams.
import { randomBytes } from 'node:crypto';
import type { DeviceClass } from 'org-protocol';
import type { RemoteChannel } from './channels';
import { RESUME_MS } from './interest';

/** The most forwards one device keeps at once; `forward.open` past it answers `busy`. */
export const MAX_FORWARDS_PER_DEVICE = 64;

export type Forward = {
  readonly id: string;
  readonly member: string;
  readonly device: string;
  readonly port: number;
  /** The class of the channels that held it (the re-check's asker). */
  clientClass: DeviceClass;
};

export type ForwardsContext = {
  log(line: string): void;
  /** The suites' seams for the window and its timer. */
  resumeMs?: number;
  setTimer?(run: () => void, ms: number): () => void;
};

type Entry = { forward: Forward; channels: Map<RemoteChannel, () => void>; expire: (() => void) | null };

const keyOf = (device: string, id: string) => `${device}\n${id}`;

export class Forwards {
  readonly #ctx: ForwardsContext;
  readonly #entries = new Map<string, Entry>();
  readonly #removed = new Set<(forward: Forward) => void>();

  constructor(ctx: ForwardsContext) {
    this.#ctx = ctx;
  }

  /** A new forward of `port` for the device, or null past MAX_FORWARDS_PER_DEVICE. Its window runs until a channel holds it. */
  open(who: { member: string; device: string }, port: number): Forward | null {
    if (this.list().filter((f) => f.device === who.device).length >= MAX_FORWARDS_PER_DEVICE) return null;
    const forward: Forward = { id: randomBytes(16).toString('base64url'), member: who.member, device: who.device, port, clientClass: 'native-mac' };
    const entry: Entry = { forward, channels: new Map(), expire: null };
    this.#entries.set(keyOf(who.device, forward.id), entry);
    this.#arm(entry);
    return forward;
  }

  /** The device's forward, held by `channel` from now until it closes; null once it is forgotten (or never was). */
  hold(device: string, id: string, channel: RemoteChannel): Forward | null {
    const entry = this.#entries.get(keyOf(device, id));
    if (entry === undefined || channel.closed) return null;
    entry.forward.clientClass = channel.clientClass;
    if (!entry.channels.has(channel)) {
      const off = channel.onClose(() => {
        if (entry.channels.delete(channel) && entry.channels.size === 0 && this.#entries.get(keyOf(device, id)) === entry) this.#arm(entry);
      });
      entry.channels.set(channel, off);
    }
    entry.expire?.();
    entry.expire = null;
    return entry.forward;
  }

  get(device: string, id: string): Forward | null {
    return this.#entries.get(keyOf(device, id))?.forward ?? null;
  }

  /** Every forward kept now. */
  list(): Forward[] {
    return [...this.#entries.values()].map((e) => e.forward);
  }

  /** The forward is gone now (its member lost `shell`, its device the head): its streams hear it (`onRemoved`). */
  remove(device: string, id: string): void {
    const key = keyOf(device, id);
    const entry = this.#entries.get(key);
    if (entry === undefined) return;
    this.#entries.delete(key);
    this.#release(entry);
    for (const listener of this.#removed) listener(entry.forward);
  }

  onRemoved(listener: (forward: Forward) => void): () => void {
    this.#removed.add(listener);
    return () => void this.#removed.delete(listener);
  }

  /** Every forward forgotten (the endpoint stops). */
  stop(): void {
    for (const entry of this.#entries.values()) this.#release(entry);
    this.#entries.clear();
  }

  #release(entry: Entry): void {
    entry.expire?.();
    entry.expire = null;
    for (const off of entry.channels.values()) off();
    entry.channels.clear();
  }

  /** No channel holds it: forgotten after the window unless one does again. */
  #arm(entry: Entry): void {
    entry.expire?.();
    const { device, id } = entry.forward;
    entry.expire = (this.#ctx.setTimer ?? defaultTimer)(() => {
      if (this.#entries.get(keyOf(device, id)) !== entry) return;
      this.#entries.delete(keyOf(device, id));
      entry.expire = null;
      for (const listener of this.#removed) listener(entry.forward);
    }, this.#ctx.resumeMs ?? RESUME_MS);
  }
}

function defaultTimer(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}
