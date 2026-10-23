// A file binding keeps immutable data in the document; its local origin stays in host metadata, never in a portable
// document or export. A check changes no document state. An explicit reread makes a new human-attributed snapshot and
// version, using the same bounded, containment-checked reader as artifact_dataset.
import { createHash } from 'node:crypto';
import * as z from 'zod';
import { listDatasets, readDataset, setDataset, type DatasetDescriptor, type FileDatasetDescriptor } from '@artifacts/dashboard/datasets';
import { legacyDashboardFiles } from '@artifacts/dashboard/legacy';
import { DatasetError, parseDataset, rowKeyProblem } from '@artifacts/dashboard/parse';
import type { CommandOutput } from '@shared/ipc/schema';
import { mimeOf } from '@shared/files/mime';
import { ArtifactStoreError } from '../documents/errors';
import type { ArtifactStore } from '../documents/store';
import { datasetFileUnder, readDatasetFile } from '../tool-server/dataset-file';
import { dashboardAdapterOf } from '.';

const Origin = z.strictObject({ cwd: z.string().min(1), path: z.string().min(1) });
type FileOrigin = z.infer<typeof Origin>;
const HUMAN = { kind: 'human' } as const;
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
// Source plus provenance distinguishes a new bind by ref from an earlier path bind of the same asset. Restoring a
// retained descriptor can find its original source again; moving metadata alone does not break the file relationship.
const originKey = (artifactId: string, id: string, descriptor: DatasetDescriptor) =>
  `dashboard.fileSource:${artifactId}:${id}:${sha(JSON.stringify([descriptor.source, descriptor.updated]))}`;

/** Called in the binding's commit frame, so a failed bind never grants a local file relationship. */
export function rememberDatasetFile(store: ArtifactStore, artifactId: string, id: string, descriptor: DatasetDescriptor, origin: FileOrigin): void {
  store.storage.setMeta(originKey(artifactId, id, descriptor), JSON.stringify(origin));
}

