// What the composite's Interfaces already say and `desk-hub/protocol` does not carry yet (merged at 0c87a259). Each
// shape here is read loosely, as the composite states it, and goes when the module carries it: switch to the module's
// type at the merge that brings it, never re-implement it beside the module's.
//
// - DX4 `compact` (composite 71e32c68): a session's compaction, outside subscriptions like `presence`.
// - DX6 results changed by DC2's M2 (composite 744eae81): `interrupt` → `{turnId, stopped, running}`, `model` →
//   `{model, effort}`; the module still types both as `{}`.
// - DX6 error codes the module lacks: `idle` (744eae81), `wrong-machine` and `unknown-project` (71e32c68); and the
//   refusal of a late decision naming its winner, with `terminalOnly` near a background request's deadline
//   (c0fb2ccd).
import type { JsonObject, RpcOutcome } from 'desk-hub/protocol';

/** DX4 `compact`: `rpc` the nonce of the web's `compact` RPC, or null when the session compacted on its own. */
export type CompactBody = { rpc: string | null; phase: 'start' | 'end'; tokensBefore?: number; tokensAfter?: number; skip?: boolean; error?: string };

export type CompactMessage = { project: string; machine: string; session: string; kind: 'compact'; sub: null; n: null; body: CompactBody };

export function asCompactMessage(message: { kind: string; session: unknown; body: unknown }): CompactMessage | null {
  if (message.kind !== 'compact' || typeof message.session !== 'string') return null;
  const body = message.body as Partial<CompactBody> | null;
  if (typeof body !== 'object' || body === null || (body.phase !== 'start' && body.phase !== 'end')) return null;
  return message as CompactMessage;
}

export type InterruptResult = { turnId: string | null; stopped: string[]; running: string[] };
export type ModelResult = { model: string | null; effort: string | null };

/** The failure an RPC came back with, read loosely: the code, the message, and a late decision's winner. */
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
