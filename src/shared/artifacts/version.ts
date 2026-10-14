// X29, the version record (docs/doperpowers/plans/2026-10-12-p3-co-work.md §4.2 and §4.7; the P3 interface ledger §2):
// one `artifact_versions` row as history lists it. `id` names the version (what `artifacts.restore` takes); `seq` is the
// live revision the version captured. The state or content reference itself stays in the store.
import * as z from 'zod';
import { ActorSchema } from './actor';

export const VERSION_KINDS = ['auto', 'turn', 'named', 'restore', 'import'] as const;

export const ArtifactVersionSchema = z.strictObject({
  id: z.number().int().positive(),
  seq: z.number().int().nonnegative(),
  at: z.number().int().nonnegative(),
  actor: ActorSchema,
  kind: z.enum(VERSION_KINDS),
  label: z.string().optional(),
  note: z.string().optional(),
  summary: z.string().optional(),
  designSystemRef: z.strictObject({ id: z.uuid(), versionSeq: z.number().int().nonnegative() }).optional(), // the version's pin (parent Decision Log 20g)
  assetRefs: z.array(z.string()),
});
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;
