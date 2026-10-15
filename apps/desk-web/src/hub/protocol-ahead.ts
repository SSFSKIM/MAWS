// What the composite says and `desk-hub/protocol` does not type yet, read loosely here beside the module's types; each
// goes when the module carries it.
// - DC2's M3 (composite c0fb2ccd): a late decision is refused naming the side whose answer the engine used (`winner`),
//   and within 200 ms of a background request's deadline the refusal carries `terminalOnly: true`.
// - DC7's M2 (composite 6fa2252d): `delivery.outcome` may be `uncertain` (the frame was taken, never answered), and
//   `raised` may carry the asking subagent's `agentId` and `truncated: true` (the input shown was capped; the digest
//   covers the capped input as drawn).
import type { Delivery, JsonObject, Raised, RpcOutcome } from 'desk-hub/protocol';

export type DeliveryOutcome = Delivery['outcome'] | 'uncertain';

/** A delivery as DC7's M2 has it: the module's, with `uncertain` admitted. */
export type DeliveryAhead = Omit<Delivery, 'outcome'> & { outcome: DeliveryOutcome };

export const outcomeOf = (delivery: Delivery): DeliveryOutcome => (delivery as DeliveryAhead).outcome;

/** A raised request as DC7's M2 has it: the module's, with the asking subagent and the input's cap. */
export type RaisedAhead = Raised & { agentId?: string; truncated?: true };

export const raisedAgent = (raised: Raised): string | null => {
  const agentId = (raised as RaisedAhead).agentId;
  return typeof agentId === 'string' && agentId !== '' ? agentId : null;
};

export const raisedTruncated = (raised: Raised): boolean => (raised as RaisedAhead).truncated === true;

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
