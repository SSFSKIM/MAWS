// P3-E (docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md M2; ledger X25): the dashboard part of the `maws` server's
// artifact namespace, `artifact_dataset`, with its description, its input and its answer. `./tools` places the name and
// the entry in its P3-E blocks; this file imports only the leaf `./artifact-id`, as B's `./document-tools` does.
import * as z from 'zod';
import { ARTIFACT_ID } from './artifact-id';

export const DASHBOARD_TOOL_NAMES = ['artifact_dataset'] as const;

// The ids, names and texts the tool takes (the dashboard model, src/artifacts/dashboard/datasets.ts, states the same).
const DatasetIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

// `path` a CSV, TSV or JSON file under the working directory (its extension names the format), or `ref` an asset the
// dashboard holds (`assets/<name>`, its name's extension the format); `remove: true` alone drops the descriptor. A
// replacement keeps the earlier title and description unless given; `rowKey` holds for the call that gives it.
export const ArtifactDatasetInputSchema = z
  .strictObject({
    artifact: z.string().regex(ARTIFACT_ID),
    baseRevision: z.number().int().min(0),
    id: DatasetIdSchema,
    path: z.string().min(1).max(4096).optional(),
    ref: z.string().min(1).max(1_000).optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(10_000).optional(),
    rowKey: z.string().min(1).max(256).optional(),
    remove: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (input.id === '__proto__') issue('id', '"__proto__" is reserved');
    if (input.remove) {
      for (const key of ['path', 'ref', 'title', 'description', 'rowKey'] as const) if (input[key] !== undefined) issue(key, `a removal takes no ${key}`);
    } else if ((input.path === undefined) === (input.ref === undefined)) issue('path', 'a dataset is bound from path or ref, one of them');
  });
export type ArtifactDatasetInput = z.infer<typeof ArtifactDatasetInputSchema>;

export interface ArtifactDatasetResult {
  status: 'dataset';
  artifactId: string;
  id: string;
  revision: number; // the live revision after the write
  columns?: { name: string; type: string; mismatches?: number }[]; // a bind's (a removal answers neither columns nor rows)
  rows?: number;
  warnings?: string[];
}

// A dashboard's `artifact_read` closes with its datasets (the parent's §2): each as the read doc's descriptor names it.
export interface DashboardDatasetSummary {
  id: string;
  title: string;
  file: string; // the source file's name
  columns: { name: string; type: string; mismatches?: number }[];
  rows: number;
  rowKey?: string;
  updated: { at: string; by: 'user' | 'this session' | 'another session'; appSessionId?: string };
  state?: { status: string; message?: string }; // when not ok
}

// P3-E2 M3 (E's Decision Log 9): on a dashboard's `artifact_create`, `artifact_read` and `artifact_edit` answers, what a
// chart block's view spec drops (an unknown key, a value the grammar refuses) or cannot draw (an unknown view kind),
// block by block; absent when there is nothing to say, and never on a document's answers.
export interface DashboardViewWarning {
  blockId: string;
  message: string;
}

export const DASHBOARD_TOOLS = {
  artifact_dataset: {
    title: 'Bind dashboard dataset',
    description:
      'Bind a data file to a MAWS dashboard as a named dataset its chart and table blocks draw; without this tool, put the data in a markdown table. path is a .csv, .tsv or .json file under the working directory (CSV and TSV with a header row; JSON an array of flat objects), or ref an asset the dashboard already holds; the host reads and validates it, infers each column\'s type, stores the bytes as an immutable snapshot and writes the dataset in one operation. A replacement is the same call with new data: every block naming the id redraws it; remove: true drops it (its blocks say so). baseRevision is the revision your last read (or create or write) of the dashboard returned: the call is refused conflict only when another session replaced or removed this dataset since then; prose edits and other datasets merge. A malformed file is refused naming the line and the reason, nothing written. rowKey names a column of unique, non-empty values. Returns the columns with their types, the row count, warnings for values that are not their column\'s type, and the new revision.',
    input: ArtifactDatasetInputSchema,
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
} as const;
