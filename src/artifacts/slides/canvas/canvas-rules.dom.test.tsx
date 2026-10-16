// P3-C final fix wave B, findings B2 and B3 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Canvas"):
// what the canvas's stylesheet makes of a container's display, and what the canvas makes of an asset named in a style
// value. happy-dom computes styles from `CANVAS_CSS` (selectors and the cascade), not layout; the e2e paints them.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDoc, transact, type Doc } from '../../yjs';
import { importSlide, setStyle, writeDeckKeys } from '../model';
import { loadSlide } from '../parse';
import { CANVAS_CSS } from './css';
import { SlideCanvas } from './slide-canvas';

function deck(html: string): Doc {
  const doc = newDoc();
  const l = loadSlide(html);
  if (!l.ok) throw new Error(l.held.reasons.join('; '));
  const dropped = l.diagnostics.filter((w) => w.severity === 'warning');
  if (dropped.length) throw new Error(dropped.map((w) => w.message).join('; '));
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: [l.slide.id] });
    importSlide(doc, l.slide, 'a0');
  });
  return doc;
}

const mounted: SlideCanvas[] = [];
function mount(doc: Doc, slideId = 's1'): SlideCanvas {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const canvas = new SlideCanvas(doc, slideId, host, { assetUrl: (ref) => (ref === 'assets/missing.png' ? null : `maws-artifact://a/live/${ref}`) });
  mounted.push(canvas);
  return canvas;
}
beforeEach(() => {
  const style = document.createElement('style');
  style.textContent = CANVAS_CSS;
  document.head.appendChild(style);
});
afterEach(() => {
  mounted.splice(0).forEach((c) => c.dispose());
  document.body.replaceChildren();
  document.head.replaceChildren();
});

const direction = (n: Element) => getComputedStyle(n).flexDirection;

describe('a container’s display (B2)', () => {
  it('a div or section without display is a column; an explicit flex without a direction is a row (CSS, the loader)', () => {
    const c = mount(
      deck(`<section id="s1" style="padding:128px">
        <div id="col" style="gap:16px"><p id="a">A</p></div>
        <div id="row" style="display:flex; gap:32px"><p id="b">B</p></div>
        <div id="down" style="display:flex; flex-direction:column"><p id="c">C</p></div>
        <div id="across" style="flex-direction:row"><p id="d">D</p></div>
      </section>`),
    );
    expect(direction(c.root)).toBe('column');
    expect(direction(c.node('col')!)).toBe('column');
    expect(direction(c.node('row')!)).toBe('row');
    expect(direction(c.node('down')!)).toBe('column');
    expect(direction(c.node('across')!)).toBe('row');
  });

  it('a section with an explicit flex is a row; a display written or removed later is drawn the same', () => {
    const doc = deck(`<section id="s1" style="display:flex; gap:32px"><div id="d" style="gap:8px"><p id="p">P</p></div></section>`);
    const c = mount(doc);
    expect(direction(c.root)).toBe('row');
    setStyle(doc, 's1', 'd', { display: 'flex' });
    expect(direction(c.node('d')!)).toBe('row');
    setStyle(doc, 's1', 'd', { display: null });
    expect(direction(c.node('d')!)).toBe('column');
    setStyle(doc, 's1', '', { display: null });
    expect(direction(c.root)).toBe('column');
  });
});

describe('an asset named in a style value (B3)', () => {
  const ART = `<section id="s1" style="background:url(assets/ground.png) center / cover">
    <div id="art" style="position:absolute; left:0px; top:0px; width:400px; height:300px; background:url(assets/tile.png) center / cover"></div>
    <h1 id="t" style="background:url(assets/tex.png); background-clip:text; -webkit-text-fill-color:transparent; color:#111111">Text</h1>
    <div id="gone" style="position:absolute; left:0px; top:400px; width:100px; height:100px; background:url(assets/missing.png)"></div>
  </section>`;
  const style = (n: Element) => n.getAttribute('style') ?? '';

  it('draws an uploaded asset through the store’s URL, on an element and on the section', () => {
    const c = mount(deck(ART));
    expect(style(c.node('art')!)).toContain('maws-artifact://a/live/assets/tile.png');
    expect(style(c.node('t')!)).toContain('maws-artifact://a/live/assets/tex.png');
    expect(style(c.root)).toContain('maws-artifact://a/live/assets/ground.png');
  });

  it('an asset the deck lacks never loads from the app’s origin', () => {
    const c = mount(deck(ART));
    expect(style(c.node('gone')!)).not.toMatch(/url\(\s*["']?assets\//);
  });

  it('a style written later resolves the same way (the patch path)', () => {
    const doc = deck(ART);
    const c = mount(doc);
    setStyle(doc, 's1', 'art', { background: 'url(assets/other.png) center / contain' });
    expect(style(c.node('art')!)).toContain('maws-artifact://a/live/assets/other.png');
    setStyle(doc, 's1', '', { background: 'url(assets/night.png) center / cover' });
    expect(style(c.root)).toContain('maws-artifact://a/live/assets/night.png');
  });
});
