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
async function scene(ios = false, observedMeasurements = ios) {
  const observers = new Set<{ targets: Set<Element>; callback: ResizeObserverCallback; observer: ResizeObserver }>();
  const heights = new WeakMap<Element, number>();
  if (ios) {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
    _resetIOSDetectionForTests();
  }
  if (observedMeasurements) {
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
  let endShortfall = 0;
  const writes: number[] = [];
  const size = (el: HTMLElement) => frozenSize !== null && el.hasAttribute('data-transcript-scroller') ? frozenSize : (Number.parseFloat((el.firstElementChild as HTMLElement | null)?.style.height ?? '0') || 0) + overflow;
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-transcript-scroller') ? 200 : this.hasAttribute('data-index') ? heights.get(this) ?? 56 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return size(this); });
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-transcript-scroller')) top = Math.max(0, Math.min(top, size(this) - 200 - endShortfall));
    return top;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(function (this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === 'object' && options.top !== undefined) {
      top = Math.max(0, Math.min(options.top, size(this) - 200 - endShortfall));
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
    roundDOMEnd: (pixels: number) => { endShortfall = pixels; },
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
    readerMove: (by: number, report = true) => act(() => {
      fireEvent.wheel(scroller, { deltaY: by });
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

it('a scroll-capable key does not release a list that did not move', async () => {
  const s = await scene();
  act(() => { fireEvent.keyDown(s.scroller, { key: 'ArrowUp' }); });
  s.stream();
  expect(s.handle.current!.following).toBe(true);
  expect(s.changed.mock.calls).toEqual([]);
});

for (const key of ['PageUp', 'Home']) {
  it(`${key} from a short editor witnesses outer-list movement before its scroll event`, async () => {
    const s = await scene();
    const editor = document.createElement('textarea');
    editor.className = 'transcript-peer-input';
    s.scroller.querySelector('[data-index]')!.appendChild(editor);
    act(() => { fireEvent.keyDown(editor, { key }); });
    s.move(-40, false);
    s.stream();
    expect(s.handle.current!.following).toBe(false);
    expect(s.writes).toEqual([]);
  });

  it(`${key} targeted at body after a gutter click witnesses this list's upward movement`, async () => {
    const s = await scene();
    const gutter = document.createElement('div');
    s.scroller.appendChild(gutter);
    act(() => {
      fireEvent.pointerDown(gutter, { pointerType: 'mouse', button: 0, pointerId: 7 });
      fireEvent.pointerUp(window, { pointerType: 'mouse', button: 0, pointerId: 7 });
      fireEvent.keyDown(document.body, { key });
    });
    s.move(-40, false);
    s.stream();
    expect(s.handle.current!.following).toBe(false);
    expect(s.writes).toEqual([]);
  });
}

it('Home from a contained group at its top can witness the outer movement WebKit actually performs', async () => {
  const s = await scene();
  const group = document.createElement('div');
  group.className = 'transcript-group-cells';
  group.style.overflowY = 'auto';
  group.style.overscrollBehaviorY = 'contain';
  Object.defineProperties(group, { scrollHeight: { value: 600 }, clientHeight: { value: 224 }, scrollTop: { value: 0 } });
  s.scroller.querySelector('[data-index]')!.appendChild(group);
  act(() => { fireEvent.keyDown(group, { key: 'Home' }); });
  s.move(-40, false);
  s.stream();
  expect(s.handle.current!.following).toBe(false);
  expect(s.writes).toEqual([]);
});

for (const key of ['a', 'Enter']) {
  it(`${key} does not witness a replacement or clamp as reader scrolling`, async () => {
    const s = await scene();
    act(() => { fireEvent.keyDown(document.body, { key }); });
    s.move(-40, false);
    s.stream();
    expect(s.handle.current!.following).toBe(true);
  });
}

for (const origin of ['consumed-editor', 'other-pane'] as const) {
  for (const report of [false, true]) {
    for (const pendingSizer of [false, true]) {
      it(`a ${origin} key and ${pendingSizer ? 'pending-sizer' : 'committed'} shrink keep following through ${report ? 'native scroll' : 'witness expiry'}`, async () => {
        const s = await scene(false, true);
        const editor = document.createElement('textarea');
        Object.defineProperties(editor, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 }, scrollTop: { value: 500 } });
        (origin === 'consumed-editor' ? s.scroller.querySelector('[data-index]')! : s.scroller.parentElement!).appendChild(editor);
        act(() => { fireEvent.keyDown(editor, { key: origin === 'consumed-editor' ? 'PageUp' : 'Home' }); });
        if (pendingSizer) s.freezeDOMSize();
        s.resizeRow('last', -40);
        if (pendingSizer) s.move(-40, false); // the native clamp has reached the measured end before the smaller sizer commits
        else void s.scroller.scrollTop; // let the browser clamp to its newly committed maximum
        if (report) act(() => { fireEvent.scroll(s.scroller); });
        else await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
        expect(s.handle.current!.following).toBe(true);
        expect(s.changed.mock.calls).toEqual([]);
        if (pendingSizer) s.commitDOMSize();
        s.reportContentSize();
        s.resizeRow('last', 40);
        s.reportContentSize();
        expect(s.handle.current!.following).toBe(true);
        expect(s.scroller.scrollHeight - s.scroller.clientHeight - s.scroller.scrollTop).toBe(0);
      });
    }
  }
}

it('a quiet keyboard witness expires before a later unwitnessed clamp', async () => {
  const s = await scene();
  act(() => { fireEvent.keyDown(document.body, { key: 'PageUp' }); });
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
  s.move(-40, false);
  s.stream();
  expect(s.handle.current!.following).toBe(true);
});

for (const report of [false, true]) {
  it(`an upward position change without input does not release following (native event reported: ${report})`, async () => {
    const s = await scene();
    s.move(-40, report); // a clamp, replacement, focus or other browser movement is not witnessed reader intent
    s.stream();
    expect(s.handle.current!.following).toBe(true);
    expect(s.changed.mock.calls).toEqual([]);
    expect(s.scroller.scrollHeight - s.scroller.clientHeight - s.scroller.scrollTop).toBe(0);
  });
}

it('a primary pointer press on the scroller gives a scrollbar drag ownership before its scroll event', async () => {
  const s = await scene();
  act(() => { fireEvent.pointerDown(s.scroller, { pointerType: 'mouse', button: 0 }); });
  expect(s.handle.current!.following).toBe(false);
  s.move(-20, false);
  s.stream();
  expect(s.writes).toEqual([]);
});

it('a scrollbar drag that reaches bottom and reverses releases following again before its next move', async () => {
  const s = await scene();
  act(() => { fireEvent.pointerDown(s.scroller, { pointerType: 'mouse', button: 0 }); });
  s.move(-20);
  s.move(20);
  expect(s.handle.current!.following).toBe(true);
  act(() => { fireEvent.pointerMove(s.scroller, { pointerType: 'mouse', buttons: 1 }); });
  s.move(-20, false);
  s.writes.length = 0;
  s.stream();
  expect(s.handle.current!.following).toBe(false);
  expect(s.writes).toEqual([]);
});

for (const report of [false, true]) {
  it(`a final upward offset after pointerup retains its scrollbar witness (native event reported: ${report})`, async () => {
    const s = await scene();
    act(() => { fireEvent.pointerDown(s.scroller, { pointerType: 'mouse', button: 0, pointerId: 1 }); });
    s.move(-20);
    s.move(20);
    expect(s.handle.current!.following).toBe(true);
    act(() => { fireEvent.pointerUp(window, { pointerType: 'mouse', button: 0, pointerId: 1 }); });
    s.move(-20, report); // Chromium/WebKit can apply this after pointerup has already been delivered
    if (!report) await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    s.writes.length = 0;
    s.stream();
    expect(s.handle.current!.following).toBe(false);
    expect(s.writes).toEqual([]);
  });
}

it('a pointer press on row content is not a scrollbar drag even if it moves across the scroller', async () => {
  const s = await scene();
  act(() => {
    fireEvent.pointerDown(s.scroller.querySelector('[data-index]')!, { pointerType: 'mouse', button: 0, pointerId: 1 });
    fireEvent.pointerMove(s.scroller, { pointerType: 'mouse', buttons: 1, pointerId: 1 });
  });
  expect(s.handle.current!.following).toBe(true);
});

it('ending a scrollbar drag retires its input ownership', async () => {
  const s = await scene();
  act(() => { fireEvent.pointerDown(s.scroller, { pointerType: 'mouse', button: 0, pointerId: 1 }); });
  s.move(-20);
  act(() => { fireEvent.pointerUp(window, { pointerType: 'mouse', button: 0, pointerId: 1 }); });
  s.move(20);
  expect(s.handle.current!.following).toBe(true);
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
  s.move(-10); // after the trailing native movement window, a later clamp is no longer scrollbar input
  s.stream();
  expect(s.handle.current!.following).toBe(true);
});

it('a touch press on empty scroller space does not release following before a drag', async () => {
  const s = await scene();
  act(() => { fireEvent.pointerDown(s.scroller, { pointerType: 'touch', button: 0 }); });
  expect(s.handle.current!.following).toBe(true);
});

it('a small upward scroll releases follow mode before the next streamed row, even inside the old end threshold', async () => {
  const s = await scene();
  s.readerMove(-20);
  expect(s.changed.mock.calls).toEqual([[false]]);
  expect(s.handle.current!.following).toBe(false);
  s.stream();
  expect(s.handle.current!.following).toBe(false);
  expect(s.changed.mock.calls).toEqual([[false]]);
  expect(s.writes).toEqual([]);
});

it('a streamed row cannot overwrite an upward scroll whose browser event has not arrived yet', async () => {
  const s = await scene();
  s.readerMove(-200, false);
  s.stream();
  expect(s.handle.current!.following).toBe(false);
  expect(s.writes).toEqual([]);
});

it('scrolling downward near the end does not resume following until the reader reaches the bottom', async () => {
  const s = await scene();
  s.readerMove(-200);
  s.readerMove(180); // twenty pixels from the bottom is still the reader's place
  expect(s.handle.current!.following).toBe(false);
  s.readerMove(20);
  expect(s.handle.current!.following).toBe(true);
  s.stream();
  expect(s.writes.length).toBeGreaterThan(0);
  expect(s.changed.mock.calls).toEqual([[false], [true]]);
});

for (const shortfall of [0.25, 0.75, 1]) {
  it(`returning to the browser's fractional maximum resumes following with a ${shortfall}px rounded bottom gap`, async () => {
    const s = await scene();
    s.readerMove(-200);
    expect(s.handle.current!.following).toBe(false);
    s.roundDOMEnd(shortfall); // zoom/DPR can leave an integer scrollHeight above the reachable maximum scrollTop
    s.readerMove(1000);
    expect(s.scroller.scrollHeight - s.scroller.clientHeight - s.scroller.scrollTop).toBe(shortfall);
    expect(s.handle.current!.following).toBe(true);
    s.stream();
    expect(s.scroller.scrollHeight - s.scroller.clientHeight - s.scroller.scrollTop).toBe(shortfall);
    expect(s.changed.mock.calls).toEqual([[false], [true]]);
  });
}

it('a native return to the last observed end resumes following when new DOM growth precedes its scroll event', async () => {
  const s = await scene();
  s.readerMove(-200);
  s.readerMove(200, false); // reached the physical end before this next streamed layout
  s.extendDOMEnd(40); // rendered overflow grows before ResizeObserver and the queued native scroll event
  act(() => { fireEvent.scroll(s.scroller); });
  expect(s.handle.current!.following).toBe(true);
  s.stream();
  expect(s.scroller.scrollHeight - s.scroller.clientHeight - s.scroller.scrollTop).toBe(0);
});

it('a downward gesture observes a newly grown end rather than resuming at the obsolete one', async () => {
  const s = await scene();
  s.readerMove(-200);
  s.extendDOMEnd(40); // an asynchronous block grew before the gesture, not after it
  act(() => { fireEvent.wheel(s.scroller, { deltaY: 200 }); });
  s.readerMove(200);
  expect(s.handle.current!.following).toBe(false);
  s.readerMove(40);
  expect(s.handle.current!.following).toBe(true);
});

it('a reader reaching the bottom is noticed before a pending measurement moves that bottom again', async () => {
  const s = await scene(true);
  s.readerMove(-200);
  s.readerMove(1); // real virtual-core may compensate a newly measured row above the reader while moving forward
  s.move(199, false); // the reader reached the old end, but the browser has not delivered its scroll event
  s.resizeRow('first');
  s.reportContentSize();
  expect(s.handle.current!.following).toBe(true);
  expect(s.scroller.scrollHeight - s.scroller.clientHeight - s.scroller.scrollTop).toBe(0);
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
    s.readerMove(-200);
    const held = s.scroller.scrollTop;
    s.writes.length = 0;
    s.resizeRow('last');
    s.reportContentSize();
    expect(s.scroller.scrollTop).toBe(held);
    expect(s.writes).toEqual([]);
  });
}

// The streamed answer grows inside the last row: its content overflows the sizer at once, but the sizer's height commits
// only after the virtualizer re-renders, a frame or two later. The end is followed in the observer pass that measured
// the growth, before that frame paints, never left behind until the sizer commits (e2e: transcript.spec.ts, painted
// frames while following).
for (const grow of [24, 182]) {
  it(`a following list pins a measured ${grow}px growth of the last row before its sizer commits`, async () => {
    const s = await scene(false, true);
    s.extendDOMEnd(grow); // the grown row overflows the sizer React has not re-rendered yet
    s.resizeRow('last', grow);
    await act(async () => {}); // the observer's delivery is done
    s.extendDOMEnd(0); // the sizer has committed: the row no longer overflows it
    expect(s.writes.length).toBeGreaterThan(0);
    expect(s.scroller.scrollHeight - s.scroller.clientHeight - s.scroller.scrollTop).toBe(0);
    expect(s.handle.current!.following).toBe(true);
    expect(s.changed.mock.calls).toEqual([]);
  });
}

it('a measured growth after reader input leaves the reader where they are', async () => {
  const s = await scene(false, true);
  s.readerMove(-200);
  const held = s.scroller.scrollTop;
  s.writes.length = 0;
  s.extendDOMEnd(182);
  s.resizeRow('last', 182);
  await act(async () => {});
  s.extendDOMEnd(0);
  expect(s.scroller.scrollTop).toBe(held);
  expect(s.writes).toEqual([]);
  expect(s.handle.current!.following).toBe(false);
});

// Movement the reader made before its native scroll event (a witnessed key, a scrollbar drag reversed after it
// resumed following) is read before a measured growth is followed: the growth does not overwrite it.
for (const key of ['PageUp', 'Home']) {
  it(`${key} movement before its scroll event is kept through a measured growth of the last row`, async () => {
    const s = await scene(false, true);
    act(() => { fireEvent.keyDown(s.scroller, { key }); });
    s.move(-40, false);
    const held = s.scroller.scrollTop;
    s.extendDOMEnd(182);
    s.resizeRow('last', 182);
    await act(async () => {});
    s.extendDOMEnd(0);
    s.reportContentSize();
    expect(s.handle.current!.following).toBe(false);
    expect(s.scroller.scrollTop).toBe(held);
    expect(s.writes).toEqual([]);
  });
}

it('a reversed scrollbar drag before its scroll event is kept through a measured growth of the last row', async () => {
  const s = await scene(false, true);
  act(() => { fireEvent.pointerDown(s.scroller, { pointerType: 'mouse', button: 0, pointerId: 1 }); });
  s.move(-20);
  s.move(20);
  expect(s.handle.current!.following).toBe(true);
  s.move(-40, false);
  const held = s.scroller.scrollTop;
  s.writes.length = 0;
  s.extendDOMEnd(182);
  s.resizeRow('last', 182);
  await act(async () => {});
  s.extendDOMEnd(0);
  s.reportContentSize();
  expect(s.handle.current!.following).toBe(false);
  expect(s.scroller.scrollTop).toBe(held);
  expect(s.writes).toEqual([]);
});

// One observer delivery that grows a row above the reader and the overflowing last row is followed once, against the
// whole delivery's total: the iOS compensation for the row above is not retired early by a partial one.
it('iOS keeps above-reader compensation when the same delivery grows the last row past the old sizer', async () => {
  const s = await scene(true);
  s.reportContentSize();
  act(() => { fireEvent.touchStart(s.scroller, { touches: [{ identifier: 1, clientY: 100 }] }); });
  let held = 0;
  // One delivery, its microtasks, and the drag, all before React re-renders the sizer (the outer act holds the render).
  await act(async () => {
    s.extendDOMEnd(182);
    s.resizeRow('first', 40);
    s.resizeRow('last', 182);
    await Promise.resolve();
    fireEvent.touchMove(s.scroller, { touches: [{ identifier: 1, clientY: 120 }] });
    s.move(-20);
    held = s.scroller.scrollTop;
  });
  s.extendDOMEnd(0);
  s.reportContentSize();
  act(() => { fireEvent.touchEnd(s.scroller, { touches: [] }); });
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
  expect(s.scroller.scrollTop).toBe(held + 40);
});

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

it('a desktop shrink and regrowth before its native scroll event do not detach a following reader', async () => {
  const s = await scene(false, true);
  s.resizeRow('last', -40); // the browser clamps to this smaller end before delivering a scroll event
  expect(s.scroller.scrollHeight - s.scroller.clientHeight - s.scroller.scrollTop).toBe(0);
  s.resizeRow('last', 40); // another measurement restores the extent before that native event or content-size report
  s.reportContentSize();
  expect(s.handle.current!.following).toBe(true);
  expect(s.changed.mock.calls).toEqual([]);
  expect(s.scroller.scrollHeight - s.scroller.clientHeight - s.scroller.scrollTop).toBe(0);
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
      s.readerMove(-200);
      s.readerMove(1); // a forward direction allows the real virtualizer to anchor a re-measured row above the viewport
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
  for (const [height, position, containment, consumed] of [[600, 100, 'auto', true], [600, 0, 'contain', true], [600, 0, 'auto', false], [224, 0, 'contain', true], [224, 0, 'none', true], [224, 0, 'auto', false]] as const) {
    it(`${input} belongs to ${height > 224 ? 'overflowing' : 'fitting'} nested group cells at ${position}px with ${containment} overscroll`, async () => {
      const s = await scene();
      const group = document.createElement('div');
      group.className = 'transcript-group-cells';
      group.style.overflowY = 'auto';
      group.style.overscrollBehaviorY = containment;
      Object.defineProperties(group, { scrollHeight: { value: height }, clientHeight: { value: 224 }, scrollTop: { value: position, writable: true } });
      s.scroller.querySelector('[data-index]')!.appendChild(group);
      act(() => { up(group); });
      if (input === 'keyboard' && !consumed) s.move(-32); // the browser chained this key's movement to the outer list
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
