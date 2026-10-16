// P3-H H3b: main's connector service (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log 24, 80, 82,
// 83, 84 and 85). The broker (./broker.ts) over route E (./engine-route.ts) and the host's grant store, answering the
// renderer's `connectors.*` page-lease commands and the owner's `artifacts.*` grant commands.
//
// - Main is the scheduler and the first check; the detached host holds the store and makes the last check at the write.
//   The store's and route E's commands are main-only: no window reaches them except through this service.
// - A lease belongs to the window that opened it (its webContents id): closing, navigating or crashing ends its leases,
//   and a watch's refreshes go to that window alone (`connectors.watchUpdate`, validated as `emit` would), never to all.
// - The store's committed grant changes (the host's `connectors.grantChanged`) feed the broker: a revoke or a delete
//   stops the tool's work, a grant wakes its watches, an Allow once consumed stops nothing.
// - The engine host leaving `ready` answers (and withdraws) every route E operation pending; each later call resolves
//   afresh. Its events reach main only once its connection streams, so route E starts operations only then, and each
//   time a connection starts streaming main reconciles what an event dropped before it: the pending operations'
//   outcomes are taken, and every watch waiting for a grant has its grant re-read from the store.
import { realpathSync } from 'node:fs';
import type { WebContents } from 'electron';
import type { ConnectorCallOutcome } from '@shared/artifacts/connectors';
import { eventChannel, type CommandInput, type CommandName, type CommandOutput, type CommandResult, type HostState } from '@shared/ipc/schema';
import type { ConnectorWatchUpdate } from '@shared/ipc/schema/connectors';
import { validateEventPayload } from '@shared/ipc/validate';
import type { HostSupervisor } from '../hosts/supervisor';
import type { registerMainHandler } from '../ipc/router';
import { ConnectorBroker } from './broker';
import { createEngineRoute, type EngineRouteDeps } from './engine-route';
import type { ConnectorGrantAuthority, ConnectorRoute } from './route';

export type ConnectorSender = Pick<WebContents, 'id' | 'isDestroyed' | 'send' | 'on' | 'once'>;

export interface ConnectorsDeps {
  hosts: Pick<HostSupervisor, 'dispatch' | 'onEvent' | 'onState' | 'onStreaming' | 'streaming'>;
  register: typeof registerMainHandler;
  index: { sessions: EngineRouteDeps['sessions']; projects: EngineRouteDeps['projects'] };
  realpath?: (path: string) => string | null;
  log?: (line: string) => void;
}

const canonical = (path: string): string | null => {
  try {
    return realpathSync.native(path).normalize('NFC'); // the index's own canonical form (index/projects.ts)
  } catch {
    return null;
  }
};

export function startConnectors({ hosts, register, index, realpath = canonical, log = (line) => console.warn(`[connectors] ${line}`) }: ConnectorsDeps): { stop(): void } {
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
  const routes: ConnectorRoute[] = [engine]; // route D joins after it (P3-H's brief: E first)
  const broker = new ConnectorBroker({ routes, grants, log });

  // ── the owner windows ──
  const followed = new Set<number>();
  const ownerOf = (sender: ConnectorSender): string => {
    const id = sender.id; // read now: a destroyed webContents may no longer answer
    if (!followed.has(id)) {
      followed.add(id);
      const end = () => broker.closeOwner(String(id));
      sender.on('did-navigate', end); // a reload or another page: the old page's leases go with it
      sender.on('render-process-gone', end);
      sender.once('destroyed', () => {
        followed.delete(id);
        end();
      });
    }
    return String(id);
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
  register('connectors.call', ({ leaseId, request }, { sender }) => broker.callTool(ownerOf(sender), leaseId, request));
  register('connectors.watch', ({ leaseId, request }, { sender }) => {
    let watchId: string | null = null; // the first refresh runs a timer turn after the start answers
    const listener = (update: ConnectorCallOutcome) => {
      if (watchId !== null) sendUpdate(sender, { leaseId, watchId, update });
    };
    const start = broker.watchTool(ownerOf(sender), leaseId, request, listener);
    if (start.ok) watchId = start.watchId;
    return start;
  });
  register('connectors.unwatch', ({ leaseId, watchId }, { sender }) => ({ stopped: broker.unwatch(ownerOf(sender), leaseId, watchId) }));
  register('connectors.refresh', ({ leaseId, watchId }, { sender }) => ({ refreshing: broker.refreshWatch(ownerOf(sender), leaseId, watchId) }));
  register('connectors.visibility', ({ leaseId, visible }, { sender }) => ({ ok: broker.setVisible(ownerOf(sender), leaseId, visible) }));
  register('connectors.close', ({ leaseId }, { sender }) => ({ closed: broker.close(ownerOf(sender), leaseId) }));
  // ── the owner's grants, from the editor header ──
  register('artifacts.connectorGrants', async ({ artifactId }) => ({ grants: await broker.grants(artifactId) }));
  register('artifacts.grantConnectorTool', ({ artifactId, tool }) => broker.grantTool(artifactId, tool));
  register('artifacts.revokeConnectorTool', async ({ artifactId, server, tool }) => ({ revoked: await broker.revokeTool(artifactId, { server, tool }) }));

  const stopEnded = hosts.onEvent('connectors.operation', ({ operationId }) => engine.operationEnded(operationId));
  const stopGrants = hosts.onEvent('connectors.grantChanged', (change) => broker.onGrantChange(change));
  const stopState = hosts.onState('engine-host', (state: HostState) => {
    if (state.state !== 'ready') engine.hostLost();
  });
  const stopStreaming = hosts.onStreaming('engine-host', () => {
    engine.reconcile();
    broker.recheckGrants();
  });
  return {
    stop: () => {
      stopEnded();
      stopGrants();
      stopState();
      stopStreaming();
      broker.stop();
      engine.stop();
    },
  };
}
