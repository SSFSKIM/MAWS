// Bytes over RL2 (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5 "What crosses, as what"; §M's
// `rl2.bytes`). RL2 writes messages with plain JSON, which turns a `Uint8Array` into an object no schema takes, so a
// device that listed `rl2.bytes` carries bytes the way the machine-local socket does: json-bytes' tagged form
// (`{"$bytes": "<base64>"}`, a look-alike escaped as `{"$plain": …}`), a JSON value that travels unchanged through the
// signed canonical action and the ledgers' JSONL. The endpoint reads a call's `input` and an act's `args` decoded (the
// gate authorizes and validates the decoded copy; a call's executor dispatches it), forwards an act's `args` tagged as the
// op's `input` (the engine host's ledger decodes its own copy before its validation), and writes a call's `output` and an
// act's `result` tagged. A device that listed no `rl2.bytes` reads and writes as before: nothing here touches its messages.
import type { EndpointMessage } from 'org-protocol';
import { fromWire, toWire } from '@shared/host/json-bytes';

export const BYTES_CAPABILITY = 'rl2.bytes';

/** Whether the channel's device listed `rl2.bytes` in its handshake. */
export const carriesBytes = (channel: { readonly capabilities: readonly string[] }): boolean => channel.capabilities.includes(BYTES_CAPABILITY);

/** A call's `input` or an act's `args` as the device meant it: decoded when the device carries bytes. */
export function readBytes(channel: { readonly capabilities: readonly string[] }, value: unknown): unknown {
  return carriesBytes(channel) ? fromWire(value) : value;
}

/** A call's `output` as the device reads it: tagged when the device carries bytes. */
export function writeBytes(channel: { readonly capabilities: readonly string[] }, value: unknown): unknown {
  return carriesBytes(channel) ? toWire(value) : value;
}

/** An outcome (`done`'s, `queried`'s) with its `result` tagged when the device carries bytes. */
export function writeOutcome(channel: { readonly capabilities: readonly string[] }, outcome: unknown): unknown {
  if (!carriesBytes(channel) || typeof outcome !== 'object' || outcome === null || !('result' in outcome)) return outcome;
  return { ...outcome, result: toWire((outcome as { result: unknown }).result) };
}

/** `done {opId, outcome}`, its result written for the channel's device. */
export function doneMessage(channel: { readonly capabilities: readonly string[] }, opId: string, outcome: unknown): EndpointMessage {
  return { t: 'done', opId, outcome: writeOutcome(channel, outcome) };
}
