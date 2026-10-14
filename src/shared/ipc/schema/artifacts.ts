// X2 `artifacts.*` (X23; the P3 interface ledger §1; docs/doperpowers/plans/2026-10-12-p3-a-store.md, M4 and Decision
// Log 1, 8, 13, 16, 22, 23, 25, 31): the engine host's artifact store as the renderer and main reach it. Every command
// but `artifacts.open` is the engine host's; `artifacts.open` is main's, which makes the document's MessageChannelMain,
// hands one end to the host and posts the other to the asking window (Decision Log 13), answering only the channel the
// window then awaits its port by. Every write the IPC makes is the human's (`{kind: 'human'}`): the host sets it, never
// the renderer. `artifacts.setDefaults` and `artifacts.content` are main's alone to send.
//
// A refusal the store can name (an artifact or version not found, an input it cannot take, the 16 MiB cap, a design
// system still in use, a read-only or unavailable store) answers an `IpcError` whose `issues` is an `ArtifactRefusal`:
// `invalid_input` for what the caller asked wrong, `internal` for the store's own state (`storeTooNew`, `unavailable`).
import * as z from 'zod';
import { ArtifactKindSchema, ArtifactSchema } from '../../artifacts/entity';
import { ArtifactVersionSchema } from '../../artifacts/version';
import { AppSessionIdSchema } from '../../graph/ids';
import { ARTIFACT_EXPORT_FORMATS, ARTIFACT_EXPORT_PAGE_SIZES, ARTIFACT_MAX_BYTES } from '../../maws/tools';
import type { IpcError } from '../errors';
import type { CommandSpec } from './common';

const host = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'engine-host' as const });
const main = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'main' as const });

const Id = z.uuid();
const Seq = z.number().int().nonnegative();
// The realm-local class each structured-clone hop produces (pty.ts's note), over any buffer (a Yjs encoder's included).
const Bytes = z.custom<Uint8Array>((value) => value instanceof Uint8Array, 'expected a Uint8Array');

// An artifact as the list and the commands answer it: the entity and its live revision (the global log seq of its last
// write; 0 for a document never written).
export const ArtifactRowSchema = ArtifactSchema.extend({ revision: Seq });
export type ArtifactRow = z.infer<typeof ArtifactRowSchema>;

export const ArtifactListFilterSchema = z.strictObject({
  kind: ArtifactKindSchema.optional(),
  spaceId: Id.optional(),
  appSessionId: AppSessionIdSchema.optional(), // linked to this session in any role
  pinned: z.boolean().optional(),
  deleted: z.boolean().optional(), // only the deleted ones (default: only the live ones)
});

// A byte kind's first content: an `html` page's bytes (≤ 16 MiB, `index.html` unless named), a `file` artifact's path.
export const ArtifactContentInputSchema = z.union([
  z.strictObject({ bytes: Bytes, name: z.string().min(1).max(255).optional() }),
  z.strictObject({ path: z.string().min(1) }),
]);

// The schema-agnostic test writer's operations, on a root type (`root` unless named). A setAttr value is a JSON value
// (P3-A M5): what JSON.stringify would drop or rewrite (`undefined`, a function, NaN, Infinity) is refused at any depth,
// since the detached JSON line would carry something else than was sent. The public type is one level deep and the rest
// `unknown`, since a recursive JSON type makes Playwright's typed `page.evaluate` over CommandInput infinitely deep
// (TS2589); the recursion is the runtime check below.
function isJsonValue(value: unknown, ancestors: Set<object> = new Set()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false; // undefined, function, bigint, symbol, a cycle
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) return false; // a Date, Map, typed array, class instance
  ancestors.add(value);
  const keys = Object.keys(value);
  const ok = (!isArray || keys.length === (value as unknown[]).length) && keys.every((key) => isJsonValue((value as Record<string, unknown>)[key], ancestors));
  ancestors.delete(value);
  return ok;
}
const TestValueSchema = z
  .union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.unknown()), z.record(z.string(), z.unknown())])
  .refine((value) => isJsonValue(value), 'expected a JSON value');
export const ArtifactTestOpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('setAttr'), key: z.string().min(1), value: TestValueSchema, root: z.string().min(1).optional() }),
  z.strictObject({ op: z.literal('insertText'), index: Seq, text: z.string(), root: z.string().min(1).optional() }),
  z.strictObject({ op: z.literal('deleteText'), index: Seq, length: z.number().int().positive(), root: z.string().min(1).optional() }),
  z.strictObject({ op: z.literal('page'), text: z.string().max(ARTIFACT_MAX_BYTES) }), // M7 fix wave 1: an html page's new content
]);

