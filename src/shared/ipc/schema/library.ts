// X2 `library.*` (docs/doperpowers/plans/2026-10-12-p3-l-library.md, Decision Log 2 and 9; the P3 interface ledger's "L
// for the library reads"): the owner's library of artifacts. `library.list`, `library.get` and `library.spaces` are
// main's reads of its derived index (index version 9), never of the host's store; `library.changed` is main's, told
// once per tick after the index committed a change. `library.snapshot`, `library.entry` and `library.text` are the
// engine host's reads over its store that main rebuilds the index from (a reconciliation at every host connection, an
// entry per change event, the text when a row's revision moved past the indexed text's); they are main's alone to send.
// Writes stay `artifacts.*` and `spaces.*` (P3-A's).
import * as z from 'zod';
import { ActorSchema } from '../../artifacts/actor';
import { ArtifactKindSchema, ArtifactSessionLinkSchema, SpaceSchema } from '../../artifacts/entity';
import { AppSessionIdSchema, ProjectIdSchema } from '../../graph/ids';
import { ARTIFACT_EXPORT_FORMATS } from '../../maws/tools';
import { ArtifactRowSchema } from './artifacts';
import type { CommandSpec } from './common';

const host = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'engine-host' as const });
const main = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'main' as const });

const Id = z.uuid();
const Time = z.number().int().nonnegative();
const Seq = z.number().int().nonnegative();

// An artifact as the host's library reads answer it: the row and who last edited it, when (the actor and time of its
// last write; its creator and `createdAt` when there is none).
export const LibraryEntrySchema = ArtifactRowSchema.extend({ lastEditor: ActorSchema, lastEditedAt: Time });
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;

export const LibrarySnapshotSchema = z.strictObject({
  artifacts: z.array(LibraryEntrySchema), // every live artifact
  links: z.array(ArtifactSessionLinkSchema), // every live artifact's session links
  spaces: z.array(SpaceSchema),
});
export type LibrarySnapshot = z.infer<typeof LibrarySnapshotSchema>;

export const LibraryEntryAnswerSchema = z.strictObject({ artifact: LibraryEntrySchema.nullable(), links: z.array(ArtifactSessionLinkSchema) });
export type LibraryEntryAnswer = z.infer<typeof LibraryEntryAnswerSchema>;

// A session that touched an artifact: its title in main's index ('' when the index has no record of it), its roles and
// its last touch.
export const LibrarySessionSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  title: z.string(),
  roles: z.array(ArtifactSessionLinkSchema.shape.role),
  lastAt: Time,
});
export type LibrarySession = z.infer<typeof LibrarySessionSchema>;

// A row of the library: the entry, the last editor's title when it is a session (from main's index, linked to the
// artifact or not; '' when the index has no record of it), the sessions that touched it (by last touch, newest first),
// its Space and project by name, and, under a search, the matched passage of its text.
export const LibraryRowSchema = LibraryEntrySchema.extend({
  lastEditorTitle: z.string().optional(),
  sessions: z.array(LibrarySessionSchema),
  space: z.strictObject({ id: Id, name: z.string() }).optional(),
  project: z.strictObject({ id: ProjectIdSchema, name: z.string() }).optional(),
  snippet: z.string().optional(),
});
export type LibraryRow = z.infer<typeof LibraryRowSchema>;

// M6b: what one run of the X12 import did with every record under `<userData>/deliverables` (the engine host's
// `library/import.ts`): landed now, already an artifact, its file gone, or not a record or not landed.
export const DeliverablesImportSchema = z.strictObject({ imported: Seq, skipped: Seq, missing: Seq, failed: Seq });

export const LIBRARY_QUERY_MAX = 1_000;

export const LibraryFilterSchema = z.strictObject({
  kind: ArtifactKindSchema.optional(),
  spaceId: Id.nullable().optional(), // null: in no Space
  projectId: ProjectIdSchema.optional(), // the creating session's project (§4.1: filterable, never a Space)
  pinned: z.boolean().optional(),
  appSessionId: AppSessionIdSchema.optional(), // linked to this session in any role
  lineage: z.boolean().optional(), // with `appSessionId`: or to one of its side-thread ancestors (X9's scope)
  query: z.string().max(LIBRARY_QUERY_MAX).optional(), // titles and text; blank: no search
});
export type LibraryFilter = z.infer<typeof LibraryFilterSchema>;

// Per kind, the rows the same filter without `kind` would give (every kind present, 0 when none).
export const LibraryCountsSchema = z.record(ArtifactKindSchema, z.number().int().nonnegative());
export type LibraryCounts = z.infer<typeof LibraryCountsSchema>;

