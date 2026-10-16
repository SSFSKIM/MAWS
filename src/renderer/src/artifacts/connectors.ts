// P3-H H4: the renderer's half of the ArtifactHost's connector family (src/artifacts/host.ts, `ConnectorSurface`; the X9
// amendment, docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log 80, 84 and 85): a page's surface over
// main's lease commands (`connectors.*`, src/main/connectors) and the owner's grants over main's `artifacts.*` grant
// commands. Main checks everything a page sends; this adapter only keeps a surface's commands under its lease, in order.
//
// - A surface opens its lease at once; what is asked before the lease answers is sent after it, in the order asked
//   (each command waits on the one open). A lease that cannot be opened, or a surface closed, answers `invalid: lease`
//   (false for an unwatch or a refresh) without asking main; a lease that answers after its surface closed is closed.
// - A watch's refreshes arrive as `connectors.watchUpdate` for this window alone and reach the listener of the watch
//   they name on the lease they name. One can overtake its watch's start answer: refreshes for a watch id this surface
//   does not know yet are held while one of its watch starts is unanswered, handed over when that start names the id,
//   and dropped once no start is unanswered. Nothing is heard after an unwatch or the close.
import type { ConnectorSurface } from '@artifacts/host';
import type {
  ConnectorCallOutcome,
  ConnectorGrant,
  ConnectorGrantGesture,
  ConnectorGrantOutcome,
  ConnectorInvalid,
  ConnectorToolRef,
} from '@shared/artifacts/connectors';
import type { CommandInput, CommandName, CommandOutput, MawsBridge } from '@shared/ipc/schema';
import type { ConnectorWatchUpdate } from '@shared/ipc/schema/connectors';
import { ArtifactCommandError } from './command-error';

type Listener = (update: ConnectorCallOutcome) => void;

export interface ConnectorHost {
  openConnectors(artifactId: string): ConnectorSurface;
  connectorGrants(artifactId: string): Promise<ConnectorGrant[]>;
  grantConnectorTool(artifactId: string, tool: ConnectorGrantGesture): Promise<ConnectorGrantOutcome>;
  revokeConnectorTool(artifactId: string, tool: ConnectorToolRef): Promise<boolean>;
}

const NO_LEASE: ConnectorInvalid = { ok: false, state: 'invalid', reason: 'lease' };
const HELD_MAX = 16; // refreshes held per surface for watches whose start has not answered

export function createConnectorHost(ipc: Pick<MawsBridge, 'invoke' | 'on'>): ConnectorHost {
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const result = await ipc.invoke(name, input);
    if (!result.ok) throw new ArtifactCommandError(result.error);
    return result.value;
  };

  // The window's surfaces by lease, which the one subscription to `connectors.watchUpdate` routes to.
  const byLease = new Map<string, (update: ConnectorWatchUpdate) => void>();
  let unsubscribe: (() => void) | null = null;
  const route = (leaseId: string, deliver: (update: ConnectorWatchUpdate) => void): (() => void) => {
    unsubscribe ??= ipc.on('connectors.watchUpdate', (update) => byLease.get(update.leaseId)?.(update));
    byLease.set(leaseId, deliver);
    return () => {
      byLease.delete(leaseId);
      if (byLease.size === 0) {
        unsubscribe?.();
        unsubscribe = null;
      }
    };
  };

  function openConnectors(artifactId: string): ConnectorSurface {
    let closed = false;
    let unroute: (() => void) | null = null;
    const listeners = new Map<string, Listener>();
    const held: ConnectorWatchUpdate[] = [];
    let starting = 0; // watch starts not yet answered

    const deliver = (update: ConnectorWatchUpdate) => {
      if (closed) return;
      const listener = listeners.get(update.watchId);
      if (listener) return listener(update.update);
      if (starting > 0) {
        held.push(update);
        if (held.length > HELD_MAX) held.shift();
      }
    };

    const lease: Promise<string | null> = call('connectors.open', { artifactId }).then(
      ({ leaseId }) => {
        if (closed) {
          void call('connectors.close', { leaseId }).catch(() => {});
          return null;
        }
        unroute = route(leaseId, deliver);
        return leaseId;
      },
      () => null,
    );

    // `work` under the lease, or `fallback` when there is none (never opened, or closed before the work's turn).
    const under = async <T>(fallback: T, work: (leaseId: string) => Promise<T>): Promise<T> => {
      if (closed) return fallback;
      const leaseId = await lease;
      return leaseId === null ? fallback : work(leaseId);
    };

    return {
      declareTools: (tools) => under(NO_LEASE, (leaseId) => call('connectors.declare', { leaseId, tools })),
      callTool: (request) => under<ConnectorCallOutcome>(NO_LEASE, (leaseId) => call('connectors.call', { leaseId, request })),
      watchTool: async (request, listener) => {
        if (closed) return NO_LEASE;
        starting += 1;
        try {
          const start = await under(NO_LEASE, (leaseId) => call('connectors.watch', { leaseId, request }));
          if (!start.ok || closed) return start;
          listeners.set(start.watchId, listener);
          for (const update of held.filter((item) => item.watchId === start.watchId)) listener(update.update);
          return start;
        } finally {
          starting -= 1;
          if (starting === 0) held.length = 0;
        }
      },
      unwatchTool: (watchId) => {
        listeners.delete(watchId);
        return under(false, async (leaseId) => (await call('connectors.unwatch', { leaseId, watchId })).stopped);
      },
      refreshWatch: (watchId) => under(false, async (leaseId) => (await call('connectors.refresh', { leaseId, watchId })).refreshing),
      setVisible: (visible) => {
        void under(null, (leaseId) => call('connectors.visibility', { leaseId, visible })).catch(() => {});
      },
      close: () => {
        if (closed) return;
        void under(null, (leaseId) => call('connectors.close', { leaseId })).catch(() => {});
        closed = true;
        listeners.clear();
        held.length = 0;
        void lease.then(() => unroute?.());
      },
    };
  }

  return {
    openConnectors,
    connectorGrants: async (artifactId) => (await call('artifacts.connectorGrants', { artifactId })).grants,
    grantConnectorTool: (artifactId, tool) => call('artifacts.grantConnectorTool', { artifactId, tool }),
    revokeConnectorTool: async (artifactId, { server, tool }) => (await call('artifacts.revokeConnectorTool', { artifactId, server, tool })).revoked,
  };
}
