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
import { BrowserTabIdSchema } from '../../browser/tab'; // E13
import { AbsolutePathSchema } from './settings'; // E13

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

// E2 start (E2 execution document, Design §7): `artifact_screenshot`'s capture bridge. The host cannot render, so it asks
// main once (`maws.artifact.capture`, an IPC event no window acts on) and main answers through `maws.artifact.captured`
// with a base64 PNG and the console errors the page logged while loading, or the reason it could not capture; the host
// gives up after CAPTURE_ANSWER_MS.
export const MawsArtifactCaptureSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  requestId: RequestIdSchema, // the engine's `mcp_message` request the answer goes back to
  deliverableId: z.uuid(),
  version: z.number().int().min(1),
  width: z.number().int(),
  height: z.number().int(),
  // P2-E1 (D10): the record's session when it is the requesting side thread's ancestor; absent, `appSessionId`'s own.
  // The answer still goes to `appSessionId`, whose call waits for it.
  ownerAppSessionId: AppSessionIdSchema.optional(),
});
export type MawsArtifactCapture = z.infer<typeof MawsArtifactCaptureSchema>;

export const MawsArtifactCapturedResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), png: z.string(), width: z.number().int(), height: z.number().int(), consoleErrors: z.array(z.string()) }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);
export type MawsArtifactCapturedResult = z.infer<typeof MawsArtifactCapturedResultSchema>;
// E2 end

// E13 start (the in-app browser spec of 2026-10-08 in the cua repository, "Downloads"): a file an agent downloaded through
// cua finished in ~/Downloads; main asks the session's engine host to record it as a file deliverable, once per path. The
// host writes through its DeliverableWriter (which announces the change) and answers `duplicate` for a path it recorded
// already, `not_held` for a session it does not hold. `url` is where the file came from; `bytes` its size on disk.
export const MawsDownloadRecordedSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  tabId: BrowserTabIdSchema,
  path: AbsolutePathSchema,
  filename: z.string().min(1),
  url: z.string(),
  bytes: z.number().int().min(0),
});
export type MawsDownloadRecorded = z.infer<typeof MawsDownloadRecordedSchema>;
// E13 end

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
  // E2 start: main's answer to `maws.artifact.capture`: `not_pending` when the call ended or was answered already.
  'maws.artifact.captured': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema, requestId: RequestIdSchema, result: MawsArtifactCapturedResultSchema }),
    output: z.strictObject({ outcome: z.enum(['delivered', 'not_pending']) }),
    owner: 'engine-host',
  },
  // E2 end
  // E13: main's report of an agent's finished download (once per path)
  'maws.download.recorded': { input: MawsDownloadRecordedSchema, output: z.strictObject({ outcome: z.enum(['recorded', 'duplicate', 'not_held']) }), owner: 'engine-host' },
} as const satisfies Record<`maws.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'maws.pane.show': MawsPaneShowSchema,
  'maws.artifact.capture': MawsArtifactCaptureSchema, // E2
} as const satisfies Record<`maws.${string}`, z.ZodType>;
