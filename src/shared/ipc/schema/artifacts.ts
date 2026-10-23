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
import { ARTIFACT_EXPORT_FONTS /* P3-C */, ARTIFACT_EXPORT_FORMATS, ARTIFACT_EXPORT_PAGE_SIZES, ARTIFACT_MAX_BYTES } from '../../maws/tools';
import type { IpcError } from '../errors';
import { JsonValueSchema, type CommandSpec } from './common';
import { ConnectorDatasetSinkSchema /* E3 */, ConnectorGrantGestureSchema, ConnectorGrantSchema, ConnectorToolRefSchema } from '../../artifacts/connectors'; // P3-H H3b
import { ConnectorGrantOutcomeSchema } from './connectors'; // P3-H H3b

const host = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'engine-host' as const });
const main = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'main' as const });

const Id = z.uuid();
// E3: the snapshot refs one hold names (an artifact's own assets, `assets/<name>`), 1 to 64 (ASSET_HOLD_LIMITS.groupRefs)
const HoldRefs = z.array(z.string().startsWith('assets/').max(1_000)).min(1).max(64);
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
// (TS2589); the recursion is the runtime check (`JsonValueSchema`, common.ts).
export const ArtifactTestOpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('setAttr'), key: z.string().min(1), value: JsonValueSchema, root: z.string().min(1).optional() }),
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

