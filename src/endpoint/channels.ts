// The endpoint's channels (O10 M4; RL2, RL7, RL §4.5): one table of the devices' channels, whichever carrier brought
// them. A relayed channel is numbered by the hub (RL1's multiplex, hub-link.ts); a direct one is a WebSocket of the
// direct listener (direct-listener.ts). Both run the protocol package's `acceptChannel` against the endpoint's org view
// and then the same loop, so nothing above a channel knows its carrier.
//
// Admission is `acceptChannel`'s: the device's entry in the head (after any successors its `h3` carried, adopted on disk
// through the org view), of the class it claims, its channel key unrevoked, under a member still in the state; a device
// still missing behind its own `stateVersion` is closed `behind`. The table then checks the device once more against the
// head it registers under, sends `caps` (RL7's device half: the member's grades on the machine) as the channel's first
// message, which the device's `openChannel` resolves on, and sends it again whenever those grades change.
//
// A new head re-checks every channel synchronously, before anything else runs, and closes `removed` each whose device or
// key it no longer holds. `ping` is answered with `pong`; a channel silent for one ping period is pinged, and one that
// let two pings go unanswered is closed (`timeout`). While any channel is open the endpoint holds `mawsd`.
//
// The loop: `call`, `act`, `query`, `sub`, `credit` and `unsub` go to their routes (M5–M8 fill them; until then each
// request is refused `not-offered`, and a query answered `unavailable`), invoked one at a time in arrival order and not
// awaited, so a slow call holds nothing behind it; `state` is adopted through the org view; a kind this version doesn't
// know is ignored (OX1), and a known kind out of shape closes the channel (`malformed`).
import {
  acceptChannel,
  keyId,
  readMessage,
  type ActMessage,
  type ByteDuplex,
  type CallMessage,
  type Channel,
  type ChannelMessage,
  type CreditMessage,
  type DeviceClass,
  type DevicePeer,
  type EndpointMessage,
  type MachineIdentity,
  type OrgState,
  type OrgView,
  type QueryMessage,
  type Right,
  type SubMessage,
  type UnsubMessage,
} from 'org-protocol';
import type { ChannelHandler } from './hub-link';

export type Carrier = 'relayed' | 'direct';

/** An admitted channel, as the routes see it. */
export interface RemoteChannel {
  /** `relayed:<the hub's number>` or `direct:<n>`. */
  readonly key: string;
  readonly carrier: Carrier;
  /** RL2's channel id (for logs). */
  readonly id: string;
  readonly member: string;
  readonly device: string;
  readonly clientClass: DeviceClass;
  readonly closed: boolean;
  /** Sends `message` after everything sent before it; false once the channel is closed. */
  send(message: EndpointMessage): boolean;
  /**
   * `send`, resolved once the message is sealed onto the carrier (false: the channel closed first); it never rejects.
   * A subscription's stream goes through it (stream-window.ts), so the channel's queue holds only a window of it.
   */
  transmit(message: EndpointMessage): Promise<boolean>;
  close(reason: string): void;
  /**
   * Ends the carrier under the channel at once, with no sealed close: for a send that never completes, behind which a
   * sealed close would wait too. The channel closes with `reason`, so its subscriptions' cursors stay resumable.
   */
  terminate(reason: string): void;
  onClose(listener: (reason: string) => void): () => void;
}

/** The requests a channel carries, each to the milestone that answers it. */
export type ChannelRoutes = {
  call(channel: RemoteChannel, message: CallMessage): void;
  act(channel: RemoteChannel, message: ActMessage): void;
  query(channel: RemoteChannel, message: QueryMessage): void;
  sub(channel: RemoteChannel, message: SubMessage): void;
  credit(channel: RemoteChannel, message: CreditMessage): void;
  unsub(channel: RemoteChannel, message: UnsubMessage): void;
};

/** Until a route is set, nothing is offered. */
const NOT_OFFERED: ChannelRoutes = {
  call: (channel, m) => void channel.send({ t: 'result', id: m.id, ok: false, error: { code: 'not-offered' } }),
  act: (channel, m) => void channel.send({ t: 'ack', opId: m.action.opId, state: 'refused', reason: 'not-offered' }),
  // Nothing can say whether an executing side holds it: ask later, never `not-received` (M7).
  query: (channel, m) => void channel.send({ t: 'queried', opId: m.opId, state: 'unavailable' }),
  sub: (channel, m) => void channel.send({ t: 'ended', sub: m.sub, reason: 'not-offered' }),
  credit: () => {},
  unsub: () => {},
};

