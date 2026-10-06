// X2 `side.*` (P1 interface ledger §5; E3 execution document, Interfaces "IPC" and Design §9): anchored comments and
// side questions. Main owns the two that launch or steer a session (`side.thread.open` forks the parent with the
// anchored first message and answers C10's StartOutcome, the child's id in it, as `session.fork` does;
// `side.sendToMain` steers or sends the parent the anchored comment); the engine host owns the side-question log
// (`session.sideQuestion` keeps its name and gains the log's `history`). The text caps are the security caps: what the
// renderer sends main is text to the model, and the one path main opens is the screenshot's, validated there.
import * as z from 'zod';
import { AnchorSchema, AnchorScreenshotSchema } from '../../anchor/anchor';
import { AppSessionIdSchema, MessageUuidSchema } from '../../graph/ids';
import { StartOutcomeSchema } from '../../sessions/setup';
import { SideExchangeSchema } from '../../side/question';
import type { CommandSpec } from './common';

// The caps, exported so a promotion clips its exchanges to them rather than being refused whole
export const SIDE_QUESTION_CAP = 20_000;
export const SIDE_ANSWER_CAP = 100_000;
const CommentTextSchema = z.string().max(SIDE_QUESTION_CAP);
// `response` is the engine's answer, capped as the renderer's every text is (M1's review); fifty of them can still exceed
// the 1 MiB send bound, so `side.thread.open` checks the built promotion against it before it launches anything
export const SideAnsweredExchangeSchema = z.strictObject({ question: CommentTextSchema, response: z.string().max(SIDE_ANSWER_CAP) });
export type SideAnsweredExchange = z.infer<typeof SideAnsweredExchangeSchema>;

// What a side thread opens from: a comment on an anchor (the composer's Side thread), or the answered `/btw`
// exchanges promoted ("Continue as a side thread") with what the human typed beside them.
export const SideThreadFromSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('comment'), anchor: AnchorSchema, text: CommentTextSchema, screenshot: AnchorScreenshotSchema.nullable() }),
  z.strictObject({ kind: z.literal('btw'), exchanges: z.array(SideAnsweredExchangeSchema).min(1).max(50), text: CommentTextSchema.nullable() }),
]);
export type SideThreadFrom = z.infer<typeof SideThreadFromSchema>;

export const SendToMainDispositionSchema = z.enum(['steered', 'sent', 'queued']);
export type SendToMainDisposition = z.infer<typeof SendToMainDispositionSchema>;

export const commands = {
  'side.thread.open': { input: z.strictObject({ appSessionId: AppSessionIdSchema, from: SideThreadFromSchema }), output: StartOutcomeSchema, owner: 'main' },
  // A turn running → a `next` steer; otherwise a send through the app queue (`queued` when it waits there). Refusals:
  // `invalid_input` naming the screenshot's reason, `internal` with the host's refusal verbatim.
  'side.sendToMain': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema, anchor: AnchorSchema, text: CommentTextSchema, screenshot: AnchorScreenshotSchema.nullable() }),
    output: z.strictObject({ messageUuid: MessageUuidSchema.nullable(), disposition: SendToMainDispositionSchema }),
    owner: 'main',
  },
  // The session's side questions, oldest first (none for a session this host does not hold).
  'side.question.list': { input: z.strictObject({ appSessionId: AppSessionIdSchema }), output: z.strictObject({ exchanges: z.array(SideExchangeSchema) }), owner: 'engine-host' },
  // A new side conversation: answered and failed exchanges go; pending ones stay, so their completions find them.
  'side.question.clear': { input: z.strictObject({ appSessionId: AppSessionIdSchema }), output: z.strictObject({}), owner: 'engine-host' },
} as const satisfies Record<`side.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {} as const satisfies Record<`side.${string}`, z.ZodType>;
