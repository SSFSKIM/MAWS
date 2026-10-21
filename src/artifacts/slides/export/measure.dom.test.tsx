// P3-C M9 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12): the measure function survives being sent as
// text (it names nothing outside its own body) and reads the page's structure: paint order, runs and their marks, list
// bullets, table rows and cells, an x-shape's own paint, a connector's stroke, an icon's markup, the fit markers. Boxes
// and the fit itself need a layout engine: the export e2e reads those in the real window.
import { describe, expect, it } from 'vitest';
import { builtinView } from '../../design-system/view';
import { deckTokenValues } from '../mirror';
import { TEXT_TAGS } from '../ir';
import { FIXTURE_FILES, fixtureDoc } from './deck.test-support';
import { shrinkScale } from '../render-rules';
import { measureDeckPage, type MeasuredDeck } from './measure';
import { deckPage, exportDeckOf } from './standalone';

async function measuredFixture(prepare: () => void = () => {}): Promise<MeasuredDeck> {
  const deck = exportDeckOf(fixtureDoc(), 'Untitled');
  const html = deckPage(deck, { mode: 'measure', resolveVar: deckTokenValues(builtinView().tokens, deck.overrides), asset: () => null, facesCss: '' });
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)![1]!;
  document.head.innerHTML = `<style>${style}</style>`;
  document.body.innerHTML = body;
  prepare();
  // the function as main sends it: its source alone, evaluated where nothing of this module is in scope
  const alone = new Function(`return (${String(measureDeckPage)})`)() as typeof measureDeckPage;
  const search = new Function(`return (${String(shrinkScale)})`)() as typeof shrinkScale;
  return alone({ textTags: [...TEXT_TAGS] }, search);
}

