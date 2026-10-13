import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KindAdapter } from '@artifacts/host';
import { applyV1, applyV2, canonicalV2, contentIdsOf, decodeMap, diffV1, idAt, insertedBy, newDoc, stateV2, stateVector, type Doc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { ArtifactStoreError } from './errors';
import { DocumentService } from './service';
import { SqliteDocumentStorage } from './storage';
import { ArtifactStore, AUTO_EVERY_MS, AUTO_IDLE_MS, type ArtifactChanged } from './store';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const sid = (id: string) => id as AppSessionId;
const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: sid('app-1') };
const other: Actor = { kind: 'session', appSessionId: sid('app-2') };

let dir: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
let now: number;
let logs: string[];
let turns: (() => void)[] | null; // the service's deferred commits when a test drives them (`manual`), else null

function make(adapters: KindAdapter[] = [], options: { manual?: boolean } = {}): void {
  turns = options.manual ? [] : null;
  const defer = turns ? (run: () => void) => turns!.push(run) : undefined;
  storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { now: () => now, log: (line) => logs.push(line), kindOf: (id) => storage.kindOf(id), adapters, defer });
  store = new ArtifactStore(service, storage, { root: dir, now: () => now, log: (line) => logs.push(line) });
}
// Runs the commits a manual store deferred.
const tick = () => {
  while (turns && turns.length > 0) turns.shift()!();
};
function reopen(adapters: KindAdapter[] = [], options: { manual?: boolean } = {}): void {
  store.close();
  service.close();
  storage.close();
  make(adapters, options);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-store-'));
  now = Date.UTC(2026, 9, 12, 9, 0);
  logs = [];
  make();
});
afterEach(() => {
  vi.useRealTimers();
  store?.close();
  service?.close();
  storage?.close();
  rmSync(dir, { recursive: true, force: true });
});

