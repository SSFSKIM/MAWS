// P3-H H3b: the connector service (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log 24, 80, 82,
// 83, 84 and 85). The broker (./broker.ts) over route E (./engine-route.ts) and the host's grant store, answering the
// renderer's `connectors.*` page-lease commands and the owner's `artifacts.*` grant commands.
//
// P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §F; D7 to D10, D17, D23): the machine's,
// composed by the spine's root after the checkouts (`mawsd`'s on the daemon shape, main's embedded root's on the embedded
// one): route D, MAWS's own OAuth over the machine's key file (./root.ts, ./custody.ts), the owner's rows and delivery,
// and the agent's dataset refresh, which now completes with no app attached (the engine host announces it to its
// permanent client, `mawsd`).
//
// - The service is the scheduler and the first check; the detached host holds the store and makes the last check at
//   the write. The store's and route E's commands are main-only: no window reaches them except through this service.
// - A lease belongs to the client that opened it (its page, `ClientRef.id`): the page closing, navigating or crashing
//   ends the client and its leases. A watch's refreshes are `connectors.watchUpdate` to every client (D9): the renderer
//   routes them by lease and drops a lease it does not hold.
// - P3-H H4 (P3 Decision Log 80, 89), P5 O4 D8: the native window that shows a page vetoes it while hidden or minimized,
//   whatever the renderer reports. The app reads the window (src/main/connectors/windows.ts) and reports it as
//   `connectors.windowShown {shown}` under the page's own client, before the page's first lease command and at each
//   change; the broker holds the latest report. A page whose window was never reported is hidden (fail closed).
// - The store's committed grant changes (the host's `connectors.grantChanged`) feed the broker: a revoke or a delete
//   stops the tool's work, a grant wakes its watches, an Allow once consumed stops nothing. P3 Decision Log 91: the
//   artifact's deletion is heard on the store's change feed too (`artifacts.changed`), apart from any grant row, so a
//   call whose Allow once its own use consumed stops as well, before main takes or publishes its outcome.
// - The engine host leaving `ready` answers (and withdraws) every route E operation pending; each later call resolves
//   afresh. Its events reach main only once its connection streams, so route E starts operations only then, and each
//   time a connection starts streaming the service reconciles what an event dropped before it: the pending operations'
//   outcomes are taken, and every watch waiting for a grant has its grant re-read from the store. P3-F F-connectors 9:
//   the owner's rows are invalidated then too, as they are on the host's loss, so a sheet that read them during the
//   outage reads them again.
// - E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): a window's call or watch may carry the owner's
//   dataset sink beside its request, handed to the broker as it came. An agent's dataset refresh is announced by the host
//   by its id alone (`maws.artifact.datasetRefresh`); the service reads it (`artifacts.datasetRefreshRequest`), runs it
//   through the broker with no lease (the asking session's own engine), and answers how its call went
//   (`maws.artifact.datasetRefreshed`), both main-only; the host's own record of the publication is the tool's answer.
// - D17: a refresh in flight and an owner's action in flight keep the part busy, so a release or a yield waits for them
//   (their own deadlines bound them); the commands' own runs are the root's counting bus's.
// - D10: the part's stop ends this load's work in the engine host: route D's pending operations withdrawn and every
//   connection the provider issued a credential for closed (`connectors.directClose`), since the host's connection, and
//   so its credential floors, outlive the load; the provider numbers its epochs from a counter of the process's.
import { realpathSync } from 'node:fs';
import type { ConnectorCallOutcome } from '@shared/artifacts/connectors';
import type { ClientPort } from '@shared/client/port';
import type { ConnectorOAuthSealer } from '@shared/connectors/sealer';
import type { ClientRef } from '@shared/ipc/client';
import type { CommandInput, CommandName, CommandOutput, CommandResult, HostState } from '@shared/ipc/schema';
import type { ConnectorWatchUpdate } from '@shared/ipc/schema/connectors';
import type { MawsDatasetRefreshOutcome } from '@shared/ipc/schema/maws'; // E3
import type { ServicesBus } from '@shared/spine/bus';
import type { SpineView } from '@shared/spine/view';
import type { SpineHosts } from '../spine-root';
import { allSettling, Work, type Settling } from '../work';
import { ConnectorBroker } from './broker';
import { createDirectRoute, type DirectRoute, type DirectRouteDeps } from './direct-route';
import { createEngineRoute } from './engine-route';
import type { ListenLoopback } from './oauth-callback';
import type { ConnectorOAuthProvider, ConnectorOAuthProviderDeps } from './oauth-provider'; // P3-HD M3c2
import { createConnectorOwner } from './owner'; // P3-HD M3c2
import { createOwnerDelivery, type OwnerDelivery } from './owner-delivery'; // P4-B5
import { productionConnectorOAuth } from './root';
import type { ConnectorGrantAuthority, ConnectorRoute } from './route';

