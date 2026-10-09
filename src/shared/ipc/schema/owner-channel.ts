// X2 `ownerChannel.*` (X18; the P2-C document, Design §5, §6 and Interfaces X2): main's owner channel. `state` answers a
// session's lane and its stored marks with their states, and `changed` carries the same whole on every change. The
// card's send goes through the seam (X22), and the renderer then reports the seam's result with `answered`, from which
// main follows the answer; `cancel` withdraws an answer still in the queue or still a pending steer; `markRead` reads
// essentials. All owned by main.
import * as z from 'zod';
import { AppSessionIdSchema, MessageUuidSchema } from '../../graph/ids';
import { MarkIdSchema } from '../../owner/marks';
import { AnswerOriginSchema, OwnerChannelStateSchema } from '../../owner/state';
import type { CommandSpec } from './common';

export const OwnerChannelAnsweredSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  markId: MarkIdSchema,
  text: z.string(), // the prompt the seam sent (`answerText(head, answer)`)
  origin: AnswerOriginSchema,
  disposition: z.enum(['sent', 'steered', 'queued', 'started', 'refused']), // the seam's result
  messageUuid: MessageUuidSchema.optional(), // `sent`, `steered` (and `started` once it carries one)
  queueId: z.string().optional(), // `queued` (and `started` once it carries one)
  reason: z.string().optional(), // `refused`
});

export const commands = {
  'ownerChannel.state': { input: z.strictObject({ appSessionId: AppSessionIdSchema }), output: OwnerChannelStateSchema, owner: 'main' },
  // An unknown question (no such mark of the session, or not a question) fails `internal`, naming it.
  'ownerChannel.answered': { input: OwnerChannelAnsweredSchema, output: z.void(), owner: 'main' },
  'ownerChannel.cancel': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema, markId: MarkIdSchema }),
    output: z.strictObject({ outcome: z.enum(['cancelled', 'already_delivering', 'not_queued']) }),
    owner: 'main',
  },
  'ownerChannel.markRead': { input: z.strictObject({ appSessionId: AppSessionIdSchema, markIds: z.union([z.array(MarkIdSchema), z.literal('all')]) }), output: z.void(), owner: 'main' },
} as const satisfies Record<`ownerChannel.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'ownerChannel.changed': z.strictObject({ appSessionId: AppSessionIdSchema, state: OwnerChannelStateSchema }),
} as const satisfies Record<`ownerChannel.${string}`, z.ZodType>;
