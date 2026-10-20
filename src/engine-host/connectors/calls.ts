// P3-H H3b: route E's engine leg, the host's half (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision
// Log 24, 82, 83 and 85). Main finds the eligible live session and checks the owner's grant without consuming it; the
// host, which holds the store and the session's control client, is where a tool call is finally admitted and written.
//
// - `resolve` reads one session's mcp_status now (./status.ts) and answers only ready-with-fingerprint or why not; the
//   answer's configuration never leaves the host. The engine's support of mcp_call is probed once per live client.
// - `start` answers at once (main's dispatch is bounded at 10 s, a tool is not) and runs the operation: the session's
//   mcp_status checked against what main admitted, the grant authorized with the mode main expects (so a grant swapped
//   since is refused before an Allow once is consumed), mcp_status read again, and then, synchronously up to the
//   request: not cancelled, the same live process in the same directory, the store's fence of the grant held (no
//   revoke, delete or grant replacing its fingerprint or mode asked for since the authorization began, a read grant
//   still as authorized). The request is then queued for the engine's stdin, which may still be busy: the fence stays
//   held until the call ends, and any of those asked for meanwhile breaks it synchronously and aborts the operation,
//   so the transport drops a request not yet started (and a running one is cancelled). Its end is announced by id
//   alone (`completed`), its outcome kept for one `take`.
// - P3 Decision Log 91: the fence outlives the call and is let go of only with the operation itself (its take, cancel,
//   expiry or main's going), so a revoke, a replacing grant or the artifact's deletion while the outcome waits for its
//   take turns it into the revoke's refusal: no result reaches main for an artifact deleted before main took it, though
//   an Allow once's row went with the call and the deletion announces no grant.
// - Nothing here launches, acquires or marks a session used; nothing outlives its bound: a running operation ends with
//   mcp_call's long deadline, an untaken outcome (and its fence) after `resultTtlMs`, and all of them when main goes
//   (`close`). P3-F: `close` also cancels every resolve still running, and an observation for route D is begun and
//   lands only within the attachment its resolve or operation began in, so none repopulates the cache a close cleared.
// - E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): a start that carries `dataset` is a dataset
//   refresh. It is admitted by the sink (`datasets`) before the engine is asked anything, needs a read grant, and its
//   result never leaves the host: the call's end is announced as any is, and main's first take
//   (`takeOperation`, `connectors.take`), made only once main has rechecked that the work may still publish, starts the
//   publication and answers `publishing`; later takes join it, explicitly. The publication's end is announced by id
//   again, and the next take answers it once (`ConnectorDatasetTake`: the compact metadata, or a typed failure) and
//   lets go of the fence. Until then the operation stays registered: a cancel, main's going, the request's end or a
//   broken fence stops it before the commit. H's own `take` keeps its nullable outcome; a dataset operation that ended
//   before its call (refused, unavailable) answers that outcome as H's do.
// - E3 M2 residual (the architect's terminal-ownership ruling): main's `cancel` of a dataset operation is answered by
//   the host's own end. Before its commit is admitted (synchronously, in the commit's prepare) the cancel wins: nothing
//   is published, and the operation is kept for the next take, which answers `failed: timeout`. Once admitted (or its
//   end already decided) the cancel answers false and stops nothing: the commit or its rollback is announced as any
//   end, and the next take answers it. Main's cancel of any other operation is H's.
import { ARTIFACT_MAX_BYTES } from '@shared/maws/tools';
import type { ConnectorAuthorization, ConnectorCallRef, ConnectorGrantMode } from '@shared/artifacts/connectors';
import type { CommandInput } from '@shared/ipc/schema';
import type { ConnectorDatasetTake, ConnectorOperationOutcome, ConnectorResolveAnswer } from '@shared/ipc/schema/connectors';
import { mcpStatus } from '../controls';
import { ArtifactStoreError, StoreTooNewError } from '../documents/errors';
import type { ConnectorFence } from '../documents/store';
import { callMcpTool, probeMcpCall, type McpCallSupport } from '../mcp-call';
import { ControlError, type ControlClient } from '../rpc';
import { connectorToolState } from './status';
import type { ConnectorDatasetSink } from './dataset-sink'; // E3
import type { RefreshPublication, RefreshPublish, RefreshRaw } from '../dashboards/refresh'; // E3
import type { ConnectorLaunchContext, ConnectorStatusCache } from './provenance'; // P3-HD