const committed = (sql: string, ...params: (string | number)[]) => {
  const db = new DatabaseSync(join(dir, 'store.sqlite'), { readOnly: true });
  try {
    return db.prepare(sql).all(...params) as Record<string, unknown>[];
  } finally {
    db.close();
  }
};
const until = async (test: () => boolean) => {
  for (let i = 0; i < 400 && !test(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(test()).toBe(true);
};
const write = (artifactId: string, actor: Actor, edit: (doc: Doc) => void) => service.writeAs(artifactId, actor, edit);
// The doc as a fresh replica sees it (the live state through a reload of the store when closed).
const json = (artifactId: string) => {
  const doc = newDoc();
  applyV2(doc, service.readState(artifactId).state);
  return { root: doc.get('root').toJSON(), files: doc.get('files').toJSON(), notes: doc.get('notes').toString() };
};
const rootText = (artifactId: string) => {
  const doc = newDoc();
  applyV2(doc, service.readState(artifactId).state);
  return doc.get('root').toString();
};
// Text that does not compress to nothing (so a keyframe weighs what a real document's would).
const prose = (n: number) => Array.from({ length: n }, (_, i) => ((i * 7919) % 104_729).toString(36)).join(' ');
const html = (text: string) => new TextEncoder().encode(`<!doctype html><p>${text}</p>`);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('ArtifactStore: entities, spaces and links', () => {
  it('creates, lists with filters, renames, moves, pins, soft-deletes and links artifacts', async () => {
    const space = await store.createSpace({ name: 'Teaching' });
    const doc = await store.create({ kind: 'document', title: 'Quarterly plan' }, human);
    now += 1;
    const page = await store.create({ kind: 'html', title: 'Report', handle: 'report', content: { bytes: html('hi') } }, agent);
    expect(doc).toMatchObject({ kind: 'document', title: 'Quarterly plan', createdBy: human, pinned: false, lastViewedAt: null });
    expect(page.handle).toBe('report');
    expect(store.list().map((a) => a.id)).toEqual([page.id, doc.id]); // newest first
    expect(store.list({ kind: 'html' }).map((a) => a.id)).toEqual([page.id]);
    expect(store.list({ appSessionId: 'app-1' }).map((a) => a.id)).toEqual([page.id]);
    expect(store.list({ query: 'QUARTER' }).map((a) => a.id)).toEqual([doc.id]);

    now += 1;
    await store.update(doc.id, { title: 'Plan', spaceId: space.id, pinned: true });
    expect(store.get(doc.id)).toMatchObject({ title: 'Plan', spaceId: space.id, pinned: true, updatedAt: now });
    expect(store.list({ spaceId: space.id, pinned: true }).map((a) => a.id)).toEqual([doc.id]);
    await store.update(doc.id, { spaceId: null });
    expect(store.get(doc.id)?.spaceId).toBeUndefined();

    await store.link(doc.id, sid('app-2'), 'viewed');
    expect(store.links(doc.id)).toEqual([{ artifactId: doc.id, appSessionId: 'app-2', role: 'viewed', lastAt: now }]);
    expect(store.links(page.id)).toEqual([{ artifactId: page.id, appSessionId: 'app-1', role: 'created', lastAt: now - 1 }]);

    await store.delete(doc.id);
    expect(store.get(doc.id)).toBeNull();
    expect(store.get(doc.id, { includeDeleted: true })?.title).toBe('Plan');
    expect(store.list().map((a) => a.id)).toEqual([page.id]);
    expect(store.list({ deleted: true }).map((a) => a.id)).toEqual([doc.id]);
    await expect(store.update(doc.id, { title: 'x' })).rejects.toMatchObject({ code: 'notFound' });

    reopen(); // every row was committed
    expect(store.get(page.id)?.title).toBe('Report');
    expect(store.listSpaces()).toEqual([space]);
  });

  it('resolves a handle over the asking session’s lineage only, and refuses a handle the creating session already holds', async () => {
    const mine = await store.create({ kind: 'html', title: 'A', handle: 'report', content: { bytes: html('a') } }, agent);
    const theirs = await store.create({ kind: 'html', title: 'B', handle: 'report', content: { bytes: html('b') } }, other);
    expect(theirs.id).not.toBe(mine.id); // handles never collide across sessions
    expect(store.resolve('report', ['app-1'])).toBe(mine.id);
    expect(store.resolve('report', ['app-3', 'app-2', 'app-1'])).toBe(theirs.id); // nearest first
    expect(store.resolve('report', ['app-3'])).toBeNull();
    expect(store.resolve(mine.id, [])).toBe(mine.id);
    await expect(store.create({ kind: 'html', title: 'C', handle: 'report', content: { bytes: html('c') } }, agent)).rejects.toMatchObject({ code: 'handleTaken' });
    await expect(store.create({ kind: 'html', title: 'D', handle: '../x', content: { bytes: html('d') } }, agent)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('deletes a Space leaving its artifacts outside any Space, and announces each change', async () => {
    const changes: ArtifactChanged[] = [];
    const spaces: unknown[] = [];
    store.onChange((change) => changes.push(change));
    store.onSpaceChange((change) => spaces.push(change));
    const space = await store.createSpace({ name: 'Repo', linkedDir: '/tmp/repo' });
    await store.updateSpace(space.id, { name: 'Repository' });
    const doc = await store.create({ kind: 'document', title: 'Notes', spaceId: space.id }, human);
    await store.deleteSpace(space.id);
    expect(store.get(doc.id)?.spaceId).toBeUndefined();
    expect(spaces).toEqual([
      { spaceId: space.id, change: 'created' },
      { spaceId: space.id, change: 'updated' },
      { spaceId: space.id, change: 'deleted' },
    ]);
    expect(changes.map((c) => [c.artifactId, c.kind, c.change])).toEqual([
      [doc.id, 'document', 'created'],
      [doc.id, 'document', 'updated'],
    ]);
  });

  it('refuses to delete a design system that still governs a live artifact, naming them (Decision Log 22a)', async () => {
    const system = await store.create({ kind: 'design_system', title: 'House style' }, human);
    const doc = await store.create({ kind: 'document', title: 'Letter', designSystemId: system.id }, human);
    await expect(store.delete(system.id)).rejects.toMatchObject({ code: 'designSystemInUse', data: { artifactIds: [doc.id] } });
    await store.delete(doc.id);
    await store.delete(system.id);
    expect(store.get(system.id)).toBeNull();
  });
});

describe('ArtifactStore: byte kinds and assets (Decision Log 2, 7)', () => {
  it('stores each html write immutably under content/<seq>/, with a log row and a version; a file artifact stays in place', async () => {
    const page = await store.create({ kind: 'html', title: 'Report', content: { bytes: html('one') } }, agent);
    const first = store.contentRef(page.id);
    expect(text(readFileSync(first.path))).toContain('one');
    expect(first.path).toBe(join(dir, page.id, 'content', String(first.revision), 'index.html'));
    const second = await store.writeContent(page.id, { bytes: html('two') }, agent);
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(text(readFileSync(store.contentRef(page.id).path))).toContain('two');
    expect(text(readFileSync(store.contentRef(page.id, first.revision).path))).toContain('one'); // still there
    expect(store.listVersions(page.id).map((v) => [v.kind, v.seq])).toEqual([
      ['import', first.revision],
      ['auto', second.revision],
    ]);
    expect(store.revision(page.id)).toBe(second.revision);
    await expect(store.writeContent(page.id, { bytes: new Uint8Array(16 * 1024 * 1024 + 1) }, agent)).rejects.toMatchObject({ code: 'tooLarge' });

    const path = join(dir, 'outside.pdf');
    writeFileSync(path, 'pdf bytes');
    const file = await store.create({ kind: 'file', title: 'outside.pdf', content: { path } }, agent);
    expect(store.get(file.id)?.linkedPath).toBe(path);
    expect(store.contentRef(file.id)).toMatchObject({ path, ref: { name: 'outside.pdf', size: 9 } });
    await expect(store.create({ kind: 'file', title: 'x', content: { path: join(dir, 'missing') } }, agent)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('restores an html version by publishing its old bytes as a new write and a `restore` version', async () => {
    const page = await store.create({ kind: 'html', title: 'Report', content: { bytes: html('one') } }, agent);
    await store.writeContent(page.id, { bytes: html('two') }, agent);
    const [imported] = store.listVersions(page.id);
    const restored = await store.restore(page.id, imported.id, human);
    expect(text(readFileSync(store.contentRef(page.id).path))).toContain('one');
    expect(store.contentRef(page.id).revision).toBe(restored.revision);
    const versions = store.listVersions(page.id);
    expect(versions.at(-1)).toMatchObject({ id: restored.versionId, kind: 'restore', actor: human, label: expect.stringMatching(/^Restored from /) });
  });

  it('keeps assets content-addressed, deduplicated and uniquely named per artifact, and lists them in versions’ asset refs', async () => {
    const doc = await store.create({ kind: 'document', title: 'Deck' }, human);
    const a = await store.uploadAsset(doc.id, new Uint8Array([1, 2, 3]), { name: 'logo.png', mime: 'image/png' }, human);
    expect(a.ref).toBe('assets/logo.png');
    expect(await store.uploadAsset(doc.id, new Uint8Array([1, 2, 3]), { name: 'other.png', mime: 'image/png' }, agent)).toEqual(a);
    const b = await store.uploadAsset(doc.id, new Uint8Array([9]), { name: 'logo.png', mime: 'image/png' }, agent);
    expect(b.ref).toBe('assets/logo-2.png');
    const assets = store.listAssets(doc.id);
    expect(assets.map((x) => [x.ref, x.createdBy])).toEqual([
      ['assets/logo.png', human],
      ['assets/logo-2.png', agent],
    ]);
    expect(existsSync(join(dir, doc.id, 'assets', assets[0].sha256))).toBe(true);
    await expect(store.uploadAsset(doc.id, new Uint8Array([1]), { name: '..', mime: 'x' }, human)).rejects.toMatchObject({ code: 'invalid' });
    await write(doc.id, human, (d) => d.get('root').insert(0, 'x'));
    const id = await store.createVersion(doc.id, { kind: 'named', actor: human, label: 'With logos' });
    expect(store.listVersions(doc.id).find((v) => v.id === id)?.assetRefs.sort()).toEqual([a.assetId, b.assetId].sort());
  });
});

describe('ArtifactStore: duplicate (Decision Log 23b)', () => {
  it('copies a Y kind’s live state or a version’s, and a byte kind’s content, each copy starting with an `import` version', async () => {
    const doc = await store.create({ kind: 'document', title: 'Plan' }, human);
    await write(doc.id, human, (d) => d.get('root').insert(0, 'first'));
    const v1 = (await store.createVersion(doc.id, { kind: 'named', actor: human, label: 'v1' }))!;
    await write(doc.id, agent, (d) => d.get('root').insert(5, ' second'));
    const live = await store.duplicate(doc.id, {}, agent);
    const old = await store.duplicate(doc.id, { versionId: v1, title: 'Old plan' }, human);
    expect(live).toMatchObject({ title: 'Copy of Plan', kind: 'document', createdBy: agent });
    expect(old.title).toBe('Old plan');
    expect(json(live.id).root).toEqual(json(doc.id).root);
    const oldDoc = newDoc();
    applyV2(oldDoc, service.readState(old.id).state);
    expect(oldDoc.get('root').toString()).toBe('first');
    expect(store.listVersions(live.id).map((v) => v.kind)).toEqual(['import']);
    expect(store.links(live.id).map((l) => l.role)).toEqual(['created']);

    const page = await store.create({ kind: 'html', title: 'Page', content: { bytes: html('page') } }, agent);
    const pageCopy = await store.duplicate(page.id, {}, human);
    expect(text(readFileSync(store.contentRef(pageCopy.id).path))).toContain('page');
    expect(store.contentRef(pageCopy.id).path).not.toBe(store.contentRef(page.id).path);
  });

  it('copies the assets the copied state needs, keeping their ids and refs, before the copy’s import version (M3 review finding 5)', async () => {
    const doc = await store.create({ kind: 'document', title: 'Plan' }, human);
    const logo = await store.uploadAsset(doc.id, new Uint8Array([1, 2]), { name: 'logo.png', mime: 'image/png' }, human);
    await write(doc.id, human, (d) => d.get('root').setAttr('image', logo.ref));
    const v1 = (await store.createVersion(doc.id, { kind: 'named', actor: human, label: 'v1' }))!;
    const chart = await store.uploadAsset(doc.id, new Uint8Array([3]), { name: 'chart.png', mime: 'image/png' }, agent);
    await write(doc.id, agent, (d) => d.get('root').setAttr('chart', chart.ref));

    const live = await store.duplicate(doc.id, {}, agent);
    const sameAssets = (artifactId: string) => store.listAssets(artifactId).map(({ assetId, ref, name, mime, size, sha256 }) => ({ assetId, ref, name, mime, size, sha256 }));
    expect(sameAssets(live.id)).toEqual(sameAssets(doc.id));
    expect(store.listVersions(live.id)[0]).toMatchObject({ kind: 'import' });
    expect(store.listVersions(live.id)[0].assetRefs.sort()).toEqual([logo.assetId, chart.assetId].sort());
    for (const asset of store.listAssets(live.id)) expect(readFileSync(join(dir, live.id, 'assets', asset.sha256))).toEqual(readFileSync(join(dir, doc.id, 'assets', asset.sha256)));

    const old = await store.duplicate(doc.id, { versionId: v1 }, human);
    expect(store.listAssets(old.id).map((a) => [a.assetId, a.ref])).toEqual([[logo.assetId, logo.ref]]); // only what v1 had
    expect(store.listVersions(old.id)[0].assetRefs).toEqual([logo.assetId]);

    const page = await store.create({ kind: 'html', title: 'Page', content: { bytes: html('<img src="assets/logo.png">') } }, agent);
    const pageLogo = await store.uploadAsset(page.id, new Uint8Array([9]), { name: 'logo.png', mime: 'image/png' }, agent);
    const pageCopy = await store.duplicate(page.id, {}, human);
    expect(store.listAssets(pageCopy.id).map((a) => a.assetId)).toEqual([pageLogo.assetId]);
    expect(store.listVersions(pageCopy.id)[0].assetRefs).toEqual([pageLogo.assetId]);
  });
});

describe('ArtifactStore: versions (Decision Log 8)', () => {
  it('lists versions with actors and kinds, stores deltas between keyframes, and reconstructs every version byte-identically', async () => {
    const doc = await store.create({ kind: 'document', title: 'Plan' }, human);
    const captured = new Map<number, Uint8Array>();
    const versionNow = async (kind: 'auto' | 'named', actor: Actor) => {
      const id = await store.createVersion(doc.id, { kind, actor, label: kind === 'named' ? 'Named' : undefined });
      if (id !== null) captured.set(id, service.readState(doc.id).state);
      return id;
    };
    await write(doc.id, human, (d) => d.get('root').insert(0, prose(2_000)));
    await versionNow('auto', human);
    for (let i = 0; i < 12; i++) {
      await write(doc.id, i % 2 ? agent : human, (d) => {
        d.get('root').insert(i * 7, `edit ${i} `);
        if (i % 3 === 0) d.get('root').delete(100 + i, 20);
        d.get('files').setAttr('a.md', `rev ${i}`);
      });
      await versionNow(i % 4 === 3 ? 'named' : 'auto', i % 2 ? agent : human);
    }
    expect(await versionNow('auto', human)).toBeNull(); // nothing moved
    const versions = store.listVersions(doc.id);
    expect(versions).toHaveLength(13);
    expect(versions.filter((v) => v.kind === 'named').map((v) => v.label)).toEqual(['Named', 'Named', 'Named']);
    expect(versions[2].actor).toEqual(agent);
    const encodings = committed('SELECT enc FROM artifact_versions ORDER BY id').map((r) => r.enc);
    expect(encodings[0]).toBe('full');
    expect(encodings.filter((e) => e === 'delta').length).toBeGreaterThan(8);
    for (const [id, state] of captured) expect(canonicalV2(store.versionState(doc.id, id))).toEqual(canonicalV2(state));
    const last = versions.at(-1)!;
    expect(canonicalV2(store.versionState(doc.id, { seq: last.seq }))).toEqual(canonicalV2(captured.get(last.id)!));
    reopen(); // from the stored rows alone, no cache
    for (const [id, state] of captured) expect(canonicalV2(store.versionState(doc.id, id))).toEqual(canonicalV2(state));
  });

  it('writes auto versions 2 minutes after the last human update and every 10 minutes of activity, never when nothing changed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const doc = await store.create({ kind: 'document', title: 'Plan' }, human);
    const autos = () => store.listVersions(doc.id).filter((v) => v.kind === 'auto').length;
    await write(doc.id, human, (d) => d.get('root').insert(0, 'a'));
    await vi.advanceTimersByTimeAsync(AUTO_IDLE_MS - 1_000);
    await write(doc.id, human, (d) => d.get('root').insert(0, 'b')); // the idle clock restarts
    await vi.advanceTimersByTimeAsync(AUTO_IDLE_MS - 1_000);
    expect(autos()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await until(() => autos() === 1);
    await vi.advanceTimersByTimeAsync(AUTO_EVERY_MS);
    expect(autos()).toBe(1); // the 10-minute timer fired with nothing new since
    // continuous agent activity: no idle timer, the 10-minute one writes
    for (let t = 0; t < AUTO_EVERY_MS; t += MIN) {
      await write(doc.id, agent, (d) => d.get('root').insert(0, 'c'));
      await vi.advanceTimersByTimeAsync(MIN);
    }
    await until(() => autos() === 2);
    await vi.advanceTimersByTimeAsync(3 * AUTO_EVERY_MS);
    expect(autos()).toBe(2);
  });

  it('writes an auto version on markViewed only when the revision moved since the last version', async () => {
    const doc = await store.create({ kind: 'document', title: 'Plan' }, human);
    await store.markViewed(doc.id);
    expect(store.listVersions(doc.id)).toEqual([]);
    expect(store.get(doc.id)?.lastViewedAt).toBe(now);
    await write(doc.id, agent, (d) => d.get('root').insert(0, 'agent work'));
    await store.markViewed(doc.id);
    expect(store.listVersions(doc.id).map((v) => [v.kind, v.actor])).toEqual([['auto', agent]]);
    await store.markViewed(doc.id);
    expect(store.listVersions(doc.id)).toHaveLength(1);
  });

  it('writes one turn version per artifact the session wrote, summarised by the kind or as N edits, and clears its presence', async () => {
    const adapter: KindAdapter = { kind: 'presentation', summarizeTurn: (results) => `${results.length} slide changes` };
    reopen([adapter]);
    const doc = await store.create({ kind: 'document', title: 'Plan' }, human);
    const deck = await store.create({ kind: 'presentation', title: 'Deck' }, human);
    const untouched = await store.create({ kind: 'document', title: 'Other' }, human);
    await store.testWrite(doc.id, 'op-1', [{ op: 'insertText', index: 0, text: 'a' }], agent);
    await store.testWrite(doc.id, 'op-2', [{ op: 'insertText', index: 0, text: 'b' }], agent);
    await store.testWrite(deck.id, 'op-3', [{ op: 'setAttr', key: 'k', value: 1 }], agent);
    await store.endTurn(sid('app-1'));
    expect(store.listVersions(doc.id).map((v) => [v.kind, v.actor, v.summary])).toEqual([['turn', agent, '2 edits']]);
    expect(store.listVersions(deck.id).map((v) => v.summary)).toEqual(['1 slide changes']);
    expect(store.listVersions(untouched.id)).toEqual([]);
    await store.endTurn(sid('app-1'));
    expect(store.listVersions(doc.id)).toHaveLength(1);
  });

  it('pins the governing design system’s version equal to its live state, writing a system version first when it moved (Decision Log 22b, 22d)', async () => {
    const system = await store.create({ kind: 'design_system', title: 'House style' }, human);
    const space = await store.createSpace({ name: 'School' });
    await write(system.id, human, (d) => d.get('files').setAttr('DESIGN.md', '# v1'));
    const doc = await store.create({ kind: 'document', title: 'Letter', spaceId: space.id }, human);
    await write(doc.id, human, (d) => d.get('root').insert(0, 'text'));
    expect(await store.createVersion(doc.id, { kind: 'named', actor: human })).not.toBeNull();
    expect(store.listVersions(doc.id)[0].designSystemRef).toBeUndefined(); // nothing governs it yet
    await store.setDefaults({ owner: null, spaces: { [space.id]: system.id } });
    await write(doc.id, human, (d) => d.get('root').insert(0, 'more '));
    await store.createVersion(doc.id, { kind: 'named', actor: human });
    const systemVersions = store.listVersions(system.id);
    expect(systemVersions.map((v) => v.kind)).toEqual(['auto']);
    const pin = store.listVersions(doc.id)[1].designSystemRef!;
    expect(pin).toEqual({ id: system.id, versionSeq: store.revision(system.id) });
    const pinned = newDoc();
    applyV2(pinned, store.versionState(system.id, { seq: pin.versionSeq }));
    expect(pinned.get('files').getAttr('DESIGN.md')).toBe('# v1');
    await store.createVersion(doc.id, { kind: 'named', actor: human });
    expect(store.listVersions(system.id)).toHaveLength(1); // the system did not move: the same version pinned
    reopen();
    expect(store.defaults()).toEqual({ owner: null, spaces: { [space.id]: system.id } });
    store.registerDesignSystemContext(async (s) => `guide of ${s.title}`);
    expect(await store.designSystemContextFor(doc.id)).toBe('guide of House style');
  });

  it('pins a design system never written by writing and keeping its empty state as a version at seq 0 (M3 review finding 2)', async () => {
    const system = await store.create({ kind: 'design_system', title: 'Empty style' }, human);
    const doc = await store.create({ kind: 'document', title: 'Letter', designSystemId: system.id }, human);
    await write(doc.id, human, (d) => d.get('root').insert(0, 'a'));
    expect(await store.createVersion(doc.id, { kind: 'named', actor: human })).not.toBeNull();
    expect(store.listVersions(doc.id)[0].designSystemRef).toEqual({ id: system.id, versionSeq: 0 });
    expect(store.listVersions(system.id)).toMatchObject([{ seq: 0, kind: 'auto' }]);
    const pinned = newDoc();
    applyV2(pinned, store.versionState(system.id, { seq: 0 }));
    expect(pinned.get('files').getAttr('DESIGN.md')).toBeUndefined();
    const page = await store.create({ kind: 'html', title: 'Page', designSystemId: system.id, content: { bytes: html('one') } }, human);
    expect(store.listVersions(page.id)[0].designSystemRef).toEqual({ id: system.id, versionSeq: 0 });
    expect(store.listVersions(system.id)).toHaveLength(1); // the same empty version serves every pin
    await write(system.id, human, (d) => d.get('files').setAttr('DESIGN.md', '# later'));
    await store.createVersion(system.id, { kind: 'named', actor: human });
    now += DAY;
    await store.pruneVersions(system.id, now);
    expect(store.listVersions(system.id).map((v) => v.seq)).toEqual([0]); // a pin's target is kept
    expect(store.versionState(system.id, { seq: 0 })).toBeInstanceOf(Uint8Array);
  });

  it('refreshes the asset refs and the pin when an auto version is upgraded in place, a removed system clearing it (M3 review finding 4)', async () => {
    const system = await store.create({ kind: 'design_system', title: 'House style' }, human);
    await write(system.id, human, (d) => d.get('files').setAttr('DESIGN.md', '# s'));
    const doc = await store.create({ kind: 'document', title: 'Letter', designSystemId: system.id }, human);
    await write(doc.id, human, (d) => d.get('root').insert(0, 'a'));
    const auto = await store.createVersion(doc.id, { kind: 'auto', actor: human });
    expect(store.listVersions(doc.id)[0]).toMatchObject({ assetRefs: [], designSystemRef: { id: system.id } });
    const asset = await store.uploadAsset(doc.id, new Uint8Array([1]), { name: 'a.png', mime: 'image/png' }, human);
    await store.update(doc.id, { designSystemId: null });
    expect(await store.createVersion(doc.id, { kind: 'named', actor: human, label: 'Current' })).toBe(auto);
    const [upgraded] = store.listVersions(doc.id);
    expect(upgraded).toMatchObject({ kind: 'named', label: 'Current', assetRefs: [asset.assetId] });
    expect(upgraded.designSystemRef).toBeUndefined();
  });
});

describe('ArtifactStore: restore (Decision Log 16)', () => {
  async function schemaAgnostic() {
    const doc = await store.create({ kind: 'document', title: 'Plan' }, human);
    await write(doc.id, human, (d) => {
      d.get('root').setAttr('title', 'Plan');
      d.get('root').insert(0, 'hello world');
      const child = new (d.get('root').constructor as new (name: string) => ReturnType<Doc['get']>)('section');
      child.setAttr('id', 's1');
      child.insert(0, 'nested');
      d.get('root').insert(d.get('root').length, [child]);
      d.get('files').setAttr('index.md', '# one');
    });
    return doc;
  }

  it('brings back every root type, keeps a concurrent edit to an unrelated root, credits the restorer, brackets it with versions and tells connected replicas', async () => {
    const doc = await schemaAgnostic();
    const at = (await store.createVersion(doc.id, { kind: 'named', actor: human, label: 'Before the agent' }))!;
    const before = json(doc.id);
    await write(doc.id, agent, (d) => {
      d.get('root').setAttr('title', 'Agent title');
      d.get('root').setAttr('title', 'Agent title, again'); // overwritten twice since the version (yjs#814)
      d.get('root').delete(0, 6);
      (d.get('root').toArray().find((item) => typeof item !== 'string') as ReturnType<Doc['get']>).insert(0, 'changed ');
      d.get('files').setAttr('index.md', '# two');
      d.get('files').setAttr('new.md', 'added');
    });
    await write(doc.id, agent, (d) => d.get('root').setAttr('title', 'Third title'));
    const replica = service.replica(sid('app-9'), doc.id);
    await replica.whenSynced();
    const seen: unknown[] = [];
    replica.provider.onRestored((restored) => seen.push(restored));
    // another replica edits an unrelated root while the restore runs: its update reaches the host after the restore
    const concurrent = newDoc();
    applyV2(concurrent, service.readState(doc.id).state);
    const sv = stateVector(concurrent);
    concurrent.get('notes').insert(0, 'a concurrent note');

    const result = await store.restore(doc.id, at, human);
    expect(committed('SELECT actor FROM artifact_updates WHERE seq = ?', result.revision)).toEqual([{ actor: 'human' }]);
    await write(doc.id, other, (d) => applyV1(d, diffV1(concurrent, sv)));
    expect(json(doc.id).root).toEqual(before.root);
    expect(json(doc.id).files).toEqual(before.files);
    expect(json(doc.id).notes).toEqual('a concurrent note');
    const kinds = store.listVersions(doc.id).map((v) => v.kind);
    expect(kinds).toEqual(['named', 'auto', 'restore']);
    expect(store.listVersions(doc.id).at(-1)).toMatchObject({ id: result.versionId, seq: result.revision, label: 'Restored from Before the agent', actor: human });
    await until(() => seen.length === 1);
    expect(seen).toEqual([{ revision: result.revision, versionId: result.versionId }]);
    await until(() => replica.doc.get('files').getAttr('index.md') === '# one');
  });

  it('restores a no-op as a decodable empty write, and works after maintenance pruned the log and thinned versions', async () => {
    const doc = await schemaAgnostic();
    const at = (await store.createVersion(doc.id, { kind: 'named', actor: human, label: 'v1' }))!;
    const before = json(doc.id);
    const noop = await store.restore(doc.id, at, human);
    expect(json(doc.id)).toEqual(before);
    expect(noop.revision).toBe(store.revision(doc.id));
    await write(doc.id, agent, (d) => {
      d.get('root').setAttr('title', 'x');
      d.get('files').setAttr('index.md', '# two');
    });
    await store.createVersion(doc.id, { kind: 'auto', actor: agent });
    now += 40 * DAY;
    await store.maintenance.run();
    expect(committed('SELECT COUNT(*) AS n FROM artifact_updates WHERE artifactId = ?', doc.id)).toEqual([{ n: 0 }]); // the log is gone
    reopen();
    await store.restore(doc.id, at, human);
    expect(json(doc.id).root).toEqual(before.root);
    expect(json(doc.id).files).toEqual(before.files);
  });

  it('lets a kind scope the revert and write its after-effects, thread rows included, in the restore’s commit', async () => {
    const adapter: KindAdapter = {
      kind: 'document',
      revertScope: (live, old) => {
        expect(old.get('threads').getAttr('t1')).toBeUndefined();
        const sv = stateVector(old);
        const posted = diffV1(live, sv);
        const ids = contentIdsOf(posted);
        // keep only what was posted to the threads root: everything inserted under its own clientID by the poster
        const poster = live.get('threads').getAttr('poster') as number;
        ids.inserts.clients.forEach((_, client) => client !== poster && ids.inserts.clients.delete(client));
        ids.deletes.clients.clear();
        return { keep: ids };
      },
      afterRestore: (doc, { versionId }) => {
        doc.get('meta').setAttr('restoredFrom', versionId);
        return { threads: { upsert: [{ threadId: 't1', status: 'open', quote: 'q', createdAt: 1, updatedAt: 2 }] } };
      },
    };
    reopen([adapter]);
    const doc = await store.create({ kind: 'document', title: 'Plan' }, human);
    await write(doc.id, human, (d) => d.get('root').setAttr('title', 'v1'));
    const at = (await store.createVersion(doc.id, { kind: 'named', actor: human }))!;
    await write(doc.id, human, (d) => d.get('root').setAttr('title', 'v2'));
    await write(doc.id, agent, (d) => {
      d.get('threads').setAttr('poster', d.clientID);
      d.get('threads').setAttr('t1', 'a posted message');
    });
    await store.restore(doc.id, at, human);
    const live = newDoc();
    applyV2(live, service.readState(doc.id).state);
    expect(live.get('root').getAttr('title')).toBe('v1');
    expect(live.get('threads').getAttr('t1')).toBe('a posted message');
    expect(live.get('meta').getAttr('restoredFrom')).toBe(at);
    expect(committed('SELECT threadId FROM artifact_threads WHERE artifactId = ?', doc.id)).toEqual([{ threadId: 't1' }]);
  });
});

describe('ArtifactStore: idempotency (Decision Log 11)', () => {
  it('answers a repeated op id with the first result and writes nothing, and runs a concurrent repeat once', async () => {
    const doc = await store.create({ kind: 'document', title: 'Plan' }, human);
    const first = await store.testWrite(doc.id, 'toolu_1', [{ op: 'insertText', index: 0, text: 'hello' }], agent);
    const rows = committed('SELECT COUNT(*) AS n FROM artifact_updates')[0].n as number;
    expect(committed('SELECT opId, tool, result FROM artifact_ops')).toEqual([{ opId: 'toolu_1', tool: 'testWrite', result: JSON.stringify(first) }]);
    expect(await store.testWrite(doc.id, 'toolu_1', [{ op: 'insertText', index: 0, text: 'hello' }], agent)).toEqual(first);
    expect(committed('SELECT COUNT(*) AS n FROM artifact_updates')[0].n).toBe(rows);
    const [a, b] = await Promise.all([
      store.testWrite(doc.id, 'toolu_2', [{ op: 'setAttr', key: 'k', value: 1 }], agent),
      store.testWrite(doc.id, 'toolu_2', [{ op: 'setAttr', key: 'k', value: 1 }], agent),
    ]);
    expect(a).toEqual(b);
    expect(committed('SELECT COUNT(*) AS n FROM artifact_updates')[0].n).toBe(rows + 1);
    reopen();
    expect(await store.testWrite(doc.id, 'toolu_1', [{ op: 'insertText', index: 0, text: 'again' }], agent)).toEqual(first);
    expect(rootText(doc.id)).toContain('hello');
    expect(rootText(doc.id)).not.toContain('again');
  });

  it('records a read-only op in the next commit after it settles, and runs without an id with a logged warning', async () => {
    expect(await store.withOp('toolu_x', 'artifact_list', null, async () => ({ rows: 3 }), { readOnly: true })).toEqual({ rows: 3 });
    expect(committed('SELECT result FROM artifact_ops WHERE opId = ?', 'toolu_x')).toEqual([{ result: '{"rows":3}' }]);
    let runs = 0;
    await store.withOp(undefined, 'artifact_list', null, async () => ++runs, { readOnly: true });
    await store.withOp(undefined, 'artifact_list', null, async () => ++runs, { readOnly: true });
    expect(runs).toBe(2);
    expect(logs.some((line) => line.includes('without a tool-use id'))).toBe(true);
  });

  it('answers a retry of an op in flight only once the original’s write has committed (M3 review finding 1)', async () => {
    reopen([], { manual: true });
    const creation = store.create({ kind: 'document', title: 'Plan' }, human);
    tick();
    const doc = await creation;
    const first = store.testWrite(doc.id, 'toolu_r', [{ op: 'insertText', index: 0, text: 'a' }], agent);
    let retrySettled = false;
    const retry = store.testWrite(doc.id, 'toolu_r', [{ op: 'insertText', index: 0, text: 'a' }], agent).finally(() => (retrySettled = true));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(committed('SELECT COUNT(*) AS n FROM artifact_ops')[0].n).toBe(0); // the op row sits in the open batch
    expect(retrySettled).toBe(false);
    tick();
    expect(await retry).toEqual(await first);
    expect(committed('SELECT COUNT(*) AS n FROM artifact_updates WHERE bytes IS NOT NULL')[0].n).toBe(1);
  });

  it('rejects a retry of an op in flight when the original’s commit fails, and runs it afresh after (M3 review finding 1)', async () => {
    reopen([], { manual: true });
    const creation = store.create({ kind: 'document', title: 'Plan' }, human);
    tick();
    const doc = await creation;
    const commit = vi.spyOn(storage, 'commit').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const first = store.testWrite(doc.id, 'toolu_f', [{ op: 'insertText', index: 0, text: 'a' }], agent);
    const retry = store.testWrite(doc.id, 'toolu_f', [{ op: 'insertText', index: 0, text: 'a' }], agent);
    const outcomes = Promise.allSettled([first, retry]);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    tick();
    expect((await outcomes).map((o) => o.status)).toEqual(['rejected', 'rejected']);
    commit.mockRestore();
    expect(committed('SELECT COUNT(*) AS n FROM artifact_ops')[0].n).toBe(0);
    const again = store.testWrite(doc.id, 'toolu_f', [{ op: 'insertText', index: 0, text: 'a' }], agent);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    tick();
    expect(await again).toEqual({ revision: store.revision(doc.id) });
    expect(committed('SELECT opId FROM artifact_ops')).toEqual([{ opId: 'toolu_f' }]);
  });

  it('fails a mutating run that never records its op, or records it outside a write’s savepoint (M3 review finding 6)', async () => {
    await expect(store.withOp('toolu_m', 'artifact_create', null, (scope) => store.create({ kind: 'document', title: 'Unrecorded' }, agent).then((a) => (void scope, a)))).rejects.toThrow(
      /artifact_create .*never recorded its op/,
    );
    await expect(store.withOp(undefined, 'artifact_create', null, () => store.create({ kind: 'document', title: 'No id' }, agent))).rejects.toThrow(/never recorded its op/);
    await expect(
      store.withOp('toolu_o', 'artifact_create', null, async (scope) => {
        scope.record({ early: true });
        return { early: true };
      }),
    ).rejects.toThrow(/inside the savepoint/);
    expect(committed('SELECT COUNT(*) AS n FROM artifact_ops')[0].n).toBe(0);
  });

  it('records each mutating store operation’s op in the savepoint of the write that commits it (M3 review finding 6)', async () => {
    const op = <R>(opId: string, tool: string, artifactId: string | null, run: (record: (result: R) => void) => Promise<unknown>) =>
      store.withOp(opId, tool, artifactId, async (scope) => {
        let recorded: R | undefined;
        await run((result) => scope.record((recorded = result)));
        return recorded as R;
      });
    const stored = (opId: string) => JSON.parse(committed('SELECT result FROM artifact_ops WHERE opId = ?', opId)[0].result as string) as unknown;

    const doc = await op<{ id: string }>('t1', 'artifact_create', null, (record) => store.create({ kind: 'document', title: 'Plan' }, agent, (a) => record(a)));
    expect(stored('t1')).toMatchObject({ id: doc.id, title: 'Plan' });
    await op('t2', 'update', doc.id, (record) => store.update(doc.id, { title: 'Plan 2' }, (a) => record(a.title)));
    expect(stored('t2')).toBe('Plan 2');
    await op('t3', 'link', doc.id, (record) => store.link(doc.id, sid('app-3'), 'viewed', () => record('linked')));
    const asset = await op<{ assetId: string }>('t4', 'artifact_upload_asset', doc.id, (record) => store.uploadAsset(doc.id, new Uint8Array([7]), { name: 'a.png', mime: 'image/png' }, agent, record));
    const same = await op<{ assetId: string }>('t5', 'artifact_upload_asset', doc.id, (record) => store.uploadAsset(doc.id, new Uint8Array([7]), { name: 'b.png', mime: 'image/png' }, agent, record));
    expect(same.assetId).toBe(asset.assetId); // a deduplicated upload writes no row but still records its op
    await write(doc.id, agent, (d) => d.get('root').insert(0, 'x'));
    const version = await op<number | null>('t6', 'version', doc.id, (record) => store.createVersion(doc.id, { kind: 'named', actor: agent, label: 'v' }, record));
    await op('t7', 'restore', doc.id, (record) => store.restore(doc.id, version!, agent, record));
    const copy = await op<{ id: string }>('t8', 'duplicate', doc.id, (record) => store.duplicate(doc.id, {}, agent, record));
    expect(store.get(copy.id)).not.toBeNull();
    const page = await op<{ id: string }>('t9', 'artifact_create', null, (record) => store.create({ kind: 'html', title: 'Page', content: { bytes: html('one') } }, agent, record));
    await op('t10', 'artifact_publish', page.id, (record) => store.writeContent(page.id, { bytes: html('two') }, agent, {}, record));
    await op('t11', 'delete', page.id, (record) => store.delete(page.id, () => record('deleted')));
    expect(committed('SELECT opId FROM artifact_ops ORDER BY opId').map((row) => row.opId)).toEqual(['t1', 't10', 't11', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9']);

    // Atomic: a write whose companion throws after recording takes back both its rows and the op row.
    await expect(
      store.withOp('t12', 'artifact_create', null, (scope) =>
        store.create({ kind: 'document', title: 'Lost' }, agent, (a) => {
          scope.record(a);
          throw new Error('after the record');
        }),
      ),
    ).rejects.toThrow(/after the record/);
    expect(committed('SELECT COUNT(*) AS n FROM artifact_ops WHERE opId = ?', 't12')[0].n).toBe(0);
    expect(committed("SELECT COUNT(*) AS n FROM artifacts WHERE title = 'Lost'")[0].n).toBe(0);
  });
});

describe('ArtifactStore: maintenance and thinning (Decision Log 5, 8)', () => {
  it('thins only auto versions by age, re-bases a dropped delta’s successor, keeps every retained version exact, and a load is head plus tail', async () => {
    const doc = await store.create({ kind: 'document', title: 'Plan' }, human);
    const start = now;
    const captured = new Map<number, Uint8Array>();
    // 40 days of history: an auto version every 12 hours, a named one each week
    for (let i = 0; i < 80; i++) {
      now = start + i * 12 * HOUR;
      await write(doc.id, i % 2 ? agent : human, (d) => {
        d.get('root').insert(0, `day ${i} `);
        if (i % 5 === 0) d.get('root').delete(3, 4);
      });
      const kind = i % 14 === 13 ? 'named' : 'auto';
      const id = await store.createVersion(doc.id, { kind, actor: human });
      captured.set(id!, service.readState(doc.id).state);
    }
    const before = store.listVersions(doc.id);
    now = start + 80 * 12 * HOUR;
    const provenanceBefore = service.provenance(doc.id);
    const report = await store.maintenance.run();
    const after = store.listVersions(doc.id);
    expect(report.versionsThinned).toBe(before.length - after.length);
    expect(after.length).toBeLessThan(before.length);
    expect(after.filter((v) => v.kind === 'named')).toEqual(before.filter((v) => v.kind === 'named')); // never thinned
    expect(after.at(-1)!.id).toBe(before.at(-1)!.id); // the newest kept
    // within the last day every auto stays; older ones keep one per hour (here: all), per day, per week
    const day = (t: number) => Math.floor(t / DAY);
    const old = after.filter((v) => v.kind === 'auto' && now - v.at >= 7 * DAY && now - v.at < 30 * DAY);
    expect(new Set(old.map((v) => day(v.at))).size).toBe(old.length);
    for (const v of after) expect(canonicalV2(store.versionState(doc.id, v.id))).toEqual(canonicalV2(captured.get(v.id)!));
    reopen();
    for (const v of after) expect(canonicalV2(store.versionState(doc.id, v.id))).toEqual(canonicalV2(captured.get(v.id)!));
    // the head covers everything; the log rows older than 7 days are gone, the younger stay
    const rows = committed('SELECT at FROM artifact_updates WHERE artifactId = ?', doc.id).map((r) => r.at as number);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((t) => now - t <= 7 * DAY)).toBe(true);
    expect(committed('SELECT tier, COUNT(*) AS n FROM artifact_attributions GROUP BY tier ORDER BY tier').map((r) => r.tier)).toEqual(['day', 'hour']); // every row was over an hour old
    const loaded = newDoc();
    applyV2(loaded, service.readState(doc.id).state);
    expect(stateV2(loaded)).toEqual(captured.get(after.at(-1)!.id));
    // provenance answers identically after hour and day tiering
    const merged = service.provenance(doc.id);
    const probe = idAt(loaded.get('root'), 0)!;
    expect(insertedBy(merged, probe)).toEqual(insertedBy(provenanceBefore, probe));
    const deep = idAt(loaded.get('root'), loaded.get('root').length - 2)!;
    expect(insertedBy(merged, deep)).toEqual(insertedBy(provenanceBefore, deep));
    expect(insertedBy(decodeMap(store.attributions(doc.id, 1, store.revision(doc.id))), deep)).toEqual(insertedBy(provenanceBefore, deep));
  }, 60_000);

  it('folds a dropped delta into its successor, and promotes the successor of a dropped keyframe to a keyframe', async () => {
    const doc = await store.create({ kind: 'document', title: 'Plan' }, human);
    const states = new Map<number, Uint8Array>();
    await write(doc.id, human, (d) => d.get('root').insert(0, prose(1_000)));
    for (let i = 0; i < 4; i++) {
      if (i > 0) await write(doc.id, human, (d) => d.get('root').insert(i, `v${i} `));
      const id = (await store.createVersion(doc.id, { kind: 'named', actor: human }))!;
      states.set(id, service.readState(doc.id).state);
    }
    const [v1, v2, v3, v4] = [...states.keys()];
    const enc = () => committed('SELECT id, enc FROM artifact_versions ORDER BY id').map((r) => [r.id, r.enc]);
    expect(enc()).toEqual([
      [v1, 'full'],
      [v2, 'delta'],
      [v3, 'delta'],
      [v4, 'delta'],
    ]);
    await service.inBatch(() => store.versions.drop(doc.id, [v2]));
    expect(enc()).toEqual([
      [v1, 'full'],
      [v3, 'delta'],
      [v4, 'delta'],
    ]);
    await service.inBatch(() => store.versions.drop(doc.id, [v1]));
    expect(enc()).toEqual([
      [v3, 'full'],
      [v4, 'delta'],
    ]);
    reopen();
    for (const id of [v3, v4]) expect(canonicalV2(store.versionState(doc.id, id))).toEqual(canonicalV2(states.get(id)!));
  });

  it('prunes versions older than a date on the owner’s word, except pinned states, and a byte kind’s live content', async () => {
    const system = await store.create({ kind: 'design_system', title: 'House style' }, human);
    await write(system.id, human, (d) => d.get('files').setAttr('DESIGN.md', '# v1'));
    const doc = await store.create({ kind: 'document', title: 'Letter', designSystemId: system.id }, human);
    await write(doc.id, human, (d) => d.get('root').insert(0, 'a'));
    await store.createVersion(doc.id, { kind: 'named', actor: human }); // pins the system's auto version
    const page = await store.create({ kind: 'html', title: 'Page', content: { bytes: html('one') } }, agent);
    await store.writeContent(page.id, { bytes: html('two') }, agent);
    const oldPage = store.contentRef(page.id, store.listVersions(page.id)[0].seq).path;
    now += 10 * DAY;
    await write(doc.id, human, (d) => d.get('root').insert(0, 'b'));
    await store.createVersion(doc.id, { kind: 'named', actor: human });
    const pruned = await store.pruneVersions(null, now - DAY);
    expect(store.listVersions(system.id)).toHaveLength(1); // pinned
    expect(store.listVersions(doc.id)).toHaveLength(1);
    expect(store.listVersions(page.id)).toHaveLength(1); // the live content's version stays
    expect(pruned).toBe(2);
    expect(existsSync(oldPage)).toBe(false);
    expect(existsSync(store.contentRef(page.id).path)).toBe(true);
    const latest = store.listVersions(doc.id)[0];
    expect(canonicalV2(store.versionState(doc.id, latest.id))).toEqual(canonicalV2(service.readState(doc.id).state));
  });
});

describe('ArtifactStore: the change feed and attributions', () => {
  it('reports document commits at most once per 250 ms per artifact, the latest revision winning', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const doc = await store.create({ kind: 'document', title: 'Plan' }, human);
    const seen: ArtifactChanged[] = [];
    store.onChange((change) => seen.push(change));
    const r1 = await write(doc.id, human, (d) => d.get('root').insert(0, 'a'));
    await write(doc.id, human, (d) => d.get('root').insert(0, 'b'));
    const r3 = await write(doc.id, human, (d) => d.get('root').insert(0, 'c'));
    expect(seen).toEqual([{ artifactId: doc.id, kind: 'document', revision: r1, change: 'updated' }]);
    await vi.advanceTimersByTimeAsync(250);
    expect(seen.map((c) => c.revision)).toEqual([r1, r3]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(seen).toHaveLength(2);
    expect(store.get(doc.id)!.updatedAt).toBe(now); // stamped in the commit
  });

  it('answers the merged attributions of a seq range', async () => {
    const doc = await store.create({ kind: 'document', title: 'Plan' }, human);
    const r1 = await write(doc.id, agent, (d) => d.get('root').insert(0, 'agent'));
    const r2 = await write(doc.id, human, (d) => d.get('root').insert(5, ' human'));
    const live = newDoc();
    applyV2(live, service.readState(doc.id).state);
    const agentChar = idAt(live.get('root'), 0)!;
    const humanChar = idAt(live.get('root'), 6)!;
    const first = decodeMap(store.attributions(doc.id, r1, r1));
    expect(insertedBy(first, agentChar)?.actor).toBe('session:app-1');
    expect(insertedBy(first, humanChar)).toBeNull();
    expect(insertedBy(decodeMap(store.attributions(doc.id, r2, r2)), humanChar)?.actor).toBe('human');
  });
});

describe('ArtifactStore: refusals', () => {
  it('refuses wrong content per kind and unknown targets with typed errors', async () => {
    await expect(store.create({ kind: 'html', title: 'x' }, human)).rejects.toBeInstanceOf(ArtifactStoreError);
    await expect(store.create({ kind: 'document', title: 'x', content: { bytes: html('x') } }, human)).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.create({ kind: 'document', title: 'x', spaceId: '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d' }, human)).rejects.toMatchObject({ code: 'notFound' });
    const doc = await store.create({ kind: 'document', title: 'x' }, human);
    await expect(store.update(doc.id, { designSystemId: doc.id })).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.restore(doc.id, 999, human)).rejects.toMatchObject({ code: 'notFound' });
    expect(() => store.versionState(doc.id, 999)).toThrow(ArtifactStoreError);
  });
});
