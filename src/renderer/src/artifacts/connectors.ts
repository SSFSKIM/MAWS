// P3-H H4: the renderer's half of the ArtifactHost's connector family (src/artifacts/host.ts, `ConnectorSurface`; the X9
// amendment, docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log 80, 84 and 85): a page's surface over
// main's lease commands (`connectors.*`, src/main/connectors) and the owner's grants over main's `artifacts.*` grant
// commands. Main checks everything a page sends; this adapter only keeps a surface's commands under its lease, in order.
//
// - A surface opens its lease at once; what is asked before the lease answers is sent after it, in the order asked
//   (each command waits on the one open). A lease that cannot be opened, or a surface closed, answers `invalid: lease`
//   (false for an unwatch or a refresh) without asking main; a lease that answers after its surface closed is closed.
// - The close fences both ways (the review's I3): nothing asked of a surface is sent once it closed, even what waited
//   for its lease, and nothing answered after it is published: a call in flight reads `paused: closed`, a declaration or
//   a watch's start `invalid: lease` (the watch registers nothing; main ended it with the lease). The close itself
//   runs its own path past the fence.
// - A watch's refreshes arrive as `connectors.watchUpdate` for this window alone and reach the listener of the watch
//   they name on the lease they name. One can overtake its watch's start answer: refreshes for a watch id this surface
//   does not know yet are held, per watch (its few latest, so up to the 64 watches main runs at once each keep their
//   first), while one of its watch starts is unanswered, handed over when that start names the id, and dropped once no
//   start is unanswered. Nothing is heard after an unwatch or the close, a close by the listener itself included.
import type { ConnectorSurface } from '@artifacts/host';
import {
  CONNECTOR_WATCH_LIMIT,
  type ConnectorCallOutcome,
  type ConnectorGrant,
  type ConnectorGrantGesture,
  type ConnectorGrantOutcome,
  type ConnectorInvalid,
  type ConnectorToolRef,
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
const HELD_PER_WATCH = 4; // the latest refreshes held per watch whose start has not answered (it refreshes at most every 30 s)
const CLOSED: ConnectorCallOutcome = { ok: false, state: 'paused', reason: 'closed' };

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
    const held = new Map<string, ConnectorCallOutcome[]>(); // by watch id, refreshes whose watch's start is unanswered
    let starting = 0; // watch starts not yet answered

    const deliver = (update: ConnectorWatchUpdate) => {
      if (closed) return;
      const listener = listeners.get(update.watchId);
      if (listener) return listener(update.update);
      if (starting === 0) return;
      const kept = held.get(update.watchId) ?? [];
      if (!held.has(update.watchId)) {
        if (held.size >= CONNECTOR_WATCH_LIMIT) return; // more watches than main runs: none of them is this surface's
        held.set(update.watchId, kept);
      }
      kept.push(update.update);
      if (kept.length > HELD_PER_WATCH) kept.shift(); // its latest; a watch refreshes at most every 30 s
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

    // `work` under the lease. Fenced twice by the close: nothing is sent once the surface closed (or when no lease
    // opened: `fallback`), and an answer that arrives after the close is not published (`closedAnswer` instead).
    const under = async <T>(fallback: T, closedAnswer: T, work: (leaseId: string) => Promise<T>): Promise<T> => {
      if (closed) return fallback;
      const leaseId = await lease;
      if (leaseId === null || closed) return fallback;
      const answer = await work(leaseId);
      return closed ? closedAnswer : answer;
    };

    return {
      declareTools: (tools) => under(NO_LEASE, NO_LEASE, (leaseId) => call('connectors.declare', { leaseId, tools })),
      // E3: the owner's dataset sink rides beside the request, never inside it
      callTool: (request, options) => under<ConnectorCallOutcome>(NO_LEASE, CLOSED, (leaseId) => call('connectors.call', { leaseId, request, ...(options && { dataset: options.dataset }) })),
      watchTool: async (request, listener, options) => {
        if (closed) return NO_LEASE;
        starting += 1;
        try {
          const start = await under(NO_LEASE, NO_LEASE, (leaseId) => call('connectors.watch', { leaseId, request, ...(options && { dataset: options.dataset }) /* E3 */ }));
          if (!start.ok) return start; // a close before the answer: `under` answered the lease refusal
          listeners.set(start.watchId, listener);
          for (const update of held.get(start.watchId) ?? []) {
            if (closed || listeners.get(start.watchId) !== listener) break; // a listener closed the page, or unwatched
            listener(update);
          }
          held.delete(start.watchId);
          // a listener that closed the page while its held refreshes were handed over: no watch was started for it
          return closed ? NO_LEASE : start;
        } finally {
          starting -= 1;
          if (starting === 0) held.clear();
        }
      },
      unwatchTool: (watchId) => {
        listeners.delete(watchId);
        return under(false, false, async (leaseId) => (await call('connectors.unwatch', { leaseId, watchId })).stopped);
      },
      // E3 panel: the owner's probe rides beside the watch's id; without it, the command H sends
      refreshWatch: (watchId, options) => under(false, false, async (leaseId) => (await call('connectors.refresh', { leaseId, watchId, ...(options?.probe !== undefined && { probe: options.probe }) })).refreshing),
      setVisible: (visible) => {
        void under(null, null, (leaseId) => call('connectors.visibility', { leaseId, visible })).catch(() => {});
      },
      // The close's own path, past the fence it raises: the lease is closed in main once it is known (a lease answering
      // after this is closed where it arrives).
      close: () => {
        if (closed) return;
        closed = true;
        listeners.clear();
        held.clear();
        void lease.then((leaseId) => {
          unroute?.();
          if (leaseId !== null) void call('connectors.close', { leaseId }).catch(() => {});
        });
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
