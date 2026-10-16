// P3-E1 M4 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4): the design's e2e seam on A's real service
// and store: a move, a reply and a resolution land as the session named, each followed by the scheduler's `auto` version
// credited to it (what "See N new changes" needs); the channel answers a command file; the seam is off unless the host
// runs under MAWS_E2E=1 with its directory named. And the history after a host restart: the store's retained version
// states, read back by a reopened store, still pair the agent's cross-board moves (derived and collision-fallback ids,
// two hops) as moves credited to the session, through the store's own provenance.
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDesignAdapter } from '@artifacts/design/adapter';
import { CANVAS_PATH } from '@artifacts/design/canvas';
import { designChanges, type ElementMove } from '@artifacts/design/history';
import { moveElementToBoard } from '@artifacts/design/move';
import { publishCanvas } from '@artifacts/design/publish';
import { deckChanges, elementHistory, openDeckDiff } from '@artifacts/slides/history';
import { ROOT } from '@artifacts/slides/model';
import { addThread, threadStates } from '@artifacts/slides/threads';
import { applyV2, decodeMap, newDoc, type Doc } from '@artifacts/yjs';
import * as Y from '@artifacts/yjs/slides';
import type { Actor } from '@shared/artifacts/actor';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';
import { designSeamDir, runDesignSeamCommand, startDesignSeam } from './history-seam';

const human: Actor = { kind: 'human' };
const SESSION = '00000000-0000-4000-8000-0000000000e3';
const FILES = {
  [CANVAS_PATH]: JSON.stringify({ v: 1, title: 'T', boards: { a: { x: 0, y: 0, w: 390, h: 844 }, b: { x: 500, y: 0, w: 1440, h: 1024 }, c: { x: 2000, y: 0, w: 800, h: 600 } }, order: ['a', 'b', 'c'] }),
  'project/boards/a.html': '<section id="a"><p id="e1">Moved text</p><p id="e2">Second</p></section>',
  'project/boards/b.html': '<section id="b"><p id="other">Other</p></section>',
  'project/boards/c.html': '<section id="c"><p id="far">Far</p></section>',
};

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
  dir = mkdtempSync(join(tmpdir(), 'maws-design-history-'));
  open();
});
afterEach(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

async function seeded(): Promise<string> {
  const design = await store.create({ kind: 'design', title: 'T' }, human);
  await service.writeAs(design.id, human, (doc) => {
    const outcome = publishCanvas(doc, {}, { ...FILES, 'project/boards/desktop.html': null }, true);
    if (outcome.conflicts.length > 0) throw new Error('seed');
  });
  return design.id;
}
const docAt = (state: Uint8Array): Doc => {
  const doc = newDoc();
  applyV2(doc, state);
  return doc;
};
const write = (id: string, edit: Parameters<typeof runDesignSeamCommand>[1]['edit']) => runDesignSeamCommand({ store, service }, { cmd: 'write', artifactId: id, session: SESSION, edit });

describe('the design’s e2e seam', () => {
  it('moves, replies and resolves as the session, each leaving the agent’s `auto` version the pill compares with', async () => {
    const id = await seeded();
    await service.writeAs(id, human, (doc) => addThread(doc, { threadId: 't1', slideId: 'a', elementId: ROOT, quote: 'a', by: human, at: 1, body: 'Taller?' }));
    await store.markViewed(id);
    const viewedAt = store.get(id)!.lastViewedAt!;
    const moved = await write(id, { op: 'move', from: 'a', to: 'b', elementId: 'e1' });
    expect(moved).toMatchObject({ ok: true, moved: expect.stringMatching(/^m[0-9a-z]{8}$/) });
    expect(await write(id, { op: 'reply', threadId: 't1', body: 'Done.' })).toMatchObject({ ok: true });
    expect(await write(id, { op: 'resolve', threadId: 't1' })).toMatchObject({ ok: true });
    const versions = store.listVersions(id);
    expect(versions.at(-1)).toMatchObject({ kind: 'auto', actor: { kind: 'session', appSessionId: SESSION } });
    expect(versions.at(-1)!.at).toBeGreaterThanOrEqual(viewedAt);
    const live = docAt(service.readState(id).state);
    const thread = threadStates(live).find((t) => t.id === 't1')!;
    expect(thread.status).toBe('resolved');
    expect(thread.messages.at(-1)).toMatchObject({ body: 'Done.', by: { kind: 'session', appSessionId: SESSION } });
  });

  it('refuses what is not a design, answers a command file through its channel, and is off without MAWS_E2E and its directory', async () => {
    const deck = await store.create({ kind: 'document', title: 'D' }, human);
    expect(await write(deck.id, { op: 'resolve', threadId: 'x' })).toMatchObject({ ok: false, error: `${deck.id} is not a design` });
    const id = await seeded();
    const channel = join(dir, 'channel');
    const seam = startDesignSeam({ store, service }, channel, () => {});
    try {
      writeFileSync(join(channel, 'in', '1.json.tmp'), JSON.stringify({ cmd: 'write', artifactId: id, session: SESSION, edit: { op: 'setFrame', boardId: 'c', frame: { x: 2100 } } }));
      renameSync(join(channel, 'in', '1.json.tmp'), join(channel, 'in', '1.json'));
      const out = join(channel, 'out', '1.json');
      for (let i = 0; i < 100 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 20));
      expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({ ok: true });
    } finally {
      seam.close();
    }
    expect(designSeamDir({ MAWS_DESIGN_HISTORY: '/tmp/x' })).toBeNull();
    expect(designSeamDir({ MAWS_E2E: '1' })).toBeNull();
    expect(designSeamDir({ MAWS_E2E: '1', MAWS_DESIGN_HISTORY: '/tmp/x' })).toBe('/tmp/x');
  });
});

