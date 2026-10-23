import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDataset, setDataset, snapshotOf } from '@artifacts/dashboard/datasets';
import { applyV2, newDoc } from '@artifacts/yjs';
import type { HostOn } from '@shared/host/runtime';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import type { CommandName } from '@shared/ipc/schema';
import { openDocuments, type Documents } from '../documents';
import { registerArtifacts } from '../documents/register';
import { registerDocumentKind } from '../documents/kinds/document';
import { artifactDatasetTool } from '../tool-server/datasets';
import { ArtifactSession } from '../tool-server/artifact-context';
import { datasetReaderOf } from './read';
import { registerDashboards } from '.';

let root: string;
let cwd: string;
let documents: Documents;
let closeSurface: () => void;
let closeKinds: () => void;
let handlers: Map<string, (input: unknown) => Promise<unknown>>;
let tool: ReturnType<typeof artifactDatasetTool>;
let calls = 0;
const HUMAN = { kind: 'human' } as const;

function start() {
  documents = openDocuments(join(root, 'data'), () => {})!;
  const kind = registerDocumentKind(documents.store);
  const dashboard = registerDashboards({ documents });
  closeKinds = () => { dashboard.close(); kind.close(); };
  handlers = new Map();
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  closeSurface = registerArtifacts(on, () => true, { onDocPort: () => {} }, { documents, env: {} }).close;
  tool = artifactDatasetTool({ artifacts: () => documents.store, session: new ArtifactSession() });
}
function stop() { closeSurface(); closeKinds(); documents.close(); }
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-file-source-'));
  // The source remains outside MAWS's artifact storage, as a real project file does.
  writeFileSync(join(root, 'tasks.csv'), 'task,count\nDraft,2\n');
  cwd = root;
  start();
});
afterEach(() => { stop(); rmSync(root, { recursive: true, force: true }); });

async function call(name: string, input: unknown) {
  // Exercise the real registered route, including the boundary schemas, not a test-only reread entry point.
  const handler = handlers.get(name);
  expect(handler, `${name} is registered`).toBeDefined();
  const checked = validateCommandInput(name as CommandName, input);
  expect(checked.ok).toBe(true);
  if (!checked.ok) throw new Error('bad test input');
  const result = await handler!(checked.value);
  const output = validateCommandOutput(name as CommandName, result);
  expect(output.ok).toBe(true);
  return result as { revision: number; files: { id: string; ref: string; state: string }[]; versionId: number };
}
async function bind(path = 'tasks.csv', extra: Record<string, unknown> = {}) {
  const board = await documents.store.create({ kind: 'dashboard', title: 'Task board' }, HUMAN);
  const n = ++calls;
  const result = await tool.call({ artifact: board.id, id: 'tasks', baseRevision: documents.store.revision(board.id), path, ...extra }, {
    appSessionId: 'app-files' as AppSessionId, cwd, toolUseId: `file-${n}` as ToolUseId, requestId: `request-${n}` as RequestId,
    signal: new AbortController().signal, fromSubagent: false,
  });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  return board.id;
}
const rows = (id: string, ref: string) => datasetReaderOf(documents.store).read(id, ref, { format: 'csv' }).rows;

