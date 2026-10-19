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
// `publishable` recheck in the same turn, and a work that may no longer publish is withdrawn, never taken. E3 M2 fix
// (the architect's explicit phases): the host answers its phase beside H's outcome (`ConnectorDatasetTake`):
// `publishing` keeps the operation pending for the publication's own end, which is answered once, typed (its metadata
// and every failure but a revoke in the result's slot, a revoke as the route's own refusal); no null is ever read as
// a phase. A dataset operation's takes run one at a time, every fetch asked meanwhile coalesced into one more. E3 M2
// residual (the architect's terminal-ownership ruling): a dataset operation is never settled blindly. Its deadline,
// its work's abort and a failed recheck send the host's `connectors.cancel`: a cancel that won (before the commit's
// admission) is answered as nothing published, the host's retained end collected; one answered false (the commit
// admitted, or its end decided) is followed by takes, without the recheck, until the host's durable end, its rollback
// included, answers it. P3-F F-connectors 5: a cancel the host never answered (its dispatch failed) proves neither, so
// nothing is settled and nothing taken (a take could start the publication); the cancel is asked again on the
// operation's next end or reconciliation, or after DATASET_RETRY_MS, until the host answers it. Its sibling: a take the
// host never answered may have started or joined the publication, so it settles nothing either and is asked again the
// same way. `resolveSession` is an agent's: the asking session alone, never another eligible one.
import { randomUUID } from 'node:crypto';
import { CONNECTOR_OPERATION_DEADLINE_MS, type ConnectorToolRef } from '@shared/artifacts/connectors'; // E3: the deadline
import type { CommandInput, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { ConnectorDatasetTake } from '@shared/ipc/schema/connectors'; // E3
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
  taking?: boolean; // E3: a take of it is out
  again?: DatasetFetch; // E3: the fetch asked while it was, the most final of them
  stopping?: boolean; // E3 M2 residual: its host cancel sent: only the host's end settles it now
  unconfirmed?: ConnectorRouteAnswer; // P3-F F-connectors 5: its cancel went unanswered: asked again before anything is taken
  retry?: ReturnType<typeof setTimeout>; // P3-F F-connectors 5: an unanswered cancel's or take's next ask, should no end come first
}

// E3: why a dataset operation's outcome is fetched, least final first: reconciliation (still calling is fine), its end
// announced (none held is a lost outcome).
const DATASET_FETCHES = ['reconcile', 'ended'] as const;
type DatasetFetch = (typeof DATASET_FETCHES)[number];
const finalOf = (a: DatasetFetch | undefined, b: DatasetFetch): DatasetFetch => (a !== undefined && DATASET_FETCHES.indexOf(a) > DATASET_FETCHES.indexOf(b) ? a : b);
const LOST: ConnectorRouteAnswer = { ok: false, failure: 'failed', message: 'the host kept no outcome for the operation' };
const DEADLINE: ConnectorRouteAnswer = { ok: false, failure: 'unavailable', message: 'the operation outlived its deadline' };
// P3-F F-connectors 5: how long after an unanswered cancel or take main asks it again, when no end of the operation came
// first.
export const DATASET_RETRY_MS = 1_000;

// E3: a dataset publication's end as the route answers it: a revoke as the route's own refusal; the metadata and every
// other failure in the result's slot, typed (the descriptor the host wrote, or kept, is what is drawn).
function datasetAnswer(take: Exclude<ConnectorDatasetTake, { status: 'publishing' }>): ConnectorRouteAnswer {
  if (take.status === 'failed' && take.reason === 'revoked') return { ok: false, failure: 'refused', refusal: 'revoked', message: 'the grant was revoked before the publication' };
  return { ok: true, result: take };
}

