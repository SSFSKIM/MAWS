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
// - Nothing here launches, acquires or marks a session used; nothing outlives its bound: a running operation ends with
//   mcp_call's long deadline, an untaken outcome after `resultTtlMs`, and all of them when main goes (`close`).
import { ARTIFACT_MAX_BYTES } from '@shared/maws/tools';
import type { ConnectorAuthorization, ConnectorCallRef, ConnectorGrantMode } from '@shared/artifacts/connectors';
import type { CommandInput } from '@shared/ipc/schema';
import type { ConnectorOperationOutcome, ConnectorResolveAnswer } from '@shared/ipc/schema/connectors';
import { mcpStatus } from '../controls';
import { ArtifactStoreError, StoreTooNewError } from '../documents/errors';
import type { ConnectorFence } from '../documents/store';
import { callMcpTool, probeMcpCall, type McpCallSupport } from '../mcp-call';
import { ControlError, type ControlClient } from '../rpc';
import { connectorToolState } from './status';

// The host's view of a session (an EngineSession is one).
export interface ConnectorSessionView {
  readonly lifecycle: string;
  readonly control: ControlClient | null;
  status(): { launchId: string; cwd: string };
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
}

// main's input, as the IPC validated it
export type ConnectorStart = CommandInput<'connectors.start'>;
export type ConnectorSessionTool = CommandInput<'connectors.resolve'>;

// An untaken outcome is dropped this long after its operation ended; main takes it as soon as it hears the end.
export const CONNECTOR_RESULT_TTL_MS = 60_000;
// `resolve`'s whole budget (the probe and the status read), inside the supervisor's 10 s dispatch.
export const CONNECTOR_RESOLVE_BOUND_MS = 8_000;
const MESSAGE_MAX = 1_000;

interface Operation {
  readonly id: string;
  readonly controller: AbortController;
  revoked?: boolean; // its fence broke: a revoke or delete asked for while it ran
  outcome?: ConnectorOperationOutcome;
  expiry?: ReturnType<typeof setTimeout>;
}

