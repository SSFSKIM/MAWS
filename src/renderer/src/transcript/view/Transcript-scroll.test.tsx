import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { _resetIOSDetectionForTests } from '@tanstack/react-virtual';
import { afterEach, expect, it, vi } from 'vitest';
import type { Row, RowId } from '../model/rows';
import { TranscriptList, type TranscriptListHandle } from './Transcript';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _resetIOSDetectionForTests();
});

const resizeEntry = (target: Element, height: number): ResizeObserverEntry => ({
  target,
  borderBoxSize: [{ blockSize: height, inlineSize: 390 }],
  contentBoxSize: [{ blockSize: height, inlineSize: 390 }],
  devicePixelContentBoxSize: [{ blockSize: height, inlineSize: 390 }],
  contentRect: new DOMRectReadOnly(0, 0, 390, height),
});

// Only layout is supplied: the real list and virtualizer decide what to scroll and when to follow. Browser coverage
// in desk-web/e2e/stream-scroll.spec.ts exercises actual wheel/touch-like input and measured streaming Markdown.
async function scene(ios = false) {
  const observers = new Set<{ targets: Set<Element>; callback: ResizeObserverCallback; observer: ResizeObserver }>();
  const heights = new WeakMap<Element, number>();
  if (ios) {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
    _resetIOSDetectionForTests();
    vi.stubGlobal('ResizeObserver', class {
      private readonly entry: { targets: Set<Element>; callback: ResizeObserverCallback; observer: ResizeObserver };
      constructor(callback: ResizeObserverCallback) {
        this.entry = { targets: new Set(), callback, observer: this as unknown as ResizeObserver };
        observers.add(this.entry);
      }
      observe(target: Element) { this.entry.targets.add(target); }
      unobserve(target: Element) { this.entry.targets.delete(target); }
      disconnect() { observers.delete(this.entry); }
    });
  }
  let top = 0;
  let frozenSize: number | null = null;
  let pendingContentSize: string | null = null;
  let overflow = 0;
  const writes: number[] = [];
  const size = (el: HTMLElement) => frozenSize !== null && el.hasAttribute('data-transcript-scroller') ? frozenSize : (Number.parseFloat((el.firstElementChild as HTMLElement | null)?.style.height ?? '0') || 0) + overflow;
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-transcript-scroller') ? 200 : this.hasAttribute('data-index') ? heights.get(this) ?? 56 : 0;
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
    freezeDOMSize: () => { frozenSize = size(scroller); },
    commitDOMSize: () => {
      frozenSize = null;
      if (pendingContentSize !== null) (scroller.firstElementChild as HTMLElement).style.height = pendingContentSize;
      pendingContentSize = null;
    },
    extendDOMEnd: (pixels: number) => { overflow = pixels; },
    reportContentSize: () => act(() => {
      const content = scroller.firstElementChild!;
      for (const { targets, callback, observer } of observers) {
        if (targets.has(content)) callback([resizeEntry(content, size(scroller))], observer);
      }
    }),
    resizeRow: (edge: 'first' | 'last', delta = 40) => {
      const mounted = [...scroller.querySelectorAll<HTMLElement>('[data-index]')];
      const row = edge === 'first' ? mounted[0] : mounted.at(-1)!;
      const height = (heights.get(row) ?? 56) + delta;
      heights.set(row, height);
      act(() => {
        for (const { targets, callback, observer } of observers) {
          if (targets.has(row)) callback([resizeEntry(row, height)], observer);
        }
      });
      if (frozenSize !== null) {
        const style = (scroller.firstElementChild as HTMLElement).style;
        pendingContentSize = style.height;
        style.height = `${frozenSize}px`;
      }
    },
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

for (const initialReport of [false, true]) {
  it(`follows committed measured growth without a row update, but not after reader input (initial size reported: ${initialReport})`, async () => {
    const s = await scene(true);
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if (initialReport) s.reportContentSize();
    s.resizeRow('last');
    s.reportContentSize();
    expect(s.scroller.scrollHeight - s.scroller.clientHeight - s.scroller.scrollTop).toBe(0);
    s.move(-200);
    const held = s.scroller.scrollTop;
    s.writes.length = 0;
    s.resizeRow('last');
    s.reportContentSize();
    expect(s.scroller.scrollTop).toBe(held);
    expect(s.writes).toEqual([]);
  });
}

it('a browser clamp during remeasurement is not reader intent, even before the smaller sizer commits', async () => {
  const s = await scene(true);
  await new Promise((resolve) => setTimeout(resolve, 180)); // the real virtualizer retires its initial scrolling state
  s.move(-40, false); // the browser has clamped the end as a measured row shrinks; its scroll event is still pending
  s.resizeRow('first', -40); // actual virtualizer measurement is smaller while the old DOM scrollHeight still stands
  expect(s.handle.current!.following).toBe(true);
  expect(s.changed.mock.calls).toEqual([]);
  s.stream();
  expect(s.handle.current!.following).toBe(true);
  expect(s.writes.length).toBeGreaterThan(0);
});

it('does not retire iOS anchor compensation before its measured extent can commit', async () => {
  const s = await scene(true);
  s.reportContentSize();
  act(() => { fireEvent.touchStart(s.scroller, { touches: [{ identifier: 1, clientY: 100 }] }); });
  s.freezeDOMSize(); // measurement is ahead of the browser's committed scroll extent
  s.resizeRow('first');
  act(() => { s.handle.current!.scrollToEnd(); });
  act(() => { fireEvent.touchMove(s.scroller, { touches: [{ identifier: 1, clientY: 120 }] }); });
  s.move(-20);
  const held = s.scroller.scrollTop;
  s.commitDOMSize();
  s.reportContentSize();
  act(() => { fireEvent.touchEnd(s.scroller, { touches: [] }); });
  await waitFor(() => expect(s.scroller.scrollTop).toBe(held + 40));
});

it('does not apply an iOS anchor delta twice when following already absorbed it before the reader drags away', async () => {
  const s = await scene(true);
  s.reportContentSize();
  act(() => { fireEvent.touchStart(s.scroller, { touches: [{ identifier: 1, clientY: 100 }] }); });
  s.resizeRow('first'); // above-reader growth is deferred by virtual-core
  s.reportContentSize(); // following now includes that growth in the committed DOM end
  expect(s.scroller.scrollHeight - s.scroller.clientHeight - s.scroller.scrollTop).toBe(0);
  act(() => { fireEvent.touchMove(s.scroller, { touches: [{ identifier: 1, clientY: 120 }] }); });
  s.move(-20);
  const held = s.scroller.scrollTop;
  act(() => { fireEvent.touchEnd(s.scroller, { touches: [] }); });
  await act(() => new Promise((resolve) => setTimeout(resolve, 220)));
  expect(s.scroller.scrollTop).toBe(held);
});

it('does not replay below-reader end-follow growth when an iOS finger turns into an upward drag', async () => {
  const s = await scene(true);
  act(() => { fireEvent.touchStart(s.scroller, { touches: [{ identifier: 1, clientY: 100 }] }); });
  s.resizeRow('last'); // this row is below the viewport's top: its growth is following, not anchor compensation
  act(() => { fireEvent.touchMove(s.scroller, { touches: [{ identifier: 1, clientY: 120 }] }); });
  s.move(-20);
  const held = s.scroller.scrollTop;
  s.writes.length = 0;
  act(() => { fireEvent.touchEnd(s.scroller, { touches: [] }); });
  await act(() => new Promise((resolve) => setTimeout(resolve, 220)));
  expect(s.scroller.scrollTop).toBe(held);
  expect(s.writes).toEqual([]);
});

for (const jumpFirst of [false, true]) {
  it(`preserves iOS above-viewport resize compensation through a drag (${jumpFirst ? 'after Jump to latest' : 'already reading history'})`, async () => {
    const s = await scene(true);
    if (!jumpFirst) {
      s.move(-200);
      s.move(1); // a forward direction allows the real virtualizer to anchor a re-measured row above the viewport
    }
    act(() => {
      if (jumpFirst) s.handle.current!.scrollToEnd();
      fireEvent.touchStart(s.scroller, { touches: [{ identifier: 1, clientY: 100 }] });
    });
    s.writes.length = 0;
    s.resizeRow('first'); // real ResizeObserver -> measureElement -> virtualizer.resizeItem, deferred while touching iOS
    expect(s.writes).toEqual([]);
    act(() => { fireEvent.touchMove(s.scroller, { touches: [{ identifier: 1, clientY: 120 }] }); });
    s.move(-20);
    const held = s.scroller.scrollTop;
    expect(s.writes).toEqual([]);
    act(() => { fireEvent.touchEnd(s.scroller, { touches: [] }); });
    await waitFor(() => expect(s.scroller.scrollTop).toBe(held + 40));
    expect(s.handle.current!.following).toBe(false);
  });
}

for (const [input, up] of [
  ['wheel', (el: HTMLElement) => fireEvent.wheel(el, { deltaY: -32 })],
  ['touch', (el: HTMLElement) => {
    fireEvent.touchStart(el, { touches: [{ identifier: 1, clientY: 100 }] });
    fireEvent.touchMove(el, { touches: [{ identifier: 1, clientY: 120 }] });
  }],
  ['keyboard', (el: HTMLElement) => fireEvent.keyDown(el, { key: 'ArrowUp' })],
] as const) {
  for (const [position, containment, consumed] of [[100, 'auto', true], [0, 'contain', true], [0, 'auto', false]] as const) {
    it(`${input} belongs to nested group cells at ${position}px with ${containment} overscroll`, async () => {
      const s = await scene();
      const group = document.createElement('div');
      group.className = 'transcript-group-cells';
      group.style.overflowY = 'auto';
      group.style.overscrollBehaviorY = containment;
      Object.defineProperties(group, { scrollHeight: { value: 600 }, clientHeight: { value: 224 }, scrollTop: { value: position, writable: true } });
      s.scroller.querySelector('[data-index]')!.appendChild(group);
      act(() => { up(group); });
      expect(s.handle.current!.following).toBe(consumed);
      s.stream();
      expect(s.handle.current!.following).toBe(consumed);
      if (consumed) expect(s.writes.length).toBeGreaterThan(0);
      else expect(s.writes).toEqual([]);
    });
  }
}

it('Jump reaches the browser end when rendered content extends past the logical sizer', async () => {
  const s = await scene();
  s.extendDOMEnd(24);
  act(() => { s.handle.current!.scrollToEnd(); });
  expect(s.scroller.scrollHeight - s.scroller.clientHeight - s.scroller.scrollTop).toBe(0);
});

it('scroll-up keys in an editable row belong to its editor, not transcript follow mode', async () => {
  const s = await scene();
  const editor = document.createElement('textarea');
  s.scroller.appendChild(editor);
  act(() => { fireEvent.keyDown(editor, { key: 'ArrowUp' }); });
  expect(s.handle.current!.following).toBe(true);
  expect(s.changed.mock.calls).toEqual([]);
});
