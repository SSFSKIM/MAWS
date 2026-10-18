// The dashboard's datasets (P3-E2 M2; XE5 of docs/doperpowers/plans/2026-10-16-p3-e-design-dashboard.md, §2
// "Datasets"; the E2 execution document's Interfaces): a dashboard is B's document plus one root, `datasets`, whose
// attributes map a dataset id to its descriptor, a plain JSON value written whole (a replacement is one atomic write, so
// two replicas never merge half of two descriptors). The descriptor names its snapshot, an immutable artifact asset, by
// ref and format; the rows never enter the doc. Portable: the host's tool, the editor, the exporters and E3 read the
// same module.
import * as z from 'zod';
import { ActorSchema, type Actor } from '@shared/artifacts/actor';
import { transact, type Doc } from '../yjs';

export const DATASETS_ROOT = 'datasets';

// The candidates of the parent's §2 (E2 settles them against the renderer's measurements): datasets per dashboard, rows
// and columns per dataset, the upload's byte cap, and the longest column name (P3-E2 M2: a header line is otherwise
// bounded only by the file, and its names live in the doc).
export const DATASET_LIMITS = { datasets: 64, rows: 200_000, columns: 256, bytes: 16 * 1024 * 1024, columnName: 256 } as const;

// One page of `artifacts.readDataset` (ledger X23, parent Decision Log 6): candidates until the mini measures them.
export const DATASET_READ_MAX_ROWS = 2_000;
export const DATASET_READ_MAX_BYTES = 1024 * 1024; // of the page's rows as JSON

export const DATASET_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const DATASET_FORMATS = ['csv', 'tsv', 'json'] as const;
export type DatasetFormat = (typeof DATASET_FORMATS)[number];
export const COLUMN_TYPES = ['string', 'number', 'boolean', 'date', 'null'] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];
export type Cell = string | number | boolean | null;

const Time = z.number().int().nonnegative();
const Text = z.string().max(10_000);

// `mismatches` (P3-E2 M2): how many non-null values of the column are not its type, kept as written (the state
// "<n> of <rows> values in <column> are not <type>", states.ts); absent when every value is.
const ColumnSchema = z.strictObject({ name: z.string().min(1).max(DATASET_LIMITS.columnName), type: z.enum(COLUMN_TYPES), mismatches: z.number().int().positive().optional() });
const FileSourceSchema = z.strictObject({
  kind: z.literal('file'),
  ref: z.string().startsWith('assets/').max(1_000),
  name: z.string().min(1).max(1_000),
  format: z.enum(DATASET_FORMATS),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
});
// E3 start (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R2, R4; E's Decision Log 48 (4) and the M1 review's
// ruling): a granted tool's result, validated as a file is, its snapshot a JSON asset. `snapshot` is null until the first
// successful fetch; `schedule` is whole seconds within QUERY_SCHEDULE_SECONDS, absent meaning manual; `staleAfter`
// positive whole seconds, independent of the schedule.
export const QUERY_SCHEDULE_SECONDS = { min: 30, max: 86_400 } as const;
const querySourceShape = {
  kind: z.literal('query'),
  server: z.string().min(1).max(200),
  tool: z.string().min(1).max(200),
  args: z.record(z.string(), z.unknown()),
  schedule: z.number().int().min(QUERY_SCHEDULE_SECONDS.min).max(QUERY_SCHEDULE_SECONDS.max).optional(),
  staleAfter: z.number().int().positive().optional(),
};
const SnapshotSchema = z.strictObject({ ref: z.string().startsWith('assets/').max(1_000), at: Time });
const FetchedQuerySourceSchema = z.strictObject({ ...querySourceShape, snapshot: SnapshotSchema });
const UnfetchedQuerySourceSchema = z.strictObject({ ...querySourceShape, snapshot: z.null() });
// E3 end
const StateSchema = z.strictObject({ status: z.enum(['ok', 'error', 'stale', 'paused']), message: Text.optional(), at: Time });
const UpdatedSchema = z.strictObject({ at: Time, by: ActorSchema });
const common = {
  title: z.string().min(1).max(200),
  description: Text.optional(),
  rowKey: z.string().min(1).max(DATASET_LIMITS.columnName).optional(),
  state: StateSchema,
};
const withRows = { columns: z.array(ColumnSchema).max(DATASET_LIMITS.columns), rows: z.number().int().nonnegative().max(DATASET_LIMITS.rows) };
// E3: three arms, told apart by the source's kind and its snapshot: a file (its bind's `updated`), a fetched query (its
// last successful fetch's `updated`), and a query never fetched (no `updated`, no rows, no columns)
const DescriptorSchema = z.union([
  z.strictObject({ ...common, source: FileSourceSchema, ...withRows, updated: UpdatedSchema }),
  z.strictObject({ ...common, source: FetchedQuerySourceSchema, ...withRows, updated: UpdatedSchema }),
  z.strictObject({ ...common, source: UnfetchedQuerySourceSchema, columns: z.array(ColumnSchema).max(0), rows: z.literal(0) }),
]);