function originOf(store: ArtifactStore, artifactId: string, id: string, descriptor: DatasetDescriptor): FileOrigin | null {
  const raw = store.storage.getMeta(originKey(artifactId, id, descriptor));
  if (!raw) return null;
  try {
    const parsed = Origin.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class DatasetFiles {
  // One entry per current file source, bounded by each dashboard's dataset limit. No row data is cached here.
  private readonly checked = new Map<string, { stamp: string; sha256: string }>();

  constructor(private readonly store: ArtifactStore) {}

  private dashboard(artifactId: string) {
    const artifact = this.store.get(artifactId);
    if (!artifact) throw new ArtifactStoreError('notFound', `no dashboard ${artifactId}`);
    if (artifact.kind !== 'dashboard') throw new ArtifactStoreError('invalid', 'only a dashboard has dataset files');
    const doc = this.store.service.live(artifactId);
    if (legacyDashboardFiles(doc)) throw new ArtifactStoreError('invalid', 'this legacy dashboard is read-only');
    return doc;
  }

  async check(artifactId: string): Promise<CommandOutput<'artifacts.datasetFiles'>> {
    const captured = await this.store.readCommitted(() => ({ revision: this.store.revision(artifactId), datasets: listDatasets(this.dashboard(artifactId)) }));
    const files: CommandOutput<'artifacts.datasetFiles'>['files'] = [];
    for (const { id, descriptor } of captured.datasets) {
      if (descriptor.source.kind !== 'file') continue;
      const origin = originOf(this.store, artifactId, id, descriptor);
      // Older bindings and uploaded snapshots have no retained project path. Never guess one from a basename.
      if (!origin) continue;
      const key = originKey(artifactId, id, descriptor);
      let state: 'current' | 'changed' | 'unavailable';
      try {
        const file = await datasetFileUnder(origin.cwd, origin.path);
        if (file.root !== origin.cwd) throw new Error('the project folder moved outside its recorded root');
        let cached = this.checked.get(key);
        if (cached?.stamp !== file.stamp) {
          cached = { stamp: file.stamp, sha256: sha(await readDatasetFile(file)) };
          // Bound across dashboards and obsolete descriptors too, not just the currently displayed dashboard.
          if (this.checked.size >= 256) this.checked.delete(this.checked.keys().next().value!);
          this.checked.set(key, cached);
        }
        state = cached.sha256 === descriptor.source.sha256 ? 'current' : 'changed';
      } catch {
        this.checked.delete(key);
        state = 'unavailable';
      }
      files.push({ id, ref: descriptor.source.ref, state });
    }
    return { revision: captured.revision, files };
  }

  async reread(artifactId: string, id: string, baseRevision: number): Promise<CommandOutput<'artifacts.rereadDatasetFile'>> {
    const adapter = dashboardAdapterOf(this.store);
    if (!adapter) throw new ArtifactStoreError('invalid', 'dashboards are not registered');
    const changed = () => new ArtifactStoreError('invalid', 'This dataset changed. Check the dashboard again before rereading.');
    const captured = await this.store.readCommitted(() => {
      const doc = this.dashboard(artifactId);
      const descriptor = readDataset(doc, id);
      if (baseRevision > this.store.revision(artifactId) || adapter.lastChange(artifactId, id) > baseRevision) throw changed();
      if (!descriptor || descriptor.source.kind !== 'file') throw changed();
      const origin = originOf(this.store, artifactId, id, descriptor);
      if (!origin) throw new ArtifactStoreError('invalid', 'The original project path was not retained for this snapshot.');
      return { descriptor: descriptor as FileDatasetDescriptor, origin, identity: adapter.lastChange(artifactId, id) };
    });
    const { descriptor, origin, identity } = captured;
    // Read and validate before any write. A removed, invalid or escaped source leaves the last good data intact.
    let bytes: Uint8Array;
    try {
      const file = await datasetFileUnder(origin.cwd, origin.path);
      if (file.root !== origin.cwd) throw new Error('the project folder moved outside its recorded root');
      bytes = await readDatasetFile(file);
    } catch {
      throw new ArtifactStoreError('invalid', 'The source file could not be read safely from its project folder.');
    }
    if (descriptor.source.kind !== 'file') throw changed();
    const table = parseDataset(bytes, descriptor.source.format);
    if (table instanceof DatasetError) throw new ArtifactStoreError(table.kind, `The source file was not reread: ${table.reason}`);
    const problem = descriptor.rowKey === undefined ? null : rowKeyProblem(table, descriptor.rowKey);
    if (problem) throw new ArtifactStoreError('invalid', `The source file was not reread: ${problem}`);
    const at = Math.max(Date.now(), descriptor.updated.at + 1);
    const source = descriptor.source;
    let versionId: number | null = null;
    const revision = await this.store.writeWithAssets(artifactId, HUMAN, [{ bytes, name: source.name, mime: mimeOf(source.name) }], (doc, refs) => {
      setDataset(doc, id, {
        ...descriptor,
        source: { ...source, ref: refs[0]!.ref, sha256: sha(bytes), size: bytes.length },
        columns: table.columns, rows: table.rows.length, updated: { at, by: HUMAN }, state: { status: 'ok', at },
      });
    }, {
      prepare: () => {
        this.dashboard(artifactId);
        if (adapter.lastChange(artifactId, id) !== identity) throw changed();
      },
      inFrame: () => {
        const next = readDataset(this.store.service.live(artifactId), id)!;
        rememberDatasetFile(this.store, artifactId, id, next, origin);
        versionId = this.store.versionInFrame(this.store.entity(artifactId)!, { kind: 'auto', actor: HUMAN, summary: `Reread ${descriptor.title} from ${source.name}` });
      },
    });
    return { revision, versionId: versionId! };
  }
}

const files = new WeakMap<ArtifactStore, DatasetFiles>();
export function datasetFilesOf(store: ArtifactStore): DatasetFiles {
  let found = files.get(store);
  if (!found) files.set(store, (found = new DatasetFiles(store)));
  return found;
}
