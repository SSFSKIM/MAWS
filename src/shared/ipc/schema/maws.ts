// X2 `maws.*` (P1 interface ledger §5; E1 execution document, Interfaces "IPC"): the renderer's side of the engine
// host's `maws` tool server. Owner `engine-host` for every command, each answered immediately from host state or at a
// flushed write. Pending asks are host memory (X13), listed and answered by command, never renderer state;
// `maws.pane.show` is the host's one-shot request that a window open a pane for `show_pane` (residue 3: an IPC event,
// never an X1 event, so a reload or a disk replay re-opens nothing), answered by `maws.pane.answer`, the first answer
// winning.
import * as z from 'zod';
import { AppSessionIdSchema, RequestIdSchema } from '../../graph/ids';
import { PendingAskSchema } from '../../maws/ask';
import { PaneSchema } from '../../maws/panes';
import { AskAnswerSchema, ShowPaneOpenedSchema } from '../../maws/tools';
import type { CommandSpec } from './common';

export const MawsPaneShowSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  requestId: RequestIdSchema, // the engine's `mcp_message` request the answer goes back to
  pane: PaneSchema,
  target: z.string().nullable(), // resolved against the session's cwd for `diff` and `file`, else as the model gave it
  line: z.number().int().nullable(),
});
export type MawsPaneShow = z.infer<typeof MawsPaneShowSchema>;

export const MawsPaneAnswerResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), opened: ShowPaneOpenedSchema }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);
export type MawsPaneAnswerResult = z.infer<typeof MawsPaneAnswerResultSchema>;

export const commands = {
  // The session's pending asks (none for a session this host does not hold).
  'maws.asks.list': { input: z.strictObject({ appSessionId: AppSessionIdSchema }), output: z.strictObject({ asks: z.array(PendingAskSchema) }), owner: 'engine-host' },
  // The human's answers to one ask: `delivered` once the answer's write settled, `not_pending` for an ask already
  // answered, being answered or unknown, `write_failed` when the write was refused (the ask stays pending).
  'maws.ask.answer': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema, askId: z.string(), answers: z.array(AskAnswerSchema) }),
    output: z.strictObject({ outcome: z.enum(['delivered', 'not_pending', 'write_failed']) }),
    owner: 'engine-host',
  },
  // A window's answer to `maws.pane.show`: `not_pending` when another window answered first or the call ended.
  'maws.pane.answer': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema, requestId: RequestIdSchema, result: MawsPaneAnswerResultSchema }),
    output: z.strictObject({ outcome: z.enum(['delivered', 'not_pending']) }),
    owner: 'engine-host',
  },
} as const satisfies Record<`maws.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'maws.pane.show': MawsPaneShowSchema,
} as const satisfies Record<`maws.${string}`, z.ZodType>;
