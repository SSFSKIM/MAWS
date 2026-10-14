// P3-C M9 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "For Claude"; Acceptance 6): the Claude-compatible
// deck: no `var()` anywhere, MAWS's overrides gone from the index but applied in the literals, uploaded assets moved under
// `project/ds/maws/`, and this child's own loader reading every slide back with nothing held.
import { describe, expect, it } from 'vitest';
import { newDoc } from '../../yjs';
import { heldSlides } from '../answer';
import { publishDeck } from '../publish';
import { builtinView } from '../../design-system/view';
import { DECK_PATH, parseDeckJson, slidePath } from '../deck';
import { deckTokenValues } from '../mirror';
import { loadSlide } from '../parse';
import { BENCH_SLIDES, CLAUDE_SLIDES, LAYOUT_SLIDES } from '../fixtures/corpus';
import { claudeAssetPath, claudeDeckFiles } from './claude';
import { FIXTURE_FILES, fixtureDoc } from './deck.test-support';
import { exportDeckOf } from './standalone';

const LOGO = new Uint8Array([137, 80, 78, 71]);
const FONT = new Uint8Array([119, 79, 70, 50]);

function exported(files: Record<string, string>) {
  const doc = fixtureDoc(files);
  const deck = exportDeckOf(doc, 'x');
  return claudeDeckFiles(doc, { resolveVar: deckTokenValues(builtinView().tokens, deck.overrides), assets: new Map([['assets/logo.png', LOGO], ['assets/brand.woff2', FONT]]) });
}

describe('the For Claude export', () => {
  it('writes Claude’s files: the index without MAWS’s overrides, tokens as literals, assets under project/ds/maws/', () => {
    const files = exported(FIXTURE_FILES);
    expect(Object.keys(files).sort()).toEqual([DECK_PATH, 'project/ds/maws/brand.woff2', 'project/ds/maws/logo.png', slidePath('body'), slidePath('cover'), slidePath('gone')].sort());
    const index = parseDeckJson(files[DECK_PATH] as string);
    expect(index.ok && index.deck.dsOverrides).toBeUndefined();
    expect(index.ok && index.deck.faces).toEqual({ 'brand-sans': { family: 'Brand Sans', src: 'project/ds/maws/brand.woff2' } });
    expect(files['project/ds/maws/logo.png']).toBe(LOGO);
    expect(claudeAssetPath('assets/a b.png')).toBe('project/ds/maws/a b.png');
    const cover = files[slidePath('cover')] as string;
    expect(cover).toContain('src="project/ds/maws/logo.png"');
    expect(cover).toContain('color:#123456'); // the deck's override, resolved
    for (const text of Object.values(files)) if (typeof text === 'string') expect(text).not.toContain('var(');
  });

  it('reads back with the loader, no slide held and no var(), for the fixture and the corpus', () => {
    // the corpus slides that load (a few of Claude's snippets are templates), renamed into one deck
    const corpus = [...CLAUDE_SLIDES, ...LAYOUT_SLIDES, ...BENCH_SLIDES].filter((s) => loadSlide(s.html).ok);
    expect(corpus.length).toBeGreaterThan(20);
    const corpusDeck = Object.fromEntries([['project/deck.json', JSON.stringify({ v: 4, title: 'Corpus', order: [] })], ...corpus.map((s, i) => [slidePath(`c${i}`), s.html.replace(/^<section id="[^"]*"/m, `<section id="c${i}"`)])]);
    for (const deck of [FIXTURE_FILES, corpusDeck]) {
      const files = exported(deck);
      const slides = Object.entries(files).filter(([path]) => path.startsWith('project/slides/'));
      expect(slides.length).toBe(Object.keys(deck).length - 1);
      for (const [path, text] of slides) {
        const loaded = loadSlide(text as string, { fileId: path.slice('project/slides/'.length, -'.html'.length) });
        expect(loaded.ok, `${path}: ${loaded.ok ? '' : loaded.held.reasons.join('; ')}`).toBe(true);
        expect(text).not.toContain('var(');
      }
    }
  });
});

// fix wave 1 (finding 5): a held slide has no Claude-readable form; the export is refused, naming it and its reasons
describe('the For Claude export of a deck with held slides', () => {
  it('refuses, naming each held slide and its reasons', () => {
    const doc = newDoc();
    publishDeck(doc, {}, { ...FIXTURE_FILES, [slidePath('broken')]: '<section id="broken"><h2 id="b">Broken</h2><blink>x</blink></section>' }, false);
    const held = heldSlides(doc);
    expect(held.map((h) => h.path)).toEqual([slidePath('broken')]);
    let message = '';
    try {
      claudeDeckFiles(doc, { resolveVar: () => undefined, assets: new Map() });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('slide broken is held');
    expect(message).toContain(held[0]!.reasons[0]!);
  });
});
