// P3-C M4 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Undo"): one deck-level undo stack per tab that
// undoes the owner's gestures and nothing else.
import { describe, expect, it } from 'vitest';
import { loadSlide } from '../slides/parse';
import { importSlide, readSlide, setNotes, setStyle, slideOrder, writeDeckKeys, deleteSlide } from '../slides/model';
import { applyV1, diffV1, newDoc, stateVector, transact, type Doc } from '.';
import { createDeckUndo } from './slides-undo';

function deck(): Doc {
  const doc = newDoc();
  const one = loadSlide('<section id="s1" style="background:#ffffff"><p id="p" style="font-size:32px">Hi</p></section>');
  const two = loadSlide('<section id="s2" style="background:#ffffff"><p id="q">Two</p></section>');
  if (!one.ok || !two.ok) throw new Error('fixture');
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ['s1', 's2'] });
    importSlide(doc, one.slide, 'a0');
    importSlide(doc, two.slide, 'a1');
  });
  return doc;
}
const size = (doc: Doc) => readSlide(doc, 's1').children[0]!.style['font-size'];

describe('the deck’s undo', () => {
  it('undoes and redoes one gesture per cut, a drag’s many writes as one step', () => {
    const doc = deck();
    const undo = createDeckUndo(doc);
    undo.cut();
    for (const n of [33, 34, 35]) setStyle(doc, 's1', 'p', { 'font-size': `${n}px` }, undo.origin); // a drag's frames
    undo.cut();
    setNotes(doc, 's1', 'Say hi', undo.origin);
    undo.cut();
    expect(undo.undo()).toBe(true);
    expect(readSlide(doc, 's1').notes).toBe('');
    expect(size(doc)).toBe('35px');
    expect(undo.undo()).toBe(true);
    expect(size(doc)).toBe('32px');
    expect(undo.canUndo()).toBe(false);
    expect(undo.redo()).toBe(true);
    expect(size(doc)).toBe('35px');
  });

  it('never undoes another origin’s writes, and a remote edit to other keys survives the owner’s undo', () => {
    const doc = deck();
    const remote = newDoc();
    applyV1(remote, diffV1(doc));
    const undo = createDeckUndo(doc);
    setStyle(doc, 's1', 'p', { 'font-size': '40px' }, 'agent'); // the host's or an agent's write, not the editor's
    expect(undo.canUndo()).toBe(false);
    undo.cut();
    setStyle(doc, 's1', 'p', { color: '#ff0000' }, undo.origin);
    setNotes(remote, 's2', 'Remote words');
    applyV1(doc, diffV1(remote, stateVector(doc)), 'remote');
    undo.undo();
    const style = readSlide(doc, 's1').children[0]!.style;
    expect(style.color).toBeUndefined();
    expect(style['font-size']).toBe('40px');
    expect(readSlide(doc, 's2').notes).toBe('Remote words');
  });

  it('brings a deleted slide back whole and announces stack changes; clear forgets both stacks', () => {
    const doc = deck();
    const undo = createDeckUndo(doc);
    let changes = 0;
    const off = undo.subscribe(() => changes++);
    undo.cut();
    deleteSlide(doc, 's1', undo.origin);
    expect(slideOrder(doc)).toEqual(['s2']);
    undo.undo();
    expect(slideOrder(doc)).toEqual(['s1', 's2']);
    expect(readSlide(doc, 's1').children.map((c) => c.id)).toEqual(['p']);
    expect(changes).toBeGreaterThanOrEqual(2);
    undo.clear();
    expect(undo.canUndo() || undo.canRedo()).toBe(false);
    off();
    undo.destroy();
  });
});
