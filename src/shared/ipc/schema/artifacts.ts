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
import { ARTIFACT_MAX_BYTES } from '../../maws/tools';
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
export const ARTIFACT_REFUSALS = ['notFound', 'invalid', 'tooLarge', 'handleTaken', 'designSystemInUse', 'storeTooNew', 'unavailable'] as const;
export const ArtifactRefusalSchema = z.strictObject({ reason: z.enum(ARTIFACT_REFUSALS), data: z.record(z.string(), z.unknown()) });
export type ArtifactRefusal = z.infer<typeof ArtifactRefusalSchema>;

// The refusal an IpcError carries, or null when it is not one of the store's (a timeout, an unavailable host).
export function artifactRefusalOf(error: IpcError): ArtifactRefusal | null {
  const parsed = ArtifactRefusalSchema.safeParse(error.issues);
  return parsed.success ? parsed.data : null;
}

const ArtifactAnswer = z.strictObject({ artifact: ArtifactRowSchema });

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
  'artifacts.attributions': host(z.strictObject({ artifactId: Id, fromSeq: Seq, toSeq: Seq }), z.strictObject({ bytes: Bytes })),
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
  // A byte kind's stored file (the `maws-artifact:` scheme, M7): the content at `revision` (the latest when omitted), or
  // one of the artifact's assets by its ref (`assets/<name>`). `path` in the answer is absolute. Main-only.
  'artifacts.content': host(
    z.strictObject({ artifactId: Id, revision: Seq.optional(), path: z.string().min(1).max(1_000).optional() }),
    z.strictObject({ revision: Seq, name: z.string(), size: z.number().int().nonnegative(), sha256: z.string(), path: z.string() }),
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
  'artifacts.open': main(z.strictObject({ artifactId: Id }), z.strictObject({ channel: z.number().int().nonnegative().max(0xffff_ffff) })),
} as const satisfies Record<`artifacts.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'artifacts.changed': ArtifactsChangedSchema,
  // P3-A M5: emitted by main (never by the host) each time the engine host's connection starts streaming, in both
  // modes: the store's events emitted while no client was connected or ready are not replayed, so a view that mirrors
  // the store (P3-L's library) reads it afresh here. Its one reconcile hook.
  'artifacts.resync': z.strictObject({}),
} as const satisfies Record<`artifacts.${string}`, z.ZodType>;
