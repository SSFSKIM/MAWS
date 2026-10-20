// P3-H H3b: main's connector service (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log 24, 80, 82,
// 83, 84 and 85). The broker (./broker.ts) over route E (./engine-route.ts) and the host's grant store, answering the
// renderer's `connectors.*` page-lease commands and the owner's `artifacts.*` grant commands.
//
// - Main is the scheduler and the first check; the detached host holds the store and makes the last check at the write.
//   The store's and route E's commands are main-only: no window reaches them except through this service.
// - A lease belongs to the window that opened it (its webContents id): closing, navigating or crashing ends its leases,
//   and a watch's refreshes go to that window alone (`connectors.watchUpdate`, validated as `emit` would), never to all.
// - P3-H H4 (P3 Decision Log 80, 89): the native window that owns the webContents vetoes its pages while it is hidden or
//   minimized, whatever the renderer reports. Main reads the window itself (shown and not minimized), never trusting an
//   event's name: when it first follows it, on its show, hide, minimize and restore, before any work starts, and every
//   WINDOW_RECHECK_MS while it reads hidden. On macOS a window's show and hide events follow its occlusion, not the
//   calls (Electron 44's ElectronNSWindowDelegate windowDidChangeOcclusionState is their one source), so a hide or show
//   that changes no occlusion has no event; the read before work and the re-read while hidden hear it. The window's
//   state outlives a reload of its page and goes with its webContents. No window owning the webContents: its pages stay
//   paused (fail closed), and main says so.
// - The store's committed grant changes (the host's `connectors.grantChanged`) feed the broker: a revoke or a delete
//   stops the tool's work, a grant wakes its watches, an Allow once consumed stops nothing. P3 Decision Log 91: the
//   artifact's deletion is heard on the store's change feed too (`artifacts.changed`), apart from any grant row, so a
//   call whose Allow once its own use consumed stops as well, before main takes or publishes its outcome.
// - The engine host leaving `ready` answers (and withdraws) every route E operation pending; each later call resolves
//   afresh. Its events reach main only once its connection streams, so route E starts operations only then, and each
//   time a connection starts streaming main reconciles what an event dropped before it: the pending operations'
//   outcomes are taken, and every watch waiting for a grant has its grant re-read from the store. P3-F F-connectors 9:
//   the owner's rows are invalidated then too, as they are on the host's loss, so a sheet that read them during the
//   outage reads them again.
// - E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): a window's call or watch may carry the owner's
//   dataset sink beside its request, handed to the broker as it came. An agent's dataset refresh is announced by the host
//   by its id alone (`maws.artifact.datasetRefresh`); main reads it (`artifacts.datasetRefreshRequest`), runs it through
//   the broker with no lease (the asking session's own engine), and answers how its call went
//   (`maws.artifact.datasetRefreshed`), both main-only; the host's own record of the publication is the tool's answer.
import { realpathSync } from 'node:fs';
import type { BrowserWindow, WebContents } from 'electron';
import type { ConnectorCallOutcome } from '@shared/artifacts/connectors';
import { eventChannel, type CommandInput, type CommandName, type CommandOutput, type CommandResult, type HostState } from '@shared/ipc/schema';
import type { ConnectorWatchUpdate } from '@shared/ipc/schema/connectors';
import type { MawsDatasetRefreshOutcome } from '@shared/ipc/schema/maws'; // E3
import { validateEventPayload } from '@shared/ipc/validate';
import type { HostSupervisor } from '../hosts/supervisor';
import type { registerMainHandler } from '../ipc/router';
import { ConnectorBroker } from './broker';
import type { DirectRoute, DirectRouteDeps } from './direct-route';
import { createEngineRoute, type EngineRouteDeps } from './engine-route';
import type { ConnectorOAuthProvider, ConnectorOAuthProviderDeps } from './oauth-provider'; // P3-HD M3c2
import { createConnectorOwner } from './owner'; // P3-HD M3c2
import { createOwnerDelivery, type OwnerDelivery } from './owner-delivery'; // P4-B5
import type { ConnectorGrantAuthority, ConnectorRoute } from './route';

export type ConnectorSender = Pick<WebContents, 'id' | 'isDestroyed' | 'send' | 'on' | 'once'>;
// P3-H H4: what main reads of a page's owner window, and the events it listens to.
export type ConnectorWindow = Pick<BrowserWindow, 'isDestroyed' | 'isVisible' | 'isMinimized' | 'on' | 'removeListener'>;

