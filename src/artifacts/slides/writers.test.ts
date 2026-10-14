// P3-C M4 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Filmstrip"): the filmstrip's slide gestures on the
// model, one transaction each: remove (the deck's cover and sections follow), duplicate, sections, blank slides with ids
// two replicas never both mint.
import { describe, expect, it } from 'vitest';
import { newDoc, onUpdate, transact, type Doc } from '../yjs';
import { deckFiles, importSlide, readDeckJson, readSlide, setNotes, slideOrder, writeDeckKeys } from './model';
import { ID_RE, loadSlide } from './parse';
import { blankSlide, duplicateSlide, mintSectionKey, mintSlideId, removeSlide, setSection } from './writers';
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

  it('mints slide ids the deck does not hold, distinct between two replicas', () => {
    const one = deckOf(['a']);
    const two = newDoc();
    const ids = new Set<string>();
    for (let k = 0; k < 20; k++) {
      const id = mintSlideId(one, ids);
      expect(ID_RE.test(id)).toBe(true);
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
    expect(mintSlideId(two)).not.toBe(mintSlideId(one));
  });

  it('mints a section key the outline does not hold', () => {
    const doc = deckOf(['a'], { sections: { section1: { description: 'x', start: 'a' } } });
    const key = mintSectionKey(doc);
    expect(key).toMatch(/^section\d+-[0-9a-z]{4}$/);
    setSection(doc, key, { description: 'y', start: 'a' });
    expect(mintSectionKey(doc)).not.toBe(key);
  });

  it('a blank slide loads, in the design system’s ground with the 128 px margins', () => {
    const ir = blankSlide('fresh');
    expect(ir.id).toBe('fresh');
    expect(ir.children).toEqual([]);
    expect(ir.style).toMatchObject({ background: 'var(--ds-color-bg, #ffffff)', padding: '128px' });
  });
});
