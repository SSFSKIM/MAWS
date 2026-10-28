// The app's Registry feed (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §F; OX8): the
// hub's `?app=1` socket held for whichever org session main runs. It hands the session the hub's `state {version}`
// notices (the session reads and verifies the chain itself) and M2 the listings (`listings` pages, then each `listing`);
// the hub's frames carry nothing trusted. A frame over 1 MiB arrives as numbered parts and is joined here; a frame of any
// other kind (`grid`, `summary`, anything new) is ignored.
//
// The socket is held while `session.current()?.hub` is non-null, and opened again when a change of the session changes
// the hub's address or headers. It reconnects on FEED_BACKOFF_MS, jittered, and at once on `probe()` (main wires the
// wake and unlock to it). Two ends wait for the session's next change instead: a `4403` close (the hub no longer admits
// the member; the session reads `denied`), and an upgrade refused by Access rather than the Worker (no `X-Desk-Build`: the
// credential has ended). A Worker's own 403 on the upgrade (`not-a-member`) is the first of those.
import WebSocket from 'ws';
import type { Listing, Signed } from '../../../apps/org-protocol/src/index.ts';
import { BUILD_HEADER } from './hub-client';
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
  close(): void;
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

function wsSocket(url: string, headers: Record<string, string>): WebSocketLike {
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
    },
    close: () => socket.close(1000, 'done'),
  } as WebSocketLike;
}

export function createRegistryFeed(deps: {
  session: OrgSession;
  socket?: (url: string, headers: Record<string, string>) => WebSocketLike;
  timing?: Partial<OrgTiming>;
  random?(): number;
  log(line: string): void;
}): RegistryFeed {
  const timing = orgTiming(deps.timing);
  const random = deps.random ?? Math.random;
  const log = (line: string) => deps.log(`[org-feed] ${line}`);
  const makeSocket = deps.socket ?? wsSocket;
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
  /** The hub and headers the socket was opened with (or is being opened with). */
  let target: string | null = null;
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
  /** Ends the feed's socket by its own decision; one that was open is told as closed (but not on `close()`). */
  const drop = () => {
    clearTimer();
    const held = socket;
    const wasOpen = open;
    socket = null;
    open = false;
    target = null;
    held?.close();
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
    if (socket !== null && target === key) return;
    if (parked) return;
    drop();
    connect(hub.url, headers, key);
  }

  function connect(hub: string, headers: Record<string, string>, key: string): void {
    const joiner = new PartJoiner(log);
    let ended = false;
    let current: WebSocketLike;
    try {
      current = makeSocket(socketUrl(hub), headers);
    } catch (error) {
      log(`the socket could not be made: ${(error as Error).message}`);
      retry();
      return;
    }
    socket = current;
    target = key;
    const mine = () => socket === current && !closed;
    const end = (then: () => void) => {
      if (ended) return;
      ended = true;
      // a socket the feed dropped (`drop`) ends as the feed's own decision: nothing to retry, nothing to tell
      if (socket !== current) return;
      const wasOpen = open;
      socket = null;
      open = false;
      target = null;
      if (wasOpen) tell(listeners.close);
      if (!closed) then();
    };
    current.on('open', () => {
      if (!mine()) return;
      open = true;
      attempt = 0;
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
      else if (frame.t === 'listings' && Array.isArray(frame.records)) tell(listeners.listings, { records: frame.records as Signed<Listing>[], last: frame.last === true });
      else if (frame.t === 'listing' && isObject(frame.record)) tell(listeners.listing, frame.record as unknown as Signed<Listing>);
    });
    current.on('close', (code) =>
      end(() => {
        if (code === CLOSE_REMOVED) {
          parked = true;
          log('the hub closed the feed 4403: it no longer admits this member');
          tell(listeners.removed);
        } else {
          retry();
        }
      }),
    );
    current.on('refused', (status, answer) =>
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
      }),
    );
    current.on('error', (error) => {
      if (mine()) log(`socket error: ${error.message}`);
      // a 'close' follows an error on an opened socket; one that never opened gets none from every stack
      if (!open) end(retry);
    });
  }

  const unsubscribe = deps.session.onChanged(() => void reconcile(true));
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
    probe() {
      if (closed || socket !== null || parked) return;
      attempt = 0;
      clearTimer();
      void reconcile(false);
    },
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      drop();
    },
  };
}
