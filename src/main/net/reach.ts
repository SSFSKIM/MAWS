// P5 O15 M2b §E (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): the burst window and the probes that find
// a path after a wake or an address change. For REACH_WINDOW_MS from an opening, whoever waits on a target learns the
// moment its path answers a bare TCP connect: a probe at once, then one every PROBE_STAGGER_MS, each given
// PROBE_CONNECT_MS. The first that connects is closed and is the signal; nothing is sent on it. A probe and not the
// open itself, because the direct listener charges its per-source bucket at every upgrade request and the hub pays an
// Access check and a registry read (and on the feed a whole snapshot) for every open; a TCP connect that closes costs
// neither, since it never becomes an upgrade. The probe's socket is never handed on: the WebSocket client takes a
// ready socket only through its HTTP request's options, and the dial inside the window would then differ from the one
// outside it.
//
// A target's host and port are its key, so the hub's URL as a link, the feed and a project socket give it is one
// prober. The links (§F), the feed and the project sockets (§G) are its users; this module knows none of them.
//
// A probe connects to an address and never to a name, since a socket's deadline cannot cancel the lookup a connect to
// a name starts, and a stalled resolver would pile lookups onto libuv's four threads, which main's file work and the
// real dial's own lookup share. A host that is an IP literal is connected to as it is. A name is looked up by the reach,
// with at most one lookup of it outstanding at any instant: a round that needs it while one is outstanding, its own or a
// round's that has ended, takes that one's answer. The round probes the addresses of its last answer in turn, the two
// families alternating, and looks the name up again when a lookup fails (at the next tick) or when a probe to each of
// those addresses has failed since the answer came, probing them meanwhile.
import { lookup as dnsLookup } from 'node:dns/promises';
import { connect as netConnect, isIP } from 'node:net';
import { errorWords } from '@shared/host/error-words';

export const REACH_WINDOW_MS = 60_000;
export const PROBE_STAGGER_MS = 100;
export const PROBE_CONNECT_MS = 3_000;
export const WINDOW_FLOOR_MS = 10_000; // §F row 8, §G rule 3

export interface Reach {
  /** Opens the window for REACH_WINDOW_MS from now; called while it is open, the count starts again. */
  openWindow(reason: 'wake' | 'network'): void;
  windowOpen(): boolean;
  /**
   * true at the first TCP connect to `target`'s host and port that succeeds while the window is open; false at once
   * when the window is not open, false when it closes first or `signal` aborts.
   */
  reachable(target: string, signal?: AbortSignal): Promise<boolean>;
  close(): void;
}

type Connect = (host: string, port: number, signal: AbortSignal) => Promise<void>;
type LookupAddress = { address: string; family: number };
type Lookup = (host: string) => Promise<readonly LookupAddress[]>;

/** Every address of a name, as `dns.lookup` gives them with `all: true`. */
const allAddresses: Lookup = (host) => dnsLookup(host, { all: true });

/** One TCP connect: resolves at 'connect', rejects at 'error'; an abort, before or after the connect, destroys the socket. */
const tcpConnect: Connect = (host, port, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const socket = netConnect({ host, port });
    socket.once('connect', () => resolve());
    socket.on('error', reject); // after the connect, an error only ends a socket that is about to be destroyed
    signal.addEventListener(
      'abort',
      () => {
        socket.destroy();
        reject(signal.reason);
      },
      { once: true },
    );
  });

const SCHEME_PORTS: Record<string, number> = { 'ws:': 80, 'http:': 80, 'wss:': 443, 'https:': 443 };

/** A target's key and where its probes go; a target that is not a ws, wss, http or https URL is a TypeError. */
function keyOf(target: string): { key: string; host: string; port: number } {
  const url = new URL(target); // a TypeError for a string that is no URL
  const schemePort = SCHEME_PORTS[url.protocol];
  if (schemePort === undefined) throw new TypeError(`not a ws, wss, http or https URL: ${url.protocol}`);
  const port = url.port === '' ? schemePort : Number(url.port);
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1'); // an IPv6 literal without its brackets, as node:net takes it
  return { key: `${url.hostname}:${port}`, host, port };
}

