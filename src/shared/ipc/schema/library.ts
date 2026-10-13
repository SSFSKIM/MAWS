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

// A row of the library: the entry, the sessions that touched it (by last touch, newest first), its Space and project by
// name, and, under a search, the matched passage of its text.
export const LibraryRowSchema = LibraryEntrySchema.extend({
  sessions: z.array(LibrarySessionSchema),
  space: z.strictObject({ id: Id, name: z.string() }).optional(),
  project: z.strictObject({ id: ProjectIdSchema, name: z.string() }).optional(),
  snippet: z.string().optional(),
});
export type LibraryRow = z.infer<typeof LibraryRowSchema>;

export const LIBRARY_QUERY_MAX = 1_000;

export const LibraryFilterSchema = z.strictObject({
  kind: ArtifactKindSchema.optional(),
  spaceId: Id.nullable().optional(), // null: in no Space
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

export const commands = {
  // The rows the filter admits, by `updatedAt`, newest first, with the counts per kind.
  'library.list': main(z.strictObject({ filter: LibraryFilterSchema.optional() }), z.strictObject({ rows: z.array(LibraryRowSchema), counts: LibraryCountsSchema })),
  // One row, null when the index has no live artifact by that id.
  'library.get': main(z.strictObject({ artifactId: Id }), z.strictObject({ row: LibraryRowSchema.nullable() })),
  // Every Space, by name, with its count of live artifacts.
  'library.spaces': main(z.void(), z.strictObject({ spaces: z.array(LibrarySpaceSchema) })),
  // The host's live set, read behind the store's commit barrier. Main-only.
  'library.snapshot': host(z.void(), LibrarySnapshotSchema),
  // One artifact and its links; null (with no links) when it is gone or deleted. Main-only.
  'library.entry': host(z.strictObject({ artifactId: Id }), LibraryEntryAnswerSchema),
  // An artifact's searchable text at its current revision. Main-only.
  'library.text': host(z.strictObject({ artifactId: Id }), z.strictObject({ revision: Seq, text: z.string() })),
} as const satisfies Record<`library.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'library.changed': LibraryChangedSchema,
} as const satisfies Record<`library.${string}`, z.ZodType>;
