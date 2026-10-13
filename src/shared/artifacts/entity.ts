// X23, the artifact entity (docs/doperpowers/plans/2026-10-12-p3-co-work.md §4.1 and §6; the P3 interface ledger §1):
// an artifact, a Space and a session's link to an artifact, as the engine host's store returns them over IPC and the
// tools. Times are epoch milliseconds, as the store keeps them. The host's own columns (`bindingVersion`, `deletedAt`)
// stay in the store.
import * as z from 'zod';
import { AppSessionIdSchema, ProjectIdSchema } from '../graph/ids';
import { ARTIFACT_ID } from '../maws/artifact-id';
import { ActorSchema } from './actor';

export const ARTIFACT_KINDS = ['document', 'presentation', 'design', 'design_system', 'dashboard', 'html', 'file'] as const;
export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

// The P3-A document's Decision Log 2: these kinds are one Yjs document each; `html` and `file` are bytes on disk.
export const Y_DOC_KINDS = ['document', 'presentation', 'design', 'design_system', 'dashboard'] as const satisfies readonly ArtifactKind[];
export const BYTE_KINDS = ['html', 'file'] as const satisfies readonly ArtifactKind[];
export type DocKind = (typeof Y_DOC_KINDS)[number];
export const isDocKind = (kind: ArtifactKind): kind is DocKind => (Y_DOC_KINDS as readonly ArtifactKind[]).includes(kind);

const Time = z.number().int().nonnegative();

export const ArtifactSchema = z.strictObject({
  id: z.uuid(), // host-generated (Decision Log 3)
  kind: ArtifactKindSchema,
  title: z.string(),
  // Decision Log 3: the free-HTML tool's agent-chosen id, kept as a handle resolved over the asking session's lineage
  handle: z.string().regex(ARTIFACT_ID).optional(),
  spaceId: z.uuid().optional(),
  projectId: ProjectIdSchema.optional(),
  createdBy: ActorSchema,
  createdAt: Time,
  updatedAt: Time,
  lastViewedAt: Time.nullable(),
  pinned: z.boolean(),
  designSystemId: z.uuid().optional(),
  linkedPath: z.string().optional(),
  agentEditsAsSuggestions: z.boolean(), // the agent's writes land as suggestions (P3-A Decision Log 23g, 31a)
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const SpaceSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  linkedDir: z.string().optional(),
  createdAt: Time,
});
export type Space = z.infer<typeof SpaceSchema>;

export const ArtifactSessionLinkSchema = z.strictObject({
  artifactId: z.uuid(),
  appSessionId: AppSessionIdSchema,
  role: z.enum(['created', 'edited', 'viewed', 'commented']),
  lastAt: Time,
});
export type ArtifactSessionLink = z.infer<typeof ArtifactSessionLinkSchema>;
