// X9's listed artifact (P3-A M6; P3-F wave S F5's Space fields): the row `artifact_list` answers, and the base of
// `artifact_search`'s hit (P4-B4). A leaf so `./tools` and `./search-tools` both import it without importing each other
// (the pattern of `./artifact-id`); `./tools` re-exports it.
import * as z from 'zod';
import { ArtifactKindSchema } from '../artifacts/entity';
import { AppSessionIdSchema } from '../graph/ids';

const IsoTimeSchema = z.string();

// Who wrote an artifact last: the user, the calling session, or another session (named).
export const ArtifactEditorSchema = z.strictObject({ by: z.enum(['user', 'this session', 'another session']), appSessionId: AppSessionIdSchema.optional(), at: IsoTimeSchema });
export type ArtifactEditor = z.infer<typeof ArtifactEditorSchema>;
export const ListedArtifactSchema = z.strictObject({
  id: z.uuid(), handle: z.string().optional(), kind: ArtifactKindSchema, title: z.string(), revision: z.number().int().min(0), updatedAt: IsoTimeSchema,
  lastEditor: ArtifactEditorSchema.nullable(),
  spaceId: z.uuid().optional(), spaceName: z.string().optional(), // F5 (obs 6): the Space it is in
});
export type ListedArtifact = z.infer<typeof ListedArtifactSchema>;
