// P3-C M8 fix wave 1 (R4; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11): the deck history's e2e seam on
// A's real service and store: a write lands as the session named (its log row, its provenance), then the scheduler's
// `auto` version credited to that session, which is what "See N new changes" needs between two of the owner's views; the
// channel answers a command file; the seam is off unless the host runs under MAWS_E2E=1 with its directory named.
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPresentationAdapter } from '@artifacts/slides/adapter';
import { readFlat } from '@artifacts/slides/model';
import { decodeMap, insertedBy, newDoc, applyV2 } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';
import { historySeamDir, runDeckHistoryCommand, startDeckHistorySeam } from './history-seam';

const human: Actor = { kind: 'human' };
const SESSION = '00000000-0000-4000-8000-0000000000a1';

let dir: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-deck-history-'));
  storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { log: () => {}, kindOf: (id) => storage.kindOf(id), adapters: [createPresentationAdapter()] });
  store = new ArtifactStore(service, storage, { root: dir, log: () => {} });
});
afterEach(() => {
  store.close();
  service.close();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the deck history’s e2e seam (R4)', () => {
  it('writes as the session between two of the owner’s views, and leaves the version the pill compares with', async () => {
    const deck = await store.create({ kind: 'presentation', title: 'T' }, human); // the cover slide, `cover`
    await store.markViewed(deck.id);
    const viewedAt = store.get(deck.id)!.lastViewedAt;
    const answer = await runDeckHistoryCommand({ store, service }, { cmd: 'write', artifactId: deck.id, session: SESSION, edit: { op: 'setNotes', slideId: 'cover', text: 'From the agent' } });
    expect(answer).toMatchObject({ ok: true });
    const versions = store.listVersions(deck.id);
    expect(versions.at(-1)).toMatchObject({ kind: 'auto', actor: { kind: 'session', appSessionId: SESSION } });
    expect(versions.at(-1)!.at).toBeGreaterThanOrEqual(viewedAt!); // the pill's condition: an agent's version since the view
    // the notes are the session's in provenance
    const doc = newDoc();
    applyV2(doc, service.readState(deck.id).state);
    const notes = doc.get('slides').getAttr('cover').getAttr('notes');
    const first = notes._start!;
    expect(insertedBy(decodeMap(store.attributions(deck.id, 0, Number.MAX_SAFE_INTEGER)), first.id)?.actor).toBe(`session:${SESSION}`);
    expect(readFlat(doc, 'cover').length).toBeGreaterThan(0);
  });

  it('refuses what is not a presentation, and answers a command file through its channel', async () => {
    expect(await runDeckHistoryCommand({ store, service }, { cmd: 'write', artifactId: 'nope', session: SESSION, edit: { op: 'setNotes', slideId: 'a', text: 'x' } })).toMatchObject({ ok: false });
    const deck = await store.create({ kind: 'presentation', title: 'T' }, human);
    const channel = join(dir, 'channel');
    const seam = startDeckHistorySeam({ store, service }, channel, () => {});
    try {
      writeFileSync(join(channel, 'in', '1.json.tmp'), JSON.stringify({ cmd: 'write', artifactId: deck.id, session: SESSION, edit: { op: 'setNotes', slideId: 'cover', text: 'Hi' } }));
      renameSync(join(channel, 'in', '1.json.tmp'), join(channel, 'in', '1.json'));
      const out = join(channel, 'out', '1.json');
      for (let i = 0; i < 100 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 20));
      expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({ ok: true });
    } finally {
      seam.close();
    }
  });

  it('is off unless the host runs under MAWS_E2E=1 with the channel named', () => {
    expect(historySeamDir({ MAWS_PRESENTATIONS_HISTORY: '/tmp/x' })).toBeNull();
    expect(historySeamDir({ MAWS_E2E: '1' })).toBeNull();
    expect(historySeamDir({ MAWS_E2E: '1', MAWS_PRESENTATIONS_HISTORY: '/tmp/x' })).toBe('/tmp/x');
  });
});
