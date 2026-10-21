// P3-C M2 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D5): the presentation adapter's portable parts: a
// new deck's cover, the files a read returns, the scoped repair and the turn's summary. Its behaviour on A's real
// document service is src/engine-host/presentations/adapter.test.ts.
import { describe, expect, it } from 'vitest';
import { applyV1, diffV1, newDoc, onUpdate, transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { COVER_ID, coverSlide, createPresentationAdapter, summarizeDeckTurn } from './adapter';
import { DECK_PATH, parseDeckJson, slidePath } from './deck';
import { deckFiles, deleteElementTree, deleteSlide, readFlat } from './model';
import { loadSlide } from './parse';
import { publishDeck } from './publish';
import { serializeSlide } from './serialize';
import { addThread, getThread, reply, resolve } from './threads'; // M7

const adapter = createPresentationAdapter({ now: () => new Date(Date.UTC(2026, 9, 14, 9, 30, 15, 250)) });

describe('the presentation adapter', () => {
  it('starts a deck with an index and a cover slide that loads clean, in the system’s roles, already canonical', () => {
    const doc = newDoc();
    adapter.initial!(doc, { title: 'Q3 & beyond' });
    const files = adapter.readFiles!(doc);
    expect(Object.keys(files)).toEqual([DECK_PATH, slidePath(COVER_ID)]);
    const index = parseDeckJson(files[DECK_PATH]!);
    expect(index.ok && index.deck).toMatchObject({ v: 4, createdOnFiles: { v: 1, at: '2026-10-14T09:30:15Z' }, title: 'Q3 & beyond', cover: 'cover', order: ['cover'] });
    const cover = files[slidePath(COVER_ID)]!;
    const loaded = loadSlide(cover, { fileId: COVER_ID });
    expect(loaded.ok && loaded.diagnostics).toEqual([]);
    expect(loaded.ok && serializeSlide(loaded.slide)).toBe(cover);
    expect(coverSlide('Q3 & beyond')).toContain('id="title"');
    expect(cover).toContain('background:var(--ds-color-bg, #ffffff)');
    expect(cover).toContain('font-size:var(--ds-type-title-size, 96px)');
    expect(cover).toContain('>Q3 &amp; beyond</h1>');
    expect(cover).toMatch(/<p id="subtitle" style="[^"]*--ds-type-subtitle-size[^"]*"><\/p>/);
    // a publish of what was read writes nothing
    expect(publishDeck(doc, files, files, false).changed).toEqual([]);
  });

  it('repairs after an update only the slides it touched', () => {
    const doc = newDoc();
    publishDeck(doc, {}, { [slidePath('a')]: '<section id="a"><div id="g"><p id="p">x</p></div></section>', [slidePath('b')]: '<section id="b"><div id="g"><p id="p">x</p></div></section>' }, false);
    transact(doc, () => Y.setElementKey(doc, 'b', 'p', 'parent', 'gone')); // a state left unrepaired
    let update: Uint8Array | null = null;
    const off = onUpdate(doc, (u) => (update = u)); // the one transaction's update, as the host hands it over
    transact(doc, () => Y.setElementKey(doc, 'a', 'p', 'parent', 'missing'));
    off();
    adapter.afterUpdate!(doc, { artifactId: 'x', update: update!, actor: { kind: 'human' } });
    const parent = (slide: string) => readFlat(doc, slide, false).find((e) => e.id === 'p')!.parent;
    expect(parent('a')).toBe('');
    expect(parent('b')).toBe('gone');
    adapter.afterRestore!(doc, { artifactId: 'x', versionId: 1 });
    expect(parent('b')).toBe('');
    expect(deckFiles(doc)[slidePath('b')]).toContain('<p id="p">x</p>');
  });

  it('repairs every slide when the update’s content is not the doc’s (fix wave 1’s probe)', () => {
    const doc = newDoc();
    publishDeck(doc, {}, { [slidePath('s1')]: '<section id="s1"><div id="g"><p id="a">A</p></div></section>' }, false);
    transact(doc, () => Y.setElementKey(doc, 's1', 'a', 'parent', 'gone'));
    const foreign = newDoc();
    publishDeck(foreign, {}, { [slidePath('s1')]: '<section id="s1"></section>' }, false);
    adapter.afterUpdate!(doc, { artifactId: 'x', actor: { kind: 'human' }, update: diffV1(foreign) });
    expect(Y.elementScalars(doc, 's1', 'a').parent).toBe('');
  });

  it('summarizes a turn’s publishes by slide', () => {
    const r = (changed: string[], removed: string[] = [], added: string[] = []) => ({ status: 'published', changed, removed, added, kept: [] });
    expect(
      summarizeDeckTurn([
        r([DECK_PATH, slidePath('a'), slidePath('b')], [], [slidePath('b')]),
        r([slidePath('b'), slidePath('c')]),
        r([DECK_PATH], [slidePath('d')]),
        r([DECK_PATH, slidePath('e')], [], [slidePath('e')]),
        r([DECK_PATH], [slidePath('e')]),
      ]),
    ).toBe('Published 4 slides (2 changed, 1 added, 1 removed)');
    expect(summarizeDeckTurn([r([slidePath('a')])])).toBe('Published 1 slide (1 changed, 0 added, 0 removed)');
    expect(summarizeDeckTurn([r([DECK_PATH])])).toBe('Published the deck’s index');
    // M7: a turn's thread answers (artifact_reply, artifact_resolve) as their lines, after the publishes'
    const line = (text: string) => ({ status: 'replied', threadId: 't1', line: text });
    expect(summarizeDeckTurn([r([slidePath('a')]), line('replied on c:t1'), line('resolved c:t1')])).toBe('Published 1 slide (1 changed, 0 added, 0 removed)\nreplied on c:t1\nresolved c:t1');
    expect(summarizeDeckTurn([line('replied on c:t1')])).toBe('replied on c:t1');
  });

  // M7 (D9): the threads mirror from the hooks; the quote derived while the element lives (Decision Log 31)
  it('mirrors the threads an update touched, and writes nothing to a thread when its element’s text changes', () => {
    const doc = newDoc();
    publishDeck(doc, {}, { [slidePath('a')]: '<section id="a"><p id="p">Old</p><p id="q">Other</p></section>', [slidePath('b')]: '<section id="b"><p id="r">B</p></section>' }, false);
    const human = { kind: 'human' } as const;
    const session = { kind: 'session', appSessionId: 'app-1' } as never;
    const updateOf = (write: () => void): Uint8Array => {
      let update: Uint8Array | null = null;
      const off = onUpdate(doc, (u) => (update = u));
      write();
      off();
      return update!;
    };
    const after = (write: () => void) => adapter.afterUpdate!(doc, { artifactId: 'x', update: updateOf(write), actor: human });

    expect(after(() => addThread(doc, { threadId: 't1', slideId: 'a', elementId: 'p', quote: 'Old', by: session, at: 10 }))).toEqual({
      threads: { upsert: [{ threadId: 't1', status: 'open', quote: 'Old', createdAt: 10, updatedAt: 10, appSessionId: 'app-1' }] },
    });
    addThread(doc, { threadId: 't2', slideId: 'b', elementId: 'r', quote: 'B', by: human, at: 11 });
    // the commented element's text changes: no thread write and no row (no host row per keystroke); readers derive it
    expect(after(() => transact(doc, () => Y.writeText(doc, 'a', 'p', [{ type: 'p', inline: [{ text: 'New', marks: {} }] }])))).toBeUndefined();
    expect(Y.threadScalars(doc, 't1').quote).toBe('Old');
    expect(getThread(doc, 't1')!.quote).toBe('New');
    // an edit elsewhere on the slide mirrors nothing
    expect(after(() => transact(doc, () => Y.writeText(doc, 'a', 'q', [{ type: 'p', inline: [{ text: 'Else', marks: {} }] }])))).toBeUndefined();
    // a reply and a resolve: the row's times
    expect(after(() => reply(doc, 't1', { id: 'm1', by: human, at: 20, body: 'hi' }))).toMatchObject({ threads: { upsert: [{ threadId: 't1', updatedAt: 20 }] } });
    expect(after(() => resolve(doc, 't1', human, 30))).toMatchObject({ threads: { upsert: [{ threadId: 't1', status: 'resolved', resolvedAt: 30, updatedAt: 30 }] } });
    // a thread withdrawn: its row removed
    expect(after(() => transact(doc, () => Y.deleteThread(doc, 't2')))).toEqual({ threads: { remove: ['t2'] } });
    // a restore's pass: every thread's row
    expect(adapter.afterRestore!(doc, { artifactId: 'x', versionId: 1 })).toMatchObject({ threads: { upsert: [{ threadId: 't1' }] } });
  });

  // Decision Log 31's ruling: a thread's stored quote is written when its element is deleted, from the text it had just
  // before, on every route a deletion takes: a replica's frame (`beforeApply`'s forwarding edit), the agent's publish
  // (the adapter's `publish`) and a restore (`revertScope` reads it, `afterRestore` writes it)
  describe('the quote stored at an element’s deletion', () => {
    const human = { kind: 'human' } as const;
    const SLIDE = '<section id="a"><p id="p">Old</p><p id="q">Other</p></section>';
    function commented(): Doc {
      const doc = newDoc();
      publishDeck(doc, {}, { [slidePath('a')]: SLIDE }, false);
      addThread(doc, { threadId: 't1', slideId: 'a', elementId: 'p', quote: 'Old', by: human, at: 10 });
      transact(doc, () => Y.writeText(doc, 'a', 'p', [{ type: 'p', inline: [{ text: 'Last words', marks: {} }] }]));
      return doc;
    }
    /** A replica of `live` that makes `edit`: the update it sends. */
    function frameOf(live: Doc, edit: (replica: Doc) => void): Uint8Array {
      const replica = newDoc();
      applyV1(replica, diffV1(live));
      let update: Uint8Array | null = null;
      const off = onUpdate(replica, (u) => (update = u));
      edit(replica);
      off();
      replica.destroy();
      return update!;
    }
    const stored = (doc: Doc) => Y.threadScalars(doc, 't1').quote;

    it('from a replica’s frame: the forwarding edit stores the pre-delete text; a frame that deletes nothing has none', () => {
      const live = commented();
      expect(adapter.beforeApply!(live, frameOf(live, (r) => reply(r, 't1', { id: 'm1', by: human, at: 20, body: 'hi' })), { artifactId: 'x', actor: human, step2: false })).toBeNull();
      const restyle = frameOf(live, (r) => transact(r, () => Y.writeText(r, 'a', 'q', [{ type: 'p', inline: [{ text: 'Else', marks: {} }] }])));
      const kept = adapter.beforeApply!(live, restyle, { artifactId: 'x', actor: human, step2: false });
      applyV1(live, restyle);
      kept?.(live);
      expect(stored(live)).toBe('Old'); // the element lives: nothing stored
      const deletion = frameOf(live, (r) => deleteElementTree(r, 'a', 'p'));
      const forward = adapter.beforeApply!(live, deletion, { artifactId: 'x', actor: human, step2: false });
      expect(forward).toBeTypeOf('function');
      applyV1(live, deletion);
      forward!(live);
      expect(stored(live)).toBe('Last words');
      expect(getThread(live, 't1')!.quote).toBe('Last words');
    });

    it('from the agent’s publish that removes the element, or its slide', () => {
      const live = commented();
      const files = deckFiles(live);
      adapter.publish!(live, files, { [slidePath('a')]: '<section id="a"><p id="q">Other</p></section>' }, false);
      expect(stored(live)).toBe('Last words');
      const other = commented();
      adapter.publish!(other, deckFiles(other), { [slidePath('a')]: null }, false);
      expect(stored(other)).toBe('Last words');
    });

    it('from a restore that takes the element away', () => {
      const live = commented();
      const old = newDoc();
      expect(adapter.revertScope!(live, old, { artifactId: 'x' })).toBeTruthy();
      deleteSlide(live, 'a'); // what the restore's write does to the live deck
      adapter.afterRestore!(live, { artifactId: 'x', versionId: 1 });
      expect(stored(live)).toBe('Last words');
      old.destroy();
    });
  });
});

// P4-B2 D19: a restore to a state before the host's fetch keeps the face drawing offline, so the host never refetches it.
describe('a restore carries the host’s Google Fonts record', () => {
  const LORA = 'https://fonts.googleapis.com/css2?family=Lora';
  const record = { request: LORA, licence: 'OFL', licenceSrc: 'assets/gf-lora-OFL.txt', files: [{ src: 'assets/gf-lora-400.woff2', weight: '400', style: 'normal' }] };
  const setFace = (doc: Doc, key: string, face: unknown) => transact(doc, () => Y.setDeckEntry(doc, 'faces', key, face as Y.Json));
  it('sets the live record on each restored face it still answers, and on no other', () => {
    const live = newDoc();
    adapter.initial!(live, { title: 'T' });
    setFace(live, 'lora', { family: 'Lora', href: LORA, google: record });
    setFace(live, 'slab', { family: 'Roboto Slab', href: 'https://fonts.googleapis.com/css2?family=Roboto+Slab', google: { request: 'https://fonts.googleapis.com/css2?family=Roboto+Slab', refused: 'Apache-2.0' } });
    expect(adapter.revertScope!(live, newDoc(), { artifactId: 'r' })).toBeTruthy();
    // what the restore's write leaves: the faces as they stood before the fetch, one of them under another link since
    setFace(live, 'lora', { family: 'Lora', href: `${LORA}&display=swap` });
    setFace(live, 'slab', { family: 'Roboto Slab', href: 'https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@700' });
    adapter.afterRestore!(live, { artifactId: 'r', versionId: 1 });
    expect(Y.deckEntries(live, 'faces')).toEqual({ lora: { family: 'Lora', href: `${LORA}&display=swap`, google: record }, slab: { family: 'Roboto Slab', href: 'https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@700' } });
  });
});
