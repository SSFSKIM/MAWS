// X2 `delivery.*` (P4-B5; docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.7 and P4-B5): the owner's Send to, main's
// alone, from the editor header's Send to and the library's Export menu. Two targets, no Claude turn for either: Notion
// through MAWS's own connection (route D, P3-HD), Drive through the gws CLI the owner installed, which keeps its own
// sign-in (MAWS holds no Google credential). A run is named by the window (`runId`) so it can be cancelled before it
// writes; a receipt is main's record of a delivery made, for this main's life (memory only), shown in the header and the
// library's row.
import * as z from 'zod';
import { ARTIFACT_EXPORT_FORMATS } from '../../maws/tools';
import type { CommandSpec } from './common';

const main = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'main' as const });

const ArtifactId = z.uuid();
const RunId = z.uuid();
const SourceKey = z.uuid(); // main's opaque handle of a located source, for this main's life
const Words = z.string().max(300); // a service's or the CLI's own message, bounded, for the owner's sheet
export const DeliveryTargetSchema = z.enum(['notion', 'drive']);
export const DeliveryDestinationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('default') }), // Notion: a private page in the workspace; Drive: My Drive's root
  z.strictObject({ kind: z.literal('inside'), id: z.string().min(10).max(128).regex(/^[A-Za-z0-9_-]+$/) }), // a page's or a folder's id
]);

// The Notion connector MAWS would send through: the server's name and where it is configured, never its entry.
const NotionSourceSchema = z.strictObject({ key: SourceKey, server: z.string().min(1).max(256), scope: z.enum(['user', 'local', 'app']), transport: z.enum(['stdio', 'http']), file: z.string().min(1).max(4096) });
// `ready`: sends now, through MAWS's own sign-in (`connection: connected`), a local server (`local`) or an open one
// (`open`); `signIn`, `reconnect`, `busy`: found, but the owner's Connect is needed first, its saved sign-in replaced, or
// one is under way; `none`: none MAWS can reach, no session running to report one (`why: noSession`) or none of their
// reports naming one (`notFound`); `unavailable`: route D or the engine host not answering. One object, not a union of
// four (every command's output is one union across the registry; e2e's typed `invoke` is at TypeScript's union bound).
export const NotionStatusSchema = z
  .strictObject({
    target: z.literal('notion'),
    state: z.enum(['ready', 'signIn', 'reconnect', 'busy', 'none', 'unavailable']),
    connection: z.enum(['connected', 'local', 'open']).optional(),
    source: NotionSourceSchema.optional(),
    why: z.enum(['noSession', 'notFound']).optional(),
  })
  .refine((status) => (status.state === 'ready') === (status.connection !== undefined) && ['ready', 'signIn', 'reconnect', 'busy'].includes(status.state) === (status.source !== undefined) && (status.state === 'none') === (status.why !== undefined), 'the fields of the Notion state');
// gws's own state as `gws auth status` reports it (src/main/delivery/gws.ts)
export const DriveStatusSchema = z.strictObject({
  target: z.literal('drive'),
  state: z.enum(['absent', 'needsSetup', 'signedOut', 'expired', 'noDrive', 'ready', 'failed']),
  user: z.string().max(320).optional(),
  message: Words.optional(),
});
export const DeliveryStatusSchema = z.union([NotionStatusSchema, DriveStatusSchema]);

export const DeliveryReceiptSchema = z.strictObject({
  artifactId: ArtifactId,
  target: DeliveryTargetSchema,
  at: z.number().int().nonnegative(), // epoch ms
  name: z.string().max(2_000), // what it arrived as: the page's or the file's name
  url: z.url().nullable(), // where it is, when the service said
  format: z.enum(ARTIFACT_EXPORT_FORMATS),
  revision: z.number().int().nonnegative(),
  versionId: z.number().int().positive().optional(),
  destination: DeliveryDestinationSchema,
});

