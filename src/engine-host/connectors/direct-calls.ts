// P3-HD M2: route D's host half, the direct operation table (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md,
// "Actual-write authority" and M2; P3 co-work Decision Log 91 and 98; this child's Decision Log 5 and 10). Main's
// direct route resolves a verified source, checks the owner's grant without consuming it, and then asks the host to run
// the call; the host holds the artifact store, the once-consumption and the last check, synchronous with the actual
// transport write of MAWS's own MCP connection (./direct-client.ts). Separate from route E's table (./calls.ts) by
// design: the same start/take/cancel contract and retention, its own boundary.
//
// - Every command answers at once. `resolve` (a file read, bounded at 8 s), `discover` (the owner's initialize and
//   tools/list, never tools/call) and `start` (one tool call, bounded at 180 s) are operations: their end is announced
//   by id alone (`completed`) a macrotask after the answer, their typed outcome kept for one `take` for 60 s. Outcomes
//   carry closed reasons, never an SDK's, server's or file's text. At most `DIRECT_OPERATIONS_MAX` are held.
// - A call, in order: the source re-resolved and its id, generation and fingerprint exact-matched; its entry re-read
//   (with the cache's synchronous `stillValid`); the store's fence taken (before anything can consume an Allow once) and
//   a non-consuming grant check; the connection acquired (initialize); a live tools/list showing the tool, read-only for
//   a read grant and (panel correction) not requiring task execution; only then the Allow once consumed; then the call, its `admit` checking synchronously at the actual
//   stdin write or fetch: not cancelled or timed out, the fence held, the source still valid, the credential's epoch
//   not withdrawn, the same attachment. Every async step is followed by the same check. An unavailable server never
//   burns an unused once grant. Nothing is retried, and nothing switches route: an engine appearing meanwhile does not
//   touch an admitted call (the next one selects route E, main's rule).
// - Decision Log 91, as route E: the fence is held past the call until the operation is taken, cancelled, expired or
//   dropped with main; a revoke, delete or replacing grant while the outcome waits turns it into the revoke's refusal.
// - `withdraw` (main's `connectors.directClose`) sets an epoch floor for a credential's connection before it answers:
//   a dataset publication admitted into the store keeps its terminal ownership until taken or expired; other
//   operations end unannounced. Its connections close, and a later start at or below the floor is refused.
// - `close` (main gone): every operation and outcome goes synchronously, the credential floors with the attachment, and
//   every connection is invalidated (its processes' end follows within the pool's bound); `shutdown` also awaits that.
// - P3-HD M3b (Decision Log 15, 18 and 21): a resolution naming a tool ranks main's directories by the artifact's
//   existing grant, checked afresh and consuming nothing: the first candidate with known tool metadata the grant
//   matches, else the first with none known that it matches (`grantBacked`: no readOnly is invented), else the first
//   with known metadata (a new grant's); a check that cannot be made (no store, or one failing) makes the whole
//   resolution unavailable, never a ranking without it. Known metadata is an agreeing engine report's annotation combined with the
//   host-only hints (./direct-hints.ts) that the owner's discovery and every call's successful live listing publish in
//   their synchronous post-list validity step; credential withdrawal and main's going forget them. At the call, a read
//   grant whose live tool may write is the private `changed`, the durable grant untouched.
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { ConnectorAuthorization, ConnectorCallRef, ConnectorGrantMode } from '@shared/artifacts/connectors';
import type { CommandInput } from '@shared/ipc/schema';
import { DIRECT_LOCATE_MAX, type ConnectorDatasetTake, type DirectCallOutcome, type DirectDiscoverAnswer, type DirectLocateAnswer, type DirectOperationOutcome, type DirectReason, type DirectResolveAnswer, type DirectSource } from '@shared/ipc/schema/connectors'; // P4-B5: locate
import { ARTIFACT_MAX_BYTES } from '@shared/maws/tools';
import { ArtifactStoreError, StoreTooNewError } from '../documents/errors';
import type { DirectConnectionPool, DirectFailure, DirectLease, DirectTool } from './direct-client';
import type { ConnectorDatasetSink } from './dataset-sink';
import type { RefreshRaw, RefreshPublish, RefreshPublication } from '../dashboards/refresh';
import { DirectToolHints } from './direct-hints'; // P3-HD M3b
import type { ConnectorSourceRefusal, ConnectorStatusCache, VerifiedConnectorSource } from './provenance';
import type { ConfiguredDeliverySources } from './configured-delivery';

export const DIRECT_CALL_DEADLINE_MS = 180_000; // a discovery's too: connect, initialize, tools/list
export const DIRECT_RESOLVE_BOUND_MS = 8_000;
export const DIRECT_RESULT_TTL_MS = 60_000;
export const DIRECT_OPERATIONS_MAX = 256; // running and untaken together

export type DirectResolveInput = CommandInput<'connectors.directResolve'>;
export type DirectStartInput = CommandInput<'connectors.directStart'>;
export type DirectDiscoverInput = CommandInput<'connectors.directDiscover'>;
export type DirectLocateInput = CommandInput<'connectors.directLocate'>; // P4-B5
export type DirectSendInput = CommandInput<'connectors.directSend'>; // P4-B5
// P4-B5: the candidates one location verifies at most (each a config file read), whatever the cache holds
export const DIRECT_LOCATE_VERIFY_MAX = 32;
type Credential = NonNullable<DirectStartInput['credential']>;

