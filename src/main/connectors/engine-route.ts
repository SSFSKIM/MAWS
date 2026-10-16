// P3-H H3b: route E, main's half (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log 24, 83 and
// 85). `resolve` finds an eligible live session (./eligibility.ts) from facts already there — the host's artifact row
// and links (`library.entry`), its Space (`spaces.list`), main's index record of the own session and the indexed
// project, the host's live sessions (`engine.sessions`) — and asks the host whether that session's mcp_status has the
// tool (`connectors.resolve`). Nothing here launches, acquires, resumes or marks a session used.
//
// A target's `call` runs through the host's operation commands, since a tool outlives the supervisor's 10 s dispatch:
// the operation is registered here before `connectors.start` is sent (so an end announced before the start's answer
// is not lost), its end arrives as `connectors.operation` (`operationEnded`), and its outcome is fetched with
// `connectors.take`. An abort sends `connectors.cancel`; the host leaving `ready` (`hostLost`) or main stopping answers
// every operation still pending, so nothing waits on a host that will never answer.
import { randomUUID } from 'node:crypto';
import type { ConnectorToolRef } from '@shared/artifacts/connectors';
import type { CommandInput, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { ConnectorRoute, ConnectorRouteAnswer, ConnectorRouteCallContext, ConnectorRouteTarget } from './route';
import { eligibleSessions, ownSessionOf, type EligibleSession } from './eligibility';

type HostCommand = 'library.entry' | 'spaces.list' | 'engine.sessions' | 'connectors.resolve' | 'connectors.start' | 'connectors.take' | 'connectors.cancel';

export interface EngineRouteDeps {
  // the engine host's commands this route sends (main's dispatch, no window's)
  call<N extends HostCommand>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>;
  sessions: { get(appSessionId: string): { projectId: string | null; directory: string } | null }; // main's index
  projects: { list(opts: { includeHidden?: boolean }): readonly { id: string; directory: string }[] }; // main's index
  realpath(path: string): string | null;
  log?: (line: string) => void;
}

export interface EngineRoute extends ConnectorRoute {
  operationEnded(operationId: string): void; // `connectors.operation`
  hostLost(): void; // the engine host left `ready`
  stop(): void;
}

interface Pending {
  settle(answer: ConnectorRouteAnswer): void;
}

const unavailable = (message: string): ConnectorRouteAnswer => ({ ok: false, failure: 'unavailable', message });

export function createEngineRoute(deps: EngineRouteDeps): EngineRoute {
  const log = deps.log ?? ((line: string) => console.warn(`[connectors] ${line}`));
  const pending = new Map<string, Pending>();

  async function host<N extends HostCommand>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> {
    const result = await deps.call(name, input);
    if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
    return result.value;
  }

  async function candidates(artifactId: string): Promise<EligibleSession[]> {
    const { artifact, links } = await host('library.entry', { artifactId });
    if (!artifact) return [];
    const own = ownSessionOf(artifact, links);
    const record = own === null ? null : deps.sessions.get(own);
    const project = artifact.projectId === undefined ? null : (deps.projects.list({ includeHidden: true }).find((entry) => entry.id === artifact.projectId) ?? null);
    const space = artifact.spaceId === undefined ? null : ((await host('spaces.list', undefined)).spaces.find((entry) => entry.id === artifact.spaceId) ?? null);
    const live = await host('engine.sessions', undefined);
    return eligibleSessions({ artifact, links, space, creator: record && { projectId: record.projectId, directory: record.directory }, project, live, realpath: deps.realpath });
  }

  function call(session: EligibleSession, artifactId: string, tool: ConnectorToolRef, args: Record<string, unknown>, context: ConnectorRouteCallContext): Promise<ConnectorRouteAnswer> {
    const operationId = randomUUID();
    const { signal } = context;
    return new Promise<ConnectorRouteAnswer>((resolve) => {
      const cancel = () => {
        if (!pending.delete(operationId)) return;
        signal.removeEventListener('abort', cancel);
        void deps.call('connectors.cancel', { operationId }).catch(() => {});
        resolve(unavailable('cancelled'));
      };
      pending.set(operationId, {
        settle: (answer) => {
          if (!pending.delete(operationId)) return;
          signal.removeEventListener('abort', cancel);
          resolve(answer);
        },
      });
      if (signal.aborted) return cancel();
      signal.addEventListener('abort', cancel, { once: true });
      const start = { operationId, artifactId, appSessionId: session.appSessionId, launchId: session.launchId, cwd: session.cwd, ...tool, arguments: args, fingerprint: context.fingerprint, mode: context.mode };
      void deps.call('connectors.start', start).then(
        (started) => {
          if (started.ok || !pending.has(operationId)) return;
          // the host may still have it (a dispatch that timed out): withdraw it, and answer now
          void deps.call('connectors.cancel', { operationId }).catch(() => {});
          pending.get(operationId)?.settle(unavailable(`connectors.start failed: ${started.error.code} ${started.error.message}`));
        },
        (error: unknown) => pending.get(operationId)?.settle(unavailable(`connectors.start failed: ${error instanceof Error ? error.message : String(error)}`)),
      );
    });
  }

  return {
    route: 'engine',
    async resolve(artifactId, tool, signal): Promise<ConnectorRouteTarget | null> {
      for (const session of await candidates(artifactId)) {
        if (signal.aborted) return null;
        const answer = await host('connectors.resolve', { appSessionId: session.appSessionId, launchId: session.launchId, cwd: session.cwd, ...tool });
        if (!answer.ready) {
          log(`connectors: ${session.appSessionId} cannot run ${tool.server} · ${tool.tool} for ${artifactId} (${answer.why})`);
          continue;
        }
        return { fingerprint: answer.fingerprint, readOnly: answer.readOnly, sessionId: session.appSessionId, call: (args, context) => call(session, artifactId, tool, args, context) };
      }
      return null;
    },
    operationEnded(operationId) {
      const operation = pending.get(operationId);
      if (!operation) return; // cancelled, or another main's
      void deps.call('connectors.take', { operationId }).then(
        (taken) => operation.settle(!taken.ok ? unavailable(`connectors.take failed: ${taken.error.code} ${taken.error.message}`) : (taken.value.outcome ?? { ok: false, failure: 'failed', message: 'the host kept no outcome for the operation' })),
        (error: unknown) => operation.settle(unavailable(`connectors.take failed: ${error instanceof Error ? error.message : String(error)}`)),
      );
    },
    hostLost() {
      for (const operation of [...pending.values()]) operation.settle(unavailable('the engine host is no longer ready'));
    },
    stop() {
      for (const [operationId, operation] of [...pending]) {
        operation.settle(unavailable('main is stopping'));
        void deps.call('connectors.cancel', { operationId }).catch(() => {});
      }
    },
  };
}
