// The OperationTable (C3 execution document, Interfaces "Deadlines and operations", M5): the five X2 commands whose
// engine round trip is a `long` control answer a receipt `{ opId }` as soon as the request frame is flushed (`opId` is
// the minted request id, so the journal correlates it) and complete through `session.operation` exactly once: the typed
// value, the engine's error, the 120 s deadline, a failed write, or the process's exit. A success that arrives inside the
// control client's 60 s late table after the deadline completes a second time with `late: true`, which is how a
// consumer that showed the failure reconciles. Completions are emitted a macrotask later, so a completion never
// overtakes the receipt on the port (the runtime posts the command's answer from the handler's microtask chain).
//
// P5 O7 M8 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, *Operations and panel events*): a completion that
// goes out is kept by its opId, the latest of each (a late success in place of the timeout it reconciles), at most
// OPERATIONS_KEPT a session for OPERATION_KEPT_MS, and an op is in flight from its receipt until its first completion goes
// out; `outcomes` answers `session.operations` from both, so a waiter whose completion was lost on the way (a remote
// device's channel dropped between the receipt and the completion) learns it, or that it still runs, or that the host
// doesn't know it. Kept in memory: a new engine host knows none.
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import { SESSION_OPERATIONS_MAX, type OperationCommand, type OperationError, type OperationEvent, type OperationOutcome } from '@shared/engine/operations';
import { CONTROLS, type OutboundRequest, type OutboundSubtype } from './controls';
import { ControlError, LATE_TABLE_MS, type ControlClient, type LateResponse } from './rpc';

export type OperationSubtype = Extract<OutboundSubtype, 'generate_session_title' | 'reload_plugins' | 'side_question' | 'mcp_reconnect' | 'mcp_toggle' | 'reload_skills' /* E8 */>;

interface Open {
  appSessionId: AppSessionId;
  command: OperationCommand;
  subtype: OperationSubtype;
}

// The two MCP commands carry no value: their effect is visible in `session.status.mcpServers`.
type OperationValue = Extract<OperationEvent['outcome'], { ok: true }>['value'];
const valueOf = (command: OperationCommand, response: unknown): OperationValue =>
  command === 'session.mcpReconnect' || command === 'session.mcpToggle' ? null : (response as NonNullable<OperationValue>); // the subtype's schema parsed it

function operationError(error: unknown): OperationError {
  if (error instanceof ControlError) {
    if (error.code === 'timeout' || error.code === 'write_failed' || error.code === 'exited') return { code: error.code, message: error.message, engineCode: null };
    return { code: 'engine_error', message: error.message, engineCode: error.code };
  }
  return { code: 'engine_error', message: error instanceof Error ? error.message : String(error), engineCode: null };
}

/** Completions kept a session (`session.operations`), the oldest going first. */
export const OPERATIONS_KEPT = SESSION_OPERATIONS_MAX;
/** How long a completion is kept after it went out. */
export const OPERATION_KEPT_MS = 10 * 60_000;

export class OperationTable {
  private readonly timedOut = new Map<string, Open>(); // awaiting a late success, for as long as the client's late table keeps the id
  private readonly hooked = new WeakSet<ControlClient>();
  /** Each op from its receipt until its first completion went out, with its session. */
  private readonly inFlight = new Map<string, AppSessionId>();
  /** Each session's completions that went out, by opId, oldest first, with when. */
  private readonly kept = new Map<AppSessionId, Map<string, { event: OperationEvent; at: number }>>();
  private readonly now: () => number;

  constructor(
    private readonly emit: (event: OperationEvent) => void,
    options: { now?(): number } = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  /** What the host says of each of `opIds` on `appSessionId`: its completion, `pending`, or `unknown`. */
  outcomes(appSessionId: AppSessionId, opIds: readonly string[]): OperationOutcome[] {
    this.expire();
    const kept = this.kept.get(appSessionId);
    return opIds.map((opId) => {
      const event = kept?.get(opId)?.event;
      if (event !== undefined) return { opId, event };
      return this.inFlight.get(opId) === appSessionId ? { opId, pending: true } : { opId, unknown: true };
    });
  }

  // Writes the request; resolves the receipt at the flushed write (or, when the write never happened, as soon as the
  // failure names the minted id, so every operation is correlated by the completion that follows).
  start<S extends OperationSubtype>(appSessionId: AppSessionId, command: OperationCommand, client: ControlClient, subtype: S, payload: OutboundRequest<S>): Promise<{ opId: string }> {
    this.hookLate(client);
    const op: Open = { appSessionId, command, subtype };
    return new Promise((resolve, reject) => {
      let opId: string | null = null;
      client
        .request(subtype, payload, {
          onWritten: (id) => {
            this.inFlight.set(id, appSessionId);
            resolve({ opId: (opId = id) });
          },
        })
        .then(
          (response) => this.complete(opId!, op, false, { ok: true, value: valueOf(command, response) }),
          (error: unknown) => {
            if (opId === null) {
              if (!(error instanceof ControlError)) return reject(error);
              this.inFlight.set(error.requestId, appSessionId);
              resolve({ opId: (opId = error.requestId) });
            }
            if (error instanceof ControlError && error.code === 'timeout') this.awaitLate(opId, op);
            this.complete(opId, op, false, { ok: false, error: operationError(error) });
          },
        );
    });
  }

  private complete(opId: string, op: Open, late: boolean, outcome: OperationEvent['outcome']): void {
    const event: OperationEvent = { appSessionId: op.appSessionId, opId, command: op.command, late, outcome };
    // after the receipt's answer, which the runtime posts from microtasks; kept as it goes, so no answer is ahead of it
    setTimeout(() => {
      this.keep(event);
      this.emit(event);
    }, 0);
  }

  /** A completion that goes out, kept in place of any earlier one of its op, its session's oldest past the bound dropped. */
  private keep(event: OperationEvent): void {
    this.inFlight.delete(event.opId);
    this.expire();
    let kept = this.kept.get(event.appSessionId);
    if (kept === undefined) this.kept.set(event.appSessionId, (kept = new Map()));
    kept.delete(event.opId);
    kept.set(event.opId, { event, at: this.now() });
    while (kept.size > OPERATIONS_KEPT) kept.delete(kept.keys().next().value!);
  }

  /** Completions past OPERATION_KEPT_MS forgotten (each session's oldest first), and a session with none left. */
  private expire(): void {
    const before = this.now() - OPERATION_KEPT_MS;
    for (const [appSessionId, kept] of this.kept) {
      for (const [opId, { at }] of kept) {
        if (at > before) break;
        kept.delete(opId);
      }
      if (kept.size === 0) this.kept.delete(appSessionId);
    }
  }

  private awaitLate(opId: string, op: Open): void {
    this.timedOut.set(opId, op);
    const timer = setTimeout(() => this.timedOut.delete(opId), LATE_TABLE_MS);
    (timer as { unref?: () => void }).unref?.();
  }

  private hookLate(client: ControlClient): void {
    if (this.hooked.has(client)) return;
    this.hooked.add(client);
    client.onLateResponse((late: LateResponse) => this.late(late.requestId, late.response));
  }

  private late(requestId: RequestId, envelope: LateResponse['response']): void {
    const op = this.timedOut.get(requestId);
    if (!op) return;
    this.timedOut.delete(requestId);
    if (envelope.subtype !== 'success') return; // the failure was already reported; a late error changes nothing
    const parsed = CONTROLS[op.subtype].response.safeParse(envelope.response ?? {});
    if (!parsed.success) return;
    this.complete(requestId, op, true, { ok: true, value: valueOf(op.command, parsed.data) });
  }
}
