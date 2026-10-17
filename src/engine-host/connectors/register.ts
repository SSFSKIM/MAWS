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

type HostConnectorCommand = { [N in keyof typeof ConnectorCommands]: (typeof ConnectorCommands)[N]['owner'] extends 'engine-host' ? N : never }[keyof typeof ConnectorCommands];

export const CONNECTORS_DEADLINE_SHAPES: Record<HostConnectorCommand, DeadlineShape> = {
  'connectors.grants': 'immediate', 'connectors.grant': 'immediate', 'connectors.revoke': 'immediate', 'connectors.check': 'immediate',
  'connectors.resolve': 'bounded', 'connectors.start': 'immediate', 'connectors.take': 'immediate', 'connectors.cancel': 'immediate',
};

export interface ConnectorsSurfaceDeps {
  sessions: { get(appSessionId: AppSessionId): Pick<EngineSession, 'lifecycle' | 'control' | 'status'> | undefined }; // the process table
  store: ArtifactStore | null; // null: the store failed to open this run
  calls?: ConnectorCalls; // tests
}

function refused(reason: ArtifactRefusal['reason'], message: string, data: Record<string, unknown> = {}, code: 'invalid_input' | 'internal' = 'invalid_input'): HostCommandError {
  return new HostCommandError(ipcError(code, message, { reason, data } satisfies ArtifactRefusal));
}

export function registerConnectors(on: HostOn, emit: HostEmit, client: Pick<HostClientHooks, 'onClientGone'>, deps: ConnectorsSurfaceDeps): { close(): void } {
  const { store } = deps;
  const calls =
    deps.calls ??
    new ConnectorCalls({
      session: (id) => deps.sessions.get(id as AppSessionId),
      store: () => store,
      completed: (operationId) => void emit('connectors.operation', { operationId }),
    });
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
  serve('connectors.take', ({ operationId }) => ({ outcome: calls.take(operationId) }));
  serve('connectors.cancel', ({ operationId }) => ({ cancelled: calls.cancel(operationId) }));

  const stopFeed = store?.onConnectorGrantChange((change) => void emit('connectors.grantChanged', change));
  const stopGone = client.onClientGone(() => calls.close());
  return {
    close: () => {
      stopFeed?.();
      stopGone();
      calls.close();
    },
  };
}
