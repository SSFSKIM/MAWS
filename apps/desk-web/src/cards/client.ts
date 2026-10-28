// The cards client (P5 O13 M4, §D): RL2 channels from the phone to a cut-over machine through the hub's relay, and the
// `cards` view of a session over one. A library with no view; M5 draws it.
//
// Nothing but cards crosses (Constraints): the handshake (the package's `connectChannel`, one carrier per catch-up
// page), `sub` with view `cards`, `credit`, `unsub`, `act` of the three answers (answers.ts), `pong` to the endpoint's
// `ping`, and `close`. No `call`, no `query` (a `web-cards` query is refused, P5 Decision Log 64), no other action, no
// `full` view; `client.test.ts` pins the set. From the endpoint the channel takes `caps` (read for its state version
// only), the cards stream, the answers' `ack` and `done`, and `state`, whose successors the org store adopts as it does
// the hub's.
//
// A subscription is always a snapshot (O10 M8): `snap` replaces the card set whole, lane A's `ev` of `raised` adds and
// `settled` removes between snapshots, `ended {reason}` ends it. Its credit, 1 MiB, is topped up once half is spent,
// counted as the endpoint counts it (each `snap` and `ev` message's JSON bytes). `followCards` keeps a session's cards
// across a channel's close: a new channel after backoff, each resubscription a snapshot; an end the session or the
// device's standing gives (`removed`, `unavailable`, a refused handshake) stops it with its reason.
import { ChannelError, connectChannel, isSignedOrgState, readMessage, SUB_CREDIT_MAX, type CapsMessage, type Channel, type ChannelMessage, type DeviceIdentity, type HandshakeOptions, type OrgView, type RootTransition, type Signed } from 'org-protocol';
import { backoff } from '../hub/socket';
import { laneACard, laneACards, laneBCards, type Card, type CardSession, type Raised } from './cards';
import { machineSocket, type MachineSocket } from './carrier';
import type { DeviceRecord } from './device-store';

export type { CardSession } from './cards';

/** A channel to one machine, which an answer's action names by ref; `caps` the endpoint's last word on this device. */
export type MachineChannel = Channel & { readonly machine: string; readonly caps: CapsMessage | null };

/** The `h1.build` this web build sends: the label the deploy scripts export before the build (`--web`'s), else `dev`. */
const BUILD = `desk-web/${(import.meta.env.VITE_DESK_WEB_BUILD as string | undefined) || 'dev'}`;

/** The channel identity of this browser's `web-cards` device in `org`. */
export function cardsIdentity(org: string, record: DeviceRecord): DeviceIdentity {
  return { org, member: record.member, device: record.deviceId, clientClass: 'web-cards', channelKey: { privateKey: record.channelKey, pub: record.channelPub }, build: BUILD, capabilities: [] };
}

const sockets = new Map<string, MachineSocket>();

/** The Machine socket to `ref` at `hub` (this page's origin): one per machine for the tab's life, until it is closed. */
export function socketFor(ref: string, hub: string = location.origin): MachineSocket {
  const key = `${hub} ${ref}`;
  let socket = sockets.get(key);
  if (socket === undefined) {
    socket = machineSocket(hub, ref, { closed: () => sockets.delete(key) });
    sockets.set(key, socket);
  }
  return socket;
}

export type OpenOptions = HandshakeOptions & {
  /** The machine's socket (`socketFor`'s by default). */
  socket?: MachineSocket;
  /** The endpoint holds a newer org state than the phone's head (its `caps`): the org store reads the hub's. */
  onBehind?: (version: number) => void;
};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A channel to `machine` through the hub's relay, as the device `identity` over the org view `org`. */
export async function openChannel(machine: { ref: string }, identity: DeviceIdentity, org: OrgView, options: OpenOptions = {}): Promise<MachineChannel> {
  const { socket = socketFor(machine.ref), onBehind, ...handshake } = options;
  const channel = Object.assign(await connectChannel(() => socket.dial(), identity, org, { ...handshake, machine: machine.ref }), { machine: machine.ref, caps: null as CapsMessage | null });
  channel.onMessage((message) => {
    if (message.t === 'ping' && typeof message.at === 'number') void channel.send({ t: 'pong', at: message.at }).catch(() => {});
    else if (message.t === 'state') {
      void org.advance(list(message.states).filter(isSignedOrgState), list(message.transitions) as Signed<RootTransition>[]).catch((error: unknown) => console.error('desk: a channel’s org state', error));
    } else if (message.t === 'caps') {
      const read = readMessage('endpoint', message);
      if (read.kind !== 'message' || read.message.t !== 'caps') return;
      channel.caps = read.message;
      if (read.message.stateVersion > org.head().state.version) onBehind?.(read.message.stateVersion);
    }
  });
  return channel;
}

/** A subscription's credit, topped up once half is spent. */
export const CARDS_CREDIT = 1024 * 1024;

export type CardsListener = { cards(set: Card[]): void; ended(reason: string): void };

const random = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, '0')).join('');
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const bytesOf = (message: ChannelMessage) => new TextEncoder().encode(JSON.stringify(message)).length;

/**
 * The `cards` view of `session` on `channel`: each set as it stands (a snapshot's, or one a raise or settlement moved),
 * until the endpoint or the channel ends it (`ended`) or `close` (which sends `unsub`).
 */
