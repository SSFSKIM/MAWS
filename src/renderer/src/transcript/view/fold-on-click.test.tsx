// The owner's ruling (UX wave, obs4): an open tool block folds at a click on its blank space; not at a drag, a click
// that ends a selection, one on a control or a link, or one on text; of nested blocks only the innermost open one; and
// focus lands on the head's toggle. Over the real rows: a call's row, a run of calls, a browser action's snapshot.
import type { AppSessionId } from '@shared/graph/ids';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { useTranscriptStore } from '../../stores/transcript';
import { cellId } from '../model/keys';
import type { Row } from '../model/rows';
import { builder, tool } from '../model/test-events';
import { renderRow, rowOf, storeWith } from './rows/test-support';

afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
});

// A press and its click where nothing moved: what a click on the blank space is, by the pointer.
function press(element: Element, at = { clientX: 10, clientY: 10 }, to = at) {
  fireEvent.mouseDown(element, { button: 0, detail: 1, ...at });
  fireEvent.mouseUp(element, { button: 0, detail: 1, ...to });
  fireEvent.click(element, { button: 0, detail: 1, ...to });
}

// One finished turn whose run holds two shell calls, the run open (expandAll) and the first call open.
async function openRun() {
  const b = builder(); b.turn('u');
  b.toolUse('one', 'Bash', { command: 'ls', description: 'List the files' }); b.result('one', 'a.txt\nb.txt');
  b.toolUse('two', 'Bash', { command: 'pwd', description: 'Print the folder' }); b.result('two', '/p');
  b.end(['u']);
  const store = await storeWith(b.events);
  useTranscriptStore.getState().expandAll(store.key);
  useTranscriptStore.getState().toggleCell(store.key, cellId.tool(tool('one')));
  const view = renderRow(rowOf(store.rows(), 'group'), { storeKey: store.key });
  const rerender = () => view.rerenderRow(rowOf(store.rows(), 'group'));
  const call = () => view.container.querySelector<HTMLElement>('.transcript-cell[data-cell-id]')!;
  const run = () => view.container.querySelector<HTMLElement>('.transcript-group')!;
  const runLine = () => view.container.querySelector<HTMLElement>('.transcript-run-line')!;
  const callLine = () => call().querySelector<HTMLElement>('.transcript-cell-line')!;
  return { store, view, rerender, call, run, runLine, callLine, detail: () => call().querySelector<HTMLElement>('.transcript-cell-detail')! };
}

// One standalone shell call, a run of one, open (expandAll opens its run's line).
async function openCell() {
  const b = builder(); b.turn('u');
  b.toolUse('ls', 'Bash', { command: 'ls', description: 'List the files' }); b.result('ls', 'a.txt'); b.end(['u']);
  const store = await storeWith(b.events);
  useTranscriptStore.getState().expandAll(store.key);
  const row = () => rowOf(store.rows(), 'cell');
  const head = () => document.querySelector<HTMLElement>('.transcript-cell-line')!;
  const view = renderRow(row(), { storeKey: store.key });
  return { view, head, rerender: () => view.rerenderRow(row()), detail: () => view.container.querySelector<HTMLElement>('.transcript-cell-detail')! };
}

