// P3-C M2 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D5): the presentation adapter's portable parts: a
// new deck's cover, the files a read returns, the scoped repair and the turn's summary. Its behaviour on A's real
// document service is src/engine-host/presentations/adapter.test.ts.
import { describe, expect, it } from 'vitest';
import { diffV1, newDoc, onUpdate, transact } from '../yjs';
import * as Y from '../yjs/slides';
import { COVER_ID, coverSlide, createPresentationAdapter, summarizeDeckTurn } from './adapter';
import { DECK_PATH, parseDeckJson, slidePath } from './deck';
import { deckFiles, readFlat } from './model';
import { loadSlide } from './parse';
import { publishDeck } from './publish';
import { serializeSlide } from './serialize';

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
  });
});
