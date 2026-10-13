// The rail's list follows the document after it goes quiet (M4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md,
// fix wave 1): its orphan state walks every tab's marks, so sustained typing must not rescan the document while it
// lasts; the list catches up one quiet moment after the last change.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newDoc, type Doc } from '../../../yjs';
import { addThread } from '../../threads';
import { useThreadStates } from './use-threads';

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
