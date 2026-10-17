// P3-HD M2c: route D, main's half (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, M2; P3 co-work Decision Log
// 90 and 95). Route D is MAWS's own MCP connection to a verified server, held by the engine host beside the grant
// store; this is the adapter the broker (./broker.ts) sees, placed after route E (./engine-route.ts), which it never
// touches: the same shape of operation machinery, separate code.
//
// - `resolve` is metadata only. It derives the artifact's canonical directories from facts main already has (the host's
//   artifact row, its Space, main's index record of the creating session and the project; ./eligibility.ts's
//   `artifactDirectories`, the decision route E uses) and asks the host which verified source, if any, names the server
//   there. It lists no engine, acquires no client and starts no connection: that begins only in `call`, which the broker
//   runs after its grant precheck, and the host makes the final grant check at the actual transport write.
// - Every host command answers at once with the operation's id (`resolve` reads a file, `start` and `discover` connect a
//   server). The typed answer is fetched with `directTake` once `connectors.directOperation` (the id alone) announces
//   the end. The operation is registered here before its command is sent, so an end announced before the command's
//   acknowledgment is not lost; events reach main only once its connection streams (X13), so an operation starts only
//   then and a streaming connection reconciles every pending one by `take`; each has a deadline past the host's own,
//   at which main takes or withdraws it.
// - A call is bound to the target main selected: one `directStart` per call, never retried or moved to another route,
//   even when an eligible engine appears meanwhile (the next resolution picks route E). Only fixed words reach the broker
//   and the log: the host's answers are closed enums, and no SDK, server, file or token text exists to leak.
import { randomUUID } from 'node:crypto';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import type { DirectCallOutcome, DirectDiscoverAnswer, DirectOperationOutcome, DirectResolveAnswer, DirectSource } from '@shared/ipc/schema/connectors';
import type { ConnectorToolRef } from '@shared/artifacts/connectors';
import { artifactDirectories, ownSessionOf } from './eligibility';
import type { ConnectorRoute, ConnectorRouteAnswer, ConnectorRouteCallContext, ConnectorRouteTarget } from './route';

type HostCommand = 'library.entry' | 'spaces.list' | 'connectors.directResolve' | 'connectors.directStart' | 'connectors.directDiscover' | 'connectors.directTake' | 'connectors.directCancel' | 'connectors.directClose';

export interface DirectRouteDeps {
  // the engine host's commands this route sends (main's dispatch, no window's)
  call<N extends HostCommand>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>;
  sessions: { get(appSessionId: string): { projectId: string | null; directory: string } | null }; // main's index
  projects: { list(opts: { includeHidden?: boolean }): readonly { id: string; directory: string }[] }; // main's index
  realpath(path: string): string | null;
  streaming(): boolean; // the engine host's events reach main (hosts.streaming)
  log?: (line: string) => void;
}

// The verified source a resolution answered, as the host names it for `directStart` and `directDiscover`.
export type DirectSourceRef = Pick<DirectSource, 'directory' | 'sourceId' | 'generation' | 'server'>;

export interface DirectRoute extends ConnectorRoute {
  // `connectors.directOperation`: an operation ended (the broker is never told: its call answers)
  operationEnded(operationId: string): void;
  reconcile(): void; // the engine host's connection started streaming
  hostLost(): void; // the engine host left `ready`
  stop(): void;
  // Ends every direct operation and connection in the host (`directClose` with no credential named), answering what
  // is pending here first. A global close, not a stop: later resolutions and calls run afresh, so a scoped Disconnect
  // (M3) never needs it. `ok: false`: the host did not confirm (its answer failed or never came); the caller must not
  // treat the host's direct work as ended.
  close(): Promise<{ ok: true; cancelled: number } | { ok: false; why: 'directClose failed' }>;
  // The verified source naming `server` for the artifact (no tool: an owner's Connect starts from it), or why not.
  resolveSource(artifactId: string, server: string, signal: AbortSignal): Promise<{ ok: true; source: DirectSource } | { ok: false; why: Extract<DirectResolveAnswer, { ready: false }>['why'] }>;
  // The owner's discovery of a source's tools: initialize and tools/list, never a tool call.
  discover(source: DirectSourceRef, signal: AbortSignal): Promise<DirectDiscoverAnswer>;
}

// The host's own bounds are 8 s to resolve and 180 s for a call or discovery from its start; main takes or withdraws at
// these, so no lost event leaves a caller waiting.
export const DIRECT_RESOLVE_DEADLINE_MS = 8_000;
export const DIRECT_OPERATION_DEADLINE_MS = 180_000;
// The operations main keeps pending at once (E keeps no bound; the host's own is 256).
export const DIRECT_PENDING_LIMIT = 64;

