// A transcript's older pages, for a source that answers its history one window at a time (the long-transcript window,
// docs/doperpowers/plans/2026-10-30-long-transcript-window.md; `source.older`, transcript/source/older.ts): lane A's
// rules, lifted as they are — a page asked when the reader reaches the top, while what is drawn does not fill the pane,
// and again after a page that drew nothing new (`useOlderPages`), and the reader's place kept through each
// (`useKeepPlaceThroughOlderRows`). A source without pages (a live session, a replay, a plane transcript) asks none.
import { useCallback, useMemo, useRef, useLayoutEffect, type RefObject } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { useKeepPlaceThroughOlderRows } from '../../lane-a/view/keep-place';
import { useOlderPages, type OlderPagesController, type OlderPagesView } from '../../lane-a/view/older-pages';
import type { Row } from '../model/rows';
import type { OlderPages, OlderPagesState, TranscriptSource } from '../source/types';
import type { TranscriptListHandle } from './Transcript';

const NO_PAGES: OlderPages = {
  state: createStore<OlderPagesState>(() => ({ more: false, loadingOlder: false, olderFailed: null, revision: 0 })),
  loadOlder: () => {},
};

// The pager's state as the lane A hook reads it: a source's history is always live, and its revision is what changes
// when a page's rows go to the store.
const viewOf = (state: OlderPagesState): OlderPagesView => ({ phase: 'live', more: state.more, loadingOlder: state.loadingOlder, olderFailed: state.olderFailed, source: state.revision });

/** The pager's state, with its pages asked for as the reader reaches the top; `rows` are the rows the list draws. */
export function useSourcePages(source: TranscriptSource, storeKey: string, list: RefObject<TranscriptListHandle | null>, rows: readonly Row[], atRest: boolean): { state: OlderPagesState; retry: () => void } {
  const pages = source.older ?? NO_PAGES;
  const state = useStore(pages.state);
  // A source without pages reads no key: the lane A hook then counts no drawn rows on every change for nothing.
  const key = pages === NO_PAGES ? '' : storeKey;
  const controller = useMemo<OlderPagesController>(() => ({ key, state: { getState: () => viewOf(pages.state.getState()) }, loadOlder: () => pages.loadOlder() }), [key, pages]);
  const drawn = useRef(rows);
  useLayoutEffect(() => {
    drawn.current = rows;
  }, [rows]);
  const indexOf = useCallback((id: string) => drawn.current.findIndex((row) => row.id === id), []);
  useKeepPlaceThroughOlderRows(list, rows, state.loadingOlder, indexOf);
  useOlderPages(controller, list, viewOf(state), atRest);
  return { state, retry: controller.loadOlder };
}
