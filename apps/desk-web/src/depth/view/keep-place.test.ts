// @vitest-environment happy-dom
// The reader's place through an older page (`keep-place.ts`), with the list's geometry under the suite's control: a
// scroller at the viewport's top and one kept row whose drawn position the suite moves as the list would. The browser
// suite (`e2e/depth.spec.ts`, older rows) proves it against MAWS's real list; these pin the cases a fixture's short
// pages cannot reach.
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import { useKeepPlaceThroughOlderRows } from './keep-place';

afterEach(cleanup);

const KEPT = 'assistant:kept';
const rowsOf = (...ids: string[]) => ids.map((id) => ({ id })) as unknown as Row[];
const frames = async (n: number) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};

/** The list: a scroller holding the kept row 100 px below the viewport's top; `y` is where the list now draws it. */
function scene() {
  let y = 100;
  const scroller = document.createElement('div');
  const row = document.createElement('div');
  row.setAttribute('data-row-id', KEPT);
  scroller.append(row);
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 500 }) as DOMRect;
  row.getBoundingClientRect = () => ({ top: y, bottom: y + 50 }) as DOMRect;
  scroller.scrollBy = vi.fn((to: ScrollToOptions) => {
    y -= to.top ?? 0;
  }) as never;
  // An index jump draws the row a frame later, aligned at the top; two frames on, the rows above it measured, the list
  // aligns it at the top again (TanStack's reconcile scrolls again when its target moves).
  const scrollToIndex = vi.fn(() => {
    requestAnimationFrame(() => {
      y = 0;
      scroller.append(row);
      requestAnimationFrame(() => requestAnimationFrame(() => void (y = 0)));
    });
  });
  const handle = { scrollElement: scroller, following: false, scrollToEnd: vi.fn(), scrollToIndex } as unknown as TranscriptListHandle;
  const list = { current: handle };
  const initial = rowsOf('time:turn:e1', KEPT);
  const view = renderHook(({ rows, loading }: { rows: Row[]; loading: boolean }) => useKeepPlaceThroughOlderRows(list, rows, loading), { initialProps: { rows: initial, loading: false } });
  return { view, initial, row, scroller, handle, at: () => y, moveTo: (to: number) => void (y = to) };
}