export type DatasetColumn = z.infer<typeof ColumnSchema>;
export type FileSource = z.infer<typeof FileSourceSchema>;
export type FetchedQuerySource = z.infer<typeof FetchedQuerySourceSchema>; // E3
export type UnfetchedQuerySource = z.infer<typeof UnfetchedQuerySourceSchema>; // E3
export type QuerySource = FetchedQuerySource | UnfetchedQuerySource;
export type DatasetSource = FileSource | QuerySource;
export type DatasetState = z.infer<typeof StateSchema>;
interface DescriptorCommon {
  title: string;
  description?: string;
  rowKey?: string;
  state: DatasetState;
}
/** A file's dataset: the bind's provenance always named. */
export interface FileDatasetDescriptor extends DescriptorCommon {
  source: FileSource;
  columns: DatasetColumn[];
  rows: number;
  updated: { at: number; by: Actor };
}
/** E3: a query fetched at least once: its last successful fetch's snapshot and provenance. */
export interface FetchedQueryDatasetDescriptor extends DescriptorCommon {
  source: FetchedQuerySource;
  columns: DatasetColumn[];
  rows: number;
  updated: { at: number; by: Actor };
}
/** E3: a query configured and never fetched: no snapshot, no rows, no columns, no provenance. */
export interface UnfetchedQueryDatasetDescriptor extends DescriptorCommon {
  source: UnfetchedQuerySource;
  columns: [];
  rows: 0;
  updated?: never;
}
export type DatasetDescriptor = FileDatasetDescriptor | FetchedQueryDatasetDescriptor | UnfetchedQueryDatasetDescriptor;

/** The immutable snapshot a descriptor names: its asset ref and the format its bytes are read in. E3: null for a query
 * never fetched, which has no bytes to read (a file's or a fetched query's is never null, by its type). */
export function snapshotOf(descriptor: FileDatasetDescriptor | FetchedQueryDatasetDescriptor): { ref: string; format: DatasetFormat };
export function snapshotOf(descriptor: DatasetDescriptor): { ref: string; format: DatasetFormat } | null;
export function snapshotOf(descriptor: DatasetDescriptor): { ref: string; format: DatasetFormat } | null {
  const { source } = descriptor;
  if (source.kind === 'file') return { ref: source.ref, format: source.format };
  return source.snapshot === null ? null : { ref: source.snapshot.ref, format: 'json' };
}

/** Why `id` cannot name a dataset, or null. `__proto__` is refused: a Y.Node takes no such attribute. */
export function datasetIdProblem(id: string): string | null {
  if (!DATASET_ID.test(id)) return 'a dataset id is 1 to 64 letters, digits, "_" or "-"';
  if (id === '__proto__') return '"__proto__" is reserved';
  return null;
}

/**
 * The dataset id a chart block's `source` (its fence body) names: the string trimmed (an imported fence may pad the id
 * or surround it with blank lines), anything else empty. The one reading the editor, history and the exporters share
 * (P3-E2 M6; E's Decision Log 40).
 */
export function datasetIdFromSource(source: unknown): string {
  return typeof source === 'string' ? source.trim() : '';
}

const rootOf = (doc: Doc) => doc.get(DATASETS_ROOT);

/** The descriptor `id` names, or null when none does or the value there is not a descriptor (a replica wrote junk). */
export function readDataset(doc: Doc, id: string): DatasetDescriptor | null {
  if (datasetIdProblem(id) !== null) return null;
  const parsed = DescriptorSchema.safeParse(rootOf(doc).getAttr(id));
  return parsed.success ? (parsed.data as DatasetDescriptor) : null;
}

/** Every readable descriptor, by id. */
export function listDatasets(doc: Doc): { id: string; descriptor: DatasetDescriptor }[] {
  return [...(rootOf(doc).attrKeys() as Iterable<string>)]
    .sort()
    .flatMap((id) => {
      const descriptor = readDataset(doc, id);
      return descriptor ? [{ id, descriptor }] : [];
    });
}

/** Why `doc` cannot take a descriptor under `id` now, or null: a bad id, or a new id past the limit of datasets. */
export function datasetSlotProblem(doc: Doc, id: string): string | null {
  const problem = datasetIdProblem(id);
  if (problem) return `the dataset id ${JSON.stringify(id)} is refused: ${problem}`;
  const root = rootOf(doc);
  if (root.getAttr(id) === undefined && [...(root.attrKeys() as Iterable<string>)].length >= DATASET_LIMITS.datasets) return `a dashboard holds at most ${DATASET_LIMITS.datasets} datasets`;
  return null;
}

/** Writes `id`'s descriptor whole (a bind or a replacement), as one transaction; throws what `datasetSlotProblem` says. */
export function setDataset(doc: Doc, id: string, descriptor: DatasetDescriptor): void {
  const problem = datasetSlotProblem(doc, id);
  if (problem) throw new Error(problem);
  const value = DescriptorSchema.parse(descriptor);
  transact(doc, () => rootOf(doc).setAttr(id, value));
}

export function removeDataset(doc: Doc, id: string): void {
  const root = rootOf(doc);
  if (root.getAttr(id) !== undefined) transact(doc, () => root.deleteAttr(id));
}