// P5 O4 M2 (Interfaces §F): what the spine's root hands the service.
export interface ConnectorsDeps {
  hosts: Pick<SpineHosts, 'dispatch' | 'onEvent' | 'onState' | 'onStreaming' | 'streaming'>;
  bus: Pick<ServicesBus, 'register' | 'emit'>; // register for the connectors' names; emit for watchUpdate, serversChanged, signInChanged
  view: SpineView; // routes E and D read the creator's directory and the project rows through it
  port: Pick<ClientPort, 'openExternal'>;
  custody: ConnectorOAuthSealer; // fileKeyCustody(join(profile, 'connectors', 'oauth'))
  directory: string; // <profile>/connectors/oauth
  listen: ListenLoopback;
  log?: (line: string) => void;
}

// What the part answers the root: its stop, the owner's delivery for the delivery service, and its work in flight.
export interface ConnectorsPart extends Settling {
  stop(): void;
  delivery: OwnerDelivery | null; // P4-B5: the owner's delivery through route D, where route D exists; null otherwise
}

// The service's composition with its routes chosen: production's is `startConnectors` (route D over the machine's key
// file); a test supplies its own route D and provider, or none (route E alone, H's engine-only service).
export interface ConnectorsComposition extends Pick<ConnectorsDeps, 'hosts' | 'bus' | 'view' | 'port' | 'log'> {
  realpath?: (path: string) => string | null;
  // P3-HD (Decision Log 14): route D's factory, which the service composes after route E. Absent: there is no route D.
  direct?: (deps: DirectRouteDeps) => DirectRoute;
  // P3-HD M3c2 (Decision Log 14, 19, 29): MAWS's own OAuth provider's factory, beside route D. It prepares route D's HTTP
  // credentials and serves the owner's Connect, Reconnect and Disconnect; its host closes are `connectors.directClose`
  // with the epoch floor it names. Absent (or without route D), route D sends no credential of MAWS's own.
  oauth?: (deps: Pick<ConnectorOAuthProviderDeps, 'closeHost' | 'log'> & { port: Pick<ClientPort, 'openExternal'> }) => ConnectorOAuthProvider;
}

const canonical = (path: string): string | null => {
  try {
    return realpathSync.native(path).normalize('NFC'); // the index's own canonical form (index/projects.ts)
  } catch {
    return null;
  }
};

export function startConnectors({ custody, directory, listen, ...deps }: ConnectorsDeps): ConnectorsPart {
  return composeConnectors({ ...deps, direct: createDirectRoute, oauth: (own) => productionConnectorOAuth({ ...own, custody, directory, listen }) });
}