describe('measureDeckPage', () => {
  it('reads every slide in paint order with its elements’ structure', async () => {
    const measured = await measuredFixture();
    expect(measured.slides.map((s) => s.id)).toEqual(['cover', 'body', 'gone']);
    const body = measured.slides[1]!;
    expect(body.elements.map((e) => [e.id, e.tag])).toEqual([
      ['badge', 'x-shape'],
      ['link', 'x-connector'],
      ['star', 'x-icon'],
      ['chart', 'svg'],
      ['points', 'ul'],
      ['grid', 'table'],
      ['live', 'x-embed'],
    ]);
  });

  it('reads text as paragraphs of runs with their links, and lists with bullets', async () => {
    const measured = await measuredFixture();
    const points = measured.slides[1]!.elements.find((e) => e.id === 'points')!;
    expect(points.text!.paragraphs.map((p) => [p.bullet, p.runs.map((r) => [r.text, r.href ?? null])])).toEqual([
      ['disc', [['One ', null], ['link', 'https://example.com/']]],
      ['disc', [['Two', null]]],
    ]);
    const title = measured.slides[0]!.elements.find((e) => e.id === 'title')!;
    expect(title.text!.paragraphs[0]!.runs.map((r) => r.text)).toEqual(['Quarterly ', 'review']);
  });

  it('reads a table’s rows and cells, an x-shape’s own paint, a connector’s stroke and an icon’s markup', async () => {
    const measured = await measuredFixture();
    const els = new Map(measured.slides[1]!.elements.map((e) => [e.id, e]));
    const grid = els.get('grid')!;
    expect(grid.rows!.map((r) => [r.id, r.cells.map((c) => [c.header, c.text.paragraphs[0]!.runs[0]!.text])])).toEqual([
      ['h', [[true, 'Region'], [true, 'Q1']]],
      ['r1', [[false, 'North'], [false, '12']]],
    ]);
    expect(els.get('badge')!.shape!.stroke).toMatchObject({ width: 4, style: 'solid' });
    expect(els.get('badge')!.shape!.fill).not.toBeNull();
    expect(els.get('link')!.shape!.stroke).toMatchObject({ width: 2, style: 'solid' });
    expect(els.get('link')!.attrs).toMatchObject({ x1: '300', x2: '600', head: 'end' });
    expect(els.get('star')!.svg).toMatch(/^<svg[^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(els.get('chart')!.attrs['aria-label']).toBe('A dot');
    expect(els.get('chart')!.attrs['data-layer']).toBeUndefined();
  });

  // fix wave 1 (found by the LibreOffice compare): with a line height under the face's content height (1.05 at 120 px)
  // two lines' boxes overlap; they are still two lines
  it('tells two lines whose boxes overlap from one line', async () => {
    const line = (top: number, h: number) => ({ left: 0, right: 100, width: 100, top, bottom: top + h, height: h });
    const rectsOf: Record<string, unknown[]> = { 'Quarterly ': [line(0, 156), line(126, 156)], review: [line(10, 140)] };
    const original = document.createRange.bind(document);
    const measured = await measuredFixture(() => {
      document.createRange = (() => {
        let node: Node | null = null;
        return { selectNodeContents: (n: Node) => void (node = n), getClientRects: () => rectsOf[node?.textContent ?? ''] ?? [] };
      }) as unknown as typeof document.createRange;
    }).finally(() => {
      document.createRange = original;
    });
    const title = measured.slides[0]!.elements.find((e) => e.id === 'title')!;
    expect(title.text!.oneLine).toBe(false);
    const sub = measured.slides[0]!.elements.find((e) => e.id === 'sub')!;
    expect(sub.text!.oneLine).toBe(true); // no rects at all: one line
  });

  it('reads an x-shape’s own shadow, which the canvas’s outline casts', async () => {
    const measured = await measuredFixture(() => document.querySelector<HTMLElement>('[data-eid="badge"]')!.style.setProperty('box-shadow', '0 8px 24px #00000040'));
    const badge = measured.slides[1]!.elements.find((e) => e.id === 'badge')!;
    expect(badge.shape!.shadow).toMatchObject({ x: 0, y: 8, blur: 24 });
    expect(badge.shape!.shadow!.color).not.toBe('');
  });
});

// The final review's A9 and A10: each a regression of a code-traced finding.
describe('measureDeckPage: the final review', () => {
  async function measuredSlide(body: string) {
    const deck = exportDeckOf(fixtureDoc({ ...FIXTURE_FILES, 'project/slides/body.html': `<section id="body">${body}</section>` }), 'Untitled');
    const html = deckPage(deck, { mode: 'measure', resolveVar: () => undefined, asset: () => null, facesCss: '', only: ['body'] });
    document.head.innerHTML = `<style>${/<style>([\s\S]*?)<\/style>/.exec(html)![1]!}</style>`;
    document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)![1]!;
    const alone = new Function(`return (${String(measureDeckPage)})`)() as typeof measureDeckPage;
    const search = new Function(`return (${String(shrinkScale)})`)() as typeof shrinkScale;
    return (await alone({ textTags: [...TEXT_TAGS] }, search)).slides[0]!;
  }
  const runsOf = (slide: Awaited<ReturnType<typeof measuredSlide>>, id: string) => slide.elements.find((e) => e.id === id)!.text!.paragraphs.flatMap((p) => p.runs.map((r) => [r.text, r.breaks ?? 0]));

  it('A9: keeps every line break: two in a row, a leading one, and the trailing ones the app shows (one fewer)', async () => {
    const slide = await measuredSlide('<p id="t">A<br><br>B<br><br></p><p id="l"><br>Lead</p><p id="e">End<br></p>');
    expect(runsOf(slide, 't')).toEqual([['A', 0], ['B', 2], ['', 1]]);
    expect(runsOf(slide, 'l')).toEqual([['Lead', 1]]);
    expect(runsOf(slide, 'e')).toEqual([['End', 0]]);
  });

  it('A10: writes the text the app shows under text-transform, its own or inherited, capitalizing words across runs', async () => {
    const slide = await measuredSlide('<p id="u" style="text-transform:uppercase">Big <b>deal</b></p><div id="d" style="text-transform:lowercase"><p id="i">LOUD</p></div><p id="c" style="text-transform:capitalize">hello <b>wor</b>ld again</p>');
    expect(runsOf(slide, 'u')).toEqual([['BIG ', 0], ['DEAL', 0]]);
    expect(runsOf(slide, 'i')).toEqual([['loud', 0]]);
    expect(runsOf(slide, 'c')).toEqual([['Hello ', 0], ['Wor', 0], ['ld Again', 0]]);
  });

  it('leaves out what a hidden ancestor hides', async () => {
    const slide = await measuredSlide('<div id="g" data-group="" style="position:absolute; left:0px; top:0px; width:100px; height:100px; display:none"><p id="in" style="position:absolute; left:0px; top:0px">Hidden</p></div><p id="out">Shown</p>');
    expect(slide.elements.map((e) => e.id)).toEqual(['out']);
  });

  // P4 (the skewed-element row): a skew, its own or an ancestor's, draws the box as a parallelogram no box and turn
  // describe, so the element carries its drawn box (the export takes the window's picture of it there); a turn and a
  // scale keep the box and turn they had
  it('marks an element its own or an ancestor’s skew draws with its drawn box, and a turned or scaled one not', async () => {
    // the page writes transform functions lowercase, which CSS (and Chromium) reads as any case; happy-dom's matrix only
    // as written in the spec
    const Native = globalThis.DOMMatrixReadOnly;
    globalThis.DOMMatrixReadOnly = class extends Native {
      constructor(init?: string | number[]) {
        super(typeof init === 'string' ? init.replace(/\bskew([xy])\(/g, (_, axis: string) => `skew${axis.toUpperCase()}(`) : init);
      }
    };
    try {
      const slide = await measuredSlide(
        '<p id="lean" style="position:absolute; left:100px; top:100px; width:200px; transform:skewX(20deg)">Lean</p>' +
          '<div id="grp" data-group="" style="position:absolute; left:400px; top:100px; width:300px; height:200px; transform:rotate(10deg) skewY(15deg)"><x-connector id="wire" x1="0" y1="0" x2="300" y2="200"></x-connector><p id="member" style="position:absolute; left:10px; top:10px">In</p></div>' +
          '<p id="turned" style="position:absolute; left:100px; top:400px; transform:rotate(30deg) scale(1.5)">Turned</p>',
      );
      const drawn = (id: string) => slide.elements.find((e) => e.id === id)!.drawn !== undefined;
      expect(['lean', 'grp', 'wire', 'member', 'turned'].map(drawn)).toEqual([true, true, true, true, false]);
      // the review's second finding: the drawn box holds what the element paints past its border box (a shadow 40 px
      // down, carried by the lean), within the slide; happy-dom lays nothing out, so every box is empty at the corner,
      // and the slide is given its own 1920 × 1080
      const box = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (this: Element) {
        return this.classList.contains('maws-slide') ? ({ left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080, x: 0, y: 0 } as DOMRect) : box.call(this);
      };
      try {
        const cast = await measuredSlide('<p id="plain" style="position:absolute; left:0px; top:0px; width:200px; transform:skewX(30deg)">Lean</p><p id="cast" style="position:absolute; left:0px; top:0px; width:200px; box-shadow:0px 40px 0px #0000ff; transform:skewX(30deg)">Lean</p>');
        const of = (id: string) => cast.elements.find((e) => e.id === id)!.drawn!;
        expect([of('plain').w, of('plain').h]).toEqual([0, 0]);
        expect([of('cast').w >= 40, of('cast').h >= 40, of('cast').x, of('cast').y]).toEqual([true, true, 0, 0]);
      } finally {
        Element.prototype.getBoundingClientRect = box;
      }
    } finally {
      globalThis.DOMMatrixReadOnly = Native;
    }
  });
});
