// The import write for P3-L's cutover (docs/doperpowers/plans/2026-10-12-p3-a-store.md, Decision Log 35f and 37b):
// `ArtifactStore.importArtifact` lands one X12 record as a byte-kind artifact under its own id, with its explicit times,
// creator, `import` versions and session links, in one transaction or not at all, and skips an id already present.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { ARTIFACT_MAX_BYTES } from '@shared/maws/tools';
import { ArtifactStoreError } from './errors';
import { DocumentService } from './service';
import { SqliteDocumentStorage } from './storage';
import { ArtifactStore, type ArtifactChanged, type ImportInput } from './store';

const DAY = 24 * 3_600_000;
const sid = (id: string) => id as AppSessionId;
const human: Actor = { kind: 'human' };
const first: Actor = { kind: 'session', appSessionId: sid('app-1') };
const second: Actor = { kind: 'session', appSessionId: sid('app-2') };
const ID = '0f8e2a1c-4b3d-4e5f-8a7b-6c5d4e3f2a1b';

let dir: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
let now: number;

function make(): void {
  storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { now: () => now, log: () => {}, kindOf: (id) => storage.kindOf(id) });
  store = new ArtifactStore(service, storage, { root: dir, now: () => now, log: () => {} });
}
function reopen(): void {
  store.close();
  service.close();
  storage.close();
  make();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-import-'));
  now = Date.UTC(2026, 9, 13, 9, 0);
  make();
});
afterEach(() => {
  store?.close();
  service?.close();
  storage?.close();
  rmSync(dir, { recursive: true, force: true });
});

const committed = (sql: string, ...params: string[]) => {
  const db = new DatabaseSync(join(dir, 'store.sqlite'), { readOnly: true });
  try {
    return db.prepare(sql).all(...params) as Record<string, unknown>[];
  } finally {
    db.close();
  }
};
const counts = (artifactId: string) =>
  Object.fromEntries(
    ['artifacts WHERE id', 'artifact_updates WHERE artifactId', 'artifact_versions WHERE artifactId', 'artifact_sessions WHERE artifactId'].map((from) => [
      from.split(' ')[0],
      committed(`SELECT COUNT(*) AS n FROM ${from} = ?`, artifactId)[0].n,
    ]),
  );
const page = (text: string) => new TextEncoder().encode(`<!doctype html><p>${text}</p>`);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

// An X12 `artifact` record as L's cutover would hand it over: two versions by two sessions, 40 and 10 days old.
function htmlRecord(over: Partial<ImportInput> = {}): ImportInput {
  return {
    id: ID,
    kind: 'html',
    title: 'Quarterly report',
    createdAt: now - 40 * DAY,
    updatedAt: now - 10 * DAY,
    createdBy: first,
    handle: 'report',
    projectId: 'proj-1',
    versions: [
      { at: now - 40 * DAY, actor: first, content: { bytes: page('v1'), name: 'report.html' } },
      { at: now - 10 * DAY, actor: second, content: { bytes: page('v2'), name: 'report.html' } },
    ],
    links: [
      { appSessionId: sid('app-1'), role: 'created', lastAt: now - 40 * DAY },
      { appSessionId: sid('app-2'), role: 'edited', lastAt: now - 10 * DAY },
    ],
    ...over,
  };
}

