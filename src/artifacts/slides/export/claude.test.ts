// P3-C M9 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "For Claude"; Acceptance 6): the Claude-compatible
// deck: no `var()` anywhere, MAWS's overrides gone from the index but applied in the literals, uploaded assets moved under
// `project/ds/maws/`, and this child's own loader reading every slide back with nothing held.
import { describe, expect, it } from 'vitest';
import { newDoc, transact } from '../../yjs';
import * as Y from '../../yjs/slides';
import { heldSlides } from '../answer';
import { publishDeck } from '../publish';
import { builtinView } from '../../design-system/view';
import { DECK_PATH, parseDeckJson, slidePath } from '../deck';
import { deckTokenValues } from '../mirror';
import { loadSlide } from '../parse';
import { BENCH_SLIDES, CLAUDE_SLIDES, LAYOUT_SLIDES } from '../fixtures/corpus';
import { claudeAssetPath, claudeDeckFiles } from './claude';
import { FIXTURE_FILES, fixtureDoc, measuredAt } from './deck.test-support';
import { LORA_FILES, LORA_HREF, LORA_LICENCE, loraFace, robotoSlabFace, TODAYS_FACES } from './faces.test-support';
import { MeasureNeeded } from './lower';
import { exportDeckOf } from './standalone';
import { apply, cornersOf, multiply, placement, shift, type Box } from '../geometry';
import type { ElementIR } from '../ir';

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

// fix wave 1 (finding 4): Claude flattens a pinned div inside a host (its format.md: "its positioned children re-pin to
// the host (exact for left/top)… it stays only if painted or holding flow content"), losing the div's own transform.
// The export lowers MAWS's groups itself: each member's pose in the slide baked into its own left, top and transform.
describe('the For Claude export of groups', () => {
  const GROUP = (paint: string) => `<section id="g1" style="background:#ffffff">
<div id="grp" data-group="" style="position:absolute; left:600px; top:300px; width:400px; height:200px; transform:rotate(30deg) scale(1.2); color:#ff0000; opacity:0.5${paint}">
<p id="a" style="position:absolute; left:0px; top:0px; width:200px; height:60px; font-size:32px">A</p>
<x-shape id="b" kind="ellipse" style="position:absolute; left:200px; top:100px; width:200px; height:100px; background:#00ff00; transform:rotate(10deg)"></x-shape>
<x-connector id="c" x1="0" y1="200" x2="400" y2="0"></x-connector>
</div>
<p id="after" style="font-size:32px">Flow</p>
</section>`;
  const filesOf = (paint: string) => ({ 'project/deck.json': JSON.stringify({ v: 4, title: 'Groups', order: ['g1'] }), [slidePath('g1')]: GROUP(paint) });
  const G = placement({ x: 600, y: 300, w: 400, h: 200 }, 'rotate(30deg) scale(1.2)');
  const worldCorners = (box: Box, transform: string | undefined) => cornersOf(multiply(G, placement(box, transform)), box.w, box.h);
  const near = (a: { x: number; y: number }[], b: { x: number; y: number }[]) => a.every((p, i) => Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y) < 0.6);

  function lowered(paint: string) {
    const files = claudeDeckFiles(fixtureDoc(filesOf(paint)), { resolveVar: () => undefined, assets: new Map() });
    const loaded = loadSlide(files[slidePath('g1')] as string, { fileId: 'g1' });
    if (!loaded.ok) throw new Error(loaded.held.reasons.join('; '));
    return loaded.slide;
  }
  const own = (el: ElementIR): Box => ({ x: parseFloat(el.style.left!), y: parseFloat(el.style.top!), w: parseFloat(el.style.width!), h: parseFloat(el.style.height!) });

  it('re-pins an unpainted group’s members to the host, each keeping its pose in the slide, the group gone', () => {
    const slide = lowered('');
    expect(slide.children.map((c) => c.id)).toEqual(['a', 'b', 'c', 'after']);
    const [a, b, c] = slide.children as [ElementIR, ElementIR, ElementIR];
    expect(near(cornersOf(placement(own(a), a.style.transform), own(a).w, own(a).h), worldCorners({ x: 0, y: 0, w: 200, h: 60 }, undefined))).toBe(true);
    expect(near(cornersOf(placement(own(b), b.style.transform), own(b).w, own(b).h), worldCorners({ x: 200, y: 100, w: 200, h: 100 }, 'rotate(10deg)'))).toBe(true);
    expect([b.style.transform, own(b).w, own(b).h]).toEqual(['rotate(40deg)', 240, 120]); // an x-shape takes rotate only: its scale goes into its size
    const ends = [apply(G, { x: 0, y: 200 }), apply(G, { x: 400, y: 0 })];
    expect(near([{ x: +c.attrs.x1!, y: +c.attrs.y1! }, { x: +c.attrs.x2!, y: +c.attrs.y2! }], ends)).toBe(true);
    // what the group gave its members by inheritance and opacity, they carry themselves
    expect(a.style.color).toBe('#ff0000');
    expect(a.style.opacity).toBe('0.5');
  });

  it('keeps a painted group in place, painted, its members lifted out over it', () => {
    const slide = lowered('; background:#eeeeee');
    expect(slide.children.map((c) => c.id)).toEqual(['grp', 'a', 'b', 'c', 'after']);
    expect(slide.children[0]!.children).toEqual([]);
    expect(slide.children[0]!.style).toMatchObject({ background: '#eeeeee', transform: 'rotate(30deg) scale(1.2)' });
  });
});

