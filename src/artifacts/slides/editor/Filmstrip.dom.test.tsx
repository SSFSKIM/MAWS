// W1 (tech debt, 2026-10-19): a keyboard reorder of the filmstrip as assistive technology hears it, under happy-dom with
// each thumbnail given a box down the strip (happy-dom lays nothing out): the slide by its position and title, an
// untitled one by its position, the position it moves to, and never an internal id.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newDoc, transact, type Doc } from '../../yjs';
import { importSlide, slideOrder, writeDeckKeys } from '../model';
import { loadSlide } from '../parse';
import { DeckEditor } from './DeckEditor';
import { DeckSession } from './session';

const SLIDES: [string, string][] = [
  ['s-open', '<h2 id="t" style="font-size:64px">Opening</h2>'],
  ['s-plan', '<h2 id="t" style="font-size:64px">Plan</h2>'],
  ['s-blank', ''],
  ['s-close', '<h2 id="t" style="font-size:64px">Close</h2>'],
];

function deck(): Doc {
  const doc = newDoc();
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'Q3', order: SLIDES.map(([id]) => id) });
    SLIDES.forEach(([id, body], i) => {
      const l = loadSlide(`<section id="${id}" style="background:#ffffff">${body}</section>`);
      if (!l.ok) throw new Error('fixture');
      importSlide(doc, l.slide, `a${i}`);
    });
  });
  return doc;
}

// each thumbnail a 160 × 90 box, 100 px below the one before it, so the keyboard sensor finds its neighbours
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const thumb = this.closest<HTMLElement>('[data-slide-thumb]');
    const i = thumb ? [...thumb.closest('ol')!.querySelectorAll('[data-slide-thumb]')].indexOf(thumb) : -1;
    const top = i < 0 ? 0 : i * 100;
    const [width, height] = i < 0 ? [0, 0] : [160, 90];
    return { x: 0, y: top, left: 0, top, width, height, right: width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount() {
  const doc = deck();
  const utils = render(<DeckEditor session={new DeckSession(doc)} assetUrl={() => null} system={null} readOnly={false} />);
  const thumb = (n: number) => utils.container.querySelectorAll<HTMLElement>('[data-slide-thumb] .deck-thumb-button')[n - 1]!;
  return { doc, thumb };
}
/** What the drag's live region says now. */
const heard = () => document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '';
/** A key as the keyboard sensor reads it (by code), once its listeners are attached (a tick after the pick-up). */
async function key(code: string, target: Element | Document = document) {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  act(() => void fireEvent.keyDown(target, { code, key: code === 'Space' ? ' ' : code }));
}

describe('the filmstrip’s reorder, as assistive technology hears it', () => {
  it('names the slide by position and title and the position it moves to, then moves it there', async () => {
    const { doc, thumb } = mount();
    const said: string[] = [];
    await key('Space', thumb(2));
    said.push(heard());
    await key('ArrowDown');
    said.push(heard());
    await key('Space');
    said.push(heard());
    expect(said).toEqual(['Slide 2, Plan, picked up.', 'Slide 2, Plan, moved to position 3.', 'Slide 2, Plan, dropped at position 3.']);
    expect(slideOrder(doc)).toEqual(['s-open', 's-blank', 's-plan', 's-close']);
    for (const s of said) for (const [id] of SLIDES) expect(s).not.toContain(id);
  });

  it('names an untitled slide by its position alone, and says where a cancelled move leaves it', async () => {
    const { doc, thumb } = mount();
    await key('Space', thumb(3));
    expect(heard()).toBe('Slide 3, picked up.');
    await key('ArrowUp');
    expect(heard()).toBe('Slide 3, moved to position 2.');
    await key('Escape');
    expect(heard()).toBe('Slide 3, move cancelled, back at position 3.');
    expect(slideOrder(doc)).toEqual(SLIDES.map(([id]) => id));
  });
});