const unavailable = (message: string): ConnectorOperationOutcome => ({ ok: false, failure: 'unavailable', message: message.slice(0, MESSAGE_MAX) });
const failed = (message: string): ConnectorOperationOutcome => ({ ok: false, failure: 'failed', message: message.slice(0, MESSAGE_MAX) });
const refused = (refusal: 'notGranted' | 'fingerprintChanged' | 'wrongMode' | 'revoked', message: string): ConnectorOperationOutcome => ({ ok: false, failure: 'refused', refusal, message });
const words = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class ConnectorCalls {
  private readonly operations = new Map<string, Operation>();
  private readonly support = new WeakMap<ControlClient, Promise<McpCallSupport>>();
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
    const bound = new AbortController();
    const timer = setTimeout(() => bound.abort(), CONNECTOR_RESOLVE_BOUND_MS);
    try {
      const support = await this.supportOf(live.client, bound.signal);
      if (support !== 'supported') return { ready: false, why: support };
      const state = await this.toolState(live.client, input, bound.signal);
      if (state === null) return { ready: false, why: 'unknown' };
      if (!this.live(input)) return { ready: false, why: 'notLive' };
      return state.ready ? { ready: true, fingerprint: state.fingerprint, readOnly: state.readOnly } : { ready: false, why: state.why };
    } finally {
      clearTimeout(timer);
    }
  }

  start(input: ConnectorStart): { operationId: string } {
    if (this.operations.has(input.operationId)) throw new Error(`connector operation ${input.operationId} is already known`);
    const operation: Operation = { id: input.operationId, controller: new AbortController() };
    this.operations.set(operation.id, operation);
    void this.execute(operation, input).then(
      (outcome) => this.finish(operation, operation.revoked ? refused('revoked', `${input.artifactId}'s ${input.server} · ${input.tool} was revoked or deleted while it ran`) : outcome),
      (error: unknown) => this.finish(operation, failed(`the connector call failed in the host: ${words(error)}`)),
    );
    return { operationId: operation.id };
  }

  // The ended operation's outcome, once; null for one unknown, still running, already taken, cancelled or expired.
  take(operationId: string): ConnectorOperationOutcome | null {
    const operation = this.operations.get(operationId);
    if (!operation?.outcome) return null;
    this.drop(operation);
    return operation.outcome;
  }

  // Main withdrew it (its page's hide, close or revoke, or its own abort): it stops, before its write or through the
  // engine's control_cancel_request after, and is never announced.
  cancel(operationId: string): boolean {
    const operation = this.operations.get(operationId);
    if (!operation) return false;
    this.drop(operation);
    operation.controller.abort();
    return true;
  }

  // Main is gone (its client left, or the host shuts down): every operation stops and every outcome goes.
  close(): void {
    for (const operation of [...this.operations.values()]) {
      this.drop(operation);
      operation.controller.abort();
    }
  }

  private drop(operation: Operation): void {
    clearTimeout(operation.expiry);
    this.operations.delete(operation.id);
  }

  private finish(operation: Operation, outcome: ConnectorOperationOutcome): void {
    if (this.operations.get(operation.id) !== operation) return; // cancelled or closed: nobody waits for it
    operation.outcome = outcome;
    operation.expiry = setTimeout(() => this.drop(operation), this.ttlMs);
    (operation.expiry as { unref?: () => void }).unref?.();
    // a macrotask later, so the end never overtakes `start`'s answer on the wire (OperationTable's rule)
    setTimeout(() => {
      if (this.operations.get(operation.id) === operation) this.options.completed(operation.id);
    }, 0);
  }

  private async execute(operation: Operation, input: ConnectorStart): Promise<ConnectorOperationOutcome> {
    const { signal } = operation.controller;
    const store = this.options.store();
    if (!store) return failed('the artifact store is unavailable this run');
    const first = this.live(input);
    if (!first) return unavailable(`${input.appSessionId} is no longer the live session main found`);
    // what main admitted, against the session's mcp_status now, before the grant is asked (and an Allow once used)
    const before = await this.admitted(first.client, input, signal);
    if (before !== null) return before;
    const call = { server: input.server, tool: input.tool, fingerprint: input.fingerprint };
    // Broken by a revoke, a delete or a grant replacing this fingerprint and mode the moment it is asked for: the
    // operation aborts there, so a call not yet written (still queued behind the engine's stdin) never is, and one
    // running is cancelled through control_cancel_request.
    const fence = store.connectorFence(input.artifactId, call, input.mode, () => {
      operation.revoked = true;
      operation.controller.abort();
    });
    try {
      return await this.fenced(store, fence, first.client, input, signal);
    } finally {
      store.releaseConnectorFence(fence);
    }
  }

  private async fenced(store: ConnectorGrantStore, fence: ConnectorFence, client: ControlClient, input: ConnectorStart, signal: AbortSignal): Promise<ConnectorOperationOutcome> {
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
    const after = await this.admitted(client, input, signal);
    if (after !== null) return after;
    // ── synchronous from here to the request: the fence held now, and its break aborting the request after ──
    if (signal.aborted) return unavailable('cancelled');
    const live = this.live(input);
    if (!live || live.client !== client) return unavailable(`${input.appSessionId} exited, relaunched or moved before the call`);
    const held = store.connectorFenceHolds(fence, call, input.mode);
    if (held !== 'held') return refused(held, `${named}'s grant changed before the call (${held})`);
    const answer = await callMcpTool(live.client, { server: input.server, tool: input.tool, arguments: input.arguments }, { signal });
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

  // Null when the session's mcp_status still shows the tool main admitted: ready, the same fingerprint, read-only for a
  // read grant. Otherwise why not, as the operation's outcome.
  private async admitted(client: ControlClient, input: ConnectorStart, signal: AbortSignal): Promise<ConnectorOperationOutcome | null> {
    const state = await this.toolState(client, input, signal);
    if (signal.aborted) return unavailable('cancelled');
    if (state === null) return unavailable(`${input.appSessionId}'s mcp_status could not be read`);
    if (!state.ready) return unavailable(`${input.server} · ${input.tool} is ${state.why} in ${input.appSessionId}`);
    if (state.fingerprint !== input.fingerprint) return refused('fingerprintChanged', `${input.server} · ${input.tool} changed since main's check`);
    if (input.mode === 'read' && !state.readOnly) return refused('wrongMode', `${input.server} · ${input.tool} is no longer read-only`);
    return null;
  }

  private async toolState(client: ControlClient, input: { server: string; tool: string }, signal: AbortSignal) {
    try {
      return connectorToolState(await mcpStatus(client, {}, { signal }), input.server, input.tool);
    } catch (error) {
      if (error instanceof ControlError) return null;
      throw error;
    }
  }

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

  private live(input: ConnectorSessionTool): { client: ControlClient } | null {
    const session = this.options.session(input.appSessionId);
    if (!session || session.lifecycle !== 'ready' || !session.control) return null;
    const status = session.status();
    return status.launchId === input.launchId && status.cwd === input.cwd ? { client: session.control } : null;
  }
}

function jsonBytes(value: unknown): number | null {
  try {
    const text = JSON.stringify(value) as string | undefined;
    return text === undefined ? null : Buffer.byteLength(text);
  } catch {
    return null;
  }
}
