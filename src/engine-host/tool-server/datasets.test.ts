// P3-E2 M2 (ledger X25; XE6; the execution document's acceptance 1 and its concurrency and crash rule): a dashboard
// created from markdown through `artifact_create`, its data bound by `artifact_dataset` and read back by
// `artifact_read`, over A's real store with the document and dashboard kinds registered, through the `maws` server's own
// tool list. Validation precedes every write; the asset, the descriptor, the op row and the session's link land in one
// commit; a replayed tool-use id answers its first result; the stale rule compares the addressed descriptor alone.
import { execFileSync } from 'node:child_process';
import { appendFileSync, constants, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { open as openFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDataset, snapshotOf, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import { applyV2, newDoc, stateV2 } from '@artifacts/yjs';
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

// E2 M6 (panel P1, E's Decision Log 40): a hook run once just before the validated file is opened or read, by its real
// path, where a concurrent workspace process could replace it; and one run once just after the opened file's own fstat
// answers, before its bytes are read (`grown`), where the process could lengthen it; `readTotal` counts the bytes read
// from that descriptor; and one run once just before the resolved path is lstat'd (`resolved`), after realpath and the
// containment check, where the process could turn a directory above the file into a link.
const race = vi.hoisted(() => ({ path: null as string | null, swap: null as (() => void) | null, grown: null as { path: string; grow: () => void } | null, readTotal: 0, resolved: null as { path: string; swap: () => void } | null }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  const fire = (path: unknown) => {
    if (race.path === null || String(path) !== race.path) return;
    const swap = race.swap;
    race.path = race.swap = null;
    swap?.();
  };
  const open = (async (...args: Parameters<typeof actual.open>) => {
    fire(args[0]);
    const handle = await actual.open(...args);
    const grown = race.grown;
    if (grown === null || String(args[0]) !== grown.path) return handle;
    race.grown = null;
    race.readTotal = 0;
    return new Proxy(handle, {
      get(target, key) {
        if (key === 'stat') {
          return async (...a: Parameters<typeof target.stat>) => {
            const stats = await target.stat(...a);
            grown.grow();
            return stats;
          };
        }
        if (key === 'read') {
          return async (...a: Parameters<typeof target.read>) => {
            const result = await target.read(...a);
            race.readTotal += result.bytesRead;
            return result;
          };
        }
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
  }) as typeof actual.open;
  const readFile = (async (...args: Parameters<typeof actual.readFile>) => {
    fire(args[0]);
    return actual.readFile(...args);
  }) as typeof actual.readFile;
  const lstat = (async (...args: Parameters<typeof actual.lstat>) => {
    const resolved = race.resolved;
    if (resolved !== null && String(args[0]) === resolved.path) {
      race.resolved = null;
      resolved.swap();
    }
    return actual.lstat(...args);
  }) as typeof actual.lstat;
  return { ...actual, default: { ...actual, open, readFile, lstat }, open, readFile, lstat };
});

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
  race.path = race.swap = null;
  race.grown = race.resolved = null;
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
    expect(descriptor.updated!.by).toEqual({ kind: 'session', appSessionId: SELF }); // E3: `updated` is optional in the type (a query never fetched has none); a file's always has it
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

  it('refuses a validated file replaced before it is opened, by a link outside, another file or a longer one, writing nothing (panel P1)', async () => {
    const { id, revision } = await created();
    const outside = mkdtempSync(join(tmpdir(), 'maws-datasets-outside-'));
    const nothingWritten = () => {
      expect(world.store.revision(id)).toBe(revision);
      expect(world.store.listAssets(id)).toEqual([]);
      expect(readDataset(world.service.live(id), 'sales')).toBeNull();
    };
    try {
      writeFileSync(join(outside, 'secret.csv'), 'secret\n1\n2\n3\n4\n5\n');
      const arm = (name: string, swap: () => void) => {
        race.path = realpathSync(join(cwd, name));
        race.swap = swap;
      };
      const toolUseId = 'toolu_race' as ToolUseId;
      file('sales.csv', SALES);
      arm('sales.csv', () => {
        unlinkSync(join(cwd, 'sales.csv'));
        symlinkSync(join(outside, 'secret.csv'), join(cwd, 'sales.csv'));
      });
      expect(refusal(await bind({ baseRevision: revision, id: 'sales', path: 'sales.csv' }, { toolUseId }))).toMatchObject({ reason: 'invalid' });
      expect(race.path).toBeNull(); // the swap ran
      nothingWritten();

      file('swapped.csv', SALES);
      file('other.csv', 'other\n1\n');
      arm('swapped.csv', () => renameSync(join(cwd, 'other.csv'), join(cwd, 'swapped.csv')));
      expect(refusal(await bind({ baseRevision: revision, id: 'sales', path: 'swapped.csv' }))).toMatchObject({ reason: 'invalid' });
      nothingWritten();

      file('grown.csv', SALES);
      arm('grown.csv', () => appendFileSync(join(cwd, 'grown.csv'), new Uint8Array(16 * 1024 * 1024)));
      expect(refusal(await bind({ baseRevision: revision, id: 'sales', path: 'grown.csv' }))).toMatchObject({ reason: 'tooLarge', limit: 16 * 1024 * 1024 });
      nothingWritten();

      // the refused op recorded nothing: its tool-use id binds the file afresh once the file is the one it names
      unlinkSync(join(cwd, 'sales.csv'));
      file('sales.csv', SALES);
      expect(json<Bound>(await bind({ baseRevision: revision, id: 'sales', path: 'sales.csv' }, { toolUseId }))).toMatchObject({ rows: 3 });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  // E2 M6 (the retained review's residual, E's Decision Log 41): O_NOFOLLOW guards the last component alone, so a
  // directory above the file turned into a link to an outside one after the containment check reached the outside
  // file, its own inode then validated and opened.
  // macOS: the kernel honours O_NOFOLLOW_ANY (0x20000000, macOS 11 and later), refusing a symlink anywhere on the path;
  // Linux ignores the bit, and its unit lane documents the gap (MAWS ships on macOS alone).
  it.skipIf(process.platform !== 'darwin')('refuses a directory above the file turned into an outside link after the containment check, writing nothing', async () => {
    const { id, revision } = await created();
    const outside = mkdtempSync(join(tmpdir(), 'maws-datasets-outside-'));
    try {
      mkdirSync(join(outside, 'data'));
      writeFileSync(join(outside, 'data', 'sales.csv'), 'secret\n1\n2\n3\n4\n5\n');
      mkdirSync(join(cwd, 'data'));
      file(join('data', 'sales.csv'), SALES);
      const toolUseId = 'toolu_ancestor' as ToolUseId;
      race.resolved = {
        path: realpathSync(join(cwd, 'data', 'sales.csv')),
        swap: () => {
          renameSync(join(cwd, 'data'), join(cwd, 'data-before'));
          symlinkSync(join(outside, 'data'), join(cwd, 'data'));
        },
      };
      expect(refusal(await bind({ baseRevision: revision, id: 'sales', path: 'data/sales.csv' }, { toolUseId }))).toMatchObject({ reason: 'invalid' });
      expect(race.resolved).toBeNull(); // the swap ran, between the containment check and the lstat
      expect(world.store.revision(id)).toBe(revision);
      expect(world.store.listAssets(id)).toEqual([]);
      expect(readDataset(world.service.live(id), 'sales')).toBeNull();
      // the op recorded nothing: once the directory is the one it names, the same tool-use id binds it
      unlinkSync(join(cwd, 'data'));
      renameSync(join(cwd, 'data-before'), join(cwd, 'data'));
      expect(json<Bound>(await bind({ baseRevision: revision, id: 'sales', path: 'data/sales.csv' }, { toolUseId }))).toMatchObject({ rows: 3 });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  // The guard under that refusal: if the kernel ignored the bit, the race above would silently reopen.
  // macOS: the kernel honours O_NOFOLLOW_ANY (0x20000000, macOS 11 and later; another kernel ignores the bit), and
  // refuses it beside O_NOFOLLOW (EINVAL), which is why the dataset read's flags carry it in O_NOFOLLOW's place.
  it.skipIf(process.platform !== 'darwin')('has a kernel that honours O_NOFOLLOW_ANY: a link above the file is refused, and the flag beside O_NOFOLLOW is invalid', async () => {
    const ANY = 0x20000000;
    mkdirSync(join(cwd, 'real'));
    file(join('real', 'a.csv'), SALES);
    symlinkSync(join(cwd, 'real'), join(cwd, 'alias'));
    const flags = constants.O_RDONLY | constants.O_NONBLOCK | ANY;
    await expect(openFile(join(cwd, 'alias', 'a.csv'), flags)).rejects.toMatchObject({ code: 'ELOOP' });
    await expect(openFile(join(realpathSync(cwd), 'real', 'a.csv'), flags | constants.O_NOFOLLOW)).rejects.toMatchObject({ code: 'EINVAL' });
    const handle = await openFile(join(realpathSync(cwd), 'real', 'a.csv'), flags); // a realpath opens
    await handle.close();
  });

  it('refuses a validated file replaced by a FIFO before it is opened, at once, and holds no thread (O_NONBLOCK)', async () => {
    const { id, revision } = await created();
    file('pipe.csv', SALES);
    race.path = realpathSync(join(cwd, 'pipe.csv'));
    race.swap = () => {
      unlinkSync(join(cwd, 'pipe.csv'));
      execFileSync('mkfifo', [join(cwd, 'pipe.csv')]);
    };
    const within = <T,>(promise: Promise<T>, ms: number): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error(`not answered within ${ms} ms`)), ms)));
      return Promise.race([promise, late]).finally(() => clearTimeout(timer));
    };
    expect(refusal(await within(bind({ baseRevision: revision, id: 'sales', path: 'pipe.csv' }), 1_000))).toMatchObject({ reason: 'invalid' });
    expect(race.path).toBeNull();
    expect(world.store.listAssets(id)).toEqual([]);
    // four binds at once would wait behind every threadpool thread a blocked open held; they complete
    const names = [0, 1, 2, 3].map((k) => file(`ok${k}.csv`, SALES));
    const answers = await within(Promise.all(names.map((name, k) => bind({ baseRevision: revision, id: `ok${k}`, path: name }))), 5_000);
    expect(answers.every((answer) => !answer.isError)).toBe(true);
  });

  it('reads a file lengthened after its descriptor\'s fstat on to the cap: one byte over is refused with nothing written, and never read past', async () => {
    const { id, revision } = await created();
    const limit = 16 * 1024 * 1024;
    const nothingWritten = () => {
      expect(world.store.revision(id)).toBe(revision);
      expect(world.store.listAssets(id)).toEqual([]);
      expect(readDataset(world.service.live(id), 'sales')).toBeNull();
    };
    const grow = (name: string, bytes: Uint8Array | string) => {
      race.grown = { path: realpathSync(join(cwd, name)), grow: () => appendFileSync(join(cwd, name), bytes) };
    };
    const toolUseId = 'toolu_grown' as ToolUseId;
    file('long.csv', SALES);
    grow('long.csv', new Uint8Array(limit + 1 - SALES.length).fill(0x61));
    expect(refusal(await bind({ baseRevision: revision, id: 'sales', path: 'long.csv' }, { toolUseId }))).toMatchObject({ reason: 'tooLarge', limit, size: limit + 1 });
    expect(race.grown).toBeNull(); // the growth ran, after fstat
    expect(race.readTotal).toBe(limit + 1); // the one byte over is read, and nothing past it
    nothingWritten();

    file('longer.csv', SALES);
    grow('longer.csv', new Uint8Array(limit + 4096).fill(0x61));
    expect(refusal(await bind({ baseRevision: revision, id: 'sales', path: 'longer.csv' }))).toMatchObject({ reason: 'tooLarge', limit });
    expect(race.readTotal).toBe(limit + 1);
    nothingWritten();

    // lengthened within the cap: the rows appended after fstat are read and bound
    file('more.csv', SALES);
    grow('more.csv', 'Daegu,7\n');
    expect(json<Bound>(await bind({ baseRevision: revision, id: 'sales', path: 'more.csv' }, { toolUseId }))).toMatchObject({ rows: 4 });
    expect(race.readTotal).toBe(SALES.length + 'Daegu,7\n'.length);
    expect(readDataset(world.service.live(id), 'sales')!.source).toMatchObject({ size: SALES.length + 'Daegu,7\n'.length });
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
    const toolUseId = 'toolu_remove' as ToolUseId;
    const removed = json<Record<string, unknown> & { revision: number }>(await bind({ baseRevision: bound.revision, id: 'sales', remove: true }, { toolUseId }));
    expect(removed).toEqual({ status: 'dataset', artifactId: id, id: 'sales', revision: world.store.revision(id) }); // parent Decision Log 16: no `removed` field
    expect(json(await bind({ baseRevision: bound.revision, id: 'sales', remove: true }, { toolUseId }))).toEqual(removed); // the replay records the same
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
    const names = (d: DatasetDescriptor) => datasetReaderOf(world.store).read(id, snapshotOf(d)!.ref, { format: snapshotOf(d)!.format }).columns.map((c) => c.name); // E3: snapshotOf is null only for a query never fetched
    expect(names(readDataset(old, 'tab')!)).toEqual(['a,b', 'c']);
    expect(names(readDataset(old, 'comma')!)).toEqual(['a', 'b\tc']);
    old.destroy();
  });

  it('refuses a JSON number too large to read before anything is written (fix wave I3)', async () => {
    const { id, revision } = await created();
    const answer = refusal(await bind({ baseRevision: revision, id: 'big', path: file('big.json', '[\n{"v": 1},\n{"v": 1e400}\n]') }));
    expect(answer).toMatchObject({ reason: 'invalid', line: 3 });
    expect(world.store.revision(id)).toBe(revision);
    expect(world.store.listAssets(id)).toEqual([]);
    expect(readDataset(world.service.live(id), 'big')).toBeNull();
  });

  it('holds a dashboard made from files before E2: read raw with its reason, every write refused by name, nothing changed, after a restart and at a version (fix wave I1)', async () => {
    const legacy = await world.store.create({ kind: 'dashboard', title: 'Old board', handle: 'old', initial: (doc) => {
      doc.get('files').setAttr('index.html', '<p>old</p>');
      doc.get('files').setAttr('data/sales.csv', SALES);
    } }, { kind: 'session', appSessionId: SELF });
    const version = await world.store.createVersion(legacy.id, { kind: 'named', actor: { kind: 'human' }, label: 'old' });
    const state = stateV2(world.service.live(legacy.id));
    const revision = world.store.revision(legacy.id);
    const check = async () => {
      const read = json<{ kind: string; files: Record<string, string>; held: { path: string; reasons: string[] }[] }>(await call('artifact_read', { artifact: 'old' }));
      expect(read.kind).toBe('dashboard');
      expect(read.files).toEqual({ 'data/sales.csv': SALES, 'index.html': '<p>old</p>' });
      expect(read.held.map((h) => h.path)).toEqual(['data/sales.csv', 'index.html']);
      expect(read.held[0]!.reasons[0]).toContain('create a new dashboard from their content');
      const atVersion = json<{ files: Record<string, string>; held: unknown[] }>(await call('artifact_read', { artifact: 'old', version: version! }));
      expect(atVersion.files['index.html']).toBe('<p>old</p>');
      for (const [name, args] of [
        ['artifact_edit', { artifact: 'old', baseRevision: revision, ops: [{ op: 'insert', after: 'x', markdown: 'Hi' }] }],
        ['artifact_publish', { artifact: 'old', baseRevision: revision, files: { 'index.html': 'new' } }],
        ['artifact_dataset', { artifact: 'old', baseRevision: revision, id: 'sales', path: file('n.csv', SALES) }],
      ] as const) {
        const answer = await call(name, args);
        expect(refusal(answer), name).toMatchObject({ reason: 'invalid', kind: 'dashboard', held: ['data/sales.csv', 'index.html'] });
        expect(text(answer), name).toContain('old: this dashboard was made before dashboards were documents');
      }
      expect(world.store.revision(legacy.id)).toBe(revision);
      expect(stateV2(world.service.live(legacy.id))).toEqual(state);
      expect(world.store.listAssets(legacy.id)).toEqual([]);
    };
    await check();
    close();
    world = open();
    await check();
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
