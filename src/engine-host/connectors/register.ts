// P3-H H3b: the engine host's `connectors.*` commands, main's alone (docs/doperpowers/plans/2026-10-12-p3-co-work.md,
// P3-H and Decision Log 80, 82 and 85; schema: @shared/ipc/schema/connectors). The grant store's reads and writes, and
// route E's engine leg (./calls.ts): `resolve` bounded (a probe and a status read under one 8 s budget), everything else
// answered at once from the store at its commit or from the operation table, so none outlives the supervisor's 10 s
// dispatch; a tool's own duration is carried by `connectors.operation` and `connectors.take`. The store's committed grant
// changes go out as `connectors.grantChanged` (the tool and the change, nothing more). Every operation and outcome ends
// when main's client goes, and at the host's shutdown.
import { HostCommandError, type HostClientHooks, type HostEmit, type HostOn } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { ArtifactRefusal } from '@shared/ipc/schema/artifacts';
import type { commands as ConnectorCommands } from '@shared/ipc/schema/connectors';
import type { AppSessionId } from '@shared/graph/ids';
import { ArtifactStoreError, StoreTooNewError } from '../documents/errors';
import type { ArtifactStore } from '../documents/store';
import type { DeadlineShape } from '../ipc';
import type { EngineSession } from '../session';
import { ConnectorCalls } from './calls';
import type { DatasetRefreshRequests } from './dataset-requests'; // E3
import { connectorDatasetSink } from './dataset-sink'; // E3
import { ConnectorStatusCache } from './provenance'; // P3-HD
import { DirectCalls } from './direct-calls'; // P3-HD M2
import { DirectConnectionPool } from './direct-client'; // P3-HD M2
import { ConfiguredDeliverySources } from './configured-delivery'; // WR 76/78

// P4-AGG M4: `connectors.add` and `connectors.remove` are the plugin runner's (ipc.ts registers them beside `plugins.*`)
export const RUNNER_CONNECTOR_COMMANDS = ['connectors.add', 'connectors.remove'] as const;
type HostConnectorCommand = Exclude<{ [N in keyof typeof ConnectorCommands]: (typeof ConnectorCommands)[N]['owner'] extends 'engine-host' ? N : never }[keyof typeof ConnectorCommands], (typeof RUNNER_CONNECTOR_COMMANDS)[number]>;

export const CONNECTORS_DEADLINE_SHAPES: Record<HostConnectorCommand, DeadlineShape> = {
  'connectors.grants': 'immediate', 'connectors.grant': 'immediate', 'connectors.revoke': 'immediate', 'connectors.check': 'immediate',
  'connectors.resolve': 'bounded', 'connectors.start': 'immediate', 'connectors.take': 'immediate', 'connectors.cancel': 'immediate',
  // P3-HD M2: route D's, each answered from the operation table at once (a lookup or connection is an operation's)
  'connectors.directResolve': 'immediate', 'connectors.directStart': 'immediate', 'connectors.directDiscover': 'immediate',
  'connectors.directTake': 'immediate', 'connectors.directCancel': 'immediate', 'connectors.directClose': 'immediate',
  // P4-B5: the owner's delivery (operations, as route D's), and route E's observation (a status read, as `resolve`)
  'connectors.directLocate': 'immediate', 'connectors.directSend': 'immediate', 'connectors.observe': 'bounded',
};

export interface ConnectorsSurfaceDeps {
  sessions: {
    get(appSessionId: AppSessionId): (Pick<EngineSession, 'lifecycle' | 'control' | 'status'> & Partial<Pick<EngineSession, 'connectorLaunchContext'>>) | undefined;
    // P3-HD panel correction: the table's rows and their change (a launch replacing a row), so a replaced launch's
    // pending observation is retired at once
    list?(): readonly Pick<EngineSession, 'status'>[];
    onRowsChanged?(listener: () => void): () => void;
  }; // the process table (P3-HD: and its launch facts)
  store: ArtifactStore | null; // null: the store failed to open this run
  calls?: ConnectorCalls; // tests
  datasetRefresh?: DatasetRefreshRequests; // E3: the agents' refresh requests a dataset start may name (absent: none)
  statusCache?: ConnectorStatusCache; // P3-HD: tests
  direct?: DirectCalls; // P3-HD M2: tests
  deliveryConfig?: { userData: string; captureEnv: () => Promise<Record<string, string>> }; // WR 76/78: host-owned, never renderer input
}

function refused(reason: ArtifactRefusal['reason'], message: string, data: Record<string, unknown> = {}, code: 'invalid_input' | 'internal' = 'invalid_input'): HostCommandError {
  return new HostCommandError(ipcError(code, message, { reason, data } satisfies ArtifactRefusal));
}

