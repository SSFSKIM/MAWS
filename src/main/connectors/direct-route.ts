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
//   at which main takes or withdraws it. P3-F F-connectors 5: a dataset operation's cancel the host never answered
//   proves neither outcome, so it settles nothing and nothing is taken; the cancel is asked again on the operation's
//   next end or reconciliation, or after DIRECT_RETRY_MS, until the host answers it. Its sibling: a dataset take the
//   host never answered may have started the publication, so it settles nothing either and is asked again the same way.
// - A call is bound to the target main selected: one `directStart` per call, never retried or moved to another route,
//   even when an eligible engine appears meanwhile (the next resolution picks route E). Only fixed words reach the broker
//   and the log: the host's answers are closed enums, and no SDK, server, file or token text exists to leak.
// - P3-HD M3b (Decision Log 18, 19, 21 and 22): a resolution may answer a grant-backed candidate (no tool metadata, the
//   existing grant matching), which reaches the broker as `readOnly: false` with `grantBacked`. An HTTP source's
//   credential is prepared, when a preparer is supplied, only inside the selected target's call (after the broker's
//   check) or the owner's discovery, within the operation's registered and bounded lifetime: its cancellation, its
//   deadline, the host's loss, a close and stop each settle it at once and abort the preparation, and a late answer
//   sends nothing. Resolution never prepares one. An `unauthorized` answer is reported with exactly the credential sent.
//   P3-F F-connectors 6: the broker's door preceded the preparation's awaits, so the call asks main's admission again
//   (`admit`, the native window re-read) in the same turn as its start.
import { randomUUID } from 'node:crypto';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import type { DirectCallOutcome, DirectCredential, DirectDiscoverAnswer, DirectOperationOutcome, DirectResolveAnswer, DirectSource, DirectToolMetadata } from '@shared/ipc/schema/connectors';
import type { ConnectorToolRef } from '@shared/artifacts/connectors';
import { artifactDirectories, ownSessionOf } from './eligibility';
import type { ConnectorRoute, ConnectorRouteAnswer, ConnectorRouteCallContext, ConnectorRouteTarget } from './route';

type HostCommand = 'library.entry' | 'spaces.list' | 'connectors.directResolve' | 'connectors.directStart' | 'connectors.directDiscover' | 'connectors.directTake' | 'connectors.directCancel' | 'connectors.directClose' | 'connectors.directLocate' | 'connectors.directSend'; // P4-B5: locate, send

export interface DirectRouteDeps {
  // the engine host's commands this route sends (main's dispatch, no window's)
  call<N extends HostCommand>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>;
  sessions: { get(appSessionId: string): { projectId: string | null; directory: string } | null }; // main's index
  projects: { list(opts: { includeHidden?: boolean }): readonly { id: string; directory: string }[] }; // main's index
  realpath(path: string): string | null;
  streaming(): boolean; // the engine host's events reach main (hosts.streaming)
  log?: (line: string) => void;
  // P3-HD M3b: an HTTP source's credential for a call or discovery (M3c's provider); absent, none is ever sent.
  credentials?: DirectCredentialPreparation;
}