export const ARTIFACT_STORE_STATUSES = ['ok', 'readOnly', 'recovered', 'unavailable'] as const;

export const ArtifactsChangedSchema = z.strictObject({
  artifactId: Id,
  kind: ArtifactKindSchema,
  revision: Seq,
  change: z.enum(['created', 'updated', 'deleted', 'linked']),
});
export type ArtifactsChanged = z.infer<typeof ArtifactsChangedSchema>;

// What a store refusal carries in `IpcError.issues`.
// Which of an artifact's documents a replica opens or an attribution read covers (Decision Log 45): its suggestion doc,
// the artifact with its pending proposals on it; omitted, the artifact's own.
export const ArtifactDocSchema = z.enum(['suggestions']);
// A range of an artifact's suggestion doc (Decision Log 45): the ids of the items an editor's selection starts and ends
// at (`@y/prosemirror`'s `mapResolvedPositionsToRelativePositions`, `relStart.item` and `relEnd.item`).
const ItemIdSchema = z.strictObject({ client: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), clock: z.number().int().nonnegative() });
export const SuggestionRangeSchema = z.strictObject({ start: ItemIdSchema, end: ItemIdSchema });
const SuggestionRanges = z.array(SuggestionRangeSchema).min(1).max(1_000);

export const ARTIFACT_REFUSALS = ['notFound', 'invalid', 'tooLarge', 'handleTaken', 'designSystemInUse', 'storeTooNew', 'unavailable', 'exportUnavailable' /* M7 */] as const;
export const ArtifactRefusalSchema = z.strictObject({ reason: z.enum(ARTIFACT_REFUSALS), data: z.record(z.string(), z.unknown()) });
export type ArtifactRefusal = z.infer<typeof ArtifactRefusalSchema>;

// The refusal an IpcError carries, or null when it is not one of the store's (a timeout, an unavailable host).
export function artifactRefusalOf(error: IpcError): ArtifactRefusal | null {
  const parsed = ArtifactRefusalSchema.safeParse(error.issues);
  return parsed.success ? parsed.data : null;
}

const ArtifactAnswer = z.strictObject({ artifact: ArtifactRowSchema });

// The largest side of an exported picture, in CSS px (M7): within what an offscreen window renders.
export const EXPORT_SIZE_MAX = 8_192;

// An error or a warning an artifact's frame logged in an app window (M7; E2's `deliverables.console` until P3-L's
// cutover), main's, cut and rate-bounded. `revision` null: the frame showed the live content.
export const ARTIFACT_CONSOLE_MESSAGE_MAX = 2000; // main cuts a frame's console message and its source to this many characters
export const ArtifactConsoleSchema = z.strictObject({
  artifactId: Id,
  revision: Seq.nullable(),
  level: z.enum(['error', 'warning']),
  message: z.string().max(ARTIFACT_CONSOLE_MESSAGE_MAX),
  line: z.number().int().nullable(),
  source: z.string().max(ARTIFACT_CONSOLE_MESSAGE_MAX).nullable(),
});
export type ArtifactConsole = z.infer<typeof ArtifactConsoleSchema>;

