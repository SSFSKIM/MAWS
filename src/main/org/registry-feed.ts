// The app's Registry feed (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §F; OX8): the
// hub's `?app=1` socket held for whichever org session main runs. It hands the session the hub's `state {version}`
// notices (the session reads and verifies the chain itself) and M2 the listings (`listings` pages, then each `listing`);
// the hub's frames carry nothing trusted. A frame over 1 MiB arrives as numbered parts and is joined here; a frame of any
// other kind (`grid`, `summary`, anything new) is ignored.
//
// The socket is held while `session.current()?.hub` is non-null, and opened again when a change of the session changes
// the hub's address or headers. It reconnects on FEED_BACKOFF_MS, jittered, and at once on `probe()`. Two ends wait for
// the session's next change instead: a `4403` close (the hub no longer admits the member; the session reads `denied`),
// and an upgrade refused by Access rather than the Worker (no `X-Desk-Build`: the credential has ended). A Worker's own
// 403 on the upgrade (`not-a-member`) is the first of those.
//
// P5 O15 M2b §G (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md), its five rules, which the Project socket
// follows too: a wake of WAKE_DROP_MS or more opens the reach's window and drops the socket, a shorter one or an unlock
// is `probe()`; a protocol ping every HUB_PING_MS from the open, a socket with no pong within HUB_PONG_MS dropped;
// one socket at a time, each open behind the reach's answer for the hub or WINDOW_FLOOR_MS of waiting on it
// (hub-socket.ts), an open made in the window given HUB_WINDOW_OPEN_MS; every end the app decides is a terminate,
// told in the same turn, since neither of the hub's objects completes a close handshake.
import WebSocket from 'ws';
import type { Listing, Signed } from '../../../apps/org-protocol/src/index.ts';
import { NO_REACH, type Reach } from '../net/reach';
import { WAKE_DROP_MS, type WakeNotice, type WakeSource } from '../net/wake';
import { BUILD_HEADER } from './hub-client';
import { startPings, waitForHub, type HubWait, type Pings } from './hub-socket';
import type { OrgSession } from './session';
import { orgTiming, type OrgTiming } from './timing';

export const REGISTRY_APP_PATH = '/api/registry/socket?app=1';
/** The hub's close for a member a new state removed (desk-hub's Registry). */
export const CLOSE_REMOVED = 4403;

export interface RegistryFeedHooks {
  onOpen(listener: () => void): () => void;
  /** An open socket ended, for any reason (beyond §F: the session's `hubAccess` reads `connecting` again). */
  onClose(listener: () => void): () => void;
  onState(listener: (version: number) => void): () => void;
  /** A close 4403, or the Worker refusing the upgrade 403. */
  onRemoved(listener: () => void): () => void;
  /** An upgrade answered by Access, not the Worker. */
  onCredentialsEnded(listener: () => void): () => void;
}
export interface RegistryFeed extends RegistryFeedHooks {
  onListings(listener: (page: { records: Signed<Listing>[]; last: boolean }) => void): () => void;
  onListing(listener: (record: Signed<Listing>) => void): () => void;
  connected(): boolean;
  probe(): void;
  close(): void;
}

