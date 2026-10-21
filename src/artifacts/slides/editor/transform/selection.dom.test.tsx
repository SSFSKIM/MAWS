// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer"): what a click, shift-click,
// double-click, Escape, Tab, ⌘A and a marquee select on a slide's tree. Pure; named .dom.test.tsx so the web project
// typechecks it (M4's Decision Log 17(h)).
import { describe, expect, it } from 'vitest';
import { newDoc, transact } from '../../../yjs';
import { importSlide, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { cellAt, cellGrid, cellRange, cellsTable, childAt, deepestText, drill, escapeUp, isTextTarget, marquee, nextCell, pick, selectAll, slideTree, tableOf, tabNext } from './selection';

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

// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D2, D5, D8): the state machine's pure reads. A
// table's cells take ids the loader mints from their row's (`r1/<hash>.0`), so the cases read them from the grid.
describe('P4-B2: text targets, the deepest text, a container’s child and table cells', () => {
  const TABLE = `<section id="s" style="background:#ffffff; padding:128px">
<div id="g" data-group="" style="position:absolute; left:100px; top:100px; width:600px; height:300px"><h2 id="gh" style="position:absolute; left:0px; top:0px; width:600px; font-size:48px">Grouped</h2><div id="g2" data-group="" style="position:absolute; left:0px; top:100px; width:600px; height:100px"><p id="deep" style="position:absolute; left:0px; top:0px; width:600px; font-size:32px">Deep</p></div></div>
<table id="t" style="position:absolute; left:800px; top:100px; width:600px; font-size:24px"><tr id="r1"><th>A</th><th>B</th><th>C</th></tr><tr id="r2"><td>1</td><td>2</td><td>3</td></tr></table>
<div id="cover" style="position:absolute; left:0px; top:0px; width:1920px; height:1080px; background:#000000"></div>
</section>`;
  function tableTree() {
    const doc = newDoc();
    const l = loadSlide(TABLE);
    if (!l.ok) throw new Error(l.held.reasons.join('; '));
    transact(doc, () => {
      writeDeckKeys(doc, { v: 4, title: 'T', order: ['s'] });
      importSlide(doc, l.slide, 'a0');
    });
    const t = slideTree(doc, 's');
    const [[a1, b1, c1], [a2, b2, c2]] = cellGrid(t, 't') as [string[], string[]];
    return { t, a1: a1!, b1: b1!, c1: c1!, a2: a2!, b2: b2!, c2: c2! };
  }

  it('a text target is the element itself (D2): a heading or a cell, never a group, a row or a table', () => {
    const { t, a1, b2 } = tableTree();
    expect(['gh', 'deep', a1, b2].map((id) => isTextTarget(t, id))).toEqual([true, true, true, true]);
    expect(['g', 'g2', 't', 'r1'].map((id) => isTextTarget(t, id))).toEqual([false, false, false, false]);
  });

  it('the deepest text among the hits whatever the scope (T5); the child one level inside a container (T3)', () => {
    const { t, b2 } = tableTree();
    expect(deepestText(t, ['deep', 'g2', 'g'])).toBe('deep');
    expect(deepestText(t, [b2, 'r2', 't'])).toBe(b2);
    expect(deepestText(t, ['g'])).toBeNull();
    expect(childAt(t, ['deep', 'g2', 'g'], 'g')).toBe('g2');
    expect(childAt(t, ['deep', 'g2', 'g'], 'g2')).toBe('deep');
    expect(childAt(t, ['gh', 'g'], 't')).toBeNull();
  });

  it('what a press reaches past the scope is the frontmost element’s, never a covered one’s (the M1 review’s P2)', () => {
    const { t, b2 } = tableTree();
    // an opaque cover painted over the heading and the table: the hits are the whole stack, front first
    expect(deepestText(t, ['cover', 'deep', 'g2', 'g'])).toBeNull();
    expect(childAt(t, ['cover', 'deep', 'g2', 'g'], 'g')).toBeNull();
    expect(cellAt(t, ['cover', b2, 'r2', 't'], 't')).toBeNull();
    expect(cellAt(t, [b2, 'r2', 't', 'cover'], 't')).toBe(b2);
  });

  it('a cell’s table, the grid, a range between two cells, the next and previous cell, a selection of cells (D8, T16)', () => {
    const { t, a1, b1, c1, a2, b2, c2 } = tableTree();
    expect(tableOf(t, b2)).toBe('t');
    expect(tableOf(t, 'gh')).toBeNull();
    expect(cellGrid(t, 't').map((r) => r.length)).toEqual([3, 3]);
    expect(cellRange(t, 't', b2, a1)).toEqual([a1, b1, a2, b2]);
    expect(cellRange(t, 't', c1, c1)).toEqual([c1]);
    expect(nextCell(t, c1, false)).toBe(a2);
    expect(nextCell(t, a2, true)).toBe(c1);
    expect(nextCell(t, c2, false)).toBeNull();
    expect(nextCell(t, a1, true)).toBeNull();
    expect(cellsTable(t, [a1, b1])).toBe('t');
    expect(cellsTable(t, [a1])).toBeNull();
    expect(cellsTable(t, [a1, 'gh'])).toBeNull();
  });
});