// The host's view of a session (an EngineSession is one).
export interface ConnectorSessionView {
  readonly lifecycle: string;
  readonly control: ControlClient | null;
  status(): { launchId: string; cwd: string };
  connectorLaunchContext?(): ConnectorLaunchContext; // P3-HD: the launch's facts, for route D's observations
}

// The store's grant authority as the host's last check uses it (an ArtifactStore is one).
export interface ConnectorGrantStore {
  connectorFence(artifactId: string, call: ConnectorCallRef, mode: ConnectorGrantMode, onBreak?: () => void): ConnectorFence;
  releaseConnectorFence(fence: ConnectorFence): void;
  authorizeConnectorCall(artifactId: string, call: ConnectorCallRef, expected?: ConnectorGrantMode): Promise<ConnectorAuthorization>;
  connectorFenceHolds(fence: ConnectorFence, call: ConnectorCallRef, mode: ConnectorGrantMode): 'held' | 'revoked' | 'fingerprintChanged' | 'wrongMode';
}

export interface ConnectorCallsOptions {
  session(appSessionId: string): ConnectorSessionView | undefined;
  store(): ConnectorGrantStore | null;
  completed(operationId: string): void; // `connectors.operation`, the id alone
  probe?: (client: ControlClient, signal: AbortSignal) => Promise<McpCallSupport>;
  resultTtlMs?: number;
  maxResultBytes?: number;
  log?: (line: string) => void;
  datasets?: ConnectorDatasetSink; // E3: where a start's `dataset` sink publishes (absent: such a start is refused)
  // P3-HD: route D's observation cache; each mcp_status answer read here is observed before it is discarded
  statusCache?: ConnectorStatusCache;
}

// main's input, as the IPC validated it
export type ConnectorStart = CommandInput<'connectors.start'>;
export type ConnectorSessionTool = CommandInput<'connectors.resolve'>;
type ConnectorSessionRef = Pick<ConnectorSessionTool, 'appSessionId' | 'launchId' | 'cwd'>; // P4-B5: a live launch, no tool

// An untaken outcome is dropped this long after its operation ended; main takes it as soon as it hears the end.
export const CONNECTOR_RESULT_TTL_MS = 60_000;
// `resolve`'s whole budget (the probe and the status read), inside the supervisor's 10 s dispatch.
export const CONNECTOR_RESOLVE_BOUND_MS = 8_000;
const MESSAGE_MAX = 1_000;

interface Operation {
  readonly id: string;
  readonly controller: AbortController;
  readonly attachment: number; // P3-F: main's attachment it began in
  revoked?: boolean; // its fence broke: a revoke or delete asked for while it ran, or while its outcome waits
  outcome?: ConnectorOperationOutcome;
  expiry?: ReturnType<typeof setTimeout>;
  release?: () => void; // lets go of its fence (Decision Log 91: with the operation, not the call)
  dataset?: DatasetPhase; // E3: a dataset operation past its call
  sink?: true; // E3: a dataset operation
  committing?: boolean; // E3 M2 residual: its publication admitted into its savepoint, not yet ended
  cancelled?: true; // E3 M2 residual: main's cancel won before the admission; its end is `failed: timeout`
}

// E3: a dataset operation's result in the host: waiting for main's take (`publish`), publishing, or its end (`take`).
interface DatasetPhase {
  publish?: () => Promise<ConnectorDatasetTake | ConnectorOperationOutcome>;
  publishing?: boolean;
  take?: ConnectorDatasetTake;
}
// what a dataset start's execution ends with past the sink: its publication to run at main's take, or its end already
type DatasetExecution = { publish(): Promise<ConnectorDatasetTake | ConnectorOperationOutcome> } | { take: ConnectorDatasetTake };

const unavailable = (message: string): ConnectorOperationOutcome => ({ ok: false, failure: 'unavailable', message: message.slice(0, MESSAGE_MAX) });
const failed = (message: string): ConnectorOperationOutcome => ({ ok: false, failure: 'failed', message: message.slice(0, MESSAGE_MAX) });
const refused = (refusal: 'notGranted' | 'fingerprintChanged' | 'wrongMode' | 'revoked', message: string): ConnectorOperationOutcome => ({ ok: false, failure: 'refused', refusal, message });
const words = (error: unknown) => (error instanceof Error ? error.message : String(error));
const revokedWhile = (input: ConnectorStart, when: string) => refused('revoked', `${input.artifactId}'s ${input.server} · ${input.tool} was revoked or deleted while ${when}`);

