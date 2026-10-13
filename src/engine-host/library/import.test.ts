// The X12 import walker (the P3-L document, M6a; Decision Log 4, 5, 22, 29, 30): the deliverables the owner's sessions
// made before P3, read from a seeded `<userData>/deliverables` tree with X12's lenient reader and landed in a real store
// in a temp directory through A's `importArtifact`, one call per record.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';
import { importDeliverables } from './import';

const DAY = 24 * 3_600_000;
const sid = (id: string) => id as AppSessionId;
const session = (id: string): Actor => ({ kind: 'session', appSessionId: sid(id) });
const uuid = (n: number) => `0f8e2a1c-4b3d-4e5f-8a7b-${n.toString(16).padStart(12, '0')}`;
const iso = (ms: number) => new Date(ms).toISOString();
const text = (path: string) => readFileSync(path, 'utf8');

let dir: string;
let deliverables: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
let now: number;
let logged: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-library-import-'));
  deliverables = join(dir, 'deliverables');
  now = Date.UTC(2026, 9, 13, 9, 0);
  storage = SqliteDocumentStorage.open(join(dir, 'artifacts', 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { now: () => now, log: () => {}, kindOf: (id) => storage.kindOf(id) });
  store = new ArtifactStore(service, storage, { root: join(dir, 'artifacts'), now: () => now, log: () => {} });
  logged = [];
});
afterEach(() => {
  store.close();
  service.close();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const run = () => importDeliverables(store, deliverables, (line) => logged.push(line));
const sessionDir = (appSessionId: string) => join(deliverables, appSessionId);
const recordFile = (appSessionId: string, id: string) => join(sessionDir(appSessionId), `${id}.json`);
function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`);
}

// An `artifact_create` record and its `artifact_update`s as E2 wrote them: version n copied to `<id>/v<n>.html`.
function seedHtml(appSessionId: string, id: string, options: { handle: string; title: string; versions: { at: number; markup: string; source?: string }[] }) {
  const versions = options.versions.map((version, i) => {
    const path = join(sessionDir(appSessionId), id, `v${i + 1}.html`);
    writeJson(path, version.markup);
    return { path, at: iso(version.at), toolUseId: `toolu_${i + 1}`, sourcePath: version.source ?? `/work/${options.handle}.html` };
  });
  const record = {
    id, appSessionId, kind: 'artifact', artifactId: options.handle, path: versions.at(-1)!.path, title: options.title, versions,
    toolUseId: 'toolu_1', createdAt: versions[0].at, updatedAt: versions.at(-1)!.at,
  };
  writeJson(recordFile(appSessionId, id), record);
  return record;
}

// A `send_file` record (or a download's): the file in place, one version, the basename as the title.
function seedFile(appSessionId: string, id: string, options: { name: string; at: number; caption?: string; write?: boolean }) {
  const path = join(dir, 'work', options.name);
  if (options.write !== false) writeJson(path, `contents of ${options.name}`);
  const record = {
    id, appSessionId, kind: 'file', path, title: options.name, ...(options.caption ? { caption: options.caption } : {}),
    versions: [{ path, at: iso(options.at) }], toolUseId: 'toolu_f', createdAt: iso(options.at),
  };
  writeJson(recordFile(appSessionId, id), record);
  return record;
}

describe('importDeliverables (M6a)', () => {
  it('imports each kind: an artifact as html with its handle, a file and a screenshot as file in place, with the session as creator and its created link', async () => {
    seedHtml('app-1', uuid(1), { handle: 'report', title: 'Quarterly report', versions: [{ at: now - 3 * DAY, markup: '<p>v1</p>', source: '/work/q3/report.html' }] });
    const sent = seedFile('app-1', uuid(2), { name: 'notes.txt', at: now - 2 * DAY, caption: 'the meeting notes' });
    const shot = join(sessionDir('app-2'), 'screenshots', `${uuid(3)}.png`);
    writeJson(shot, 'PNG');
    writeJson(recordFile('app-2', uuid(3)), {
      id: uuid(3), appSessionId: 'app-2', kind: 'screenshot', path: shot, sourceUrl: 'https://example.com/', versions: [{ path: shot, at: iso(now - DAY) }], createdAt: iso(now - DAY),
    });

    expect(await run()).toEqual({ imported: 3, skipped: 0, missing: 0, failed: 0 });
    expect(logged).toEqual([]);

    expect(store.get(uuid(1))).toEqual({
      id: uuid(1), kind: 'html', title: 'Quarterly report', handle: 'report', createdBy: session('app-1'), createdAt: now - 3 * DAY, updatedAt: now - 3 * DAY,
      lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false,
    });
    expect(store.contentRef(uuid(1)).ref.name).toBe('report.html'); // the page's own name, not the copy's `v1.html`
    expect(text(store.contentRef(uuid(1)).path)).toBe('<p>v1</p>');
    expect(store.links(uuid(1))).toEqual([{ artifactId: uuid(1), appSessionId: 'app-1', role: 'created', lastAt: now - 3 * DAY }]);
    expect(store.resolve('report', ['app-1'])).toBe(uuid(1)); // the agent's handle still finds it

    expect(store.get(uuid(2))).toMatchObject({ kind: 'file', title: 'notes.txt', linkedPath: sent.path, createdBy: session('app-1'), createdAt: now - 2 * DAY, updatedAt: now - 2 * DAY });
    expect(store.get(uuid(2))).not.toHaveProperty('handle');
    expect(store.contentRef(uuid(2)).path).toBe(sent.path);
    expect(store.get(uuid(3))).toMatchObject({ kind: 'file', title: `${uuid(3)}.png`, linkedPath: shot, createdBy: session('app-2') });
    expect(store.links(uuid(3)).map((link) => [link.appSessionId, link.role])).toEqual([['app-2', 'created']]);
    for (const id of [uuid(1), uuid(2), uuid(3)]) expect(store.listVersions(id).map((v) => v.kind)).toEqual(['import']);
  });

  it('imports a multi-version page’s copies in order at their own times, the latest live, its times from the record', async () => {
    const at = [now - 30 * DAY, now - 20 * DAY, now - 10 * DAY];
    seedHtml('app-1', uuid(1), { handle: 'pricing', title: 'Pricing v3', versions: at.map((t, i) => ({ at: t, markup: `<p>v${i + 1}</p>`, source: i === 2 ? '/work/pricing-final.html' : undefined })) });

    expect(await run()).toEqual({ imported: 1, skipped: 0, missing: 0, failed: 0 });
    const versions = store.listVersions(uuid(1));
    expect(versions.map((v) => [v.kind, v.at, v.actor])).toEqual(at.map((t) => ['import', t, session('app-1')]));
    expect(versions.map((v) => text(store.contentRef(uuid(1), v.seq).path))).toEqual(['<p>v1</p>', '<p>v2</p>', '<p>v3</p>']);
    expect(versions.map((v) => store.contentRef(uuid(1), v.seq).ref.name)).toEqual(['pricing.html', 'pricing.html', 'pricing-final.html']);
    expect(text(store.contentRef(uuid(1)).path)).toBe('<p>v3</p>');
    expect(store.get(uuid(1))).toMatchObject({ title: 'Pricing v3', createdAt: at[0], updatedAt: at[2] });
    expect(store.lastWrite(uuid(1))).toEqual({ actor: session('app-1'), at: at[2] });
  });

  it('skips a record whose id is already an artifact (A’s mirror), a deleted one included, without touching it', async () => {
    const live = await store.create({ kind: 'html', title: 'Made in the store', handle: 'live', content: { bytes: new TextEncoder().encode('<p>store</p>') } }, session('app-1'));
    const gone = await store.create({ kind: 'html', title: 'Deleted', content: { bytes: new TextEncoder().encode('<p>gone</p>') } }, session('app-1'));
    await store.delete(gone.id);
    const versions = store.listVersions(live.id);
    seedHtml('app-1', live.id, { handle: 'live', title: 'Mirror of it', versions: [{ at: now, markup: '<p>mirror</p>' }] });
    seedFile('app-1', gone.id, { name: 'gone.txt', at: now, write: false }); // its file gone too: skipped, not missing

    expect(await run()).toEqual({ imported: 0, skipped: 2, missing: 0, failed: 0 });
    expect(store.get(live.id)?.title).toBe('Made in the store');
    expect(store.listVersions(live.id)).toEqual(versions);
    expect(text(store.contentRef(live.id).path)).toBe('<p>store</p>');
    expect(store.get(gone.id)).toBeNull();
  });

  it('a rerun after a partial import lands what is left and skips what landed', async () => {
    seedHtml('app-1', uuid(1), { handle: 'a', title: 'A', versions: [{ at: now - 3 * DAY, markup: '<p>a</p>' }] });
    seedFile('app-1', uuid(2), { name: 'b.txt', at: now - 2 * DAY });
    seedFile('app-2', uuid(3), { name: 'c.txt', at: now - DAY });
    const land = store.importArtifact.bind(store);
    const crash = vi.spyOn(store, 'importArtifact').mockImplementation((input) => (input.id === uuid(2) ? Promise.reject(new Error('the host was killed')) : land(input)));

    expect(await run()).toEqual({ imported: 2, skipped: 0, missing: 0, failed: 1 });
    expect(logged).toEqual([expect.stringMatching(new RegExp(`${uuid(2)}.*the host was killed`))]);
    expect(store.get(uuid(2))).toBeNull();

    crash.mockRestore();
    logged = [];
    expect(await run()).toEqual({ imported: 1, skipped: 2, missing: 0, failed: 0 });
    expect(store.get(uuid(2))).toMatchObject({ kind: 'file', title: 'b.txt' });
    expect(await run()).toEqual({ imported: 0, skipped: 3, missing: 0, failed: 0 });
    expect(store.list().map((a) => a.id).sort()).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect(logged).toEqual([]);
  });

  it('counts a malformed record failed with a log line, passing over what is not a record, and imports the rest', async () => {
    writeJson(recordFile('app-1', uuid(1)), '{ not json');
    writeJson(recordFile('app-1', uuid(2)), { id: uuid(2), appSessionId: 'app-1', kind: 'video', path: '/x', versions: [], createdAt: iso(now) });
    const bad = seedFile('app-1', uuid(3), { name: 'when.txt', at: now });
    writeJson(recordFile('app-1', uuid(3)), { ...bad, createdAt: 'yesterday' });
    // a later build's keys are stripped, as X12's lenient reader does
    const later = seedFile('app-2', uuid(4), { name: 'later.txt', at: now - DAY });
    writeJson(recordFile('app-2', uuid(4)), { ...later, futureField: 1, versions: [{ ...later.versions[0], futureVersionField: true }] });
    writeJson(join(sessionDir('app-2'), 'notes.md'), 'not a record');
    writeJson(join(deliverables, 'stray.json'), { not: 'a session directory' });

    expect(await run()).toEqual({ imported: 1, skipped: 0, missing: 0, failed: 3 });
    expect(store.get(uuid(4))).toMatchObject({ title: 'later.txt' });
    expect(logged).toHaveLength(3);
    for (const id of [uuid(1), uuid(2), uuid(3)]) expect(logged.some((line) => line.includes(recordFile('app-1', id)))).toBe(true);
  });

  it('counts a record whose file is gone missing with a log line and lands nothing of it: a sent file, or one copy of a page', async () => {
    seedFile('app-1', uuid(1), { name: 'moved.pdf', at: now - DAY, write: false });
    seedHtml('app-1', uuid(2), { handle: 'page', title: 'Page', versions: [{ at: now - 2 * DAY, markup: '<p>v1</p>' }, { at: now - DAY, markup: '<p>v2</p>' }] });
    rmSync(join(sessionDir('app-1'), uuid(2), 'v1.html'));
    seedFile('app-1', uuid(3), { name: 'here.txt', at: now });

    expect(await run()).toEqual({ imported: 1, skipped: 0, missing: 2, failed: 0 });
    expect(store.get(uuid(1))).toBeNull();
    expect(store.get(uuid(2))).toBeNull();
    expect(logged).toEqual([expect.stringContaining('v1.html'), expect.stringContaining('moved.pdf')]); // oldest record first
  });

  it('imports without its handle a page whose handle the session already holds in the store, and says so', async () => {
    const mine = await store.create({ kind: 'html', title: 'Made after P3', handle: 'report', content: { bytes: new TextEncoder().encode('<p>new</p>') } }, session('app-1'));
    seedHtml('app-1', uuid(1), { handle: 'report', title: 'Made before P3', versions: [{ at: now - DAY, markup: '<p>old</p>' }] });
    seedHtml('app-2', uuid(2), { handle: 'report', title: 'Another session’s report', versions: [{ at: now - DAY, markup: '<p>theirs</p>' }] });

    expect(await run()).toEqual({ imported: 2, skipped: 0, missing: 0, failed: 0 });
    expect(store.get(uuid(1))).toMatchObject({ title: 'Made before P3' });
    expect(store.get(uuid(1))).not.toHaveProperty('handle');
    expect(store.get(uuid(2))).toMatchObject({ handle: 'report' }); // another session's handle is its own
    expect(store.resolve('report', ['app-1'])).toBe(mine.id);
    expect(logged).toEqual([expect.stringMatching(new RegExp(`${uuid(1)}.*report`))]);
  });

  it('finds nothing to do when there is no deliverables directory', async () => {
    expect(await run()).toEqual({ imported: 0, skipped: 0, missing: 0, failed: 0 });
    expect(logged).toEqual([]);
  });
});