export function subscribeCards(channel: Channel, session: CardSession, listener: CardsListener): { close(): void } {
  const sub = `cards-${random()}`;
  let finished = false;
  let cards: Card[] = [];
  let launch: string | null = null;
  let text = '';
  let spent = 0;
  let queue: Promise<void> = Promise.resolve();

  const finish = (reason: string | null) => {
    if (finished) return;
    finished = true;
    offMessage();
    offClose();
    if (reason !== null) listener.ended(reason);
  };
  const tell = (set: Card[]) => {
    cards = set;
    if (!finished) listener.cards(set);
  };
  const handle = async (message: ChannelMessage) => {
    if (message.t === 'snap') {
      if (message.page === 0) text = '';
      text += typeof message.body === 'string' ? message.body : '';
      if (message.last !== true) return;
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return;
      }
      if (session.lane === 'B') return tell(await laneBCards(session.id, body));
      const drawn = await laneACards(body);
      launch = drawn.launch;
      return tell(drawn.cards);
    }
    if (message.t === 'ev' && session.lane === 'A' && isObject(message.body)) {
      const { kind, body } = message.body;
      if (kind === 'raised' && isObject(body) && (await laneACards({ raised: [body] })).cards.length === 1) {
        // sminos republishes a request whose body changed under its id, and the endpoint's pending set replaces it: the
        // card is replaced in place, its digest over the new input. One republished unchanged draws nothing.
        const held = cards.find((c) => c.lane === 'A' && c.raised.request === body.request);
        if (held?.lane === 'A' && JSON.stringify(held.raised) === JSON.stringify(body)) return;
        const card = await laneACard(body as Raised, launch);
        return tell(held === undefined ? [...cards, card] : cards.map((c) => (c === held ? card : c)));
      }
      if (kind === 'settled' && isObject(body)) return tell(cards.filter((c) => !(c.lane === 'A' && c.raised.request === body.request)));
    }
  };

  const offMessage = channel.onMessage((message) => {
    if (finished || message.sub !== sub) return;
    if (message.t === 'ended') return finish(typeof message.reason === 'string' ? message.reason : 'ended');
    if (message.t !== 'snap' && message.t !== 'ev') return;
    spent += bytesOf(message);
    if (spent >= CARDS_CREDIT / 2) {
      void channel.send({ t: 'credit', sub, bytes: Math.min(spent, SUB_CREDIT_MAX) }).catch(() => {});
      spent = 0;
    }
    queue = queue.then(() => handle(message)).catch((error: unknown) => console.error('desk: drawing the cards', error));
  });
  const offClose = channel.onClose((reason) => finish(reason));
  void channel.send({ t: 'sub', sub, session: { lane: session.lane, id: session.id }, view: 'cards', cursor: null, credit: CARDS_CREDIT }).catch(() => {});

  return {
    close() {
      if (finished) return;
      finish(null);
      if (!channel.closed) void channel.send({ t: 'unsub', sub }).catch(() => {});
    },
  };
}

/**
 * Ends that resubscribing would not change: the session left the member or its bridge is gone, or the device itself is
 * refused (removed, revoked, not of the class, the machine not one its head lists). Any other end is a carrier's or a
 * restart, and a new channel after backoff resubscribes.
 */
const FINAL = new Set(['removed', 'unavailable', 'class', 'grade', 'revoked', 'unknown-device', 'unknown-machine', 'wrong-machine', 'contested', 'bad-signature', 'bad-mac', 'protocol', 'state-too-old', 'not-offered']);

export type FollowListener = CardsListener & {
  /** The channel the cards now come over, to answer on; null while there is none. */
  channel?(channel: MachineChannel | null): void;
};

/**
 * `session`'s cards over channels from `open`, one at a time: a channel that closes, or a subscription ended for a
 * passing reason, is followed by a new channel after backoff and a fresh snapshot; a final end stops it with its reason.
 */
export function followCards(open: () => Promise<MachineChannel>, session: CardSession, listener: FollowListener, options: { delay?: (attempt: number) => number } = {}): { close(): void } {
  const delay = options.delay ?? backoff;
  let stopped = false;
  let attempt = 0;
  let current: MachineChannel | null = null;
  let subscription: { close(): void } | null = null;
  let wake: (() => void) | null = null;

  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => (clearTimeout(timer), resolve());
    });

  void (async () => {
    while (!stopped) {
      let channel: MachineChannel;
      try {
        channel = await open();
      } catch (error) {
        if (stopped) return;
        const reason = error instanceof ChannelError ? error.reason : 'unreachable';
        if (FINAL.has(reason)) return listener.ended(reason);
        const wait = delay(attempt);
        attempt += 1;
        await pause(wait);
        continue;
      }
      if (stopped) return channel.close('done');
      current = channel;
      listener.channel?.(channel);
      const reason = await new Promise<string | null>((resolve) => {
        wake = () => resolve(null);
        subscription = subscribeCards(channel, session, {
          cards: (set) => {
            attempt = 0;
            listener.cards(set);
          },
          ended: resolve,
        });
      });
      subscription = null;
      current = null;
      if (stopped || reason === null) return;
      listener.channel?.(null);
      if (!channel.closed) channel.close('done');
      if (FINAL.has(reason)) return listener.ended(reason);
      const wait = delay(attempt);
      attempt += 1;
      await pause(wait);
    }
  })();

  return {
    close() {
      if (stopped) return;
      stopped = true;
      subscription?.close();
      current?.close('done');
      wake?.();
    },
  };
}
