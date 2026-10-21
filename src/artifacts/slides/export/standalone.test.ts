// P3-C M9 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "Standalone HTML", "PDF"): the deck's own page.
import { describe, expect, it } from 'vitest';
import { builtinView } from '../../design-system/view';
import { transact } from '../../yjs';
import * as Y from '../../yjs/slides';
import { DECK_PATH, type DeckFace } from '../deck';
import { deckTokenValues } from '../mirror';
import { FIXTURE_FILES, fixtureDoc, MEASURED } from './deck.test-support';
import { LORA_FILES, loraFace, robotoSlabFace, TODAYS_FACES } from './faces.test-support';
import { cropOf, cropViewBox, deckAssetRefs, deckFacesCss, deckPage, exportDeckOf, type PageOptions } from './standalone';

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';
const FONT = 'data:font/woff2;base64,d09GMg==';
const asset = (ref: string) => (ref === 'assets/logo.png' ? LOGO : ref === 'assets/brand.woff2' ? FONT : null);

function page(mode: PageOptions['mode'], extra: Partial<PageOptions> = {}): string {
  const deck = exportDeckOf(fixtureDoc(), 'Untitled');
  return deckPage(deck, { mode, resolveVar: deckTokenValues(builtinView().tokens, deck.overrides), asset, facesCss: deckFacesCss(deck, asset), ...extra });
}

