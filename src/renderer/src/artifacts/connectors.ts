// P3-H H4: the renderer's half of the ArtifactHost's connector family (src/artifacts/host.ts, `ConnectorSurface`; the X9
// amendment, docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log 80, 84 and 85): a page's surface over
// main's lease commands (`connectors.*`, src/services/connectors) and the owner's grants over main's `artifacts.*` grant
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
// - P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, D28): the leases live in `mawsd`, with the spine, and
//   end with its connection. At each streaming of the machine host after the first main tells every window
//   `connectors.reset`, and each open surface rebuilds its lease: a new open, then every tool main answered declared
//   (declarations add up) and its visibility as last asked, then each of its watches started again with its listener
//   (once per lease, whichever path asks first), before anything asked meanwhile is sent. The
//   page keeps the watch ids it was given; the surface maps them to the ones main runs now. A command in flight at the
//   reset answers as the host answered it. A lease that answers after a reset overtook its open is closed.
import type { ConnectorSurface } from '@artifacts/host';
import {
  CONNECTOR_WATCH_LIMIT,
  type ConnectorCallOutcome,
  type ConnectorGrant,
  type ConnectorGrantGesture,
  type ConnectorGrantOutcome,
  type ConnectorDeclareOutcome,
  type ConnectorInvalid,
  type ConnectorToolRef,
} from '@shared/artifacts/connectors';
import type { CommandInput, CommandName, CommandOutput, InvokeRest, MawsBridge } from '@shared/ipc/schema';
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
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>, ...opts: InvokeRest<N>): Promise<CommandOutput<N>> => {
    const result = await ipc.invoke(name, input, ...opts);
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

  // P5 O4 D28: each open surface's rebuild, run on `connectors.reset` (main's, at each streaming of mawsd after the first)
  const rebuilds = new Set<() => void>();
  let offReset: (() => void) | null = null;
  const onReset = (rebuild: () => void): (() => void) => {
    offReset ??= ipc.on('connectors.reset', () => {
      for (const each of [...rebuilds]) each();
    });
    rebuilds.add(rebuild);
    return () => {
      rebuilds.delete(rebuild);
      if (rebuilds.size === 0) {
        offReset?.();
        offReset = null;
      }
    };
  };

  function openConnectors(artifactId: string): ConnectorSurface {
    let closed = false;
    let unroute: (() => void) | null = null;
    // P5 O4 D28: what the surface asked of its lease, to ask again of a rebuilt one: every tool main answered declared
    // (its declarations add up, as the broker's do: the review's finding 2), its visibility as last asked, and its
    // watches by the id the page holds (its first start's), each with the id main runs it under now (null while it is not
    // installed on the current lease) and the lease generation its last start went to (one start per generation: the
    // review's finding 3)
    const declared = new Map<string, ConnectorToolRef>(); // by server and tool, in the order main first answered them
    let visible: boolean | null = null;
    interface Watch {
      readonly request: CommandInput<'connectors.watch'>['request'];
      readonly dataset: CommandInput<'connectors.watch'>['dataset'];
      readonly listener: Listener;
      current: string | null;
      startedOn: number;
    }
    const watches = new Map<string, Watch>(); // by the page's watch id
    const pageIdOf = new Map<string, string>(); // main's watch id on the current lease → the page's
    const held = new Map<string, ConnectorCallOutcome[]>(); // by main's watch id, refreshes whose watch's start is unanswered
    let starting = 0; // watch starts not yet answered
    let generation = 0; // the lease's: each reset opens the next

    const deliver = (update: ConnectorWatchUpdate) => {
      if (closed) return;
      const own = pageIdOf.get(update.watchId);
      const watch = own === undefined ? undefined : watches.get(own);
      if (watch) return watch.listener(update.update);
      if (starting === 0) return;
      const kept = held.get(update.watchId) ?? [];
      if (!held.has(update.watchId)) {
        if (held.size >= CONNECTOR_WATCH_LIMIT) return; // more watches than main runs: none of them is this surface's
        held.set(update.watchId, kept);
      }
      kept.push(update.update);
      if (kept.length > HELD_PER_WATCH) kept.shift(); // its latest; a watch refreshes at most every 30 s
    };
    // A watch now running under `watchId`: its refreshes reach its listener, the held ones first
    const install = (own: string, watch: Watch, watchId: string) => {
      watch.current = watchId;
      pageIdOf.set(watchId, own);
      for (const update of held.get(watchId) ?? []) {
        if (closed || watches.get(own) !== watch) break; // a listener closed the page, or unwatched
        watch.listener(update);
      }
      held.delete(watchId);
    };
    const declare = async (leaseId: string, tools: unknown): Promise<ConnectorDeclareOutcome> => {
      const answer = await call('connectors.declare', { leaseId, tools });
      if (answer.ok) for (const tool of answer.declared) declared.set(JSON.stringify([tool.server, tool.tool]), { server: tool.server, tool: tool.tool });
      return answer;
    };
    const starts = async <T>(work: () => Promise<T>): Promise<T> => {
      starting += 1;
      try {
        return await work();
      } finally {
        starting -= 1;
        if (starting === 0) held.clear();
      }
    };

    // A lease opened for `opened`'s generation; one that answers once a reset or the close overtook it is closed.
    const open = (opened: number): Promise<string | null> =>
      call('connectors.open', { artifactId }).then(
        ({ leaseId }) => {
          if (closed || opened !== generation) {
            void call('connectors.close', { leaseId }).catch(() => {});
            return null;
          }
          unroute = route(leaseId, deliver);
          return leaseId;
        },
        () => null,
      );
    let lease: Promise<string | null> = open(generation);
    // The current lease, once every rebuild begun before it answered has (a reset meanwhile is waited for too)
    const current = async (): Promise<string | null> => {
      for (;;) {
        const pending = lease;
        const leaseId = await pending;
        if (pending === lease) return leaseId;
      }
    };
    // D28: a new lease, asked again what the surface asked of the old one before anything asked meanwhile is sent. A
    // command the host does not answer ends the rebuild where it is; the next reset rebuilds again.
    const rebuild = () => {
      if (closed) return;
      const opened = (generation += 1);
      unroute?.();
      unroute = null;
      pageIdOf.clear();
      for (const watch of watches.values()) watch.current = null;
      const live = () => !closed && opened === generation;
      lease = (async () => {
        const leaseId = await open(opened);
        if (leaseId === null) return null;
        try {
          if (declared.size > 0 && live()) await declare(leaseId, [...declared.values()]);
          if (visible !== null && live()) await call('connectors.visibility', { leaseId, visible });
          for (const [own, watch] of [...watches]) {
            if (!live()) break;
            if (watches.get(own) !== watch) continue; // unwatched meanwhile
            await reinstall(own, watch, leaseId, opened);
          }
        } catch {
          // the host went again: what was rebuilt stands, the next reset rebuilds
        }
        return leaseId;
      })();
    };
    const offRebuild = onReset(rebuild);
    // A watch the page holds, started again on `leaseId` of generation `on`, once whichever path asks first (the rebuild,
    // or the start a reset overtook); not installed when main refuses it (its listener hears nothing until a later
    // rebuild installs it), stopped again when the page unwatched it or the lease ended while it started.
    const reinstall = (own: string, watch: Watch, leaseId: string, on: number) =>
      starts(async () => {
        if (watch.startedOn === on) return;
        watch.startedOn = on;
        const live = () => !closed && on === generation;
        const start = await call('connectors.watch', { leaseId, request: watch.request, ...(watch.dataset && { dataset: watch.dataset }) });
        if (!start.ok) return;
        if (live() && watches.get(own) === watch) install(own, watch, start.watchId);
        else void call('connectors.unwatch', { leaseId, watchId: start.watchId }).catch(() => {});
      });

    // `work` under the lease. Fenced twice by the close: nothing is sent once the surface closed (or when no lease
    // opened: `fallback`), and an answer that arrives after the close is not published (`closedAnswer` instead).
    const under = async <T>(fallback: T, closedAnswer: T, work: (leaseId: string) => Promise<T>): Promise<T> => {
      if (closed) return fallback;
      const leaseId = await current();
      if (leaseId === null || closed) return fallback;
      const answer = await work(leaseId);
      return closed ? closedAnswer : answer;
    };

    return {
      declareTools: (tools) => under(NO_LEASE, NO_LEASE, (leaseId) => declare(leaseId, tools)),
      // E3: the owner's dataset sink rides beside the request, never inside it
      callTool: (request, options) => under<ConnectorCallOutcome>(NO_LEASE, CLOSED, (leaseId) => call('connectors.call', { leaseId, request, ...(options && { dataset: options.dataset }) })),
      watchTool: async (request, listener, options) => {
        if (closed) return NO_LEASE;
        let sentOn = -1; // the lease generation its start went to
        return starts(async () => {
          const start = await under(NO_LEASE, NO_LEASE, (leaseId) => {
            sentOn = generation;
            return call('connectors.watch', { leaseId, request, ...(options && { dataset: options.dataset }) /* E3 */ });
          });
          if (!start.ok) return start; // a close before the answer: `under` answered the lease refusal
          const watch: Watch = { request, dataset: options?.dataset, listener, current: null, startedOn: sentOn };
          watches.set(start.watchId, watch);
          if (sentOn === generation) install(start.watchId, watch, start.watchId);
          else {
            // started on a lease a reset ended meanwhile (the rebuild did not know it): started again on the rebuilt one
            const rebuilt = generation;
            void current()
              .then((leaseId) => (leaseId === null ? undefined : reinstall(start.watchId, watch, leaseId, rebuilt)))
              .catch(() => {});
          }
          // a listener that closed the page while its held refreshes were handed over: no watch was started for it
          return closed ? NO_LEASE : start;
        });
      },
      unwatchTool: (watchId) => {
        const watch = watches.get(watchId);
        watches.delete(watchId);
        if (watch?.current) pageIdOf.delete(watch.current);
        return under(false, false, async (leaseId) => {
          const current = watch ? watch.current : watchId; // an id the surface never started is main's to refuse
          if (current === null) return false; // not running on this lease: nothing to stop
          return (await call('connectors.unwatch', { leaseId, watchId: current })).stopped;
        });
      },
      // E3 panel: the owner's probe rides beside the watch's id; without it, the command H sends
      refreshWatch: (watchId, options) =>
        under(false, false, async (leaseId) => {
          const watch = watches.get(watchId);
          const current = watch ? watch.current : watchId;
          if (current === null) return false;
          return (await call('connectors.refresh', { leaseId, watchId: current, ...(options?.probe !== undefined && { probe: options.probe }) })).refreshing;
        }),
      setVisible: (shown) => {
        if (!closed) visible = shown;
        void under(null, null, (leaseId) => call('connectors.visibility', { leaseId, visible: shown })).catch(() => {});
      },
      // The close's own path, past the fence it raises: the lease is closed in main once it is known (a lease answering
      // after this is closed where it arrives).
      close: () => {
        if (closed) return;
        closed = true;
        offRebuild();
        watches.clear();
        pageIdOf.clear();
        held.clear();
        void current().then((leaseId) => {
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
