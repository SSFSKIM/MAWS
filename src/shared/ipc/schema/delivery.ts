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
const NotionSourceSchema = z.strictObject({ key: SourceKey, server: z.string().min(1).max(256), scope: z.enum(['user', 'local']), transport: z.enum(['stdio', 'http']), file: z.string().min(1).max(4096) });
export const NotionStatusSchema = z.union([
  // sends now: MAWS's own sign-in (`connected`), a local server (`local`) or an open one (`open`)
  z.strictObject({ target: z.literal('notion'), state: z.literal('ready'), connection: z.enum(['connected', 'local', 'open']), source: NotionSourceSchema }),
  // found, but the owner's Connect is needed first (`signIn`), its saved sign-in replaced (`reconnect`), or one is under way
  z.strictObject({ target: z.literal('notion'), state: z.enum(['signIn', 'reconnect', 'busy']), source: NotionSourceSchema }),
  // none MAWS can reach: no session is running to report one (`noSession`), or none of their reports names one
  z.strictObject({ target: z.literal('notion'), state: z.literal('none'), why: z.enum(['noSession', 'notFound']) }),
  z.strictObject({ target: z.literal('notion'), state: z.literal('unavailable') }), // route D or the engine host not answering
]);
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
export const DeliverySendAnswerSchema = z.union([
  z.strictObject({ ok: z.literal(true), receipt: DeliveryReceiptSchema }),
  z.strictObject({ ok: z.literal(false), why: DeliveryFailureSchema, maybeSent: z.boolean().optional(), message: Words.optional() }),
]);
export const DELIVERY_CONNECT_FAILURES = ['cancelled', 'timeout', 'refused', 'denied', 'busy', 'absent', 'needsSetup', 'none', 'unavailable', 'failed'] as const;
export const DeliveryConnectAnswerSchema = z.union([z.strictObject({ ok: z.literal(true) }), z.strictObject({ ok: z.literal(false), why: z.enum(DELIVERY_CONNECT_FAILURES), message: Words.optional() })]);

export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;
export type NotionStatus = z.infer<typeof NotionStatusSchema>;
export type DriveStatus = z.infer<typeof DriveStatusSchema>;
export type DeliveryReceipt = z.infer<typeof DeliveryReceiptSchema>;
export type DeliveryFailure = (typeof DELIVERY_FAILURES)[number];
export type DeliverySendAnswer = z.infer<typeof DeliverySendAnswerSchema>;
export type DeliveryConnectAnswer = z.infer<typeof DeliveryConnectAnswerSchema>;

export const commands = {
  // What the sheet shows for the target now: Notion's connector found through the live sessions' reports, or gws's state.
  'delivery.status': main(z.strictObject({ target: DeliveryTargetSchema, artifactId: ArtifactId }), DeliveryStatusSchema),
  // The owner's sign-in: Notion's Connect through MAWS's own OAuth (the browser's consent), or gws's own login (its URL
  // opened in the browser; the CLI keeps the sign-in). Answers when it ended; `delivery.cancel` ends it.
  'delivery.connect': main(z.strictObject({ runId: RunId, target: DeliveryTargetSchema, artifactId: ArtifactId, source: SourceKey.optional() }), DeliveryConnectAnswerSchema),
  // The delivery: the shown artifact (a version's when named) exported in `format`, then put where `destination` says.
  'delivery.send': main(
    z.strictObject({ runId: RunId, target: DeliveryTargetSchema, artifactId: ArtifactId, format: z.enum(ARTIFACT_EXPORT_FORMATS), versionId: z.number().int().positive().optional(), destination: DeliveryDestinationSchema, source: SourceKey.optional() }),
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
