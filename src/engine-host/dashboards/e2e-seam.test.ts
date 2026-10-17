// P3-E2 M6 (P3-E Decision Log 36 (1)): the dashboard's acceptance seam in the engine host, requested only under both
// MAWS_E2E=1 and MAWS_DASHBOARD_E2E=1. A session's calls run the `maws` server's own tools with a real scratch working
// directory as cwd: the agent's create from markdown, its bind of a file it wrote there, its read, a replay of one
// tool-use id, a path outside the directory refused, and B's thread tools on the dashboard; each answer carries its wall
// time and the host loop around it; commands also arrive over the file channel.
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerDocumentKind, type DocumentKind } from '../documents/kinds/document';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';
import { registerDashboards, type Dashboards } from '.';
import { DashboardE2eSeam, dashboardE2eSeamRequested, startDashboardE2eSeam, type DashboardCallAnswer, type DashboardSeamAnswer } from './e2e-seam';

let data: string;
let world: { storage: SqliteDocumentStorage; service: DocumentService; store: ArtifactStore; kind: DocumentKind; dashboards: Dashboards };
let seam: DashboardE2eSeam;
beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'maws-dashboard-seam-'));
  const storage = SqliteDocumentStorage.open(join(data, 'store.sqlite'), { log: () => {} });
  const service = new DocumentService(storage, { log: () => {}, kindOf: (id) => storage.kindOf(id) });
  const store = new ArtifactStore(service, storage, { root: data, log: () => {} });
  world = { storage, service, store, kind: registerDocumentKind(store), dashboards: registerDashboards({ documents: { store, service } }) };
  seam = new DashboardE2eSeam(store, join(data, 'cwd'));
});
afterEach(() => {
  seam.close();
  world.dashboards.close();
  world.kind.close();
  world.store.close();
  world.service.close();
  world.storage.close();
  rmSync(data, { recursive: true, force: true });
});

const MARKDOWN = ['# Sales', '', 'Revenue by region. ^p1', '', `:::chart {spec-json='{"view":"bar","x":"region","y":"sales","title":"Sales by region"}'}`, 'sales', ':::', '^c1'].join('\n');
const answered = (answer: DashboardSeamAnswer): DashboardCallAnswer => {
  if (!answer.ok || !('isError' in answer)) throw new Error(`not a call's answer: ${JSON.stringify(answer)}`);
  return answer;
};
const result = <T,>(answer: DashboardSeamAnswer): T => {
  const call = answered(answer);
  if (call.isError) throw new Error(`a refusal: ${call.text}`);
  return call.result as T;
};

describe('dashboardE2eSeamRequested', () => {
  it('is requested only under both the e2e mark and the dashboard flag', () => {
    expect(dashboardE2eSeamRequested({ MAWS_E2E: '1', MAWS_DASHBOARD_E2E: '1' })).toBe(true);
    expect(dashboardE2eSeamRequested({ MAWS_E2E: '1' })).toBe(false);
    expect(dashboardE2eSeamRequested({ MAWS_DASHBOARD_E2E: '1' })).toBe(false);
    expect(dashboardE2eSeamRequested({ MAWS_E2E: '0', MAWS_DASHBOARD_E2E: '1' })).toBe(false);
    expect(dashboardE2eSeamRequested({ MAWS_E2E: '1', MAWS_DASHBOARD_E2E: 'true' })).toBe(false);
  });
});

