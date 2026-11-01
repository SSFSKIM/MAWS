// MAWS's primitive server for cua's host (the in-app browser spec of 2026-10-08, M2; P1 A-51, A-52): one Unix socket per
// app session, `<userData>/browser/cua/<appSessionId>.sock`, in a directory created 0700 at start and swept of stale
// sockets. A session's socket listens from its first engine launch (`socketPathFor`, which the launch mapping writes into
// the spec's `extraSettings.env.CUA_BROWSER_BACKENDS`) or from the first sign of an engine that survived a relaunch
// (D-16), until the session is removed or the app quits; the file is unlinked on close. The path is not the boundary: every
// socket is 0600 and checks its peer at accept (cua docs/doperpowers/specs/2026-10-09-maws-socket-peer-auth-design.md,
// M2). An accepted socket is held unread until its peer runs as this user and descends from the session's engine (its
// root, set from each `session.status` by `engineProcess`) or from a trusted root (the e2e seam's); with no live root yet
// it waits PEER_ROOT_WAIT_MS for one. A refused socket is destroyed unread, and one line names its pid and the reason.
// Without the peer identity addon every peer is refused (fail closed).
//
// P5 O5 M5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §H): on the daemon shape a launch is told
// `mawsd`'s socket for the session, which checks the engine's peer itself and relays the connection here from its own
// process. That relay is admitted by the attached daemon's exact instance (`relay`: the peer of the app's live
// machine.sock connection, its pid and start read through the addon, then confirmed by an answer on that link sent after
// the read and the same start read again), at once and never as a root, since every engine
// on the machine descends from the daemon. A connection admitted as one daemon's relay ends when the machine link loses
// that daemon or reaches another: what it relayed was that daemon's; one admitted under the session's engine ends when
// that engine is replaced or gone. Each change of the link is a generation: a socket
// waiting for one link's confirmation is destroyed unread at the next change, and only a socket accepted under the
// current link may pass as its relay.
//
// Each connection is one cua host in its own process (connection.ts); what crosses connections, which tabs are reserved
// or leased to whom, is `TabClaims`. The store's hooks reach every connection: a tab gone (`tabs.removed`), a tab changed
// (`tabs.updated`), and a leased page's `window.open` adopted as a tab (`tabs.adopted`).
//
// P5 O17 M2 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md §H; condition 5 of O5's M7 verdict): the policy follows
// the platform, as `mawsd`'s own sockets' does (its `uidBoundary`). On darwin, the process tree through the addon, and no
// addon refuses every peer. Elsewhere (Linux, where no addon exists) the uid is the boundary, stated as such: the socket
// is owner-only in a private directory, checked at each accept, and the peer runs as this user where the platform
// reports it; any process of the user is let in, never told apart by session. On every platform the directory is
// refused, and nothing listens, when it is a symlink or another user's.
//
// M3 (what the person sees and keeps): with `presence`, control follows the lease and the takeover gate holds acting
// commands while the person has the tab (presence.ts); with `emit`, what the agent did reaches the windows
// (`browser.agent.activity`, activity.ts); `downloads` is the agent's route for E4a's downloads (downloads.ts), and
// `dialogs` the `-run-dialog` wrap's held route for a leased tab (dialogs.ts).
import { chmodSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import type { BrowserAgentActivity } from '@shared/browser/activity';
import type { AppSessionId } from '@shared/graph/ids';
import type { BrowserActivityStore } from '../data/activity';
import type { MawsDownloadRecorded } from '@shared/ipc/schema/maws';
import type { BrowserEmit, TabEntry, TabStore } from '../tabs';
import type { LeaseHolds } from '../agent/visible';
import type { RunDialogCallback, RunDialogInfo } from '../agent/dialogs';
import { CUA_SOCKET_DIR, cuaSocketPath } from '@shared/browser/cua-socket';
import { assertPrivateDirectory } from '@shared/host/private-path';
import { ActivityFeed } from './activity';
import { TabClaims } from './claims';
import { CuaConnection } from './connection';
import { HeldDialogs } from './dialogs';
import { agentDownloads, type AgentDownloads } from './downloads';
import { AgentPresence, type PresenceDeps } from './presence';
import { judgePeer, judgeUidPeer, PEER_ROOT_WAIT_MS, rootOf, socketFd, type PeerAddon, type PeerRefusal, type ProcessRoot } from './peer';

export interface CuaBackendDeps {
  store: Pick<TabStore, 'all' | 'entry' | 'list' | 'open' | 'close' | 'load' | 'update' | 'setControl' | 'onViewCreated' | 'onViewDestroying' | 'onUpdated'>;
  windows(): { id: number; focused: boolean }[]; // the app's windows, for windows.query and a tab's windowId
  reaches(appSessionId: AppSessionId, tabSessionId: AppSessionId): boolean; // P-24: itself, and a side thread its parent
  userData: string;
  version: string; // MAWS's app version, in the hello
  log?(line: string): void;
  // M3: control's transitions, the takeover gate and the agent's cursor (absent: the bare server, no transitions)
  presence?: Omit<PresenceDeps, 'store'>;
  emit?: BrowserEmit; // M3: `browser.agent.activity` (and, since the final fix wave, `browser.agent.acting`) to the windows (absent: nothing told)
  activityStore?: Pick<BrowserActivityStore, 'list' | 'append' | 'beforeClose'>; // cua board #93: the activity kept across restarts (absent: the app's life)
  // M3: an agent's finished download to the session's engine host (`maws.download.recorded`), which records it once
  recordDownload?(download: MawsDownloadRecorded): Promise<unknown>;
  now?(): number;
  // The peer check: the loaded addon (null, or the option absent: every peer refused on darwin) and, under MAWS_E2E only,
  // the roots trusted beside every session's engine (the e2e seam's `trustRoot` adds to the set). P5 O17 M2: `platform`
  // (this process's when absent) chooses the policy: darwin's process tree, else the uid boundary; `uid` is this process's
  // user (a test stands in another to see a directory another user owns).
  peer?: { addon: PeerAddon | null; trustedRoots?: Set<ProcessRoot>; platform?: NodeJS.Platform; uid?: number };
}

export interface CuaSessionInspection {
  path: string;
  connections: number;
  held: number;
  leased: string[];
  refused: number; // peers refused on this socket
}

export interface CuaBackend extends LeaseHolds {
  // The session's socket path, listening from now on; null when the path is too long for a Unix socket (logged).
  socketPathFor(appSessionId: AppSessionId): string | null;
  // The session was removed: its socket closes and every connection on it ends.
  closeSession(appSessionId: AppSessionId): void;
  // The session's engine process, from each of its statuses: the root its socket's peers must descend from (null: none).
  engineProcess(appSessionId: AppSessionId, pid: number | null): void;
  // P5 O5 M5: the app's live machine.sock connection: its descriptor, whose peer (the daemon actually connected, its pid
  // and start read now through the addon) every session's socket admits as its relay once `confirm` (a request on that
  // same link, sent after the read) is answered and the start read again is the same; null while the link is down. Told
  // again at each change of the link; a changed or cleared identity ends the connections the old one relayed.
  relay(link: RelayLink | null): void;
  // The e2e seam's reading: whether the peer check's addon loaded; per listening session, its connections, held commands,
  // leased tabs and refused peers.
  inspect(): { peerModule: 'loaded' | 'unavailable'; sessions: Record<string, CuaSessionInspection> };
  downloads: AgentDownloads; // M3: E4a's downloads ask whether a tab's download is the agent's, and report it
  // M3: the `-run-dialog` wrap's held route: a leased tab's alert or confirm, answered by the vendor or the 30 s default
  dialogs: { holds(tabId: string): boolean; hold(entry: TabEntry, info: RunDialogInfo, callback: RunDialogCallback): void };
  // M3 fix wave: the session's agent activity, oldest first (`browser.agent.activities.list`); since cua board #93 an
  // earlier app run's too, from the browser's data
  activities(appSessionId: AppSessionId): BrowserAgentActivity[];
  dispose(): void;
}

// An accepted socket held unread: waiting for the session's root, or (`daemon` set) for the confirmation of the daemon
// its peer is, read from the link of its `generation` (the relay() call it was accepted under)
interface Waiting {
  acceptedAt: number;
  timer: NodeJS.Timeout;
  generation: number;
  daemon: ProcessRoot | null;
}

interface Listening {
  path: string;
  server: Server;
  connections: Set<CuaConnection>;
  pending: Map<Socket, Waiting>;
  refused: number;
}

const refusalLine = (appSessionId: AppSessionId, { reason, pid, detail }: PeerRefusal) =>
  `cua socket of ${appSessionId}: refused peer${pid === null ? '' : ` pid ${pid}`} (${reason}${detail === undefined ? '' : `: ${detail}`}${reason === 'module_unavailable' ? '; run scripts/build-peer-auth.sh' : ''})`;

// P5 O17 M2: the socket directory made 0700 when missing, an older run's wider mode narrowed; null when it is private,
// else why it is refused (a symlink, not a directory, another user's)
function privateDirectory(dir: string, uid: number): string | null {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = lstatSync(dir);
    if (stat.isDirectory() && stat.uid === uid) chmodSync(dir, 0o700); // only a real directory of this user (chmod follows a symlink)
    assertPrivateDirectory(dir, { uid });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// The machine link as the relay's admission reads it: `confirm` resolves true once mawsd answered a request sent on this
// same connection after the call (false: it failed, or the link is no longer the one told)
export interface RelayLink {
  fd: number;
  confirm(): Promise<boolean>;
}

export function startCuaBackend(deps: CuaBackendDeps): CuaBackend {
  const log = deps.log ?? ((line: string) => console.warn(`[browser] ${line}`));
  const uid = deps.peer?.uid ?? process.getuid?.() ?? -1;
  // P5 O17 M2: the uid boundary where the platform has no addon; with no peer option at all, darwin's (fail closed)
  const platform = deps.peer ? (deps.peer.platform ?? process.platform) : 'darwin';
  const uidBoundary = platform !== 'darwin';
  const dir = join(deps.userData, ...CUA_SOCKET_DIR);
  const dirRefused = privateDirectory(dir, uid);
  if (dirRefused !== null) log(`the cua socket directory ${dir} is refused (${dirRefused}): no session's browser is reachable`);
  else for (const name of readdirSync(dir)) if (name.endsWith('.sock')) rmSync(join(dir, name), { force: true }); // nothing listens at start

  const claims = new TabClaims<CuaConnection>();
  const sessions = new Map<AppSessionId, Listening>();
  const tooLong = new Set<AppSessionId>();
  const feed = deps.emit ? new ActivityFeed({ emit: deps.emit, now: deps.now, store: deps.activityStore, log }) : null;
  const presence = deps.presence ? new AgentPresence({ ...deps.presence, store: deps.store }) : null;
  const ctx = { store: deps.store, claims, windows: deps.windows, reaches: deps.reaches, version: deps.version, log, presence, feed, emit: deps.emit ?? null };
  const viewed = new WeakSet<TabEntry>();
  const everyConnection = () => [...sessions.values()].flatMap((listening) => [...listening.connections]);

  // The peer check (the socket peer authentication spec, M2): the addon, the engine of each session as a process instance
  // (captured when its status names it, re-verified on every walk) and the trusted roots.
  const addon = deps.peer?.addon ?? null;
  const trustedRoots = deps.peer?.trustedRoots ?? new Set<ProcessRoot>();
  const engineRoots = new Map<AppSessionId, ProcessRoot>();
  if (uidBoundary) log(`${addon ? `the peer's uid checked on ${platform}` : `no peer identity check on ${platform}`}: the uid is the cua sockets' boundary (an owner-only socket in a private directory)`);
  else if (!addon) log('the peer identity addon did not load: every cua connection will be refused (run scripts/build-peer-auth.sh)');
  const rootsOf = (appSessionId: AppSessionId): ProcessRoot[] => {
    const engine = engineRoots.get(appSessionId);
    return engine ? [engine, ...trustedRoots] : [...trustedRoots];
  };
  const hasLiveRoot = (appSessionId: AppSessionId) => addon !== null && rootsOf(appSessionId).some((root) => addon.process(root.pid)?.start === root.start);
  let relayRoot: ProcessRoot | null = null; // P5 O5 M5: the confirmed daemon
  let confirming: ProcessRoot | null = null; // P5 O5 M5: the daemon read from the link, until its confirmation
  let relayAsk = 0; // each relay() call, the link's generation; a confirmation applies only to the latest
  const relayedBy = new Map<CuaConnection, ProcessRoot>(); // P5 O5 M5: each connection admitted as a relay, by whose
  // each connection admitted as a descendant of its session's engine, by which: the root the check matched, never looked
  // up again (only a trusted root's descendant is tied to none)
  const engineBy = new Map<CuaConnection, ProcessRoot>();
  // The daemon the machine link is connected to: its socket's peer, this user's, as a live instance
  const connectedDaemon = (fd: number): ProcessRoot | null => {
    if (addon === null) return null;
    try {
      const peer = addon.peer(fd);
      return peer.uid === uid ? rootOf(peer.pid, addon) : null;
    } catch {
      return null; // the descriptor is gone: no daemon
    }
  };
  // The accepted socket's peer is the daemon's relay by pid (its start is the verdict's to check): nothing to wait for.
  const fromRelay = (socket: Socket, root: ProcessRoot | null = relayRoot) => {
    if (addon === null || root === null) return false;
    const fd = socketFd(socket);
    try {
      return fd !== null && addon.peer(fd).pid === root.pid;
    } catch {
      return false;
    }
  };

  // The verdict on an accepted socket, which nothing has read yet: refused, it is counted and then destroyed unread;
  // accepted, it becomes a connection, counted before its hello goes, and only then is read. The order is what a reader
  // of the server sees: the e2e seam's `inspect`, which Node's inspector runs at its next interrupt (between any two
  // calls of this synchronous code), finds the peer counted as soon as the peer can hear the hello or the close.
  // A socket passes as the relay only under the link it was accepted under: nothing queued under one link is served
  // under the next (`relayRoot`, when set, is the current generation's).
  const decide = (appSessionId: AppSessionId, listening: Listening, socket: Socket, acceptedAt: number, generation = relayAsk) => {
    listening.pending.delete(socket);
    if (socket.destroyed) return;
    const relay = generation === relayAsk ? relayRoot : null;
    const verdict = uidBoundary
      ? judgeUidPeer(socketFd(socket), listening.path, { addon, uid })
      : judgePeer(socketFd(socket), rootsOf(appSessionId), { addon, now: acceptedAt, uid, relay });
    if ('reason' in verdict) {
      listening.refused += 1;
      log(refusalLine(appSessionId, verdict));
      socket.destroy(); // last: the peer can see the close from here on
      return;
    }
    const viaRelay = verdict.via === 'relay'; // let in as the daemon's exact instance
    const engine = verdict.via === 'root' && !trustedRoots.has(verdict.root) ? verdict.root : null;
    const connection = new CuaConnection(ctx, appSessionId, socket, (closed) => {
      listening.connections.delete(closed);
      relayedBy.delete(closed);
      engineBy.delete(closed);
    });
    listening.connections.add(connection);
    if (viaRelay && relay) relayedBy.set(connection, relay);
    if (engine) engineBy.set(connection, engine);
    connection.greet();
    socket.resume();
  };

  // A socket accepted while the session has no live root waits for one: its engine's MCP servers can connect before main
  // has handled the status that names the engine. With no addon there is nothing to wait for.
  const admit = (appSessionId: AppSessionId, listening: Listening, socket: Socket) => {
    const acceptedAt = Date.now();
    socket.on('error', () => {}); // a socket destroyed while it waits reports nothing
    // the daemon's relay waits too while its confirmation is under way, so it is let in once it comes
    const daemon = fromRelay(socket, confirming) ? confirming : null;
    if (!uidBoundary && addon && ((!hasLiveRoot(appSessionId) && !fromRelay(socket)) || daemon)) {
      const generation = relayAsk;
      const timer = setTimeout(() => decide(appSessionId, listening, socket, acceptedAt, generation), PEER_ROOT_WAIT_MS);
      listening.pending.set(socket, { acceptedAt, timer, generation, daemon });
      return;
    }
    decide(appSessionId, listening, socket, acceptedAt);
  };

  // What a daemon relayed it relayed as that daemon: ended unless `kept` is the same instance
  const revokeRelayed = (kept: ProcessRoot | null) => {
    for (const [connection, root] of [...relayedBy]) {
      if (kept !== null && kept.pid === root.pid && kept.start === root.start) continue;
      relayedBy.delete(connection);
      connection.disconnect('the daemon that relayed it is no longer attached');
    }
  };
  // The sockets accepted under the current link's generation before its confirmation wait no longer: judged now, by the
  // pass as it stands
  const admitWaitingRelays = () => {
    for (const [appSessionId, listening] of sessions) {
      for (const [socket, { acceptedAt, timer, generation, daemon }] of [...listening.pending]) {
        if (daemon === null || generation !== relayAsk) continue;
        clearTimeout(timer);
        decide(appSessionId, listening, socket, acceptedAt, generation);
      }
    }
  };
  // A change of the link ends what waited for the old link's confirmation, unread
  const dropWaitingRelays = () => {
    for (const listening of sessions.values()) {
      for (const [socket, { timer, daemon }] of [...listening.pending]) {
        if (daemon === null) continue;
        clearTimeout(timer);
        listening.pending.delete(socket);
        socket.destroy();
      }
    }
  };

  const listen = (appSessionId: AppSessionId, path: string): Listening => {
    const listening: Listening = { path, server: null as unknown as Server, connections: new Set(), pending: new Map(), refused: 0 };
    listening.server = createServer({ pauseOnConnect: true }, (socket) => admit(appSessionId, listening, socket));
    listening.server.on('error', (error) => log(`the cua socket of ${appSessionId} failed: ${error.message}`));
    listening.server.on('listening', () => {
      try {
        chmodSync(path, 0o600);
      } catch (error) {
        log(`the cua socket of ${appSessionId} could not be made owner-only: ${(error as Error).message}`);
      }
    });
    rmSync(path, { force: true });
    listening.server.listen(path);
    return listening;
  };

  const close = (listening: Listening, why: string) => {
    listening.server.close();
    for (const [socket, { timer }] of listening.pending) {
      clearTimeout(timer);
      socket.destroy();
    }
    listening.pending.clear();
    for (const connection of listening.connections) connection.disconnect(why);
    rmSync(listening.path, { force: true });
  };

  const stops = [
    // A tab gone: its view destroyed and the entry dropped (suspension keeps the entry, and the lease's detach says it).
    deps.store.onViewDestroying((entry) =>
      queueMicrotask(() => {
        if (deps.store.entry(entry.tab.tabId) === entry) return;
        claims.forget(entry.tab.tabId);
        for (const connection of everyConnection()) connection.tabRemoved(entry.tab.tabId);
        feed?.forget(entry.tab.tabId);
      }),
    ),
    deps.store.onUpdated((entry) => {
      for (const connection of everyConnection()) connection.tabUpdated(entry);
    }),
    // only a tab's first view is a page's new window; a later one is the same tab resumed, never an adoption
    deps.store.onViewCreated((child: TabEntry) => {
      if (viewed.has(child)) return;
      viewed.add(child);
      const opener = child.openerTabId === null ? undefined : deps.store.entry(child.openerTabId);
      const holder = opener && claims.leasedTo(opener.tab.tabId);
      if (opener && holder) holder.adopted(opener, child);
    }),
  ];

  const downloads = agentDownloads({ claims, recordDownload: deps.recordDownload, log });
  const held = new HeldDialogs({ activity: (entry, activity) => claims.leasedTo(entry.tab.tabId)?.tell(entry, activity), log });

  return {
    socketPathFor(appSessionId) {
      const existing = sessions.get(appSessionId);
      if (existing) return existing.path;
      if (dirRefused !== null) return null; // logged at start
      const path = cuaSocketPath(dir, appSessionId);
      if (path === null) {
        if (!tooLong.has(appSessionId)) log(`the cua socket path of ${appSessionId} is longer than a Unix socket allows (${Buffer.byteLength(join(dir, `${appSessionId}.sock`))} bytes): cua cannot reach this session's browser`);
        tooLong.add(appSessionId);
        return null;
      }
      sessions.set(appSessionId, listen(appSessionId, path));
      return path;
    },
    engineProcess(appSessionId, pid) {
      const root = pid === null || !addon ? null : rootOf(pid, addon);
      if (root) engineRoots.set(appSessionId, root);
      else engineRoots.delete(appSessionId);
      const listening = sessions.get(appSessionId);
      // what was let in under the session's engine is that engine's: it ends when the root changes or goes
      for (const connection of [...(listening?.connections ?? [])]) {
        const under = engineBy.get(connection);
        if (!under || (root?.pid === under.pid && root.start === under.start)) continue;
        engineBy.delete(connection);
        connection.disconnect('the session\'s engine it descends from is gone');
      }
      if (!root || !listening) return;
      for (const [socket, { acceptedAt, timer, generation, daemon }] of [...listening.pending]) {
        if (daemon !== null) continue; // the daemon's waits for its confirmation, not for the engine
        clearTimeout(timer);
        decide(appSessionId, listening, socket, acceptedAt, generation);
      }
    },
    relay(link) {
      const ask = ++relayAsk;
      // the peer read now; `peer(fd)` may still name a peer that died, whose pid another process may hold by the start
      // read, so no pass until a request sent on the link after the read is answered (the daemon lived past it, so the
      // process at that pid then was the daemon) and the start read again is the same
      const read = link === null ? null : connectedDaemon(link.fd);
      revokeRelayed(read);
      dropWaitingRelays();
      relayRoot = null;
      confirming = read;
      if (link === null || read === null) return;
      const confirmed = (ok: boolean) => {
        if (ask !== relayAsk) return; // the link changed since: its own relay() decides
        confirming = null;
        if (!ok || addon?.process(read.pid)?.start !== read.start) {
          if (!ok) log(`the machine link's daemon (pid ${read.pid}) did not answer: its relayed connections are not admitted`);
          revokeRelayed(null);
          return admitWaitingRelays(); // refused now, not at their wait's end
        }
        relayRoot = read;
        admitWaitingRelays();
      };
      link.confirm().then(confirmed, () => confirmed(false));
    },
    closeSession(appSessionId) {
      feed?.forgetSession(appSessionId); // the session was removed: its activity goes with it (its stored rows too, BrowserData)
      engineRoots.delete(appSessionId);
      const listening = sessions.get(appSessionId);
      if (!listening) return;
      sessions.delete(appSessionId);
      close(listening, 'its session was removed');
    },
    holds: (tabId) => claims.leasedTo(tabId) !== undefined,
    onChange: (listener) => claims.onChange(listener),
    downloads,
    dialogs: { holds: (tabId) => claims.leasedTo(tabId) !== undefined, hold: (entry, info, callback) => held.hold(entry, info, callback) },
    activities: (appSessionId) => feed?.list(appSessionId) ?? [],
    inspect: () => ({
      peerModule: addon ? 'loaded' : 'unavailable',
      sessions: Object.fromEntries(
        [...sessions].map(([appSessionId, listening]) => [
          appSessionId,
          {
            path: listening.path,
            connections: listening.connections.size,
            held: [...listening.connections].reduce((sum, connection) => sum + connection.heldCount, 0),
            leased: [...listening.connections].flatMap((connection) => connection.leasedTabs()),
            refused: listening.refused,
          },
        ]),
      ),
    }),
    dispose() {
      for (const stop of stops.splice(0)) stop();
      feed?.dispose();
      held.dispose();
      for (const listening of sessions.values()) close(listening, 'MAWS stopped its server');
      sessions.clear();
      engineRoots.clear();
    },
  };
}