// The store's grant authority as a direct call uses it (an ArtifactStore is one): route E's (./calls.ts) and the
// non-consuming check, declared here so route D's table depends on neither E's file nor the store's.
export interface DirectGrantStore {
  connectorFence(artifactId: string, call: ConnectorCallRef, mode: ConnectorGrantMode, onBreak?: () => void): DirectFence;
  releaseConnectorFence(fence: DirectFence): void;
  connectorFenceHolds(fence: DirectFence, call: ConnectorCallRef, mode: ConnectorGrantMode): 'held' | 'revoked' | 'fingerprintChanged' | 'wrongMode';
  checkConnectorCall(artifactId: string, call: ConnectorCallRef): Promise<ConnectorAuthorization>;
  authorizeConnectorCall(artifactId: string, call: ConnectorCallRef, expected?: ConnectorGrantMode): Promise<ConnectorAuthorization>;
  // P4-B5: the owner's delivery's fence, broken by the artifact's deletion alone
  deliveryFence(artifactId: string, onBreak?: () => void): DirectFence;
  deliveryFenceHolds(fence: DirectFence): boolean;
}
type DirectFence = object; // the store's own (documents/store.ts ConnectorFence), opaque here

export interface DirectCallsOptions {
  datasets?: ConnectorDatasetSink; // E3c: the shared host-only refresh sink
  cache: Pick<ConnectorStatusCache, 'resolve' | 'resolveSource' | 'readEntryForWrite'> & Partial<Pick<ConnectorStatusCache, 'candidates'>>; // P4-B5: candidates
  // WR 76/78: separate authority for owner delivery/discovery only; never consulted by page resolve/start.
  deliverySources?: ConfiguredDeliverySources;
  pool: Pick<DirectConnectionPool, 'acquire' | 'invalidate' | 'close'>;
  store(): DirectGrantStore | null;
  completed(operationId: string): void; // `connectors.directOperation`, the id alone
  resultTtlMs?: number;
  callDeadlineMs?: number;
  resolveBoundMs?: number;
  maxOperations?: number;
  maxResultBytes?: number;
  clock?: DirectClock; // tests: the deadlines' and retention's time
}

