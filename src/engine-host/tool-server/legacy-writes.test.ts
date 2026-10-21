// P3-E2 M2 fix wave R1 (parent Decision Log 16): a held legacy dashboard's writes are refused by each writer after the
// operation's replay lookup and at the write itself. A publish an older build recorded for a pre-E2 dashboard answers
// its first result when retried after the upgrade, though the dashboard is held now; a dataset bind that started while
// the dashboard was a document of today, and finds it restored to its pre-E2 files while the bind read its file, is
// refused with no asset, descriptor or op written. Over A's real store, through the `maws` server's tool list.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDataset } from '@artifacts/dashboard/datasets';
import { legacyDashboardFiles } from '@artifacts/dashboard/legacy';
import { createDocument } from '@artifacts/document/tabs';
import type { Actor } from '@shared/artifacts/actor';
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

// A gate on the bind's file read: armed, the first read from a descriptor opened on the named path waits until it is
// released (the tool reads the validated file through one descriptor, E2 M6: `open`, its fstat, then `read`).
const gate = vi.hoisted(() => ({ path: null as string | null, reached: null as (() => void) | null, release: null as Promise<void> | null }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  const open = (async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    if (gate.path === null || String(args[0]) !== gate.path) return handle;
    gate.path = null;
    let first = true;
    return new Proxy(handle, {
      get(target, key) {
        if (key === 'read') {
          return async (...a: Parameters<typeof target.read>) => {
            if (first) {
              first = false;
              gate.reached?.();
              await gate.release;
            }
            return target.read(...a);
          };
        }
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
  }) as typeof actual.open;
  return { ...actual, default: { ...actual, open }, open };
});

const SELF = 'app-legacy' as AppSessionId;
const agent: Actor = { kind: 'session', appSessionId: SELF };
const human: Actor = { kind: 'human' };

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
  data = mkdtempSync(join(tmpdir(), 'maws-legacy-data-'));
  cwd = mkdtempSync(join(tmpdir(), 'maws-legacy-cwd-'));
  world = open();
});
afterEach(() => {
  gate.path = null;
  close();
  rmSync(data, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

let calls = 0;
const ctx = (toolUseId?: string): McpToolContext => ({ appSessionId: SELF, cwd, toolUseId: (toolUseId ?? `toolu_l${++calls}`) as ToolUseId, requestId: `r${++calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false });
const call = (name: string, args: unknown, toolUseId?: string) => world.tools.get(name)!.call(args, ctx(toolUseId));
const text = (result: McpToolResult) => (result.content[0] as { text: string }).text;

const preE2 = (doc: Parameters<NonNullable<Parameters<ArtifactStore['create']>[0]['initial']>>[0]) => {
  doc.get('files').setAttr('index.html', '<p>old</p>');
};

describe('a held legacy dashboard’s writes', () => {
  it('answers a publish an older build recorded before the upgrade with its first result; a fresh one is refused by name', async () => {
    const legacy = await world.store.create({ kind: 'dashboard', title: 'Old', handle: 'old', initial: preE2 }, agent);
    // what the build before E2 recorded for the session's publish of the dashboard's generic files
    const first = { status: 'published', artifactId: legacy.id, kind: 'dashboard', title: 'Old', revision: world.store.revision(legacy.id), changed: ['index.html'], kept: [], removed: [] };
    await world.store.withOp(`${SELF}/toolu_before`, 'artifact_publish', legacy.id, async (op) => {
      await world.store.service.inBatch(() => op.record(first));
      return first;
    });
    close();
    world = open(); // the upgrade
    const replayed = await call('artifact_publish', { artifact: 'old', baseRevision: 0, files: { 'index.html': 'again' } }, 'toolu_before');
    expect(replayed.isError).toBeFalsy();
    expect(JSON.parse(text(replayed))).toEqual(first);
    const fresh = await call('artifact_publish', { artifact: 'old', baseRevision: 0, files: { 'index.html': 'again' } });
    expect(artifactRefusalOf(text(fresh))).toMatchObject({ reason: 'invalid', kind: 'dashboard', held: ['index.html'] });
    expect(text(fresh)).toContain('create a new dashboard from their content');
  });

  it('refuses a bind whose dashboard was restored to its pre-E2 files while the bind read its file, writing nothing', async () => {
    const board = await world.store.create({ kind: 'dashboard', title: 'Board', handle: 'board', initial: preE2 }, agent);
    const before = await world.store.createVersion(board.id, { kind: 'named', actor: human, label: 'pre-E2' });
    await world.service.writeAs(board.id, human, (doc) => createDocument(doc, { title: 'Board' })); // a document of today
    expect(legacyDashboardFiles(world.service.live(board.id))).toBeNull();
    const base = world.store.revision(board.id);
    const path = join(cwd, 'sales.csv');
    writeFileSync(path, 'region,sales\nSeoul,1\n');
    let release!: () => void;
    gate.release = new Promise<void>((resolve) => (release = resolve));
    const reached = new Promise<void>((resolve) => (gate.reached = resolve));
    gate.path = realpathSync(path); // the bind opens the file where its symlinks lead
    const binding = call('artifact_dataset', { artifact: 'board', baseRevision: base, id: 'sales', path: 'sales.csv' }, 'toolu_race');
    let restored: number;
    try {
      await reached; // the bind is reading its file
      await world.store.restore(board.id, before!, human);
      expect(legacyDashboardFiles(world.service.live(board.id))).toEqual(['index.html']);
      restored = world.store.revision(board.id);
    } finally {
      // whatever threw above, the parked read goes on and the bind settles here, so its descriptor closes with the case
      release();
      await Promise.allSettled([binding]);
    }
    const answer = await binding;
    expect(artifactRefusalOf(text(answer))).toMatchObject({ reason: 'invalid', kind: 'dashboard', held: ['index.html'] });
    expect(world.store.revision(board.id)).toBe(restored);
    expect(world.store.listAssets(board.id)).toEqual([]);
    expect(readDataset(world.service.live(board.id), 'sales')).toBeNull();
    expect(await world.store.replayOf(`${SELF}/toolu_race`)).toEqual({ found: false });
  });
});
