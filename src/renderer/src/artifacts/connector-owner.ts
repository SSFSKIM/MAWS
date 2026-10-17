// P3-HD M3c2: the owner's per-server connector rows and actions, the renderer's half (docs/doperpowers/plans/
// 2026-10-17-p3-hd-direct-route.md, M3 and Decision Log 29): main's trusted `connectors.servers`, `.connect`,
// `.reconnect`, `.disconnect` and its targeted `connectors.serversChanged`. A separate owner dependency of the Connectors
// sheet, never part of the ArtifactHost or a page's surface: no page reaches MAWS's OAuth.
import type { ConnectorToolRef } from '@shared/artifacts/connectors';
import type { CommandInput, CommandName, CommandOutput, MawsBridge } from '@shared/ipc/schema';
import type { ConnectorOwnerAck, ConnectorServers } from '@shared/ipc/schema/connectors';
import { ipc } from '../ipc/client';
import { ArtifactCommandError } from './command-error';

export interface ConnectorsOwner {
  servers(artifactId: string, tools: readonly ConnectorToolRef[]): Promise<ConnectorServers>;
  connect(artifactId: string, sourceHandle: string): Promise<ConnectorOwnerAck>;
  reconnect(artifactId: string, sourceHandle: string): Promise<ConnectorOwnerAck>;
  disconnect(connectionId: string): Promise<ConnectorOwnerAck>;
  // an artifact's rows changed (an action ended, the host restarted): read them again
  onServersChanged(listener: (artifactId: string) => void): () => void;
}

export function createConnectorsOwner(bridge: Pick<MawsBridge, 'invoke' | 'on'>): ConnectorsOwner {
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const result = await bridge.invoke(name, input);
    if (!result.ok) throw new ArtifactCommandError(result.error);
    return result.value;
  };
  return {
    servers: (artifactId, tools) => call('connectors.servers', { artifactId, tools: tools.slice(0, 256).map(({ server, tool }) => ({ server, tool })) }),
    connect: (artifactId, sourceHandle) => call('connectors.connect', { artifactId, sourceHandle }),
    reconnect: (artifactId, sourceHandle) => call('connectors.reconnect', { artifactId, sourceHandle }),
    disconnect: (connectionId) => call('connectors.disconnect', { connectionId }),
    onServersChanged: (listener) => bridge.on('connectors.serversChanged', ({ artifactId }) => listener(artifactId)),
  };
}

let owner: ConnectorsOwner | null = null;
// The window's one owner adapter, over the validated IPC client.
export function connectorsOwner(): ConnectorsOwner {
  owner ??= createConnectorsOwner(ipc);
  return owner;
}