export class ConnectorCalls {
  private readonly operations = new Map<string, Operation>();
  private support = new WeakMap<ControlClient, Promise<McpCallSupport>>();
  private readonly resolving = new Set<AbortController>(); // P3-F: each running resolve's bound, aborted by `close`
  private attachment = 0; // P3-F: moves with every `close`
  private readonly probe: (client: ControlClient, signal: AbortSignal) => Promise<McpCallSupport>;
  private readonly ttlMs: number;
  private readonly maxResultBytes: number;
  private readonly log: (line: string) => void;

  constructor(private readonly options: ConnectorCallsOptions) {
    this.probe = options.probe ?? ((client, signal) => probeMcpCall(client, { signal }));
    this.ttlMs = options.resultTtlMs ?? CONNECTOR_RESULT_TTL_MS;
    this.maxResultBytes = options.maxResultBytes ?? ARTIFACT_MAX_BYTES;
    this.log = options.log ?? ((line) => console.warn(`[connectors] ${line}`));
  }

  async resolve(input: ConnectorSessionTool): Promise<ConnectorResolveAnswer> {
    const live = this.live(input);
    if (!live) return { ready: false, why: 'notLive' };
    const attachment = this.attachment;
    const bound = new AbortController();
    this.resolving.add(bound);
    const timer = setTimeout(() => bound.abort(), CONNECTOR_RESOLVE_BOUND_MS);
    try {
      const support = await this.supportOf(live.client, bound.signal);
      if (support !== 'supported') return { ready: false, why: support };
      const state = await this.toolState(live.client, input, bound.signal, attachment);
      if (state === null) return { ready: false, why: 'unknown' };
      if (!this.live(input)) return { ready: false, why: 'notLive' };
      return state.ready ? { ready: true, fingerprint: state.fingerprint, readOnly: state.readOnly } : { ready: false, why: state.why };
    } finally {
      clearTimeout(timer);
      this.resolving.delete(bound);
    }
  }

  // P4-B5 (the owner's delivery sheet): route D's observation alone, of one live session: its mcp_status read now and
  // observed as `resolve`'s is, under the same bound, so the cache knows what that engine reports. No probe, no tool,
  // nothing acquired or marked used. `observed`: an answer was read and handed to the cache (which may still refuse it).
  async observe(input: ConnectorSessionRef): Promise<{ observed: boolean }> {
    const live = this.live(input);
    if (!live || !this.options.statusCache) return { observed: false };
    const attachment = this.attachment;
    const ticket = this.observing(live.client, input);
    if (!ticket) return { observed: false };
    const bound = new AbortController();
    this.resolving.add(bound);
    const timer = setTimeout(() => bound.abort(), CONNECTOR_RESOLVE_BOUND_MS);
    try {
      const answer = await mcpStatus(live.client, {}, { signal: bound.signal });
      if (!this.stillObserving(live.client, input, ticket.context, attachment)) return { observed: false };
      this.options.statusCache.observe(ticket, answer);
      return { observed: true };
    } catch (error) {
      if (error instanceof ControlError && error.code === 'invalid_response' && this.stillObserving(live.client, input, ticket.context, attachment)) this.options.statusCache.reject(ticket);
      if (error instanceof ControlError) return { observed: false };
      throw error;
    } finally {
      clearTimeout(timer);
      this.resolving.delete(bound);
    }
  }

  start(input: ConnectorStart): { operationId: string } {
    if (this.operations.has(input.operationId)) throw new Error(`connector operation ${input.operationId} is already known`);
    const operation: Operation = { id: input.operationId, controller: new AbortController(), attachment: this.attachment, ...(input.dataset && { sink: true as const }) /* E3 */ };
    this.operations.set(operation.id, operation);
    void this.execute(operation, input).then(
      (outcome) => {
        if (operation.revoked) return this.finish(operation, revokedWhile(input, 'it ran'));
        if ('ok' in outcome) return this.finish(operation, outcome);
        this.keep(operation, outcome); // E3
      },
      (error: unknown) => this.finish(operation, failed(`the connector call failed in the host: ${words(error)}`)),
    );
    return { operationId: operation.id };
  }

