// P3-E2 M2 (ledger X25; XE6; the execution document's acceptance 1 and its concurrency and crash rule): a dashboard
// created from markdown through `artifact_create`, its data bound by `artifact_dataset` and read back by
// `artifact_read`, over A's real store with the document and dashboard kinds registered, through the `maws` server's own
// tool list. Validation precedes every write; the asset, the descriptor, the op row and the session's link land in one
// commit; a replayed tool-use id answers its first result; the stale rule compares the addressed descriptor alone.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataset, snapshotOf, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import { applyV2, newDoc } from '@artifacts/yjs';
import { datasetReaderOf } from '../dashboards/read';
import { KIND_GUIDES } from '@artifacts/types/guides';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { artifactRefusalOf } from '@shared/maws/tools';
import { registerDocumentKind, type DocumentKind } from '../documents/kinds/document';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';
import { registerDashboards, type Dashboards } from '../dashboards';
import { AskTable } from './asks';
import { HostBridge } from './bridge';
import { PaneBridge } from './panes';
import type { McpToolContext, McpToolDefinition, McpToolResult } from './server';
import { mawsTools } from './tools';

const SELF = 'app-self' as AppSessionId;
const OTHER = 'app-other' as AppSessionId;

interface World {
  storage: SqliteDocumentStorage;
  service: DocumentService;
  store: ArtifactStore;
  kind: DocumentKind;
  dashboards: Dashboards;
  tools: Map<string, McpToolDefinition>;
}
let data: string;
let cwd: string;
let world: World;
let calls = 0;