export const LibrarySpaceSchema = SpaceSchema.extend({ count: z.number().int().nonnegative() }); // its live artifacts
export type LibrarySpace = z.infer<typeof LibrarySpaceSchema>;

export const LibraryChangedSchema = z.strictObject({ revision: Seq }); // the index's library revision after the commit
export type LibraryChanged = z.infer<typeof LibraryChangedSchema>;

// M5b: a byte kind's stored file as the viewers name it (the scheme URL's last segment, the file a `file` artifact's
// code body reads), at a revision (the latest when omitted).
export const LibraryContentSchema = z.strictObject({ revision: Seq, kind: ArtifactKindSchema, name: z.string(), path: z.string() });
export type LibraryContent = z.infer<typeof LibraryContentSchema>;
const ContentAt = z.strictObject({ artifactId: Id, revision: Seq.optional() });

// M5b: what Save as… copies out of MAWS: a file `artifacts.export` wrote (its revision and format name it under the
// store's directory), or a byte kind's stored file at a revision (a File artifact's "Save a copy…").
export const LibrarySaveSourceSchema = z.union([
  z.strictObject({ export: z.strictObject({ revision: Seq, format: z.enum(ARTIFACT_EXPORT_FORMATS) }) }),
  z.strictObject({ content: z.strictObject({ revision: Seq.optional() }) }),
]);
export type LibrarySaveSource = z.infer<typeof LibrarySaveSourceSchema>;

export const commands = {
  // The rows the filter admits, by `updatedAt`, newest first, with the counts per kind.
  'library.list': main(z.strictObject({ filter: LibraryFilterSchema.optional() }), z.strictObject({ rows: z.array(LibraryRowSchema), counts: LibraryCountsSchema })),
  // One row, null when the index has no live artifact by that id.
  'library.get': main(z.strictObject({ artifactId: Id }), z.strictObject({ row: LibraryRowSchema.nullable() })),
  // Every Space, by name, with its count of live artifacts.
  'library.spaces': main(z.void(), z.strictObject({ spaces: z.array(LibrarySpaceSchema) })),
  // M5b (Decision Log 14): the export formats main's exporter registry serves for a kind, in ARTIFACT_EXPORT_FORMATS'
  // order (a format `artifacts.export` would refuse `exportUnavailable` is not listed).
  'library.exportFormats': main(z.strictObject({ kind: ArtifactKindSchema }), z.strictObject({ formats: z.array(z.enum(ARTIFACT_EXPORT_FORMATS)) })),
  // M5b: a byte kind's stored file at a revision, resolved by main through the host (`artifacts.content`).
  'library.content': main(ContentAt, LibraryContentSchema),
  // M5b: that file handed to the OS (a kind it opens as a document, never a program) or shown in Finder; a refusal is an
  // answer with its reason, as `files.openExternal` and `files.reveal` answer.
  'library.openExternally': main(ContentAt, z.strictObject({ opened: z.boolean(), message: z.string().nullable() })),
  'library.reveal': main(ContentAt, z.strictObject({ revealed: z.boolean(), message: z.string().nullable() })),
  // M5b: the native save dialog at ~/Downloads/<the artifact's title or the file's name>, the source copied to the
  // chosen path (a temporary file beside it renamed over it); `saved: false` when the dialog was cancelled.
  'library.saveAs': main(
    z.strictObject({ artifactId: Id, source: LibrarySaveSourceSchema }),
    z.discriminatedUnion('saved', [z.strictObject({ saved: z.literal(true), path: z.string() }), z.strictObject({ saved: z.literal(false) })]),
  ),
  // The host's live set, read behind the store's commit barrier. Main-only.
  'library.snapshot': host(z.void(), LibrarySnapshotSchema),
  // One artifact and its links; null (with no links) when it is gone or deleted. Main-only.
  'library.entry': host(z.strictObject({ artifactId: Id }), LibraryEntryAnswerSchema),
  // An artifact's searchable text at its current revision. Main-only.
  'library.text': host(z.strictObject({ artifactId: Id }), z.strictObject({ revision: Seq, text: z.string() })),
  // M6b, e2e only (refused unless the engine host runs under MAWS_E2E=1): the X12 import the host runs at store open, run
  // again now, so a test's seeded pre-P3 records land as they would at the next start. The counts cover the directory.
  'library.testImport': host(z.void(), DeliverablesImportSchema),
} as const satisfies Record<`library.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'library.changed': LibraryChangedSchema,
} as const satisfies Record<`library.${string}`, z.ZodType>;
