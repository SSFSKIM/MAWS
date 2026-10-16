// P3-C M4 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Filmstrip"): the filmstrip's slide gestures on the
// model, one transaction each: remove (the deck's cover and sections follow), duplicate, sections, blank slides with ids
// two replicas never both mint.
import { describe, expect, it } from 'vitest';
import { adoptClientId, newDoc, onUpdate, transact, type Doc } from '../yjs';
import { DECK_LIMITS } from './deck';
import { deckFiles, importSlide, insertSlide, readDeckJson, readSlide, setNotes, slideOrder, writeDeckKeys } from './model';
import { ID_RE, loadSlide } from './parse';
import { addSlide, blankSlide, duplicateSlide, mintSectionKey, mintSlideId, removeSlide, setDeckOverride, setSection, slideRoom } from './writers';
import * as Y from '../yjs/slides';

function deckOf(ids: string[], extra: Record<string, unknown> = {}): Doc {
  const doc = newDoc();
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', cover: ids[0], order: ids, ...extra });
    ids.forEach((id, i) => {
      const l = loadSlide(`<section id="${id}" style="background:#ffffff"><p id="p" style="font-size:32px">${id}</p><aside>Notes of ${id}</aside></section>`);
      if (!l.ok) throw new Error('fixture');
      importSlide(doc, l.slide, `a${i}`);
    });
  });
  return doc;
}
function updatesOf(doc: Doc, edit: () => void): number {
  let n = 0;
  const off = onUpdate(doc, () => n++);
  edit();
  off();
  return n;
}

describe('removing a slide', () => {
  it('moves the cover and a section’s start to the next slide, in one transaction', () => {
    const doc = deckOf(['a', 'b', 'c'], { sections: { s1: { description: 'Opening', start: 'a' }, s2: { description: 'Middle', start: 'c' } } });
    expect(updatesOf(doc, () => removeSlide(doc, 'a'))).toBe(1);
    expect(slideOrder(doc)).toEqual(['b', 'c']);
    const deck = readDeckJson(doc);
    expect(deck.cover).toBe('b');
    expect(deck.sections).toEqual({ s1: { description: 'Opening', start: 'b' }, s2: { description: 'Middle', start: 'c' } });
  });

  it('leaves a section whose next slide starts another one empty, before that slide; drops one with no slide after it', () => {
    const doc = deckOf(['a', 'b', 'c'], { sections: { s1: { description: 'One', start: 'b' }, s2: { description: 'Two', start: 'c' } } });
    removeSlide(doc, 'b');
    expect(readDeckJson(doc).sections).toEqual({ s1: { description: 'One', before: 'c' }, s2: { description: 'Two', start: 'c' } });
    removeSlide(doc, 'c');
    expect(readDeckJson(doc).sections).toEqual({});
    expect(readDeckJson(doc).cover).toBe('a');
  });

  it('a deck’s last slide removed leaves no cover', () => {
    const doc = deckOf(['a']);
    removeSlide(doc, 'a');
    expect(readDeckJson(doc).cover).toBeUndefined();
  });
});

describe('the other slide writers', () => {
  it('duplicates a slide after it under a new id, content and notes kept, in one transaction', () => {
    const doc = deckOf(['a', 'b']);
    setNotes(doc, 'a', 'Say it twice');
    expect(updatesOf(doc, () => duplicateSlide(doc, 'a', 'a2'))).toBe(1);
    expect(slideOrder(doc)).toEqual(['a', 'a2', 'b']);
    expect(readSlide(doc, 'a2')).toEqual({ ...readSlide(doc, 'a'), id: 'a2' });
    expect(deckFiles(doc)['project/slides/a2.html']).toContain('<section id="a2"');
  });

  it('refuses to duplicate a held slide (its content is the last good one, not the file)', () => {
    const doc = deckOf(['a']);
    Y.setSlideKey(doc, 'a', 'held', { source: '<section id="a"><bad></bad></section>', reasons: ['an unknown tag'] });
    expect(() => duplicateSlide(doc, 'a', 'a2')).toThrow(/held/);
  });

  it('adds, renames and removes a section, one entry each', () => {
    const doc = deckOf(['a', 'b']);
    expect(updatesOf(doc, () => setSection(doc, 'intro', { description: 'Intro', start: 'b' }))).toBe(1);
    setSection(doc, 'intro', { description: 'The opening', start: 'b' });
    expect(readDeckJson(doc).sections).toEqual({ intro: { description: 'The opening', start: 'b' } });
    setSection(doc, 'intro', null);
    expect(readDeckJson(doc).sections).toEqual({});
  });

  // fix wave 1, finding 2: hash4 of the clientID collided (1938 and 11610 both minted s1-dver)
  it('mints ids from the whole clientID and a counter the replica never reuses', () => {
    const one = deckOf(['a']);
    const two = deckOf(['a']);
    adoptClientId(one, 1938);
    adoptClientId(two, 11610);
    const c1 = (1938).toString(36);
    expect(mintSlideId(one)).toBe(`s${c1}-1`);
    expect(mintSlideId(two)).toBe(`s${(11610).toString(36)}-1`);
    expect(mintSectionKey(one)).toBe(`section${c1}-2`);
    // a removed slide never gives its id back, and an id the deck already holds is skipped
    const first = mintSlideId(one);
    insertSlide(one, blankSlide(first), 'a');
    removeSlide(one, first);
    expect(mintSlideId(one)).toBe(`s${c1}-4`);
    insertSlide(one, blankSlide(`s${c1}-5`), 'a');
    expect(mintSlideId(one)).toBe(`s${c1}-6`);
    // the largest clientID still mints a valid id
    const big = newDoc();
    adoptClientId(big, Number.MAX_SAFE_INTEGER);
    expect(ID_RE.test(mintSlideId(big))).toBe(true);
  });

  // fix wave 1, finding 4: a deck holds at most 500 slides; adding and duplicating refuse past it
  it('refuses to add or duplicate a slide past the deck’s 500', () => {
    const doc = deckOf(['a']);
    transact(doc, () => {
      for (let i = 1; i < DECK_LIMITS.slides; i++) importSlide(doc, blankSlide(`x${i}`), `b${String(i).padStart(4, '0')}`);
    });
    expect(slideRoom(doc)).toBe(0);
    expect(() => addSlide(doc, blankSlide('over'), 'a')).toThrow(/500/);
    expect(() => duplicateSlide(doc, 'a', 'a2')).toThrow(/500/);
    expect(slideOrder(doc)).toHaveLength(DECK_LIMITS.slides);
    removeSlide(doc, 'x1');
    addSlide(doc, blankSlide('fits'), 'a');
    expect(slideOrder(doc)).toContain('fits');
  });

  it('sets and removes one design-system override of the deck', () => {
    const doc = deckOf(['a']);
    expect(updatesOf(doc, () => setDeckOverride(doc, '--ds-line', '8px'))).toBe(1);
    expect(readDeckJson(doc).dsOverrides).toEqual({ '--ds-line': '8px' });
    setDeckOverride(doc, '--ds-line', null);
    expect(readDeckJson(doc).dsOverrides).toEqual({});
  });

  it('a blank slide loads, in the design system’s ground with the 128 px margins', () => {
    const ir = blankSlide('fresh');
    expect(ir.id).toBe('fresh');
    expect(ir.children).toEqual([]);
    expect(ir.style).toMatchObject({ background: 'var(--ds-color-bg, #ffffff)', padding: '128px' });
  });
});
