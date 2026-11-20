// Board ticket 789: the clicked turn line keeps its place on screen while the work above it opens or folds, also when
// that work pushes it out of the list's window for a frame, until its stop is called.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepInPlace } from './keep-in-place';

afterEach(() => { document.body.innerHTML = ''; });

function scene() {
  const scroller = document.createElement('div');
  const row = document.createElement('div');
  scroller.append(row);
  document.body.append(scroller);
  let offset = 900;
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => offset, set: (value: number) => { offset = value; } });
  let top = 300; // the row's place in the viewport, before the scroll's correction
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => ({ top: top - (offset - 900) }) as DOMRect);
  vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(() => ({ top: 0 }) as DOMRect);
  const frames: (() => void)[] = [];
  const frame = (step: () => void) => frames.push(step);
  const scrolls: number[] = [];
  const scrollTo = (value: number) => { scrolls.push(value); offset = value; };
  return { scroller, row, frames, frame, scrolls, scrollTo, grow: (by: number) => { top += by; }, get offset() { return offset; } };
}

describe('keepInPlace', () => {
  it('scrolls by however far the mounted row moved', () => {
    const s = scene();
    keepInPlace(s.scroller, 500, { element: () => s.row, frame: s.frame, scrollTo: s.scrollTo });
    s.grow(240);
    s.frames.shift()!();
    expect(s.scrolls).toEqual([1140]);
    expect(s.row.getBoundingClientRect().top).toBe(300);
  });

  it('places a row the list no longer mounts by the list’s offset for it, and refines once it is mounted again', () => {
    const s = scene();
    let mounted = true;
    let start = 1200; // the row's offset in the list's content: 300 below the scroll's top
    keepInPlace(s.scroller, 500, { element: () => (mounted ? s.row : null), start: () => start, frame: s.frame, scrollTo: s.scrollTo });
    mounted = false;
    start = 3200; // the work that opened above it pushed it out of the window
    s.frames.shift()!();
    expect(s.scrolls).toEqual([2900]);
    mounted = true;
    s.grow(2000 + 16); // mounted again, 16 px off what the list's estimate put it at
    s.frames.shift()!();
    expect(s.scrolls).toEqual([2900, 2916]);
    expect(s.row.getBoundingClientRect().top).toBe(300);
  });

  it('its stop ends it: the list stops it at the reader’s own scroll input and before its own jumps', () => {
    const s = scene();
    const stop = keepInPlace(s.scroller, 500, { element: () => s.row, frame: s.frame, scrollTo: s.scrollTo });
    stop();
    s.grow(240);
    while (s.frames.length > 0) s.frames.shift()!();
    expect(s.scrolls).toEqual([]);
  });
});
