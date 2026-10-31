// When a pane asks for the page of rows before its oldest held one: when the reader scrolls to the top; while what is
// drawn does not fill the pane (an empty list cannot scroll at all, so its top loader would never fire); and again
// after a page that drew nothing new while the reader is still at the top. Held rows can draw nothing (progress
// records, most attachments, a result whose call is older still), so paging goes on until a page adds a drawn row or
// no older rows remain — never keyed on drawn rows alone. What is drawn is what MAWS's list draws (`drawn-rows.ts`): in
// the report, a page of unmarked text inside a turn already marked folds into its closed working record, held but not
// drawn, and the list grows by nothing; so does a page that folds a turn it marks, which can draw fewer rows than
// before. A page counts as progress only when the list grew. A page's rows count as drawn only once MAWS's store holds
// them: a page that brings rows rebuilds the source, which the store installs (`hydrating`, then `live`) after the
// render that names it. P5 O9 M9: a page the plane could not carry (`olderFailed`) is not asked again from here, which
// would spin while another machine's link is down; the transcript asks it once the plane delivers again, or the reader.
// The long-transcript window (docs/doperpowers/plans/2026-10-30-long-transcript-window.md): MAWS's own disk-backed
// sessions page the same way, through their source's pager (transcript/source/older.ts), whose `source` stand-in is the
// revision a page bumps.
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useTranscriptStore } from '../../stores/transcript';
import type { TranscriptListHandle } from '../../transcript/view/Transcript';
import { useDrawnRowCount } from './drawn-rows';

/** What the hook reads of a paged transcript: lane A's plane transcript, or a MAWS source's pager. */
export interface OlderPagesView {
  phase: string;
  more: boolean;
  loadingOlder: boolean;
  olderFailed: string | null;
  source: unknown; // changes when a page's rows are handed to the store
}

export interface OlderPagesController {
  readonly key: string;
  readonly state: { getState(): OlderPagesView };
  loadOlder(): void;
}

/** Within this many pixels of the top the reader has reached it, and older rows are asked for. */
export const TOP = 160;

type Asked = { drawn: number; source: unknown; installed: boolean };

export function useOlderPages(controller: OlderPagesController, list: RefObject<TranscriptListHandle | null>, state: OlderPagesView, atRest = false): void {
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
    if (state.olderFailed !== null) return; // P5 O9 M9: the plane could not carry the last ask; its next delivery asks again
    const element = list.current?.scrollElement;
    if (!element) return;
    const pending = asked.current;
    if (pending !== null && pending.source !== state.source && !pending.installed) return; // the page's rows are not drawn yet
    asked.current = null;
    const nothingNew = pending !== null && drawnRows <= pending.drawn && element.scrollTop <= TOP;
    if (drawnRows === 0 || element.scrollHeight - element.clientHeight <= TOP || nothingNew) ask();
  }, [ask, list, drawnRows, storePhase, state.phase, state.more, state.loadingOlder, state.source, state.olderFailed]);
}
