// MAWS's primitive server for cua's host (the in-app browser spec of 2026-10-08, M2; P1 A-51, A-52): one Unix socket per
// app session, `<userData>/browser/cua/<appSessionId>.sock`, in a directory created 0700 at start and swept of stale
// sockets. A session's socket listens from its first engine launch (`socketPathFor`, which the launch mapping writes into
// the spec's `extraSettings.env.CUA_BROWSER_BACKENDS`) or from the first sign of an engine that survived a relaunch
// (D-16), until the session is removed or the app quits; the file is unlinked on close. The path is the session's
// authorization: only that session's engine (and the cua_repl shims it starts) is told it.
//
// Each connection is one cua host in its own process (connection.ts); what crosses connections, which tabs are reserved
// or leased to whom, is `TabClaims`. The store's hooks reach every connection: a tab gone (`tabs.removed`), a tab changed
// (`tabs.updated`), and a leased page's `window.open` adopted as a tab (`tabs.adopted`).
//
// M3 (what the person sees and keeps): with `presence`, control follows the lease and the takeover gate holds acting
// commands while the person has the tab (presence.ts); with `emit`, what the agent did reaches the windows
// (`browser.agent.activity`, activity.ts); `downloads` is the agent's route for E4a's downloads (downloads.ts), and
// `dialogs` the `-run-dialog` wrap's held route for a leased tab (dialogs.ts).
import { chmodSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import type { BrowserAgentActivity } from '@shared/browser/activity';
import type { AppSessionId } from '@shared/graph/ids';
import type { BrowserActivityStore } from '../../index/browser-activity';
import type { MawsDownloadRecorded } from '@shared/ipc/schema/maws';
import type { BrowserEmit, TabEntry, TabStore } from '../tabs';
import type { LeaseHolds } from '../agent/visible';
import type { RunDialogCallback, RunDialogInfo } from '../agent/dialogs';
import { ActivityFeed } from './activity';
import { TabClaims } from './claims';
import { CuaConnection } from './connection';
import { HeldDialogs } from './dialogs';
import { agentDownloads, type AgentDownloads } from './downloads';
import { AgentPresence, type PresenceDeps } from './presence';

// sockaddr_un's sun_path on macOS is 104 bytes, the terminating NUL included.
export const MAX_SOCKET_PATH_BYTES = 103;

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
  activityStore?: Pick<BrowserActivityStore, 'list' | 'append'>; // cua board #93: the activity kept across restarts (absent: the app's life)
  // M3: an agent's finished download to the session's engine host (`maws.download.recorded`), which records it once
  recordDownload?(download: MawsDownloadRecorded): Promise<unknown>;
  now?(): number;
}

export interface CuaBackend extends LeaseHolds {
  // The session's socket path, listening from now on; null when the path is too long for a Unix socket (logged).
  socketPathFor(appSessionId: AppSessionId): string | null;
  // The session was removed: its socket closes and every connection on it ends.
  closeSession(appSessionId: AppSessionId): void;
  // The e2e seam's reading: per listening session, its connections, held commands and leased tabs.
  inspect(): Record<string, { path: string; connections: number; held: number; leased: string[] }>;
  downloads: AgentDownloads; // M3: E4a's downloads ask whether a tab's download is the agent's, and report it
  // M3: the `-run-dialog` wrap's held route: a leased tab's alert or confirm, answered by the vendor or the 30 s default
  dialogs: { holds(tabId: string): boolean; hold(entry: TabEntry, info: RunDialogInfo, callback: RunDialogCallback): void };
  // M3 fix wave: the session's agent activity, oldest first (`browser.agent.activities.list`); since cua board #93 an
  // earlier app run's too, from the index
  activities(appSessionId: AppSessionId): BrowserAgentActivity[];
  dispose(): void;
}

interface Listening {
  path: string;
  server: Server;
  connections: Set<CuaConnection>;
}

export function startCuaBackend(deps: CuaBackendDeps): CuaBackend {
  const log = deps.log ?? ((line: string) => console.warn(`[browser] ${line}`));
  const dir = join(deps.userData, 'browser', 'cua');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700); // a directory an older run made otherwise
  for (const name of readdirSync(dir)) if (name.endsWith('.sock')) rmSync(join(dir, name), { force: true }); // nothing listens at start

  const claims = new TabClaims<CuaConnection>();
  const sessions = new Map<AppSessionId, Listening>();
  const tooLong = new Set<AppSessionId>();
  const feed = deps.emit ? new ActivityFeed({ emit: deps.emit, now: deps.now, store: deps.activityStore, log }) : null;
  const presence = deps.presence ? new AgentPresence({ ...deps.presence, store: deps.store }) : null;
  const ctx = { store: deps.store, claims, windows: deps.windows, reaches: deps.reaches, version: deps.version, log, presence, feed, emit: deps.emit ?? null };
  const viewed = new WeakSet<TabEntry>();
  const everyConnection = () => [...sessions.values()].flatMap((listening) => [...listening.connections]);

  const listen = (appSessionId: AppSessionId, path: string): Listening => {
    const connections = new Set<CuaConnection>();
    const server = createServer((socket) => {
      connections.add(new CuaConnection(ctx, appSessionId, socket, (closed) => connections.delete(closed)));
    });
    server.on('error', (error) => log(`the cua socket of ${appSessionId} failed: ${error.message}`));
    rmSync(path, { force: true });
    server.listen(path);
    return { path, server, connections };
  };

  const close = (listening: Listening) => {
    listening.server.close();
    for (const connection of listening.connections) connection.disconnect();
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
      const path = join(dir, `${appSessionId}.sock`);
      if (Buffer.byteLength(path) > MAX_SOCKET_PATH_BYTES) {
        if (!tooLong.has(appSessionId)) log(`the cua socket path of ${appSessionId} is longer than a Unix socket allows (${Buffer.byteLength(path)} bytes): cua cannot reach this session's browser`);
        tooLong.add(appSessionId);
        return null;
      }
      sessions.set(appSessionId, listen(appSessionId, path));
      return path;
    },
    closeSession(appSessionId) {
      feed?.forgetSession(appSessionId); // the session was removed: its activity goes with it (its index rows with its record)
      const listening = sessions.get(appSessionId);
      if (!listening) return;
      sessions.delete(appSessionId);
      close(listening);
    },
    holds: (tabId) => claims.leasedTo(tabId) !== undefined,
    onChange: (listener) => claims.onChange(listener),
    downloads,
    dialogs: { holds: (tabId) => claims.leasedTo(tabId) !== undefined, hold: (entry, info, callback) => held.hold(entry, info, callback) },
    activities: (appSessionId) => feed?.list(appSessionId) ?? [],
    inspect: () =>
      Object.fromEntries(
        [...sessions].map(([appSessionId, listening]) => [
          appSessionId,
          {
            path: listening.path,
            connections: listening.connections.size,
            held: [...listening.connections].reduce((sum, connection) => sum + connection.heldCount, 0),
            leased: [...listening.connections].flatMap((connection) => connection.leasedTabs()),
          },
        ]),
      ),
    dispose() {
      for (const stop of stops.splice(0)) stop();
      feed?.dispose();
      held.dispose();
      for (const listening of sessions.values()) close(listening);
      sessions.clear();
    },
  };
}
