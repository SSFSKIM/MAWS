// `artifact_dataset` (P3-E2 M2; ledger X25; XE5, XE6; the E2 execution document's concurrency and crash rule): a data
// file bound to a dashboard as a named dataset, as one operation.
//
//   1. A repeated tool-use id answers its first result, before anything is read (a source file deleted since cannot
//      make a successful retry fail).
//   2. Everything the write stands on is read and validated before anything is written: the dashboard, the file (under
//      the session's real working directory, symlinks resolved, read through one descriptor of the very file validated;
//      at most 16 MiB) or the asset the dashboard holds, its format by its name's extension, the host's parse and the
//      row key. Nothing is held over the disk read.
//   3. One serialized commit (`ArtifactStore.writeWithAssets`): its `prepare`, synchronous with the write, refuses a
//      future base and a descriptor that changed since `baseRevision` (the dashboard adapter's derived change index:
//      only the addressed dataset's descriptor is compared, so prose and other datasets merge); then the asset's row,
//      the session's `edited` link, the descriptor and the op's answer, all in one savepoint. The commit is the
//      operation's linearization point; a refusal or a failure leaves no asset, descriptor or op.
import { createHash } from 'node:crypto';
import { basename, relative } from 'node:path';
import { readDataset, removeDataset, setDataset, datasetSlotProblem, snapshotOf, type DatasetDescriptor, type DatasetFormat } from '@artifacts/dashboard/datasets';
import { DatasetError, parseDataset, rowKeyProblem, type ParsedDataset } from '@artifacts/dashboard/parse';
import { DATASET_STATES } from '@artifacts/dashboard/states';
import { legacyDashboardFiles, legacyDashboardReason } from '@artifacts/dashboard/legacy';
import type { ArtifactDatasetResult } from '@shared/maws/dashboard-tools';
import { mimeOf } from '@shared/files/mime';
import type { MawsDatasetRefreshOutcome } from '@shared/ipc/schema/maws'; // E3
import type { DatasetRefreshRequests } from '../connectors/dataset-requests'; // E3
import { sameQueryIdentity } from '../dashboards/refresh'; // E3
import { parseToolArguments, TOOL_ERRORS } from '@shared/maws/tools';
import { dashboardAdapterOf } from '../dashboards';
import { actorOf, answering, lineageOf, opIdOf, refuse, resolveArtifact, storeOf, ToolRefusal, type ArtifactToolDeps } from './artifact-context';
import { withProvisional, type ProvisionalEmitter } from './provisional'; // P4-A2 (X35)
import { datasetFileUnder, datasetFormatOf, readDatasetFile } from './dataset-file';
import { rememberDatasetFile } from '../dashboards/file-sources';
import { defineMawsTool, toolError, toolText, type McpToolDefinition } from './server';

const TOOL = 'artifact_dataset';
// E3 start (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): what a refresh answers when nothing was
// published, by main's closed outcome (never its words) or by how the request ended.
const NOT_PUBLISHED: Record<string, (tool: string, server: string) => string> = {
  'revoked:notGranted': (tool) => `the owner has not granted ${tool} to this dashboard; ask them to allow it from the dashboard's datasets, then refresh`,
  'revoked:fingerprintChanged': (tool) => `${tool} changed since the owner granted it; ask them to grant it again, then refresh`,
  'revoked:wrongMode': (tool) => `${tool} is granted only once, and a refresh needs the owner's read-only grant`,
  'revoked:revoked': (tool) => `the owner revoked ${tool} while it ran`,
  'paused:noRoute': (_tool, server) => `this live session does not have ${server} connected, and no direct route reaches it; nothing was fetched`,
  'paused:unavailable': (_tool, server) => `${server} became unavailable during the call`,
  'paused:hidden': (tool) => `the call of ${tool} was stopped`,
  'paused:closed': (tool) => `the call of ${tool} was stopped`,
  'invalid:notReadOnly': (tool) => `${tool} is not marked read-only, so it cannot feed a dataset`,
  ok: () => 'MAWS reported the call done, but the host recorded no publication',
};
const notPublished = (outcome: MawsDatasetRefreshOutcome, tool: string, server: string): string => {
  const key = outcome.ok ? 'ok' : `${outcome.state}:${outcome.reason}`;
  return (NOT_PUBLISHED[key] ?? (() => `the refresh of ${tool} failed (${key}); nothing was published`))(tool, server);
};
const ENDED: Record<'timeout' | 'withdrawn' | 'noClient', string> = {
  timeout: 'MAWS did not answer in time; nothing was published',
  withdrawn: 'the request was withdrawn',
  noClient: 'MAWS is not open; the dataset cannot be refreshed',
};
// The query `source` configures keeps what `prior` fetched when it is the same query (its server, tool and
// arguments): its snapshot, provenance, columns, rows, state and retention (the architect's M2 ruling).
const keptBy = (prior: DatasetDescriptor | null, source: { server: string; tool: string; args: Record<string, unknown> }): prior is DatasetDescriptor =>
  prior !== null && prior.source.kind === 'query' && sameQueryIdentity(prior.source, source);
