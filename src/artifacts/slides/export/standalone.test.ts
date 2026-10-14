// P3-C M9 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "Standalone HTML", "PDF"): the deck's own page.
import { describe, expect, it } from 'vitest';
import { builtinView } from '../../design-system/view';
import { deckTokenValues } from '../mirror';
import { FIXTURE_FILES, fixtureDoc, MEASURED } from './deck.test-support';
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
    expect(html).toContain('<svg data-eid="chart" data-layer="under" aria-label="A dot" viewBox="0 0 100 100"');
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
    expect(html).toContain('object-fit:cover; object-position:25% 50%; object-view-box:inset(100px 150px 100px 50px)');
  });
});