  // The ended operation's outcome, once; null for one unknown, still running, already taken, cancelled or expired. A
  // fence broken while it waited answers the revoke's refusal instead (Decision Log 91).
  take(operationId: string): ConnectorOperationOutcome | null {
    const operation = this.operations.get(operationId);
    if (!operation?.outcome) return null;
    this.drop(operation);
    return operation.outcome;
  }

  // E3: what `connectors.take` answers: H's outcome as `take`'s, or a dataset operation's phase past its call. Its
  // result waiting for main's take starts publishing now; publishing, every take answers so; its end is answered once.
  takeOperation(operationId: string): { outcome: ConnectorOperationOutcome | null; dataset?: ConnectorDatasetTake } {
    const operation = this.operations.get(operationId);
    const phase = operation?.outcome === undefined ? operation?.dataset : undefined;
    if (!operation || !phase) return { outcome: this.take(operationId) };
    if (phase.take) {
      this.drop(operation);
      return { outcome: null, dataset: phase.take };
    }
    if (!phase.publishing) this.consume(operation, phase);
    return { outcome: null, dataset: { status: 'publishing', operationId } };
  }

  // Main withdrew it (its page's hide, close or revoke, or its own abort): it stops, before its write or through the
  // engine's control_cancel_request after, and is never announced.
  cancel(operationId: string): boolean {
    const operation = this.operations.get(operationId);
    if (!operation) return false;
    // E3 M2 residual: a dataset operation not yet ended, H's outcome aside: its admitted commit (or decided end) stands
    // for the next take; before the admission the cancel wins, its end kept for that take
    if (operation.sink && operation.outcome === undefined) {
      if (operation.committing || operation.dataset?.take) return false;
      operation.cancelled = true;
      operation.controller.abort();
      operation.dataset = { take: { status: 'failed', reason: 'timeout' } };
      clearTimeout(operation.expiry);
      operation.expiry = setTimeout(() => this.drop(operation), this.ttlMs);
      (operation.expiry as { unref?: () => void }).unref?.();
      return true;
    }
    this.drop(operation);
    operation.controller.abort();
    return true;
  }

  // Main is gone (its client left, or the host shuts down): every operation stops and every outcome goes.
  close(): void {
    this.attachment += 1; // P3-F
    for (const bound of this.resolving) bound.abort();
    this.resolving.clear();
    this.support = new WeakMap(); // a probe those aborts cancelled is never joined by the next attachment
    for (const operation of [...this.operations.values()]) {
      this.drop(operation);
      operation.controller.abort();
    }
  }

  private drop(operation: Operation): void {
    clearTimeout(operation.expiry);
    this.operations.delete(operation.id);
    operation.release?.();
  }

  private finish(operation: Operation, outcome: ConnectorOperationOutcome): void {
    if (this.operations.get(operation.id) !== operation) return; // cancelled or closed: nobody waits for it
    if (operation.cancelled) return; // E3 M2 residual: main's cancel won; its end is kept for the take
    delete operation.dataset; // E3
    operation.outcome = outcome;
    this.announce(operation);
  }

  // Its end, announced by id; what it holds is dropped if main never takes it.
  private announce(operation: Operation): void {
    clearTimeout(operation.expiry);
    operation.expiry = setTimeout(() => this.drop(operation), this.ttlMs);
    (operation.expiry as { unref?: () => void }).unref?.();
    // a macrotask later, so the end never overtakes `start`'s answer on the wire (OperationTable's rule)
    setTimeout(() => {
      if (this.operations.get(operation.id) === operation) this.options.completed(operation.id);
    }, 0);
  }

  // E3: a dataset operation past its call: its result kept in the host for main's take, or its end already (a dataset
  // found changed before the call); announced either way.
  private keep(operation: Operation, execution: DatasetExecution): void {
    if (this.operations.get(operation.id) !== operation || operation.cancelled) return;
    if ('publish' in execution && operation.controller.signal.aborted) return this.finish(operation, unavailable('cancelled'));
    operation.dataset = 'take' in execution ? { take: execution.take } : { publish: execution.publish };
    this.announce(operation);
  }

