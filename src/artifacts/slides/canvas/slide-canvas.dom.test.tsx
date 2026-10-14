// P3-C M4 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Canvas"): the DOM canvas draws a slide from the
// model and patches it from the change records with the fewest writes; the dialect's own elements draw as MAWS draws
// them. Paint itself (the under-layer rule read from pixels, the fit pass's measures) is the e2e's: happy-dom lays
// nothing out.
import { afterEach, describe, expect, it } from 'vitest';
import { newDoc, transact, type Doc } from '../../yjs';
import { deleteElementTree, importSlide, reorderFlow, setAttrs, setStyle, setText, writeDeckKeys, zOrder } from '../model';
import { loadSlide } from '../parse';
import { SlideCanvas } from './slide-canvas';

const SLIDE = `<section id="s1" style="background:#fbfbf8; padding:128px">
  <h2 id="title" style="font-size:64px">Plan <b>now</b></h2>
  <ul id="list" style="font-size:28px"><li>One</li><li>Two <i>more</i></li></ul>
  <img id="pic" alt="HQ" src="assets/hq.jpg" style="width:480px; height:360px">
  <img id="blob" alt="Logo" src="/_blob/logo1" style="width:160px; height:64px">
  <table id="t"><tr id="r1"><th>A</th><th>B</th></tr></table>
  <div id="band" style="position:absolute; left:0px; top:0px; width:1920px; height:96px; background:#eef2f1"></div>
  <x-shape id="dot" kind="ellipse" style="position:absolute; left:100px; top:700px; width:200px; height:100px; background:#2b7a78"></x-shape>
  <x-icon id="star" name="Star" style="position:absolute; left:400px; top:700px; width:64px; height:64px; color:#2b7a78"></x-icon>
  <x-connector id="arrow" x1="320" y1="300" x2="672" y2="300" route="hv" style="color:#2b7a78; border-width:3px"></x-connector>
  <x-embed id="live" style="position:absolute; left:800px; top:700px; width:300px; height:200px"><p>hi</p><script>document.body.dataset.ran = '1'</script></x-embed>
  <aside>Notes</aside>
</section>`;

function deck(html = SLIDE): Doc {
  const doc = newDoc();
  const l = loadSlide(html);
  if (!l.ok) throw new Error(l.held.reasons.join('; '));
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
  const canvas = new SlideCanvas(doc, slideId, host, { assetUrl: (ref) => `maws-artifact://a/live/${ref}` });
  mounted.push(canvas);
  return canvas;
}
afterEach(() => {
  mounted.splice(0).forEach((c) => c.dispose());
  document.body.replaceChildren();
});
const childIds = (n: Element) => Array.from(n.children).map((c) => (c as HTMLElement).dataset.eid);

describe('the slide canvas', () => {
  it('draws the slide: the section’s style, every element by id in paint order, text with its marks', () => {
    const c = mount(deck());
    expect(c.root.className).toBe('maws-slide');
    expect(c.root.style.getPropertyValue('padding')).toBe('128px');
    // the band, written after the flow content, is pinned over it: [flow] [over]
    expect(childIds(c.root)).toEqual(['title', 'list', 'pic', 'blob', 't', 'band', 'dot', 'star', 'arrow', 'live']);
    expect(c.node('title')!.innerHTML).toBe('Plan <b>now</b>');
    expect(c.node('list')!.innerHTML).toBe('<li>One</li><li>Two <i>more</i></li>');
    expect(c.node('t')!.querySelectorAll('th')).toHaveLength(2);
    expect(c.node('band')!.dataset.layer).toBeUndefined();
  });

  it('a pinned element sent back paints under the flow layer (data-layer under, z-index:-1 in the canvas CSS)', () => {
    const doc = deck();
    const c = mount(doc);
    zOrder(doc, 's1', 'band', 'back');
    expect(c.node('band')!.dataset.layer).toBe('under');
    expect(childIds(c.root)[0]).toBe('band');
  });

  it('patches one style write for one changed key, re-places only what moved, re-renders only the changed text', () => {
    const doc = deck();
    const c = mount(doc);
    const created = c.writes.create;
    const styled = c.writes.style;
    const titleNode = c.node('title');
    setStyle(doc, 's1', 'title', { 'font-size': '72px' });
    expect(c.writes.style - styled).toBe(1);
    expect(titleNode!.style.getPropertyValue('font-size')).toBe('72px');
    const before = c.writes.place;
    reorderFlow(doc, 's1', 'pic', 'title');
    expect(childIds(c.root).slice(0, 3)).toEqual(['pic', 'title', 'list']);
    expect(c.writes.place - before).toBe(1); // only the moved node
    setText(doc, 's1', 'title', [{ type: 'p', inline: [{ text: 'Plan later', marks: {} }] }]);
    expect(c.writes.text).toBe(1);
    expect(c.node('title')).toBe(titleNode); // the same node, its content re-rendered
    expect(c.writes.create).toBe(created);
    deleteElementTree(doc, 's1', 'list');
    expect(c.node('list')).toBeUndefined();
    expect(c.root.querySelector('[data-eid="list"]')).toBeNull();
  });

  it('a hidden slide still draws (the canvas carries data-hidden, never hidden)', () => {
    const doc = deck();
    const c = mount(doc);
    setAttrs(doc, 's1', '', { hidden: '' });
    expect(c.root.hasAttribute('hidden')).toBe(false);
    expect(c.root.hasAttribute('data-hidden')).toBe(true);
  });

  it('pictures: an uploaded asset through the store, Claude’s blob paths as a labelled placeholder', () => {
    const c = mount(deck());
    expect((c.node('pic') as HTMLImageElement).getAttribute('src')).toBe('maws-artifact://a/live/assets/hq.jpg');
    expect(c.node('blob')!.hasAttribute('src')).toBe(false);
    expect(c.node('blob')!.dataset.placeholder).toBe('/_blob/logo1');
  });

  it('the dialect’s own elements: an icon’s glyph, a shape’s outline, a connector’s line and head, an embed’s sandboxed frame', () => {
    const c = mount(deck());
    c.layoutNow();
    expect(c.node('star')!.querySelector('svg path')!.getAttribute('d')).toMatch(/^M 12 3/);
    expect(c.node('dot')!.querySelector('svg[data-glyph] path')).not.toBeNull();
    expect(c.node('arrow')!.querySelector('polyline')).not.toBeNull();
    expect(c.node('arrow')!.querySelector('polygon')).not.toBeNull(); // the default end head, filled
    const frame = c.node('live')!.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.srcdoc).toContain("default-src 'none'");
    expect(frame.srcdoc).toContain('<p>hi</p>');
  });

  it('a slide’s node written again (an undo bringing it back) is not this canvas’s: it stops at dispose and leaves nothing behind', () => {
    const doc = deck();
    const c = mount(doc);
    c.dispose();
    expect(document.querySelector('.maws-slide')).toBeNull();
    setStyle(doc, 's1', 'title', { color: '#ff0000' }); // no observer left to throw
  });
});