/** What the feed needs of a socket; `ws` by default. */
export interface WebSocketLike {
  on(event: 'open', listener: () => void): void;
  on(event: 'message', listener: (text: string) => void): void;
  on(event: 'close', listener: (code: number, reason: string) => void): void;
  /** The upgrade was answered without a `101`. */
  on(event: 'refused', listener: (status: number, headers: Record<string, string | string[] | undefined>) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  /** A protocol pong (§G rule 2). */
  on(event: 'pong', listener: () => void): void;
  ping(): void;
  /** The app's own end of the socket, whatever its state (§G rule 5); it never sends a close frame and waits for none. */
  terminate(): void;
}

type Part = { t: 'part'; id: string; index: number; count: number; data: string };
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The incomplete sets of parts held at once, and the text they may hold together: past either, all are dropped. */
export const MAX_PART_SETS = 4;
export const MAX_PART_TEXT = 8 * 1024 * 1024;

/**
 * Joins the hub's numbered parts into the frame they carry (desk-hub's `toWire`); anything else passes through. What it
 * holds is bounded: a hub that starts sets it never finishes, or sends sets too big to join, has them dropped (logged).
 */
export class PartJoiner {
  readonly #sets = new Map<string, Array<string | undefined>>();
  #text = 0;
  readonly #log: (line: string) => void;
  constructor(log: (line: string) => void = () => {}) {
    this.#log = log;
  }
  add(frame: Record<string, unknown>): Record<string, unknown> | undefined {
    if (frame.t !== 'part') return frame;
    const { id, index, count, data } = frame as unknown as Part;
    if (typeof id !== 'string' || !Number.isInteger(count) || count < 1 || count > 4096 || !Number.isInteger(index) || index < 0 || index >= count || typeof data !== 'string') return undefined;
    let slices = this.#sets.get(id);
    if (slices === undefined) {
      if (this.#sets.size >= MAX_PART_SETS) return this.#overflow(`more than ${MAX_PART_SETS} sets of parts are incomplete`);
      slices = new Array<string | undefined>(count).fill(undefined);
    }
    if (slices.length !== count) return undefined;
    const text = this.#text - (slices[index]?.length ?? 0) + data.length;
    if (text > MAX_PART_TEXT) return this.#overflow(`the incomplete sets of parts hold more than ${MAX_PART_TEXT} characters`);
    this.#sets.set(id, slices);
    this.#text = text;
    slices[index] = data;
    if (slices.some((slice) => slice === undefined)) return undefined;
    this.#sets.delete(id);
    this.#text -= slices.reduce((sum, slice) => sum + slice!.length, 0);
    const whole: unknown = JSON.parse(slices.join(''));
    return isObject(whole) ? whole : undefined;
  }
  clear(): void {
    this.#sets.clear();
    this.#text = 0;
  }
  #overflow(why: string): undefined {
    this.#log(`${why}: dropped ${this.#sets.size} incomplete sets`);
    this.clear();
    return undefined;
  }
}

export const socketUrl = (hub: string): string => `${hub.replace(/\/+$/, '').replace(/^http/, 'ws')}${REGISTRY_APP_PATH}`;

/** A `ws` socket as the feed (and M7a's Project socket, which also sends) uses one. */
export function wsSocket(url: string, headers: Record<string, string>): WebSocketLike & { send(text: string): void } {
  const socket = new WebSocket(url, { headers, handshakeTimeout: 10_000, maxPayload: 2 * 1024 * 1024 });
  return {
    on(event: string, listener: (...args: never[]) => void) {
      const call = listener as (...args: unknown[]) => void;
      if (event === 'open') socket.on('open', () => call());
      else if (event === 'message') socket.on('message', (data, binary) => !binary && call(data.toString()));
      else if (event === 'close') socket.on('close', (code, reason) => call(code, reason.toString()));
      else if (event === 'refused') socket.on('unexpected-response', (_request, response) => {
        call(response.statusCode ?? 0, response.headers);
        response.resume();
        socket.terminate();
      });
      else if (event === 'error') socket.on('error', (error) => call(error));
      else if (event === 'pong') socket.on('pong', () => call());
    },
    send: (text: string) => socket.send(text),
    ping: () => socket.ping(),
    terminate: () => socket.terminate(),
  } as WebSocketLike & { send(text: string): void };
}

export function createRegistryFeed(deps: {
  session: OrgSession;
  socket?: (url: string, headers: Record<string, string>) => WebSocketLike;
  /** None: no wake is heard. */
  wake?: WakeSource;
  /** NO_REACH by default: no window opens, and every open is today's. */
  reach?: Reach;
  timing?: Partial<OrgTiming>;
  random?(): number;
  log(line: string): void;
}): RegistryFeed {
  const timing = orgTiming(deps.timing);
  const random = deps.random ?? Math.random;
  const log = (line: string) => deps.log(`[org-feed] ${line}`);
  const makeSocket = deps.socket ?? wsSocket;
  const reach = deps.reach ?? NO_REACH;
  const listeners = {
    open: new Set<() => void>(),
    close: new Set<() => void>(),
    state: new Set<(version: number) => void>(),
    removed: new Set<() => void>(),
    credentials: new Set<() => void>(),
    listings: new Set<(page: { records: Signed<Listing>[]; last: boolean }) => void>(),
    listing: new Set<(record: Signed<Listing>) => void>(),
  };
  const subscribe =
    <T>(set: Set<T>) =>
    (listener: T) => {
      set.add(listener);
      return () => void set.delete(listener);
    };
  function tell<A extends unknown[]>(set: Set<(...args: A) => void>, ...args: A): void {
    for (const listener of [...set]) {
      try {
        listener(...args);
      } catch (error) {
        log(`a listener failed: ${(error as Error).message}`);
      }
    }
  }

  let closed = false;
  let socket: WebSocketLike | null = null;
  let open = false;
  /** The hub and headers the socket was opened with (or is being opened with, or awaited for). */
  let target: string | null = null;
  /** §G rule 3: the wait on the hub's path before the next open; it outlives the open the floor starts until that opens. */
  let waiting: HubWait | null = null;
  /** §G rule 2, while a socket is open. */
  let pings: Pings | null = null;
  /** Waiting for the session's next change: a 4403 or Access's answer ended the last socket. */
  let parked = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped at every decision, so an old `reconcile`'s headers never open a socket a newer one replaced. */
  let generation = 0;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const stopWaiting = () => {
    waiting?.cancel();
    waiting = null;
  };
  /**
   * Ends the feed's socket by its own decision, and any wait for one: terminated, forgotten, and one that was open told
   * as closed in the same turn (but not on `close()`).
   */
  const drop = () => {
    clearTimer();
    stopWaiting();
    pings?.stop();
    pings = null;
    const held = socket;
    const wasOpen = open;
    socket = null;
    open = false;
    target = null;
    held?.terminate();
    if (wasOpen && !closed) tell(listeners.close);
  };

  function delay(): number {
    const steps = timing.FEED_BACKOFF_MS;
    const base = steps[Math.min(attempt, steps.length - 1)];
    attempt++;
    return Math.round(base * (1 + timing.FEED_JITTER * (2 * random() - 1)));
  }

  function retry(): void {
    if (closed || parked || timer !== null) return;
    const wait = delay();
    timer = setTimeout(() => {
      timer = null;
      void reconcile(false);
    }, wait);
    (timer as { unref?: () => void }).unref?.();
  }

  /** Brings the socket in line with the session: opens, keeps, reopens or drops it. */
  async function reconcile(changed: boolean): Promise<void> {
    if (closed) return;
    const mine = ++generation;
    const hub = deps.session.current()?.hub ?? null;
    if (hub === null) {
      drop();
      return;
    }
    let headers: Record<string, string>;
    try {
      headers = await hub.headers();
    } catch (error) {
      log(`the hub's headers did not resolve: ${(error as Error).message}`);
      return;
    }
    if (closed || mine !== generation) return;
    const key = `${hub.url}\n${JSON.stringify(Object.entries(headers).sort())}`;
    if (changed) parked = false;
    if ((socket !== null || waiting !== null) && target === key) return;
    if (parked) return;
    drop();
    begin(hub.url, headers, key);
  }

  /** §G rule 3: an open now when no window is open, else behind the reach's answer for the hub or its floor. */
  function begin(hub: string, headers: Record<string, string>, key: string): void {
    target = key;
    if (!reach.windowOpen()) return connect(hub, headers, key);
    const wait: HubWait = waitForHub(
      reach,
      hub,
      {
        answered: () => {
          if (waiting !== wait) return;
          waiting = null;
          // the floor's open, not opened yet: the hub's answer ends it for an open of its own
          const floorOpen = socket;
          socket = null;
          floorOpen?.terminate();
          connect(hub, headers, key);
        },
        floor: () => {
          if (waiting === wait && socket === null) connect(hub, headers, key);
        },
      },
      log,
    );
    waiting = wait;
  }

  /** One open ended with nothing from the hub: a floor's open goes back to its wait, unpaced; any other backs off. */
  function failed(): void {
    if (waiting !== null) waiting.again();
    else retry();
  }

  function connect(hub: string, headers: Record<string, string>, key: string): void {
    const joiner = new PartJoiner(log);
    let ended = false;
    let current: WebSocketLike;
    try {
      current = makeSocket(socketUrl(hub), headers);
    } catch (error) {
      log(`the socket could not be made: ${(error as Error).message}`);
      failed();
      return;
    }
    socket = current;
    target = key;
    let listingsPages = 0;
    let listingsRecords = 0;
    const mine = () => socket === current && !closed;
    // an open made in the window is given HUB_WINDOW_OPEN_MS, so a hub whose upgrade hangs frees the socket
    let deadline: ReturnType<typeof setTimeout> | null = null;
    if (reach.windowOpen()) {
      deadline = setTimeout(() => {
        deadline = null;
        if (!mine() || open) return;
        log(`the open had no answer within ${timing.HUB_WINDOW_OPEN_MS} ms`);
        current.terminate();
        end(failed);
      }, timing.HUB_WINDOW_OPEN_MS);
      (deadline as { unref?: () => void }).unref?.();
    }
    const end = (then: () => void) => {
      if (ended) return;
      ended = true;
      if (deadline !== null) clearTimeout(deadline);
      deadline = null;
      // a socket the feed dropped (`drop`) ends as the feed's own decision: nothing to retry, nothing to tell
      if (socket !== current) return;
      const wasOpen = open;
      socket = null;
      open = false;
      pings?.stop();
      pings = null;
      if (waiting === null) target = null; // a floor's open that failed leaves its wait, and its target, standing
      if (wasOpen) tell(listeners.close);
      if (!closed) then();
    };
    /** The hub answered the upgrade: a wait still standing behind this open (the floor's) is over. */
    const heard = () => {
      if (deadline !== null) clearTimeout(deadline);
      deadline = null;
      stopWaiting();
    };
    current.on('open', () => {
      if (!mine()) return;
      heard();
      open = true;
      attempt = 0;
      pings = startPings(current, timing, () => {
        if (!mine()) return;
        log(`no pong within ${timing.HUB_PONG_MS} ms: dropped the socket`);
        drop();
        void reconcile(false);
      });
      log(`connected to ${new URL(hub).host}`);
      tell(listeners.open);
    });
    current.on('message', (text) => {
      if (!mine()) return;
      let frame: Record<string, unknown> | undefined;
      try {
        const parsed: unknown = JSON.parse(text);
        frame = isObject(parsed) ? joiner.add(parsed) : undefined;
      } catch {
        return;
      }
      if (frame === undefined) return;
      if (frame.t === 'state' && typeof frame.version === 'number' && Number.isInteger(frame.version)) tell(listeners.state, frame.version);
      else if (frame.t === 'listings' && Array.isArray(frame.records)) {
        const page = { records: frame.records as Signed<Listing>[], last: frame.last === true };
        listingsPages++;
        listingsRecords += page.records.length;
        if (page.last) {
          log(`listings: last page, ${listingsRecords} records in ${listingsPages} pages`);
          listingsPages = listingsRecords = 0;
        }
        tell(listeners.listings, page);
      } else if (frame.t === 'listing' && isObject(frame.record)) tell(listeners.listing, frame.record as unknown as Signed<Listing>);
    });
    current.on('close', (code) =>
      end(() => {
        if (code === CLOSE_REMOVED) {
          parked = true;
          log('the hub closed the feed 4403: it no longer admits this member');
          tell(listeners.removed);
        } else {
          failed();
        }
      }),
    );
    current.on('refused', (status, answer) => {
      if (mine()) heard();
      end(() => {
        const fromWorker = answer[BUILD_HEADER] !== undefined;
        if (!fromWorker && (status === 401 || status === 403 || (status >= 300 && status < 400))) {
          parked = true;
          log(`Access answered the upgrade ${status}: the hub sign-in has ended`);
          tell(listeners.credentials);
        } else if (fromWorker && status === 403) {
          parked = true;
          log('the hub refused the upgrade 403: it no longer admits this member');
          tell(listeners.removed);
        } else {
          log(`the upgrade was answered ${status}`);
          retry();
        }
      });
    });
    current.on('error', (error) => {
      if (mine()) log(`socket error: ${error.message}`);
      // a 'close' follows an error on an opened socket; one that never opened gets none from every stack
      if (!open) end(failed);
    });
  }

  /** `probe()`, and a wake under WAKE_DROP_MS (§G rules 1 and 4): an open socket pinged now; with none, today's reconnect. */
  function probe(what: string): void {
    if (closed || parked) return;
    if (pings !== null) {
      log(`${what}: ping sent`);
      pings.ping();
    } else if (socket !== null || waiting !== null) {
      log(`${what}: opening`);
    } else {
      log(`${what}: no socket`);
      attempt = 0;
      clearTimer();
      void reconcile(false);
    }
  }

  /** §G rule 1: at WAKE_DROP_MS or more, the window opened and the socket dropped, then opened again from the first step. */
  function woke({ sleptMs }: WakeNotice): void {
    if (closed) return;
    if (parked) return void log(`wake after ${sleptMs} ms: parked`);
    if (sleptMs < WAKE_DROP_MS) return probe(`wake after ${sleptMs} ms`);
    reach.openWindow('wake');
    log(`wake after ${sleptMs} ms: ${socket !== null ? 'dropped the socket' : 'no socket'}`);
    drop();
    attempt = 0;
    void reconcile(false);
  }

  const unsubscribe = deps.session.onChanged(() => void reconcile(true));
  const offWake = deps.wake?.onWake(woke);
  const offUnlock = deps.wake?.onUnlock(() => probe('probe'));
  void reconcile(true);

  return {
    onOpen: subscribe(listeners.open),
    onClose: subscribe(listeners.close),
    onState: subscribe(listeners.state),
    onRemoved: subscribe(listeners.removed),
    onCredentialsEnded: subscribe(listeners.credentials),
    onListings: subscribe(listeners.listings),
    onListing: subscribe(listeners.listing),
    connected: () => open,
    probe: () => probe('probe'),
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      offWake?.();
      offUnlock?.();
      drop();
    },
  };
}