  // E3: main's first take: the publication runs, still registered (cancellable, its fence held) until it ends.
  private consume(operation: Operation, phase: DatasetPhase): void {
    phase.publishing = true;
    clearTimeout(operation.expiry);
    void phase.publish!().then(
      (end) => {
        delete operation.committing;
        if ('ok' in end) return this.finish(operation, end);
        if (this.operations.get(operation.id) !== operation || operation.cancelled) return; // nobody waits for it
        phase.take = end;
        this.announce(operation);
      },
      (error: unknown) => {
        delete operation.committing; // rolled back with its write: nothing published
        this.finish(operation, failed(`the dataset publication failed in the host: ${words(error)}`));
      },
    );
  }

  // E3: the operation withdrawn from outside main's commands (an agent's request ended otherwise): it stops, and a
  // result still waiting for main's take ends cancelled and is announced, so main takes that rather than wait out its
  // deadline. A publication already running ends as its commit's guard says.
  private withdraw(operation: Operation): void {
    if (this.operations.get(operation.id) !== operation) return;
    operation.controller.abort();
    if (operation.dataset?.publish && !operation.dataset.publishing) this.finish(operation, unavailable('cancelled'));
  }

  private async execute(operation: Operation, input: ConnectorStart): Promise<ConnectorOperationOutcome | DatasetExecution> {
    const { signal } = operation.controller;
    const store = this.options.store();
    if (!store) return failed('the artifact store is unavailable this run');
    // E3: a dataset's call is admitted by its sink first, under a read grant only; a dataset found changed or gone since
    // it was asked for ends `stale` there, nothing called
    let sink: { publish: RefreshPublish } | null = null;
    if (input.dataset) {
      if (input.mode !== 'read') return refused('wrongMode', `a dataset refresh of ${input.server} · ${input.tool} needs a read grant`);
      if (!this.options.datasets) return failed('this host publishes no datasets');
      const admitted = await this.options.datasets.admit({ ...input, dataset: input.dataset }, () => this.withdraw(operation));
      if ('refusal' in admitted) return admitted.stale ? { take: { status: 'failed', reason: 'stale' } } : failed(`the dataset refresh was refused: ${admitted.refusal}`);
      if (signal.aborted || this.operations.get(operation.id) !== operation) return unavailable('cancelled');
      sink = admitted;
    }
    const first = this.live(input);
    if (!first) return unavailable(`${input.appSessionId} is no longer the live session main found`);
    // what main admitted, against the session's mcp_status now, before the grant is asked (and an Allow once used)
    const before = await this.admitted(first.client, input, signal, operation.attachment);
    if (before !== null) return before;
    // Main's cancel or close may land between the check's answer and this continuation: an operation no longer
    // registered takes no fence (nothing would drop it again) and asks for no grant.
    if (signal.aborted || this.operations.get(operation.id) !== operation) return unavailable('cancelled');
    const call = { server: input.server, tool: input.tool, fingerprint: input.fingerprint };
    // Broken by a revoke, a delete or a grant replacing this fingerprint and mode the moment it is asked for: the
    // operation aborts there, so a call not yet written (still queued behind the engine's stdin) never is, and one
    // running is cancelled through control_cancel_request.
    // Decision Log 91: held past the call, until the operation is taken, cancelled, expired or dropped with main (`drop`),
    // so a break while the outcome waits for its take replaces the outcome with the revoke's refusal.
    const fence = store.connectorFence(input.artifactId, call, input.mode, () => {
      operation.revoked = true;
      operation.controller.abort();
      if (operation.outcome) operation.outcome = revokedWhile(input, 'its outcome waited for main');
      // E3: a dataset's result waiting for main's take ends revoked, never published (one publishing ends as its guard
      // says; an end already there stands)
      else if (operation.dataset?.publish && !operation.dataset.publishing && this.operations.get(operation.id) === operation) {
        operation.dataset = { take: { status: 'failed', reason: 'revoked' } };
        this.announce(operation);
      }
    });
    // Taken and its cleanup installed in the same synchronous step as the check above found the operation registered,
    // so its `drop` (take, cancel, expiry, close) is what lets go of the fence.
    operation.release = () => store.releaseConnectorFence(fence);
    const outcome = await this.fenced(store, fence, first.client, input, signal, operation.attachment, sink !== null);
    if (!('raw' in outcome)) return outcome;
    // E3: the publication's guard, read in its commit's prepare: still registered, not cancelled, the fence held
    const guard = (): 'held' | 'revoked' | 'cancelled' => {
      if (operation.revoked) return 'revoked';
      if (signal.aborted || this.operations.get(operation.id) !== operation) return 'cancelled';
      return store.connectorFenceHolds(fence, call, input.mode) === 'held' ? 'held' : 'revoked';
    };
    const publishing = sink!;
    return { publish: async () => takeOf(await publishing.publish(outcome.raw, guard, () => (operation.committing = true))) };
  }

