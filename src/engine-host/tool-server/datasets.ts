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
import { constants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative } from 'node:path';
import { DATASET_LIMITS, readDataset, removeDataset, setDataset, datasetSlotProblem, type DatasetDescriptor, type DatasetFormat } from '@artifacts/dashboard/datasets';
import { DatasetError, parseDataset, rowKeyProblem, type ParsedDataset } from '@artifacts/dashboard/parse';
import { DATASET_STATES } from '@artifacts/dashboard/states';
import { legacyDashboardFiles, legacyDashboardReason } from '@artifacts/dashboard/legacy';
import type { ArtifactDatasetResult } from '@shared/maws/dashboard-tools';
import { mimeOf } from '@shared/files/mime';
import type { MawsDatasetRefreshOutcome } from '@shared/ipc/schema/maws'; // E3
import type { DatasetRefreshRequests } from '../connectors/dataset-requests'; // E3
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
// the words; this checks where they lead), with the identity of the regular file found there.
interface ValidatedFile {
  named: string;
  real: string;
  root: string;
  dev: number;
  ino: number;
}
const outsideCwd = (file: Pick<ValidatedFile, 'named' | 'real' | 'root'>) =>
  refuse(TOOL, { reason: 'invalid', path: file.named }, `${file.named} leads to ${file.real}, outside the working directory ${file.root}`);
const tooLarge = (named: string, size: number) =>
  refuse(TOOL, { reason: 'tooLarge', size, limit: DATASET_LIMITS.bytes }, `${named} is ${size} bytes; a dataset is at most ${DATASET_LIMITS.bytes}`);

async function realFileUnder(cwd: string, path: string): Promise<ValidatedFile> {
  const named = pathUnderCwd(TOOL, cwd, path);
  const found = await stat(named).catch(() => null);
  if (!found?.isFile()) throw new ToolRefusal(TOOL_ERRORS.artifactNotAFile(TOOL, named));
  const [real, root] = await Promise.all([realpath(named), realpath(cwd)]);
  const inside = relative(root, real);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) throw outsideCwd({ named, real, root });
  // the resolved path itself, not followed: what the read must open
  const validated = await lstat(real).catch(() => null);
  if (!validated?.isFile()) throw outsideCwd({ named, real, root });
  if (validated.size > DATASET_LIMITS.bytes) throw tooLarge(named, validated.size);
  return { named, real, root, dev: validated.dev, ino: validated.ino };
}

// macOS 11 and later: the kernel refuses a symlink anywhere on the path it walks, not only in its last component (as
// src/main/files/service.ts:109-116 opens a session's files). Node's fs.constants does not carry it, so it is passed
// numerically; it replaces O_NOFOLLOW, since macOS answers EINVAL for the two together, and refuses a last-component
// link with ELOOP as well. Linux ignores the bit, so there the open guards the last component alone and a directory
// above the file turned into a link after the containment check is a documented gap of the Linux unit lane (MAWS ships
// on macOS; E's Decision Log 41). O_NONBLOCK: a FIFO put in the file's place opens at once and is refused as not a
// regular file, never holding a thread.
const O_NOFOLLOW_ANY = 0x20000000;
const OPEN_FLAGS = process.platform === 'darwin' ? constants.O_RDONLY | constants.O_NONBLOCK | O_NOFOLLOW_ANY : constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW;

// E2 M6 (panel P1, E's Decision Logs 40 and 41): the validated file's bytes read through one descriptor, never the path
// again. The real path is opened through no link (OPEN_FLAGS), and the opened file must be the regular file validated
// (its device and inode), so a file replaced since validation, by a link out of the working directory, by another file
// or by a FIFO, is refused as the containment refusal; the read stops one byte past the cap, so a file grown since is
// refused by size.
async function readValidated(file: ValidatedFile): Promise<Uint8Array> {
  const handle = await open(file.real, OPEN_FLAGS).catch(() => null);
  if (!handle) throw outsideCwd(file);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== file.dev || opened.ino !== file.ino) throw outsideCwd(file);
    // sized by the opened file, one byte over to see it grow; a file that did grow is read on, never past the cap
    const chunks: Uint8Array[] = [];
    let length = 0;
    let room = Math.min(opened.size, DATASET_LIMITS.bytes) + 1;
    while (length <= DATASET_LIMITS.bytes) {
      const chunk = new Uint8Array(Math.min(room, DATASET_LIMITS.bytes + 1 - length));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      length += bytesRead;
      room = 1024 * 1024;
    }
    if (length > DATASET_LIMITS.bytes) throw tooLarge(file.named, Math.max(opened.size, length));
    return chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks);
  } finally {
    await handle.close();
  }
}

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
// E3 end

export function artifactDatasetTool(deps: ArtifactToolDeps & { refreshes?: Pick<DatasetRefreshRequests, 'ask'> /* E3 */ }): McpToolDefinition {
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
            case 'refused':
              if (settled.refusal !== null) throw refuse(TOOL, { reason: 'invalid', dataset: input.id }, `${settled.refusal}; nothing was published`);
              throw refuse(TOOL, { reason: 'unavailable', dataset: input.id }, notPublished(settled.outcome, named, query.server));
            default:
              throw refuse(TOOL, { reason: 'unavailable', dataset: input.id }, ENDED[settled.kind]);
          }
        }

        // what the write stands on, read and validated first
        let source: { bytes: Uint8Array; name: string; format: DatasetFormat; ref?: string } | null = null;
        let table: ParsedDataset | null = null;
        // E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1): a bound asset is held from its lookup to the
        // end of the write, so a query snapshot retired meanwhile keeps its bytes for the descriptor that names it (which
        // then adopts it)
        let held: { release(): void } | null = null;
        try {
          if (!input.remove && !input.source /* E3: a query reads nothing */) {
            if (input.path !== undefined) {
              const validated = await realFileUnder(ctx.cwd, input.path);
              const name = basename(input.path);
              const format = formatOf(name);
              if (!format) throw refuse(TOOL, { reason: 'invalid', path: validated.real }, `${name} is not a .csv, .tsv or .json file`);
              source = { bytes: await readValidated(validated), name, format };
            } else {
              const asset = await store.readCommitted(() => {
                const found = store.listAssets(artifactId).find((candidate) => candidate.ref === input.ref);
                if (found) held = store.holdAsset(artifactId, found.ref); // E3: in the lookup's turn
                return found;
              });
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
                    // E3 (R2): a query configured, never fetched: no snapshot, rows, columns or provenance
                    if (input.source) {
                      const { kind, server, tool, args, schedule, staleAfter } = input.source;
                      const description = input.description ?? prior?.description;
                      return setDataset(doc, input.id, {
                        title: input.title ?? prior?.title ?? input.id,
                        ...(description !== undefined && { description }),
                        ...(input.rowKey !== undefined && { rowKey: input.rowKey }),
                        source: { kind, server, tool, args, ...(schedule !== undefined && { schedule }), ...(staleAfter !== undefined && { staleAfter }), snapshot: null },
                        columns: [],
                        rows: 0,
                        state: { status: 'ok', at },
                      });
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
                    inFrame: (revision) => {
                      recorded = input.source
                        ? { status: 'dataset', artifactId, id: input.id, revision, columns: [], rows: 0, notFetched: true } // E3
                        : table
                        ? { status: 'dataset', artifactId, id: input.id, revision, columns: table.columns, rows: table.rows.length, ...(table.warnings.length > 0 && { warnings: table.warnings }) }
                        : { status: 'dataset', artifactId, id: input.id, revision };
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
        } finally {
          (held as { release(): void } | null)?.release(); // E3
        }
      }),
    ),
  );
}