type Kind = DirectOperationOutcome['kind'];
type OutcomeOf<K extends Kind> = Extract<DirectOperationOutcome, { kind: K }>;
// An operation that ended without a typed answer: main's own fixed words, for its log and the broker.
interface Lost {
  lost: string;
  failure: 'unavailable' | 'failed'; // what the broker is told (an end the host kept no outcome for is `failed`, as for route E)
}
const lost = (lostWord: string, failure: Lost['failure'] = 'unavailable'): Lost => ({ lost: lostWord, failure });

interface Pending {
  readonly kind: Kind;
  settle(result: DirectOperationOutcome | Lost): void;
  taking: boolean; // a `directTake` is in flight
  again?: { whenNone: Lost | null }; // an end or a deadline arrived meanwhile: ask once more
}

function answerOf(outcome: DirectCallOutcome): ConnectorRouteAnswer {
  if (outcome.ok) return { ok: true, result: outcome.result };
  const sourceRefusal = 'sourceRefusal' in outcome && outcome.sourceRefusal !== undefined ? ` (${outcome.sourceRefusal})` : '';
  const message = `direct: ${outcome.reason}${sourceRefusal}`;
  return outcome.failure === 'refused' ? { ok: false, failure: 'refused', refusal: outcome.refusal, message } : { ok: false, failure: outcome.failure, message };
}