export const commands = {
  'artifacts.list': host(z.strictObject({ filter: ArtifactListFilterSchema.optional() }), z.strictObject({ artifacts: z.array(ArtifactRowSchema) })),
  // null when there is no such artifact (or it is deleted and `includeDeleted` is not set)
  'artifacts.get': host(z.strictObject({ artifactId: Id, includeDeleted: z.boolean().optional() }), z.strictObject({ artifact: ArtifactRowSchema.nullable() })),
  // The human's create: a byte kind with its content, a document kind empty.
  'artifacts.create': host(
    z.strictObject({ kind: ArtifactKindSchema, title: z.string().min(1).max(1_000), spaceId: Id.optional(), designSystemId: Id.optional(), content: ArtifactContentInputSchema.optional() }),
    ArtifactAnswer,
  ),
  'artifacts.update': host(
    z.strictObject({
      artifactId: Id,
      title: z.string().min(1).max(1_000).optional(),
      spaceId: Id.nullable().optional(),
      pinned: z.boolean().optional(),
      designSystemId: Id.nullable().optional(),
      agentEditsAsSuggestions: z.boolean().optional(), // Decision Log 23g
    }),
    ArtifactAnswer,
  ),
  // A soft delete; a design system still governing a live artifact is refused `designSystemInUse {artifactIds}`.
  'artifacts.delete': host(z.strictObject({ artifactId: Id }), z.void()),
  // A copy of the live state, or of a version's ("Make a copy", Decision Log 23b).
  'artifacts.duplicate': host(z.strictObject({ artifactId: Id, versionId: z.number().int().positive().optional() }), ArtifactAnswer),
  // A title substring, until P3-L's index.
  'artifacts.search': host(z.strictObject({ query: z.string().min(1).max(1_000) }), z.strictObject({ artifacts: z.array(ArtifactRowSchema) })),
  'artifacts.versions': host(z.strictObject({ artifactId: Id }), z.strictObject({ versions: z.array(ArtifactVersionSchema) })),
  'artifacts.saveVersion': host(z.strictObject({ artifactId: Id, label: z.string().min(1).max(200), note: z.string().max(10_000).optional() }), z.strictObject({ versionId: z.number().int().positive() })),
  // Names an existing version, any kind (Decision Log 37d, 38c; §4.7: any automatic one is nameable): its label becomes
  // this, its note this one when given (`null` clears it, omitted keeps it), its kind stays, and a named `auto` version
  // is never thinned. Answers the version.
  'artifacts.nameVersion': host(
    z.strictObject({ artifactId: Id, versionId: z.number().int().positive(), label: z.string().min(1).max(200), note: z.string().max(10_000).nullable().optional() }),
    z.strictObject({ version: ArtifactVersionSchema }),
  ),
  // Artifact-wide restore (Decision Log 16): `versionId` the new `restore` version, `revision` the revert's.
  'artifacts.restore': host(z.strictObject({ artifactId: Id, versionId: z.number().int().positive() }), z.strictObject({ revision: Seq, versionId: z.number().int().positive() })),
  // The owner opened the artifact: an `auto` version first when it moved since its last one, then `lastViewedAt`.
  'artifacts.markViewed': host(z.strictObject({ artifactId: Id }), z.void()),
  // The owner's "Delete versions older than…" (epoch ms), one artifact or every one; pinned states are kept.
  'artifacts.pruneVersions': host(z.strictObject({ artifactId: Id.optional(), olderThan: Seq }), z.strictObject({ removed: z.number().int().nonnegative() })),
  // A version's V2 state (Decision Log 22c): by its id, or the latest version at a seq (a design-system pin's target).
  'artifacts.versionState': host(
    z.strictObject({ artifactId: Id, versionId: z.number().int().positive().optional(), seq: Seq.optional() }).refine((input) => (input.versionId === undefined) !== (input.seq === undefined), 'exactly one of versionId and seq'),
    z.strictObject({ bytes: Bytes }),
  ),
  // The merged attribution (an encoded ContentMap) of every row overlapping [fromSeq, toSeq] (Decision Log 23a).
  // `doc: 'suggestions'`: the suggestion doc's (who proposed what; Decision Log 45).
  'artifacts.attributions': host(z.strictObject({ artifactId: Id, fromSeq: Seq, toSeq: Seq, doc: ArtifactDocSchema.optional() }), z.strictObject({ bytes: Bytes })),
  // The owner accepts proposals (Decision Log 45): copied into the artifact as the human's write, credited to their
  // suggester; `revision` the artifact's after it. A range that takes words of an inserted block without the block is
  // refused `invalid {reason: 'partialBlock'}`; one naming no proposal, `invalid {range}`.
  'artifacts.acceptSuggestion': host(z.strictObject({ artifactId: Id, ranges: SuggestionRanges }), z.strictObject({ revision: Seq })),
  // The owner rejects proposals: proposed content leaves the suggestion doc; content a proposal deleted comes back.
  'artifacts.rejectSuggestion': host(z.strictObject({ artifactId: Id, ranges: SuggestionRanges }), z.strictObject({ revision: Seq })),
  // The human's asset upload (Decision Log 25l): content-addressed, deduplicated per artifact, ≤ 16 MiB.
  'artifacts.uploadAsset': host(
    z.strictObject({ artifactId: Id, name: z.string().min(1).max(255), mime: z.string().min(1).max(255), bytes: Bytes.refine((bytes) => bytes.length <= ARTIFACT_MAX_BYTES, `at most ${ARTIFACT_MAX_BYTES} bytes`) }),
    z.strictObject({ assetId: z.uuid(), ref: z.string() }),
  ),
  // The host's event-loop delay in ms since the last reset (Decision Log 23h); refused unless the host runs under MAWS_E2E=1.
  'artifacts.testLoopDelay': host(
    z.strictObject({ reset: z.boolean().optional() }),
    z.strictObject({ p50: z.number().nonnegative(), p99: z.number().nonnegative(), max: z.number().nonnegative(), mean: z.number().nonnegative() }),
  ),
  // Main's relay of the design-system defaults (Decision Log 22d): at every host connection and on every change. Main-only.
  'artifacts.setDefaults': host(z.strictObject({ owner: Id.nullable(), spaces: z.record(Id, Id) }), z.void()),
  // A byte kind's stored file (the `maws-artifact:` scheme, M7): the content at exactly `revision` (the latest when
  // omitted; `path`, when given, must be its name), or one of any artifact's assets by its ref (`assets/<name>`, whatever
  // the revision). `path` in the answer is absolute; `kind` is the artifact's (the scheme gives an `html` page the bridge
  // script). Main-only.
  'artifacts.content': host(
    z.strictObject({ artifactId: Id, revision: Seq.optional(), path: z.string().min(1).max(1_000).optional() }),
    z.strictObject({ revision: Seq, kind: ArtifactKindSchema, name: z.string(), size: z.number().int().nonnegative(), sha256: z.string(), path: z.string() }),
  ),
  // A document kind's live V2 state and the revision it is at (M7: an exporter's state when no version is named).
  // Main-only.
  'artifacts.state': host(z.strictObject({ artifactId: Id }), z.strictObject({ revision: Seq, bytes: Bytes })),
  // The artifact's assets, each by the ref a format names it with (`assets/<name>`), so an exporter can carry those its
  // content does not name (P3-D's request, Decision Log 45e). Main-only.
  'artifacts.assets': host(
    z.strictObject({ artifactId: Id }),
    z.strictObject({ assets: z.array(z.strictObject({ ref: z.string(), name: z.string(), mime: z.string(), size: z.number().int().nonnegative() })) }),
  ),
  // The store's health (Decision Log 12, 24h): `recovered` when a broken file was moved aside this run.
  'artifacts.status': host(z.void(), z.strictObject({ status: z.enum(ARTIFACT_STORE_STATUSES), reason: z.string().nullable() })),
  // The schema-agnostic test writer (M3), idempotent by `opId`, as the session named (an agent) or the human; refused
  // unless the host runs under MAWS_E2E=1.
  'artifacts.testWrite': host(
    z.strictObject({ artifactId: Id, opId: z.string().min(1).max(200), ops: z.array(ArtifactTestOpSchema).min(1).max(1_000), appSessionId: AppSessionIdSchema.optional() }),
    z.strictObject({ revision: Seq }),
  ),
  // A replica's port to the document (X24, Decision Log 13): main posts the port to the asking window on `maws:doc-port`
  // with this `channel`, and the host attaches the other end with the human as actor. Refused for a byte kind (`invalid`).
  // `doc: 'suggestions'` opens the artifact's suggestion doc (Decision Log 45).
  'artifacts.open': main(z.strictObject({ artifactId: Id, doc: ArtifactDocSchema.optional() }), z.strictObject({ channel: z.number().int().nonnegative().max(0xffff_ffff) })),
  // The library's Export (X31; M7): main's export service writes the artifact's live revision, or a version's, as
  // `format` under the store's directory (`<id>/exports/<revision>-<format>.<ext>`) and answers its path. `pageSize`
  // the paper (omitted: the exporter's default); a PNG is `width` CSS px wide (1280 when omitted) and `height` high (the
  // page's whole height when omitted). A kind and format no exporter serves is refused `exportUnavailable {kind, format}`.
  'artifacts.export': main(
    z.strictObject({
      artifactId: Id,
      format: z.enum(ARTIFACT_EXPORT_FORMATS),
      versionId: z.number().int().positive().optional(),
      pageSize: z.enum(ARTIFACT_EXPORT_PAGE_SIZES).optional(),
      width: z.number().int().min(16).max(EXPORT_SIZE_MAX).optional(),
      height: z.number().int().min(16).max(EXPORT_SIZE_MAX).optional(),
    }),
    // the snapshot exported (a document that moved since names a later revision); `blockedRequests`: remote requests the
    // PDF printer refused
    z.strictObject({ path: z.string(), revision: Seq, blockedRequests: z.number().int().positive().optional() }),
  ),
} as const satisfies Record<`artifacts.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'artifacts.changed': ArtifactsChangedSchema,
  // P3-A M5: emitted by main (never by the host) each time the engine host's connection starts streaming, in both
  // modes: the store's events emitted while no client was connected or ready are not replayed, so a view that mirrors
  // the store (P3-L's library) reads it afresh here. Its one reconcile hook.
  'artifacts.resync': z.strictObject({}),
  // P3-A M7: emitted by main, an artifact frame's console error or warning in an app window (`ArtifactConsoleSchema`).
  'artifacts.console': ArtifactConsoleSchema,
} as const satisfies Record<`artifacts.${string}`, z.ZodType>;
