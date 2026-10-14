// P3-C M9 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12): a deck for the exporters' suites, touching each
// thing an export maps: a design-system token with the deck's override, an uploaded picture and face, a sized text box,
// a fade and a push, notes, a hidden slide, an x-shape, x-connector, x-icon and svg, a list with a link, a table, an
// embed; and a measured form of it as the export window would read it (boxes in slide px).
import { newDoc, type Doc } from '../../yjs';
import { heldSlides } from '../answer';
import { publishDeck } from '../publish';
import type { MeasuredDeck, MeasuredElement, MeasuredPaint, MeasuredRun } from './measure';

export const FIXTURE_FILES: Record<string, string> = {
  'project/deck.json': JSON.stringify({
    v: 4,
    title: 'Quarterly',
    cover: 'cover',
    order: ['cover', 'body', 'gone'],
    faces: { 'brand-sans': { family: 'Brand Sans', src: 'assets/brand.woff2' } },
    dsOverrides: { '--ds-color-accent': '#123456' },
  }),
  'project/slides/cover.html': `<section id="cover" data-transition="fade" style="background:var(--ds-color-bg, #ffffff); padding:128px">
<h1 id="title" style="font-size:96px; color:var(--ds-color-accent, #ff0000)">Quarterly <b>review</b></h1>
<p id="sub" style="height:80px; font-size:40px; font-family:'Brand Sans', Georgia, serif">A sized subtitle</p>
<img id="logo" src="assets/logo.png" alt="Logo" style="position:absolute; left:1600px; top:64px; width:200px; height:100px">
<aside>Open with the numbers.</aside></section>`,
  'project/slides/body.html': `<section id="body" data-transition="push" style="background:#fbfbf8; padding:128px">
<x-shape id="badge" kind="ellipse" style="position:absolute; left:100px; top:100px; width:200px; height:100px; background:#2b7a78; border:4px solid #0f2a3d"></x-shape>
<x-connector id="link" x1="300" y1="150" x2="600" y2="150" head="end"></x-connector>
<x-icon id="star" name="Star" style="position:absolute; left:700px; top:100px; color:#ff8800"></x-icon>
<svg id="chart" viewBox="0 0 100 100" aria-label="A dot" style="position:absolute; left:900px; top:100px; width:100px; height:100px"><circle cx="50" cy="50" r="40" fill="#2b7a78"></circle></svg>
<ul id="points" style="font-size:36px"><li>One <a href="https://example.com/">link</a></li><li>Two</li></ul>
<table id="grid" style="font-size:28px"><tr id="h" style="background:#eef2f1"><th>Region</th><th>Q1</th></tr><tr id="r1"><td>North</td><td>12</td></tr></table>
<x-embed id="live" style="position:absolute; left:1200px; top:600px; width:400px; height:300px"><script>document.body.textContent = 'hi'</script></x-embed>
</section>`,
  'project/slides/gone.html': `<section id="gone" hidden style="background:#000000"><p id="g" style="color:#ffffff">Hidden</p></section>`,
};

/** The fixture deck as a model; throws when any slide is held (the fixture must load clean). */
export function fixtureDoc(files: Record<string, string> = FIXTURE_FILES): Doc {
  const doc = newDoc();
  publishDeck(doc, {}, files, false);
  const held = heldSlides(doc);
  if (held.length) throw new Error(`the fixture holds ${JSON.stringify(held)}`);
  return doc;
}

