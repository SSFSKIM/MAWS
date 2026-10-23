// The rail's list follows the document after it goes quiet (M4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md,
// fix wave 1): its orphan state walks every tab's marks, so sustained typing must not rescan the document while it
// lasts; the list catches up one quiet moment after the last change.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newDoc, type Doc, type Node } from '../../../yjs';
import { addThread, resolve } from '../../threads';
import { useOpenThreadCount, useOpenThreadCounts, useThreadStates } from './use-threads';
import { createDocument, tabBody } from '../../tabs';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const thread = (doc: Doc, threadId: string) =>
  addThread(doc, { threadId, tabId: 'tab1', blockId: 'p1', quote: threadId, anchor: { start: null, end: null, block: null }, by: { kind: 'human' }, at: 1 });

it('waits for a quiet moment: a change every 30 ms holds the list until the changes stop', () => {
  const doc = newDoc();
  const { result } = renderHook(() => useThreadStates(doc));
  const ids = () => result.current.map((state) => state.id);
  expect(ids()).toEqual([]);
  for (const id of ['t1', 't2', 't3', 't4']) {
    act(() => thread(doc, id));
    act(() => void vi.advanceTimersByTime(30));
    expect(ids(), `still typing after ${id}`).toEqual([]);
  }
  act(() => void vi.advanceTimersByTime(20));
  expect(ids()).toEqual(['t1', 't2', 't3', 't4']);
});

it('counts only live-target threads, waiting for quiet target edits but following thread status at once (WR 49)', () => {
  const doc = newDoc();
  createDocument(doc, { id: 'tab1', title: 'Plan', generateID: () => 'p1' });
  addThread(doc, { threadId: 'live', tabId: 'tab1', blockId: 'p1', quote: 'Plan', anchor: { kind: 'block' }, by: { kind: 'human' }, at: 1 });
  thread(doc, 'orphan');
  const { result, unmount } = renderHook(() => ({ total: useOpenThreadCount(doc), tabs: useOpenThreadCounts(doc) }));
  expect(result.current.total).toBe(1);
  expect([...result.current.tabs]).toEqual([['tab1', 1]]);
  const before = result.current.tabs;
  const block = tabBody(doc, 'tab1')!.get(0) as Node;
  for (const id of ['replacement1', 'replacement2', 'replacement3']) {
    act(() => block.setAttr('id', id));
    act(() => void vi.advanceTimersByTime(30));
    expect(result.current.tabs).toBe(before); // no document walk on every keystroke
  }
  act(() => void vi.advanceTimersByTime(20));
  expect(result.current.total).toBe(0);
  expect([...result.current.tabs]).toEqual([]);
  act(() => block.setAttr('id', 'p1'));
  act(() => void vi.advanceTimersByTime(50));
  expect(result.current.total).toBe(1);
  act(() => resolve(doc, 'live', { kind: 'human' }, 2));
  expect(result.current.total).toBe(0);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
