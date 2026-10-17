// P3-E1 M1 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md; the parent's Decision Log 13 (1), (2), (4)): the
// design adapter on A's real document service and store (a fresh SQLite file, as `openDocuments` makes them): a create
// seeds the first board credited to its creator; a publish the manifest refuses leaves the state, the revision, the log
// and the commit announcements untouched though its board files would have landed; an agent publish lands mid-drag and the
// owner's ⌘Z takes back only the drag; a restore brings back the geometry, the elements and a board's title and keeps
// every conversation since (a board-level thread included); the concurrent frame repair lands as the triggering actor's
// write; a move's origin association survives a restart. M2 registers the adapter in the host; this test registers it
// as the store's tests register theirs.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDesignAdapter } from '@artifacts/design/adapter';
import { FilesError } from '@artifacts/files';
import { boardPath, CANVAS_PATH, parseCanvasJson, serializeCanvasJson, type CanvasJson } from '@artifacts/design/canvas';
import { boardFrame, designFiles, writeBoardEntry } from '@artifacts/design/model';
import { moveElementToBoard, moveOriginOf } from '@artifacts/design/move';
import { setBoardFrame } from '@artifacts/design/writers';
import { readSlide, ROOT, setStyle } from '@artifacts/slides/model';
import { addThread, reply, resolve, threadStates } from '@artifacts/slides/threads';
import { applyV1, applyV2, diffV1, newDoc, onUpdate, stateVector, transact, type Doc } from '@artifacts/yjs';
import { createDeckUndo } from '@artifacts/yjs/slides-undo';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';

const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: 'app-1' as AppSessionId };
const other: Actor = { kind: 'session', appSessionId: 'app-2' as AppSessionId };