export function composeConnectors({ hosts, bus, view, realpath = canonical, port, log = (line) => console.warn(`[connectors] ${line}`), direct: createDirect, oauth: createOAuth }: ConnectorsComposition): ConnectorsPart {
  const { register } = bus;
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
  const engine = createEngineRoute({ call, view, realpath, streaming: () => hosts.streaming('engine-host'), log });
  // P3-HD: route D joins after E (P3-H's brief: E first), when the root supplies it; its host leg is the direct operation family
  // P3-HD M3c2: MAWS's own OAuth, only beside route D; a host close is confirmed only by the host's acknowledgment
  const closeHost = async (target: { connectionId: string; credentialEpoch?: number }) => (await call('connectors.directClose', target).catch(() => null))?.ok === true;
  const oauth = createDirect && createOAuth ? createOAuth({ closeHost, log, port }) : null;
  const direct = createDirect?.({ call, view, realpath, streaming: () => hosts.streaming('engine-host'), log, ...(oauth && { credentials: oauth }) });
  const routes: ConnectorRoute[] = direct ? [engine, direct] : [engine];
  // P5 O4 D8: the broker holds the app's latest report of each owner's window; no re-read is asked of it
  const broker = new ConnectorBroker({ routes, grants, log, sessionRoute: (appSessionId, artifactId, tool, signal) => engine.resolveSession(appSessionId, artifactId, tool, signal) /* E3 */ });
  const working = new Work(); // D17: the agents' refreshes and the owner's actions in flight

  // ── the owners: a client's end closes its leases and forgets its window ──
  const owners = new Set<string>();
  let stopped = false;
  const ownerOf = (client: ClientRef): string => {
    if (stopped) throw new Error('the connector service has stopped');
    const owner = client.id;
    if (owners.has(owner)) return owner;
    owners.add(owner);
    client.onGone(() => {
      if (!owners.delete(owner)) return; // the stop let go of it already
      broker.forgetOwner(owner); // its leases close, and its window's state goes with it
    });
    // gone for good (the listener ran at once): nothing opens for it again
    if (!owners.has(owner)) throw new Error('the client has ended');
    return owner;
  };
  const sendUpdate = (update: ConnectorWatchUpdate): void => {
    if (!bus.emit('connectors.watchUpdate', update)) log('connectors: refused to send an invalid connectors.watchUpdate');
  };

  // ── the app's report of a page's window (D8) ──
  register('connectors.windowShown', ({ shown }, { client }) => {
    broker.setWindowShown(ownerOf(client), shown);
    return { ok: true as const };
  });
  // ── a page's lease, through its owner window ──
  register('connectors.open', ({ artifactId }, { client }) => ({ leaseId: broker.open(ownerOf(client), artifactId) }));
  register('connectors.declare', ({ leaseId, tools }, { client }) => broker.declareTools(ownerOf(client), leaseId, tools));
  register('connectors.call', ({ leaseId, request, dataset }, { client }) => broker.callTool(ownerOf(client), leaseId, request, dataset && { dataset } /* E3 */));
  register('connectors.watch', ({ leaseId, request, dataset }, { client }) => {
    let watchId: string | null = null; // the first refresh runs a timer turn after the start answers
    const listener = (update: ConnectorCallOutcome) => {
      if (watchId !== null) sendUpdate({ leaseId, watchId, update });
    };
    const start = broker.watchTool(ownerOf(client), leaseId, request, listener, dataset && { dataset } /* E3 */);
    if (start.ok) watchId = start.watchId;
    return start;
  });
  register('connectors.unwatch', ({ leaseId, watchId }, { client }) => ({ stopped: broker.unwatch(ownerOf(client), leaseId, watchId) }));
  register('connectors.refresh', ({ leaseId, watchId, probe }, { client }) => ({ refreshing: probe === undefined ? broker.refreshWatch(ownerOf(client), leaseId, watchId) : broker.refreshWatch(ownerOf(client), leaseId, watchId, { probe }) /* E3 panel */ }));
  register('connectors.visibility', ({ leaseId, visible }, { client }) => ({ ok: broker.setVisible(ownerOf(client), leaseId, visible) }));
  register('connectors.close', ({ leaseId }, { client }) => ({ closed: broker.close(ownerOf(client), leaseId) }));
  // ── the owner's grants, from the editor header ──
  register('artifacts.connectorGrants', async ({ artifactId }) => ({ grants: await broker.grants(artifactId) }));
  register('artifacts.grantConnectorTool', ({ artifactId, tool }) => broker.grantTool(artifactId, tool));
  register('artifacts.revokeConnectorTool', async ({ artifactId, server, tool }) => ({ revoked: await broker.revokeTool(artifactId, { server, tool }) }));
  // P3-HD M3c2: the owner's per-server rows and actions (./owner.ts), where route D exists; trusted, never a page's
  const owner = direct ? createConnectorOwner({ direct, oauth, grants: grants.list, log, serversChanged: (artifactId) => void bus.emit('connectors.serversChanged', { artifactId }), track: (action) => working.track(action) }) : null;
  if (owner) {
    register('connectors.servers', ({ artifactId, tools }, { client }) => owner.servers(artifactId, tools, client));
    register('connectors.connect', ({ artifactId, sourceHandle }, { client }) => owner.connect(artifactId, sourceHandle, client));
    register('connectors.reconnect', ({ artifactId, sourceHandle }, { client }) => owner.reconnect(artifactId, sourceHandle, client));
    register('connectors.disconnect', ({ connectionId }) => owner.disconnect(connectionId));
  }
  // P5 O4 M2 (U7, D23): a grant the app opened from Electron's safeStorage, re-sealed under the machine's key
  register('connectors.adoptGrant', async ({ connectionId, record }) => (oauth ? oauth.adopt(connectionId, record) : { adopted: false as const, reason: 'unavailable' as const }));

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
  const stopRefreshes = hosts.onEvent('maws.artifact.datasetRefresh', ({ requestId }) => void working.track(refresh(requestId)));
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
  const settling = allSettling([working]);
  return {
    delivery, // P4-B5
    busy: () => settling.busy(),
    settled: () => settling.settled(),
    stop: () => {
      stopEnded();
      stopRefreshes(); // E3
      stopDirectEnded(); // P3-HD
      stopGrants();
      stopDeletes();
      stopState();
      stopStreaming();
      stopped = true; // no owner is followed again
      owners.clear();
      broker.stop();
      engine.stop();
      owner?.stop(); // P3-HD M3c2
      direct?.stop(); // P3-HD: terminal, each pending operation withdrawn from the host
      oauth?.stop(); // P3-HD M3c2; P5 O4 D10: and every connection it issued a credential for closed in the host
    },
  };
}