describe('the seam’s commands', () => {
  it('gives each session a real directory of its own under the seam’s, never `/`, and refuses a name that is not one', async () => {
    const { cwd } = (await seam.run({ cmd: 'cwd', session: 'A' })) as { ok: true; cwd: string };
    expect(cwd).toBe(join(data, 'cwd', 'A'));
    expect(existsSync(cwd)).toBe(true);
    expect(await seam.run({ cmd: 'cwd', session: '../up' })).toMatchObject({ ok: false });
  });

  it('runs the agent’s create, its bind of a file it wrote in its directory and its read through the server’s own tools, timing each', async () => {
    const { cwd } = (await seam.run({ cmd: 'cwd', session: 'A' })) as { ok: true; cwd: string };
    const created = result<{ artifactId: string; kind: string; revision: number }>(await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_create', args: { kind: 'dashboard', title: 'Board', content: MARKDOWN } }));
    expect(created.kind).toBe('dashboard');
    writeFileSync(join(cwd, 'sales.csv'), 'region,sales\nSeoul,120\nBusan,98\n');
    const bind = await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_dataset', args: { artifact: created.artifactId, id: 'sales', path: 'sales.csv', title: 'Sales', baseRevision: 'last' } });
    const bound = result<{ status: string; rows: number; revision: number; columns: { name: string }[] }>(bind);
    expect(bound).toMatchObject({ status: 'dataset', rows: 2 });
    expect(bound.columns.map((c) => c.name)).toEqual(['region', 'sales']);
    expect(bound.revision).toBe(world.store.revision(created.artifactId));
    const timing = answered(bind);
    expect(timing.wallMs).toBeGreaterThan(0);
    expect(Math.abs(timing.endedAt - Date.now())).toBeLessThan(5_000);
    expect(timing.loop.max).toBeGreaterThan(0);
    const read = result<{ revision: number; datasets: { id: string; rows: number }[] }>(await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_read', args: { artifact: created.artifactId } }));
    expect(read.datasets).toEqual([expect.objectContaining({ id: 'sales', rows: 2 })]);
    expect(world.store.get(created.artifactId)).toMatchObject({ kind: 'dashboard' });
  });

  it('answers a repeated tool-use id with its first result, the source file gone since; a path outside the directory is refused', async () => {
    const { cwd } = (await seam.run({ cmd: 'cwd', session: 'A' })) as { ok: true; cwd: string };
    const { artifactId } = result<{ artifactId: string }>(await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_create', args: { kind: 'dashboard', title: 'Board', content: MARKDOWN } }));
    writeFileSync(join(cwd, 'sales.csv'), 'region,sales\nSeoul,120\n');
    const args = { artifact: artifactId, id: 'sales', path: 'sales.csv', baseRevision: 'last' };
    const first = answered(await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_dataset', args, toolUseId: 'toolu_replayed' }));
    rmSync(join(cwd, 'sales.csv'));
    const again = answered(await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_dataset', args, toolUseId: 'toolu_replayed' }));
    expect(again.isError).toBe(false);
    expect(again.result).toEqual(first.result);
    const outside = answered(await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_dataset', args: { ...args, path: '../../store.sqlite' } }));
    expect(outside.isError).toBe(true);
  });

  it('serves B’s thread tools on the dashboard, and answers an unknown tool or command by name', async () => {
    const { artifactId } = result<{ artifactId: string }>(await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_create', args: { kind: 'dashboard', title: 'Board', content: MARKDOWN } }));
    expect(result<{ threads: unknown[] }>(await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_comments', args: { artifact: artifactId } })).threads).toEqual([]);
    expect(await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_publish' as never, args: {} })).toMatchObject({ ok: false, error: expect.stringContaining('artifact_publish') });
    expect(await seam.run({ cmd: 'nope' } as never)).toMatchObject({ ok: false, error: expect.stringContaining('nope') });
    expect(await seam.run({ cmd: 'release', session: 'A' })).toEqual({ ok: true });
  });
});

describe('startDashboardE2eSeam', () => {
  it('serves its commands as files in `<dir>/in`, answered in `<dir>/out`', async () => {
    const dir = join(data, 'dashboard-e2e');
    const served = startDashboardE2eSeam(world.store, dir, () => {});
    try {
      writeFileSync(join(dir, 'in', '00000001.json.tmp'), JSON.stringify({ cmd: 'cwd', session: 'A' }));
      renameSync(join(dir, 'in', '00000001.json.tmp'), join(dir, 'in', '00000001.json'));
      const out = join(dir, 'out', '00000001.json');
      for (let k = 0; k < 200 && !existsSync(out); k++) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({ ok: true, cwd: join(dir, 'cwd', 'A') });
    } finally {
      served.close();
    }
  });
});