// P3-HD M3b start: the credential preparation seam (Decision Log 19 and 21).
export type DirectCredentialPurpose = 'call' | 'discover';
export type DirectCredentialUse = Pick<DirectCredential, 'connectionId' | 'credentialEpoch'>;
// `credential: null`: send none (no owned grant: open HTTP, or the entry's own literal header); `ok: false`: no usable
// credential (withdrawn, or reconnection needed), so the operation is unavailable and nothing is sent.
export type DirectCredentialPrepared = { ok: true; credential: DirectCredential | null } | { ok: false };
export interface DirectCredentialPreparation {
  // For the complete source the operation runs on, after the broker's check (a call) or for the owner's gesture (a
  // discovery). `signal` aborts the moment the operation ends here; whatever is answered after that is dropped unsent.
  prepare(request: { source: DirectSource; purpose: DirectCredentialPurpose; signal: AbortSignal }): Promise<DirectCredentialPrepared>;
  // The host answered `unauthorized` for an operation prepared here, sent with `credential` (null: sent with none).
  unauthorized(report: { source: DirectSource; purpose: DirectCredentialPurpose; credential: DirectCredentialUse | null }): void;
}
// P3-HD M3b end

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
  // P3-HD M3b (Decision Log 22): with `tool`, the source the host's ranking selects for that tool (the one its existing
  // grant matches first), with the tool's metadata: the same selection a call makes, for an owner action bound to it.
  resolveSource(artifactId: string, server: string, signal: AbortSignal, tool?: string): Promise<{ ok: true; source: DirectSource; tool?: DirectToolMetadata } | { ok: false; why: Extract<DirectResolveAnswer, { ready: false }>['why'] }>;
  // The owner's discovery of a source's tools: initialize and tools/list, never a tool call. P3-HD M3b: the complete
  // source, for its credential's preparation; only its private reference crosses to the host.
  discover(source: DirectSource, signal: AbortSignal): Promise<DirectDiscoverAnswer>;
  // P4-B5 start: the owner's delivery (the host's `directLocate` and `directSend`). `locate`: the verified sources that
  // can take `tool` (null: the host gave no answer). `send`: `tool` run once on `source` for the owner's gesture, no
  // grant; an HTTP source's credential prepared inside the operation, as a call's.
  locate(tool: string, urlHosts: readonly string[], signal: AbortSignal): Promise<DirectSource[] | null>;
  send(source: DirectSource, request: { artifactId: string; tool: string; arguments: Record<string, unknown> }, signal: AbortSignal): Promise<DirectSendAnswer>;
  // P4-B5 end
}

// P4-B5: a delivery's answer, the host's typed outcome, or `lost` (main's own words: it ended with no typed answer).
// `sent`: its command reached the host's dispatch (false: ended before, so nothing was written); `credential: false`:
// its HTTP credential could not be prepared (no usable MAWS sign-in).
export type DirectSendAnswer = DirectCallOutcome | { ok: false; failure: 'unavailable' | 'failed'; reason: 'lost'; message: string; sent: boolean; credential?: false };
const NO_CREDENTIAL = 'no credential could be prepared'; // P4-B5: the lost word a send's answer names as `credential: false`