describe('a call’s row', () => {
  it('folds at a click on the blank space of its open detail, focus on its line, the line scrolled into view', async () => {
    const cell = await openCell();
    expect(cell.head().getAttribute('aria-expanded')).toBe('true');
    const scrolled = vi.fn();
    cell.head().scrollIntoView = scrolled;
    press(cell.detail());
    cell.rerender();
    expect(cell.head().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(cell.head());
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('stays open at a click that ends a selection of its text', async () => {
    const cell = await openCell();
    const output = cell.detail().querySelector('pre')!;
    const range = document.createRange();
    range.selectNodeContents(output);
    document.getSelection()!.addRange(range);
    press(cell.detail());
    cell.rerender();
    expect(cell.head().getAttribute('aria-expanded')).toBe('true');
  });

  it('stays open at a drag, whatever the selection reads at its end', async () => {
    const cell = await openCell();
    press(cell.detail(), { clientX: 10, clientY: 10 }, { clientX: 60, clientY: 12 });
    cell.rerender();
    expect(cell.head().getAttribute('aria-expanded')).toBe('true');
  });

  it('stays open at a click on text (the first click of a double click that selects a word), and at a double click', async () => {
    const cell = await openCell();
    const output = cell.detail().querySelector('pre')!;
    const text = output.firstChild as Text;
    // Chromium's caret at the point, on the output's first character, whose box holds the point
    const caret = document.createRange();
    caret.setStart(text, 0);
    const box = { left: 0, right: 20, top: 0, bottom: 20, width: 20, height: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    Object.assign(document, { caretRangeFromPoint: () => caret });
    const rects = vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([box] as unknown as DOMRectList);
    onTestFinished(() => { delete (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint; rects.mockRestore(); });
    press(output);
    cell.rerender();
    expect(cell.head().getAttribute('aria-expanded')).toBe('true');
    // past the line's end the caret's characters hold no point: blank, but the second click of a double click is not a fold
    fireEvent.mouseDown(output, { button: 0, detail: 2, clientX: 50, clientY: 10 });
    fireEvent.click(output, { button: 0, detail: 2, clientX: 50, clientY: 10 });
    cell.rerender();
    expect(cell.head().getAttribute('aria-expanded')).toBe('true');
    press(output, { clientX: 50, clientY: 10 });
    cell.rerender();
    expect(cell.head().getAttribute('aria-expanded')).toBe('false');
  });

  it('stays open at a click on a control inside it, and on a link', async () => {
    const cell = await openCell();
    const control = document.createElement('button');
    const link = document.createElement('span');
    link.setAttribute('role', 'button'); // a mention or a path link: link text on a span with the role of a button
    const word = document.createElement('em');
    link.append(word);
    cell.detail().append(control, link);
    onTestFinished(() => { control.remove(); link.remove(); });
    press(control);
    press(word);
    cell.rerender();
    expect(cell.head().getAttribute('aria-expanded')).toBe('true');
  });

  it('a modified click (⇧ extends a selection, ⌘ opens) is not a fold', async () => {
    const cell = await openCell();
    fireEvent.mouseDown(cell.detail(), { button: 0, detail: 1, shiftKey: true });
    fireEvent.click(cell.detail(), { button: 0, detail: 1, shiftKey: true });
    cell.rerender();
    expect(cell.head().getAttribute('aria-expanded')).toBe('true');
  });

  it('the body is no focus stop: the line stays the keyboard’s one way to fold', async () => {
    const cell = await openCell();
    const block = cell.head().closest('.transcript-cell')!;
    expect(block.querySelectorAll('[tabindex]:not(button)')).toHaveLength(0);
    expect(block.hasAttribute('tabindex')).toBe(false);
  });
});

describe('a run of calls', () => {
  it('a click on an open call’s blank space folds the call alone; the run stays open', async () => {
    const run = await openRun();
    expect(run.callLine().getAttribute('aria-expanded')).toBe('true');
    press(run.detail());
    run.rerender();
    expect(run.callLine().getAttribute('aria-expanded')).toBe('false');
    expect(run.runLine().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(run.callLine());
  });

  it('a click on the run’s own blank space, outside any open call, folds the run, focus on its line', async () => {
    const run = await openRun();
    press(run.view.container.querySelector('.transcript-tool-block')!);
    run.rerender();
    expect(run.runLine().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(run.runLine());
  });

  it('a click on a folded call’s line opens it, and folds nothing', async () => {
    const run = await openRun();
    const second = run.view.container.querySelectorAll<HTMLElement>('.transcript-cell-line')[1];
    press(second);
    run.rerender();
    expect(run.runLine().getAttribute('aria-expanded')).toBe('true');
    expect(run.view.container.querySelectorAll<HTMLElement>('.transcript-cell-line')[1].getAttribute('aria-expanded')).toBe('true');
  });
});

describe('a browser action’s snapshot', () => {
  const APP = 'app-browser' as AppSessionId;
  const row = {
    id: 'browser:t1' as never, turnId: null, at: '2026-10-07T10:00:00.000Z', kind: 'browser_action', toolUseId: 't1' as never, tool: 'browser_snapshot', action: 'snapshot', tabId: 'b_000000000001',
    target: null, targetRole: null, targetName: null, value: null, url: 'https://example.com/form', title: 'Order form', ms: 40, deliverableId: null, error: null,
    waitedFor: null, waitedMs: null, chars: 30, truncated: false, tabCount: null, state: 'done', detail: '- heading "Order form" [ref=e1]', answered: true,
  } satisfies Extract<Row, { kind: 'browser_action' }>;

  it('folds at a click on the blank space of its open snapshot, focus on Hide snapshot', () => {
    const { container } = renderRow(row, { storeKey: APP });
    fireEvent.click(screen.getByRole('button', { name: 'Show snapshot' }));
    press(container.querySelector('[data-detail]')!);
    const toggle = screen.getByRole('button', { name: 'Show snapshot' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });
});
