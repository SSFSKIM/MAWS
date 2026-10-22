import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Row, RowId } from '../model/rows';
import { TranscriptList, type TranscriptListHandle } from './Transcript';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Only layout is supplied: the real list and virtualizer decide what to scroll and when to follow. Browser coverage
// in desk-web/e2e/stream-scroll.spec.ts exercises actual wheel/touch-like input and measured streaming Markdown.
async function scene() {
  let top = 0;
  const writes: number[] = [];
  const size = (el: HTMLElement) => Number.parseFloat((el.firstElementChild as HTMLElement | null)?.style.height ?? '0') || 0;
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-transcript-scroller') ? 200 : this.hasAttribute('data-index') ? 56 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return size(this); });
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-transcript-scroller')) top = Math.max(0, Math.min(top, size(this) - 200));
    return top;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(function (this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === 'object' && options.top !== undefined) {
      top = Math.max(0, Math.min(options.top, size(this) - 200));
      writes.push(top);
    }
  });
  const rows: Row[] = Array.from({ length: 60 }, (_, i) => ({ id: `scroll-row-${i}` as RowId, turnId: null, at: '', kind: 'time', label: `Line ${i}` }));
  const handle = createRef<TranscriptListHandle>();
  const changed = vi.fn();
  const draw = (next: Row[]) => <TranscriptList rows={next} renderRow={(row) => <div>{row.id}</div>} handle={handle} onFollowChange={changed} />;
  const view = render(draw(rows));
  await waitFor(() => expect(top).toBeGreaterThan(1000));
  const scroller = handle.current!.scrollElement!;
  act(() => { fireEvent.scroll(scroller); });
  writes.length = 0;
  changed.mockClear();
  return {
    handle, changed, writes, scroller,
    move: (by: number, report = true) => act(() => {
      top += by;
      if (report) fireEvent.scroll(scroller);
    }),
    stream: () => view.rerender(draw([...rows, { id: 'new-stream-row' as RowId, turnId: null, at: '', kind: 'time', label: 'Incoming answer' }])),
  };
}

for (const [input, up] of [
  ['wheel', (el: HTMLElement) => fireEvent.wheel(el, { deltaY: -1 })],
  ['touch drag', (el: HTMLElement) => {
    fireEvent.touchStart(el, { touches: [{ identifier: 1, clientY: 100 }] });
    fireEvent.touchMove(el, { touches: [{ identifier: 1, clientY: 101 }] });
  }],
  ['keyboard', (el: HTMLElement) => fireEvent.keyDown(el, { key: 'ArrowUp' })],
] as const) {
  it(`${input} scroll-up intent stops following before any scroll event or incoming row`, async () => {
    const s = await scene();
    act(() => { up(s.scroller); });
    expect(s.handle.current!.following).toBe(false);
    s.stream();
    expect(s.handle.current!.following).toBe(false);
    expect(s.writes).toEqual([]);
  });
}

it('a small upward scroll releases follow mode before the next streamed row, even inside the old end threshold', async () => {
  const s = await scene();
  s.move(-20);
  expect(s.changed.mock.calls).toEqual([[false]]);
  expect(s.handle.current!.following).toBe(false);
  s.stream();
  expect(s.handle.current!.following).toBe(false);
  expect(s.changed.mock.calls).toEqual([[false]]);
  expect(s.writes).toEqual([]);
});

it('a streamed row cannot overwrite an upward scroll whose browser event has not arrived yet', async () => {
  const s = await scene();
  s.move(-200, false);
  s.stream();
  expect(s.handle.current!.following).toBe(false);
  expect(s.writes).toEqual([]);
});

it('scrolling downward near the end does not resume following until the reader reaches the bottom', async () => {
  const s = await scene();
  s.move(-200);
  s.move(180); // twenty pixels from the bottom is still the reader's place
  expect(s.handle.current!.following).toBe(false);
  s.move(20);
  expect(s.handle.current!.following).toBe(true);
  s.stream();
  expect(s.writes.length).toBeGreaterThan(0);
  expect(s.changed.mock.calls).toEqual([[false], [true]]);
});

it('Jump to latest resumes following even without a browser scroll event to acknowledge the jump', async () => {
  const s = await scene();
  act(() => { fireEvent.wheel(s.scroller, { deltaY: -1 }); });
  expect(s.handle.current!.following).toBe(false);
  act(() => { s.handle.current!.scrollToEnd(); });
  expect(s.handle.current!.following).toBe(true);
  s.stream();
  expect(s.writes.length).toBeGreaterThan(0);
  expect(s.changed.mock.calls).toEqual([[false], [true]]);
});

it('scroll-up keys in an editable row belong to its editor, not transcript follow mode', async () => {
  const s = await scene();
  const editor = document.createElement('textarea');
  s.scroller.appendChild(editor);
  act(() => { fireEvent.keyDown(editor, { key: 'ArrowUp' }); });
  expect(s.handle.current!.following).toBe(true);
  expect(s.changed.mock.calls).toEqual([]);
});