// The host's own bounds are 8 s to resolve and 180 s for a call or discovery from its start; main takes or withdraws at
// these, so no lost event leaves a caller waiting.
export const DIRECT_RESOLVE_DEADLINE_MS = 8_000;
export const DIRECT_OPERATION_DEADLINE_MS = 180_000;
// The operations main keeps pending at once (E keeps no bound; the host's own is 256).
export const DIRECT_PENDING_LIMIT = 64;
// P3-F F-connectors 5: how long after an unanswered dataset cancel or take main asks it again, when no end came first.
export const DIRECT_RETRY_MS = 1_000;

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
  publishable?: () => boolean; // E3c: native visibility/request recheck before every publication take
  stopping?: boolean;
  unconfirmed?: Lost; // P3-F F-connectors 5: its cancel went unanswered: asked again before anything is taken
  retry?: ReturnType<typeof setTimeout>; // P3-F F-connectors 5: an unanswered cancel's or take's next ask, should no end come first
  settle(result: DirectOperationOutcome | Lost): void;
  sent: boolean; // P3-HD M3b: its command was sent (until then, preparing its credential: the host knows nothing of it)
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
    if (!operation.sent) {
      if (whenNone !== null) withdraw(operationId, whenNone); // P3-HD M3b: nothing in the host to take
      return;
    }
    if (operation.unconfirmed) return stopDataset(operationId, operation.unconfirmed); // P3-F F-connectors 5: no take before the cancel's answer
    if (operation.taking) {
      operation.again = { whenNone: whenNone ?? operation.again?.whenNone ?? null }; // an in-flight take may have answered before this end
      return;
    }
    if (operation.publishable && !operation.stopping && !operation.publishable()) return stopDataset(operationId, lost('the work may no longer publish'));
    operation.taking = true;
    clearTimeout(operation.retry); // a take asked now is the one a failed take's retry would ask
    // P3-F F-connectors 5 sibling: unanswered, a dataset take may have started the publication: the operation stays, and
    // the take is asked again; any other operation is withdrawn, as the host may still run it
    const unanswered = (word: string) => {
      operation.taking = false;
      if (pending.get(operationId) !== operation) return;
      if (!operation.publishable) return withdraw(operationId, lost(word));
      const next = operation.again;
      operation.again = undefined;
      clearTimeout(operation.retry);
      operation.retry = setTimeout(() => fetch(operationId, next?.whenNone ?? whenNone), DIRECT_RETRY_MS);
    };
    void deps.call('connectors.directTake', { operationId }).then(
      (taken) => {
        operation.taking = false;
        if (!pending.has(operationId)) return;
        if (!taken.ok) return unanswered(`directTake failed: ${taken.error.code}`);
        const { outcome, dataset } = taken.value;
        if (dataset && operation.publishable) {
          if (dataset.status !== 'publishing') return operation.settle({ kind: 'call', outcome: dataset.status === 'failed' && dataset.reason === 'revoked' ? { ok: false, failure: 'refused', refusal: 'revoked', reason: 'grant' } : { ok: true, result: dataset } });
          const next = operation.again;
          operation.again = undefined;
          if (next) fetch(operationId, next.whenNone);
          return;
        }
        if (outcome !== null) return operation.settle(outcome.kind === operation.kind ? outcome : lost('the host answered another kind of operation'));
        const next = operation.again;
        operation.again = undefined;
        if (next) return fetch(operationId, next.whenNone ?? whenNone);
        if (whenNone !== null) withdraw(operationId, whenNone);
      },
      () => unanswered('directTake failed'),
    );
  }

  // E3c: cancellation before admission wins; after admission only the durable host end may settle the call.
  function stopDataset(operationId: string, result: Lost): void {
    const operation = pending.get(operationId);
    if (!operation || operation.stopping) return;
    if (!operation.sent) return withdraw(operationId, result);
    operation.stopping = true;
    operation.unconfirmed = undefined;
    clearTimeout(operation.retry);
    // P3-F F-connectors 5: unanswered, the cancel may or may not have won: the operation stays, to be asked again
    const unanswered = () => {
      if (pending.get(operationId) !== operation) return;
      operation.stopping = false;
      operation.unconfirmed = result;
      operation.retry = setTimeout(() => stopDataset(operationId, result), DIRECT_RETRY_MS);
    };
    void deps.call('connectors.directCancel', { operationId }).then((answer) => {
      if (pending.get(operationId) !== operation) return;
      if (!answer.ok) return unanswered();
      if (!answer.value.cancelled) return fetch(operationId, lost('the host kept no outcome for the operation', 'failed'));
      void deps.call('connectors.directTake', { operationId }).catch(() => {});
      operation.settle(result);
    }, unanswered);
  }

  // Answers the operation now and withdraws it from the host (which may still run it, or never have heard of it).
  function withdraw(operationId: string, result: Lost): void {
    const operation = pending.get(operationId);
    if (!operation) return;
    operation.settle(result);
    if (operation.sent) void deps.call('connectors.directCancel', { operationId }).catch(() => {}); // P3-HD M3b
  }

  // Why no operation may start now, before anything is gathered or sent. Not streaming: its end could not reach main.
  function refusal(signal: AbortSignal): Lost | null {
    if (stopped) return lost('main is stopping');
    if (signal.aborted) return lost('cancelled');
    if (!deps.streaming()) return lost('the engine host is not streaming its events yet');
    return pending.size >= DIRECT_PENDING_LIMIT ? lost('too many direct operations are pending') : null;
  }

  // Registers an operation, then sends its command: `send` receives the operation's id (and, P3-HD M3b, the credential
  // `prepare` answered, inside the operation's lifetime) and answers its acknowledgment.
  function run<K extends Kind>(
    kind: K,
    send: (operationId: string, credential: DirectCredential | null) => Promise<CommandResult<'connectors.directResolve' | 'connectors.directStart' | 'connectors.directDiscover' | 'connectors.directLocate' | 'connectors.directSend'>>, // P4-B5: locate, send
    deadlineMs: number,
    signal: AbortSignal,
    prepare?: (signal: AbortSignal) => Promise<DirectCredentialPrepared>,
    context?: ConnectorRouteCallContext, // E3c
  ): Promise<{ result: OutcomeOf<K> | Lost; credential: DirectCredential | null; sent: boolean }> {
    const refused = refusal(signal);
    if (refused) return Promise.resolve({ result: refused, credential: null, sent: false });
    const operationId = randomUUID();
    let credential: DirectCredential | null = null;
    return new Promise((resolve) => {
      const preparation = new AbortController();
      const deadline = setTimeout(() => context?.dataset ? stopDataset(operationId, lost('the operation outlived its deadline')) : fetch(operationId, lost('the operation outlived its deadline')), deadlineMs);
      const cancel = () => context?.dataset ? stopDataset(operationId, lost('cancelled')) : withdraw(operationId, lost('cancelled'));
      const operation: Pending = {
        kind,
        ...(context?.dataset && { publishable: context.publishable ?? (() => false) }),
        taking: false,
        sent: false,
        settle: (result) => {
          if (!pending.delete(operationId)) return;
          clearTimeout(deadline);
          clearTimeout(operation.retry); // P3-F F-connectors 5
          signal.removeEventListener('abort', cancel);
          preparation.abort(); // P3-HD M3b: a preparation still running is told; its answer is dropped
          resolve({ result: result as OutcomeOf<K> | Lost, credential, sent: operation.sent }); // P4-B5: sent
        },
      };
      pending.set(operationId, operation);
      signal.addEventListener('abort', cancel, { once: true });
      void (async () => {
        if (prepare) {
          let prepared: DirectCredentialPrepared;
          try {
            prepared = await prepare(preparation.signal);
          } catch {
            prepared = { ok: false };
          }
          if (pending.get(operationId) !== operation) return; // it ended meanwhile: nothing is sent
          if (!prepared.ok) return withdraw(operationId, lost(NO_CREDENTIAL));
          if (!deps.streaming()) return withdraw(operationId, lost('the engine host is not streaming its events yet'));
          credential = prepared.credential;
        }
        // P3-F F-connectors 6: main's admission again, in the same turn as the send (a window that hid unannounced while
        // the credential was prepared aborts the call here, before anything, an Allow once included, is used)
        if (context?.admit && !context.admit()) return withdraw(operationId, lost('cancelled'));
        operation.sent = true;
        let started;
        try {
          started = await send(operationId, credential);
        } catch {
          return withdraw(operationId, lost('the host could not be asked'));
        }
        // the host may still have it (a dispatch that timed out): withdraw it, and answer now
        if (!started.ok) withdraw(operationId, lost(`the host refused the operation: ${started.error.code}`));
      })();
    });
  }

  // P3-HD M3b: the preparation of `source`'s credential when a preparer is supplied and the source is HTTP (a credential
  // is bound to the verified resource; a stdio server has none), else none.
  function preparationOf(source: DirectSource, purpose: DirectCredentialPurpose): ((signal: AbortSignal) => Promise<DirectCredentialPrepared>) | undefined {
    const { credentials } = deps;
    if (!credentials || source.transport !== 'http') return undefined;
    return (signal) => credentials.prepare({ source, purpose, signal });
  }

  // P3-HD M3b: the credential the host refused, exactly as sent (never the token), to the preparer that prepared it.
  function unauthorized(source: DirectSource, purpose: DirectCredentialPurpose, credential: DirectCredential | null): void {
    const used = credential && { connectionId: credential.connectionId, credentialEpoch: credential.credentialEpoch };
    try {
      deps.credentials?.unauthorized({ source, purpose, credential: used });
    } catch {
      log(`connectors: the credential preparer failed to take an unauthorized report for ${source.server}`);
    }
  }

  async function resolveAnswer(artifactId: string, server: string, tool: string | undefined, signal: AbortSignal): Promise<DirectResolveAnswer | Lost> {
    const refused = refusal(signal);
    if (refused) return refused;
    const directories = (await directoriesOf(artifactId)).slice(0, 16);
    if (directories.length === 0) return { ready: false, why: 'unobserved' };
    const { result } = await run('resolve', (operationId) => deps.call('connectors.directResolve', { operationId, artifactId, directories, server, ...(tool === undefined ? {} : { tool }) }), DIRECT_RESOLVE_DEADLINE_MS, signal);
    return 'lost' in result ? result : result.answer;
  }

  function targetOf(source: DirectSource, tool: ConnectorToolRef, artifactId: string, metadata: DirectToolMetadata): ConnectorRouteTarget {
    const call = async (args: Record<string, unknown>, context: ConnectorRouteCallContext): Promise<ConnectorRouteAnswer> => {
      const sent = { artifactId, directory: source.directory, sourceId: source.sourceId, generation: source.generation, server: source.server, tool: tool.tool, arguments: args, fingerprint: context.fingerprint, mode: context.mode, ...(context.dataset && { dataset: context.dataset, ...(context.appSessionId && { appSessionId: context.appSessionId }) }) };
      const prepare = preparationOf(source, 'call'); // P3-HD M3b: after the broker's check, inside the operation
      const { result, credential } = await run('call', (operationId, prepared) => deps.call('connectors.directStart', { operationId, ...sent, ...(prepared && { credential: prepared }) }), DIRECT_OPERATION_DEADLINE_MS, context.signal, prepare, context);
      if ('lost' in result) return { ok: false, failure: result.failure, message: result.lost };
      if (prepare && !result.outcome.ok && result.outcome.reason === 'unauthorized') unauthorized(source, 'call', credential);
      return answerOf(result.outcome);
    };
    // an agreeing engine report's annotation (with the host's live hints); the host's live tools/list decides again at
    // the call. P3-HD M3b: grant-backed, none is known, and none is claimed.
    return 'grantBacked' in metadata ? { fingerprint: metadata.fingerprint, readOnly: false, grantBacked: true, call } : { fingerprint: metadata.fingerprint, readOnly: metadata.readOnly, call };
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
      return targetOf(answer.source, tool, artifactId, answer.tool);
    },
    async resolveSource(artifactId, server, signal, tool) {
      const answer = await resolveAnswer(artifactId, server, tool, signal);
      if ('lost' in answer) return { ok: false, why: 'unavailable' };
      if (!answer.ready) return { ok: false, why: answer.why };
      return { ok: true, source: answer.source, ...(answer.tool && { tool: answer.tool }) };
    },
    async discover(source, signal) {
      const { directory, sourceId, generation, server } = source;
      const prepare = preparationOf(source, 'discover'); // P3-HD M3b
      const { result, credential } = await run('discover', (operationId, prepared) => deps.call('connectors.directDiscover', { operationId, directory, sourceId, generation, server, ...(prepared && { credential: prepared }) }), DIRECT_OPERATION_DEADLINE_MS, signal, prepare);
      if ('lost' in result) return { ok: false, failure: 'unavailable', reason: 'connection' };
      if (prepare && !result.answer.ok && result.answer.reason === 'unauthorized') unauthorized(source, 'discover', credential);
      return result.answer;
    },
    // P4-B5 start
    async locate(tool, urlHosts, signal) {
      const { result } = await run('locate', (operationId) => deps.call('connectors.directLocate', { operationId, tool, urlHosts: [...urlHosts] }), DIRECT_RESOLVE_DEADLINE_MS, signal);
      if ('lost' in result) {
        log(`connectors: no direct location of ${tool} (${result.lost})`);
        return null;
      }
      return result.answer.sources;
    },
    async send(source, { artifactId, tool, arguments: args }, signal) {
      const { directory, sourceId, generation, server } = source;
      const prepare = preparationOf(source, 'call');
      const { result, credential, sent } = await run('call', (operationId, prepared) => deps.call('connectors.directSend', { operationId, artifactId, directory, sourceId, generation, server, tool, arguments: args, ...(prepared && { credential: prepared }) }), DIRECT_OPERATION_DEADLINE_MS, signal, prepare);
      if ('lost' in result) return { ok: false, failure: result.failure, reason: 'lost', message: result.lost, sent, ...(result.lost === NO_CREDENTIAL && { credential: false as const }) };
      if (prepare && !result.outcome.ok && result.outcome.reason === 'unauthorized') unauthorized(source, 'call', credential);
      return result.outcome;
    },
    // P4-B5 end
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