export const ARTIFACT_REFUSALS = ['notFound', 'invalid', 'tooLarge', 'handleTaken', 'designSystemInUse', 'storeTooNew', 'unavailable', 'exportUnavailable' /* M7 */, 'exportTooLarge' /* P3-E (E1 M5; Decision Log 26): {board, w, h, maxScale} */] as const;
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
  // null when there is no such artifact (or it is deleted and `includeDeleted` is not set). P3-E (docs/doperpowers/plans/
  // 2026-10-16-p3-e-design-dashboard.md Decision Log 21 and 22): a live document an earlier build stored in another
  // shape is migrated first, as the human, or the read refused naming why; `prepare: false` (the default is true) reads
  // the row alone, for a caller that then reads a retained version and never the live document
  'artifacts.get': host(z.strictObject({ artifactId: Id, includeDeleted: z.boolean().optional(), prepare: z.boolean().optional() /* P3-E */ }), z.strictObject({ artifact: ArtifactRowSchema.nullable() })),
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
  // P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, Decision Log 25; the parent's 65): one artifact's asset
  // copied into another by the store, the human the actor: the source's bytes written through the upload path on the
  // target (content-addressed, so identical bytes answer the target's existing ref and a name is made unique there);
  // both artifacts live, a deleted or missing one refused by name.
  'artifacts.copyAsset': host(z.strictObject({ from: Id, ref: z.string().min(1).max(1_000), to: Id }), z.strictObject({ assetId: z.uuid(), ref: z.string() })),
  // P3-E (docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md M2; ledger X23 as amended by E's Decision Log 8): one
  // page of a dataset snapshot, the asset `ref` read as `format` (the displayed or exported descriptor's: one ref may
  // be bound as two formats), parsed by the host. At most `limit` rows (≤ 2,000, DATASET_READ_MAX_ROWS) and 1 MiB of
  // JSON; the caller continues at `offset` plus the rows answered. A ref the artifact does not hold is `notFound`, a
  // snapshot that does not read as the format `invalid {line?}`, a single row larger than a page `tooLarge`.
  'artifacts.readDataset': host(
    z.strictObject({ artifactId: Id, ref: z.string().min(1).max(1_000), format: z.enum(['csv', 'tsv', 'json']), offset: Seq.optional(), limit: z.number().int().min(1).max(2_000).optional() }),
    z.strictObject({
      columns: z.array(z.strictObject({ name: z.string(), type: z.enum(['string', 'number', 'boolean', 'date', 'null']), mismatches: z.number().int().positive().optional() })),
      rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
      total: Seq,
      truncated: z.boolean(),
    }),
  ),
  // Local file origins remain in the host. Checks never alter the document; rereads are explicit human writes,
  // guarded by the dataset's change revision and captured as a new attributed version.
  'artifacts.datasetFiles': host(
    z.strictObject({ artifactId: Id }),
    z.strictObject({ revision: Seq, files: z.array(z.strictObject({ id: z.string(), ref: z.string(), state: z.enum(['current', 'changed', 'unavailable']) })) }),
  ),
  'artifacts.rereadDatasetFile': host(
    z.strictObject({ artifactId: Id, id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), baseRevision: Seq }),
    z.strictObject({ revision: Seq, versionId: z.number().int().positive() }),
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
  // content does not name (P3-D's request, Decision Log 45e). Main-only. P4 (W1, L245 and L160): `versionId`, only the
  // assets that version pinned (its `assetRefs`), so a retained version's export carries none uploaded after it; an
  // unknown version is notFound.
  'artifacts.assets': host(
    z.strictObject({ artifactId: Id, versionId: z.number().int().positive().optional() }),
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
  // P3-E (E1 M5; X23, the parent's Decision Log 26): a design's `board` (its PNG's one board), `boards` (its PDF's pages)
  // and `scale` (0.1 to 4); a PNG over the picture cap is refused `exportTooLarge {board, w, h, maxScale}`.
  // P3-H (P3 Decision Log 91, the X31 `ownFile` row): `ownFile`, or a design's export (E's Decision Log 33), is a file
  // of its own: main mints `exportId` before it renders, names the file `<revision>-<format>-<exportId>.<ext>` and
  // answers the id beside its path, so no later export of the same revision and format replaces it. It lives under the
  // artifact's export storage as the cache files do. P4 (W1, L302): Send to sets it, and so do the header exports
  // (deck, document, dashboard), the HTML viewer's Export and the library's, each saving its file by `exportId`.
  'artifacts.export': main(
    z.strictObject({
      artifactId: Id,
      format: z.enum(ARTIFACT_EXPORT_FORMATS),
      versionId: z.number().int().positive().optional(),
      pageSize: z.enum(ARTIFACT_EXPORT_PAGE_SIZES).optional(),
      fonts: z.enum(ARTIFACT_EXPORT_FONTS).optional(), // P3-C: a presentation's PPTX faces (omitted: named)
      width: z.number().int().min(16).max(EXPORT_SIZE_MAX).optional(),
      height: z.number().int().min(16).max(EXPORT_SIZE_MAX).optional(),
      board: z.string().min(1).max(64).optional(), // P3-E
      boards: z.array(z.string().min(1).max(64)).max(200).optional(), // P3-E
      scale: z.number().min(0.1).max(4).optional(), // P3-E
      ownFile: z.literal(true).optional(), // P3-H (Decision Log 91)
    }),
    // the snapshot exported (a document that moved since names a later revision); `blockedRequests`: remote requests the
    // PDF printer refused; `exportId`: the id of an export of its own file, the one `library.saveAs` names it by (P3-E,
    // E's Decision Log 33; P3-H, Decision Log 91)
    z.strictObject({ path: z.string(), revision: Seq, blockedRequests: z.number().int().positive().optional(), exportId: z.uuid().optional(), commentAuthorName: z.string().min(1).optional() }),
  ),
  // P3-E (docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md M3; ledger X23 as amended by E's Decision Log 18): a
  // dashboard's source sheet Download. Main resolves the artifact's own asset `ref` through `artifacts.content` (a ref
  // it does not hold is `notFound`), shows Save under Downloads suggesting `name` (the displayed descriptor's source
  // name, cut to a basename) and copies the bytes; `path` null when the owner cancels. The renderer fetches no bytes.
  'artifacts.downloadAsset': main(
    z.strictObject({ artifactId: Id, ref: z.string().startsWith('assets/').max(1_000), name: z.string().min(1).max(1_000).optional() }),
    z.strictObject({ path: z.string().nullable() }),
  ),
  // P3-H H3b start: the owner's connector grants from the editor header (the P3 interface ledger's X23 grant rows), main's:
  // a grant is taken under the fingerprint the route reports now (the gesture carries none), refused when no route has
  // the tool or a read grant is asked for a tool the route does not mark read-only; a revoke stops the tool's work in
  // flight before the store is asked (src/main/connectors/broker.ts).
  'artifacts.connectorGrants': main(z.strictObject({ artifactId: Id }), z.strictObject({ grants: z.array(ConnectorGrantSchema) })),
  'artifacts.grantConnectorTool': main(z.strictObject({ artifactId: Id, tool: ConnectorGrantGestureSchema }), ConnectorGrantOutcomeSchema),
  'artifacts.revokeConnectorTool': main(z.strictObject({ artifactId: Id, ...ConnectorToolRefSchema.shape }), z.strictObject({ revoked: z.boolean() })),
  // P3-H H3b end
  // E3 start (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b; E's Decision Log 48 (3); the ledger's E3
  // hold-IPC row): holds over a dashboard's snapshot bytes, so a reader that captured a descriptor reads the bytes it
  // names whatever a refresh retires meanwhile. A hold is all or none and bounded per artifact (64 holds, 256 distinct
  // refs, 64 refs in one: `tooLarge {hold, limit}`); a ref the artifact no longer holds is `notFound {ref,
  // snapshotUnavailable: true}`, nothing held. Main-only, the host's holds are main's connection's: its going releases
  // them, and an id it did not mint releases nothing (`released: false`).
  // The export's capture: the live state (or `versionId`'s) and one hold over every snapshot its descriptors name, in one
  // host read; the export releases `assetHoldId` when it ends. Main-only.
  'artifacts.captureDatasetState': host(z.strictObject({ artifactId: Id, versionId: z.number().int().positive().optional() }), z.strictObject({ revision: Seq, bytes: Bytes, assetHoldId: z.uuid() })),
  // Main's own hold over `refs` (a window's handle below, a Download's own). Main-only.
  'artifacts.holdAssets': host(z.strictObject({ artifactId: Id, refs: HoldRefs }), z.strictObject({ assetHoldId: z.uuid() })),
  'artifacts.releaseAssets': host(z.strictObject({ assetHoldId: z.uuid() }), z.strictObject({ released: z.boolean() })),
  // A window's hold (the source sheet's captured snapshots, the painted cache's): main takes the host's hold and answers
  // an unforgeable handle bound to the asking window, which alone releases it; the window's closing, navigating or
  // crashing releases it too. Main's.
  'artifacts.holdDatasets': main(z.strictObject({ artifactId: Id, refs: HoldRefs }), z.strictObject({ holdId: z.uuid() })),
  'artifacts.releaseDatasets': main(z.strictObject({ holdId: z.uuid() }), z.strictObject({ released: z.boolean() })),
  // An agent's pending `artifact_dataset` refresh (R3), read by main once `maws.artifact.datasetRefresh` named it: the
  // dashboard, the dataset and the base the session read it at, the asking session, and the query its descriptor names
  // (the tool and its arguments). Null once the request ended or for an id the host never issued. Main-only.
  'artifacts.datasetRefreshRequest': host(
    z.strictObject({ requestId: z.uuid() }),
    z.strictObject({
      request: z
        .strictObject({ artifactId: Id, datasetId: ConnectorDatasetSinkSchema.shape.id, baseRevision: Seq, appSessionId: AppSessionIdSchema, ...ConnectorToolRefSchema.shape, args: z.record(z.string(), z.unknown()) })
        .nullable(),
    }),
  ),
  // E3 end
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
