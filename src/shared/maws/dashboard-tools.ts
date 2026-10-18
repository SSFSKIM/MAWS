// P3-E (docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md M2; ledger X25): the dashboard part of the `maws` server's
// artifact namespace, `artifact_dataset`, with its description, its input and its answer. `./tools` places the name and
// the entry in its P3-E blocks; this file imports only the leaf `./artifact-id`, as B's `./document-tools` does.
import * as z from 'zod';
import { ARTIFACT_ID } from './artifact-id';
import { CONNECTOR_ARGS_MAX_BYTES } from '../artifacts/connectors'; // E3: a query's arguments, as a call's are bounded

export const DASHBOARD_TOOL_NAMES = ['artifact_dataset'] as const;

// The ids, names and texts the tool takes (the dashboard model, src/artifacts/dashboard/datasets.ts, states the same).
const DatasetIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

// E3 start (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R2, R4; E's Decision Log 48 (4)): a query, a
// granted read-only tool whose result is the dataset: the server and tool as mcp_status names them, its arguments, a
// refresh schedule in whole seconds (30 s to 24 h; absent, refreshed only when asked) and the age past which its
// snapshot is stale (whole seconds).
const ConnectorName = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\p{Cc}]+$/u, 'no control characters');
const QueryArgsSchema = z.record(z.string(), z.unknown()).refine((args) => {
  try {
    return new TextEncoder().encode(JSON.stringify(args)).length <= CONNECTOR_ARGS_MAX_BYTES;
  } catch {
    return false;
  }
}, `the arguments are JSON of at most ${CONNECTOR_ARGS_MAX_BYTES} bytes`);
export const ArtifactDatasetQuerySchema = z.strictObject({
  kind: z.literal('query'),
  server: ConnectorName,
  tool: ConnectorName,
  args: QueryArgsSchema,
  schedule: z.number().int().min(30).max(86_400).optional(),
  staleAfter: z.number().int().positive().optional(),
});
// E3 end

// `path` a CSV, TSV or JSON file under the working directory (its extension names the format), or `ref` an asset the
// dashboard holds (`assets/<name>`, its name's extension the format); `remove: true` alone drops the descriptor. A
// replacement keeps the earlier title and description unless given; `rowKey` holds for the call that gives it. E3: or
// `source`, a query configured and not called (no path, ref, remove or refresh), or `refresh: true`, one fetch of the
// dataset's configured query (nothing else but the dashboard, the base and the id).
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
    source: ArtifactDatasetQuerySchema.optional(), // E3
    refresh: z.literal(true).optional(), // E3
  })
  .superRefine((input, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (input.id === '__proto__') issue('id', '"__proto__" is reserved');
    // E3: the two query modes, each excluding the other modes
    if (input.refresh) {
      for (const key of ['source', 'path', 'ref', 'remove', 'title', 'description', 'rowKey'] as const) if (input[key] !== undefined) issue(key, `a refresh takes no ${key}`);
    } else if (input.source) {
      for (const key of ['path', 'ref', 'remove'] as const) if (input[key] !== undefined) issue(key, `a query source takes no ${key}`);
    } else if (input.remove) {
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
  state?: { status: 'error'; message: string }; // E3: a refresh that failed: the error it recorded, the rows those kept
  notFetched?: true; // E3: a query configured and not fetched yet (no rows)
}

// A dashboard's `artifact_read` closes with its datasets (the parent's §2): each as the read doc's descriptor names it.
export interface DashboardDatasetSummary {
  id: string;
  title: string;
  file: string; // the source file's name
  columns: { name: string; type: string; mismatches?: number }[];
  rows: number;
  rowKey?: string;
  updated?: { at: string; by: 'user' | 'this session' | 'another session'; appSessionId?: string }; // E3: absent while notFetched
  notFetched?: true; // E3: a query dataset configured but never fetched (no snapshot, no rows yet)
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
      'Bind a data file to a MAWS dashboard as a named dataset its chart and table blocks draw; without this tool, put the data in a markdown table. path is a .csv, .tsv or .json file under the working directory (CSV and TSV with a header row; JSON an array of flat objects), or ref an asset the dashboard already holds; the host reads and validates it, infers each column\'s type, stores the bytes as an immutable snapshot and writes the dataset in one operation. A replacement is the same call with new data: every block naming the id redraws it; remove: true drops it (its blocks say so). baseRevision is the revision your last read (or create or write) of the dashboard returned: the call is refused conflict only when another session replaced or removed this dataset since then; prose edits and other datasets merge. A malformed file is refused naming the line and the reason, nothing written. rowKey names a column of unique, non-empty values. Returns the columns with their types, the row count, warnings for values that are not their column\'s type, and the new revision. A live dataset instead takes source: {kind: "query", server, tool, args, schedule?, staleAfter?}, a read-only MCP tool whose JSON rows become the dataset; this configures it without calling anything (it reads not fetched). The owner grants the tool from the dashboard; then refresh: true (with only artifact, baseRevision and id) fetches it once through a live session that has the server, publishing the rows or recording the error and keeping the previous rows. schedule (30 to 86400 seconds) refreshes it while the dashboard is shown; staleAfter (seconds) marks old rows stale.',
    input: ArtifactDatasetInputSchema,
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
} as const;
