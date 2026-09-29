// What `session.answer` carries (charter §4.6; C3 execution document, Interfaces "Broker"): one discriminated answer
// per broker item kind, which the engine host's PermissionBroker turns into the wire response. Strict: an app shape.
import * as z from 'zod';
import { PLAN_OUTCOMES } from '../graph/enums';

export const RequestAnswerSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('permission'),
      decision: z.enum(['allow', 'deny', 'deny_and_stop']),
      scope: z.enum(['once', 'session', 'local_settings']).optional(),
      updatedInput: z.unknown().optional(),
      message: z.string().optional(),
    })
    // C5's hover card sends `{ kind: 'permission', decision: 'deny' }` (ledger d.17): a denial has no scope
    .refine((a) => (a.decision === 'allow') === (a.scope !== undefined), { path: ['scope'], message: 'scope is required for allow and absent for deny' }),
  z.strictObject({ kind: z.literal('question'), answers: z.record(z.string(), z.string()) }), // keyed by question text; multi-select joined ', '
  z.strictObject({ kind: z.literal('plan'), outcome: z.enum(PLAN_OUTCOMES), feedback: z.string().nullable() }),
  z.strictObject({ kind: z.literal('dialog'), behavior: z.enum(['completed', 'cancelled']), result: z.unknown().optional() }),
  z.strictObject({ kind: z.literal('elicitation'), action: z.enum(['accept', 'decline', 'cancel']), content: z.unknown().optional() }),
]);
export type RequestAnswer = z.infer<typeof RequestAnswerSchema>;
