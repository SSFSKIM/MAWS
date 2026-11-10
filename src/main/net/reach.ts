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
import { connect as netConnect } from 'node:net';
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

type Waiter = { answer(reachable: boolean): void };
type Probe = { controller: AbortController; startedAt: number };
/** One key's round of waiting: from its first waiter to the answer, or to its last waiter leaving. */
type Round = {
  key: string;
  host: string;
  port: number;
  waiters: Set<Waiter>;
  probes: Set<Probe>;
  started: number; // probes started in the round
  startedAt: number;
  lastError: unknown;
  ticker: ReturnType<typeof setInterval>;
};

const NO_PROBE_ENDED = 'no probe ended';

export function createReach(deps: { connect?: Connect; now?(): number; log(line: string): void }): Reach {
  const connect = deps.connect ?? tcpConnect;
  const now = deps.now ?? Date.now;
  const rounds = new Map<string, Round>();
  let windowTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const destroy = (round: Round, probe: Probe) => {
    round.probes.delete(probe);
    probe.controller.abort();
  };

  /** Ends a round: its probes destroyed, its ticker stopped, every waiter still in it answered. */
  const end = (round: Round, reachable: boolean) => {
    clearInterval(round.ticker);
    for (const probe of [...round.probes]) destroy(round, probe);
    rounds.delete(round.key);
    for (const waiter of [...round.waiters]) waiter.answer(reachable);
    round.waiters.clear();
  };

  const startProbe = (round: Round) => {
    const probe: Probe = { controller: new AbortController(), startedAt: now() };
    round.probes.add(probe);
    round.started += 1;
    connect(round.host, round.port, probe.controller.signal).then(
      () => {
        if (!round.probes.has(probe)) return; // destroyed already: its round ended, or its 3 s ran out
        deps.log(`[reach] ${round.key}: reachable after ${round.started} probes, ${now() - round.startedAt} ms`);
        end(round, true);
      },
      (error: unknown) => {
        if (!round.probes.has(probe)) return;
        round.probes.delete(probe);
        round.lastError = error;
      },
    );
  };

  /** A stagger's tick: every probe that has had its PROBE_CONNECT_MS is destroyed first, so at most thirty are ever in flight. */
  const tick = (round: Round) => {
    const at = now();
    for (const probe of [...round.probes]) {
      if (at - probe.startedAt < PROBE_CONNECT_MS) continue;
      destroy(round, probe);
      round.lastError = new Error(`no connect within ${PROBE_CONNECT_MS} ms`);
    }
    startProbe(round);
  };

  const closeWindow = (log: boolean) => {
    if (windowTimer !== null) clearTimeout(windowTimer);
    windowTimer = null;
    for (const round of [...rounds.values()]) {
      if (log) {
        const why = round.lastError === null ? NO_PROBE_ENDED : errorWords(round.lastError);
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
          const fresh: Round = { ...where, waiters: new Set(), probes: new Set(), started: 0, startedAt: now(), lastError: null, ticker: setInterval(() => tick(fresh), PROBE_STAGGER_MS) };
          rounds.set(where.key, fresh);
          round = fresh;
          startProbe(fresh);
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
