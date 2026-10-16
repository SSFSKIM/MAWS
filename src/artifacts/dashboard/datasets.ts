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
// E3's (reserved, parent §2): a granted tool's result, validated as a file is, its snapshot a JSON asset.
const QuerySourceSchema = z.strictObject({
  kind: z.literal('query'),
  server: z.string().min(1).max(200),
  tool: z.string().min(1).max(200),
  args: z.record(z.string(), z.unknown()),
  schedule: z.number().int().positive().optional(),
  staleAfter: z.number().int().positive().optional(),
  snapshot: z.strictObject({ ref: z.string().startsWith('assets/').max(1_000), at: Time }),
});
const DescriptorSchema = z.strictObject({
  title: z.string().min(1).max(200),
  description: Text.optional(),
  source: z.discriminatedUnion('kind', [FileSourceSchema, QuerySourceSchema]),
  columns: z.array(ColumnSchema).max(DATASET_LIMITS.columns),
  rows: z.number().int().nonnegative().max(DATASET_LIMITS.rows),
  rowKey: z.string().min(1).max(DATASET_LIMITS.columnName).optional(),
  updated: z.strictObject({ at: Time, by: ActorSchema }),
  state: z.strictObject({ status: z.enum(['ok', 'error', 'stale', 'paused']), message: Text.optional(), at: Time }),
});

export type DatasetColumn = z.infer<typeof ColumnSchema>;
export type FileSource = z.infer<typeof FileSourceSchema>;
export type QuerySource = z.infer<typeof QuerySourceSchema>;
export type DatasetSource = FileSource | QuerySource;
export type DatasetState = z.infer<typeof DescriptorSchema>['state'];
export interface DatasetDescriptor {
  title: string;
  description?: string;
  source: DatasetSource;
  columns: DatasetColumn[];
  rows: number;
  rowKey?: string;
  updated: { at: number; by: Actor };
  state: DatasetState;
}

/** The immutable snapshot a descriptor names: its asset ref and the format its bytes are read in. */
export function snapshotOf(descriptor: DatasetDescriptor): { ref: string; format: DatasetFormat } {
  return descriptor.source.kind === 'file' ? { ref: descriptor.source.ref, format: descriptor.source.format } : { ref: descriptor.source.snapshot.ref, format: 'json' };
}

/** Why `id` cannot name a dataset, or null. `__proto__` is refused: a Y.Node takes no such attribute. */
export function datasetIdProblem(id: string): string | null {
  if (!DATASET_ID.test(id)) return 'a dataset id is 1 to 64 letters, digits, "_" or "-"';
  if (id === '__proto__') return '"__proto__" is reserved';
  return null;
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

/** Writes `id`'s descriptor whole (a bind or a replacement), as one transaction. Refuses a bad id and a 65th dataset. */
export function setDataset(doc: Doc, id: string, descriptor: DatasetDescriptor): void {
  const problem = datasetIdProblem(id);
  if (problem) throw new Error(`the dataset id ${JSON.stringify(id)} is refused: ${problem}`);
  const root = rootOf(doc);
  if (root.getAttr(id) === undefined && [...(root.attrKeys() as Iterable<string>)].length >= DATASET_LIMITS.datasets) throw new Error(`a dashboard holds at most ${DATASET_LIMITS.datasets} datasets`);
  const value = DescriptorSchema.parse(descriptor);
  transact(doc, () => root.setAttr(id, value));
}

export function removeDataset(doc: Doc, id: string): void {
  const root = rootOf(doc);
  if (root.getAttr(id) !== undefined) transact(doc, () => root.deleteAttr(id));
}