let dir: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
const open = () => {
  storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { log: () => {}, kindOf: (id) => storage.kindOf(id), adapters: [createDesignAdapter()] });
  store = new ArtifactStore(service, storage, { root: dir, log: () => {} });
};
const close = () => {
  store.close();
  service.close();
  storage.close();
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-design-'));
  open();
});
afterEach(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

const rows = (artifactId: string) => {
  const db = new DatabaseSync(join(dir, 'store.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT seq, actor FROM artifact_updates WHERE artifactId = ? ORDER BY seq').all(artifactId) as { seq: number; actor: string }[];
  } finally {
    db.close();
  }
};
/** The design as a fresh replica sees it. */
function replicaOf(artifactId: string): Doc {
  const doc = newDoc();
  applyV2(doc, service.readState(artifactId).state);
  return doc;
}
const kind = () => service.adapterFor('design')!;
const sentWith = (base: Record<string, string>, edit: (c: CanvasJson) => void, files: Record<string, string | null> = {}) => {
  const parsed = parseCanvasJson(base[CANVAS_PATH]!);
  if (!parsed.ok) throw new Error(parsed.problems.join('; '));
  edit(parsed.canvas);
  return { [CANVAS_PATH]: serializeCanvasJson(parsed.canvas), ...files };
};
const BOARDS = {
  [CANVAS_PATH]: JSON.stringify({
    v: 1,
    title: 'D',
    boards: { b1: { x: 0, y: 0, w: 390, h: 844, title: 'Phone' }, b2: { x: 500, y: 0, w: 1440, h: 1024 }, b3: { x: 2000, y: 0, w: 1080, h: 8192 } },
    order: ['b1', 'b2', 'b3'],
  }),
  [boardPath('b1')]: '<section id="b1"><h1 id="title" style="font-size:72px">Title b1</h1><p id="e1" style="font-size:32px">Moved text</p></section>',
  [boardPath('b2')]: '<section id="b2"><h1 id="title" style="font-size:72px">Title b2</h1></section>',
  [boardPath('b3')]: '<section id="b3"><p id="body" style="font-size:32px">Body of b3</p></section>',
};
/** A design created by the agent from its files (A's create: the kind's publish on the empty doc, in the create's commit). */
const createDesign = async (): Promise<string> => {
  const a = await store.create({ kind: 'design', title: 'D', initial: (doc: Doc) => void kind().publish!(doc, {}, BOARDS, false) } as never, agent);
  return a.id;
};
const publishAs = (id: string, actor: Actor, base: Record<string, string>, sent: Record<string, string | null>, force = false) => {
  let out!: ReturnType<NonNullable<ReturnType<typeof kind>['publish']>>;
  return service.writeAs(id, actor, (doc) => void (out = kind().publish!(doc, base, sent, force))).then(() => out);
};

describe('the design adapter on the document service', () => {
  it('seeds a created design with its manifest and first board in the create’s commit, credited to the creator', async () => {
    const d = await store.create({ kind: 'design', title: 'Launch' }, agent);
    const files = designFiles(replicaOf(d.id));
    expect(Object.keys(files)).toEqual([CANVAS_PATH, boardPath('desktop')]);
    expect(JSON.parse(files[CANVAS_PATH]!)).toMatchObject({ title: 'Launch', boards: { desktop: { x: 0, y: 0, w: 1440, h: 1024 } } });
    expect(rows(d.id).map((r) => r.actor)).toEqual(['session:app-1']);
  });

  it('leaves the state, the revision, the log and the commit announcements untouched when the manifest refuses a publish whose board files would land', async () => {
    const id = await createDesign();
    const base = designFiles(replicaOf(id));
    await service.writeAs(id, human, (doc) => setBoardFrame(doc, 'b2', { w: 999 }));
    const events: unknown[] = [];
    const off = service.onCommitted((change) => events.push(change));
    const [revision, logged, state] = [service.revision(id), rows(id).length, designFiles(replicaOf(id))];
    const out = await publishAs(id, agent, base, sentWith(base, (c) => (c.boards.b2!.w = 1200), { [boardPath('b3')]: base[boardPath('b3')]!.replace('Body of b3', 'Body three') }));
    await service.whenCommitted();
    expect(out.conflicts).toEqual([{ path: CANVAS_PATH, detail: 'board b2: w changed since your read' }]);
    expect(service.revision(id)).toBe(revision);
    expect(rows(id)).toHaveLength(logged);
    expect(designFiles(replicaOf(id))).toEqual(state);
    expect(events).toEqual([]);
    // the same publish, its manifest change dropped, lands and is announced
    const landed = await publishAs(id, agent, base, { [boardPath('b3')]: base[boardPath('b3')]!.replace('Body of b3', 'Body three') });
    await service.whenCommitted();
    expect(landed.changed).toEqual([boardPath('b3')]);
    expect(rows(id)).toHaveLength(logged + 1);
    expect(events.length).toBeGreaterThan(0);
    off();
  });

  // the parent's Decision Log 38: C's half runs once, on the live state inside the one transaction, when Design's own
  // plan refuses nothing; its refusal or its plan's FilesError must leave everything as it was
  const settled = async (id: string, run: () => Promise<unknown>) => {
    await service.whenCommitted();
    const events: unknown[] = [];
    const off = service.onCommitted((change) => events.push(change));
    const before = [service.revision(id), rows(id).length, designFiles(replicaOf(id))] as const;
    const result = await run();
    await service.whenCommitted();
    off();
    expect([service.revision(id), rows(id).length, designFiles(replicaOf(id)), events]).toEqual([...before, []]);
    return result;
  };
  const restyle = (base: Record<string, string>) => base[boardPath('b1')]!.replace('font-size:72px', 'font-size:72px; color:#123456');

  it('(Decision Log 38) leaves the state, the revision, the log and the announcements untouched when only C’s half conflicts beside a clean manifest change', async () => {
    const id = await createDesign();
    const base = designFiles(replicaOf(id));
    await service.writeAs(id, human, (doc) => setStyle(doc, 'b1', 'title', { color: '#ff0000' }));
    const out = (await settled(id, () => publishAs(id, agent, base, sentWith(base, (c) => (c.boards.b2!.w = 1200), { [boardPath('b1')]: restyle(base) })))) as { conflicts: unknown[] };
    expect(out.conflicts).toEqual([{ path: boardPath('b1'), detail: 'element title: color changed since your read' }]);
  });

  it('(Decision Log 38) leaves everything untouched when C’s plan throws its FilesError beside a clean manifest change (answered as A answers it)', async () => {
    const id = await createDesign();
    const base = designFiles(replicaOf(id));
    let failure: unknown;
    await settled(id, () =>
      service.writeAs(id, agent, (doc) => {
        try {
          kind().publish!(doc, base, sentWith(base, (c) => (c.boards.b2!.w = 1200), { [boardPath('b2')]: '<section id="other"><script></script></section>' }), false);
        } catch (error) {
          if (!(error instanceof FilesError)) throw error;
          failure = error; // `artifact_publish` answers the kind's documented refusal after the write (isFilesRefusal)
        }
      }),
    );
    expect((failure as FilesError).problems).toEqual([{ path: boardPath('b2'), message: 'the section’s id is "other", not the file name’s "b2"' }]);
  });

  it('(Decision Log 38) answers C’s conflicts beside Design’s own when Design refuses, leaving everything untouched', async () => {
    const id = await createDesign();
    const base = designFiles(replicaOf(id));
    await service.writeAs(id, human, (doc) => {
      setStyle(doc, 'b1', 'title', { color: '#ff0000' });
      setBoardFrame(doc, 'b2', { w: 999 });
    });
    const out = (await settled(id, () => publishAs(id, agent, base, sentWith(base, (c) => (c.boards.b2!.w = 1200), { [boardPath('b1')]: restyle(base) })))) as { conflicts: unknown[] };
    expect(out.conflicts).toEqual([
      { path: CANVAS_PATH, detail: 'board b2: w changed since your read' },
      { path: boardPath('b1'), detail: 'element title: color changed since your read' },
    ]);
  });

  it('lands an agent publish mid-drag with the drag intact, and the owner’s ⌘Z takes back the drag alone', async () => {
    const id = await createDesign();
    const base = designFiles(replicaOf(id));
    const owner = replicaOf(id);
    const undo = createDeckUndo(owner);
    let n = 0;
    const frame = async () => {
      n++;
      const updates: Uint8Array[] = [];
      const offUpdate = onUpdate(owner, (u) => updates.push(u));
      setBoardFrame(owner, 'b3', { x: 2000 + 10 * n, y: 5 * n }, undo.origin);
      offUpdate();
      await service.writeAs(id, human, (host) => updates.forEach((u) => applyV1(host, u)));
    };
    const pull = () => applyV1(owner, diffV1(replicaOf(id), stateVector(owner)), 'remote');
    undo.cut();
    for (let i = 0; i < 5; i++) await frame();
    const out = await publishAs(id, agent, base, sentWith(base, (c) => ((c.boards.b1!.x = 50), (c.boards.b2!.w = 1200)), { [boardPath('b1')]: base[boardPath('b1')]!.replace('font-size:72px', 'font-size:72px; color:#123456') }));
    expect(out.conflicts).toEqual([]);
    pull();
    for (let i = 0; i < 5; i++) await frame();
    undo.cut();
    pull();
    const host = replicaOf(id);
    expect(boardFrame(host, 'b3')).toEqual({ x: 2100, y: 50, w: 1080, h: 8192 });
    expect(boardFrame(host, 'b1')).toEqual({ x: 50, y: 0, w: 390, h: 844 });
    expect(designFiles(owner)).toEqual(designFiles(host));
    expect(undo.undo()).toBe(true);
    expect(boardFrame(owner, 'b3')).toEqual({ x: 2000, y: 0, w: 1080, h: 8192 });
    expect(boardFrame(owner, 'b1')).toEqual({ x: 50, y: 0, w: 390, h: 844 });
    expect(readSlide(owner, 'b1').children[0]!.style.color).toBe('#123456');
    expect(undo.canUndo()).toBe(false);
  });

  it('restores the geometry, the elements and a board’s title as a new version, keeping every conversation since (a board’s own included)', async () => {
    const id = await createDesign();
    await service.writeAs(id, human, (doc) => {
      addThread(doc, { threadId: 'te', slideId: 'b1', elementId: 'title', quote: '', by: human, at: 1_000, body: 'Bigger?' });
      addThread(doc, { threadId: 'tb', slideId: 'b1', elementId: ROOT, quote: '', by: human, at: 1_001, body: 'This screen?' });
      addThread(doc, { threadId: 'tg', slideId: 'b2', elementId: ROOT, quote: '', by: human, at: 1_002, body: 'And this?' });
    });
    const at = (await store.createVersion(id, { kind: 'named', actor: human, label: 'v1' }))!;
    const atVersion = designFiles(replicaOf(id));

    for (const [x, y] of [
      [100, 50],
      [300, 150],
    ])
      await service.writeAs(id, human, (doc) => setBoardFrame(doc, 'b1', { x, y }));
    await service.writeAs(id, human, (doc) => setBoardFrame(doc, 'b1', { w: 1440, h: 1024 }));
    await service.writeAs(id, agent, (doc) => {
      setStyle(doc, 'b1', 'title', { color: '#ff0000' });
      transact(doc, () => writeBoardEntry(doc, 'b1', { title: 'Tablet' }));
    });
    await service.writeAs(id, human, (doc) => kind().publish!(doc, designFiles(doc), { [boardPath('b2')]: null }, false));
    await service.writeAs(id, agent, (doc) => {
      reply(doc, 'te', { id: 'te:a', by: agent, at: 2_000, body: 'Done.' });
      reply(doc, 'tg', { id: 'tg:a', by: agent, at: 2_001, body: 'Removed it.' });
      resolve(doc, 'te', agent, 2_002); // M6: resolved since the version, where it was open
    });
    const before = replicaOf(id);
    expect(threadStates(before).map((t) => [t.id, t.live, t.quote, t.status])).toEqual([
      ['te', true, 'Title b1', 'resolved'],
      ['tb', true, 'Tablet', 'open'],
      ['tg', false, 'b2', 'open'],
    ]);

    await store.restore(id, at, human);
    const live = replicaOf(id);
    expect(designFiles(live)).toEqual(atVersion);
    expect(boardFrame(live, 'b1')).toEqual({ x: 0, y: 0, w: 390, h: 844 });
    // M6: the status comes back with the version (the resolved thread open again), the reply posted since stays
    expect(threadStates(live).map((t) => [t.id, t.live, t.orphan, t.quote, t.status, t.messages.map((m) => m.body)])).toEqual([
      ['te', true, false, 'Title b1', 'open', ['Bigger?', 'Done.']],
      ['tb', true, false, 'Phone', 'open', ['This screen?']],
      ['tg', true, false, 'b2', 'open', ['And this?', 'Removed it.']],
    ]);
    expect(store.listVersions(id).map((v) => v.kind)).toContain('restore');
  });

  // Parent Decision Log 17: only the host's afterUpdate bounds a frame, and only one that concurrent merging alone made;
  // each write below is valid by itself
  for (const order of ['w first', 'h first'] as const)
    it(`repairs a frame two replicas’ valid writes merged past the cap (${order}), credited to the actor whose update produced the merge`, async () => {
      const id = await createDesign();
      await service.writeAs(id, human, (doc) => setBoardFrame(doc, 'b2', { w: 8192, h: 4096 }));
      const [wide, tall] = [replicaOf(id), replicaOf(id)];
      const [svWide, svTall] = [stateVector(wide), stateVector(tall)];
      setBoardFrame(wide, 'b2', { w: 16_384 }); // 16384×4096, inside
      setBoardFrame(tall, 'b2', { h: 8192 }); // 8192×8192, inside
      const [first, second] = order === 'w first' ? [[wide, svWide, agent] as const, [tall, svTall, other] as const] : [[tall, svTall, other] as const, [wide, svWide, agent] as const];
      await service.writeAs(id, first[2], (doc) => applyV1(doc, diffV1(first[0], first[1])));
      expect(boardFrame(replicaOf(id), 'b2')).toEqual(order === 'w first' ? { x: 500, y: 0, w: 16_384, h: 4096 } : { x: 500, y: 0, w: 8192, h: 8192 });
      const logged = rows(id).length;
      await service.writeAs(id, second[2], (doc) => applyV1(doc, diffV1(second[0], second[1])));
      const added = rows(id).slice(logged);
      expect(added.length).toBeGreaterThan(0);
      expect(added.every((r) => r.actor === (second[2] === agent ? 'session:app-1' : 'session:app-2'))).toBe(true);
      const host = replicaOf(id);
      expect(boardFrame(host, 'b2')).toEqual({ x: 500, y: 0, w: 16_384, h: 4096 });
      // both replicas converge on the repaired frame when they pull
      for (const r of [wide, tall]) applyV1(r, diffV1(host, stateVector(r)), 'remote');
      expect(boardFrame(wide, 'b2')).toEqual(boardFrame(host, 'b2'));
      expect(boardFrame(tall, 'b2')).toEqual(boardFrame(host, 'b2'));
    });

  it('repairs a reconnecting replica’s offline resize that merges past the cap with edits made meanwhile, credited to the reconnecting actor', async () => {
    const id = await createDesign();
    await service.writeAs(id, human, (doc) => setBoardFrame(doc, 'b2', { w: 8192, h: 4096 }));
    const offline = replicaOf(id);
    const sv = stateVector(offline);
    setBoardFrame(offline, 'b2', { w: 12_000 }); // offline: 12000×4096
    setBoardFrame(offline, 'b2', { w: 16_384 }); // offline: 16384×4096
    await service.writeAs(id, human, (doc) => setBoardFrame(doc, 'b2', { h: 8000 })); // meanwhile: 8192×8000
    await service.writeAs(id, human, (doc) => setBoardFrame(doc, 'b1', { x: 10 }));
    const logged = rows(id).length;
    await service.writeAs(id, other, (doc) => applyV1(doc, diffV1(offline, sv))); // the reconnect's one frame
    expect(rows(id).slice(logged).every((r) => r.actor === 'session:app-2')).toBe(true);
    expect(boardFrame(replicaOf(id), 'b2')).toEqual({ x: 500, y: 0, w: 16_384, h: 4096 });
    applyV1(offline, diffV1(replicaOf(id), stateVector(offline)), 'remote');
    expect(designFiles(offline)).toEqual(designFiles(replicaOf(id)));
  });

  it('leaves the state, the revision and the announcements untouched when an agent removes a manifest-only board whose file arrived since its read', async () => {
    const id = await createDesign();
    const base = designFiles(replicaOf(id));
    await publishAs(id, human, base, sentWith(base, (c) => (c.boards.later = { x: 0, y: 9000, w: 390, h: 844 })));
    const read = designFiles(replicaOf(id));
    expect(read[boardPath('later')]).toBeUndefined();
    await publishAs(id, other, read, { [boardPath('later')]: '<section id="later"><p id="p" style="font-size:16px">Arrived</p></section>' });
    await service.whenCommitted();
    const events: unknown[] = [];
    const off = service.onCommitted((change) => events.push(change));
    const [revision, logged, state] = [service.revision(id), rows(id).length, designFiles(replicaOf(id))];
    const out = await publishAs(id, agent, read, { [boardPath('later')]: null });
    await service.whenCommitted();
    off();
    expect(out.conflicts).toEqual([{ path: boardPath('later'), detail: 'board: changed since your read' }]);
    expect([service.revision(id), rows(id).length, events]).toEqual([revision, logged, []]);
    expect(designFiles(replicaOf(id))).toEqual(state);
    expect(state[boardPath('later')]).toContain('Arrived');
  });

  it('keeps a moved element’s origin association across moves and a restart of the store', async () => {
    const id = await createDesign();
    let first = '';
    await service.writeAs(id, human, (doc) => void (first = moveElementToBoard(doc, 'b1', 'b2', 'e1').ids.get('e1')!));
    close();
    open();
    let second = '';
    await service.writeAs(id, human, (doc) => void (second = moveElementToBoard(doc, 'b2', 'b3', first).ids.get(first)!));
    close();
    open();
    const live = replicaOf(id);
    expect(moveOriginOf(live, 'b3', second)).toEqual({ board: 'b1', element: 'e1' });
    expect(designFiles(live)[boardPath('b3')]).toContain('Moved text');
  });
});