describe('the reader’s place through an older page', () => {
  it('the kept row returns to where the reader saw it when the page renames the row above it', () => {
    const s = scene();
    s.view.rerender({ rows: s.initial, loading: true });
    s.moveTo(400); // the list lost its anchor: the page's rows went in above the kept row
    s.view.rerender({ rows: rowsOf('time:turn:u1', 'user:u1', 'divider:turn:u1', KEPT), loading: false });
    expect(s.at()).toBe(100);
  });

  it('a live row drawn while the page is on its way does not spend the restoration', () => {
    const s = scene();
    s.view.rerender({ rows: s.initial, loading: true });
    const live = [...s.initial, ...rowsOf('text:live')];
    s.view.rerender({ rows: live, loading: true }); // beneath the reader: nothing moves
    expect(s.at()).toBe(100);
    s.moveTo(400);
    s.view.rerender({ rows: [...rowsOf('time:turn:u1', 'user:u1'), ...live.slice(1)], loading: false });
    expect(s.at()).toBe(100);
  });

  it('the answer and its rows in separate renders restore at the rows', () => {
    const s = scene();
    s.view.rerender({ rows: s.initial, loading: true });
    s.view.rerender({ rows: s.initial, loading: false }); // the controller answered; the store installs the page later
    s.moveTo(400);
    s.view.rerender({ rows: rowsOf('time:turn:u1', 'user:u1', KEPT), loading: false });
    expect(s.at()).toBe(100);
  });

  it('a page longer than the list draws jumps to the row by index and finishes the offset once it is drawn', async () => {
    const s = scene();
    s.view.rerender({ rows: s.initial, loading: true });
    s.row.remove(); // the page put the kept row beyond what the list renders
    const page = [...rowsOf(...Array.from({ length: 100 }, (_, i) => `user:older-${i}`), KEPT)];
    s.view.rerender({ rows: page, loading: false });
    expect(s.handle.scrollToIndex).toHaveBeenCalledWith(100, 'start');
    await frames(12);
    expect(s.at()).toBe(100);
  });

  it('a reader who scrolls while the offset is being finished keeps the place they scrolled to', async () => {
    const s = scene();
    s.view.rerender({ rows: s.initial, loading: true });
    s.row.remove();
    s.view.rerender({ rows: rowsOf(...Array.from({ length: 100 }, (_, i) => `user:older-${i}`), KEPT), loading: false });
    await frames(5); // drawn, realigned by the list, put back each time: the loop now waits for the offset to hold
    expect(s.at()).toBe(100);
    s.scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -40 }));
    s.moveTo(140); // the wheel's scroll moves the kept row down by 40 px
    s.scroller.dispatchEvent(new Event('scroll'));
    await frames(12);
    expect(s.at()).toBe(140);
  });

  it('the list’s own scroll events, which no reader raised, do not stop the correction', async () => {
    const s = scene();
    s.view.rerender({ rows: s.initial, loading: true });
    s.row.remove();
    s.view.rerender({ rows: rowsOf(...Array.from({ length: 100 }, (_, i) => `user:older-${i}`), KEPT), loading: false });
    await frames(5);
    s.moveTo(60); // the list scrolls again as it measures: a scroll event with no reader's input before it
    s.scroller.dispatchEvent(new Event('scroll'));
    await frames(12);
    expect(s.at()).toBe(100);
  });

  it('a touch begun while the page was on its way, and moving once the hold has begun, keeps the place it scrolls to', async () => {
    const s = scene();
    s.view.rerender({ rows: s.initial, loading: true });
    s.scroller.dispatchEvent(new Event('touchstart')); // under way before the answer: no hold yet to stop
    s.row.remove();
    s.view.rerender({ rows: rowsOf(...Array.from({ length: 100 }, (_, i) => `user:older-${i}`), KEPT), loading: false });
    await frames(3); // the hold has begun and put the row back
    expect(s.at()).toBe(100);
    s.scroller.dispatchEvent(new Event('touchmove'));
    s.moveTo(140); // the reader's finger moves the list down by 40 px
    s.scroller.dispatchEvent(new Event('scroll'));
    await frames(12);
    expect(s.at()).toBe(140);
    window.dispatchEvent(new Event('touchend'));
  });

  it('a press held down through the answer makes its scrolls the reader’s, with no move event of its own', async () => {
    const s = scene();
    s.view.rerender({ rows: s.initial, loading: true });
    s.scroller.dispatchEvent(new Event('pointerdown')); // a press on the scrollbar, dragged after the page lands
    s.row.remove();
    s.view.rerender({ rows: rowsOf(...Array.from({ length: 100 }, (_, i) => `user:older-${i}`), KEPT), loading: false });
    await frames(3);
    s.moveTo(140);
    s.scroller.dispatchEvent(new Event('scroll'));
    await frames(12);
    expect(s.at()).toBe(140);
    window.dispatchEvent(new Event('pointerup'));
  });

  it('a gesture ended before the answer leaves the list’s own scrolls to the hold', async () => {
    const s = scene();
    s.view.rerender({ rows: s.initial, loading: true });
    s.scroller.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('pointerup'));
    s.row.remove();
    s.view.rerender({ rows: rowsOf(...Array.from({ length: 100 }, (_, i) => `user:older-${i}`), KEPT), loading: false });
    await frames(5);
    s.moveTo(60); // the list scrolls again as it measures
    s.scroller.dispatchEvent(new Event('scroll'));
    await frames(12);
    expect(s.at()).toBe(100);
  });

  it('a reader the list holds at the end is the list’s, and the answered page leaves nothing to restore later', () => {
    const s = scene();
    (s.handle as unknown as { following: boolean }).following = true;
    s.view.rerender({ rows: s.initial, loading: true });
    s.moveTo(400);
    s.view.rerender({ rows: rowsOf('time:turn:u1', KEPT), loading: false });
    expect(s.at()).toBe(400);
    (s.handle as unknown as { following: boolean }).following = false;
    s.view.rerender({ rows: rowsOf('time:turn:u1', KEPT, 'text:live'), loading: false });
    expect(s.at()).toBe(400);
  });
});
