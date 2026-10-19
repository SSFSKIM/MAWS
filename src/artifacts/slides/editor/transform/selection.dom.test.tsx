// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer"): what a click, shift-click,
// double-click, Escape, Tab, ⌘A and a marquee select on a slide's tree. Pure; named .dom.test.tsx so the web project
// typechecks it (M4's Decision Log 17(h)).
import { describe, expect, it } from 'vitest';
import { newDoc, transact } from '../../../yjs';
import { importSlide, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { drill, escapeUp, marquee, pick, selectAll, slideTree, tabNext } from './selection';

const SLIDE = `<section id="s" style="background:#ffffff; padding:128px">
<h2 id="title" style="font-size:64px">Title</h2>
<div id="card" style="padding:32px; background:#eeeeee"><h3 id="ct" style="font-size:44px">Card</h3><p id="cp" style="font-size:28px">Body</p></div>
<div id="badge" style="position:absolute; left:100px; top:100px; width:100px; height:100px; background:#ff0000"></div>
</section>`;
function tree() {
  const doc = newDoc();
  const l = loadSlide(SLIDE);
  if (!l.ok) throw new Error('fixture');
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ['s'] });
    importSlide(doc, l.slide, 'a0');
  });
  return slideTree(doc, 's');
}

describe('picking', () => {
  it('a click picks the slide’s own child under the pointer; ⌘-click the deepest', () => {
    const t = tree();
    expect(pick(t, ['ct', 'card'], [])).toEqual({ target: 'card', selection: ['card'] });
    expect(pick(t, ['ct', 'card'], [], { deep: true }).selection).toEqual(['ct']);
    expect(pick(t, [], ['card'])).toEqual({ target: null, selection: [] });
  });

  it('a click inside the selection keeps it (a multi-selection drags together)', () => {
    const t = tree();
    expect(pick(t, ['cp', 'card'], ['title', 'card'])).toEqual({ target: 'card', selection: ['title', 'card'] });
  });

  it('a click picks at the selection’s level once inside a container', () => {
    const t = tree();
    expect(pick(t, ['cp', 'card'], ['ct']).selection).toEqual(['cp']);
    expect(pick(t, ['title'], ['ct']).selection).toEqual(['title']); // outside the card: the slide's level
  });

  it('shift adds and removes siblings; a pick at another level replaces', () => {
    const t = tree();
    expect(pick(t, ['badge'], ['title'], { toggle: true }).selection).toEqual(['title', 'badge']);
    expect(pick(t, ['title'], ['title', 'badge'], { toggle: true }).selection).toEqual(['badge']);
    expect(pick(t, ['ct', 'card'], ['cp'], { toggle: true }).selection).toEqual(['cp', 'ct']);
  });
});

describe('the keyboard and double-click', () => {
  it('double-click goes into a container, and edits a text element', () => {
    const t = tree();
    expect(drill(t, ['cp', 'card'], ['card'])).toEqual(['cp']);
    expect(drill(t, ['title'], ['title'])).toBe('edit');
    expect(drill(t, ['title'], ['card'])).toBeNull();
  });

  it('Escape goes up a level, then clears', () => {
    const t = tree();
    expect(escapeUp(t, ['cp'])).toEqual(['card']);
    expect(escapeUp(t, ['card'])).toEqual([]);
  });

  // P3-F (scalpel-4#1): past the level's last element (before its first) Tab has no next, so the keys leave the stage
  it('Tab walks the level’s elements in paint order, with no next past either end; ⌘A takes them all', () => {
    const t = tree();
    expect(tabNext(t, [], false)).toEqual(['title']);
    expect(tabNext(t, [], true)).toEqual(['badge']);
    expect(tabNext(t, ['title'], false)).toEqual(['card']);
    expect(tabNext(t, ['badge'], false)).toBeNull();
    expect(tabNext(t, ['title'], true)).toBeNull();
    expect(tabNext(t, ['ct'], false)).toEqual(['cp']);
    expect(tabNext(t, ['cp'], false)).toBeNull();
    expect(selectAll(t, ['ct'])).toEqual(['ct', 'cp']);
  });

  it('a marquee takes the slide’s children it touches', () => {
    const t = tree();
    const bounds = new Map([
      ['title', { x: 128, y: 128, w: 600, h: 80 }],
      ['card', { x: 128, y: 240, w: 600, h: 200 }],
      ['badge', { x: 100, y: 100, w: 100, h: 100 }],
    ]);
    expect(marquee(t, bounds, { x: 0, y: 0, w: 150, h: 150 })).toEqual(['title', 'badge']);
  });
});