function open(): World {
  const storage = SqliteDocumentStorage.open(join(data, 'store.sqlite'), { log: () => {} });
  const service = new DocumentService(storage, { log: () => {}, kindOf: (id) => storage.kindOf(id) });
  const store = new ArtifactStore(service, storage, { root: data, log: () => {} });
  const kind = registerDocumentKind(store);
  const dashboards = registerDashboards({ documents: { store, service } });
  const list = mawsTools({ bridge: new PaneBridge({ show: () => {} }), capture: new HostBridge({ send: () => {}, answerMs: 1_000 }), asks: new AskTable(), askCancelled: () => {}, artifacts: () => store });
  return { storage, service, store, kind, dashboards, tools: new Map(list.map((tool) => [tool.name, tool])) };
}
function close(): void {
  world.dashboards.close();
  world.kind.close();
  world.store.close();
  world.service.close();
  world.storage.close();
}
beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'maws-datasets-data-'));
  cwd = mkdtempSync(join(tmpdir(), 'maws-datasets-cwd-'));
  world = open();
});
afterEach(() => {
  close();
  rmSync(data, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const ctx = (over: Partial<McpToolContext> = {}): McpToolContext => ({ appSessionId: SELF, cwd, toolUseId: `toolu_d${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false, ...over });
const call = (name: string, args: unknown, over: Partial<McpToolContext> = {}) => world.tools.get(name)!.call(args, ctx(over));
const text = (result: McpToolResult) => (result.content[0] as { text: string }).text;
const json = <T = Record<string, unknown>>(result: McpToolResult): T => {
  if (result.isError) throw new Error(`a refusal: ${text(result)}`);
  return JSON.parse(text(result)) as T;
};
const refusal = (result: McpToolResult) => {
  expect(result.isError, text(result)).toBe(true);
  return artifactRefusalOf(text(result));
};
const file = (name: string, content: string | Uint8Array) => {
  writeFileSync(join(cwd, name), content);
  return name;
};

const MARKDOWN = [
  '# Sales ^h1',
  '',
  'Revenue by region this quarter. ^p1',
  '',
  `:::chart {spec-json='{"view":"bar","x":"region","y":"sales","title":"Sales by region"}'}`,
  'sales',
  ':::',
  '^c1',
  '',
  `:::chart {spec-json='{"view":"table","title":"The rows"}'}`,
  'sales',
  ':::',
  '^c2',
].join('\n');
const SALES = 'region,sales\nSeoul,120\nBusan,98\nJeju,40\n';

type Read = { revision: number; kind: string; markdown: string; datasets?: { id: string; title: string; columns: unknown[]; rows: number; updated: { at: string; by: string } }[] };
type Bound = { status: string; artifactId: string; id: string; revision: number; columns: { name: string; type: string }[]; rows: number; warnings?: string[] };

async function created(): Promise<{ id: string; revision: number }> {
  const answer = json<{ artifactId: string; kind: string; revision: number; guide?: { guide: string } }>(await call('artifact_create', { kind: 'dashboard', title: 'Sales board', handle: 'board', content: MARKDOWN }));
  expect(answer.kind).toBe('dashboard');
  return { id: answer.artifactId, revision: answer.revision };
}
const bind = (args: Record<string, unknown>, over: Partial<McpToolContext> = {}) => call('artifact_dataset', { artifact: 'board', ...args }, over);

describe('artifact_dataset', () => {
  it('binds a CSV, a TSV and a JSON array to a dashboard made from markdown, answering columns, rows and the live revision', async () => {
    const answer = json<{ kind: string; guide?: { guide: string } }>(await call('artifact_create', { kind: 'dashboard', title: 'Sales board', handle: 'board', content: MARKDOWN }));
    expect(answer.guide?.guide).toBe(KIND_GUIDES.dashboard.guide);
    const read = json<Read>(await call('artifact_read', { artifact: 'board' }));
    expect(read.kind).toBe('dashboard');
    expect(read.markdown).toContain(':::chart');
    expect(read.datasets).toEqual([]);
    const bound = json<Bound>(await bind({ baseRevision: read.revision, id: 'sales', path: file('sales.csv', SALES) }));
    expect(bound).toEqual({
      status: 'dataset', artifactId: expect.any(String), id: 'sales', revision: world.store.revision(bound.artifactId), rows: 3,
      columns: [
        { name: 'region', type: 'string' },
        { name: 'sales', type: 'number' },
      ],
    });
    expect(bound.revision).toBeGreaterThan(read.revision);
    const tsv = json<Bound>(await bind({ baseRevision: bound.revision, id: 'tsv', path: file('costs.tsv', 'region\tcost\nSeoul\t3\n') }));
    const flat = json<Bound>(await bind({ baseRevision: tsv.revision, id: 'json', path: file('people.json', JSON.stringify([{ name: '김', age: 30 }, { name: 'Lee' }])) }));
    expect(flat).toMatchObject({ rows: 2, columns: [{ name: 'name', type: 'string' }, { name: 'age', type: 'number' }] });
    const after = json<Read>(await call('artifact_read', { artifact: 'board' }));
    expect(after.datasets!.map(({ id, title, rows, updated }) => ({ id, title, rows, by: updated.by }))).toEqual([
      { id: 'json', title: 'json', rows: 2, by: 'this session' },
      { id: 'sales', title: 'sales', rows: 3, by: 'this session' },
      { id: 'tsv', title: 'tsv', rows: 1, by: 'this session' },
    ]);
    const descriptor = readDataset(world.service.live(bound.artifactId), 'sales')!;
    expect(descriptor.source).toEqual({ kind: 'file', ref: 'assets/sales.csv', name: 'sales.csv', format: 'csv', sha256: expect.stringMatching(/^[0-9a-f]{64}$/), size: SALES.length });
    expect(descriptor.updated.by).toEqual({ kind: 'session', appSessionId: SELF });
    expect(world.store.links(bound.artifactId)).toEqual(expect.arrayContaining([expect.objectContaining({ appSessionId: SELF, role: 'edited' })]));
  });

  it('refuses a ragged file naming its line, and a file over 16 MiB by size, writing nothing', async () => {
    const { id, revision } = await created();
    const ragged = refusal(await bind({ baseRevision: revision, id: 'sales', path: file('bad.csv', 'a,b\n1,2\n3\n') }));
    expect(ragged).toMatchObject({ reason: 'invalid', line: 3 });
    const big = refusal(await bind({ baseRevision: revision, id: 'sales', path: file('big.csv', new Uint8Array(16 * 1024 * 1024 + 1)) }));
    expect(big).toMatchObject({ reason: 'tooLarge' });
    expect(world.store.revision(id)).toBe(revision);
    expect(world.store.listAssets(id)).toEqual([]);
    expect(readDataset(world.service.live(id), 'sales')).toBeNull();
  });

  it('answers a replayed tool-use id with its first answer, even after its file was deleted', async () => {
    const { revision } = await created();
    const toolUseId = 'toolu_replay' as ToolUseId;
    const first = json<Bound>(await bind({ baseRevision: revision, id: 'sales', path: file('sales.csv', SALES) }, { toolUseId }));
    unlinkSync(join(cwd, 'sales.csv'));
    expect(json<Bound>(await bind({ baseRevision: revision, id: 'sales', path: 'sales.csv' }, { toolUseId }))).toEqual(first);
  });

  it('refuses a second replacement of one dataset from the same base; unrelated prose and other datasets merge', async () => {
    const { id, revision } = await created();
    const base = json<Bound>(await bind({ baseRevision: revision, id: 'sales', path: file('a.csv', SALES) })).revision;
    // two sessions read at `base`; the other replaces first
    json(await bind({ artifact: id, baseRevision: base, id: 'sales', path: file('b.csv', 'region,sales\nSeoul,1\n') }, { appSessionId: OTHER }));
    expect(refusal(await bind({ baseRevision: base, id: 'sales', path: file('c.csv', 'region,sales\nSeoul,2\n') }))).toMatchObject({ reason: 'conflict', dataset: 'sales', detail: 'replaced since your read' });
    expect(readDataset(world.service.live(id), 'sales')!.source).toMatchObject({ name: 'b.csv' });
    // this session reads again; a prose edit and another dataset after that read do not refuse its bind
    const seen = json<Read>(await call('artifact_read', { artifact: 'board' })).revision;
    const other = json<Read>(await call('artifact_read', { artifact: id }, { appSessionId: OTHER }));
    json(await call('artifact_edit', { artifact: id, baseRevision: other.revision, ops: [{ op: 'replace_text', block: 'p1', old: 'this quarter', new: 'in Q4' }] }, { appSessionId: OTHER }));
    json(await bind({ artifact: id, baseRevision: other.revision, id: 'costs', path: file('costs.csv', 'k\n1\n') }, { appSessionId: OTHER }));
    expect(world.store.revision(id)).toBeGreaterThan(seen);
    json(await bind({ baseRevision: seen, id: 'sales', path: file('d.csv', 'region,sales\nSeoul,3\n') }));
    expect(readDataset(world.service.live(id), 'sales')!.source).toMatchObject({ name: 'd.csv' });
    expect(json<Read>(await call('artifact_read', { artifact: 'board' })).markdown).toContain('Revenue by region in Q4.');
  });

  it('refuses a removal race and a bind of an id another session created since the base', async () => {
    const { id: board, revision } = await created();
    const base = json<Bound>(await bind({ baseRevision: revision, id: 'sales', path: file('a.csv', SALES) })).revision;
    json(await bind({ artifact: board, baseRevision: base, id: 'sales', remove: true }, { appSessionId: OTHER }));
    expect(refusal(await bind({ baseRevision: base, id: 'sales', path: file('b.csv', SALES) }))).toMatchObject({ reason: 'conflict', detail: 'removed since your read' });
    json(await bind({ artifact: board, baseRevision: base, id: 'fresh', path: file('c.csv', 'k\n1\n') }, { appSessionId: OTHER }));
    expect(refusal(await bind({ baseRevision: base, id: 'fresh', path: file('d.csv', 'k\n2\n') }))).toMatchObject({ reason: 'conflict', dataset: 'fresh' });
  });

  it('refuses a future base, a document, a path outside the real working directory and an unknown format', async () => {
    const { revision } = await created();
    expect(refusal(await bind({ baseRevision: revision + 100, id: 'sales', path: file('a.csv', SALES) }))).toMatchObject({ reason: 'invalid', liveRevision: revision });
    json(await call('artifact_create', { kind: 'document', title: 'Doc', handle: 'doc', content: 'Hi ^p1' }));
    expect(refusal(await call('artifact_dataset', { artifact: 'doc', baseRevision: 0, id: 'sales', path: 'a.csv' }))).toMatchObject({ reason: 'invalid', kind: 'document' });
    const outside = mkdtempSync(join(tmpdir(), 'maws-datasets-outside-'));
    try {
      writeFileSync(join(outside, 'secret.csv'), SALES);
      expect(refusal(await bind({ baseRevision: revision, id: 'sales', path: join(outside, 'secret.csv') }))).toMatchObject({ reason: 'invalid' });
      mkdirSync(join(cwd, 'links'));
      symlinkSync(join(outside, 'secret.csv'), join(cwd, 'links', 'inside.csv'));
      expect(refusal(await bind({ baseRevision: revision, id: 'sales', path: 'links/inside.csv' }))).toMatchObject({ reason: 'invalid' });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
    expect(refusal(await bind({ baseRevision: revision, id: 'sales', path: file('a.xlsx', SALES) }))).toMatchObject({ reason: 'invalid' });
  });

  it('binds an asset the dashboard holds by ref, its format by its name; a ref it does not hold is refused', async () => {
    const { id, revision } = await created();
    const uploaded = json<{ ref: string }>(await call('artifact_upload_asset', { artifact: 'board', path: file('up.tsv', 'a\tb\n1\t2\n') }));
    const bound = json<Bound>(await bind({ baseRevision: revision, id: 'up', ref: uploaded.ref }));
    expect(bound.columns.map((c) => c.name)).toEqual(['a', 'b']);
    expect(readDataset(world.service.live(id), 'up')!.source).toMatchObject({ ref: uploaded.ref, format: 'tsv' });
    expect(refusal(await bind({ baseRevision: bound.revision, id: 'up', ref: 'assets/none.csv' }))).toMatchObject({ reason: 'notFound' });
  });

  it('refuses a row key that is not unique, and keeps the earlier title on a replacement', async () => {
    const { id, revision } = await created();
    expect(refusal(await bind({ baseRevision: revision, id: 'sales', path: file('a.csv', 'k\na\na\n'), rowKey: 'k' }))).toMatchObject({ reason: 'invalid' });
    const first = json<Bound>(await bind({ baseRevision: revision, id: 'sales', title: 'Sales 2026', description: 'by region', rowKey: 'region', path: file('b.csv', SALES) }));
    json(await bind({ baseRevision: first.revision, id: 'sales', path: file('c.csv', SALES.replace('120', '121')) }));
    expect(readDataset(world.service.live(id), 'sales')).toMatchObject({ title: 'Sales 2026', description: 'by region' });
    expect(readDataset(world.service.live(id), 'sales')!.rowKey).toBeUndefined();
  });

  it('removes a descriptor and keeps its bytes for history; removing nothing is refused', async () => {
    const { id, revision } = await created();
    const bound = json<Bound>(await bind({ baseRevision: revision, id: 'sales', path: file('a.csv', SALES) }));
    const removed = json<{ removed?: true; revision: number }>(await bind({ baseRevision: bound.revision, id: 'sales', remove: true }));
    expect(removed).toMatchObject({ status: 'dataset', id: 'sales', removed: true });
    expect(readDataset(world.service.live(id), 'sales')).toBeNull();
    expect(world.store.listAssets(id)).toHaveLength(1);
    expect(refusal(await bind({ baseRevision: removed.revision, id: 'sales', remove: true }))).toMatchObject({ reason: 'notFound' });
  });

  it('reads identical bytes bound as CSV and as TSV each as its descriptor names, from a version after removal and restart', async () => {
    const { id, revision } = await created();
    const bytes = 'a,b\tc\n1,2\t3\n';
    const asCsv = json<Bound>(await bind({ baseRevision: revision, id: 'comma', path: file('same.csv', bytes) }));
    const asTsv = json<Bound>(await bind({ baseRevision: asCsv.revision, id: 'tab', path: file('same.tsv', bytes) }));
    expect(asTsv.columns.map((c) => c.name)).toEqual(['a,b', 'c']);
    const comma = readDataset(world.service.live(id), 'comma')!;
    const tab = readDataset(world.service.live(id), 'tab')!;
    expect(tab.source).toMatchObject({ ref: comma.source.kind === 'file' ? comma.source.ref : '', format: 'tsv' }); // one asset, two tables
    const version = await world.store.createVersion(id, { kind: 'named', actor: { kind: 'human' }, label: 'both' });
    json(await bind({ baseRevision: asTsv.revision, id: 'comma', remove: true }));
    json(await bind({ baseRevision: world.store.revision(id), id: 'tab', remove: true }));
    close();
    world = open(); // a cold cache
    const old = newDoc();
    applyV2(old, world.store.versionState(id, version!));
    const names = (d: DatasetDescriptor) => datasetReaderOf(world.store).read(id, snapshotOf(d).ref, { format: snapshotOf(d).format }).columns.map((c) => c.name);
    expect(names(readDataset(old, 'tab')!)).toEqual(['a,b', 'c']);
    expect(names(readDataset(old, 'comma')!)).toEqual(['a', 'b\tc']);
    old.destroy();
  });

  it('leaves no asset, descriptor or op behind a write that failed before its commit, across a restart', async () => {
    const { id, revision } = await created();
    const setMeta = world.storage.setMeta.bind(world.storage);
    world.storage.setMeta = () => {
      throw new Error('the disk is full');
    };
    const toolUseId = 'toolu_fail' as ToolUseId;
    await expect(bind({ baseRevision: revision, id: 'sales', path: file('a.csv', SALES) }, { toolUseId })).rejects.toThrow(/the disk is full/);
    world.storage.setMeta = setMeta;
    close();
    world = open();
    expect(world.store.listAssets(id)).toEqual([]);
    expect(readDataset(world.service.live(id), 'sales')).toBeNull();
    // the op never applied: the same tool-use id runs afresh
    expect(json<Bound>(await bind({ baseRevision: revision, id: 'sales', path: 'a.csv' }, { toolUseId }))).toMatchObject({ rows: 3 });
  });
});