/** The order a round's probes take an answer's addresses in: its two families alternating, each in the answer's order. */
function interleaved(answer: readonly LookupAddress[]): readonly string[] {
  const first = answer.filter((entry) => entry.family === answer[0]?.family).map((entry) => entry.address);
  const other = answer.filter((entry) => entry.family !== answer[0]?.family).map((entry) => entry.address);
  const order: string[] = [];
  for (let k = 0; k < Math.max(first.length, other.length); k++) {
    if (k < first.length) order.push(first[k]!);
    if (k < other.length) order.push(other[k]!);
  }
  return order;
}

type Waiter = { answer(reachable: boolean): void };
type Probe = { address: string; controller: AbortController; deadline: ReturnType<typeof setTimeout> };
/** One key's round of waiting: from its first waiter to the answer, or to its last waiter leaving. */
type Round = {
  key: string;
  host: string;
  port: number;
  named: boolean; // the host is a name, looked up, and not an IP literal
  addresses: readonly string[]; // where probes go: the host itself for a literal, the last answer's for a name
  next: number; // the index in `addresses` of the next probe's
  failed: Set<string>; // the addresses a probe to has failed since the last answer: all of them, and the name is looked up again
  looking: boolean; // the round waits on a lookup of its name
  waiters: Set<Waiter>;
  probes: Set<Probe>;
  started: number; // probes started in the round
  startedAt: number;
  owed: boolean; // a tick found thirty in flight: the next probe starts as soon as one of them ends
  lastError: unknown;
  ticker: ReturnType<typeof setInterval>;
};

const NO_PROBE_ENDED = 'no probe ended';
const MAX_IN_FLIGHT = PROBE_CONNECT_MS / PROBE_STAGGER_MS; // thirty

