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
// engine's departure or replacement ends every relayed connection, so cua's host sees the loss and retries.
import { chmodSync, readdirSync, rmSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { cuaSocketPath, daemonCuaSocketPath } from '@shared/browser/cua-socket';
import type { AppSessionId } from '@shared/graph/ids';
import { clearSocketPath, makePrivateDirectory } from '@shared/host/private-listen';
import { authorizePeer, PEER_ROOT_WAIT_MS, rootOf, socketFd, type PeerAddon, type PeerRefusal, type ProcessRoot } from '../main/browser/cua/peer';

export const RELAY_CONNECT_WAIT_MS = 3_000; // how long a checked peer waits for the app's socket for its session to listen
const RELAY_RETRY_MS = 100;

export interface CuaSocketsOptions {
  dir: string; // the cua directory (cuaSocketDir): made 0700, swept of a dead daemon's sockets at start
  addon: PeerAddon | null; // the peer identity addon, loaded from the app's Resources as the app loads it
  uidBoundary: boolean; // no addon exists for this platform (Linux): the uid is the boundary
  log(line: string): void;
  onChange?(): void; // the sockets started or stopped listening (a tab engine came or went): the browser capability
  relayConnectWaitMs?: number;
}

export interface CuaSocketInspection {
  listening: boolean;
  relayed: number; // connections relayed to a tab engine
  refused: number; // peers refused
}

export interface CuaSockets {
  ensure(appSessionId: AppSessionId): string | null; // the path a launch is told (null past sun_path, logged once); listening follows `target`
  target(dir: string | null): void; // the attached tab engine's cua directory (the app's, from machine.client), or null: listen or stop
  targeted(): boolean; // a tab engine is attached
  engineProcess(appSessionId: AppSessionId, pid: number | null): void; // the peer check's root, from the session's status
  remove(appSessionId: AppSessionId): void; // the session was removed: its socket and its connections go
  sessions(): AppSessionId[];
  inspect(): Record<string, CuaSocketInspection>;
  close(): void;
}

interface Pair {
  engine: Socket;
  app: Socket | null; // null while the relay's connect is under way
}

interface Session {
  path: string;
  server: Server | null; // listening while a tab engine is attached
  pending: Map<Socket, { acceptedAt: number; timer: NodeJS.Timeout }>; // accepted, unread, waiting for the engine's root
  pairs: Set<Pair>;
  relayed: number;
  refused: number;
  moduleNoted: boolean; // the line on the addon's absence, once per socket
}

const refusalLine = (appSessionId: string, { reason, pid }: PeerRefusal) => `cua socket of ${appSessionId}: refused peer${pid === null ? '' : ` pid ${pid}`} (${reason})`;

export function createCuaSockets(options: CuaSocketsOptions): CuaSockets {
  const { dir, addon, log } = options;
  const relayWaitMs = options.relayConnectWaitMs ?? RELAY_CONNECT_WAIT_MS;
  makePrivateDirectory(dirname(dir));
  makePrivateDirectory(dir);
  for (const name of readdirSync(dir)) if (name.endsWith('.sock')) rmSync(join(dir, name), { force: true }); // nothing listens at start

  const sessions = new Map<AppSessionId, Session>();
  const tooLong = new Set<AppSessionId>();
  const engineRoots = new Map<AppSessionId, ProcessRoot>();
  const uid = process.getuid?.() ?? -1;
  let tabEngine: string | null = null;

  const rootsOf = (appSessionId: AppSessionId): ProcessRoot[] => {
    const engine = engineRoots.get(appSessionId);
    return engine ? [engine] : [];
  };
  const hasLiveRoot = (appSessionId: AppSessionId) => addon !== null && rootsOf(appSessionId).some((root) => addon.process(root.pid)?.start === root.start);

  const endPair = (pair: Pair) => {
    pair.engine.destroy();
    pair.app?.destroy();
  };

  // A checked peer, relayed to the tab engine's socket for its session; the app's socket may not listen yet (it starts
  // at the session's status in the app), so the connect is tried again until RELAY_CONNECT_WAIT_MS has passed.
  const relay = (appSessionId: AppSessionId, session: Session, engine: Socket) => {
    const target = tabEngine === null ? null : cuaSocketPath(tabEngine, appSessionId);
    if (target === null) return void engine.destroy();
    const pair: Pair = { engine, app: null };
    session.pairs.add(pair);
    engine.on('close', () => {
      session.pairs.delete(pair);
      pair.app?.destroy();
    });
    const deadline = Date.now() + relayWaitMs;
    const attempt = () => {
      if (engine.destroyed || !session.pairs.has(pair)) return;
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
        if (Date.now() < deadline && !engine.destroyed && session.pairs.has(pair)) return void setTimeout(attempt, RELAY_RETRY_MS).unref();
        log(`cua socket of ${appSessionId}: the attached app's socket did not answer (${error.code ?? error.message}): the connection is closed`);
        engine.destroy();
      });
    };
    attempt();
  };

  // The verdict on an accepted socket, which nothing has read yet: refused, counted and destroyed unread; let in, relayed.
  const decide = (appSessionId: AppSessionId, session: Session, socket: Socket, acceptedAt: number) => {
    session.pending.delete(socket);
    if (socket.destroyed) return;
    if (addon === null) {
      if (options.uidBoundary) {
        if (!session.moduleNoted) log(`cua socket of ${appSessionId}: no peer identity check here (module_unavailable): the uid is the boundary`);
        session.moduleNoted = true;
        return relay(appSessionId, session, socket);
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
    relay(appSessionId, session, socket);
  };

  const admit = (appSessionId: AppSessionId, session: Session, socket: Socket) => {
    const acceptedAt = Date.now();
    socket.on('error', () => {}); // a socket destroyed while it waits, or a relayed one's reset, reports nothing
    if (addon && !hasLiveRoot(appSessionId)) {
      const timer = setTimeout(() => decide(appSessionId, session, socket, acceptedAt), PEER_ROOT_WAIT_MS);
      session.pending.set(socket, { acceptedAt, timer });
      return;
    }
    decide(appSessionId, session, socket, acceptedAt);
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

  // Stops listening: waiting sockets destroyed, relayed connections ended, the file unlinked (the path is kept).
  const quiet = (session: Session) => {
    if (session.server) {
      session.server.close();
      session.server = null;
      rmSync(session.path, { force: true });
    }
    for (const [socket, { timer }] of session.pending) {
      clearTimeout(timer);
      socket.destroy();
    }
    session.pending.clear();
    for (const pair of [...session.pairs]) endPair(pair);
    session.pairs.clear();
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
      const session: Session = { path, server: null, pending: new Map(), pairs: new Set(), relayed: 0, refused: 0, moduleNoted: false };
      sessions.set(appSessionId, session);
      if (tabEngine !== null) listen(appSessionId, session);
      return path;
    },
    target(next) {
      if (next === tabEngine) return;
      const had = tabEngine !== null;
      tabEngine = next;
      for (const [appSessionId, session] of sessions) {
        if (next === null) quiet(session);
        else {
          for (const pair of [...session.pairs]) endPair(pair); // relayed to a tab engine that is no longer the attached one
          if (!session.server) listen(appSessionId, session);
        }
      }
      log(next === null ? '[cua] no tab engine is attached: the sessions\' sockets stop listening' : `[cua] a tab engine is attached (${next}): the sessions' sockets listen`);
      if (had !== (next !== null)) options.onChange?.();
    },
    targeted: () => tabEngine !== null,
    engineProcess(appSessionId, pid) {
      const root = pid === null || !addon ? null : rootOf(pid, addon);
      if (root) engineRoots.set(appSessionId, root);
      else engineRoots.delete(appSessionId);
      const session = sessions.get(appSessionId);
      if (!root || !session) return;
      for (const [socket, { acceptedAt, timer }] of [...session.pending]) {
        clearTimeout(timer);
        decide(appSessionId, session, socket, acceptedAt);
      }
    },
    remove(appSessionId) {
      engineRoots.delete(appSessionId);
      tooLong.delete(appSessionId);
      const session = sessions.get(appSessionId);
      if (!session) return;
      sessions.delete(appSessionId);
      quiet(session);
    },
    sessions: () => [...sessions.keys()],
    inspect: () => Object.fromEntries([...sessions].map(([appSessionId, session]) => [appSessionId, { listening: session.server !== null, relayed: session.relayed, refused: session.refused }])),
    close() {
      for (const session of sessions.values()) quiet(session);
      sessions.clear();
      engineRoots.clear();
    },
  };
}