// Past the host's own bound on an operation (two mcp_status reads of 8 s, the store, mcp_call's 120 s long deadline):
// main then takes the outcome, or withdraws an operation the host still runs or has forgotten.
export { CONNECTOR_OPERATION_DEADLINE_MS }; // E3: the one shared budget, now in @shared/artifacts/connectors

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
  function fetch(operationId: string, whenNone: ConnectorRouteAnswer | null): void {
    if (!pending.has(operationId)) return;
    void deps.call('connectors.take', { operationId }).then(
      (taken) => {
        const operation = pending.get(operationId);
        if (!operation) return;
        if (!taken.ok) return operation.settle(unavailable(`connectors.take failed: ${taken.error.code} ${taken.error.message}`));
        if (taken.value.outcome !== null) return operation.settle(taken.value.outcome);
        if (whenNone !== null) withdraw(operationId, whenNone);
      },
      (error: unknown) => pending.get(operationId)?.settle(unavailable(`connectors.take failed: ${error instanceof Error ? error.message : String(error)}`)),
    );
  }

  // E3: a dataset operation's outcome or phase from the host, one take at a time. The recheck and the take's dispatch
  // in one turn, while a take may still start the publication (once stopping, a take only collects the host's end); a
  // fetch asked while a take is out runs once after it, as the most final of those asked.
  function fetchDataset(operationId: string, why: DatasetFetch): void {
    const asked = pending.get(operationId);
    if (!asked) return;
    if (asked.unconfirmed) return stopDataset(operationId, asked.unconfirmed); // P3-F F-connectors 5: no take before the cancel's answer
    if (asked.taking) {
      asked.again = finalOf(asked.again, why);
      return;
    }
    if (!asked.stopping && !asked.publishable!()) return stopDataset(operationId, unavailable('the work may no longer publish'));
    asked.taking = true;
    clearTimeout(asked.retry); // a take asked now is the one a failed take's retry would ask
    // P3-F F-connectors 5 sibling: unanswered, the take may have started or joined the publication: the operation stays,
    // and the take (the most final asked meanwhile) is asked again
    const unanswered = () => {
      if (pending.get(operationId) !== asked) return;
      asked.taking = false;
      const again = finalOf(asked.again, why);
      delete asked.again;
      clearTimeout(asked.retry);
      asked.retry = setTimeout(() => fetchDataset(operationId, again), DATASET_RETRY_MS);
    };
    void deps.call('connectors.take', { operationId }).then(
      (taken) => {
        const operation = pending.get(operationId);
        if (!operation) return;
        if (!taken.ok) return unanswered();
        operation.taking = false;
        const { outcome, dataset } = taken.value;
        if (outcome !== null) return operation.settle(outcome); // ended before its call: H's outcome
        if (dataset && dataset.status !== 'publishing') return operation.settle(datasetAnswer(dataset));
        // publishing, or (no phase) still calling: an end announced with neither is lost
        if (!dataset && why === 'ended') return withdraw(operationId, LOST);
        const again = operation.again;
        delete operation.again;
        if (again !== undefined) fetchDataset(operationId, again);
      },
      unanswered,
    );
  }

  // E3 M2 residual: a dataset operation stopped through the host. A cancel that won ends it as `answer` (nothing was
  // published; the host's kept end is collected); one answered false leaves it to the host's end, taken next.
  function stopDataset(operationId: string, answer: ConnectorRouteAnswer): void {
    const operation = pending.get(operationId);
    if (!operation || operation.stopping) return;
    operation.stopping = true;
    delete operation.unconfirmed;
    clearTimeout(operation.retry);
    // P3-F F-connectors 5: unanswered, the cancel may or may not have won: the operation stays, to be asked again
    const unanswered = () => {
      if (pending.get(operationId) !== operation) return;
      operation.stopping = false;
      operation.unconfirmed = answer;
      operation.retry = setTimeout(() => stopDataset(operationId, answer), DATASET_RETRY_MS);
    };
    void deps.call('connectors.cancel', { operationId }).then((cancelled) => {
      if (pending.get(operationId) !== operation) return;
      if (!cancelled.ok) return unanswered();
      if (!cancelled.value.cancelled) return fetchDataset(operationId, 'ended');
      void deps.call('connectors.take', { operationId }).catch(() => {});
      operation.settle(answer);
    }, unanswered);
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
      const deadline = setTimeout(() => (context.dataset ? stopDataset(operationId, DEADLINE) : fetch(operationId, DEADLINE)), CONNECTOR_OPERATION_DEADLINE_MS);
      const cancel = () => (context.dataset ? stopDataset(operationId, unavailable('cancelled')) : withdraw(operationId, unavailable('cancelled')));
      const operation: Pending = {
        settle: (answer) => {
          if (!pending.delete(operationId)) return;
          clearTimeout(deadline);
          clearTimeout(operation.retry); // P3-F F-connectors 5
          signal.removeEventListener('abort', cancel);
          resolve(answer);
        },
        // E3: a dataset operation is rechecked before every take (a sink without a recheck is never publishable)
        ...(context.dataset && { publishable: context.publishable ?? (() => false) }),
      };
      pending.set(operationId, operation);
      if (signal.aborted) return withdraw(operationId, unavailable('cancelled')); // nothing started yet
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
      if (pending.get(operationId)?.publishable) return fetchDataset(operationId, 'ended'); // E3
      fetch(operationId, LOST);
    },
    // streaming again: an end announced before then was dropped, so each pending operation's outcome is asked for; one
    // still running announces its end now that events flow
    reconcile() {
      for (const [operationId, operation] of [...pending]) {
        if (operation.publishable) fetchDataset(operationId, 'reconcile'); // E3
        else fetch(operationId, null);
      }
    },
    hostLost() {
      for (const operationId of [...pending.keys()]) withdraw(operationId, unavailable('the engine host is no longer ready'));
    },
    stop() {
      for (const operationId of [...pending.keys()]) withdraw(operationId, unavailable('main is stopping'));
    },
  };
}
