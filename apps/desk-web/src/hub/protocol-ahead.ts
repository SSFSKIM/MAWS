// What DC2's M3 relayed (composite c0fb2ccd) and `desk-hub/protocol` does not type: a late decision is refused naming
// the side whose answer the engine used (`winner`), and within 200 ms of a background request's deadline the refusal
// carries `terminalOnly: true`. Read loosely here beside the module's `RpcOutcome`; it goes when the module types it.
import type { JsonObject, RpcOutcome } from 'desk-hub/protocol';

/** The failure an RPC came back with: the module's code and message, and a late decision's winner. */
export type RpcFailure = { code: string; message: string; winner?: string; terminalOnly?: boolean };

export function failureOf(outcome: RpcOutcome | undefined): RpcFailure | null {
  if (!outcome || outcome.state !== 'failed') return null;
  const error = outcome.error as unknown as JsonObject;
  return {
    code: typeof error.code === 'string' ? error.code : 'failed',
    message: typeof error.message === 'string' ? error.message : '',
    ...(typeof error.winner === 'string' && { winner: error.winner }),
    ...(error.terminalOnly === true && { terminalOnly: true }),
  };
}

export function resultOf(outcome: RpcOutcome | undefined): JsonObject | null {
  return outcome?.state === 'done' ? (outcome.result as unknown as JsonObject) : null;
}
