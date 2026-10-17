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
// every operation still pending (and withdraws it), so nothing waits on a host that will never answer.
//
// The host's events reach main only from its streaming `ready` line on (X13: a host emits nothing to a client before
// it, and drops what it would have); a dispatch can be answered earlier, during the connection's resync. So an
// operation starts only while the connection streams; when a connection starts streaming every operation still pending
// is reconciled by `take` (an end announced before then is not lost); and each operation has a deadline past the
// host's own bounds, at which main takes or withdraws it, so no lost event ever leaves a call waiting.
//
// E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): a call with a dataset sink starts with it, and its
// result stays in the host. Each take of it (on its end, on reconciliation, at its deadline) follows the context's
// `publishable` recheck in the same turn, and a work that may no longer publish is withdrawn, never taken. The host's
// first take after the call ended starts the publication and answers null, so the operation stays pending for the
// publication's own end; one more null after that end is a lost outcome. The deadline covers the route, the call and
// the publication together. `resolveSession` is an agent's: the asking session alone, never another eligible one.
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
  streaming(): boolean; // the engine host's events reach main (hosts.streaming)
  log?: (line: string) => void;
}

export interface EngineRoute extends ConnectorRoute {
  // E3: the asking session's own target for `tool`, when its live engine has the server; null otherwise.
  resolveSession(appSessionId: string, artifactId: string, tool: ConnectorToolRef, signal: AbortSignal): Promise<ConnectorRouteTarget | null>;
  operationEnded(operationId: string): void; // `connectors.operation`
  reconcile(): void; // the engine host's connection started streaming
  hostLost(): void; // the engine host left `ready`
  stop(): void;
}

interface Pending {
  settle(answer: ConnectorRouteAnswer): void;
  publishable?: () => boolean; // E3: a dataset operation's recheck, asked before each of its takes
  publishing?: boolean; // E3: the host answered a take of its ended call null: its publication runs
}

// Past the host's own bound on an operation (two mcp_status reads of 8 s, the store, mcp_call's 120 s long deadline):
// main then takes the outcome, or withdraws an operation the host still runs or has forgotten.
export const CONNECTOR_OPERATION_DEADLINE_MS = 180_000;

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

  // The operation's outcome from the host: settled when there is one; `whenNone` otherwise (null: still running).
  // E3: `ended`, the take follows the operation's announced end: a dataset operation's first null there is its
  // publication starting, not a lost outcome.
  function fetch(operationId: string, whenNone: ConnectorRouteAnswer | null, ended = false): void {
    const asked = pending.get(operationId);
    if (!asked) return;
    // E3: the recheck and the take's dispatch in one turn
    if (asked.publishable && !asked.publishable()) return withdraw(operationId, unavailable('the work may no longer publish'));
    void deps.call('connectors.take', { operationId }).then(
      (taken) => {
        const operation = pending.get(operationId);
        if (!operation) return;
        if (!taken.ok) return operation.settle(unavailable(`connectors.take failed: ${taken.error.code} ${taken.error.message}`));
        if (taken.value.outcome !== null) return operation.settle(taken.value.outcome);
        if (ended && operation.publishable && !operation.publishing) {
          operation.publishing = true; // E3: its end comes again with the outcome
          return;
        }
        if (whenNone !== null) withdraw(operationId, whenNone);
      },
      (error: unknown) => pending.get(operationId)?.settle(unavailable(`connectors.take failed: ${error instanceof Error ? error.message : String(error)}`)),
    );
  }

  // Answers the operation now and withdraws it from the host (which may still run it, or never have heard of it).
  function withdraw(operationId: string, answer: ConnectorRouteAnswer): void {
    const operation = pending.get(operationId);
    if (!operation) return;
    operation.settle(answer);
    void deps.call('connectors.cancel', { operationId }).catch(() => {});
  }

  function call(session: Pick<EligibleSession, 'appSessionId' | 'launchId' | 'cwd'>, artifactId: string, tool: ConnectorToolRef, args: Record<string, unknown>, context: ConnectorRouteCallContext): Promise<ConnectorRouteAnswer> {
    // its end could not reach main yet: refused before anything is started
    if (!deps.streaming()) return Promise.resolve(unavailable('the engine host is not streaming its events yet'));
    const operationId = randomUUID();
    const { signal } = context;
    return new Promise<ConnectorRouteAnswer>((resolve) => {
      const deadline = setTimeout(() => fetch(operationId, unavailable('the operation outlived its deadline')), CONNECTOR_OPERATION_DEADLINE_MS);
      const cancel = () => withdraw(operationId, unavailable('cancelled'));
      pending.set(operationId, {
        settle: (answer) => {
          if (!pending.delete(operationId)) return;
          clearTimeout(deadline);
          signal.removeEventListener('abort', cancel);
          resolve(answer);
        },
        // E3: a dataset operation is rechecked before every take (a sink without a recheck is never publishable)
        ...(context.dataset && { publishable: context.publishable ?? (() => false) }),
      });
      if (signal.aborted) return cancel();
      signal.addEventListener('abort', cancel, { once: true });
      const start = { operationId, artifactId, appSessionId: session.appSessionId, launchId: session.launchId, cwd: session.cwd, ...tool, arguments: args, fingerprint: context.fingerprint, mode: context.mode, ...(context.dataset && { dataset: context.dataset }) /* E3 */ };
      void deps.call('connectors.start', start).then(
        (started) => {
          // the host may still have it (a dispatch that timed out): withdraw it, and answer now
          if (!started.ok) withdraw(operationId, unavailable(`connectors.start failed: ${started.error.code} ${started.error.message}`));
        },
        (error: unknown) => withdraw(operationId, unavailable(`connectors.start failed: ${error instanceof Error ? error.message : String(error)}`)),
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
    // E3: an agent's refresh runs only in its own session's engine
    async resolveSession(appSessionId, artifactId, tool, signal): Promise<ConnectorRouteTarget | null> {
      const session = (await host('engine.sessions', undefined)).find((entry) => entry.appSessionId === appSessionId && entry.process === 'ready');
      if (!session || signal.aborted) return null;
      const live = { appSessionId, launchId: session.launchId, cwd: session.cwd };
      const answer = await host('connectors.resolve', { ...live, ...tool });
      if (!answer.ready) {
        log(`connectors: ${appSessionId} cannot run ${tool.server} · ${tool.tool} for its refresh of ${artifactId} (${answer.why})`);
        return null;
      }
      return { fingerprint: answer.fingerprint, readOnly: answer.readOnly, sessionId: appSessionId, call: (args, context) => call(live, artifactId, tool, args, context) };
    },
    // an end announced: its outcome, or (taken already, expired) a failure
    operationEnded(operationId) {
      fetch(operationId, { ok: false, failure: 'failed', message: 'the host kept no outcome for the operation' }, true);
    },
    // streaming again: an end announced before then was dropped, so each pending operation's outcome is asked for; one
    // still running announces its end now that events flow
    reconcile() {
      for (const operationId of [...pending.keys()]) fetch(operationId, null);
    },
    hostLost() {
      for (const operationId of [...pending.keys()]) withdraw(operationId, unavailable('the engine host is no longer ready'));
    },
    stop() {
      for (const operationId of [...pending.keys()]) withdraw(operationId, unavailable('main is stopping'));
    },
  };
}
