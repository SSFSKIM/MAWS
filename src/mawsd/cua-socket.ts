// The daemon's per-session cua sockets (P5 O5 M5; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §H;
// P5 §6, survey §7.5): every lane B launch is told `mawsd`'s own socket for its session, `<cua dir>/<appSessionId>.sock`
// (@shared/daemon/files' cuaSocketDir, @shared/browser/cua-socket's daemonCuaSocketPath), stable for the session's life,
// so an engine launched with no app, or one whose app quit and came back (D-16), keeps the path it was told.
//
// Not listening is the refusal: a session's socket listens only while a tab engine is attached (`target`, the attached
// app's own cua directory from its `machine.client`), and stops at its departure, so cua's host (which lists a backend
// only after its hello and retries an unreachable one every 5 s) reads "no browser" with no protocol of its own. An
// accepted socket is held unread until its peer runs as this user and descends from the session's engine (`engineProcess`,
// from each raw `session.status`), waiting PEER_ROOT_WAIT_MS for an engine not known
// yet, through the peer identity addon the app loads (src/main/browser/cua/peer.ts); where no addon exists for the
// platform (Linux) the socket is 0600 in a 0700 directory and the uid is the boundary (O2), one line per socket saying
// so; where it should exist and did not load, every peer is refused, one line per socket. A peer let in is relayed: the
// daemon connects, from its own process (the app admits it by the daemon's exact instance), to the app's socket for the
// session, waiting a bounded while for it to listen, and pipes bytes both ways unparsed; the pair ends together. A tab
// engine's departure or replacement ends every relayed connection, so cua's host sees the loss and retries; so does the
// session's engine's, for the pairs checked against it (a connect still retrying among them).
//
// P5 O17 M1 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §B, §C): with no app attached, a session
// whose route is `cold`, `starting` or `headless` (`cold`, the route's readings: M5's browser-route.ts, a stub before)
// listens while its engine is live (`starting` regardless), and a peer the same check admits is handed to the cold
// broker (cua-broker.ts), a chunk loaded at the first such peer and never before: not at start, at a listen, at an
// app's attachment or at a capability read. What the broker serves under one epoch, or checked against one engine,
// ends when the route or the engine moves on, as a relayed pair does. PENDING_BUDGET counts the broker's promotions
// waiting for the render host beside the peer-root waits: one counter (D2).
//
// P5 O17 M5 (§B): in `headless` a newly admitted peer is relayed straight to the render host's socket for the session
// (`target`), as a peer is to the app's, never through the broker; a relayed pair is its epoch's, and ends when the
// route's epoch moves on.
import { chmodSync, readdirSync, rmSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { cuaSocketPath, daemonCuaSocketPath } from '@shared/browser/cua-socket';
import type { AppSessionId } from '@shared/graph/ids';
import { clearSocketPath, makePrivateDirectory } from '@shared/host/private-listen';
import { assertPrivateSocket } from '@shared/host/private-path';
import { authorizePeer, PEER_ROOT_WAIT_MS, rootOf, socketFd, type PeerAddon, type PeerRefusal, type ProcessRoot } from '../main/browser/cua/peer';
import type { BrowserDemand, BrowserRouteReading, BrowserTarget, CuaBroker, CuaBrokerInspection, CuaBrokerLimits } from './cua-broker'; // types alone: the chunk loads at the first admitted cold peer

export type CuaBrokerChunk = typeof import('./cua-broker');
export const loadCuaBroker = (): Promise<CuaBrokerChunk> => import('./cua-broker');

export const RELAY_CONNECT_WAIT_MS = 3_000; // how long a checked peer waits for the app's socket for its session to listen
const RELAY_RETRY_MS = 100;
// Sockets held unread while their session's engine is not known yet (each a descriptor and a timer, PEER_ROOT_WAIT_MS at
// most), per session and across the daemon: a session's engine starts one `cua serve`, so a few cover it; the excess is
// refused at once. P5 O17 M1: the cold broker's promotions waiting for the render host take their places from the same
// count (the section's CUA_PROMOTION_BUDGET, D2), a trigger past it answered with the reason
export const PENDING_BUDGET = { session: 8, total: 64 };

// P5 O17 M1: what the cold path reads of a session's route (§B) while no app is attached; M5's browser-route.ts and
// RenderHandle.ensureBrowser in production, a stub until then. Absent, no session is ever cold (O5 M5's behaviour).
export interface CuaColdRoute {
  machine: string; // in the broker's reasons
  version: string; // MAWS's, in the broker's hello
  reading(appSessionId: AppSessionId): BrowserRouteReading;
  live(appSessionId: AppSessionId): boolean; // §B's *live*: the session's engine process is live
  ensureBrowser(demand: BrowserDemand): Promise<BrowserTarget>;
  target?(appSessionId: AppSessionId): string | null; // P5 O17 M5: in `headless`, the render host's socket for the session (§D)
  brokerLimits?: Partial<CuaBrokerLimits>; // P5 O17 M8: the e2e start hold's longer start deadline; production passes none
}

export interface CuaSocketsOptions {
  dir: string; // the cua directory (cuaSocketDir): made 0700, swept of a dead daemon's sockets at start
  // the peer identity addon, loaded from the app's Resources as the app loads it: called once, at the first session's
  // socket or running engine, never at start (acceptance 14: an idle mawsd holds no native addon); null where none loads
  loadAddon(): PeerAddon | null;
  uidBoundary: boolean; // no addon exists for this platform (Linux): the uid is the boundary
  log(line: string): void;
  onChange?(): void; // the sockets started or stopped listening (a tab engine came or went): the browser capability
  relayConnectWaitMs?: number;
  pendingBudget?: { session: number; total: number };
  cold?: CuaColdRoute; // P5 O17 M1
  loadBroker?: () => Promise<CuaBrokerChunk>; // P5 O17 M1: the broker's chunk (a counting double in tests)
}

export interface CuaSocketInspection {
  listening: boolean;
  relayed: number; // connections relayed to a tab engine
  refused: number; // peers refused
  waiting: number; // accepted, unread, waiting for the session's engine
}

export interface CuaSockets {
  ensure(appSessionId: AppSessionId): string | null; // the path a launch is told (null past sun_path, logged once); listening follows `target`
  target(dir: string | null): void; // the attached tab engine's cua directory (the app's, from machine.client), or null: listen or stop
  tabEngine(): string | null; // the attached tab engine's cua directory; null while none is attached
  engineProcess(appSessionId: AppSessionId, pid: number | null): void; // the peer check's root, from the session's status
  // P5 O17 M5 (§B's exit): the session's kept root has this pid but the process running it now started at another time
  // (a reused pid: another engine), as the peer check reads it; read before `engineProcess` takes the new root
  incarnationChanged(appSessionId: AppSessionId, pid: number): boolean;
  remove(appSessionId: AppSessionId): void; // the session was removed: its socket and its connections go
  routeChanged(appSessionId: AppSessionId): void; // P5 O17 M1: the session's route was read anew: an older epoch's connections end; listen or stop
  sessions(): AppSessionId[];
  inspect(): Record<string, CuaSocketInspection>;
  broker(): CuaBrokerInspection | null; // P5 O17 M8: the cold broker's connections; null before its chunk loaded
  close(): void;
}

interface Pair {
  engine: Socket;
  app: Socket | null; // null while the relay's connect is under way
  epoch: string | null; // P5 O17 M5: the route's epoch it was admitted in (null with no cold route)
}

interface Session {
  path: string;
  server: Server | null; // listening while a tab engine is attached
  // accepted, unread, waiting for the engine's root; P5 O17: under the route's epoch it was accepted in (null with no
  // cold route), ended with that epoch
  pending: Map<Socket, { acceptedAt: number; timer: NodeJS.Timeout; epoch: string | null }>;
  pairs: Set<Pair>;
  relayed: number;
  refused: number;
  moduleNoted: boolean; // the line on the addon's absence, once per socket
  busyNoted: boolean; // the line on a refusal past the waiting budget, once per burst
  promoting: number; // P5 O17 M1: the broker's promotions holding a place in the pending budget
  // P5 O17 M1: checked peers held for the broker's chunk while it loads, each bound to the epoch and the engine it was
  // checked under; counted in the pending budget and ended by every teardown, as a waiting or relayed socket is
  awaiting: Map<Socket, { epoch: string; root: ProcessRoot | null }>;
}

const refusalLine = (appSessionId: string, { reason, pid }: PeerRefusal) => `cua socket of ${appSessionId}: refused peer${pid === null ? '' : ` pid ${pid}`} (${reason})`;

export function createCuaSockets(options: CuaSocketsOptions): CuaSockets {
  const { dir, log } = options;
  const relayWaitMs = options.relayConnectWaitMs ?? RELAY_CONNECT_WAIT_MS;
  makePrivateDirectory(dirname(dir));
  makePrivateDirectory(dir);
  const budget = options.pendingBudget ?? PENDING_BUDGET;
  // nothing listens at start: a dead daemon's sockets go; anything else at a socket's name is refused in place
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.sock')) continue;
    try {
      clearSocketPath(join(dir, name));
    } catch (error) {
      log(`[cua] ${join(dir, name)} is left in place: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const sessions = new Map<AppSessionId, Session>();
  const tooLong = new Set<AppSessionId>();
  const engineRoots = new Map<AppSessionId, ProcessRoot>();
  let loaded: { addon: PeerAddon | null } | null = null;
  const peerAddon = (): PeerAddon | null => (loaded ??= { addon: options.loadAddon() }).addon;
  const uid = process.getuid?.() ?? -1;
  let tabEngine: string | null = null;
  let broker: CuaBroker | null = null; // P5 O17 M1: loaded at the first admitted cold peer
  let brokerLoad: Promise<CuaBroker> | null = null;

  const rootsOf = (appSessionId: AppSessionId): ProcessRoot[] => {
    const engine = engineRoots.get(appSessionId);
    return engine ? [engine] : [];
  };
  // the pending budget's count: peer-root waits and the broker's promotions together (P5 O17 M1)
  const pendingOf = (session: Session) => session.pending.size + session.promoting + session.awaiting.size;
  const pendingTotal = () => [...sessions.values()].reduce((sum, session) => sum + pendingOf(session), 0);
  const pendingFull = (session: Session) => pendingOf(session) >= budget.session || pendingTotal() >= budget.total;
  // P5 O17 M1: the route's cold states, with no app attached; where they listen (§B)
  const coldServes = (appSessionId: AppSessionId): boolean => {
    const state = tabEngine === null && options.cold ? options.cold.reading(appSessionId).state : null;
    return state === 'cold' || state === 'starting' || state === 'headless';
  };
  const listens = (appSessionId: AppSessionId): boolean => {
    if (tabEngine !== null) return true;
    if (!coldServes(appSessionId)) return false;
    return options.cold!.reading(appSessionId).state === 'starting' || options.cold!.live(appSessionId);
  };
  const sameRoot = (a: ProcessRoot | null, b: ProcessRoot | null) => a?.pid === b?.pid && a?.start === b?.start;
  // P5 O17: the route's epoch, the period a peer is admitted in (§B; null with no cold route, O5 M5's relay alone)
  const epochOf = (appSessionId: AppSessionId): string | null => options.cold?.reading(appSessionId).epoch ?? null;
  // The sockets waiting for their engine's root, those `keep` does not keep ended (P5 O17: by the epoch they were accepted in)
  const endPending = (session: Session, keep: (epoch: string | null) => boolean = () => false) => {
    for (const [socket, { timer, epoch }] of [...session.pending]) {
      if (keep(epoch)) continue;
      clearTimeout(timer);
      session.pending.delete(socket);
      socket.destroy();
    }
    if (session.pending.size === 0) session.busyNoted = false;
  };
  // P5 O17 M1: the sockets held for the broker's chunk, those `keep` does not keep ended
  const endAwaiting = (session: Session, keep: (entry: { epoch: string; root: ProcessRoot | null }) => boolean = () => false) => {
    for (const [socket, entry] of [...session.awaiting]) {
      if (keep(entry)) continue;
      session.awaiting.delete(socket);
      socket.destroy();
    }
  };
  const hasLiveRoot = (appSessionId: AppSessionId, addon: PeerAddon) => rootsOf(appSessionId).some((root) => addon.process(root.pid)?.start === root.start);

  const endPair = (pair: Pair) => {
    pair.engine.destroy();
    pair.app?.destroy();
  };

  // A checked peer, relayed to the tab engine's socket for its session; the app's socket may not listen yet (it starts
  // at the session's status in the app), so the connect is tried again until RELAY_CONNECT_WAIT_MS has passed.
  // P5 O17 M5: the tab engine is the app's, or in `headless` the render host's (`who` names it in the lines)
  const relay = (appSessionId: AppSessionId, session: Session, engine: Socket, target: string | null, epoch: string | null, who = 'the attached app') => {
    if (target === null) return void engine.destroy();
    const pair: Pair = { engine, app: null, epoch };
    session.pairs.add(pair);
    engine.on('close', () => {
      session.pairs.delete(pair);
      pair.app?.destroy();
    });
    const deadline = Date.now() + relayWaitMs;
    const retry = (why: string) => {
      if (Date.now() < deadline && !engine.destroyed && session.pairs.has(pair)) return void setTimeout(attempt, RELAY_RETRY_MS).unref();
      log(`cua socket of ${appSessionId}: ${who}'s socket did not answer (${why}): the connection is closed`);
      engine.destroy();
    };
    const attempt = () => {
      if (engine.destroyed || !session.pairs.has(pair)) return;
      // checked as every local socket a host connects to (private-path.ts): absent is not yet listening; else refused
      try {
        assertPrivateSocket(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return retry('ENOENT');
        log(`cua socket of ${appSessionId}: ${who}'s socket is refused: ${error instanceof Error ? error.message : String(error)}`);
        return void engine.destroy();
      }
      const app = connect(target);
      let connected = false;
      pair.app = app;
      app.once('connect', () => {
        connected = true;
        session.relayed += 1;
        app.on('close', () => engine.destroy());
        engine.pipe(app);
        app.pipe(engine);
      });
      app.on('error', (error: NodeJS.ErrnoException) => {
        if (connected) return void engine.destroy(); // a relayed pair's error: both end (the app's close follows)
        pair.app = null;
        retry(error.code ?? error.message);
      });
    };
    attempt();
  };

  // P5 O17 M1: the broker's chunk, loaded once (the first admitted cold peer loads it); a failed load is tried again
  const loadBroker = (): Promise<CuaBroker> => {
    const cold = options.cold!;
    brokerLoad ??= (options.loadBroker ?? loadCuaBroker)().then(
      (chunk) => {
        broker = chunk.createCuaBroker({
          machine: cold.machine,
          version: cold.version,
          route: (id) => cold.reading(id),
          ensureBrowser: (demand) => cold.ensureBrowser(demand),
          place: (id) => {
            const session = sessions.get(id);
            if (!session || pendingFull(session)) return null;
            session.promoting += 1;
            let freed = false;
            return () => void (freed || ((freed = true), (session.promoting -= 1)));
          },
          log,
          ...(cold.brokerLimits && { limits: cold.brokerLimits }),
        });
        log('[cua] the cold broker loaded');
        return broker;
      },
      (error: unknown) => {
        brokerLoad = null;
        throw error;
      },
    );
    return brokerLoad;
  };

  // P5 O17 M1: a peer let in on a cold route goes to the broker under the epoch it was checked in. While the chunk loads
  // the socket is held on its session, in the pending budget, bound to that epoch and the engine it was checked against:
  // a teardown in between ends it, and at the load it is admitted only if its session, epoch and engine are still the
  // ones it was checked under
  const toBroker = (appSessionId: AppSessionId, session: Session, socket: Socket, epoch: string) => {
    const cold = options.cold!;
    const entry = { epoch, root: engineRoots.get(appSessionId) ?? null };
    if (broker) return broker.admit(appSessionId, socket, entry.epoch);
    if (pendingFull(session)) {
      session.refused += 1;
      if (!session.busyNoted) log(`cua socket of ${appSessionId}: refused peers past the ${pendingOf(session) >= budget.session ? `session's ${budget.session}` : `daemon's ${budget.total}`} waiting for an engine or the browser`);
      session.busyNoted = true;
      return void socket.destroy();
    }
    session.awaiting.set(socket, entry);
    loadBroker().then(
      (loaded) => {
        if (!session.awaiting.delete(socket) || socket.destroyed) return; // ended while the chunk loaded
        const current = sessions.get(appSessionId) === session && coldServes(appSessionId) && cold.reading(appSessionId).epoch === entry.epoch && sameRoot(engineRoots.get(appSessionId) ?? null, entry.root);
        if (!current) return void socket.destroy(); // the session, its route or its engine moved while the chunk loaded
        loaded.admit(appSessionId, socket, entry.epoch);
      },
      (error: unknown) => {
        if (!session.awaiting.delete(socket)) return;
        log(`cua socket of ${appSessionId}: the cold broker could not load: ${error instanceof Error ? error.message : String(error)}`);
        socket.destroy();
      },
    );
  };

  // A checked peer goes to the attached app, or on a cold route to the broker under its epoch (P5 O17 M1), or in
  // `headless` straight to the render host (M5)
  const serve = (appSessionId: AppSessionId, session: Session, socket: Socket, epoch: string | null) => {
    if (tabEngine !== null) return relay(appSessionId, session, socket, cuaSocketPath(tabEngine, appSessionId), epoch);
    if (!coldServes(appSessionId) || epoch === null) return void socket.destroy();
    const headless = options.cold!.target?.(appSessionId) ?? null;
    if (headless !== null) return relay(appSessionId, session, socket, headless, epoch, 'the render host');
    toBroker(appSessionId, session, socket, epoch);
  };

  // The verdict on an accepted socket, which nothing has read yet: refused, counted and destroyed unread; let in, relayed.
  // P5 O17: only in the period it was accepted in: a socket whose route's epoch moved meanwhile (an epoch nobody
  // announced with routeChanged included) is ended unread, as the handover ends pending connections (§B)
  const decide = (appSessionId: AppSessionId, session: Session, socket: Socket, acceptedAt: number, epoch: string | null) => {
    session.pending.delete(socket);
    if (session.pending.size === 0) session.busyNoted = false;
    if (socket.destroyed) return;
    if (epoch !== epochOf(appSessionId)) return void socket.destroy();
    const addon = peerAddon();
    if (addon === null) {
      if (options.uidBoundary) {
        if (!session.moduleNoted) log(`cua socket of ${appSessionId}: no peer identity check here (module_unavailable): the uid is the boundary`);
        session.moduleNoted = true;
        return serve(appSessionId, session, socket, epoch);
      }
      if (!session.moduleNoted) log(`cua socket of ${appSessionId}: refused peers (module_unavailable; run scripts/build-peer-auth.sh)`);
      session.moduleNoted = true;
      session.refused += 1;
      return void socket.destroy();
    }
    const refusal = authorizePeer(socketFd(socket), rootsOf(appSessionId), { addon, now: acceptedAt, uid });
    if (refusal) {
      session.refused += 1;
      log(refusalLine(appSessionId, refusal));
      return void socket.destroy();
    }
    serve(appSessionId, session, socket, epoch);
  };

  const admit = (appSessionId: AppSessionId, session: Session, socket: Socket) => {
    const acceptedAt = Date.now();
    const epoch = epochOf(appSessionId); // P5 O17: the period it is admitted in
    socket.on('error', () => {}); // a socket destroyed while it waits, or a relayed one's reset, reports nothing
    const addon = peerAddon();
    if (addon && !hasLiveRoot(appSessionId, addon)) {
      if (pendingFull(session)) {
        session.refused += 1;
        if (!session.busyNoted) log(`cua socket of ${appSessionId}: refused peers past the ${pendingOf(session) >= budget.session ? `session's ${budget.session}` : `daemon's ${budget.total}`} waiting for an engine or the browser`);
        session.busyNoted = true;
        return void socket.destroy();
      }
      const timer = setTimeout(() => decide(appSessionId, session, socket, acceptedAt, epoch), PEER_ROOT_WAIT_MS);
      // its place comes back at the verdict, at most PEER_ROOT_WAIT_MS on: a peer's own close is not seen on a socket
      // nothing reads (pauseOnConnect), and reading it before the check is what the check exists to prevent
      session.pending.set(socket, { acceptedAt, timer, epoch });
      return;
    }
    decide(appSessionId, session, socket, acceptedAt, epoch);
  };

  const listen = (appSessionId: AppSessionId, session: Session) => {
    const server = createServer({ pauseOnConnect: true }, (socket) => admit(appSessionId, session, socket));
    server.on('error', (error) => log(`cua socket of ${appSessionId}: ${error.message}`));
    try {
      clearSocketPath(session.path); // a dead listener's socket goes; anything else at the path is refused in place
    } catch (error) {
      return log(`cua socket of ${appSessionId}: not listening: ${error instanceof Error ? error.message : String(error)}`);
    }
    server.listen(session.path, () => {
      try {
        chmodSync(session.path, 0o600); // in a 0700 directory already; owner-only as every local socket
      } catch (error) {
        log(`cua socket of ${appSessionId} could not be made owner-only: ${(error as Error).message}`);
      }
    });
    session.server = server;
  };

  // Stops listening: waiting sockets destroyed, relayed and cold connections ended, the file unlinked (the path is kept).
  const quiet = (appSessionId: AppSessionId, session: Session) => {
    if (session.server) {
      session.server.close();
      session.server = null;
      rmSync(session.path, { force: true });
    }
    endPending(session);
    for (const pair of [...session.pairs]) endPair(pair);
    session.pairs.clear();
    endAwaiting(session); // P5 O17 M1
    broker?.end(appSessionId); // P5 O17 M1
  };

  // P5 O17 M1: listening follows the route while no app is attached
  const settle = (appSessionId: AppSessionId, session: Session) => {
    if (listens(appSessionId)) {
      if (!session.server) listen(appSessionId, session);
    } else if (session.server) quiet(appSessionId, session);
  };

  return {
    ensure(appSessionId) {
      const existing = sessions.get(appSessionId);
      if (existing) return existing.path;
      const path = daemonCuaSocketPath(dir, appSessionId);
      if (path === null) {
        if (!tooLong.has(appSessionId)) log(`the cua socket path of ${appSessionId} is longer than a Unix socket allows (${Buffer.byteLength(join(dir, `${appSessionId}.sock`))} bytes): cua cannot reach this session's browser`);
        tooLong.add(appSessionId);
        return null;
      }
      peerAddon(); // the first socket loads the addon its peer check needs, before anything can connect
      const session: Session = { path, server: null, pending: new Map(), pairs: new Set(), relayed: 0, refused: 0, moduleNoted: false, busyNoted: false, promoting: 0, awaiting: new Map() };
      sessions.set(appSessionId, session);
      if (listens(appSessionId)) listen(appSessionId, session);
      return path;
    },
    target(next) {
      if (next === tabEngine) return;
      const had = tabEngine !== null;
      tabEngine = next;
      for (const [appSessionId, session] of sessions) {
        for (const pair of [...session.pairs]) endPair(pair); // relayed to a tab engine that is no longer the attached one
        endAwaiting(session); // P5 O17 M1: bound for the broker, which the change of tab engine replaces
        broker?.end(appSessionId); // P5 O17 M1: served cold, which an attached app replaces
        if (next === null) settle(appSessionId, session); // P5 O17 M1: a cold route keeps listening
        else if (!session.server) listen(appSessionId, session);
      }
      const cold = next === null ? [...sessions.values()].filter((session) => session.server !== null).length : 0;
      log(
        next !== null
          ? `[cua] a tab engine is attached (${next}): the sessions' sockets listen`
          : cold === 0
            ? "[cua] no tab engine is attached: the sessions' sockets stop listening"
            : `[cua] no tab engine is attached: ${cold} of the sessions' sockets keep listening on their cold route, the others stop`,
      );
      if (had !== (next !== null)) options.onChange?.();
    },
    tabEngine: () => tabEngine,
    incarnationChanged(appSessionId, pid) {
      const was = engineRoots.get(appSessionId);
      if (was?.pid !== pid) return false; // none kept, or another pid (the route sees that one itself)
      const addon = peerAddon();
      const root = addon ? rootOf(pid, addon) : null;
      return root !== null && root.start !== was.start;
    },
    engineProcess(appSessionId, pid) {
      const addon = pid === null ? null : peerAddon();
      const root = pid === null || !addon ? null : rootOf(pid, addon);
      const was = engineRoots.get(appSessionId);
      if (root) engineRoots.set(appSessionId, root);
      else engineRoots.delete(appSessionId);
      const session = sessions.get(appSessionId);
      // what was checked against the engine is that engine's: its pairs, a connect still retrying among them, end with it
      // (the app sees only the daemon, so it cannot hold the next engine's boundary itself)
      if (session && was && (root?.pid !== was.pid || root.start !== was.start)) {
        for (const pair of [...session.pairs]) endPair(pair);
        endAwaiting(session); // P5 O17 M1: checked against it, still waiting for the broker's chunk
        broker?.end(appSessionId); // P5 O17 M1: the broker's connections were checked against it too
      }
      if (!root || !session) return;
      for (const [socket, { acceptedAt, timer, epoch }] of [...session.pending]) {
        clearTimeout(timer);
        decide(appSessionId, session, socket, acceptedAt, epoch);
      }
    },
    remove(appSessionId) {
      engineRoots.delete(appSessionId);
      tooLong.delete(appSessionId);
      const session = sessions.get(appSessionId);
      if (!session) return;
      sessions.delete(appSessionId);
      quiet(appSessionId, session);
    },
    routeChanged(appSessionId) {
      const session = sessions.get(appSessionId);
      if (!session) return;
      const epoch = epochOf(appSessionId);
      endPending(session, (accepted) => accepted === epoch); // P5 O17: an older epoch's, still waiting for its engine's root
      endAwaiting(session, (entry) => entry.epoch === epoch); // P5 O17 M1: an older epoch's, still waiting for the chunk
      for (const pair of [...session.pairs]) if (pair.epoch !== epoch) endPair(pair); // P5 O17 M5: relayed under an older epoch
      broker?.routeChanged(appSessionId);
      if (tabEngine === null) settle(appSessionId, session);
    },
    sessions: () => [...sessions.keys()],
    inspect: () => Object.fromEntries([...sessions].map(([appSessionId, session]) => [appSessionId, { listening: session.server !== null, relayed: session.relayed, refused: session.refused, waiting: session.pending.size }])),
    broker: () => broker?.inspect() ?? null,
    close() {
      for (const [appSessionId, session] of sessions) quiet(appSessionId, session);
      broker?.close();
      sessions.clear();
      engineRoots.clear();
    },
  };
}
