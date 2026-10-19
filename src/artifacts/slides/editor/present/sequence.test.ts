// P3-C M6 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D13): the show's order: the visible slides, each slide's
// builds as clicks of beats (an `auto` build follows the one before it without a click; builds of one order number are one
// click), and the moves next, back, first and last through them.
import { describe, expect, it } from 'vitest';
import { newDoc, transact, type Doc } from '../../../yjs';
import { importSlide, slideOrder, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { removeSlide } from '../../writers';
import { firstPosition, hiddenAt, lastPosition, nextPosition, prevPosition, settlePosition, showSlides, slideSteps, startPosition } from './sequence';

function deckOf(files: Record<string, string>): Doc {
  const doc = newDoc();
  const ids = Object.keys(files);
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ids });
    ids.forEach((id, i) => {
      const loaded = loadSlide(files[id]!, { fileId: id });
      if (!loaded.ok) throw new Error(`fixture ${id}: ${loaded.held.reasons.join('; ')}`);
      importSlide(doc, loaded.slide, `a${i}`);
    });
  });
  return doc;
}

const pin = (id: string, attrs = '') => `<p id="${id}" ${attrs} style="position:absolute; left:100px; top:100px; width:400px; font-size:40px">${id}</p>`;
const DECK = {
  intro: `<section id="intro" data-transition="fade"><h1 id="t" style="font-size:96px">Intro</h1></section>`,
  builds: `<section id="builds">${pin('a', 'data-build-in="fade"')}${pin('b', 'data-build-in="rise 2"')}${pin('c', 'data-build-in="pop 2"')}${pin('d', 'data-build-in="drop auto"')}${pin('e', 'data-build-out="fade 3"')}</section>`,
  secret: `<section id="secret" hidden><p id="x" style="font-size:40px">Hidden</p></section>`,
  entry: `<section id="entry" data-transition="push">${pin('auto1', 'data-build-in="fade auto"')}${pin('click1', 'data-build-in="left"')}</section>`,
};

describe('the show’s order', () => {
  it('shows the slides in deck order without the hidden ones', () => {
    expect(showSlides(deckOf(DECK))).toEqual(['intro', 'builds', 'entry']);
  });

  it('groups a slide’s builds into clicks: one order number one click, an auto build after the one before it', () => {
    const steps = slideSteps(deckOf(DECK), 'builds');
    // sorted by order (unordered ones after, in the slide's order): b, c (2) | e (3) | a, then d (auto after a)
    expect(steps.groups.map((group) => group.map((beat) => beat.map((e) => `${e.id}:${e.kind}:${e.effect}`)))).toEqual([
      [],
      [['b:in:rise', 'c:in:pop']],
      [['e:out:fade']],
      [['a:in:fade'], ['d:in:drop']],
    ]);
    expect(steps.clicks).toBe(3);
    expect(steps.transition).toBeNull();
    expect(slideSteps(deckOf(DECK), 'intro')).toMatchObject({ transition: 'fade', clicks: 0, groups: [[]] });
  });

  // fix wave 1 (finding 4): an auto build inside a numbered click stays in that click
  it('keeps one order number one click with an auto build among it, the auto a beat after the click’s own', () => {
    const doc = deckOf({ one: `<section id="one">${pin('x', 'data-build-in="fade 1"')}${pin('y', 'data-build-in="rise 1 auto"')}${pin('z', 'data-build-in="pop 1"')}${pin('w', 'data-build-in="scale 2 auto"')}</section>` });
    const steps = slideSteps(doc, 'one');
    expect(steps.groups.map((g) => g.map((beat) => beat.map((e) => e.id)))).toEqual([[], [['x', 'z'], ['y'], ['w']]]);
    expect(steps.clicks).toBe(1);
  });

  it('plays an auto build before the first click on the slide’s entry', () => {
    const steps = slideSteps(deckOf(DECK), 'entry');
    expect(steps.groups.map((g) => g.map((beat) => beat.map((e) => e.id)))).toEqual([[['auto1']], [['click1']]]);
    expect(steps.transition).toBe('push');
  });

  it('hides what has not built in yet and what has built out', () => {
    const steps = slideSteps(deckOf(DECK), 'builds');
    expect([...hiddenAt(steps, 0)].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...hiddenAt(steps, 1)].sort()).toEqual(['a', 'd']);
    expect([...hiddenAt(steps, 2)].sort()).toEqual(['a', 'd', 'e']);
    expect([...hiddenAt(steps, 3)].sort()).toEqual(['e']);
  });

  it('steps through builds and slides, skipping the hidden slide, back to the previous slide fully built', () => {
    const doc = deckOf(DECK);
    const walk: string[] = [];
    let at = firstPosition(doc);
    while (at) {
      walk.push(`${at.slideId}/${at.build}`);
      at = nextPosition(doc, at);
    }
    expect(walk).toEqual(['intro/0', 'builds/0', 'builds/1', 'builds/2', 'builds/3', 'entry/0', 'entry/1']);
    expect(prevPosition(doc, { slideId: 'entry', build: 0 })).toEqual({ slideId: 'builds', build: 3 });
    expect(prevPosition(doc, { slideId: 'intro', build: 0 })).toBeNull();
    expect(lastPosition(doc)).toEqual({ slideId: 'entry', build: 1 });
  });

  it('starts at the slide asked for, or the next visible one when it is hidden, else the first', () => {
    const doc = deckOf(DECK);
    expect(startPosition(doc, 'builds')).toEqual({ slideId: 'builds', build: 0 });
    expect(startPosition(doc, 'secret')).toEqual({ slideId: 'entry', build: 0 });
    expect(startPosition(doc, 'gone')).toEqual({ slideId: 'intro', build: 0 });
    expect(startPosition(deckOf({ only: '<section id="only" hidden></section>' }), null)).toBeNull();
  });

  it('keeps a position whose slide was removed or whose builds shrank in the show', () => {
    const doc = deckOf(DECK);
    expect(nextPosition(doc, { slideId: 'builds', build: 9 })).toEqual({ slideId: 'entry', build: 0 });
  });

  // P3-F slide-editor scalpel-3#2: a removed slide mid-deck gives way to the show's next slide after it in the deck as last
  // seen (here not the last slide), the last one to the slide before it; a slide never seen stands at the show's start
  it('settles a position whose slide was removed on its neighbour in the deck as last seen', () => {
    const doc = deckOf({ ...DECK, close: `<section id="close"><p id="w" style="font-size:40px">Close</p></section>` });
    const seen = slideOrder(doc);
    removeSlide(doc, 'builds');
    expect(settlePosition(doc, { slideId: 'builds', build: 2 }, seen)).toEqual({ slideId: 'entry', build: 0 });
    removeSlide(doc, 'close');
    expect(settlePosition(doc, { slideId: 'close', build: 0 }, seen)).toEqual({ slideId: 'entry', build: 0 });
    expect(settlePosition(doc, { slideId: 'gone', build: 0 }, seen)).toEqual({ slideId: 'intro', build: 0 });
  });
});