// The retained snapshot a supplied row key must key, or null: a kept query's rows, when the key is a change.
const keyedSnapshot = (prior: DatasetDescriptor | null, input: { source: { server: string; tool: string; args: Record<string, unknown> }; rowKey?: string }): string | null =>
  input.rowKey !== undefined && keptBy(prior, input.source) && prior.rowKey !== input.rowKey ? (snapshotOf(prior)?.ref ?? null) : null;
// E3 end

// P4-A2 (X35; the dashboard view's layer is G2's): the session's provisional layer of the call is committed from the
// write's frame and dropped on any other ending (`withProvisional`). A refresh writes nothing here (main's sink publishes
// it), so its layer is dropped once the call answers, published or not.
export function artifactDatasetTool(deps: ArtifactToolDeps & { refreshes?: Pick<DatasetRefreshRequests, 'ask'> /* E3 */; provisional?: ProvisionalEmitter }): McpToolDefinition {
  return defineMawsTool(TOOL, (args, ctx) =>
    withProvisional(deps.provisional, ctx.toolUseId, () => deps.session.joined(opIdOf(ctx), () =>
      answering(TOOL, async () => {
        const parsed = parseToolArguments(TOOL, args);
        if (!parsed.ok) return toolError(parsed.error);
        const input = parsed.data;
        const store = storeOf(TOOL, deps);
        const replayed = await store.replayOf(opIdOf(ctx));
        if (replayed.found) return toolText(replayed.result);
        const adapter = dashboardAdapterOf(store);
        if (!adapter) throw refuse(TOOL, { reason: 'unavailable' }, 'dashboards are not registered with the artifact store in this run of MAWS');
        const artifactId = await resolveArtifact(TOOL, store, input.artifact, lineageOf(ctx, deps));
        const artifact = await store.readCommitted(() => store.get(artifactId));
        if (!artifact) throw new ToolRefusal(TOOL_ERRORS.noArtifact(TOOL, input.artifact));
        if (artifact.kind !== 'dashboard') throw refuse(TOOL, { reason: 'invalid', kind: artifact.kind }, `${input.artifact} is a ${artifact.kind} artifact; ${TOOL} binds data to dashboards`);

        // E3 (R3): one refresh of the configured query, asked of main and answered by the host's durable record
        if (input.refresh) {
          const query = await store.readCommitted(() => {
            const doc = store.service.live(artifactId);
            const held = legacyDashboardFiles(doc);
            if (held) throw refuse(TOOL, { reason: 'invalid', kind: 'dashboard', held }, `${input.artifact}: ${legacyDashboardReason(held)}; nothing was fetched`);
            const live = store.revision(artifactId);
            if (input.baseRevision > live) throw refuse(TOOL, { reason: 'invalid', liveRevision: live }, `baseRevision ${input.baseRevision} is newer than the live revision ${live}`);
            const existing = readDataset(doc, input.id);
            if (adapter.lastChange(artifactId, input.id) > input.baseRevision) {
              const detail = existing ? 'replaced since your read' : 'removed since your read';
              throw refuse(TOOL, { reason: 'conflict', dataset: input.id, detail, liveRevision: live }, `dataset "${input.id}" was ${detail.replace(' since your read', '')} since your read (revision ${input.baseRevision}); read the dashboard again`);
            }
            if (!existing) throw refuse(TOOL, { reason: 'notFound', dataset: input.id }, `${DATASET_STATES.noDataset(input.id)} to refresh`);
            if (existing.source.kind !== 'query') throw refuse(TOOL, { reason: 'invalid', dataset: input.id }, `dataset "${input.id}" is bound to a file; only a query source refreshes`);
            return existing.source;
          });
          if (!deps.refreshes) throw refuse(TOOL, { reason: 'unavailable' }, 'this run of MAWS cannot refresh a dataset');
          const named = `${query.server} · ${query.tool}`;
          const settled = await deps.refreshes.ask({ artifactId, datasetId: input.id, baseRevision: input.baseRevision, appSessionId: ctx.appSessionId, opId: opIdOf(ctx), server: query.server, tool: query.tool, args: query.args }, ctx.signal);
          switch (settled.kind) {
            case 'published':
              return toolText(settled.answer);
            // E3 M2 fix (reviewer finding 5): the dataset changed or went while it was fetched: XE6's descriptor-level
            // conflict, as a write would answer it, nothing written
            case 'stale': {
              const now = await store.readCommitted(() => ({ exists: Boolean(store.get(artifactId)) && readDataset(store.service.live(artifactId), input.id) !== null, liveRevision: store.revision(artifactId) }));
              const detail = now.exists ? 'replaced since your read' : 'removed since your read';
              throw refuse(TOOL, { reason: 'conflict', dataset: input.id, detail, liveRevision: now.liveRevision }, `${settled.detail}; nothing was published; read the dashboard again`);
            }
            case 'refused':
              if (settled.refusal !== null) throw refuse(TOOL, { reason: 'invalid', dataset: input.id }, `${settled.refusal}; nothing was published`);
              throw refuse(TOOL, { reason: 'unavailable', dataset: input.id }, notPublished(settled.outcome, named, query.server));
            default:
              throw refuse(TOOL, { reason: 'unavailable', dataset: input.id }, ENDED[settled.kind]);
          }
        }

        // what the write stands on, read and validated first
        let source: { bytes: Uint8Array; name: string; format: DatasetFormat; ref?: string; origin?: { cwd: string; path: string } } | null = null;
        let table: ParsedDataset | null = null;
        // E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1): a bound asset is held from its lookup to the
        // end of the write, so a query snapshot retired meanwhile keeps its bytes for the descriptor that names it (which
        // then adopts it)
        let held: { release(): void } | null = null;
        // E3 (R2): a supplied row key of a kept query, validated before the write against the rows it retains (held)
        let keyed: string | null = null;
        try {
          if (input.source) {
            const query = input.source;
            const retained = await store.readCommitted(() => {
              const ref = keyedSnapshot(readDataset(store.service.live(artifactId), input.id), { source: query, rowKey: input.rowKey });
              const asset = ref === null ? undefined : store.listAssets(artifactId).find((candidate) => candidate.ref === ref);
              if (asset) held = store.holdAsset(artifactId, asset.ref); // in the lookup's turn
              return ref === null ? null : { ref, asset };
            });
            if (retained) {
              if (!retained.asset) throw refuse(TOOL, { reason: 'unavailable', dataset: input.id }, `dataset "${input.id}"'s rows could not be read to check the row key; nothing was written`);
              const rows = parseDataset(store.files.readAsset(artifactId, retained.asset.sha256), 'json');
              const keyProblem = rows instanceof DatasetError ? rows.reason : rowKeyProblem(rows, input.rowKey!);
              if (keyProblem) throw refuse(TOOL, { reason: 'invalid', rowKey: input.rowKey, message: keyProblem }, `${keyProblem}; nothing was written`);
              keyed = retained.ref;
            }
          }
          if (!input.remove && !input.source /* E3: a query reads nothing */) {
            if (input.path !== undefined) {
              const validated = await datasetFileUnder(ctx.cwd, input.path);
              const name = basename(input.path);
              const format = datasetFormatOf(name);
              if (!format) throw refuse(TOOL, { reason: 'invalid', path: validated.real }, `${name} is not a .csv, .tsv or .json file`);
              source = { bytes: await readDatasetFile(validated), name, format, origin: { cwd: validated.root, path: relative(ctx.cwd, validated.named) } };
            } else {
              const asset = await store.readCommitted(() => {
                const found = store.listAssets(artifactId).find((candidate) => candidate.ref === input.ref);
                if (found) held = store.holdAsset(artifactId, found.ref); // E3: in the lookup's turn
                return found;
              });
              if (!asset) throw refuse(TOOL, { reason: 'notFound', ref: input.ref }, `${input.artifact} holds no asset ${input.ref}; artifact_list_assets lists them`);
              const format = datasetFormatOf(asset.name);
              if (!format) throw refuse(TOOL, { reason: 'invalid', ref: input.ref }, `${input.ref} is not a .csv, .tsv or .json asset`);
              source = { bytes: store.files.readAsset(artifactId, asset.sha256), name: asset.name, format, ref: asset.ref };
            }
            const result = parseDataset(source.bytes, source.format);
            if (result instanceof DatasetError) {
              throw refuse(TOOL, { reason: result.kind, ...(result.line !== undefined && { line: result.line }), message: result.reason }, `${source.name} was refused: ${result.reason}; nothing was written`);
            }
            const keyProblem = input.rowKey === undefined ? null : rowKeyProblem(result, input.rowKey);
            if (keyProblem) throw refuse(TOOL, { reason: 'invalid', rowKey: input.rowKey, message: keyProblem }, `${keyProblem}; nothing was written`);
            table = result;
          }
          const sha256 = source && createHash('sha256').update(source.bytes).digest('hex');
          const actor = actorOf(ctx);
          const at = (deps.now?.() ?? new Date()).getTime();

          const answer = await store.writeCommitted(() =>
            store.withOp(
              opIdOf(ctx),
              TOOL,
              artifactId,
              async (op) => {
                let existing: DatasetDescriptor | null = null;
                let recorded: ArtifactDatasetResult | undefined;
                let configured: DatasetDescriptor | null = null; // E3: the query a `source` wrote
                // the final check, inside the write's savepoint and synchronous with it
                const prepare = () => {
                  if (!store.get(artifactId)) throw new ToolRefusal(TOOL_ERRORS.noArtifact(TOOL, input.artifact));
                  const doc = store.service.live(artifactId);
                  // a dashboard made from files before E2 is held (fix wave R1): checked here, at the write, so one that
                  // became it while the file was read (a restore) is refused with nothing written
                  const held = legacyDashboardFiles(doc);
                  if (held) throw refuse(TOOL, { reason: 'invalid', kind: 'dashboard', held }, `${input.artifact}: ${legacyDashboardReason(held)}; nothing was written`);
                  const live = store.revision(artifactId);
                  if (input.baseRevision > live) throw refuse(TOOL, { reason: 'invalid', liveRevision: live }, `baseRevision ${input.baseRevision} is newer than the live revision ${live}`);
                  existing = readDataset(doc, input.id);
                  if (adapter.lastChange(artifactId, input.id) > input.baseRevision) {
                    const detail = existing ? 'replaced since your read' : 'removed since your read';
                    throw refuse(TOOL, { reason: 'conflict', dataset: input.id, detail, liveRevision: live }, `dataset "${input.id}" was ${detail.replace(' since your read', '')} since your read (revision ${input.baseRevision}); read the dashboard again`);
                  }
                  // E3 (R2): the rows a supplied row key was checked against are still the ones it will key
                  if (input.source && keyedSnapshot(existing, { source: input.source, rowKey: input.rowKey }) !== keyed) {
                    throw refuse(TOOL, { reason: 'conflict', dataset: input.id, detail: 'replaced since your read', liveRevision: live }, `dataset "${input.id}" was replaced while its row key was checked; read the dashboard again`);
                  }
                  if (input.remove && !existing) throw refuse(TOOL, { reason: 'notFound', dataset: input.id }, `${DATASET_STATES.noDataset(input.id)} to remove`);
                  const slot = input.remove ? null : datasetSlotProblem(doc, input.id);
                  if (slot) throw refuse(TOOL, { reason: 'invalid', dataset: input.id }, slot);
                };
                const assets = source && source.ref === undefined ? [{ bytes: source.bytes, name: source.name, mime: mimeOf(source.name) }] : [];
                await store.writeWithAssets(
                  artifactId,
                  actor,
                  assets,
                  (doc, refs) => {
                    const prior = existing as DatasetDescriptor | null;
                    // E3 (R2): a query configured: the same query keeps what it fetched (its policy and metadata
                    // updated); a new one is never fetched (no snapshot, rows, columns or provenance). An omitted
                    // title, description or row key stays.
                    if (input.source) {
                      const { kind, server, tool, args, schedule, staleAfter } = input.source;
                      const description = input.description ?? prior?.description;
                      const rowKey = input.rowKey ?? prior?.rowKey;
                      const meta = { title: input.title ?? prior?.title ?? input.id, ...(description !== undefined && { description }), ...(rowKey !== undefined && { rowKey }) };
                      const query = { kind, server, tool, args, ...(schedule !== undefined && { schedule }), ...(staleAfter !== undefined && { staleAfter }) };
                      configured = keptBy(prior, input.source)
                        ? ({ ...prior, ...meta, source: { ...query, snapshot: (prior.source as { snapshot: { ref: string; at: number } | null }).snapshot } } as DatasetDescriptor)
                        : { ...meta, source: { ...query, snapshot: null }, columns: [], rows: 0, state: { status: 'ok', at } };
                      return setDataset(doc, input.id, configured);
                    }
                    if (!source || !table) return removeDataset(doc, input.id);
                    const title = input.title ?? prior?.title ?? input.id;
                    const description = input.description ?? prior?.description;
                    setDataset(doc, input.id, {
                      title,
                      ...(description !== undefined && { description }),
                      source: { kind: 'file', ref: source.ref ?? refs[0]!.ref, name: source.name, format: source.format, sha256: sha256!, size: source.bytes.length },
                      columns: table.columns,
                      rows: table.rows.length,
                      ...(input.rowKey !== undefined && { rowKey: input.rowKey }),
                      updated: { at, by: actor },
                      state: { status: 'ok', at },
                    });
                  },
                  {
                    prepare,
                    inFrame: (revision, { edited }) => {
                      recorded = configured
                        ? { status: 'dataset', artifactId, id: input.id, revision, columns: configured.columns, rows: configured.rows, ...(snapshotOf(configured) === null && { notFetched: true as const }) } // E3
                        : table
                        ? { status: 'dataset', artifactId, id: input.id, revision, columns: table.columns, rows: table.rows.length, ...(table.warnings.length > 0 && { warnings: table.warnings }) }
                        : { status: 'dataset', artifactId, id: input.id, revision };
                      if (source?.origin) {
                        const descriptor = readDataset(store.service.live(artifactId), input.id);
                        if (descriptor?.source.kind === 'file') rememberDatasetFile(store, artifactId, input.id, descriptor, source.origin);
                      }
                      op.record(recorded);
                      if (ctx.toolUseId !== null) {
                        // P4-A2 (X35 rule 2): the dataset's own row; a descriptor as it was wrote none, and the layer goes now
                        if (edited !== null) deps.provisional?.committed(ctx.toolUseId, artifactId, edited);
                        else deps.provisional?.uncommitted(ctx.toolUseId, artifactId);
                      }
                    },
                  },
                );
                return recorded!;
              },
              { actor },
            ),
          );
          return toolText(answer);
        } finally {
          (held as { release(): void } | null)?.release(); // E3
        }
      }),
    )),
  );
}
