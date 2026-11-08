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
// P5 O8 M4b (the architect's Fork A): the door also takes `endpoint.grant {grant}` as an `endpoint.local.act`, with no
// step-up, the grant's own signature its authority (verified by the endpoint against its head before it runs), and
// answers `endpoint.local.grants`: the machine's grant ledger as its owners read it, every member the head lists with
// their grant in force (null: none) and their high-water mark (0: never granted), answered as a call's result. It is a
// command of its own, not another name `endpoint.local.call` takes: widening that command's `name` would change its
// input's `const`, a change only a wire major may carry (wire.ts), where a new command is additive.
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

/** A signed grant as the ledger keeps it (org-protocol's `Signed<Grant>`; a reader verifies it with `verifyGrant`). */
const SignedGrantSchema = z.strictObject({
  body: z.strictObject({
    org: z.string().min(1),
    machine: z.string().min(1),
    machineKey: z.string().min(1),
    member: z.string().min(1),
    rights: z.array(z.enum(['spawn', 'shell', 'machine-admin'])),
    version: z.number().int().positive(),
    issued: z.string().min(1),
  }),
  sig: z.strictObject({ kid: z.string().min(1), value: z.string().min(1) }),
});

/** One member's entry in the machine's grant ledger. */
export const GrantsEntrySchema = z.strictObject({ member: z.string().min(1), grant: SignedGrantSchema.nullable(), highWater: z.number().int().nonnegative() });
export type GrantsEntry = z.infer<typeof GrantsEntrySchema>;

/** `endpoint.grants`' answer: the entries the reader may read, in the head's member order. */
export const GrantsAnswerSchema = z.strictObject({ members: z.array(GrantsEntrySchema) });
export type GrantsAnswer = z.infer<typeof GrantsAnswerSchema>;

const CallFailedSchema = z.strictObject({ ok: z.literal(false), code: z.string().min(1) });

export const commands = {
  'endpoint.local.act': { input: z.strictObject({ action: z.record(z.string(), z.unknown()) }), output: LocalOutcomeSchema, owner: 'machine' }, // main-only
  'endpoint.local.call': {
    input: z.strictObject({ name: z.literal('record.policy'), input: z.strictObject({ session: RecordIdSchema.optional() }).nullable() }),
    output: z.union([z.strictObject({ ok: z.literal(true), output: RecordPolicyAnswerSchema }), CallFailedSchema]),
    owner: 'machine',
  }, // main-only
  'endpoint.local.grants': { input: z.void(), output: z.union([z.strictObject({ ok: z.literal(true), output: GrantsAnswerSchema }), CallFailedSchema]), owner: 'machine' }, // main-only (P5 O8 M4b)
} as const satisfies Record<`endpoint.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {} as const satisfies Record<`endpoint.${string}`, z.ZodType>;