export function createReach(deps: { connect?: Connect; lookup?: Lookup; now?(): number; log(line: string): void }): Reach {
  const connect = deps.connect ?? tcpConnect;
  const lookup = deps.lookup ?? allAddresses;
  const now = deps.now ?? Date.now;
  const rounds = new Map<string, Round>();
  const lookups = new Map<string, Promise<readonly LookupAddress[]>>(); // by name, each outstanding lookup; one at most a name
  let windowTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const destroy = (round: Round, probe: Probe) => {
    round.probes.delete(probe);
    clearTimeout(probe.deadline);
    probe.controller.abort();
  };

  /**
   * The round waits on a lookup of its name: the one outstanding, a round's that has ended included, or a new one. An
   * answer that comes after the round ended is dropped.
   */
  const resolveName = (round: Round) => {
    if (round.looking) return;
    round.looking = true;
    let pending = lookups.get(round.host);
    if (pending === undefined) {
      pending = lookup(round.host).finally(() => lookups.delete(round.host));
      lookups.set(round.host, pending);
    }
    const answered = (apply: () => void) => {
      if (rounds.get(round.key) !== round) return;
      round.looking = false;
      apply();
    };
    pending.then(
      (answer) =>
        answered(() => {
          const first = round.addresses.length === 0;
          round.addresses = interleaved(answer);
          round.next = 0;
          round.failed.clear();
          if (first) tick(round); // a name that resolves late is probed from its answer on
        }),
      (error: unknown) => answered(() => void (round.lastError = error)), // the next tick looks it up again
    );
  };

  /** A probe of a round still waiting has ended without connecting. */
  const probeFailed = (round: Round, probe: Probe) => {
    if (round.named && round.addresses.includes(probe.address)) {
      round.failed.add(probe.address);
      if (round.failed.size === round.addresses.length) resolveName(round); // its addresses have stopped answering
    }
    if (!round.owed) return; // a tick the cap held back starts now
    round.owed = false;
    tick(round);
  };

  /** Ends a round: its probes destroyed, its ticker stopped, every waiter still in it answered. */
  const end = (round: Round, reachable: boolean) => {
    clearInterval(round.ticker);
    for (const probe of [...round.probes]) destroy(round, probe);
    rounds.delete(round.key);
    for (const waiter of [...round.waiters]) waiter.answer(reachable);
    round.waiters.clear();
  };

  // Each probe's PROBE_CONNECT_MS is its own timer, so a correction of the wall clock neither shortens nor lengthens it.
  function startProbe(round: Round, address: string): void {
    const probe: Probe = {
      address,
      controller: new AbortController(),
      deadline: setTimeout(() => {
        destroy(round, probe);
        round.lastError = new Error(`no connect within ${PROBE_CONNECT_MS} ms`);
        probeFailed(round, probe);
      }, PROBE_CONNECT_MS),
    };
    round.probes.add(probe);
    round.started += 1;
    connect(address, round.port, probe.controller.signal).then(
      () => {
        if (!round.probes.has(probe)) return; // destroyed already: its round ended, or its 3 s ran out
        deps.log(`[reach] ${round.key}: reachable after ${round.started} probes, ${now() - round.startedAt} ms`);
        end(round, true);
      },
      (error: unknown) => {
        if (!round.probes.has(probe)) return;
        round.probes.delete(probe);
        clearTimeout(probe.deadline);
        round.lastError = error;
        probeFailed(round, probe);
      },
    );
  }

  /**
   * A stagger's tick starts a probe unless thirty are in flight, or looks the name up when the round has no address. A
   * tick due in the same millisecond as the oldest probe's deadline may run first, whatever order the timers fire in;
   * it is then owed, and starts at that deadline.
   */
  function tick(round: Round): void {
    const address: string | undefined = round.addresses[round.next % round.addresses.length]; // none for a name not resolved yet
    if (address === undefined) resolveName(round);
    else if (round.probes.size >= MAX_IN_FLIGHT) round.owed = true;
    else {
      round.next += 1;
      startProbe(round, address);
    }
  }

  const closeWindow = (log: boolean) => {
    if (windowTimer !== null) clearTimeout(windowTimer);
    windowTimer = null;
    for (const round of [...rounds.values()]) {
      if (log) {
        const why =
          round.lastError !== null ? errorWords(round.lastError) : round.started === 0 ? `no answer from the lookup of ${round.host}` : NO_PROBE_ENDED;
        deps.log(`[reach] ${round.key}: window closed after ${round.started} probes, none connected (${why})`);
      }
      end(round, false);
    }
  };

  return {
    openWindow(reason) {
      if (closed) return;
      if (windowTimer !== null) clearTimeout(windowTimer);
      windowTimer = setTimeout(() => closeWindow(true), REACH_WINDOW_MS);
      (windowTimer as { unref?: () => void }).unref?.();
      deps.log(`[reach] window open for ${REACH_WINDOW_MS / 1_000} s (${reason})`);
    },
    windowOpen: () => windowTimer !== null,
    reachable(target, signal) {
      let where: ReturnType<typeof keyOf>;
      try {
        where = keyOf(target);
      } catch (error) {
        return Promise.reject(error);
      }
      if (windowTimer === null || signal?.aborted) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        let round = rounds.get(where.key);
        if (round === undefined) {
          const named = isIP(where.host) === 0;
          const fresh: Round = {
            ...where,
            named,
            addresses: named ? [] : [where.host],
            next: 0,
            failed: new Set(),
            looking: false,
            waiters: new Set(),
            probes: new Set(),
            started: 0,
            startedAt: now(),
            owed: false,
            lastError: null,
            ticker: setInterval(() => tick(fresh), PROBE_STAGGER_MS),
          };
          rounds.set(where.key, fresh);
          round = fresh;
          tick(fresh);
        }
        const inRound = round;
        const leave = () => {
          inRound.waiters.delete(waiter);
          resolve(false);
          if (inRound.waiters.size === 0) end(inRound, false); // the last waiter left: the key is probed no more
        };
        const waiter: Waiter = {
          answer(reachable) {
            signal?.removeEventListener('abort', leave);
            resolve(reachable);
          },
        };
        inRound.waiters.add(waiter);
        signal?.addEventListener('abort', leave, { once: true });
      });
    },
    close() {
      closed = true;
      closeWindow(false);
    },
  };
}

/** A reach whose window never opens: every `reachable` is false at once, and a link or a feed given it is today's. */
export const NO_REACH: Reach = {
  openWindow: () => {},
  windowOpen: () => false,
  reachable: () => Promise.resolve(false),
  close: () => {},
};
