// The OperationTable (C3 execution document, Interfaces "Deadlines and operations", M5): the five X2 commands whose
// engine round trip is a `long` control answer a receipt `{ opId }` as soon as the request frame is flushed (`opId` is
// the minted request id, so the journal correlates it) and complete through `session.operation` exactly once: the typed
// value, the engine's error, the 120 s deadline, a failed write, or the process's exit. A success that arrives inside the
// control client's 60 s late table after the deadline completes a second time with `late: true`, which is how a
// consumer that showed the failure reconciles. Completions are emitted a macrotask later, so a completion never
// overtakes the receipt on the port (the runtime posts the command's answer from the handler's microtask chain).
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { OperationCommand, OperationError, OperationEvent } from '@shared/engine/operations';
import { CONTROLS, type OutboundRequest, type OutboundSubtype } from './controls';
import { ControlError, LATE_TABLE_MS, type ControlClient, type LateResponse } from './rpc';

export type OperationSubtype = Extract<OutboundSubtype, 'generate_session_title' | 'reload_plugins' | 'side_question' | 'mcp_reconnect' | 'mcp_toggle'>;

interface Open {
  appSessionId: AppSessionId;
  command: OperationCommand;
  subtype: OperationSubtype;
}

// The two MCP commands carry no value: their effect is visible in `session.status.mcpServers`.
const valueOf = (command: OperationCommand, response: unknown): Extract<OperationEvent['outcome'], { ok: true }>['value'] =>
  command === 'session.mcpReconnect' || command === 'session.mcpToggle' ? null : (response as { title: string } | { text: string } | Record<string, unknown>);

function operationError(error: unknown): OperationError {
  if (error instanceof ControlError) {
    if (error.code === 'timeout' || error.code === 'write_failed' || error.code === 'exited') return { code: error.code, message: error.message, engineCode: null };
    return { code: 'engine_error', message: error.message, engineCode: error.code };
  }
  return { code: 'engine_error', message: error instanceof Error ? error.message : String(error), engineCode: null };
}

export class OperationTable {
  private readonly timedOut = new Map<string, Open>(); // awaiting a late success, for as long as the client's late table keeps the id
  private readonly hooked = new WeakSet<ControlClient>();

  constructor(private readonly emit: (event: OperationEvent) => void) {}

  // Writes the request; resolves the receipt at the flushed write (or, when the write never happened, as soon as the
  // failure names the minted id, so every operation is correlated by the completion that follows).
  start<S extends OperationSubtype>(appSessionId: AppSessionId, command: OperationCommand, client: ControlClient, subtype: S, payload: OutboundRequest<S>): Promise<{ opId: string }> {
    this.hookLate(client);
    const op: Open = { appSessionId, command, subtype };
    return new Promise((resolve, reject) => {
      let opId: string | null = null;
      client
        .request(subtype, payload, { onWritten: (id) => resolve({ opId: (opId = id) }) })
        .then(
          (response) => this.complete(opId!, op, false, { ok: true, value: valueOf(command, response) }),
          (error: unknown) => {
            if (opId === null) {
              if (!(error instanceof ControlError)) return reject(error);
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
    setTimeout(() => this.emit(event), 0); // after the receipt's answer, which the runtime posts from microtasks
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