// `close` (the end of the host's shutdown) ends everything. P3-HD M2: `closeDirect`, which the shutdown starts beside the
// sessions' stop and awaits, ends route D's work and resolves once every owned process of its connections is gone.
export function registerConnectors(on: HostOn, emit: HostEmit, client: Pick<HostClientHooks, 'onClientGone'>, deps: ConnectorsSurfaceDeps): { close(): void; closeDirect(): Promise<void>; statusCache: ConnectorStatusCache } {
  const { store } = deps;
  // P3-HD: route D's observations, host memory for main's attachment only (cleared with the operations below)
  const statusCache = deps.statusCache ?? new ConnectorStatusCache();
  const calls =
    deps.calls ??
    new ConnectorCalls({
      session: (id) => deps.sessions.get(id as AppSessionId),
      store: () => store,
      completed: (operationId) => void emit('connectors.operation', { operationId }),
      datasets: connectorDatasetSink({ store: () => store, requests: deps.datasetRefresh ?? null }), // E3
      statusCache, // P3-HD
    });
  // P3-HD M2: route D's host half over the same store and observations; its connections live for main's attachment
  const direct =
    deps.direct ??
    new DirectCalls({ datasets: connectorDatasetSink({ store: () => store, requests: deps.datasetRefresh ?? null }), cache: statusCache, ...(deps.deliveryConfig && { deliverySources: new ConfiguredDeliverySources(deps.deliveryConfig) }), pool: new DirectConnectionPool(), store: () => store, completed: (operationId) => void emit('connectors.directOperation', { operationId }) });
  const storeOf = (): ArtifactStore => {
    if (!store) throw refused('unavailable', 'the artifact store could not be opened this run', {}, 'internal');
    return store;
  };
  // the store's refusals typed as `artifacts.*` answers them
  const serve = <N extends HostConnectorCommand>(name: N, handler: (input: CommandInput<N>) => CommandOutput<N> | Promise<CommandOutput<N>>) =>
    on(name, async (input) => {
      try {
        return await handler(input);
      } catch (error) {
        if (error instanceof ArtifactStoreError) throw refused(error.code, error.message, error.data);
        if (error instanceof StoreTooNewError) throw refused('storeTooNew', error.message, {}, 'internal');
        throw error;
      }
    });

  serve('connectors.grants', async ({ artifactId }) => ({ grants: await storeOf().connectorGrants(artifactId) }));
  serve('connectors.grant', async ({ artifactId, grant }) => ({ grant: await storeOf().grantConnectorTool(artifactId, grant) }));
  serve('connectors.revoke', async ({ artifactId, server, tool }) => ({ revoked: await storeOf().revokeConnectorTool(artifactId, { server, tool }) }));
  serve('connectors.check', ({ artifactId, call }) => storeOf().checkConnectorCall(artifactId, call));
  serve('connectors.resolve', (input) => calls.resolve(input));
  serve('connectors.start', (input) => calls.start(input));
  serve('connectors.take', ({ operationId }) => calls.takeOperation(operationId)); // E3: a dataset operation's phase beside H's outcome
  serve('connectors.cancel', ({ operationId }) => ({ cancelled: calls.cancel(operationId) }));
  // P3-HD M2 start
  serve('connectors.directResolve', (input) => direct.resolve(input));
  serve('connectors.directStart', (input) => direct.start(input));
  serve('connectors.directDiscover', (input) => direct.discover(input));
  serve('connectors.directTake', ({ operationId }) => direct.takeOperation(operationId)); // E3c
  serve('connectors.directCancel', ({ operationId }) => ({ cancelled: direct.cancel(operationId) }));
  serve('connectors.directClose', ({ connectionId, credentialEpoch }) => ({ cancelled: direct.withdraw(connectionId, credentialEpoch) }));
  // P3-HD M2 end
  // P4-B5: the owner's delivery through route D, and route E's observation of one live session for it
  serve('connectors.directLocate', (input) => direct.locate(input));
  serve('connectors.directSend', (input) => direct.send(input));
  serve('connectors.observe', (input) => calls.observe(input));

  const stopFeed = store?.onConnectorGrantChange((change) => void emit('connectors.grantChanged', change));
  // P3-HD panel correction: every row's current launch, told to the observation cache as the rows change
  const stopRows = deps.sessions.onRowsChanged?.(() => {
    for (const session of deps.sessions.list?.() ?? []) {
      const { appSessionId, launchId } = session.status();
      statusCache.launched(appSessionId, launchId);
    }
  });
  // Main's going ends its attachment, not the host: everything of it goes now (P3-HD: the observations, and direct work
  // with its credentials, whose processes' end follows), and the next attachment starts afresh.
  const stopGone = client.onClientGone(() => {
    calls.close();
    statusCache.clear(); // P3-HD
    void direct.close(); // P3-HD M2
  });
  return {
    close: () => {
      stopFeed?.();
      stopRows?.(); // P3-HD panel correction
      stopGone();
      calls.close();
      statusCache.clear(); // P3-HD
      void direct.shutdown(); // P3-HD M2: already under way when the shutdown awaited closeDirect
    },
    closeDirect: () => direct.shutdown(), // P3-HD M2
    statusCache, // P3-HD: M2's direct route reads it
  };
}