// P3-H H4: how often main re-reads a hidden owner window for a show no event announced (a read only, no connector work).
export const WINDOW_RECHECK_MS = 1_000;
const WINDOW_EVENTS = ['show', 'hide', 'minimize', 'restore'] as const;

export interface ConnectorsDeps {
  hosts: Pick<HostSupervisor, 'dispatch' | 'onEvent' | 'onState' | 'onStreaming' | 'streaming'>;
  register: typeof registerMainHandler;
  index: { sessions: EngineRouteDeps['sessions']; projects: EngineRouteDeps['projects'] };
  realpath?: (path: string) => string | null;
  // P3-H H4: the native window that owns a webContents (production: `BrowserWindow.fromWebContents`), or null
  windowOf: (sender: ConnectorSender) => ConnectorWindow | null;
  log?: (line: string) => void;
  // P3-HD (Decision Log 14): route D's factory, supplied by the application's composition root (`createDirectRoute`),
  // which the service composes after route E. H's own engine-only service tests omit it: there is then no route D.
  direct?: (deps: DirectRouteDeps) => DirectRoute;
  // P3-HD M3c2 (Decision Log 14, 19, 29): MAWS's own OAuth provider's factory, supplied by the root with route D
  // (./oauth-root.ts's `productionConnectorOAuth`). It prepares route D's HTTP credentials and serves the owner's
  // Connect, Reconnect and Disconnect; its host closes are `connectors.directClose` with the epoch floor it names. Absent
  // (or without route D), route D sends no credential of MAWS's own.
  oauth?: (deps: Pick<ConnectorOAuthProviderDeps, 'closeHost' | 'log'>) => ConnectorOAuthProvider;
}

const canonical = (path: string): string | null => {
  try {
    return realpathSync.native(path).normalize('NFC'); // the index's own canonical form (index/projects.ts)
  } catch {
    return null;
  }
};