describe('file-backed dashboard datasets', () => {
  it('detects source changes without changing the dashboard, then rereads once as the human with a new version and the old snapshot intact', async () => {
    const id = await bind('tasks.csv', { rowKey: 'task', description: 'A project file' });
    const before = readDataset(documents.service.live(id), 'tasks')!;
    const old = await documents.store.createVersion(id, { kind: 'named', actor: HUMAN, label: 'Original' });
    const revision = documents.store.revision(id);
    expect(await call('artifacts.datasetFiles', { artifactId: id })).toEqual({ revision, files: [{ id: 'tasks', ref: before.source.kind === 'file' ? before.source.ref : '', state: 'current' }] });
    writeFileSync(join(cwd, 'tasks.csv'), 'task,count\nDraft,8\nReview,1\n');
    expect((await call('artifacts.datasetFiles', { artifactId: id })).files[0].state).toBe('changed');
    expect(documents.store.revision(id)).toBe(revision);
    expect(rows(id, snapshotOf(before)!.ref)).toEqual([['Draft', 2]]);

    const result = await call('artifacts.rereadDatasetFile', { artifactId: id, id: 'tasks', baseRevision: revision });
    const after = readDataset(documents.service.live(id), 'tasks')!;
    expect(after).toMatchObject({ title: 'tasks', description: 'A project file', rowKey: 'task', rows: 2, updated: { by: HUMAN }, state: { status: 'ok' } });
    expect(rows(id, snapshotOf(after)!.ref)).toEqual([['Draft', 8], ['Review', 1]]);
    expect(result.revision).toBeGreaterThan(revision);
    expect(documents.store.listVersions(id).find((version) => version.id === result.versionId)).toMatchObject({ seq: result.revision, actor: HUMAN, summary: expect.stringContaining('tasks') });
    const historical = newDoc();
    applyV2(historical, documents.store.versionState(id, old!));
    expect(readDataset(historical, 'tasks')).toEqual(before);
    expect(rows(id, snapshotOf(readDataset(historical, 'tasks')!)!.ref)).toEqual([['Draft', 2]]);
    historical.destroy();
    expect((await call('artifacts.datasetFiles', { artifactId: id })).files[0].state).toBe('current');
  });

  it('keeps the origin across host restart and notices atomic file replacements', async () => {
    const id = await bind();
    stop(); start();
    unlinkSync(join(cwd, 'tasks.csv'));
    writeFileSync(join(cwd, 'tasks.csv'), 'task,count\nDraft,9\n');
    const status = await call('artifacts.datasetFiles', { artifactId: id });
    expect(status.files[0].state).toBe('changed');
    await call('artifacts.rereadDatasetFile', { artifactId: id, id: 'tasks', baseRevision: status.revision });
    expect(rows(id, snapshotOf(readDataset(documents.service.live(id), 'tasks')!)!.ref)).toEqual([['Draft', 9]]);
  });

  it('does not overwrite a dataset edited between the source read and the commit', async () => {
    const id = await bind();
    const revision = documents.store.revision(id);
    const prior = readDataset(documents.service.live(id), 'tasks')!;
    const assets = documents.store.listAssets(id);
    const versions = documents.store.listVersions(id);
    writeFileSync(join(cwd, 'tasks.csv'), 'task,count\nDraft,7\n');
    const write = documents.store.writeWithAssets.bind(documents.store);
    const intercept = vi.spyOn(documents.store, 'writeWithAssets').mockImplementationOnce(async (...args) => {
      await documents.service.writeAs(id, HUMAN, (doc) => setDataset(doc, 'tasks', { ...prior, title: 'Concurrent edit' }));
      return write(...args);
    });
    await expect(call('artifacts.rereadDatasetFile', { artifactId: id, id: 'tasks', baseRevision: revision })).rejects.toThrow(/changed/i);
    intercept.mockRestore();
    expect(readDataset(documents.service.live(id), 'tasks')).toEqual({ ...prior, title: 'Concurrent edit' });
    expect(documents.store.listAssets(id)).toEqual(assets);
    expect(documents.store.listVersions(id)).toEqual(versions);
  });

  it('does not infer a local file relationship from an uploaded snapshot basename', async () => {
    const board = await documents.store.create({ kind: 'dashboard', title: 'Uploaded data' }, HUMAN);
    const { ref } = await documents.store.uploadAsset(board.id, new TextEncoder().encode('task,count\nDraft,2\n'), { name: 'tasks.csv', mime: 'text/csv' }, HUMAN);
    const result = await tool.call({ artifact: board.id, id: 'tasks', baseRevision: documents.store.revision(board.id), ref }, {
      appSessionId: 'app-files' as AppSessionId, cwd, toolUseId: `file-${++calls}` as ToolUseId, requestId: `request-${calls}` as RequestId,
      signal: new AbortController().signal, fromSubagent: false,
    });
    expect(result.isError).not.toBe(true);
    expect((await call('artifacts.datasetFiles', { artifactId: board.id })).files).toEqual([]);
    await expect(call('artifacts.rereadDatasetFile', { artifactId: board.id, id: 'tasks', baseRevision: documents.store.revision(board.id) })).rejects.toThrow(/path was not retained/);
  });

  it('refuses invalid rows, a stale action, and a source escaping the project without changing snapshots or versions', async () => {
    const id = await bind('tasks.csv', { rowKey: 'task' });
    const revision = documents.store.revision(id);
    const before = readDataset(documents.service.live(id), 'tasks');
    const assets = documents.store.listAssets(id);
    const versions = documents.store.listVersions(id);
    writeFileSync(join(cwd, 'tasks.csv'), 'task,count\nDraft,8\nDraft,1\n');
    await expect(call('artifacts.rereadDatasetFile', { artifactId: id, id: 'tasks', baseRevision: revision })).rejects.toThrow();
    expect(readDataset(documents.service.live(id), 'tasks')).toEqual(before);
    expect(documents.store.listAssets(id)).toEqual(assets);
    expect(documents.store.listVersions(id)).toEqual(versions);
    await expect(call('artifacts.rereadDatasetFile', { artifactId: id, id: 'tasks', baseRevision: revision - 1 })).rejects.toThrow(/changed/i);

    unlinkSync(join(cwd, 'tasks.csv'));
    symlinkSync('/etc/hosts', join(cwd, 'tasks.csv'));
    expect((await call('artifacts.datasetFiles', { artifactId: id })).files[0].state).toBe('unavailable');
    await expect(call('artifacts.rereadDatasetFile', { artifactId: id, id: 'tasks', baseRevision: revision })).rejects.toThrow();
    expect(documents.store.revision(id)).toBe(revision);
    expect(documents.store.listAssets(id)).toEqual(assets);
  });
});