// fix wave 2 (finding 2), through the loader (its transform names are its own lower case): a translation-only group keeps
// its translation; a turned group's auto-sized and right-pinned members take their place from the window's measure, the
// export asking for it when the model cannot say
describe('the For Claude export of groups the model cannot place alone', () => {
  const deckOf = (slide: string) => ({ 'project/deck.json': JSON.stringify({ v: 4, title: 'Groups', order: ['g2'] }), [slidePath('g2')]: slide });
  const loaded = (files: Record<string, string | Uint8Array>) => {
    const out = loadSlide(files[slidePath('g2')] as string, { fileId: 'g2' });
    if (!out.ok) throw new Error(out.held.reasons.join('; '));
    return out.slide;
  };

  it('keeps a translation-only group’s translation', () => {
    const doc = fixtureDoc(deckOf('<section id="g2" style="background:#ffffff"><div id="moved" data-group="" style="position:absolute; left:100px; top:50px; transform:translate(30px, 40px)"><p id="m" style="position:absolute; left:10px; top:20px; font-size:32px">M</p></div></section>'));
    const slide = loaded(claudeDeckFiles(doc, { resolveVar: () => undefined, assets: new Map() }));
    expect(slide.children.map((c) => c.id)).toEqual(['m']);
    expect(slide.children[0]!.style).toMatchObject({ left: '140px', top: '110px' });
  });

  it('asks for the measure for auto-sized and right-pinned members of a turned group, then keeps their poses', () => {
    const doc = fixtureDoc(
      deckOf(`<section id="g2" style="background:#ffffff"><div id="turned" data-group="" style="position:absolute; left:600px; top:300px; width:400px; height:200px; transform:rotate(30deg)">
<p id="auto" style="position:absolute; left:20px; top:10px; font-size:32px">Auto</p>
<div id="pinned" style="position:absolute; right:20px; bottom:30px; width:100px; height:50px; background:#ff0000"></div>
</div></section>`),
    );
    expect(() => claudeDeckFiles(doc, { resolveVar: () => undefined, assets: new Map() })).toThrow(MeasureNeeded);
    const G = placement({ x: 600, y: 300, w: 400, h: 200 }, 'rotate(30deg)');
    const W = { auto: multiply(G, shift(20, 10)), pinned: multiply(G, shift(280, 120)) };
    const measured = { slides: [{ id: 'g2', background: { fill: null, image: false }, elements: [measuredAt('turned', 'div', G, 400, 200), measuredAt('auto', 'p', W.auto, 90, 45), measuredAt('pinned', 'div', W.pinned, 100, 50)] }] };
    const slide = loaded(claudeDeckFiles(doc, { resolveVar: () => undefined, assets: new Map(), measured }));
    expect(slide.children.map((c) => c.id)).toEqual(['auto', 'pinned']);
    const box = (k: ElementIR): Box => ({ x: parseFloat(k.style.left!), y: parseFloat(k.style.top!), w: parseFloat(k.style.width!), h: parseFloat(k.style.height!) });
    const [auto, pinned] = slide.children as [ElementIR, ElementIR];
    expect(near(cornersOf(placement(box(auto), auto.style.transform), 90, 45), cornersOf(W.auto, 90, 45))).toBe(true);
    expect(near(cornersOf(placement(box(pinned), pinned.style.transform), 100, 50), cornersOf(W.pinned, 100, 50))).toBe(true);
    expect(pinned.style.right).toBeUndefined();
  });
});

const near = (a: { x: number; y: number }[], b: { x: number; y: number }[]) => a.every((p, i) => Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y) < 0.6);

