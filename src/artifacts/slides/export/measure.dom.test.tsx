// P3-C M9 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12): the measure function survives being sent as
// text (it names nothing outside its own body) and reads the page's structure: paint order, runs and their marks, list
// bullets, table rows and cells, an x-shape's own paint, a connector's stroke, an icon's markup, the fit markers. Boxes
// and the fit itself need a layout engine: the export e2e reads those in the real window.
import { describe, expect, it } from 'vitest';
import { builtinView } from '../../design-system/view';
import { deckTokenValues } from '../mirror';
import { TEXT_TAGS } from '../ir';
import { fixtureDoc } from './deck.test-support';
import { measureDeckPage, type MeasuredDeck } from './measure';
import { deckPage, exportDeckOf } from './standalone';

async function measuredFixture(): Promise<MeasuredDeck> {
  const deck = exportDeckOf(fixtureDoc(), 'Untitled');
  const html = deckPage(deck, { mode: 'measure', resolveVar: deckTokenValues(builtinView().tokens, deck.overrides), asset: () => null, facesCss: '' });
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)![1]!;
  document.head.innerHTML = `<style>${style}</style>`;
  document.body.innerHTML = body;
  // the function as main sends it: its source alone, evaluated where nothing of this module is in scope
  const alone = new Function(`return (${String(measureDeckPage)})`)() as typeof measureDeckPage;
  return alone({ textTags: [...TEXT_TAGS] });
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
});
