// P4-B4 (docs/doperpowers/plans/2026-10-20-p4-b4-tool-surface.md, "Opening at a place"): a place in a deck or a design
// asked from outside the editor (a link's fragment, `show_pane`'s `at`), shared by the deck editor and the design
// workbench, whose slides and boards are the same model. Each new serial is handled once: the slide (a design's board) is
// shown when the artifact has it, the editor's own way; a version named by its id is previewed in the history rail once
// the history says the artifact retains it; without one, a preview shown gives way to the live artifact at that slide. A
// place the artifact does not have changes nothing, as a plain open.
import { useEffect, useRef } from 'react';
import type { ArtifactLocation } from '@shared/artifacts/link';
import { hasSlide } from '../../yjs/slides';
import type { DeckHistoryController } from './history/controller';
import type { DeckSession } from './session';

/** A place to show, a new serial per ask. */
export interface DeckReveal {
  serial: number;
  location?: ArtifactLocation;
}

export interface DeckRevealProps {
  reveal?: DeckReveal | null;
  /** Told each serial as it is handled (the caller takes its request). */
  onRevealed?(serial: number): void;
}

export function useDeckReveal({ reveal, onRevealed, session, history, showSlide }: DeckRevealProps & { session: DeckSession; history: DeckHistoryController | null; showSlide(slideId: string): void }): void {
  const handled = useRef<number | null>(null);
  // whether the editor is still mounted when a version's check answers (the reveal itself is gone by then: it was taken)
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!reveal || handled.current === reveal.serial) return;
    const asked = (handled.current = reveal.serial);
    onRevealed?.(asked);
    const { slide, version } = reveal.location ?? {};
    const shown = slide !== undefined && hasSlide(session.doc, slide);
    if (shown) showSlide(slide);
    if (version === undefined || !history) {
      if (shown) history?.close(); // a place in the live artifact: the live artifact shows
      return;
    }
    void history.hasVersion(version).then(
      (retained) => {
        if (!retained || !mounted.current || handled.current !== asked) return; // gone, or a later reveal took over
        if (session.snapshot().rail !== 'history') session.toggleRail('history');
        void history.select(version);
      },
      () => {}, // the list unread: a plain open
    );
  }, [reveal, onRevealed, session, history, showSlide]);
}
