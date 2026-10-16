// `artifact_dataset` (P3-E2 M2; ledger X25; XE5, XE6; the E2 execution document's concurrency and crash rule): a data
// file bound to a dashboard as a named dataset, as one operation.
//
//   1. A repeated tool-use id answers its first result, before anything is read (a source file deleted since cannot
//      make a successful retry fail).
//   2. Everything the write stands on is read and validated before anything is written: the dashboard, the file (under
//      the session's real working directory, symlinks resolved; at most 16 MiB) or the asset the dashboard holds, its
//      format by its name's extension, the host's parse and the row key. Nothing is held over the disk read.
//   3. One serialized commit (`ArtifactStore.writeWithAssets`): its `prepare`, synchronous with the write, refuses a
//      future base and a descriptor that changed since `baseRevision` (the dashboard adapter's derived change index:
//      only the addressed dataset's descriptor is compared, so prose and other datasets merge); then the asset's row,
//      the session's `edited` link, the descriptor and the op's answer, all in one savepoint. The commit is the
//      operation's linearization point; a refusal or a failure leaves no asset, descriptor or op.
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative } from 'node:path';
import { DATASET_LIMITS, readDataset, removeDataset, setDataset, datasetSlotProblem, type DatasetDescriptor, type DatasetFormat } from '@artifacts/dashboard/datasets';
import { DatasetError, parseDataset, rowKeyProblem, type ParsedDataset } from '@artifacts/dashboard/parse';
import { DATASET_STATES } from '@artifacts/dashboard/states';
import type { ArtifactDatasetResult } from '@shared/maws/dashboard-tools';
import { mimeOf } from '@shared/files/mime';
import { parseToolArguments, TOOL_ERRORS } from '@shared/maws/tools';
import { dashboardAdapterOf } from '../dashboards';
import { actorOf, answering, lineageOf, opIdOf, pathUnderCwd, refuse, resolveArtifact, storeOf, ToolRefusal, type ArtifactToolDeps } from './artifact-context';
import { defineMawsTool, toolError, toolText, type McpToolDefinition } from './server';

const TOOL = 'artifact_dataset';
const FORMATS: Record<string, DatasetFormat> = { csv: 'csv', tsv: 'tsv', tab: 'tsv', json: 'json' };

/** The format a file's name gives it, by extension. */
function formatOf(name: string): DatasetFormat | null {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? null : (FORMATS[name.slice(dot + 1).toLowerCase()] ?? null);
}

// A path under the working directory once every symlink on it and on the directory is resolved (`pathUnderCwd` checks
// the words; this checks where they lead).
async function realFileUnder(cwd: string, path: string): Promise<string> {
  const named = pathUnderCwd(TOOL, cwd, path);
  const found = await stat(named).catch(() => null);
  if (!found?.isFile()) throw new ToolRefusal(TOOL_ERRORS.artifactNotAFile(TOOL, named));
  const [real, root] = await Promise.all([realpath(named), realpath(cwd)]);
  const inside = relative(root, real);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) throw refuse(TOOL, { reason: 'invalid', path: named }, `${named} leads to ${real}, outside the working directory ${root}`);
  if (found.size > DATASET_LIMITS.bytes) throw refuse(TOOL, { reason: 'tooLarge', size: found.size, limit: DATASET_LIMITS.bytes }, `${named} is ${found.size} bytes; a dataset is at most ${DATASET_LIMITS.bytes}`);
  return real;
}

export function artifactDatasetTool(deps: ArtifactToolDeps): McpToolDefinition {
  return defineMawsTool(TOOL, (args, ctx) =>
    deps.session.joined(opIdOf(ctx), () =>
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

        // what the write stands on, read and validated first
        let source: { bytes: Uint8Array; name: string; format: DatasetFormat; ref?: string } | null = null;
        let table: ParsedDataset | null = null;
        if (!input.remove) {
          if (input.path !== undefined) {
            const real = await realFileUnder(ctx.cwd, input.path);
            const name = basename(input.path);
            const format = formatOf(name);
            if (!format) throw refuse(TOOL, { reason: 'invalid', path: real }, `${name} is not a .csv, .tsv or .json file`);
            source = { bytes: await readFile(real), name, format };
          } else {
            const asset = await store.readCommitted(() => store.listAssets(artifactId).find((candidate) => candidate.ref === input.ref));
            if (!asset) throw refuse(TOOL, { reason: 'notFound', ref: input.ref }, `${input.artifact} holds no asset ${input.ref}; artifact_list_assets lists them`);
            const format = formatOf(asset.name);
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
              // the final check, inside the write's savepoint and synchronous with it
              const prepare = () => {
                if (!store.get(artifactId)) throw new ToolRefusal(TOOL_ERRORS.noArtifact(TOOL, input.artifact));
                const live = store.revision(artifactId);
                if (input.baseRevision > live) throw refuse(TOOL, { reason: 'invalid', liveRevision: live }, `baseRevision ${input.baseRevision} is newer than the live revision ${live}`);
                const doc = store.service.live(artifactId);
                existing = readDataset(doc, input.id);
                if (adapter.lastChange(artifactId, input.id) > input.baseRevision) {
                  const detail = existing ? 'replaced since your read' : 'removed since your read';
                  throw refuse(TOOL, { reason: 'conflict', dataset: input.id, detail, liveRevision: live }, `dataset "${input.id}" was ${detail.replace(' since your read', '')} since your read (revision ${input.baseRevision}); read the dashboard again`);
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
                  if (!source || !table) return removeDataset(doc, input.id);
                  const prior = existing as DatasetDescriptor | null;
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
                  inFrame: (revision) => {
                    recorded = table
                      ? { status: 'dataset', artifactId, id: input.id, revision, columns: table.columns, rows: table.rows.length, ...(table.warnings.length > 0 && { warnings: table.warnings }) }
                      : { status: 'dataset', artifactId, id: input.id, revision, removed: true };
                    op.record(recorded);
                  },
                },
              );
              return recorded!;
            },
            { actor },
          ),
        );
        return toolText(answer);
      }),
    ),
  );
}