  private async fenced(store: ConnectorGrantStore, fence: ConnectorFence, client: ControlClient, input: ConnectorStart, signal: AbortSignal, attachment: number, dataset = false): Promise<ConnectorOperationOutcome | { raw: RefreshRaw }> {
    const named = `${input.artifactId}'s ${input.server} · ${input.tool} in ${input.appSessionId}`;
    const call = { server: input.server, tool: input.tool, fingerprint: input.fingerprint };
    let authorization: ConnectorAuthorization;
    try {
      authorization = await store.authorizeConnectorCall(input.artifactId, call, input.mode);
    } catch (error) {
      if (error instanceof ArtifactStoreError && error.code === 'notFound') return refused('revoked', `${input.artifactId} is gone`);
      if (error instanceof ArtifactStoreError || error instanceof StoreTooNewError) return failed(`the grant of ${named} could not be read: ${words(error)}`);
      throw error;
    }
    if (!authorization.granted) return refused(authorization.refusal, `no grant admits ${named} (${authorization.refusal})`);
    const after = await this.admitted(client, input, signal, attachment);
    if (after !== null) return after;
    // ── synchronous from here to the request: the fence held now, and its break aborting the request after ──
    if (signal.aborted) return unavailable('cancelled');
    const live = this.live(input);
    if (!live || live.client !== client) return unavailable(`${input.appSessionId} exited, relaunched or moved before the call`);
    const held = store.connectorFenceHolds(fence, call, input.mode);
    if (held !== 'held') return refused(held, `${named}'s grant changed before the call (${held})`);
    const answer = await callMcpTool(live.client, { server: input.server, tool: input.tool, arguments: input.arguments }, { signal });
    if (dataset) {
      const raw = this.rawOf(answer, signal);
      return 'kind' in raw ? { raw } : raw; // E3
    }
    if (answer.ok) {
      const bytes = jsonBytes(answer.result);
      if (bytes === null) return failed(`${named} answered a result that is not JSON`);
      return bytes <= this.maxResultBytes ? { ok: true, result: answer.result } : { ok: false, failure: 'tooLarge', message: `${named} answered ${bytes} bytes` };
    }
    switch (answer.refusal) {
      case 'unsupported':
      case 'not_connected':
      case 'needs_auth':
      case 'session_expired':
      case 'exited':
        return unavailable(answer.message);
      default:
        return failed(answer.message);
    }
  }

  // E3: a dataset call's answer as its publication reads it: the result (JSON, at most the artifact bound), or a failure
  // it records as the error state; a server gone or a cancelled call is the operation's own outcome, written nowhere.
  private rawOf(answer: Awaited<ReturnType<typeof callMcpTool>>, signal: AbortSignal): RefreshRaw | ConnectorOperationOutcome {
    if (answer.ok) {
      const bytes = jsonBytes(answer.result);
      if (bytes === null) return { kind: 'failed', reason: 'toolError' };
      return bytes <= this.maxResultBytes ? { kind: 'result', result: answer.result } : { kind: 'failed', reason: 'tooLarge' };
    }
    if (signal.aborted || answer.refusal === 'cancelled') return unavailable('cancelled');
    if (answer.refusal === 'timeout') return { kind: 'failed', reason: 'timeout' };
    if (answer.refusal === 'failed') return { kind: 'failed', reason: 'toolError' };
    return unavailable(answer.message);
  }