// The final review's A7 and A13: each a regression of a code-traced finding.
describe('the For Claude export: the final review', () => {
  it('A7: refuses a slide whose lowered groups the loader would hold, naming the slide and the reason', () => {
    const members = (g: number) => Array.from({ length: 13 }, (_, k) => `<p id="g${g}m${k}" style="position:absolute; left:${k}px; top:0px">${k}</p>`).join('');
    const group = (g: number) => `<div id="g${g}" data-group="" style="position:absolute; left:${g * 100}px; top:0px">${members(g)}</div>`;
    const files = { ...FIXTURE_FILES, 'project/slides/body.html': `<section id="body">${group(1)}${group(2)}</section>` };
    expect(() => exported(files)).toThrow(/cannot be exported for Claude: slide body .*26 pinned children/);
  });

  it('A13: moves a CSS background’s asset with the pictures, on an element and on the section', () => {
    const files = exported({
      ...FIXTURE_FILES,
      'project/slides/cover.html': '<section id="cover" style="background:url(assets/logo.png) center / cover"><h1 id="t" style="background:url(assets/logo.png); background-clip:text; -webkit-text-fill-color:transparent">Gold</h1></section>',
    });
    const cover = files[slidePath('cover')] as string;
    expect(cover).not.toContain('url(assets/');
    expect(cover.match(/url\(project\/ds\/maws\/logo\.png\)/g)).toHaveLength(2);
    expect(files['project/ds/maws/logo.png']).toBe(LOGO);
    expect(loadSlide(cover, { fileId: 'cover' }).ok).toBe(true);
  });
});

// P4-B2 D19 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md): the host's record of a Google Fonts face is
// MAWS's; Claude's format names the face by its link and fetches it itself, so the zip writes the face without it.
describe('the For Claude export of Google Fonts faces (D19)', () => {
  const assets = new Map<string, Uint8Array>([['assets/logo.png', LOGO], ['assets/brand.woff2', FONT], ...LORA_FILES.map((file): [string, Uint8Array] => [file.src, FONT]), [LORA_LICENCE, new Uint8Array([1])]]);
  const zip = (doc: ReturnType<typeof fixtureDoc>) => claudeDeckFiles(doc, { resolveVar: deckTokenValues(builtinView().tokens, exportDeckOf(doc, 'x').overrides), assets });

  it('writes a fetched or refused face as its family and link alone, and none of the files MAWS saved for it', () => {
    const doc = fixtureDoc();
    transact(doc, () => {
      Y.setDeckEntry(doc, 'faces', 'lora', loraFace() as Y.Json);
      Y.setDeckEntry(doc, 'faces', 'roboto-slab', robotoSlabFace() as Y.Json);
    });
    const files = zip(doc);
    expect(files[DECK_PATH]).not.toContain('"google"');
    const index = parseDeckJson(files[DECK_PATH] as string);
    expect(index.ok && index.diagnostics).toEqual([]);
    expect(index.ok && index.deck.faces).toEqual({
      'brand-sans': { family: 'Brand Sans', src: 'project/ds/maws/brand.woff2' },
      lora: { family: 'Lora', href: LORA_HREF },
      'roboto-slab': { family: 'Roboto Slab', href: 'https://fonts.googleapis.com/css2?family=Roboto+Slab' },
    });
    expect(Object.keys(files).filter((path) => path.includes('gf-lora'))).toEqual([]);
  });

  // the architect's condition: a deck whose faces are today's shape exports exactly as before (pinned from the pre-D19 code)
  it('writes today’s faces byte for byte as before', () => {
    const files = zip(fixtureDoc({ ...FIXTURE_FILES, [DECK_PATH]: JSON.stringify({ ...JSON.parse(FIXTURE_FILES[DECK_PATH]!), faces: TODAYS_FACES }) }));
    expect(Object.keys(files).sort()).toEqual([DECK_PATH, 'project/ds/maws/brand.woff2', 'project/ds/maws/logo.png', slidePath('body'), slidePath('cover'), slidePath('gone')]);
    expect(files[DECK_PATH]).toBe(
      '{\n  "v": 4,\n  "title": "Quarterly",\n  "cover": "cover",\n  "order": [\n    "cover",\n    "body",\n    "gone"\n  ],\n  "faces": {\n    "blob": {\n      "family": "Blob",\n      "src": "/_blob/abc"\n    },\n    "brand-sans": {\n      "family": "Brand Sans",\n      "src": "project/ds/maws/brand.woff2"\n    },\n    "source-serif-4": {\n      "family": "Source Serif 4",\n      "href": "https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@300..700&display=swap"\n    }\n  }\n}\n',
    );
  });
});