// The time the table's deadlines and retention keep (the end's announcement is always the next macrotask's).
export interface DirectClock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
const realClock: DirectClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => {
    const timer = setTimeout(run, ms);
    timer.unref?.();
    return timer;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type Kind = DirectOperationOutcome['kind'];
interface Operation {
  readonly id: string;
  readonly kind: Kind;
  readonly controller: AbortController;
  readonly credential?: Credential;
  readonly deadlineAt: number;
  readonly admittedAt: number; // P3-HD M3b: its hint publication's order
  outcome?: DirectOperationOutcome;
  sink?: true; // E3c: dataset terminal ownership follows route E
  dataset?: DatasetPhase;
  publicationAdmitted?: true; // the savepoint owns its end, including rollback; retained until take or expiry
  cancelled?: true;
  stop?: 'timeout'; // why its signal aborted, when it was not withdrawn
  revoked?: boolean; // its fence broke: a revoke, delete or replacing grant asked for while it ran or its outcome waited
  deadline?: unknown;
  expiry?: unknown;
  release?: () => void; // lets go of its fence (Decision Log 91: with the operation, not the call)
}

type DatasetEnd = Exclude<ConnectorDatasetTake, { status: 'publishing' }>;
type DatasetPhase = { publish?: () => Promise<DatasetEnd | Failure>; publishing?: boolean; take?: DatasetEnd };
type DatasetExecution = { publish: () => Promise<DatasetEnd | Failure> } | { take: DatasetEnd };

type Failure = Exclude<DirectCallOutcome, { ok: true }>;
const unavailable = (reason: DirectReason, sourceRefusal?: ConnectorSourceRefusal): Failure => ({ ok: false, failure: 'unavailable', reason, ...(sourceRefusal && { sourceRefusal }) });
const failed = (reason: DirectReason): Failure => ({ ok: false, failure: 'failed', reason });
const refused = (refusal: 'notGranted' | 'fingerprintChanged' | 'wrongMode' | 'revoked', reason: DirectReason): Failure => ({ ok: false, failure: 'refused', refusal, reason });
const REVOKED = refused('revoked', 'grant');

// A transport failure as an outcome. `phase`: what a plain failure there means (the connection's, or the call's own).
function fromTransport(failure: DirectFailure, phase: 'connection' | 'transport'): Failure {
  switch (failure.failure) {
    case 'unauthorized':
      return unavailable('unauthorized');
    case 'timeout':
      return unavailable('timeout');
    case 'cancelled':
      return unavailable('cancelled');
    case 'tooLarge':
      return { ok: false, failure: 'tooLarge', reason: 'tooLarge' };
    case 'unavailable':
      return unavailable('connection');
    default: // `failed`, and `refused` without a refusal of ours recorded (never expected)
      return phase === 'connection' ? unavailable('connection') : failed('transport');
  }
}

export class DirectCalls {
  private readonly operations = new Map<string, Operation>();
  private readonly floors = new Map<string, number>(); // a credential's withdrawn epochs: every one at or below
  private readonly epochs = new Map<string, number>(); // the highest epoch seen of each credential
  private attachment = 0;
  private readonly hints = new DirectToolHints(); // P3-HD M3b
  private readonly ttlMs: number;
  private readonly callDeadlineMs: number;
  private readonly resolveBoundMs: number;
  private readonly maxOperations: number;
  private readonly maxResultBytes: number;
  private readonly clock: DirectClock;

  constructor(private readonly options: DirectCallsOptions) {
    this.ttlMs = options.resultTtlMs ?? DIRECT_RESULT_TTL_MS;
    this.callDeadlineMs = options.callDeadlineMs ?? DIRECT_CALL_DEADLINE_MS;
    this.resolveBoundMs = options.resolveBoundMs ?? DIRECT_RESOLVE_BOUND_MS;
    this.maxOperations = options.maxOperations ?? DIRECT_OPERATIONS_MAX;
    this.maxResultBytes = options.maxResultBytes ?? ARTIFACT_MAX_BYTES;
    this.clock = options.clock ?? realClock;
  }

  resolve(input: DirectResolveInput): { operationId: string } {
    const operation = this.admit(input.operationId, 'resolve', this.resolveBoundMs, { ready: false, why: 'unavailable' });
    this.run(operation, () => this.resolved(operation, input), { ready: false, why: 'unavailable' });
    return { operationId: operation.id };
  }

  start(input: DirectStartInput): { operationId: string } {
    const operation = this.admit(input.operationId, 'call', this.callDeadlineMs, unavailable('timeout'), input.credential);
    if (input.dataset) operation.sink = true;
    void this.call(operation, input).then(
      (answer) => {
        if ('ok' in answer) this.finish(operation, answer);
        else this.keep(operation, answer);
      },
      () => this.finish(operation, failed('transport')),
    );
    return { operationId: operation.id };
  }

  discover(input: DirectDiscoverInput): { operationId: string } {
    const operation = this.admit(input.operationId, 'discover', this.callDeadlineMs, unavailable('timeout'), input.credential);
    this.run(operation, () => this.discovered(operation, input), failed('transport'));
    return { operationId: operation.id };
  }

  // P4-B5 start: the owner's delivery (the schema's P4-B5 block). `locate` answers the verified sources that can take
  // `tool`, bounded like a resolution; `send` runs the tool once for the owner's gesture with no grant, as a call's
  // operation (its outcome a call's), its write admitted by its own synchronous check (`sent`).
  locate(input: DirectLocateInput): { operationId: string } {
    const operation = this.admit(input.operationId, 'locate', this.resolveBoundMs, { sources: [] } satisfies DirectLocateAnswer);
    this.run(operation, () => this.located(operation, input), { sources: [] } satisfies DirectLocateAnswer);
    return { operationId: operation.id };
  }

  send(input: DirectSendInput): { operationId: string } {
    const operation = this.admit(input.operationId, 'call', this.callDeadlineMs, unavailable('timeout'), input.credential);
    this.run(operation, () => this.sent(operation, input), failed('transport'));
    return { operationId: operation.id };
  }
  // P4-B5 end

  // The ended operation's outcome, once; null for one unknown, still running, already taken, cancelled or expired.
  take(operationId: string): DirectOperationOutcome | null {
    const operation = this.operations.get(operationId);
    if (!operation?.outcome) return null;
    this.drop(operation);
    return operation.outcome;
  }

  // E3c: first take starts the publication; joining takes see the phase, never the raw result.
  takeOperation(operationId: string): { outcome: DirectOperationOutcome | null; dataset?: ConnectorDatasetTake } {
    const operation = this.operations.get(operationId);
    const phase = operation?.outcome === undefined ? operation?.dataset : undefined;
    if (!operation || !phase) return { outcome: this.take(operationId) };
    if (phase.take) {
      this.drop(operation);
      return { outcome: null, dataset: phase.take };
    }
    if (!phase.publishing) {
      phase.publishing = true;
      this.clock.clearTimeout(operation.expiry);
      void phase.publish!().then((end) => {
        if ('ok' in end) return this.finish(operation, end);
        if (this.operations.get(operation.id) !== operation || operation.cancelled) return;
        phase.take = end;
        this.announce(operation);
      }, () => {
        this.finish(operation, failed('store'));
      });
    }
    return { outcome: null, dataset: { status: 'publishing', operationId } };
  }

  // Main withdrew it: it stops, before its write or (once written) with the SDK's cancellation, and is never announced.
  cancel(operationId: string): boolean {
    const operation = this.operations.get(operationId);
    if (!operation) return false;
    if (operation.sink && operation.outcome === undefined) {
      if (operation.publicationAdmitted || operation.dataset?.take) return false;
      operation.cancelled = true;
      operation.controller.abort();
      this.clock.clearTimeout(operation.deadline);
      operation.dataset = { take: { status: 'failed', reason: 'timeout' } };
      this.clock.clearTimeout(operation.expiry);
      operation.expiry = this.clock.setTimeout(() => this.drop(operation), this.ttlMs);
      return true;
    }
    this.end(operation);
    return true;
  }

  // `connectors.directClose`. With `connectionId`: its epoch `credentialEpoch` (absent: every epoch seen) and every
  // earlier one withdrawn for good; otherwise all direct work. Synchronous: when this returns, no connection under a
  // withdrawn credential admits another write; their processes end after. Admitted dataset publications keep their
  // end until taken or expired; other withdrawn operations end unannounced.
  withdraw(connectionId?: string, credentialEpoch?: number): number {
    if (connectionId === undefined) {
      for (const [id, seen] of this.epochs) this.floors.set(id, Math.max(this.floors.get(id) ?? -1, seen));
      this.hints.clear(); // P3-HD M3b
      let ended = 0;
      for (const operation of [...this.operations.values()]) {
        if (operation.publicationAdmitted) continue;
        this.end(operation);
        ended += 1;
      }
      void this.options.pool.invalidate(() => true);
      return ended;
    }
    const floor = Math.max(this.floors.get(connectionId) ?? -1, credentialEpoch ?? this.epochs.get(connectionId) ?? -1);
    this.floors.set(connectionId, floor);
    this.hints.withdraw(connectionId, floor); // P3-HD M3b
    let ended = 0;
    for (const operation of [...this.operations.values()]) {
      if (operation.credential?.connectionId !== connectionId || operation.credential.credentialEpoch > floor || operation.publicationAdmitted) continue;
      this.end(operation);
      ended += 1;
    }
    void this.options.pool.invalidate((key) => key.connectionId === connectionId && (key.credentialEpoch ?? -1) <= floor);
    return ended;
  }

  // Main is gone: every operation and outcome goes now, with the credential floors (the next attachment's main numbers
  // its own); every connection is invalidated, and the returned promise is their processes' end.
  close(): Promise<void> {
    this.attachment += 1;
    this.options.deliverySources?.clear(); // WR 76/78: configured source selectors belong to this attachment too
    this.hints.clear(); // P3-HD M3b
    this.endAll();
    this.floors.clear();
    this.epochs.clear();
    return this.options.pool.invalidate(() => true);
  }

  // The host shuts down: as `close`, the pool closed for good, resolved once every owned process is gone.
  shutdown(): Promise<void> {
    void this.close();
    return this.options.pool.close();
  }

  // ── the table ──

  private admit(operationId: string, kind: Kind, boundMs: number, late: unknown, credential?: Credential): Operation {
    if (this.operations.has(operationId)) throw new Error(`direct operation ${operationId} is already known`);
    if (this.operations.size >= this.maxOperations) throw new HostCommandError(ipcError('internal', 'the engine host holds as many direct operations as it may'));
    if (credential) this.epochs.set(credential.connectionId, Math.max(this.epochs.get(credential.connectionId) ?? -1, credential.credentialEpoch));
    const operation: Operation = { id: operationId, kind, controller: new AbortController(), deadlineAt: this.clock.now() + boundMs, admittedAt: this.hints.admit(), ...(credential && { credential }) };
    this.operations.set(operation.id, operation);
    // its bound ends it with its late answer even while a step it awaits never settles
    operation.deadline = this.clock.setTimeout(() => {
      operation.stop = 'timeout';
      operation.controller.abort();
      this.finish(operation, late);
    }, boundMs);
    return operation;
  }

  private run(operation: Operation, body: () => Promise<unknown>, crashed: unknown): void {
    void body().then(
      (answer) => this.finish(operation, answer),
      () => this.finish(operation, crashed), // never a message: the host's own fault, said as a closed reason
    );
  }

  private finish(operation: Operation, answer: unknown): void {
    if (this.operations.get(operation.id) !== operation || operation.outcome || operation.cancelled) return; // withdrawn, or already ended
    this.clock.clearTimeout(operation.deadline);
    delete operation.dataset;
    // a break between the answer's arrival and here (its callback found no outcome to replace) is the revoke's refusal
    operation.outcome = operation.revoked && operation.kind === 'call' ? { kind: 'call', outcome: REVOKED } : this.outcomeOf(operation.kind, answer);
    this.announce(operation);
  }

  private announce(operation: Operation): void {
    this.clock.clearTimeout(operation.expiry);
    operation.expiry = this.clock.setTimeout(() => this.drop(operation), this.ttlMs);
    // a macrotask later, so the end never overtakes the start's answer on the wire (route E's rule)
    setTimeout(() => {
      if (this.operations.get(operation.id) === operation) this.options.completed(operation.id);
    }, 0);
  }

  private keep(operation: Operation, execution: DatasetExecution): void {
    if (this.operations.get(operation.id) !== operation || operation.cancelled || operation.outcome) return;
    if (operation.revoked) return this.finish(operation, REVOKED);
    if (operation.controller.signal.aborted) return this.finish(operation, this.stopped(operation));
    this.clock.clearTimeout(operation.deadline);
    operation.dataset = 'take' in execution ? { take: execution.take } : { publish: execution.publish };
    this.announce(operation);
  }

  private outcomeOf(kind: Kind, answer: unknown): DirectOperationOutcome {
    if (kind === 'resolve') return { kind, answer: answer as DirectResolveAnswer };
    if (kind === 'discover') return { kind, answer: answer as DirectDiscoverAnswer };
    if (kind === 'locate') return { kind, answer: answer as DirectLocateAnswer }; // P4-B5
    return { kind, outcome: answer as DirectCallOutcome };
  }

  private end(operation: Operation): void {
    this.drop(operation);
    operation.controller.abort();
  }

  private endAll(): number {
    const all = [...this.operations.values()];
    for (const operation of all) this.end(operation);
    return all.length;
  }

  private drop(operation: Operation): void {
    this.clock.clearTimeout(operation.deadline);
    this.clock.clearTimeout(operation.expiry);
    if (this.operations.get(operation.id) === operation) this.operations.delete(operation.id);
    operation.release?.();
    operation.release = undefined;
  }

  private registered(operation: Operation): boolean {
    return this.operations.get(operation.id) === operation && !operation.outcome && !operation.controller.signal.aborted;
  }

  private credentialValid(credential: Credential | undefined): boolean {
    return credential === undefined || credential.credentialEpoch > (this.floors.get(credential.connectionId) ?? -1);
  }

  // why a stopped operation stopped
  private stopped(operation: Operation): Failure {
    return operation.revoked ? REVOKED : unavailable(operation.stop ?? 'cancelled');
  }

  // ── the operations ──

  private async resolved(operation: Operation, input: DirectResolveInput): Promise<DirectResolveAnswer> {
    const { cache } = this.options;
    const { tool } = input;
    let first: Extract<DirectResolveAnswer, { ready: false }>['why'] | null = null;
    const refusedWith = (why: Extract<DirectResolveAnswer, { ready: false }>['why']) => {
      if (first === null && why !== 'unobserved') first = why;
    };
    // Main's candidates in its order, as route E takes the first ready session. Within one directory the cache admits
    // no precedence at all; across them, the grant's fingerprint (main's check, then the host's at the call) keeps
    // another directory's server from passing as the one granted.
    if (tool === undefined) {
      for (const directory of input.directories) {
        const answer = await cache.resolveSource(directory, input.server);
        if (!this.registered(operation)) return { ready: false, why: 'unavailable' };
        if (answer.ok) return { ready: true, source: publicSource(answer.source) };
        refusedWith(answer.why);
      }
      return { ready: false, why: first ?? 'unobserved' };
    }
    // P3-HD M3b: ranked by the artifact's existing grant (above)
    let known: Extract<DirectResolveAnswer, { ready: true }> | null = null;
    let grantBacked: Extract<DirectResolveAnswer, { ready: true }> | null = null;
    for (const directory of input.directories) {
      const answer = await cache.resolve(directory, input.server, tool);
      if (!this.registered(operation)) return { ready: false, why: 'unavailable' };
      if (!answer.ok) {
        refusedWith(answer.why);
        continue;
      }
      // P3-HD panel correction: a tool the live listing says requires task execution is unusable here
      if (this.hints.taskRequired(answer.source, tool)) {
        refusedWith('taskRequired');
        continue;
      }
      const { fingerprint } = answer.tool;
      const readOnly = combined(answer.tool.readOnly, this.hints.readOnly(answer.source, tool));
      if (readOnly === null && grantBacked !== null) continue; // a later grant-backed candidate ranks no higher
      const matches = await this.grantMatches(input.artifactId, { server: input.server, tool, fingerprint });
      // a check that could not be made says nothing of the grant: no candidate stands on it (M3b review fix)
      if (matches === null || !this.registered(operation)) return { ready: false, why: 'unavailable' };
      const source = publicSource(answer.source);
      if (readOnly !== null) {
        const candidate = { ready: true as const, source, tool: { fingerprint, readOnly } };
        if (matches) return candidate;
        known ??= candidate;
      } else if (matches) grantBacked = { ready: true, source, tool: { fingerprint, grantBacked: true } };
      else refusedWith('toolMissing');
    }
    return grantBacked ?? known ?? { ready: false, why: first ?? 'unobserved' };
  }

  // Whether the artifact's existing grant admits `call` now, consuming nothing; null when it cannot be told (no store
  // this run, or a check that failed), which is not a grant's absence.
  private async grantMatches(artifactId: string, call: ConnectorCallRef): Promise<boolean | null> {
    const store = this.options.store();
    if (!store) return null;
    try {
      return (await store.checkConnectorCall(artifactId, call)).granted;
    } catch {
      return null;
    }
  }

  private async call(operation: Operation, input: DirectStartInput): Promise<DirectCallOutcome | DatasetExecution> {
    const { cache, pool } = this.options;
    const { signal } = operation.controller;
    const attachment = this.attachment;
    const store = this.options.store();
    if (!store) return failed('store');
    let sink: { publish: RefreshPublish } | null = null;
    if (input.dataset) {
      if (input.mode !== 'read') return refused('wrongMode', 'grant');
      if (!this.options.datasets) return failed('store');
      const admission = await this.options.datasets.admit({ ...input, dataset: input.dataset }, () => {
        if (this.operations.get(operation.id) !== operation) return;
        operation.controller.abort();
        if (operation.dataset?.publish && !operation.dataset.publishing) this.finish(operation, unavailable('cancelled'));
      });
      if ('refusal' in admission) return admission.stale ? { take: { status: 'failed', reason: 'stale' } } : failed('store');
      if (!this.registered(operation)) return this.stopped(operation);
      sink = admission;
    }
    if (!this.credentialValid(input.credential)) return unavailable('credential');
    // the source main resolved, exactly: never another found now
    const resolved = await cache.resolve(input.directory, input.server, input.tool);
    if (!this.registered(operation)) return this.stopped(operation);
    if (!resolved.ok) return unavailable('source', resolved.why);
    if (!sameSource(resolved.source, input)) return unavailable('source', 'changed');
    if (resolved.tool.fingerprint !== input.fingerprint) return refused('fingerprintChanged', 'source');
    const read = await cache.readEntryForWrite(resolved.source);
    if (!this.registered(operation)) return this.stopped(operation);
    if (!read.ok) return unavailable('source', read.why);

    const call = { server: input.server, tool: input.tool, fingerprint: input.fingerprint };
    // Taken before anything can consume an Allow once, and in the same synchronous step that found the operation
    // registered, so its `drop` (take, cancel, expiry, withdrawal, main's going) is what lets go of it.
    const fence = store.connectorFence(input.artifactId, call, input.mode, () => {
      operation.revoked = true;
      operation.controller.abort();
      if (operation.outcome?.kind === 'call') operation.outcome = { kind: 'call', outcome: REVOKED };
      else if (operation.dataset?.publish && !operation.dataset.publishing && this.operations.get(operation.id) === operation) {
        operation.dataset = { take: { status: 'failed', reason: 'revoked' } };
        this.announce(operation);
      }
    });
    operation.release = () => store.releaseConnectorFence(fence);
    const connection = this.connectionCheck(read.stillValid, input.credential, attachment);
    // synchronous: null when everything that admits the write still does
    const check = (): Failure | null => {
      if (!this.registered(operation)) return this.stopped(operation);
      const held = store.connectorFenceHolds(fence, call, input.mode);
      return held !== 'held' ? refused(held, 'grant') : connection();
    };
    const pre = await this.grantOf(() => store.checkConnectorCall(input.artifactId, call));
    if ('ok' in pre) return pre;
    if (!pre.granted) return refused(pre.refusal, 'grant');
    if (pre.mode !== input.mode) return refused('wrongMode', 'grant');
    const ready = check();
    if (ready) return ready;

    const acquired = await pool.acquire({ source: read.source, entry: read.entry, ...(input.credential && { credential: credentialOf(input.credential) }), fence: () => connection() === null }, signal);
    if (!acquired.ok) return check() ?? fromTransport(acquired, 'connection');
    const { lease } = acquired;
    try {
      const answer = await this.callOn(lease, operation, input, read.source, store, call, check);
      if (!sink) return answer;
      let raw: RefreshRaw;
      if (answer.ok) raw = { kind: 'result', result: answer.result };
      else if (answer.failure === 'tooLarge') raw = { kind: 'failed', reason: 'tooLarge' };
      else if (answer.failure === 'failed' && (answer.reason === 'transport' || answer.reason === 'notJson')) raw = { kind: 'failed', reason: 'toolError' };
      else if (answer.reason === 'timeout' && !signal.aborted) raw = { kind: 'failed', reason: 'timeout' };
      else return answer;
      const publishing = sink;
      return { publish: async () => {
        const publication = await publishing.publish(raw, () => {
          const failure = check();
          return failure === null ? 'held' : failure.failure === 'refused' ? 'revoked' : 'cancelled';
        }, () => (operation.publicationAdmitted = true));
        return takeOf(publication);
      } };
    } finally {
      lease.release();
    }
  }

  private async callOn(lease: DirectLease, operation: Operation, input: DirectStartInput, source: VerifiedConnectorSource, store: DirectGrantStore, call: ConnectorCallRef, check: () => Failure | null): Promise<DirectCallOutcome> {
    const { signal } = operation.controller;
    const connected = check();
    if (connected) return connected;
    const listed = await lease.listTools(signal);
    const afterList = check();
    if (afterList) return afterList;
    if (!listed.ok) return fromTransport(listed, 'connection');
    this.publish(operation, source, listed.tools); // P3-HD M3b: in the same synchronous step as the check above
    const tool = listed.tools.find((entry) => entry.name === input.tool);
    if (!tool) return unavailable('toolMissing');
    // P3-HD panel correction: the SDK refuses a task-required tool before tools/call; said before an Allow once is spent
    if (tool.taskRequired) return unavailable('taskRequired');
    // P3-HD M3b (Decision Log 18): the live metadata no longer admits the grant's use; the grant is the owner's to review
    if (input.mode === 'read' && !tool.readOnly) return unavailable('changed');
    // now, and only now, the durable use of an Allow once
    const authorization = await this.grantOf(() => store.authorizeConnectorCall(input.artifactId, call, input.mode));
    if ('ok' in authorization) return authorization;
    if (!authorization.granted) return refused(authorization.refusal, 'grant');
    const authorized = check();
    if (authorized) return authorized;
    let refusedAtWrite: Failure | null = null;
    const answer = await lease.callTool(
      { name: input.tool, arguments: input.arguments },
      {
        // the last check, synchronous with the actual stdin write or fetch
        admit: () => (refusedAtWrite = check()) === null,
        signal,
        timeoutMs: Math.max(1, operation.deadlineAt - this.clock.now()),
      },
    );
    // a refusal at the write is ours (the connection's own fence included); a failure after it says what stopped it
    if (!answer.ok) return refusedAtWrite ?? check() ?? fromTransport(answer, 'transport');
    // an answer is published only if what admitted its write still holds once it arrives
    const answered = check();
    if (answered) return answered;
    const bytes = jsonBytes(answer.result);
    if (bytes === null) return failed('notJson');
    return bytes <= this.maxResultBytes ? { ok: true, result: answer.result as never } : { ok: false, failure: 'tooLarge', reason: 'tooLarge' };
  }

  private ownerSources(directory: string): DirectCallsOptions['cache'] | ConfiguredDeliverySources {
    const configured = this.options.deliverySources;
    return configured?.owns(directory) ? configured : this.options.cache;
  }

  private async discovered(operation: Operation, input: DirectDiscoverInput): Promise<DirectDiscoverAnswer> {
    const { pool } = this.options;
    const cache = this.ownerSources(input.directory);
    const { signal } = operation.controller;
    const attachment = this.attachment;
    if (!this.credentialValid(input.credential)) return discoverFailure(unavailable('credential'));
    const resolved = await cache.resolveSource(input.directory, input.server);
    if (!this.registered(operation)) return discoverFailure(this.stopped(operation));
    if (!resolved.ok) return discoverFailure(unavailable('source', resolved.why));
    if (!sameSource(resolved.source, input)) return discoverFailure(unavailable('source', 'changed'));
    const read = await cache.readEntryForWrite(resolved.source);
    if (!this.registered(operation)) return discoverFailure(this.stopped(operation));
    if (!read.ok) return discoverFailure(unavailable('source', read.why));
    const connection = this.connectionCheck(read.stillValid, input.credential, attachment);
    const check = () => (this.registered(operation) ? connection() : this.stopped(operation));
    const stale = check(); // the source as it stands now, not only as the read's settlement saw it
    if (stale) return discoverFailure(stale);
    const acquired = await pool.acquire({ source: read.source, entry: read.entry, ...(input.credential && { credential: credentialOf(input.credential) }), fence: () => connection() === null }, signal);
    if (!acquired.ok) return discoverFailure(check() ?? fromTransport(acquired, 'connection'));
    try {
      const connected = check();
      if (connected) return discoverFailure(connected);
      const listed = await acquired.lease.listTools(signal);
      const after = check();
      if (after) return discoverFailure(after);
      if (!listed.ok) return discoverFailure(fromTransport(listed, 'connection'));
      this.publish(operation, read.source, listed.tools); // P3-HD M3b: in the same synchronous step as the check above
      return { ok: true, tools: listed.tools.map(({ name, readOnly }) => ({ name, readOnly })) };
    } finally {
      acquired.lease.release();
    }
  }

  // P4-B5 start
  // Every candidate the cache names for the tool (a report lists it, or an HTTP server whose verified resource is on one
  // of the hosts), each verified now, at most DIRECT_LOCATE_VERIFY_MAX lookups; one the live listing said requires task
  // execution is left out. Nothing is connected.
  private async located(operation: Operation, input: DirectLocateInput): Promise<DirectLocateAnswer> {
    const { cache } = this.options;
    const hosts = new Set(input.urlHosts);
    const sources: DirectSource[] = [];
    let lookups = 0;
    const configured = await this.options.deliverySources?.candidates(input.urlHosts) ?? [];
    if (!this.registered(operation)) return { sources: [] };
    for (const candidate of [...configured, ...cache.candidates?.(input.tool) ?? []]) {
      if (sources.length >= DIRECT_LOCATE_MAX || lookups >= DIRECT_LOCATE_VERIFY_MAX) break;
      if (!candidate.listed && !(candidate.http && hosts.size > 0)) continue;
      lookups += 1;
      const answer = await this.ownerSources(candidate.cwd).resolveSource(candidate.cwd, candidate.server);
      if (!this.registered(operation)) return { sources: [] };
      if (!answer.ok || this.hints.taskRequired(answer.source, input.tool)) continue;
      if (candidate.listed || hosts.has(hostOf(answer.source.url))) sources.push(publicSource(answer.source));
    }
    return { sources };
  }

  // The owner's delivery, in order: the source re-resolved and exact-matched, its entry re-read (`stillValid`), the
  // delivered artifact's fence taken, the connection acquired, a live tools/list showing the tool (no read-only rule: a
  // delivery writes, and the owner's gesture in a trusted sheet is what authorizes it; never a task-required tool), then
  // the call, its `admit` checking synchronously at the actual stdin write or fetch: still registered (not withdrawn,
  // not past its deadline, main's attachment), the artifact not deleted, the source still valid, the credential's epoch
  // not withdrawn. Every async step is followed by the same check. Once written, the answer is the receipt of a remote
  // effect already made, so it is answered as it came (bounded) even if one of those changed while it was on its way,
  // unlike a page's call, whose answer would be published into an artifact: withholding it would hide a delivery that
  // happened. Nothing is retried.
  private async sent(operation: Operation, input: DirectSendInput): Promise<DirectCallOutcome> {
    const { pool } = this.options;
    const cache = this.ownerSources(input.directory);
    const { signal } = operation.controller;
    const attachment = this.attachment;
    const store = this.options.store();
    if (!store) return failed('store');
    if (!this.credentialValid(input.credential)) return unavailable('credential');
    const resolved = await cache.resolveSource(input.directory, input.server);
    if (!this.registered(operation)) return this.stopped(operation);
    if (!resolved.ok) return unavailable('source', resolved.why);
    if (!sameSource(resolved.source, input)) return unavailable('source', 'changed');
    const read = await cache.readEntryForWrite(resolved.source);
    if (!this.registered(operation)) return this.stopped(operation);
    if (!read.ok) return unavailable('source', read.why);
    // taken in the same synchronous step that found the operation registered, so its `drop` lets go of it; a deletion
    // before the write stops the send there, one after it changes nothing (the remote effect is made)
    let written = false;
    const fence = store.deliveryFence(input.artifactId, () => {
      if (written) return;
      operation.revoked = true;
      operation.controller.abort();
    });
    operation.release = () => store.releaseConnectorFence(fence);
    const connection = this.connectionCheck(read.stillValid, input.credential, attachment);
    const check = (): Failure | null => {
      if (!this.registered(operation)) return this.stopped(operation);
      return store.deliveryFenceHolds(fence) ? connection() : REVOKED;
    };
    const ready = check();
    if (ready) return ready;
    const acquired = await pool.acquire({ source: read.source, entry: read.entry, ...(input.credential && { credential: credentialOf(input.credential) }), fence: () => connection() === null }, signal);
    if (!acquired.ok) return check() ?? fromTransport(acquired, 'connection');
    const { lease } = acquired;
    try {
      const connected = check();
      if (connected) return connected;
      const listed = await lease.listTools(signal);
      // A cold source is file-attested, not engine-observed. Initialization/listing may have waited a long time;
      // reread the selected entry before the delivery write rather than carrying its earlier file snapshot through it.
      if (cache !== this.options.cache) {
        const current = await cache.readEntryForWrite(read.source);
        if (!current.ok) return unavailable('source', current.why);
      }
      const afterList = check();
      if (afterList) return afterList;
      if (!listed.ok) return fromTransport(listed, 'connection');
      this.publish(operation, read.source, listed.tools); // in the same synchronous step as the check above
      const tool = listed.tools.find((entry) => entry.name === input.tool);
      if (!tool) return unavailable('toolMissing');
      if (tool.taskRequired) return unavailable('taskRequired');
      let refusedAtWrite: Failure | null = null;
      const answer = await lease.callTool(
        { name: input.tool, arguments: input.arguments },
        { admit: () => (written = (refusedAtWrite = check()) === null), signal, timeoutMs: Math.max(1, operation.deadlineAt - this.clock.now()) },
      );
      // a refusal before the write is ours (the connection's own fence included); after it, the transport's, and a
      // connection lost once the request went out is the exchange broken (`transport`), never a send that did not happen
      if (!answer.ok) {
        if (refusedAtWrite) return refusedAtWrite;
        if (!written) return check() ?? fromTransport(answer, 'transport');
        return answer.failure === 'unavailable' ? failed('transport') : fromTransport(answer, 'transport');
      }
      const bytes = jsonBytes(answer.result);
      if (bytes === null) return failed('notJson');
      return bytes <= this.maxResultBytes ? { ok: true, result: answer.result as never } : { ok: false, failure: 'tooLarge', reason: 'tooLarge' };
    } finally {
      lease.release();
    }
  }
  // P4-B5 end

  // P3-HD M3b: a live listing's hint, published only by the caller's synchronous post-list validity step (the operation
  // registered, its source still valid, its credential not withdrawn, the same attachment).
  private publish(operation: Operation, source: VerifiedConnectorSource, tools: readonly DirectTool[]): void {
    const credential = operation.credential && { connectionId: operation.credential.connectionId, credentialEpoch: operation.credential.credentialEpoch };
    this.hints.publish(source, tools, { admittedAt: operation.admittedAt, ...(credential && { credential }) });
  }

  // A connection's own validity, for its every write: the source as the entry's read verified it, the credential's
  // epoch not withdrawn, main's attachment the one the operation began in.
  private connectionCheck(stillValid: () => boolean, credential: Credential | undefined, attachment: number): () => Failure | null {
    return () => {
      if (!stillValid()) return unavailable('source');
      if (!this.credentialValid(credential)) return unavailable('credential');
      return this.attachment === attachment ? null : unavailable('cancelled');
    };
  }

  // The store's answer, or its failure as an outcome (a deleted artifact is the revoke's refusal).
  private async grantOf(ask: () => Promise<ConnectorAuthorization>): Promise<ConnectorAuthorization | Failure> {
    try {
      return await ask();
    } catch (error) {
      if (error instanceof ArtifactStoreError && error.code === 'notFound') return REVOKED;
      if (error instanceof ArtifactStoreError || error instanceof StoreTooNewError) return failed('store');
      throw error;
    }
  }
}

// What main learns of a verified source: its provenance and HTTP resource, never its entry or digest.
function publicSource(source: VerifiedConnectorSource): DirectSource {
  return {
    directory: source.cwd, sourceId: source.sourceId, generation: source.generation, server: source.server, scope: source.scope, transport: source.transport,
    path: source.path, entryPath: [...source.entryPath], observedAt: source.observedAt, ...(source.url !== undefined && { resourceUrl: source.url }),
  };
}

// P3-HD M3b: an engine report's and a live listing's readOnly together, conservatively: either saying it may write wins.
const combined = (reported: boolean | null, hinted: boolean | null): boolean | null => (reported === null ? hinted : hinted === null ? reported : reported && hinted);

// P4-B5: a verified HTTP resource's host ('' for none or a URL that does not parse)
function hostOf(url: string | undefined): string {
  if (url === undefined) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const sameSource = (source: VerifiedConnectorSource, input: { directory: string; sourceId: string; generation: number; server: string }) =>
  source.cwd === input.directory && source.sourceId === input.sourceId && source.generation === input.generation && source.server === input.server;
// a discovery answers only unavailable or failed: a refusal there is no grant's, a result over a bound the transport's
const discoverFailure = (failure: Failure): DirectDiscoverAnswer =>
  failure.failure === 'refused' ? { ok: false, failure: 'unavailable', reason: failure.reason } : { ok: false, failure: failure.failure === 'tooLarge' ? 'failed' : failure.failure, reason: failure.reason, ...('sourceRefusal' in failure && failure.sourceRefusal && { sourceRefusal: failure.sourceRefusal }) };
const credentialOf = ({ connectionId, credentialEpoch, accessToken }: Credential) => ({ connectionId, credentialEpoch, accessToken });

function jsonBytes(value: unknown): number | null {
  try {
    const text = JSON.stringify(value) as string | undefined;
    return text === undefined ? null : Buffer.byteLength(text);
  } catch {
    return null;
  }
}

// E3c: route E's compact publication contract with route D's closed failure vocabulary.
function takeOf(publication: RefreshPublication): DatasetEnd | Failure {
  if ('discarded' in publication) return publication.discarded === 'cancelled' ? unavailable('cancelled') : { status: 'failed', reason: publication.discarded };
  if (publication.failed) return { status: 'failed', reason: publication.failed };
  const { artifactId, id, revision, columns = [], rows = 0, warnings } = publication.published;
  return { status: 'dataset', artifactId, id, revision, columns, rows, ...(warnings && { warnings }) };
}