export function createDirectRoute(deps: DirectRouteDeps): DirectRoute {
  const log = deps.log ?? ((line: string) => console.warn(`[connectors] ${line}`));
  const pending = new Map<string, Pending>();
  let stopped = false; // main is stopping: terminal, unlike the host leaving ready or a close

  async function host<N extends 'library.entry' | 'spaces.list'>(name: N, input: CommandInput<N>) {
    const result = await deps.call(name, input);
    if (!result.ok) throw new Error(`${name} failed: ${result.error.code}`);
    return result.value;
  }

  // The artifact's canonical directories, in the decision's order (the creator's context, the Space, the project).
  async function directoriesOf(artifactId: string): Promise<string[]> {
    const { artifact, links } = await host('library.entry', { artifactId });
    if (!artifact) return [];
    const own = ownSessionOf(artifact, links);
    const record = own === null ? null : deps.sessions.get(own);
    const project = artifact.projectId === undefined ? null : (deps.projects.list({ includeHidden: true }).find((entry) => entry.id === artifact.projectId) ?? null);
    const space = artifact.spaceId === undefined ? null : ((await host('spaces.list', undefined)).spaces.find((entry) => entry.id === artifact.spaceId) ?? null);
    return [...artifactDirectories({ artifact, links, space, creator: record && { projectId: record.projectId, directory: record.directory }, project, realpath: deps.realpath }).directories];
  }

  // The operation's outcome from the host: settled when there is one; `whenNone` otherwise (null: still running).
  function fetch(operationId: string, whenNone: Lost | null): void {
    const operation = pending.get(operationId);
    if (!operation) return;
    if (operation.taking) {
      operation.again = { whenNone: whenNone ?? operation.again?.whenNone ?? null }; // an in-flight take may have answered before this end
      return;
    }
    operation.taking = true;
    void deps.call('connectors.directTake', { operationId }).then(
      (taken) => {
        operation.taking = false;
        if (!pending.has(operationId)) return;
        if (!taken.ok) return withdraw(operationId, lost(`directTake failed: ${taken.error.code}`)); // the host may still run it
        const { outcome } = taken.value;
        if (outcome !== null) return operation.settle(outcome.kind === operation.kind ? outcome : lost('the host answered another kind of operation'));
        const next = operation.again;
        operation.again = undefined;
        if (next) return fetch(operationId, next.whenNone ?? whenNone);
        if (whenNone !== null) withdraw(operationId, whenNone);
      },
      () => {
        operation.taking = false;
        withdraw(operationId, lost('directTake failed'));
      },
    );
  }

  // Answers the operation now and withdraws it from the host (which may still run it, or never have heard of it).
  function withdraw(operationId: string, result: Lost): void {
    const operation = pending.get(operationId);
    if (!operation) return;
    operation.settle(result);
    void deps.call('connectors.directCancel', { operationId }).catch(() => {});
  }

  // Why no operation may start now, before anything is gathered or sent. Not streaming: its end could not reach main.
  function refusal(signal: AbortSignal): Lost | null {
    if (stopped) return lost('main is stopping');
    if (signal.aborted) return lost('cancelled');
    if (!deps.streaming()) return lost('the engine host is not streaming its events yet');
    return pending.size >= DIRECT_PENDING_LIMIT ? lost('too many direct operations are pending') : null;
  }

  // Registers an operation, then sends its command: `send` receives the operation's id and answers its acknowledgment.
  function run<K extends Kind>(kind: K, send: (operationId: string) => Promise<CommandResult<'connectors.directResolve' | 'connectors.directStart' | 'connectors.directDiscover'>>, deadlineMs: number, signal: AbortSignal): Promise<OutcomeOf<K> | Lost> {
    const refused = refusal(signal);
    if (refused) return Promise.resolve(refused);
    const operationId = randomUUID();
    return new Promise<OutcomeOf<K> | Lost>((resolve) => {
      const deadline = setTimeout(() => fetch(operationId, lost('the operation outlived its deadline')), deadlineMs);
      const cancel = () => withdraw(operationId, lost('cancelled'));
      pending.set(operationId, {
        kind,
        taking: false,
        settle: (result) => {
          if (!pending.delete(operationId)) return;
          clearTimeout(deadline);
          signal.removeEventListener('abort', cancel);
          resolve(result as OutcomeOf<K> | Lost);
        },
      });
      signal.addEventListener('abort', cancel, { once: true });
      void send(operationId).then(
        (started) => {
          // the host may still have it (a dispatch that timed out): withdraw it, and answer now
          if (!started.ok) withdraw(operationId, lost(`the host refused the operation: ${started.error.code}`));
        },
        () => withdraw(operationId, lost('the host could not be asked')),
      );
    });
  }

  async function resolveAnswer(artifactId: string, server: string, tool: string | undefined, signal: AbortSignal): Promise<DirectResolveAnswer | Lost> {
    const refused = refusal(signal);
    if (refused) return refused;
    const directories = (await directoriesOf(artifactId)).slice(0, 16);
    if (directories.length === 0) return { ready: false, why: 'unobserved' };
    const result = await run('resolve', (operationId) => deps.call('connectors.directResolve', { operationId, artifactId, directories, server, ...(tool === undefined ? {} : { tool }) }), DIRECT_RESOLVE_DEADLINE_MS, signal);
    return 'lost' in result ? result : result.answer;
  }

  function targetOf(source: DirectSource, tool: ConnectorToolRef, artifactId: string, fingerprint: string, readOnly: boolean): ConnectorRouteTarget {
    return {
      fingerprint,
      readOnly, // an agreeing engine report's annotation; the host's live tools/list decides again at the call
      call: async (args: Record<string, unknown>, context: ConnectorRouteCallContext): Promise<ConnectorRouteAnswer> => {
        const sent = { artifactId, directory: source.directory, sourceId: source.sourceId, generation: source.generation, server: source.server, tool: tool.tool, arguments: args, fingerprint: context.fingerprint, mode: context.mode };
        const result = await run('call', (operationId) => deps.call('connectors.directStart', { operationId, ...sent }), DIRECT_OPERATION_DEADLINE_MS, context.signal);
        return 'lost' in result ? { ok: false, failure: result.failure, message: result.lost } : answerOf(result.outcome);
      },
    };
  }

  function stopAll(word: string): void {
    for (const operationId of [...pending.keys()]) withdraw(operationId, lost(word));
  }

  return {
    route: 'direct',
    async resolve(artifactId, tool, signal): Promise<ConnectorRouteTarget | null> {
      const answer = await resolveAnswer(artifactId, tool.server, tool.tool, signal);
      const named = `${tool.server} · ${tool.tool} for ${artifactId}`;
      if ('lost' in answer) {
        log(`connectors: no direct resolution of ${named} (${answer.lost})`);
        return null;
      }
      if (!answer.ready) {
        log(`connectors: ${named} has no verified direct source (${answer.why})`);
        return null;
      }
      if (!answer.tool) {
        log(`connectors: no engine report listed ${named}; direct waits for the owner’s discovery`);
        return null;
      }
      return targetOf(answer.source, tool, artifactId, answer.tool.fingerprint, answer.tool.readOnly);
    },
    async resolveSource(artifactId, server, signal) {
      const answer = await resolveAnswer(artifactId, server, undefined, signal);
      if ('lost' in answer) return { ok: false, why: 'unavailable' };
      return answer.ready ? { ok: true, source: answer.source } : { ok: false, why: answer.why };
    },
    async discover(source, signal) {
      const { directory, sourceId, generation, server } = source;
      const result = await run('discover', (operationId) => deps.call('connectors.directDiscover', { operationId, directory, sourceId, generation, server }), DIRECT_OPERATION_DEADLINE_MS, signal);
      return 'lost' in result ? { ok: false, failure: 'unavailable', reason: 'connection' } : result.answer;
    },
    // an end announced: its outcome, or (taken already, expired) a failure
    operationEnded(operationId) {
      fetch(operationId, lost('the host kept no outcome for the operation', 'failed'));
    },
    // streaming again: an end announced before then was dropped, so each pending operation's outcome is asked for; one
    // still running announces its end now that events flow
    reconcile() {
      for (const operationId of [...pending.keys()]) fetch(operationId, null);
    },
    hostLost() {
      stopAll('the engine host is no longer ready');
    },
    stop() {
      stopped = true;
      stopAll('main is stopping');
    },
    async close() {
      stopAll('direct work was closed');
      const closed = await deps.call('connectors.directClose', {}).catch(() => null);
      return closed?.ok ? { ok: true, cancelled: closed.value.cancelled } : { ok: false, why: 'directClose failed' };
    },
  };
}
