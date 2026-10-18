// P3-E1 M3: a board frame's move and resize gestures, pure: whole-pixel frames, snapping to sibling boards' edges,
// centres and equal gaps within six screen pixels at the zoom, ⌘ to place freely, and the model's cap refused by name
// (never clamped).
import { describe, expect, it } from 'vitest';
import { movedFrame, resizedFrame } from './board-gestures';

const phone = { x: 0, y: 0, w: 390, h: 844 };
const desktop = { x: 600, y: 0, w: 1440, h: 1024 };

describe('a board moved', () => {
  it('moves by the world delta, rounded to whole pixels, with no guide when nothing is near', () => {
    expect(movedFrame(phone, { x: 100.4, y: 2000.6 }, [], 1, true)).toEqual({ frame: { x: 100, y: 2001, w: 390, h: 844 }, guides: [] });
  });

  it('snaps an edge to a sibling’s edge within 6 screen px at the zoom, with its guide', () => {
    // phone's right edge 4 world px short of the desktop's left edge (zoom 1: within 6)
    const moved = movedFrame(phone, { x: 600 - 390 - 4, y: 300 }, [desktop], 1, true);
    expect(moved.frame.x).toBe(600 - 390);
    expect(moved.guides.some((g) => g.axis === 'x' && g.at === 600 && g.kind === 'edge')).toBe(true);
    // at 10 % the same 4 world px is 0.4 screen px: still snapped; 100 world px is 10 screen px: not
    expect(movedFrame(phone, { x: 600 - 390 - 4, y: 300 }, [desktop], 0.1, true).frame.x).toBe(600 - 390);
    expect(movedFrame(phone, { x: 600 - 390 - 100, y: 3000 }, [desktop], 1, true).frame.x).toBe(600 - 390 - 100);
  });

  it('snaps centres to centres', () => {
    const moved = movedFrame(phone, { x: 3000, y: 512 - 422 + 3 }, [desktop], 1, true);
    expect(moved.frame.y).toBe(512 - 422); // centre on the desktop's 512
    expect(moved.guides.some((g) => g.axis === 'y' && g.at === 512 && g.kind === 'centre')).toBe(true);
  });

  it('snaps to an equal gap between siblings in a row', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    const b = { x: 200, y: 0, w: 100, h: 100 };
    const moving = { x: 1000, y: 0, w: 100, h: 100 };
    // the gap a→b is 100: placed after b at 400, here dropped at 402
    const moved = movedFrame(moving, { x: 402 - 1000, y: 0 }, [a, b], 1, true);
    expect(moved.frame.x).toBe(400);
    expect(moved.guides.some((g) => g.kind === 'gap')).toBe(true);
  });

  it('places freely with snapping off (⌘)', () => {
    expect(movedFrame(phone, { x: 600 - 390 - 4, y: 0 }, [desktop], 1, false).frame.x).toBe(600 - 390 - 4);
  });
});

describe('a board resized', () => {
  it('moves only the dragged edges', () => {
    expect(resizedFrame('p', phone, 'e', { x: 10, y: 99 }, [], 1, true)).toEqual({ frame: { x: 0, y: 0, w: 400, h: 844 }, guides: [], problems: [] });
    expect(resizedFrame('p', phone, 'nw', { x: 10, y: 20 }, [], 1, true).frame).toEqual({ x: 10, y: 20, w: 380, h: 824 });
    expect(resizedFrame('p', phone, 's', { x: 50, y: -44 }, [], 1, true).frame).toEqual({ x: 0, y: 0, w: 390, h: 800 });
  });

  it('snaps a dragged edge to a sibling’s edge', () => {
    const r = resizedFrame('p', phone, 's', { x: 0, y: 1024 - 844 - 3 }, [desktop], 1, true);
    expect(r.frame.h).toBe(1024);
    expect(r.guides.length).toBeGreaterThan(0);
  });

  it('keeps at least one pixel a side', () => {
    expect(resizedFrame('p', phone, 'w', { x: 1000, y: 0 }, [], 1, true).frame).toEqual({ x: 389, y: 0, w: 1, h: 844 });
  });

  it('names the cap it would pass, the frame unchanged from the request (never clamped)', () => {
    const tall = { x: 0, y: 0, w: 1080, h: 16_000 };
    const over = resizedFrame('poster', tall, 's', { x: 0, y: 1000 }, [], 1, true);
    expect(over.frame.h).toBe(17_000);
    expect(over.problems).toEqual(['board poster: h is 17000 px (over 16384 px a side)']);
    const wide = resizedFrame('poster', { x: 0, y: 0, w: 8192, h: 8192 }, 'e', { x: 10, y: 0 }, [], 1, true);
    expect(wide.problems[0]).toMatch(/^board poster: 8202×8192 is \d+ px \(over 67108864 px\)$/);
  });
});
