// @vitest-environment happy-dom
// A landing on a tail card (`land-on-card.ts`) with the list under the suite's control: the card is mounted only when
// the suite says the list has drawn it. Landing moves the list to the card and takes it into view and focus once it is
// drawn — unless the reader moved first: their wheel, touch, press or keys on the list, or focus taken elsewhere, while
// the card was still on its way, leave them where they went. The list's own scrolling is never the reader's.
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import { useLandOnCard } from './land-on-card';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

const frames = async (n: number) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};

/** The session view: a list scroller with no card mounted (the reader is far up), and a composer outside the list. */
function scene() {
  const root = document.createElement('section');
  const scroller = document.createElement('div');
  scroller.setAttribute('data-transcript-scroller', '');
  const composer = document.createElement('textarea');
  root.append(scroller, composer);
  document.body.append(root);
  const handle = { scrollElement: scroller, following: false, scrollToEnd: vi.fn(), scrollToIndex: vi.fn() } as unknown as TranscriptListHandle;
  const card = document.createElement('div');
  card.setAttribute('data-tail-request', 'toolu_far');
  card.tabIndex = -1;
  card.scrollIntoView = vi.fn();
  renderHook(() => useLandOnCard(root, { current: handle }, { current: (id: string) => (id === 'row:far' ? 240 : -1) }, { request: 'toolu_far', row: 'row:far' }));
  /** The list draws the card, as it does a frame or more after the jump. */
  const mountCard = () => scroller.append(card);
  return { root, scroller, composer, handle, card, mountCard };
}

describe('a landing on a tail card', () => {
  it('moves the list to the card, then takes it into view and focus once it is drawn; the list’s own scrolls are not the reader’s', async () => {
    const s = scene();
    await frames(2);
    expect(s.handle.scrollToIndex).toHaveBeenCalledWith(240, 'center');
    s.scroller.dispatchEvent(new Event('scroll')); // the list's jump, with no input of the reader's before it
    s.mountCard();
    await frames(2);
    expect(s.card.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    expect(document.activeElement).toBe(s.card);
  });

  it('a reader who wheels before the card is drawn stays where they went', async () => {
    const s = scene();
    await frames(2);
    expect(s.handle.scrollToIndex).toHaveBeenCalled();
    s.scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }));
    s.mountCard();
    await frames(3);
    expect(s.card.scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(s.card);
  });

  it('a reader who moves focus elsewhere before the card is drawn keeps it there', async () => {
    const s = scene();
    await frames(2);
    s.composer.focus();
    s.mountCard();
    await frames(3);
    expect(s.card.scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(s.composer);
  });
});