describe('ArtifactStore.importArtifact (Decision Log 35f, 37b)', () => {
  it('lands an html record under its own id with its times, creator, handle, project, import versions in order and links', async () => {
    const changes: ArtifactChanged[] = [];
    store.onChange((change) => changes.push(change));
    expect(await store.importArtifact(htmlRecord())).toEqual({ artifactId: ID, imported: true });

    expect(store.get(ID)).toEqual({
      id: ID,
      kind: 'html',
      title: 'Quarterly report',
      handle: 'report',
      projectId: 'proj-1',
      createdBy: first,
      createdAt: now - 40 * DAY,
      updatedAt: now - 10 * DAY,
      lastViewedAt: null,
      pinned: false,
      agentEditsAsSuggestions: false,
    });
    const versions = store.listVersions(ID);
    expect(versions.map((v) => [v.kind, v.at, v.actor])).toEqual([
      ['import', now - 40 * DAY, first],
      ['import', now - 10 * DAY, second],
    ]);
    expect(text(readFileSync(store.contentRef(ID).path))).toContain('v2');
    expect(text(readFileSync(store.contentRef(ID, versions[0].seq).path))).toContain('v1');
    expect(store.contentRef(ID).ref.name).toBe('report.html');
    expect(store.links(ID)).toEqual([
      { artifactId: ID, appSessionId: 'app-1', role: 'created', lastAt: now - 40 * DAY },
      { artifactId: ID, appSessionId: 'app-2', role: 'edited', lastAt: now - 10 * DAY },
    ]);
    expect(store.lastWrite(ID)).toEqual({ actor: second, at: now - 10 * DAY });
    expect(store.resolve('report', ['app-1'])).toBe(ID);
    expect(changes.map((c) => [c.artifactId, c.change])).toEqual([[ID, 'created']]);
    expect(counts(ID)).toEqual({ artifacts: 1, artifact_updates: 2, artifact_versions: 2, artifact_sessions: 2 }); // committed
  });

  it('lands a file record in place, its path the linked path', async () => {
    const report = join(dir, 'notes.txt');
    writeFileSync(report, 'notes');
    const input: ImportInput = {
      id: ID,
      kind: 'file',
      title: 'notes.txt',
      createdAt: now - DAY,
      updatedAt: now - DAY,
      createdBy: first,
      versions: [{ at: now - DAY, actor: first, content: { path: report } }],
      links: [{ appSessionId: sid('app-1'), role: 'created', lastAt: now - DAY }],
    };
    expect(await store.importArtifact(input)).toEqual({ artifactId: ID, imported: true });
    expect(store.get(ID)).toMatchObject({ kind: 'file', linkedPath: report, createdAt: now - DAY });
    expect(store.contentRef(ID)).toMatchObject({ path: report, ref: { name: 'notes.txt', size: 5 } });
    expect(store.listVersions(ID).map((v) => [v.kind, v.at])).toEqual([['import', now - DAY]]);
  });

  it('skips an id already present whole, a deleted one included, and a concurrent repeat imports once', async () => {
    const [a, b] = await Promise.all([store.importArtifact(htmlRecord()), store.importArtifact(htmlRecord({ title: 'Other' }))]);
    expect([a.imported, b.imported]).toEqual([true, false]);
    const before = counts(ID);
    expect(await store.importArtifact(htmlRecord({ title: 'Again', versions: [{ at: now, actor: human, content: { bytes: page('v3') } }] }))).toEqual({ artifactId: ID, imported: false });
    expect(counts(ID)).toEqual(before);
    expect(store.get(ID)?.title).toBe('Quarterly report');
    await store.delete(ID);
    expect(await store.importArtifact(htmlRecord())).toEqual({ artifactId: ID, imported: false });
    expect(store.get(ID)).toBeNull();
  });

  it('leaves nothing when a version fails mid-import, rows or files, and a rerun then imports it', async () => {
    const changes: ArtifactChanged[] = [];
    store.onChange((change) => changes.push(change));
    const broken = htmlRecord({
      versions: [
        { at: now - 40 * DAY, actor: first, content: { bytes: page('v1'), name: 'report.html' } },
        { at: now - 20 * DAY, actor: first, content: { bytes: page('v2'), name: 'report.html' } },
        { at: now - 10 * DAY, actor: second, content: { bytes: new Uint8Array(ARTIFACT_MAX_BYTES + 1) } },
      ],
    });
    await expect(store.importArtifact(broken)).rejects.toMatchObject({ code: 'tooLarge' });
    await service.whenCommitted();
    expect(counts(ID)).toEqual({ artifacts: 0, artifact_updates: 0, artifact_versions: 0, artifact_sessions: 0 });
    expect(existsSync(join(dir, ID)) ? readdirSync(join(dir, ID), { recursive: true }).filter((entry) => String(entry).startsWith('content')) : []).toEqual([]);
    expect(changes).toEqual([]);

    expect(await store.importArtifact(htmlRecord())).toEqual({ artifactId: ID, imported: true });
    expect(text(readFileSync(store.contentRef(ID).path))).toContain('v2');
  });

  it('keeps every imported version through maintenance, however old', async () => {
    await store.importArtifact(
      htmlRecord({
        createdAt: now - 400 * DAY,
        versions: [400, 200, 90, 40, 39, 10].map((days, i) => ({ at: now - days * DAY, actor: first, content: { bytes: page(`v${i}`) } })),
      }),
    );
    const before = store.listVersions(ID);
    const report = await store.maintenance.run();
    expect(report.versionsThinned).toBe(0);
    reopen();
    expect(store.listVersions(ID)).toEqual(before);
    for (const v of before) expect(text(readFileSync(store.contentRef(ID, v.seq).path))).toContain(`v${before.indexOf(v)}`);
  });

  it('pins no design system to an imported version, even with an owner default set, while a live write still pins (Decision Log 38d)', async () => {
    const system = await store.create({ kind: 'design_system', title: 'House' }, human);
    await store.setDefaults({ owner: system.id, spaces: {} });
    await store.importArtifact(htmlRecord());
    expect(store.listVersions(ID).map((v) => v.designSystemRef)).toEqual([undefined, undefined]);
    expect(store.listVersions(system.id)).toEqual([]); // no system version written for a pin either
    const { versionId } = await store.writeContent(ID, { bytes: page('v3') }, second);
    expect(store.listVersions(ID).find((v) => v.id === versionId)?.designSystemRef).toEqual({ id: system.id, versionSeq: expect.any(Number) });
  });

  it('refuses what it cannot land, before writing anything', async () => {
    await expect(store.importArtifact(htmlRecord({ id: 'report' }))).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.importArtifact(htmlRecord({ kind: 'document' as 'html' }))).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.importArtifact(htmlRecord({ versions: [] }))).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.importArtifact(htmlRecord({ handle: 'not a handle!' }))).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.importArtifact(htmlRecord({ versions: [{ at: now, actor: first, content: { path: '/nowhere/x.html' } }] }))).rejects.toBeInstanceOf(ArtifactStoreError);
    // a handle the creating session already holds
    await store.create({ kind: 'html', title: 'Mine', handle: 'report', content: { bytes: page('mine') } }, first);
    await expect(store.importArtifact(htmlRecord())).rejects.toMatchObject({ code: 'handleTaken', data: { handle: 'report' } });
    expect(counts(ID).artifacts).toBe(0);
  });
});
