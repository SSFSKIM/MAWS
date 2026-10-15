// An RPC's outcome as the module types it (DX6): its failure (`RpcError`, which may name a late decision's `winner` and
// `by`, or carry `terminalOnly`), or its result.
import type { JsonObject, RpcError, RpcOutcome } from 'desk-hub/protocol';

export const failureOf = (outcome: RpcOutcome | undefined): RpcError | null => (outcome?.state === 'failed' ? outcome.error : null);

export const resultOf = (outcome: RpcOutcome | undefined): JsonObject | null => (outcome?.state === 'done' ? (outcome.result as unknown as JsonObject) : null);
