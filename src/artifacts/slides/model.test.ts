// P3-C M2 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D2, D8): the deck model. S6's round trip (IR → Y.Doc
// → IR → file equals the canonical file) over the whole corpus, the read rules, the files a read returns, the repair,
// anchors, and the editor's writers (one gesture one transaction).
import { describe, expect, it } from 'vitest';
import { applyV1, diffV1, newDoc, onUpdate, stateVector, transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { DECK_PATH, parseDeckJson } from './deck';
import { CORPUS } from './fixtures/corpus';
import type { SlideIR } from './ir';
import {
  deckFiles,
  deleteElementTree,
  detach,
  duplicateElements,
  importSlide,
  insertSlide,
  moveInto,
  moveSlide,
  readDeckJson,
  readFlat,
  readSlide,
  reorderFlow,
  repair,
  resolveAnchor,
  setAttrs,
  setNotes,
  setStyle,
  slideOrder,
  writeDeckKeys,
  zOrder,
  deleteSlide,
} from './model';
import { loadSlide } from './parse';
import { serializeSlide } from './serialize';

const load = (html: string): SlideIR => {
  const l = loadSlide(html);
  if (!l.ok) throw new Error(l.held.reasons.join('; '));
  return l.slide;
};
const sync = (to: Doc, from: Doc) => applyV1(to, diffV1(from, stateVector(to)));
function updatesOf(doc: Doc, edit: () => void): number {
  let n = 0;
  const off = onUpdate(doc, () => n++);
  edit();
  off();
  return n;
}
const ids = (doc: Doc, slide = 's1') => readSlide(doc, slide).children.map((c) => c.id);

const SLIDE = `<section id="s1" style="background:#ffffff; padding:128px">
  <div id="bg" style="position:absolute; left:0px; top:0px; width:1920px; height:1080px; background:#eeeeee"></div>
  <h2 id="title" style="font-size:64px">Title</h2>
  <p id="body">Body</p>
  <div id="g1" style="position:relative; display:flex; gap:8px"><p id="in1">One</p><p id="in2">Two</p></div>
  <p id="e1" style="position:absolute; left:100px; top:300px; width:400px">One</p>
  <p id="e2" style="position:absolute; left:600px; top:300px; width:400px">Two</p>
  <table id="t"><tr id="r1"><th>A</th><th>B</th></tr><tr id="r2"><td>1</td><td>2</td></tr></table>
</section>`;
function deckOf(...slides: string[]): Doc {
  const doc = newDoc();
  transact(doc, () => {
    const irs = slides.map(load);
    writeDeckKeys(doc, { v: 4, title: 'T', order: irs.map((s) => s.id), faces: { lora: { family: 'Lora', src: 'assets/lora.woff2' } }, dsOverrides: { '--ds-color-bg': '#000000' } });
    irs.forEach((ir, i) => importSlide(doc, ir, `a${i}`));
  });
  return doc;
}

describe('the model: S6’s round trip', () => {
  it.each(CORPUS.map((c) => [c.name, c.html]))('%s: IR → Y.Doc → IR → file equals the canonical file', (_, html) => {
    const ir = load(html);
    const canonical = serializeSlide(ir);
    const doc = newDoc();
    transact(doc, () => importSlide(doc, ir, 'a0'));
    expect(serializeSlide(readSlide(doc, ir.id))).toBe(canonical);
    // and through a second replica's sync
    const replica = newDoc();
    sync(replica, doc);
    expect(serializeSlide(readSlide(replica, ir.id))).toBe(canonical);
  });

  it('gives table cells model ids of their row (outside the id grammar) and leaves them out of the file', () => {
    const doc = deckOf(SLIDE);
    const cells = readFlat(doc, 's1').filter((e) => e.tag === 'th' || e.tag === 'td');
    expect(cells.map((c) => c.parent)).toEqual(expect.arrayContaining(['r1', 'r1', 'r2', 'r2']));
    expect(cells.every((c) => /^r[12]\/[0-9a-z]+\.\d+$/.test(c.id))).toBe(true);
    expect(deckFiles(doc)['project/slides/s1.html']).toContain('<tr id="r1">\n      <th>A</th>');
  });

  it('reads the index with its order from the slides, its maps and MAWS’s overrides, every key kept', () => {
    const doc = deckOf(SLIDE.replace('id="s1"', 'id="b"'), SLIDE);
    const files = deckFiles(doc);
    expect(Object.keys(files)).toEqual([DECK_PATH, 'project/slides/b.html', 'project/slides/s1.html']);
    const parsed = parseDeckJson(files[DECK_PATH]!);
    expect(parsed.ok && parsed.deck).toMatchObject({ v: 4, title: 'T', order: ['b', 's1'], faces: { lora: { family: 'Lora' } }, dsOverrides: { '--ds-color-bg': '#000000' } });
    moveSlide(doc, 'b', 's1');
    expect(readDeckJson(doc).order).toEqual(['s1', 'b']);
  });

  it('returns a held slide’s source verbatim', () => {
    const doc = deckOf(SLIDE);
    transact(doc, () => Y.setSlideKey(doc, 's1', 'held', { source: '<section id="s1"><iframe></iframe></section>', reasons: ['x'] }));
    expect(deckFiles(doc)['project/slides/s1.html']).toBe('<section id="s1"><iframe></iframe></section>');
  });
});

describe('the model: read rules and the repair', () => {
  it('reads an orphan at the section and a cycle’s smallest id at the section; the repair writes those and equal keys once', () => {
    const doc = deckOf(SLIDE);
    transact(doc, () => {
      Y.setElementKey(doc, 's1', 'in1', 'parent', 'gone');
      Y.setElementKey(doc, 's1', 'g1', 'parent', 'in2'); // not a container: the section
      Y.setElementKey(doc, 's1', 'e1', 'z', Y.elementScalars(doc, 's1', 'e2').z as string);
      Y.setSlideKey(doc, 's1', 'order', 'a0');
    });
    expect(ids(doc)).toContain('in1');
    const sv = stateVector(doc);
    // in1's and g1's parents (in2 holds no children), in1's flow key now equal to a section child's, e1/e2's equal z
    expect(repair(doc)).toBe(4);
    expect(readFlat(doc, 's1', false).find((e) => e.id === 'in1')!.parent).toBe('');
    expect(repair(doc)).toBe(0);
    expect(diffV1(doc, sv).length).toBeGreaterThan(0);
  });

  it('repairs only the slides it is given, and separates equal slide keys always', () => {
    const doc = deckOf(SLIDE, SLIDE.replace('id="s1"', 'id="s2"'));
    transact(doc, () => {
      Y.setElementKey(doc, 's1', 'in1', 'parent', 'gone');
      Y.setElementKey(doc, 's2', 'in1', 'parent', 'gone');
      Y.setSlideKey(doc, 's2', 'order', Y.slideScalars(doc, 's1').order as string);
    });
    expect(repair(doc, { slides: ['s2'] })).toBe(3); // s2's in1: its parent and its key among the section's; the slide key
    expect(readFlat(doc, 's1', false).find((e) => e.id === 'in1')!.parent).toBe('gone');
    expect(slideOrder(doc)).toEqual(['s1', 's2']);
  });

  it('resolves an anchor by ids alone, and orphans it on delete', () => {
    const doc = deckOf(SLIDE);
    const anchor = { slideId: 's1', elementId: 'e2' };
    setStyle(doc, 's1', 'e2', { left: '1px' });
    zOrder(doc, 's1', 'e2', 'back');
    moveInto(doc, 's1', 'e2', 'g1');
    expect(resolveAnchor(doc, anchor)).toEqual({ live: true, tag: 'p', parent: 'g1' });
    deleteElementTree(doc, 's1', 'g1');
    expect(resolveAnchor(doc, anchor)).toEqual({ live: false });
  });
});

describe('the model: the editor’s writers', () => {
  it('writes one transaction per gesture with the caller’s origin; null removes a property; the section is id ""', () => {
    const doc = deckOf(SLIDE);
    const origins: unknown[] = [];
    const off = onUpdate(doc, (_, origin) => origins.push(origin));
    setStyle(doc, 's1', 'title', { color: '#ff0000', 'font-size': null }, 'editor');
    setStyle(doc, 's1', '', { background: '#000000' }, 'editor');
    setAttrs(doc, 's1', '', { hidden: '', 'data-transition': 'fade' }, 'editor');
    setNotes(doc, 's1', 'Say it', 'editor');
    off();
    expect(origins).toEqual(['editor', 'editor', 'editor', 'editor']);
    const file = deckFiles(doc)['project/slides/s1.html']!;
    expect(file).toContain('<section id="s1" data-transition="fade" hidden style="padding:128px; background:#000000">');
    expect(file).toContain('<h2 id="title" style="color:#ff0000">Title</h2>');
    expect(file).toContain('<aside>Say it</aside>');
  });

  it('moves a pinned element through the stack front, back, forward and backward, the flow layer one step', () => {
    const doc = deckOf(SLIDE);
    expect(ids(doc).filter((id) => ['bg', 'e1', 'e2'].includes(id))).toEqual(['bg', 'e1', 'e2']);
    const order = () => ids(doc).join(',');
    zOrder(doc, 's1', 'bg', 'forward'); // under → the first over the flow layer
    expect(order()).toBe('title,body,g1,t,bg,e1,e2');
    zOrder(doc, 's1', 'bg', 'forward');
    expect(order()).toBe('title,body,g1,t,e1,bg,e2');
    zOrder(doc, 's1', 'e2', 'back');
    expect(order()).toBe('e2,title,body,g1,t,e1,bg');
    zOrder(doc, 's1', 'e2', 'backward'); // already at the bottom
    expect(order()).toBe('e2,title,body,g1,t,e1,bg');
    zOrder(doc, 's1', 'e1', 'front');
    expect(order()).toBe('e2,title,body,g1,t,bg,e1');
    zOrder(doc, 's1', 'bg', 'backward'); // over → just under the flow layer
    expect(order()).toBe('e2,bg,title,body,g1,t,e1');
    zOrder(doc, 's1', 'bg', 'backward');
    expect(order()).toBe('bg,e2,title,body,g1,t,e1');
    expect(() => zOrder(doc, 's1', 'title', 'front')).toThrow(/pinned/);
  });

  it('re-orders a flow child with one key, and detaches one to pinned at its box', () => {
    const doc = deckOf(SLIDE);
    let writes = 0;
    const off = onUpdate(doc, () => writes++);
    reorderFlow(doc, 's1', 't', 'title');
    off();
    expect(writes).toBe(1);
    expect(ids(doc)).toEqual(['bg', 't', 'title', 'body', 'g1', 'e1', 'e2']);
    reorderFlow(doc, 's1', 't', null);
    expect(ids(doc)).toEqual(['bg', 'title', 'body', 'g1', 't', 'e1', 'e2']);
    detach(doc, 's1', 'body', { left: 128, top: 300.456, width: 600 });
    expect(ids(doc)).toEqual(['bg', 'title', 'g1', 't', 'e1', 'e2', 'body']);
    expect(deckFiles(doc)['project/slides/s1.html']).toContain('<p id="body" style="position:absolute; left:128px; top:300.46px; width:600px">Body</p>');
  });

  it('duplicates elements with fresh ids, a container with its children and a table with its cells', () => {
    const doc = deckOf(SLIDE);
    const copies = duplicateElements(doc, 's1', ['g1', 'in1', 'e1', 't'], { offset: 24 });
    expect([...copies.keys()]).toEqual(['g1', 'e1', 't']); // in1 goes with g1
    const slide = readSlide(doc, 's1');
    const top = slide.children.map((c) => c.id);
    expect(top.indexOf(copies.get('g1')!)).toBe(top.indexOf('g1') + 1);
    expect(top.at(-1)).toBe(copies.get('e1')); // a pinned copy at the front
    const g1copy = slide.children.find((c) => c.id === copies.get('g1'))!;
    expect(g1copy.children.map((c) => c.text)).toEqual(slide.children.find((c) => c.id === 'g1')!.children.map((c) => c.text));
    expect(g1copy.children.every((c) => !['in1', 'in2'].includes(c.id))).toBe(true);
    expect(slide.children.find((c) => c.id === copies.get('e1'))!.style).toMatchObject({ left: '124px', top: '324px' });
    const file = deckFiles(doc)['project/slides/s1.html']!;
    expect(file.match(/<th>A<\/th>/g)).toHaveLength(2);
    expect(loadSlide(file).ok).toBe(true);
  });

  it('inserts, moves and deletes slides with one transaction each', () => {
    const doc = deckOf(SLIDE);
    expect(updatesOf(doc, () => insertSlide(doc, load('<section id="new"><h1 id="h">New</h1></section>'), null))).toBe(1);
    expect(slideOrder(doc)).toEqual(['new', 's1']);
    insertSlide(doc, load('<section id="last"></section>'), 's1');
    expect(slideOrder(doc)).toEqual(['new', 's1', 'last']);
    expect(() => insertSlide(doc, load('<section id="last"></section>'), null)).toThrow(/already/);
    moveSlide(doc, 'new', 'last');
    expect(slideOrder(doc)).toEqual(['s1', 'last', 'new']);
    deleteSlide(doc, 's1');
    expect(slideOrder(doc)).toEqual(['last', 'new']);
  });
});