describe('the deck’s standalone page', () => {
  it('reads the deck in order with its title, cover, transitions, hidden slide, notes, faces and overrides', () => {
    const deck = exportDeckOf(fixtureDoc(), 'Untitled');
    expect(deck.title).toBe('Quarterly');
    expect(deck.cover).toBe('cover');
    expect(deck.slides.map((s) => [s.id, s.transition, s.hidden])).toEqual([
      ['cover', 'fade', false],
      ['body', 'push', false],
      ['gone', null, true],
    ]);
    expect(deck.slides[0]!.notes).toBe('Open with the numbers.');
    expect(deck.overrides).toEqual({ '--ds-color-accent': '#123456' });
    expect(deckAssetRefs(deck)).toEqual(['assets/brand.woff2', 'assets/logo.png']);
  });

  it('writes tokens as literals (the deck’s override first), assets and faces inlined, and loads nothing from anywhere', () => {
    const html = page('html');
    expect(html).not.toContain('var(--ds-');
    expect(html).toContain('color:#123456'); // the override, over the system's accent
    expect(html).toContain(`src="${LOGO}"`);
    expect(html).toContain(`@font-face { font-family: "Brand Sans"; src: url("${FONT}"); }`);
    expect(html).toContain(`content="default-src 'none'; img-src data:; font-src data:;`);
    expect(html).not.toMatch(/src="https?:|url\(["']?https?:/); // a link is text, never loaded
  });

  it('views the visible slides with a keyboard viewer; prints them one 1920×1080 page each', () => {
    const html = page('html');
    expect(html.match(/<section /g)).toHaveLength(2);
    expect(html).not.toContain('data-slide="gone"');
    expect(html).toContain("k === 'f' || k === 'F'");
    const print = page('print');
    expect(print).toContain('@page { size: 1920px 1080px; margin: 0; }');
    expect(print.match(/<section /g)).toHaveLength(2);
    expect(print).not.toContain('<script>');
  });

  it('measures every slide, hidden ones too, its sized text marked for the fit', () => {
    const measure = page('measure');
    expect(measure.match(/<section /g)).toHaveLength(3);
    expect(measure).toContain('data-slide="gone" data-hidden=""');
    expect(measure).toMatch(/<p data-eid="sub" data-fit-box="shrink"/);
  });

  it('draws as the canvas does: the dialect’s elements, the under-layer, embeds in a sandbox with no network', () => {
    const html = page('measure');
    // a pinned child before the first flow child paints under the flow layer, as on the canvas
    expect(html).toContain('<x-icon data-eid="star" data-layer="under" name="Star"');
    expect(html).toMatch(/<x-icon[^>]*><svg viewBox="0 0 24 24"[^>]*><path d="M /);
    expect(html).toMatch(/<x-embed data-eid="live"[^>]*><iframe sandbox="allow-scripts" tabindex="-1" srcdoc="[^"]*default-src &#39;none&#39;|<x-embed data-eid="live"[^>]*><iframe sandbox="allow-scripts" tabindex="-1" srcdoc="[^"]*default-src 'none'/);
    expect(html).toContain('<svg data-eid="chart" data-layer="under" aria-label="A dot" data-svg-scope="esvg1" viewBox="0 0 100 100"');
    expect(html).toContain('<x-embed data-eid="live" style=');
    const under = exportDeckOf(fixtureDoc({ ...FIXTURE_FILES, 'project/slides/body.html': '<section id="body"><div id="back" style="position:absolute; left:0; top:0; width:100px; height:100px; background:#ff0000"></div><p id="t">Over</p></section>' }), 'x');
    const drawn = deckPage(under, { mode: 'html', resolveVar: () => undefined, asset, facesCss: '' });
    expect(drawn).toContain('<div data-eid="back" data-layer="under"');
  });

  it('draws what depends on layout from the measure: outlines, connectors, fitted text', () => {
    const html = page('html', { measured: MEASURED });
    expect(html).toMatch(/<x-shape data-eid="badge" data-layer="under" kind="ellipse"[^>]*><svg data-glyph="" [^>]*width="200" height="100"[^>]*><path d="M 2 50 A 98 48/);
    expect(html).toMatch(/<x-connector data-eid="link"[^>]*><svg data-glyph=""[^>]*><polyline points="300,150 600,150"/);
    expect(html).toMatch(/<p data-eid="sub" style="[^"]*font-size:36px/);
    expect(html).not.toContain('data-fit-box');
  });

  it('crops a picture by the owner’s zoom and position through a view box', () => {
    expect(cropOf('2 25% 50%')).toEqual({ zoom: 2, x: 0.25, y: 0.5 });
    expect(cropOf('nonsense')).toBeNull();
    expect(cropViewBox({ w: 400, h: 200 }, { zoom: 2, x: 0.25, y: 0.5 })).toEqual({ x: 50, y: 50, w: 200, h: 100 });
    const files = { ...FIXTURE_FILES, 'project/slides/cover.html': '<section id="cover"><img id="logo" src="assets/logo.png" data-crop="2 25% 50%" style="width:200px; height:100px"></section>' };
    const deck = exportDeckOf(fixtureDoc(files), 'x');
    const measured = { slides: [{ id: 'cover', background: { fill: null, image: false }, elements: [{ ...MEASURED.slides[0]!.elements[2]! }] }] };
    const html = deckPage(deck, { mode: 'html', resolveVar: () => undefined, asset, facesCss: '', measured });
    // the canvas's region (M5's applyCrop): half the picture each way, the focus at 25% 50%; the element's fit untouched
    expect(html).toContain('width:200px; height:100px; object-view-box:inset(25% 37.5% 25% 12.5%); object-position:25% 50%'); // the canvas's crop (render-rules.ts), view box and focus
    expect(html).not.toContain('object-fit:cover');
  });
});

// The final review's A4 and A13: each a regression of a code-traced finding.
describe('the deck’s standalone page: the final review', () => {
  it('A4: draws a shape’s outline and a connector at their layout size inside a scaled group, not at the drawn size again', () => {
    const files = {
      ...FIXTURE_FILES,
      'project/slides/body.html':
        '<section id="body"><div id="g" data-group="" style="position:absolute; left:100px; top:100px; width:200px; height:100px; transform:scale(2)">' +
        '<x-shape id="dot" kind="ellipse" style="position:absolute; left:0px; top:0px; width:100px; height:100px; background:#2b7a78"></x-shape>' +
        '<x-connector id="wire" x1="0%" y1="50%" x2="100%" y2="50%"></x-connector></div></section>',
    };
    const deck = exportDeckOf(fixtureDoc(files), 'x');
    const measured = {
      slides: [
        {
          id: 'body',
          background: { fill: null, image: false },
          elements: [
            { ...MEASURED.slides[1]!.elements[0]!, id: 'dot', box: { x: 0, y: 50, w: 200, h: 200 }, scale: [2, 2] as [number, number], linear: [2, 0, 0, 2] as [number, number, number, number] },
            { ...MEASURED.slides[1]!.elements[1]!, id: 'wire', box: { x: 0, y: 50, w: 400, h: 200 }, scale: [2, 2] as [number, number], linear: [2, 0, 0, 2] as [number, number, number, number], attrs: { x1: '0%', y1: '50%', x2: '100%', y2: '50%' } },
          ],
        },
      ],
    };
    const html = deckPage(deck, { mode: 'html', resolveVar: () => undefined, asset, facesCss: '', measured, only: ['body'] });
    expect(html).toMatch(/<x-shape data-eid="dot"[^>]*><svg data-glyph="" [^>]*width="100" height="100" viewBox="0 0 100 100">/);
    expect(html).toMatch(/<x-connector data-eid="wire"[^>]*><svg data-glyph="" [^>]*width="200" height="100"[^>]*><polyline points="0,50 200,50"/);
  });

  it('A13: inlines a CSS background’s asset, on an element and on the section, and lists it among the deck’s assets', () => {
    const files = {
      ...FIXTURE_FILES,
      'project/slides/body.html':
        '<section id="body" style="background:url(assets/logo.png) center / cover"><h1 id="t" style="background:url(assets/logo.png); background-clip:text; -webkit-text-fill-color:transparent">Gold</h1></section>',
    };
    const deck = exportDeckOf(fixtureDoc(files), 'x');
    expect(deckAssetRefs(deck)).toContain('assets/logo.png');
    expect(deckAssetRefs(exportDeckOf(fixtureDoc({ ...files, 'project/slides/cover.html': '<section id="cover"></section>' }), 'x'))).toContain('assets/logo.png');
    const html = deckPage(deck, { mode: 'html', resolveVar: () => undefined, asset, facesCss: '', only: ['body'] });
    expect(html).not.toMatch(/url\(["']?assets\//);
    expect(html).toContain(`<section class="maws-slide" data-slide="body" style="background:url(&quot;${LOGO}&quot;) center / cover"`);
    expect(html).toContain(`<h1 data-eid="t" style="background:url(&quot;${LOGO}&quot;); background-clip:text`);
  });

  // A16 (fixer B's B1 carried to the export page; Decision Log 37 (3)): every svg drawing on the page is contained as the
  // canvas contains it (canvas/svg-scope.ts): its stylesheets (an HTML <style> under <desc> or <title> too) match only
  // its own elements, and its ids and their references are its own. At text level: no DOM here applies an svg's sheet.
  it('A16: contains each svg drawing: its stylesheets its own, its ids renamed per drawing with their references', () => {
    const drawing = (slide: string) =>
      `<section id="${slide}"><svg id="art" viewBox="0 0 100 100" style="position:absolute; left:0px; top:0px; width:100px; height:100px">` +
      '<style>body{display:none!important} .bar{fill:url(#grad)}</style>' +
      '<desc><style>body{display:none!important}</style></desc>' +
      '<linearGradient id="grad"><stop offset="0" stop-color="#ff0000"></stop></linearGradient>' +
      '<rect id="r" class="bar" width="10" height="10"></rect><use href="#r" x="20"></use></svg></section>';
    const files = { ...FIXTURE_FILES, 'project/slides/cover.html': drawing('cover'), 'project/slides/body.html': drawing('body') };
    const html = deckPage(exportDeckOf(fixtureDoc(files), 'x'), { mode: 'html', resolveVar: () => undefined, asset, facesCss: '' });
    const svgs = [...html.matchAll(/<svg data-eid="art"[\s\S]*?<\/svg>/g)].map((m) => m[0]);
    expect(svgs).toHaveLength(2);
    const scopes = svgs.map((svg) => /data-svg-scope="([^"]+)"/.exec(svg)?.[1]);
    expect(scopes[0]).toBeTruthy();
    expect(scopes[1]).toBeTruthy();
    expect(scopes[0]).not.toBe(scopes[1]);
    svgs.forEach((svg, k) => {
      const scope = scopes[k]!;
      const sheets = [...svg.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]!);
      expect(sheets).toHaveLength(2); // the svg's own, and the HTML one under <desc>
      for (const sheet of sheets) {
        expect(sheet).not.toMatch(/(^|[}\s])body\s*\{/); // never the page's body
        expect(sheet).toContain(`body:where([data-svg-scope="${scope}"],[data-svg-scope="${scope}"] *)`);
      }
      expect(svg).toContain(`id="${scope}_grad"`);
      expect(svg).toContain(`id="${scope}_r"`);
      expect(svg).toContain(`href="#${scope}_r"`);
      expect(sheets[0]).toContain(`#${scope}_grad`);
    });
  });

  // the re-review: ids may hold hyphens, so slide `a-b` with svg `c` and slide `a` with svg `b-c` must not share a scope
  it('A16: names each drawing’s scope unambiguously, the same in every pass', () => {
    const drawing = (slide: string, id: string) =>
      `<section id="${slide}"><svg id="${id}" viewBox="0 0 10 10" style="position:absolute; left:0px; top:0px; width:10px; height:10px"><rect id="g" width="1" height="1"></rect><use href="#g"></use></svg></section>`;
    const files = { 'project/deck.json': JSON.stringify({ v: 4, order: ['a-b', 'a'] }), 'project/slides/a-b.html': drawing('a-b', 'c'), 'project/slides/a.html': drawing('a', 'b-c') };
    const deck = exportDeckOf(fixtureDoc(files), 'x');
    const scopesOf = (mode: PageOptions['mode']) => [...deckPage(deck, { mode, resolveVar: () => undefined, asset, facesCss: '' }).matchAll(/data-svg-scope="([^"]+)"/g)].map((m) => m[1]);
    const scopes = scopesOf('html');
    expect(scopes).toHaveLength(2);
    expect(scopes[0]).not.toBe(scopes[1]);
    expect(scopesOf('measure')).toEqual(scopes);
    expect(scopesOf('print')).toEqual(scopes);
  });

  // the follow-up review: the renamed ids too (element `art` with `a_b`, element `art_a` with `b`), and the scope the same
  // in a pass that writes a hidden slide (measure) and one that does not (html, print)
  it('A16: renames every drawing’s ids unambiguously, the same in every pass, hidden slides or not', () => {
    const svg = (id: string, grad: string, left: number) =>
      `<svg id="${id}" viewBox="0 0 10 10" style="position:absolute; left:${left}px; top:0px; width:10px; height:10px"><linearGradient id="${grad}"><stop offset="0" stop-color="#ff0000"></stop></linearGradient><rect width="1" height="1" fill="url(#${grad})"></rect></svg>`;
    const files = {
      'project/deck.json': JSON.stringify({ v: 4, order: ['h', 's'] }),
      'project/slides/h.html': `<section id="h" hidden>${svg('art', 'g', 0)}</section>`,
      'project/slides/s.html': `<section id="s">${svg('art', 'a_b', 0)}${svg('art_a', 'b', 20)}</section>`,
    };
    const deck = exportDeckOf(fixtureDoc(files), 'x');
    const page = (mode: PageOptions['mode']) => deckPage(deck, { mode, resolveVar: () => undefined, asset, facesCss: '' });
    const gradients = (html: string) => [...html.matchAll(/<lineargradient id="([^"]+)"|<linearGradient id="([^"]+)"/g)].map((m) => m[1] ?? m[2]);
    const shown = gradients(page('html'));
    expect(shown).toHaveLength(2);
    expect(shown[0]).not.toBe(shown[1]);
    expect(gradients(page('print'))).toEqual(shown);
    const measured = gradients(page('measure'));
    expect(measured).toHaveLength(3);
    expect(measured.slice(1)).toEqual(shown); // the hidden slide's drawing shifts nothing
  });
});

// P4-B2 D19 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md): a Google Fonts face the engine host fetched
// travels as its saved files, each inlined in a block of its own with its weight and style, so the HTML, PDF and PPTX
// exports draw it offline; a refused face, and one with no record yet, draw as their fallbacks. Today's faces export
// exactly as the pre-D19 code wrote them.
describe('the deck’s standalone page: Google Fonts faces saved in the deck (D19)', () => {
  const withFaces = (faces: Record<string, DeckFace>) => {
    const doc = fixtureDoc();
    transact(doc, () => {
      for (const [key, face] of Object.entries(faces)) Y.setDeckEntry(doc, 'faces', key, face as Y.Json);
    });
    return exportDeckOf(doc, 'x');
  };
  const fonts = (ref: string) => (ref.startsWith('assets/gf-lora-') ? `data:font/woff2;base64,${btoa(ref)}` : asset(ref));
  const LORA_BLOCKS = LORA_FILES.map((file) => `@font-face { font-family: "Lora"; src: url("${fonts(file.src)}"); font-weight: ${file.weight}; font-style: ${file.style}; }`);

  it('lists every saved file among the deck’s assets, not its licence; a refused or pending face lists none', () => {
    const deck = withFaces({ lora: loraFace(), 'roboto-slab': robotoSlabFace(), 'source-serif-4': TODAYS_FACES['source-serif-4']! });
    expect(deckAssetRefs(deck)).toEqual(['assets/brand.woff2', ...LORA_FILES.map((file) => file.src), 'assets/logo.png'].sort());
  });

  it('writes one block per saved file with its weight and style, its file inlined; a file the export lacks is left out', () => {
    const deck = withFaces({ lora: loraFace(), 'roboto-slab': robotoSlabFace() });
    const css = deckFacesCss(deck, fonts);
    expect(css.split('\n').sort()).toEqual([`@font-face { font-family: "Brand Sans"; src: url("${FONT}"); }`, ...LORA_BLOCKS].sort());
    const lacking = deckFacesCss(deck, (ref) => (ref.endsWith('-italic.woff2') ? null : fonts(ref)));
    expect(lacking.split('\n').filter((line) => line.includes('"Lora"'))).toEqual(LORA_BLOCKS.filter((line) => !line.includes('italic')));
    // the page still loads nothing from anywhere: the faces are `data:` under the same policy
    const html = deckPage(deck, { mode: 'html', resolveVar: () => undefined, asset: fonts, facesCss: css });
    for (const line of LORA_BLOCKS) expect(html).toContain(line);
    expect(html).toContain(`content="default-src 'none'; img-src data:; font-src data:;`);
    expect(html).not.toContain('fonts.googleapis.com');
  });

  // the architect's condition: a deck whose faces are today's shape exports exactly as before
  it('exports today’s faces byte for byte as before: an upload inlined, a link with no record and a blob left out', () => {
    const deck = exportDeckOf(fixtureDoc({ ...FIXTURE_FILES, [DECK_PATH]: JSON.stringify({ ...JSON.parse(FIXTURE_FILES[DECK_PATH]!), faces: TODAYS_FACES }) }), 'x');
    expect(deckAssetRefs(deck)).toEqual(['assets/brand.woff2', 'assets/logo.png']);
    expect(deckFacesCss(deck, asset)).toBe('@font-face { font-family: "Brand Sans"; src: url("data:font/woff2;base64,d09GMg=="); }');
  });
});
