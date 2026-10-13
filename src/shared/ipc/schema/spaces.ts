// X2 `spaces.*` (X23; the P3 interface ledger §1; docs/doperpowers/plans/2026-10-12-p3-a-store.md, M4 and Decision Log
// 1): the engine host's Spaces, the owner's groups of artifacts. Deleting a Space leaves its artifacts in no Space.
// Refusals carry an `ArtifactRefusal` in `IpcError.issues`, as `artifacts.*` does (schema/artifacts.ts).
import * as z from 'zod';
import { SpaceSchema } from '../../artifacts/entity';
import type { CommandSpec } from './common';

const host = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'engine-host' as const });

const Name = z.string().min(1).max(200);
const SpaceAnswer = z.strictObject({ space: SpaceSchema });

export const SpacesChangedSchema = z.strictObject({ spaceId: z.uuid(), change: z.enum(['created', 'updated', 'deleted']) });
export type SpacesChanged = z.infer<typeof SpacesChangedSchema>;

export const commands = {
  'spaces.list': host(z.void(), z.strictObject({ spaces: z.array(SpaceSchema) })),
  'spaces.create': host(z.strictObject({ name: Name, linkedDir: z.string().min(1).optional() }), SpaceAnswer),
  'spaces.update': host(z.strictObject({ spaceId: z.uuid(), name: Name.optional(), linkedDir: z.string().min(1).nullable().optional() }), SpaceAnswer),
  'spaces.delete': host(z.strictObject({ spaceId: z.uuid() }), z.void()),
} as const satisfies Record<`spaces.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'spaces.changed': SpacesChangedSchema,
} as const satisfies Record<`spaces.${string}`, z.ZodType>;