export type ChannelsContext = {
  /** The machine as `h2` signs it; null while the endpoint serves no channel (unenrolled, no head, stopped). */
  identity(): MachineIdentity | null;
  org(): OrgView | null;
  /** A device's `state`: verified and adopted as any delivery is (on disk, then applied, `adopted` among it). */
  adopt(states: unknown, transitions: unknown): Promise<unknown>;
  /** The member's grades on this machine: all three for an owner, else what a grant in force gives. */
  rights(member: string): Promise<Right[]>;
  hold(reason: string): () => void;
  counts(counts: { relayed: number; direct: number }): void;
  log(line: string): void;
  now?(): number;
  /** The silence before a ping, drawn anew each period from this range (RL §4.5's 5–7 s). */
  pingMs?: readonly [number, number];
};

export const PING_MS: readonly [number, number] = [5000, 7000];

type Entry = {
  remote: Remote;
  channel: Channel;
  peer: DevicePeer;
  /** The key id of the channel key the device signed `h3` with. */
  kid: string;
  /** The machine key `h2` was signed with. */
  machinePub: string;
  /** The grades `caps` last said; one refresh at a time, in order. */
  grades: Right[];
  caps: Promise<void>;
  heard: boolean;
  unanswered: number;
  timer: ReturnType<typeof setTimeout> | null;
};

class Remote implements RemoteChannel {
  readonly #channel: Channel;
  readonly #io: ByteDuplex;
  readonly #log: (line: string) => void;
  readonly key: string;
  readonly carrier: Carrier;
  readonly member: string;
  readonly device: string;
  readonly clientClass: DeviceClass;

  constructor(key: string, carrier: Carrier, channel: Channel, io: ByteDuplex, peer: DevicePeer, log: (line: string) => void) {
    this.key = key;
    this.carrier = carrier;
    this.#channel = channel;
    this.#io = io;
    this.member = peer.member;
    this.device = peer.device;
    this.clientClass = peer.clientClass;
    this.#log = log;
  }

  get id(): string {
    return this.#channel.id;
  }

  get closed(): boolean {
    return this.#channel.closed;
  }

  send(message: EndpointMessage): boolean {
    if (this.#channel.closed) return false;
    this.#channel.send(message).catch((error: unknown) => {
      if (!this.#channel.closed) this.#log(`endpoint: a \`${message.t}\` could not be sent on channel ${this.key}: ${(error as Error).message}`);
    });
    return true;
  }

  transmit(message: EndpointMessage): Promise<boolean> {
    if (this.#channel.closed) return Promise.resolve(false);
    return this.#channel.send(message).then(
      () => true,
      (error: unknown) => {
        if (!this.#channel.closed) this.#log(`endpoint: a \`${message.t}\` could not be sent on channel ${this.key}: ${(error as Error).message}`);
        return false;
      },
    );
  }

  close(reason: string): void {
    this.#channel.close(reason);
  }

  terminate(reason: string): void {
    this.#io.close(reason);
  }

  onClose(listener: (reason: string) => void): () => void {
    return this.#channel.onClose((reason) => listener(reason));
  }
}

/** A carrier's two directions as RL2 needs them: what it delivered and how it ended, and how to send and close. */
export class CarrierDuplex implements ByteDuplex {
  readonly #out: { send(bytes: Uint8Array): void; close(reason: string): void };
  readonly #bytes: Array<(bytes: Uint8Array) => void> = [];
  readonly #ends: Array<(reason: string) => void> = [];
  readonly #waiting: Uint8Array[] = [];
  #ended: string | null = null;

  constructor(out: { send(bytes: Uint8Array): void; close(reason: string): void }) {
    this.#out = out;
  }

