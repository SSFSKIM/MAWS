// When a pane asks for the page of rows before its oldest held one: when the reader scrolls to the top; while what is
// drawn does not fill the pane (an empty list cannot scroll at all, so its top loader would never fire); and again
// after a page that drew nothing new while the reader is still at the top. Held rows can draw nothing (progress
// records, most attachments, a result whose call is older still), so paging goes on until a page adds a drawn row or
// no older rows remain — never keyed on drawn rows alone. What is drawn is what MAWS's list draws (`drawn-rows.ts`): in
// the report, a page of unmarked text inside a turn already marked folds into its closed working record, held but not
// drawn, and the list grows by nothing; so does a page that folds a turn it marks, which can draw fewer rows than
// before. A page counts as progress only when the list grew. A page's rows count as drawn only once MAWS's store holds
// them: a page that brings rows rebuilds the source, which the store installs (`hydrating`, then `live`) after the
// render that names it.
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { TranscriptSource } from '../../../../../src/renderer/src/transcript/source/types';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import type { DeskTranscript, DepthTranscriptState } from '../source/desk-transcript';
import { useDrawnRowCount } from './drawn-rows';

/** Within this many pixels of the top the reader has reached it, and older rows are asked for. */
export const TOP = 160;

type Asked = { drawn: number; source: TranscriptSource; installed: boolean };

export function useOlderPages(controller: DeskTranscript, list: RefObject<TranscriptListHandle | null>, state: Pick<DepthTranscriptState, 'phase' | 'more' | 'loadingOlder' | 'source'>, atRest = false): void {
  const drawnRows = useDrawnRowCount(controller.key, atRest);
  const storePhase = useTranscriptStore((s) => s.entries[controller.key]?.phase ?? null);
  const drawn = useRef(drawnRows);
  const asked = useRef<Asked | null>(null);
  useEffect(() => {
    drawn.current = drawnRows;
  }, [drawnRows]);

  const ask = useCallback(() => {
    const { more, loadingOlder, source } = controller.state.getState();
    if (!more || loadingOlder) return;
    asked.current = { drawn: drawn.current, source, installed: false };
    controller.loadOlder();
  }, [controller]);

  useEffect(() => {
    const element = list.current?.scrollElement;
    if (!element) return;
    const scrolled = () => {
      if (element.scrollTop <= TOP) ask();
    };
    element.addEventListener('scroll', scrolled, { passive: true });
    return () => element.removeEventListener('scroll', scrolled);
  }, [ask, list]);

  // The store installing a page's rebuilt source.
  useEffect(() => {
    if (storePhase !== 'live' && asked.current !== null) asked.current.installed = true;
  }, [storePhase]);

  useEffect(() => {
    if (state.phase !== 'live' || !state.more || state.loadingOlder || storePhase !== 'live') return;
    const element = list.current?.scrollElement;
    if (!element) return;
    const pending = asked.current;
    if (pending !== null && pending.source !== state.source && !pending.installed) return; // the page's rows are not drawn yet
    asked.current = null;
    const nothingNew = pending !== null && drawnRows <= pending.drawn && element.scrollTop <= TOP;
    if (drawnRows === 0 || element.scrollHeight - element.clientHeight <= TOP || nothingNew) ask();
  }, [ask, list, drawnRows, storePhase, state.phase, state.more, state.loadingOlder, state.source]);
}