const NO_PAINT: MeasuredPaint = { fill: null, image: false, borders: [null, null, null, null], radius: 0, shadow: null, opacity: 1 };
const run = (text: string, extra: Partial<MeasuredRun> = {}): MeasuredRun => ({ text, font: 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif', size: 32, bold: false, italic: false, underline: false, strike: false, color: 'rgb(0, 0, 0)', letterSpacing: 0, ...extra });
const el = (e: Partial<MeasuredElement> & Pick<MeasuredElement, 'id' | 'tag' | 'box'>): MeasuredElement => ({ rotate: 0, paint: NO_PAINT, color: 'rgb(0, 0, 0)', attrs: {}, ...e });

/** The fixture as the export window measures it (hand-written to the page's layout, boxes in slide px). */
export const MEASURED: MeasuredDeck = {
  slides: [
    {
      id: 'cover',
      background: { fill: 'rgb(255, 255, 255)', image: false },
      elements: [
        el({
          id: 'title',
          tag: 'h1',
          box: { x: 128, y: 128, w: 1664, h: 106 },
          color: 'rgb(18, 52, 86)',
          text: { paragraphs: [{ runs: [run('Quarterly ', { size: 96, bold: true, color: 'rgb(18, 52, 86)' }), run('review', { size: 96, bold: true, color: 'rgb(18, 52, 86)' })], align: 'left', lineHeight: 105.6 }], padding: [0, 0, 0, 0], valign: 'top', ink: { x: 128, y: 136, w: 640, h: 90 } },
        }),
        el({
          id: 'sub',
          tag: 'p',
          box: { x: 128, y: 234, w: 1664, h: 80 },
          fit: { mode: 'shrink', size: 36, clipped: false },
          text: { paragraphs: [{ runs: [run('A sized subtitle', { font: '"Brand Sans", Georgia, serif', size: 36 })], align: 'left', lineHeight: 50.4 }], padding: [0, 0, 0, 0], valign: 'top', ink: null },
        }),
        el({ id: 'logo', tag: 'img', box: { x: 1600, y: 64, w: 200, h: 100 }, image: { natural: { w: 400, h: 400 }, fit: 'fill', position: [0.5, 0.5], placeholder: false }, attrs: { alt: 'Logo' } }),
      ],
    },
    {
      id: 'body',
      background: { fill: 'rgb(251, 251, 248)', image: false },
      elements: [
        el({ id: 'badge', tag: 'x-shape', box: { x: 100, y: 100, w: 200, h: 100 }, attrs: { kind: 'ellipse' }, shape: { fill: 'rgb(43, 122, 120)', stroke: { width: 4, style: 'solid', color: 'rgb(15, 42, 61)' } } }),
        el({ id: 'link', tag: 'x-connector', box: { x: 0, y: 0, w: 1920, h: 1080 }, attrs: { x1: '300', y1: '150', x2: '600', y2: '150', head: 'end' }, shape: { fill: null, stroke: { width: 2, style: 'solid', color: 'rgb(0, 0, 0)' } } }),
        el({ id: 'star', tag: 'x-icon', box: { x: 700, y: 100, w: 64, h: 64 }, color: 'rgb(255, 136, 0)', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" style="color:rgb(255, 136, 0)"><path d="M 1 1 L 2 2"/></svg>', attrs: { name: 'Star' } }),
        el({ id: 'chart', tag: 'svg', box: { x: 900, y: 100, w: 100, h: 100 }, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#2b7a78"/></svg>', attrs: { viewBox: '0 0 100 100', 'aria-label': 'A dot' } }),
        el({
          id: 'points',
          tag: 'ul',
          box: { x: 128, y: 128, w: 1664, h: 101 },
          text: {
            paragraphs: [
              { runs: [run('One ', { size: 36 }), run('link', { size: 36, underline: true, href: 'https://example.com/' })], align: 'left', lineHeight: 50.4, bullet: 'disc' },
              { runs: [run('Two', { size: 36 })], align: 'left', lineHeight: 50.4, bullet: 'disc' },
            ],
            padding: [0, 0, 0, 45],
            valign: 'top',
            ink: null,
          },
        }),
        el({
          id: 'grid',
          tag: 'table',
          box: { x: 128, y: 229, w: 400, h: 120 },
          rows: [
            { id: 'h', box: { x: 128, y: 229, w: 400, h: 60 }, fill: 'rgb(238, 242, 241)', cells: [0, 1].map((k) => ({ box: { x: 128 + k * 200, y: 229, w: 200, h: 60 }, fill: null, borders: [null, null, null, null] as MeasuredPaint['borders'], header: true, text: { paragraphs: [{ runs: [run(['Region', 'Q1'][k]!, { size: 28, bold: true })], align: 'left' as const, lineHeight: 39.2 }], padding: [12, 16, 12, 16] as [number, number, number, number], valign: 'top' as const, ink: null } })) },
            { id: 'r1', box: { x: 128, y: 289, w: 400, h: 60 }, fill: null, cells: [0, 1].map((k) => ({ box: { x: 128 + k * 200, y: 289, w: 200, h: 60 }, fill: null, borders: [null, null, null, null] as MeasuredPaint['borders'], header: false, text: { paragraphs: [{ runs: [run(['North', '12'][k]!, { size: 28 })], align: 'left' as const, lineHeight: 39.2 }], padding: [12, 16, 12, 16] as [number, number, number, number], valign: 'top' as const, ink: null } })) },
          ],
        }),
        el({ id: 'live', tag: 'x-embed', box: { x: 1200, y: 600, w: 400, h: 300 } }),
      ],
    },
    {
      id: 'gone',
      background: { fill: 'rgb(0, 0, 0)', image: false },
      elements: [el({ id: 'g', tag: 'p', box: { x: 0, y: 0, w: 1920, h: 45 }, text: { paragraphs: [{ runs: [run('Hidden', { color: 'rgb(255, 255, 255)' })], align: 'left', lineHeight: 44.8 }], padding: [0, 0, 0, 0], valign: 'top', ink: null } })],
    },
  ],
};
