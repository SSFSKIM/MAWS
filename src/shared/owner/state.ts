// The owner channel's state as main reports it (X18; the P2-C document, Design §5, §6, §9): per session, the lane and
// the stored marks with their states. Main owns it (`ownerChannel.state`, `ownerChannel.changed`); the renderer draws it.
import * as z from 'zod';
import { AppSessionIdSchema } from '../graph/ids';
import { MarkAnchorSchema, MarkIdSchema } from './marks';

// The lane's per-session override, and what a launch's instructions came from (X20's `source`).
export const LaneOverrideSchema = z.enum(['inherit', 'on', 'off']);
export type LaneOverride = z.infer<typeof LaneOverrideSchema>;
export const ContractSourceSchema = z.enum(['maws-contract', 'external-compatible-style', 'off']);
export type ContractSource = z.infer<typeof ContractSourceSchema>;
// When a lane change reaches the instructions: the session's next launch, or its next compaction when the binary cannot
// re-render the recorded prompt (Design §2).
export const LanePendingSchema = z.enum(['next-launch', 'next-compaction']);
export type LanePending = z.infer<typeof LanePendingSchema>;
// The resolver's style name against the one the engine reported at `system/init` (Design §2, the mismatch check).
export const StyleMismatchSchema = z.strictObject({ resolved: z.string(), observed: z.string() });
export type StyleMismatch = z.infer<typeof StyleMismatchSchema>;

// An entry id or a message uuid that has carried an answer, and what the host's rows and the engine's lifecycle said of
// it (Design §6, "An answer's members").
export const AnswerMemberSchema = z.strictObject({ kind: z.enum(['entry', 'uuid']), id: z.string().min(1), life: z.enum(['alive', 'withdrawing', 'dead', 'unknown']) });
export type AnswerMember = z.infer<typeof AnswerMemberSchema>;

export const AnswerOriginSchema = z.enum(['answer', 'reply']);
export type AnswerOrigin = z.infer<typeof AnswerOriginSchema>;

export const QuestionStateSchema = z.discriminatedUnion('state', [
  // `failed` is main's in-memory note of the last refused send; it is not persisted.
  z.strictObject({ state: z.literal('unanswered'), failed: z.strictObject({ reason: z.string() }).optional() }),
  z.strictObject({ state: z.enum(['queued', 'unconfirmed']), text: z.string(), origin: AnswerOriginSchema, members: z.array(AnswerMemberSchema) }),
  z.strictObject({ state: z.literal('delivered'), answer: z.strictObject({ text: z.string(), origin: z.enum(['answer', 'reply', 'legacy']), at: z.string() }) }),
  z.strictObject({ state: z.literal('retired') }),
]);
export type QuestionState = z.infer<typeof QuestionStateSchema>;

export const OwnerMarkSchema = z.strictObject({
  id: MarkIdSchema,
  kind: z.enum(['need-input', 'essential']),
  anchor: MarkAnchorSchema,
  head: z.string(), // the mark's first line (`questionHead`)
  at: z.string(), // the message's time
  item: z.boolean(), // at or after the session's watermark: it may raise an attention item (Design §5)
  question: QuestionStateSchema.optional(), // set on a need-input mark
  essential: z.strictObject({ state: z.enum(['unread', 'read', 'retired']), readAt: z.string().nullable() }).optional(), // set on an essential mark
});
export type OwnerMark = z.infer<typeof OwnerMarkSchema>;

export const OwnerChannelStateSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  lane: z.strictObject({
    on: z.boolean(), // the effective lane: the override when set, else the app's switch
    override: LaneOverrideSchema,
    applied: ContractSourceSchema.nullable(), // the instructions in effect after the last decided launch; null before one
    pending: LanePendingSchema.nullable(),
    mismatch: StyleMismatchSchema.nullable(),
  }),
  marks: z.array(OwnerMarkSchema),
});
export type OwnerChannelState = z.infer<typeof OwnerChannelStateSchema>;