  send(bytes: Uint8Array): void {
    if (this.#ended === null) this.#out.send(bytes);
  }

  /** Closes the carrier; what reads it (a handshake waiting for its next message) learns it ended. */
  close(reason: string): void {
    if (this.#ended !== null) return;
    this.#ended = reason;
    this.#out.close(reason);
    for (const listener of this.#ends) listener(reason);
  }

  onBytes(listener: (bytes: Uint8Array) => void): void {
    this.#bytes.push(listener);
    for (const bytes of this.#waiting.splice(0)) listener(bytes);
  }

  onClose(listener: (reason: string) => void): void {
    this.#ends.push(listener);
  }

  /** A message the carrier delivered; held until something listens. */
  deliver(bytes: Uint8Array): void {
    if (this.#ended !== null) return;
    if (this.#bytes.length === 0) this.#waiting.push(bytes);
    for (const listener of this.#bytes) listener(bytes);
  }

  /** The carrier ended from the other side or the transport. */
  end(reason: string): void {
    if (this.#ended !== null) return;
    this.#ended = reason;
    for (const listener of this.#ends) listener(reason);
  }
}

export class Channels {
  readonly #ctx: ChannelsContext;
  readonly #entries = new Map<string, Entry>();
  /** Carriers whose handshake is still running, so a stop can end them. */
  readonly #pending = new Set<ByteDuplex>();
  readonly #once = new Set<string>();
  #routes: ChannelRoutes = NOT_OFFERED;
  #direct = 0;
  #release: (() => void) | null = null;
  /** Counts `refreshCaps` calls, so a channel whose grades were read before one is read again. */
  #capsEpoch = 0;

  constructor(ctx: ChannelsContext) {
    this.#ctx = ctx;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Sets the routes M5–M8 fill; a route left out keeps refusing. */
  setRoutes(routes: Partial<ChannelRoutes>): void {
    this.#routes = { ...this.#routes, ...routes };
  }

  /**
   * Runs RL2's handshake on `io` and admits the device: the admitted channel, or null when it was refused (the carrier
   * is then closed). `deadlineMs` bounds the whole handshake (the direct listener's 10 s).
   */
  async accept(carrier: Carrier, io: ByteDuplex, options: { key?: string; deadlineMs?: number } = {}): Promise<RemoteChannel | null> {
    const key = options.key ?? `direct:${++this.#direct}`;
    const identity = this.#ctx.identity();
    const org = this.#ctx.org();
    if (identity === null || org === null) {
      io.close('unavailable');
      this.#ctx.log(`endpoint: a ${carrier} channel was refused: unavailable`);
      return null;
    }
    this.#pending.add(io);
    const epoch = this.#capsEpoch;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const handshake = acceptChannel(io, identity, org, { now: () => new Date(this.#now()) });
      // A carrier's own close may not end the handshake's read (only the other end's does), so the deadline answers
      // for it, and a handshake that still completes after it is closed.
      const late = options.deadlineMs === undefined ? null : new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), options.deadlineMs)));
      let channel: Channel;
      let peer: DevicePeer;
      try {
        const done = late === null ? await handshake : await Promise.race([handshake, late]);
        if (done === 'timeout') {
          io.close('timeout');
          void handshake.then(({ channel: stray }) => stray.close('timeout'), () => {});
          this.#ctx.log(`endpoint: a ${carrier} channel was refused: timeout`);
          return null;
        }
        ({ channel, peer } = done);
      } catch (error) {
        this.#ctx.log(`endpoint: a ${carrier} channel was refused: ${(error as { reason?: string }).reason ?? (error as Error).message}`);
        return null;
      } finally {
        clearTimeout(timer);
      }
      return await this.#admit(key, carrier, channel, io, peer, epoch, identity.key.pub);
    } finally {
      this.#pending.delete(io);
    }
  }

  /**
   * Registers a channel whose handshake verified, `caps` first. Whatever ran since the handshake checked the device (a
   * head adopted, the device gone, the endpoint stopped) is read once more here, synchronously with registering it, so
   * nothing falls between the two.
   */
  async #admit(key: string, carrier: Carrier, channel: Channel, io: ByteDuplex, peer: DevicePeer, epoch: number, machinePub: string): Promise<RemoteChannel | null> {
    let kid: string;
    let grades: Right[];
    try {
      kid = await keyId(peer.channelPub);
      grades = await this.#ctx.rights(peer.member);
    } catch (error) {
      this.#ctx.log(`endpoint: a ${carrier} channel's grades could not be read: ${(error as Error).message}`);
      channel.close('unavailable');
      return null;
    }
    if (channel.closed) return null;
    // The endpoint still serves, under the key this handshake was signed with.
    const org = this.#ctx.identity()?.key.pub !== machinePub ? null : this.#ctx.org();
    const reason = org === null ? 'unavailable' : holds(org.head().state, peer, kid) ? null : 'removed';
    if (org === null || reason !== null) {
      channel.close(reason ?? 'unavailable');
      this.#ctx.log(`endpoint: a ${carrier} channel was refused: ${reason}`);
      return null;
    }
    const entry = this.#register(key, carrier, channel, io, peer, kid, grades, machinePub);
    entry.remote.send(this.#caps(entry, grades, org.head().state.version));
    if (epoch !== this.#capsEpoch) this.#refresh(entry);
    channel.onMessage((message) => this.#receive(entry, message));
    return entry.remote;
  }

  /** The hub's multiplex as carriers: each channel the hub opens, numbered by it, is one (`link` is the hub link). */
  relay(link: { sendChannel(channel: number, payload: Uint8Array): boolean; closeChannel(channel: number): void }): ChannelHandler {
    const carriers = new Map<number, CarrierDuplex>();
    return {
      opened: (number, payload) => {
        const io = new CarrierDuplex({
          send: (bytes) => {
            try {
              if (!link.sendChannel(number, bytes)) io.end('endpoint-gone');
            } catch (error) {
              this.#ctx.log(`endpoint: relayed channel ${number} could not send: ${(error as Error).message}`);
              io.close('too-large');
            }
          },
          close: () => {
            carriers.delete(number);
            link.closeChannel(number);
          },
        });
        carriers.set(number, io);
        void this.accept('relayed', io, { key: `relayed:${number}` });
        // The app's first payload rides the hub's `open`: the device's `h1`.
        if (payload.length > 0) io.deliver(payload);
      },
      data: (number, payload) => carriers.get(number)?.deliver(payload),
      closed: (number, reason) => {
        const io = carriers.get(number);
        carriers.delete(number);
        io?.end(reason ?? 'closed');
      },
    };
  }

  /**
   * A new head is on disk: every channel whose device it no longer holds as admitted is closed `removed` now, before
   * anything else runs; then each channel's grades are read again.
   */
  adopted(head: OrgState): void {
    for (const entry of [...this.#entries.values()]) {
      if (!holds(head, entry.peer, entry.kid)) entry.remote.close('removed');
    }
    this.refreshCaps();
  }

  /**
   * The machine key was replaced (`--replace`): every channel the old key authenticated closes `restart`, so its device
   * handshakes again against the new one once the head lists it (a replaced key is often a suspect one).
   */
  keyReplaced(current: string): void {
    for (const entry of [...this.#entries.values()]) if (entry.machinePub !== current) entry.remote.close('restart');
  }

  /** Reads each channel's grades again and sends `caps` where they changed (a grant kept or ended, an owner changed). */
  refreshCaps(): void {
    this.#capsEpoch++;
    for (const entry of this.#entries.values()) this.#refresh(entry);
  }

  /** Closes every channel (a sealed close with `reason`) and every handshake; resolves once all ended, or after `waitMs`. */
  async closeAll(reason: string, waitMs = 1000): Promise<void> {
    for (const io of this.#pending) io.close(reason);
    const ends = [...this.#entries.values()].map((entry) => new Promise<void>((resolve) => {
      entry.remote.onClose(() => resolve());
      entry.remote.close(reason);
    }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all(ends), new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs)))]);
    clearTimeout(timer);
  }

  #register(key: string, carrier: Carrier, channel: Channel, io: ByteDuplex, peer: DevicePeer, kid: string, grades: Right[], machinePub: string): Entry {
    const entry: Entry = { remote: new Remote(key, carrier, channel, io, peer, this.#ctx.log), channel, peer, kid, machinePub, grades, caps: Promise.resolve(), heard: false, unanswered: 0, timer: null };
    // A number the hub gives again on a later connection replaces whatever still closes under it.
    this.#entries.get(key)?.remote.close('endpoint-gone');
    this.#entries.set(key, entry);
    this.#release ??= this.#ctx.hold('channel');
    this.#counted();
    channel.onClose(() => this.#forget(entry));
    this.#arm(entry);
    return entry;
  }

  #forget(entry: Entry): void {
    if (this.#entries.get(entry.remote.key) !== entry) return;
    this.#entries.delete(entry.remote.key);
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
    this.#counted();
    if (this.#entries.size === 0 && this.#release !== null) {
      this.#release();
      this.#release = null;
    }
  }

  #counted(): void {
    let relayed = 0;
    for (const entry of this.#entries.values()) if (entry.remote.carrier === 'relayed') relayed++;
    this.#ctx.counts({ relayed, direct: this.#entries.size - relayed });
  }

  #caps(entry: Entry, grades: Right[], stateVersion: number): EndpointMessage {
    return { t: 'caps', member: entry.peer.member, device: entry.peer.device, clientClass: entry.peer.clientClass, machine: { grades }, stateVersion };
  }

  #refresh(entry: Entry): void {
    entry.caps = entry.caps.then(async () => {
      if (entry.remote.closed) return;
      const grades = await this.#ctx.rights(entry.peer.member);
      const org = this.#ctx.org();
      if (entry.remote.closed || org === null || sameGrades(grades, entry.grades)) return;
      entry.grades = grades;
      entry.remote.send(this.#caps(entry, grades, org.head().state.version));
    }).catch((error: unknown) => this.#ctx.log(`endpoint: channel ${entry.remote.key}'s grades could not be read: ${(error as Error).message}`));
  }

  // ---- The loop ---------------------------------------------------------------------------------------------------

  #receive(entry: Entry, value: ChannelMessage): void {
    if (entry.remote.closed) return;
    entry.heard = true;
    const read = readMessage('device', value);
    if (read.kind === 'malformed') return entry.remote.close('malformed');
    if (read.kind === 'unknown') return this.#logOnce(`kind:${read.t}`, `endpoint: a channel sent a \`${read.t.slice(0, 64)}\`, which this version doesn't know; ignored`);
    const message = read.message;
    const routes = this.#routes;
    const remote = entry.remote;
    try {
      switch (message.t) {
        case 'ping':
          remote.send({ t: 'pong', at: message.at });
          return;
        case 'pong':
        case 'close':
          return;
        case 'state':
          void this.#ctx.adopt(message.states, message.transitions).catch((error: unknown) => this.#ctx.log(`endpoint: a state delivered on channel ${remote.key} could not be adopted: ${(error as Error).message}`));
          return;
        case 'call':
          return routes.call(remote, message);
        case 'act':
          return routes.act(remote, message);
        case 'query':
          return routes.query(remote, message);
        case 'sub':
          return routes.sub(remote, message);
        case 'credit':
          return routes.credit(remote, message);
        case 'unsub':
          return routes.unsub(remote, message);
      }
    } catch (error) {
      this.#ctx.log(`endpoint: channel ${remote.key}'s \`${message.t}\` route failed: ${(error as Error).message}`);
    }
  }

  // ---- Liveness (RL §4.5) -----------------------------------------------------------------------------------------

  /** One ping period: heard from → nothing; silent → a ping, and the third silent period in a row closes. */
  #arm(entry: Entry): void {
    const [min, max] = this.#ctx.pingMs ?? PING_MS;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (entry.remote.closed) return;
      if (entry.heard) {
        entry.heard = false;
        entry.unanswered = 0;
      } else if (entry.unanswered >= 2) {
        return entry.remote.close('timeout');
      } else {
        entry.unanswered++;
        entry.remote.send({ t: 'ping', at: this.#now() });
      }
      this.#arm(entry);
    }, min + Math.random() * (max - min));
    entry.timer.unref?.();
  }

  #now(): number {
    return this.#ctx.now?.() ?? Date.now();
  }

  /** One line per kind for the endpoint's life, and none past 64 kinds (a device can name kinds without end). */
  #logOnce(kind: string, line: string): void {
    if (this.#once.has(kind) || this.#once.size >= 64) return;
    this.#once.add(kind);
    this.#ctx.log(line);
  }
}

/** The head still holds the device as it was admitted: under its member, of its class, with its channel key unrevoked. */
function holds(head: OrgState, peer: DevicePeer, kid: string): boolean {
  const device = head.members.find((m) => m.id === peer.member)?.devices.find((d) => d.id === peer.device);
  return device !== undefined && device.class === peer.clientClass && device.channelPub === peer.channelPub && !head.revoked.some((r) => r.keyId === kid);
}

const sameGrades = (x: readonly Right[], y: readonly Right[]) => x.length === y.length && x.every((g, i) => g === y[i]);
