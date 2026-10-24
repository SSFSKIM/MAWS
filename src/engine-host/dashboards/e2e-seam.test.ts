// P3-E2 M6 (P3-E Decision Log 36 (1)): the dashboard's acceptance seam in the engine host, requested only under both
// MAWS_E2E=1 and MAWS_DASHBOARD_E2E=1. A session's calls run the `maws` server's own tools with a real scratch working
// directory as cwd: the agent's create from markdown, its bind of a file it wrote there, its read, a replay of one
// tool-use id, a path outside the directory refused, and B's thread tools on the dashboard; each answer carries its wall
// time and the host loop around it; commands also arrive over the file channel.
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDataset } from '@artifacts/dashboard/datasets';
import { registerDocumentKind, type DocumentKind } from '../documents/kinds/document';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';
import { registerDashboards, type Dashboards } from '.';
import { DashboardE2eSeam, dashboardE2eSeamRequested, startDashboardE2eSeam, type DashboardCallAnswer, type DashboardSeamAnswer } from './e2e-seam';

let data: string;
let world: { storage: SqliteDocumentStorage; service: DocumentService; store: ArtifactStore; kind: DocumentKind; dashboards: Dashboards };
let seam: DashboardE2eSeam;
const IDLE_MS = 80; // the service's idle unload, short here (the app's is 60 s)
beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'maws-dashboard-seam-'));
  const storage = SqliteDocumentStorage.open(join(data, 'store.sqlite'), { log: () => {} });
  const service = new DocumentService(storage, { log: () => {}, kindOf: (id) => storage.kindOf(id), idleUnloadMs: IDLE_MS });
  const store = new ArtifactStore(service, storage, { root: data, log: () => {} });
  world = { storage, service, store, kind: registerDocumentKind(store), dashboards: registerDashboards({ documents: { store, service } }) };
  seam = new DashboardE2eSeam(store, join(data, 'cwd'));
});
afterEach(() => {
  vi.restoreAllMocks(); // P3-F L247: the stepped Date.now
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
  // E-acc: a real publish reaches the artifact tool, rather than the seam refusing an unknown tool.
  it('routes artifact_publish through the same session authority as artifact_read', async () => {
    const created = result<{ artifactId: string }>(await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_create', args: { kind: 'html', title: 'Publish route', content: '<h1>Before</h1>' } }));
    const read = result<{ revision: number; files: Record<string, string> }>(await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_read', args: { artifact: created.artifactId } }));
    const path = Object.keys(read.files)[0]!;
    const published = result<{ status: string }>(await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_publish', args: { artifact: created.artifactId, baseRevision: read.revision, files: { [path]: '<h1>After</h1>' } } }));
    expect(published.status).toBe('published');
    const after = result<{ files: Record<string, string> }>(await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_read', args: { artifact: created.artifactId } }));
    expect(after.files[path]).toBe('<h1>After</h1>');
  });
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
    expect(await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_export' as never, args: {} })).toMatchObject({ ok: false, error: expect.stringContaining('artifact_export') });
    expect(await seam.run({ cmd: 'nope' } as never)).toMatchObject({ ok: false, error: expect.stringContaining('nope') });
    expect(await seam.run({ cmd: 'release', session: 'A' })).toEqual({ ok: true });
  });
});

describe('the measurement corrections (E2 M6 review; parent Decision Log 42)', () => {
  const bind = (session: string, artifactId: string, toolUseId?: string) => seam.run({ cmd: 'call', session, tool: 'artifact_dataset', args: { artifact: artifactId, id: 'sales', path: 'sales.csv', baseRevision: 'last' }, ...(toolUseId && { toolUseId }) });
  const write = async (session: string, csv: string) => writeFileSync(join(((await seam.run({ cmd: 'cwd', session })) as { cwd: string }).cwd, 'sales.csv'), csv);
  const created = async (session: string) => result<{ artifactId: string }>(await seam.run({ cmd: 'call', session, tool: 'artifact_create', args: { kind: 'dashboard', title: 'Board', content: MARKDOWN } })).artifactId;
  const loaded = async (artifactId: string) => ((await seam.run({ cmd: 'loaded', artifactId })) as { ok: true; loaded: boolean }).loaded;

  it('observes whether the host holds the document: held while a session holds it, unloaded once released and idle', async () => {
    const id = await created('A');
    expect(await loaded(id)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS * 3));
    expect(await loaded(id), 'the agent’s replica still holds it').toBe(true);
    expect(await seam.run({ cmd: 'release', session: 'A' })).toEqual({ ok: true });
    for (let k = 0; k < 50 && (await loaded(id)); k++) await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
    expect(await loaded(id)).toBe(false);
    expect(await loaded('no-such-artifact')).toBe(false);
  });

  it('answers when the call started, beside when it answered', async () => {
    const before = Date.now();
    const answer = answered(await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_create', args: { kind: 'dashboard', title: 'Board', content: MARKDOWN } }));
    expect(answer.startedAt).toBeGreaterThanOrEqual(before);
    expect(answer.startedAt).toBeLessThanOrEqual(answer.endedAt);
    expect(answer.endedAt).toBeLessThanOrEqual(Date.now());
  });

  it('times the first observed post-write revision announcement of a successful write, absent for a refusal or a replay, its subscription ended with the call', async () => {
    const subscribed: { off: number } = { off: 0 };
    const onChange = world.store.onChange.bind(world.store);
    world.store.onChange = (listener) => {
      const off = onChange(listener);
      return () => {
        subscribed.off += 1;
        off();
      };
    };
    const id = await created('A');
    await write('A', 'region,sales\nSeoul,1\n');
    const bound = answered(await bind('A', id, 'toolu_announced'));
    expect(bound.isError, bound.text).toBe(false);
    expect((bound.result as { revision: number }).revision).toBe(world.store.revision(id));
    expect(bound.announcedAt).toBeGreaterThanOrEqual(bound.startedAt);
    expect(bound.announcedAt).toBeLessThanOrEqual(bound.endedAt);
    // a refusal writes nothing: no announcement
    const refused = answered(await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_dataset', args: { artifact: id, id: 'sales', path: 'none.csv', baseRevision: 'last' } }));
    expect(refused.isError).toBe(true);
    expect(refused.announcedAt).toBeUndefined();
    // a replay answers its first result and writes nothing: no announcement either
    const replayed = answered(await bind('A', id, 'toolu_announced'));
    expect(replayed.result).toEqual(bound.result);
    expect(replayed.announcedAt).toBeUndefined();
    // an announcement of another artifact during a call is not the call's
    const other = await created('B');
    expect(answered(await seam.run({ cmd: 'call', session: 'B', tool: 'artifact_read', args: { artifact: other } })).announcedAt).toBeUndefined();
    const calls = 6; // two creates, the bind, the refusal, the replay and the read
    expect(subscribed.off, 'every call ends its subscription').toBe(calls);
  });

  it('matches each write’s announcement to the call’s own revision, the one carrying its marker, beside another session’s interleaved write (P3-F L247)', async () => {
    // Every `updated` the seam's listener takes is logged with the clock value it read (Date.now, stepped by one per
    // read, so a stamp names one delivery), the delivering subscription, and the bound descriptors' content SHA at that
    // revision; `announcedAt` is then traced back to the one delivery it came from.
    let clock = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => ++clock);
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    const descriptorSha = (artifactId: string, dataset: string) => (readDataset(world.store.service.live(artifactId), dataset)?.source as { sha256?: string } | undefined)?.sha256;
    const deliveries: { subscription: number; stamp: number; artifactId: string; revision: number; sales?: string; costs?: string }[] = [];
    let subscriptions = 0;
    const onChange = world.store.onChange.bind(world.store);
    world.store.onChange = (listener) => {
      const subscription = ++subscriptions;
      return onChange((change) => {
        listener(change);
        if (change.change === 'updated') deliveries.push({ subscription, stamp: clock, artifactId: change.artifactId, revision: change.revision, sales: descriptorSha(change.artifactId, 'sales'), costs: descriptorSha(change.artifactId, 'costs') });
      });
    };
    const traced = (answer: DashboardCallAnswer) => deliveries.find((d) => d.stamp === answer.announcedAt);

    const id = await created('A');
    await seam.run({ cmd: 'call', session: 'B', tool: 'artifact_read', args: { artifact: id } });
    // a unique marker per call, in the bytes each session binds
    const markerA = `region,sales\nSeoul,${clock % 100_000}\n`;
    const markerB = `region,costs\nBusan,${(clock % 100_000) + 1}\n`;
    await write('A', markerA);
    writeFileSync(join(((await seam.run({ cmd: 'cwd', session: 'B' })) as { cwd: string }).cwd, 'costs.csv'), markerB);
    // Starting both calls together does not guarantee their startup timers subscribe in the same turn. Hold the
    // real writes until both calls reach this boundary, so their announcement subscriptions overlap.
    let releaseWrites!: () => void;
    const bothWriting = new Promise<void>((resolve) => {
      releaseWrites = resolve;
    });
    let writes = 0;
    const writeWithAssets = world.store.writeWithAssets.bind(world.store);
    vi.spyOn(world.store, 'writeWithAssets').mockImplementation(async (...args) => {
      if (++writes === 2) releaseWrites();
      await bothWriting;
      return writeWithAssets(...args);
    });
    const before = subscriptions;
    const [a, b] = (
      await Promise.all([
        bind('A', id),
        seam.run({ cmd: 'call', session: 'B', tool: 'artifact_dataset', args: { artifact: id, id: 'costs', path: 'costs.csv', baseRevision: 'last' } }),
      ])
    ).map(answered);
    expect([a!.isError, b!.isError], `${a!.text} ${b!.text}`).toEqual([false, false]);
    const calls = [
      { answer: a!, revision: (a!.result as { revision: number }).revision, own: { sales: sha(markerA) } },
      { answer: b!, revision: (b!.result as { revision: number }).revision, own: { costs: sha(markerB) } },
    ];
    expect(calls[0]!.revision).not.toBe(calls[1]!.revision);
    const during = deliveries.filter((d) => d.subscription > before);
    // an announcement taken is its own call's: the delivery it came from is at the call's revision, whose descriptor
    // carries the call's own marker, never the other session's revision
    const announced = calls.filter((c) => c.answer.announcedAt !== undefined);
    expect(announced.length, 'the later write is always announced').toBeGreaterThan(0);
    for (const c of announced) expect(traced(c.answer)).toMatchObject({ artifactId: id, revision: c.revision, ...c.own });
    // when one batch committed both writes, the store announces only the batch's revision: the earlier call's own
    // revision is never announced, so it takes none (absent, which fails the scale row by name), not the other's
    for (const c of calls.filter((c) => c.answer.announcedAt === undefined)) expect(during.filter((d) => d.revision === c.revision)).toEqual([]);
    // the interleaving happened: a call's subscription delivered a revision that is not its call's, and did not take it
    const tookAt = new Map(announced.map((c) => [traced(c.answer)!.subscription, c.revision]));
    expect(during.some((d) => !tookAt.has(d.subscription) || d.revision !== tookAt.get(d.subscription)), 'one write was announced inside the other call').toBe(true);
  });

  it('mints fresh tool-use ids across a release and a recreated seam; a given id still replays its first answer', async () => {
    const id = await created('A');
    await write('A', 'region,sales\nSeoul,1\n');
    const first = answered(await bind('A', id));
    expect(first.toolUseId).toMatch(/^toolu_dash_[0-9a-f-]{36}_\d+$/);
    await seam.run({ cmd: 'release', session: 'A' });
    await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_read', args: { artifact: id } });
    await write('A', 'region,sales\nSeoul,1\nBusan,2\n');
    const afterRelease = answered(await bind('A', id));
    expect(afterRelease.toolUseId).not.toBe(first.toolUseId);
    expect(afterRelease.isError, afterRelease.text).toBe(false);
    expect((afterRelease.result as { rows: number }).rows, 'a fresh bind, not the first one replayed').toBe(2);
    // a seam made again over the same store (a host's seam after a restart)
    seam.close();
    seam = new DashboardE2eSeam(world.store, join(data, 'cwd'));
    await seam.run({ cmd: 'call', session: 'A', tool: 'artifact_read', args: { artifact: id } });
    await write('A', 'region,sales\nSeoul,1\nBusan,2\nJeju,3\n');
    const recreated = answered(await bind('A', id));
    expect([first.toolUseId, afterRelease.toolUseId]).not.toContain(recreated.toolUseId);
    expect((recreated.result as { rows: number }).rows, 'a fresh bind after the seam was made again').toBe(3);
    // an explicit id is the caller's: repeated after a release and a recreated seam, it replays its first answer
    const given = answered(await bind('A', id, 'toolu_given'));
    await seam.run({ cmd: 'release', session: 'A' });
    seam.close();
    seam = new DashboardE2eSeam(world.store, join(data, 'cwd'));
    await write('A', 'region,sales\nSeoul,9\n');
    const replayed = answered(await bind('A', id, 'toolu_given'));
    expect(replayed.toolUseId).toBe('toolu_given');
    expect(replayed.result).toEqual(given.result);
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