// P4-B5: `delivery`, the owner's delivery through route D (./owner-delivery.ts), where route D exists; null otherwise.
export function startConnectors({ hosts, register, index, realpath = canonical, windowOf, log = (line) => console.warn(`[connectors] ${line}`), direct: createDirect, oauth: createOAuth }: ConnectorsDeps): { stop(): void; delivery: OwnerDelivery | null } {
  const call = <N extends CommandName>(name: N, input: CommandInput<N>) => hosts.dispatch('engine-host', name, input) as Promise<CommandResult<N>>;
  const host = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const result = await call(name, input);
    if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
    return result.value;
  };
  const grants: ConnectorGrantAuthority = {
    list: async (artifactId) => (await host('connectors.grants', { artifactId })).grants,
    grant: async (artifactId, request) => (await host('connectors.grant', { artifactId, grant: request })).grant,
    revoke: async (artifactId, tool) => (await host('connectors.revoke', { artifactId, server: tool.server, tool: tool.tool })).revoked,
    check: (artifactId, ref) => host('connectors.check', { artifactId, call: ref }),
  };
  const engine = createEngineRoute({ call, sessions: index.sessions, projects: index.projects, realpath, streaming: () => hosts.streaming('engine-host'), log });
  // P3-HD: route D joins after E (P3-H's brief: E first), when the root supplies it; its host leg is the direct operation family
  // P3-HD M3c2: MAWS's own OAuth, only beside route D; a host close is confirmed only by the host's acknowledgment
  const closeHost = async (target: { connectionId: string; credentialEpoch?: number }) => (await call('connectors.directClose', target).catch(() => null))?.ok === true;
  const oauth = createDirect && createOAuth ? createOAuth({ closeHost, log }) : null;
  const direct = createDirect?.({ call, sessions: index.sessions, projects: index.projects, realpath, streaming: () => hosts.streaming('engine-host'), log, ...(oauth && { credentials: oauth }) });
  const routes: ConnectorRoute[] = direct ? [engine, direct] : [engine];
  const broker = new ConnectorBroker({ routes, grants, log, recheckWindow: (owner) => followed.get(owner)?.read(), sessionRoute: (appSessionId, artifactId, tool, signal) => engine.resolveSession(appSessionId, artifactId, tool, signal) /* E3 */ });

  // ── the owner windows ──
  interface Followed {
    read(): void; // reads the window and reports it to the broker
    unfollow(): void; // lets go of the window's events and re-reads
  }
  const followed = new Map<string, Followed>(); // by owner (its webContents id)
  let stopped = false;
  const follow = (owner: string, window: ConnectorWindow | null): Followed => {
    if (window === null) log(`connectors: no window owns webContents ${owner}; its pages stay paused`);
    let recheck: ReturnType<typeof setInterval> | undefined;
    const read = () => {
      const shown = window !== null && !window.isDestroyed() && window.isVisible() && !window.isMinimized();
      broker.setWindowShown(owner, shown);
      if (shown || window === null || window.isDestroyed()) {
        clearInterval(recheck);
        recheck = undefined;
      } else {
        recheck ??= setInterval(read, WINDOW_RECHECK_MS);
      }
    };
    for (const name of WINDOW_EVENTS) window?.on(name as 'show', read);
    return {
      read,
      unfollow: () => {
        clearInterval(recheck);
        recheck = undefined;
        for (const name of WINDOW_EVENTS) window?.removeListener(name as 'show', read);
      },
    };
  };
  const ownerOf = (sender: ConnectorSender): string => {
    const owner = String(sender.id); // read now: a destroyed webContents may no longer answer
    if (followed.has(owner)) return owner;
    if (stopped) throw new Error('the connector service has stopped');
    if (sender.isDestroyed()) throw new Error('the window has closed'); // gone for good: nothing opens for it again
    const entry = follow(owner, windowOf(sender));
    followed.set(owner, entry);
    const end = () => broker.closeOwner(owner); // its window's state stays (P3-H H4)
    sender.on('did-navigate', end); // a reload or another page: the old page's leases go with it
    sender.on('render-process-gone', end);
    sender.once('destroyed', () => {
      followed.delete(owner);
      entry.unfollow();
      broker.forgetOwner(owner);
    });
    entry.read();
    return owner;
  };
  const sendUpdate = (sender: ConnectorSender, update: ConnectorWatchUpdate): void => {
    if (sender.isDestroyed()) return;
    const checked = validateEventPayload('connectors.watchUpdate', update);
    if (!checked.ok) {
      log(`connectors: refused to send an invalid connectors.watchUpdate (${checked.issues.map(({ path, code }) => `${path.join('.')}:${code}`).join(', ')})`);
      return;
    }
    sender.send(eventChannel('connectors.watchUpdate'), checked.value);
  };

  // ── a page's lease, through its owner window ──
  register('connectors.open', ({ artifactId }, { sender }) => ({ leaseId: broker.open(ownerOf(sender), artifactId) }));
  register('connectors.declare', ({ leaseId, tools }, { sender }) => broker.declareTools(ownerOf(sender), leaseId, tools));
  register('connectors.call', ({ leaseId, request, dataset }, { sender }) => broker.callTool(ownerOf(sender), leaseId, request, dataset && { dataset } /* E3 */));
  register('connectors.watch', ({ leaseId, request, dataset }, { sender }) => {
    let watchId: string | null = null; // the first refresh runs a timer turn after the start answers
    const listener = (update: ConnectorCallOutcome) => {
      if (watchId !== null) sendUpdate(sender, { leaseId, watchId, update });
    };
    const start = broker.watchTool(ownerOf(sender), leaseId, request, listener, dataset && { dataset } /* E3 */);
    if (start.ok) watchId = start.watchId;
    return start;
  });
  register('connectors.unwatch', ({ leaseId, watchId }, { sender }) => ({ stopped: broker.unwatch(ownerOf(sender), leaseId, watchId) }));
  register('connectors.refresh', ({ leaseId, watchId, probe }, { sender }) => ({ refreshing: probe === undefined ? broker.refreshWatch(ownerOf(sender), leaseId, watchId) : broker.refreshWatch(ownerOf(sender), leaseId, watchId, { probe }) /* E3 panel */ }));
  register('connectors.visibility', ({ leaseId, visible }, { sender }) => ({ ok: broker.setVisible(ownerOf(sender), leaseId, visible) }));
  register('connectors.close', ({ leaseId }, { sender }) => ({ closed: broker.close(ownerOf(sender), leaseId) }));
  // ── the owner's grants, from the editor header ──
  register('artifacts.connectorGrants', async ({ artifactId }) => ({ grants: await broker.grants(artifactId) }));
  register('artifacts.grantConnectorTool', ({ artifactId, tool }) => broker.grantTool(artifactId, tool));
  register('artifacts.revokeConnectorTool', async ({ artifactId, server, tool }) => ({ revoked: await broker.revokeTool(artifactId, { server, tool }) }));
  // P3-HD M3c2: the owner's per-server rows and actions (./owner.ts), where route D exists; trusted, never a page's
  const owner = direct ? createConnectorOwner({ direct, oauth, grants: grants.list, log }) : null;
  if (owner) {
    register('connectors.servers', ({ artifactId, tools }, { sender }) => owner.servers(artifactId, tools, sender));
    register('connectors.connect', ({ artifactId, sourceHandle }) => owner.connect(artifactId, sourceHandle));
    register('connectors.reconnect', ({ artifactId, sourceHandle }) => owner.reconnect(artifactId, sourceHandle));
    register('connectors.disconnect', ({ connectionId }) => owner.disconnect(connectionId));
  }

  // P4-B5: the owner's delivery (Send to) over route D and MAWS's own OAuth; its operations are route D's own, so the
  // lifecycle below (host loss, reconciliation, stop) covers them
  const delivery = direct ? createOwnerDelivery({ call, direct, oauth, log }) : null;

  const stopEnded = hosts.onEvent('connectors.operation', ({ operationId }) => engine.operationEnded(operationId));
  // E3: an agent's dataset refresh, read, run and answered; a request read as gone (answered, ended) is left alone
  const refresh = async (requestId: string): Promise<void> => {
    let outcome: MawsDatasetRefreshOutcome;
    try {
      const { request } = await host('artifacts.datasetRefreshRequest', { requestId });
      if (request === null) return;
      const { appSessionId, artifactId, datasetId, baseRevision, server, tool, args } = request;
      const answer = await broker.refreshForSession({ appSessionId, artifactId, server, tool, args, dataset: { id: datasetId, baseRevision, requestId } });
      outcome = answer.ok ? { ok: true } : answer;
    } catch (error) {
      log(`connectors: the dataset refresh ${requestId} could not be run: ${error instanceof Error ? error.message : String(error)}`);
      outcome = { ok: false, state: 'failed', reason: 'routeFailed' };
    }
    const answered = await call('maws.artifact.datasetRefreshed', { requestId, outcome }).catch((error: unknown) => ({ ok: false as const, error }));
    if (!answered.ok) log(`connectors: the dataset refresh ${requestId}'s answer did not reach the host`);
  };
  const stopRefreshes = hosts.onEvent('maws.artifact.datasetRefresh', ({ requestId }) => void refresh(requestId));
  const stopDirectEnded = hosts.onEvent('connectors.directOperation', ({ operationId }) => direct?.operationEnded(operationId)); // P3-HD
  const stopGrants = hosts.onEvent('connectors.grantChanged', (change) => broker.onGrantChange(change));
  const stopDeletes = hosts.onEvent('artifacts.changed', (change) => {
    if (change.change === 'deleted') broker.onArtifactDeleted(change.artifactId);
  });
  const stopState = hosts.onState('engine-host', (state: HostState) => {
    if (state.state !== 'ready') {
      engine.hostLost();
      direct?.hostLost(); // P3-HD
      oauth?.hostLost(); // P3-HD M3c2: that attachment's epochs and flows end
      owner?.hostLost(); // P3-HD M3c2: owner actions end; rows are read again
    }
  });
  const stopStreaming = hosts.onStreaming('engine-host', () => {
    engine.reconcile();
    direct?.reconcile(); // P3-HD
    broker.recheckGrants();
    owner?.hostStreaming(); // P3-F F-connectors 9: the owner's rows, read during an outage, are read again
  });
  return {
    delivery, // P4-B5
    stop: () => {
      stopEnded();
      stopRefreshes(); // E3
      stopDirectEnded(); // P3-HD
      stopGrants();
      stopDeletes();
      stopState();
      stopStreaming();
      stopped = true; // P3-H H4: no window followed again
      for (const entry of followed.values()) entry.unfollow();
      followed.clear();
      broker.stop();
      engine.stop();
      owner?.stop(); // P3-HD M3c2
      direct?.stop(); // P3-HD: terminal, each pending operation withdrawn from the host
      oauth?.stop(); // P3-HD M3c2
    },
  };
}