describe('a design’s history after a host restart', () => {
  it('still pairs the agent’s derived, collision-fallback and two-hop moves from the retained versions, credited to the session', async () => {
    const id = await seeded();
    const before = (await store.createVersion(id, { kind: 'named', actor: human, label: 'Before' }))!;
    const first = await write(id, { op: 'move', from: 'a', to: 'b', elementId: 'e1' });
    const hop = first.ok ? first.moved! : '';
    // the id the next hop would derive is already on c: C's minter names the moved element instead
    const scratch = docAt(service.readState(id).state);
    const squat = moveElementToBoard(scratch, 'b', 'c', hop).ids.get(hop)!;
    await service.writeAs(id, human, (doc) => Y.createElement(doc, 'c', squat, { tag: 'p', parent: '', order: 'a5' }, [{ type: 'p', inline: [{ text: 'Squatter', marks: {} }] }]));
    const second = await write(id, { op: 'move', from: 'b', to: 'c', elementId: hop });
    const third = await write(id, { op: 'move', from: 'a', to: 'c', elementId: 'e2' });
    const after = (await store.createVersion(id, { kind: 'named', actor: human, label: 'After' }))!;
    close();
    open(); // the restart: a new store over the same file

    const versions = store.listVersions(id);
    const [v0, v1] = [versions.find((v) => v.id === before)!, versions.find((v) => v.id === after)!];
    const diff = openDeckDiff({ prevState: store.versionState(id, v0.id), nextState: store.versionState(id, v1.id), attributions: decodeMap(store.attributions(id, v0.seq, v1.seq)) });
    try {
      const projected = designChanges(diff, deckChanges(diff), (earlier, shown) => elementHistory(diff, earlier, shown));
      const moves = projected.boards.flatMap((b) => b.elements.filter((e): e is ElementMove => e.kind === 'moved').map((e) => ({ board: b.id, ...e })));
      expect(moves.map((m) => [m.board, m.id, m.from, m.by])).toEqual(
        expect.arrayContaining([
          ['c', second.ok ? second.moved : '', { board: 'a', id: 'e1' }, `session:${SESSION}`],
          ['c', third.ok ? third.moved : '', { board: 'a', id: 'e2' }, `session:${SESSION}`],
        ]),
      );
      expect(second.ok && second.moved).not.toBe(squat); // the collision fell back to C's minter
      expect(moves).toHaveLength(2);
    } finally {
      diff.destroy();
    }
  });
});