// Why a run ended without a delivery. `maybeSent`: it ended after the request may have reached the service (a timeout
// or a broken exchange after the write), so the owner checks before sending again.
export const DELIVERY_FAILURES = [
  'cancelled', 'busy', 'export', 'deleted', 'tooLarge', // MAWS's side
  'none', 'signIn', 'reconnect', 'unauthorized', 'source', 'toolMissing', 'toolError', 'timeout', 'transport', 'unavailable', // Notion's route
  'absent', 'needsSetup', 'auth', 'notFound', 'forbidden', 'api', 'discovery', 'invalid', // gws
  'failed',
] as const;
export const DeliveryFailureSchema = z.enum(DELIVERY_FAILURES);
// One object each, as the Notion state (above): `ok` with the receipt, or the failure's fields.
export const DeliverySendAnswerSchema = z
  .strictObject({ ok: z.boolean(), receipt: DeliveryReceiptSchema.optional(), why: DeliveryFailureSchema.optional(), maybeSent: z.boolean().optional(), message: Words.optional() })
  .refine((answer) => (answer.ok ? answer.receipt !== undefined && answer.why === undefined : answer.receipt === undefined && answer.why !== undefined), 'a receipt, or why not');
// `source`: the handle the window named is no longer kept (its sheet re-reads the state).
export const DELIVERY_CONNECT_FAILURES = ['cancelled', 'timeout', 'refused', 'denied', 'busy', 'absent', 'needsSetup', 'none', 'source', 'unavailable', 'failed'] as const;
export const DeliveryConnectAnswerSchema = z
  .strictObject({ ok: z.boolean(), why: z.enum(DELIVERY_CONNECT_FAILURES).optional(), message: Words.optional() })
  .refine((answer) => answer.ok === (answer.why === undefined), 'ok, or why not');

export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;
export type NotionStatus = z.infer<typeof NotionStatusSchema>;
export type NotionSource = z.infer<typeof NotionSourceSchema>;
export type DriveStatus = z.infer<typeof DriveStatusSchema>;
export type DeliveryReceipt = z.infer<typeof DeliveryReceiptSchema>;
export type DeliveryFailure = (typeof DELIVERY_FAILURES)[number];
export type DeliverySendAnswer = z.infer<typeof DeliverySendAnswerSchema>;
export type DeliveryConnectAnswer = z.infer<typeof DeliveryConnectAnswerSchema>;
export type DeliveryConnectFailure = (typeof DELIVERY_CONNECT_FAILURES)[number];

export const commands = {
  // What the sheet shows for the target now: Notion's connector found through the live sessions' reports, or gws's state.
  'delivery.status': main(z.strictObject({ target: DeliveryTargetSchema, artifactId: ArtifactId }), DeliveryStatusSchema),
  // The owner's sign-in: Notion's Connect through MAWS's own OAuth (the browser's consent), or gws's own login (its URL
  // opened in the browser; the CLI keeps the sign-in). Answers when it ended; `delivery.cancel` ends it.
  'delivery.connect': main(z.strictObject({ runId: RunId, target: DeliveryTargetSchema, artifactId: ArtifactId, source: SourceKey.optional() }), DeliveryConnectAnswerSchema),
  // The delivery: the shown artifact (a version's when named; a design's PNG, the board shown) exported in `format`, then
  // put where `destination` says. A `source` handle main no longer keeps is refused (`source`), never found again.
  'delivery.send': main(
    z.strictObject({ runId: RunId, target: DeliveryTargetSchema, artifactId: ArtifactId, format: z.enum(ARTIFACT_EXPORT_FORMATS), versionId: z.number().int().positive().optional(), board: z.string().min(1).max(64).optional(), destination: DeliveryDestinationSchema, source: SourceKey.optional() }),
    DeliverySendAnswerSchema,
  ),
  // Ends a run that has not written yet (a send already sent is not called back); `cancelled`: it was running.
  'delivery.cancel': main(z.strictObject({ runId: RunId }), z.strictObject({ cancelled: z.boolean() })),
  // The latest receipt of each artifact and target, this main's life.
  'delivery.receipts': main(z.void(), z.strictObject({ receipts: z.array(DeliveryReceiptSchema).max(1_000) })),
} as const satisfies Record<`delivery.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  // main's, to every window: a delivery made
  'delivery.receipt': DeliveryReceiptSchema,
} as const satisfies Record<`delivery.${string}`, z.ZodType>;
