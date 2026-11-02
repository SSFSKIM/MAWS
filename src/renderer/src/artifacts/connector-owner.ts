// P3-HD M3c2: the owner's per-server connector rows and actions, the renderer's half (docs/doperpowers/plans/
// 2026-10-17-p3-hd-direct-route.md, M3 and Decision Log 29): main's trusted `connectors.servers`, `.connect`,
// `.reconnect`, `.disconnect` and its targeted `connectors.serversChanged`. A separate owner dependency of the Connectors
// sheet, never part of the ArtifactHost or a page's surface: no page reaches MAWS's OAuth.
// P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "O4's surfaces: the grade"): the rows and actions are
// the artifact's machine's (its connections live there), so every command names that machine, a connection's Disconnect
// included; a row change is heard from that machine alone.
import type { ConnectorToolRef } from '@shared/artifacts/connectors';
import type { CommandInput, CommandName, CommandOutput, InvokeRest, MawsBridge } from '@shared/ipc/schema';
import type { ConnectorOwnerAck, ConnectorServers } from '@shared/ipc/schema/connectors';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { ArtifactCommandError } from './command-error';
import { artifactMachineOf } from './machines';

export interface ConnectorsOwner {
  servers(artifactId: string, tools: readonly ConnectorToolRef[]): Promise<ConnectorServers>;
  connect(artifactId: string, sourceHandle: string): Promise<ConnectorOwnerAck>;
  reconnect(artifactId: string, sourceHandle: string): Promise<ConnectorOwnerAck>;
  disconnect(artifactId: string, connectionId: string): Promise<ConnectorOwnerAck>; // a connection of the artifact's machine
  // an artifact's rows changed (an action ended, the host restarted): read them again; said by the artifact's machine
  onServersChanged(listener: (artifactId: string) => void): () => void;
}

export function createConnectorsOwner(bridge: Pick<MawsBridge, 'invoke' | 'on' | 'localMachine'>): ConnectorsOwner {
  const machineOf = (artifactId: string): MachineRef => artifactMachineOf(artifactId) ?? bridge.localMachine;
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>, ...opts: InvokeRest<N>): Promise<CommandOutput<N>> => {
    const result = await bridge.invoke(name, input, ...opts);
    if (!result.ok) throw new ArtifactCommandError(result.error);
    return result.value;
  };
  return {
    servers: (artifactId, tools) => call('connectors.servers', { artifactId, tools: tools.slice(0, 256).map(({ server, tool }) => ({ server, tool })) }, { machine: machineOf(artifactId) }),
    connect: (artifactId, sourceHandle) => call('connectors.connect', { artifactId, sourceHandle }, { machine: machineOf(artifactId) }),
    reconnect: (artifactId, sourceHandle) => call('connectors.reconnect', { artifactId, sourceHandle }, { machine: machineOf(artifactId) }),
    disconnect: (artifactId, connectionId) => call('connectors.disconnect', { connectionId }, { machine: machineOf(artifactId) }),
    onServersChanged: (listener) =>
      bridge.on('connectors.serversChanged', ({ artifactId }, from) => {
        if (from.machine === machineOf(artifactId)) listener(artifactId);
      }),
  };
}

let owner: ConnectorsOwner | null = null;
// The window's one owner adapter, over the validated IPC client.
export function connectorsOwner(): ConnectorsOwner {
  owner ??= createConnectorsOwner(ipc);
  return owner;
}