  // Null when the session's mcp_status still shows the tool main admitted: ready, the same fingerprint, read-only for a
  // read grant. Otherwise why not, as the operation's outcome.
  private async admitted(client: ControlClient, input: ConnectorStart, signal: AbortSignal, attachment: number): Promise<ConnectorOperationOutcome | null> {
    const state = await this.toolState(client, input, signal, attachment);
    if (signal.aborted) return unavailable('cancelled');
    if (state === null) return unavailable(`${input.appSessionId}'s mcp_status could not be read`);
    if (!state.ready) return unavailable(`${input.server} · ${input.tool} is ${state.why} in ${input.appSessionId}`);
    if (state.fingerprint !== input.fingerprint) return refused('fingerprintChanged', `${input.server} · ${input.tool} changed since main's check`);
    if (input.mode === 'read' && !state.readOnly) return refused('wrongMode', `${input.server} · ${input.tool} is no longer read-only`);
    return null;
  }

  private async toolState(client: ControlClient, input: ConnectorSessionTool, signal: AbortSignal, attachment: number) {
    const ticket = attachment === this.attachment ? this.observing(client, input) : null; // P3-HD; P3-F: never past a close
    try {
      const answer = await mcpStatus(client, {}, { signal });
      if (ticket && this.stillObserving(client, input, ticket.context, attachment)) this.options.statusCache?.observe(ticket, answer); // P3-HD
      return connectorToolState(answer, input.server, input.tool);
    } catch (error) {
      if (ticket && error instanceof ControlError && error.code === 'invalid_response' && this.stillObserving(client, input, ticket.context, attachment)) this.options.statusCache?.reject(ticket); // P3-HD
      if (error instanceof ControlError) return null;
      throw error;
    }
  }

  // P3-HD start: an observation is taken only for the session's live launch, still in the directory it was launched in
  // (a set_cwd since then makes its report another directory's), its place in that launch's order taken before the
  // request is written; and (panel correction) its answer lands only if that still holds once it arrives, so a
  // set_cwd or a relaunch while the request was pending discards it. P3-F: so does main's going (`close`) meanwhile.
  private observing(client: ControlClient, input: ConnectorSessionRef) {
    const cache = this.options.statusCache;
    const context = this.observedContext(client, input);
    return cache && context ? cache.begin(context) : null;
  }

  private stillObserving(client: ControlClient, input: ConnectorSessionRef, begun: ConnectorLaunchContext, attachment: number): boolean {
    if (attachment !== this.attachment) return false; // P3-F
    const context = this.observedContext(client, input);
    return context !== null && context.appSessionId === begun.appSessionId && context.launchId === begun.launchId && context.cwd === begun.cwd;
  }

  private observedContext(client: ControlClient, input: ConnectorSessionRef): ConnectorLaunchContext | null {
    const session = this.options.session(input.appSessionId);
    const context = session?.connectorLaunchContext?.();
    if (!session || !context || session.control !== client) return null;
    const status = session.status();
    return status.launchId === context.launchId && status.cwd === context.cwd ? context : null;
  }
  // P3-HD end

  private supportOf(client: ControlClient, signal: AbortSignal): Promise<McpCallSupport> {
    let known = this.support.get(client);
    if (!known) {
      known = this.probe(client, signal).catch(() => 'unknown' as const);
      this.support.set(client, known);
      void known.then((support) => {
        if (support === 'unknown' && this.support.get(client) === known) this.support.delete(client); // asked again next time
      });
    }
    return known;
  }

  private live(input: ConnectorSessionRef): { client: ControlClient } | null {
    const session = this.options.session(input.appSessionId);
    if (!session || session.lifecycle !== 'ready' || !session.control) return null;
    const status = session.status();
    return status.launchId === input.launchId && status.cwd === input.cwd ? { client: session.control } : null;
  }
}

// E3: a publication's end as main's take answers it: the committed snapshot's metadata (never a row), the failure an
// error state recorded, or why nothing was written; a cancelled one is the operation's own outcome.
function takeOf(publication: RefreshPublication): ConnectorDatasetTake | ConnectorOperationOutcome {
  if ('discarded' in publication) return publication.discarded === 'cancelled' ? unavailable('cancelled') : { status: 'failed', reason: publication.discarded };
  if (publication.failed) return { status: 'failed', reason: publication.failed };
  const { artifactId, id, revision, columns = [], rows = 0, warnings } = publication.published;
  return { status: 'dataset', artifactId, id, revision, columns, rows, ...(warnings && { warnings }) };
}

function jsonBytes(value: unknown): number | null {
  try {
    const text = JSON.stringify(value) as string | undefined;
    return text === undefined ? null : Buffer.byteLength(text);
  } catch {
    return null;
  }
}
