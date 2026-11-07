// X2 `endpoint.*` (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b "The local door" and Interfaces
// §Q): the local door, through which this machine's own app reaches its own endpoint's record acts and their policy read,
// as `mawsd` serves it on its machine socket (src/mawsd/endpoint-seam.ts, `EndpointModule.local`). The app has no RL2
// channel to its own endpoint, so an act carries its authority in its step-up signature alone, which the endpoint checks
// every time before it authorizes the act as a channel's (src/endpoint/local-door.ts).
//   - `endpoint.local.act {action}`: an RL4 action, held to its exact shape by the endpoint (`isAction`), answered by its
//     outcome as RL4's `done` carries it (`{state: 'done', result}`, `failed`, `refused`, `unknown`), or the refusal that
//     stopped it before it ran (`{state: 'refused', reason}`). Only `record.access`, `record.shares` and `record.owners`
//     are taken.
//   - `endpoint.local.call {name: 'record.policy', input}`: the policies of the sessions the machine's owners own, or of
//     the one named, answered as RL3's `result` carries a call's (`{ok, output}` or `{ok: false, code}`).
import * as z from 'zod';
import type { CommandSpec } from './common';

const RecordIdSchema = z.string().min(1).max(512);

/** A session's general access (RL §6.2). */
export const RecordAccessSchema = z.enum(['private', 'listed', 'org-view', 'org-converse']);

/**
 * One session's policy as sminos's member frame carries it (`policyRev`, sminos's revision of it), or `unavailable`: no
 * frame says it (a record sminos can't read; a session not the owners').
 */
export const RecordPolicyEntrySchema = z.union([
  z.strictObject({ session: RecordIdSchema, access: RecordAccessSchema, shares: z.array(z.strictObject({ member: RecordIdSchema, grade: z.enum(['list', 'view', 'converse', 'approve']) })), policyRev: z.number().int().nonnegative() }),
  z.strictObject({ session: RecordIdSchema, unavailable: z.literal(true) }),
]);
export type RecordPolicyEntry = z.infer<typeof RecordPolicyEntrySchema>;

/** `record.policy`'s answer: `supported: false` while the machine's sminos can't keep a session's reach. */
export const RecordPolicyAnswerSchema = z.union([z.strictObject({ supported: z.literal(false) }), z.strictObject({ supported: z.literal(true), policies: z.array(RecordPolicyEntrySchema) })]);
export type RecordPolicyAnswer = z.infer<typeof RecordPolicyAnswerSchema>;

/** An act's outcome: its `state`, and what that state carries (`result`, `error`, `reason`). */
export const LocalOutcomeSchema = z.looseObject({ state: z.string().min(1) });
export type LocalOutcome = z.infer<typeof LocalOutcomeSchema>;

export const commands = {
  'endpoint.local.act': { input: z.strictObject({ action: z.record(z.string(), z.unknown()) }), output: LocalOutcomeSchema, owner: 'machine' }, // main-only
  'endpoint.local.call': {
    input: z.strictObject({ name: z.literal('record.policy'), input: z.strictObject({ session: RecordIdSchema.optional() }).nullable() }),
    output: z.union([z.strictObject({ ok: z.literal(true), output: RecordPolicyAnswerSchema }), z.strictObject({ ok: z.literal(false), code: z.string().min(1) })]),
    owner: 'machine',
  }, // main-only
} as const satisfies Record<`endpoint.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {} as const satisfies Record<`endpoint.${string}`, z.ZodType>;
