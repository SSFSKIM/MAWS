// The presentations' e2e seam (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M4): `window.__maws_presentations`,
// installed only in a window main loaded for the e2e harness (`e2e=1`, as A's store seam). It seeds a deck from files
// in the product build: a replica of an existing presentation opened through the window's real ArtifactHost, the files
// published onto it by the kind's own three-way publish (`publishDeck`, forced, every slide the files leave out
// removed), acknowledged by the host before it answers. The deck is created by the human's `artifacts.create`, which
// writes the kind's cover (M3's adapter, `initial`); the seed replaces it (an agent seeds a deck through M3's
// `artifact_create` with `files`, which the live run exercises). It also writes through the
// model's writers on a replica of its own (what an agent's or another replica's edit looks like to the editor), reads
// the deck's files back, and reports each open tab's open-to-drawn timings (Acceptance 7's cold open).
import type { ArtifactHost, DocumentHandle } from '@artifacts/host';
import { DECK_PATH, slideIdOf } from '@artifacts/slides/deck';
import { deckFiles, setNotes, setStyle, slideOrder, zOrder } from '@artifacts/slides/model';
import { publishDeck } from '@artifacts/slides/publish';
import { deckScalars } from '@artifacts/yjs/slides';
import type { DeckTimings } from '@artifacts/slides/editor/session';
import { openDeckTabs } from './tab-state';

export type DeckSeamEdit =
  | { op: 'setStyle'; slideId: string; elementId: string; props: Record<string, string | null> }
  | { op: 'zOrder'; slideId: string; elementId: string; to: 'front' | 'back' | 'forward' | 'backward' }
  | { op: 'setNotes'; slideId: string; text: string };

export interface PresentationsSeam {
  /** Publishes `files` onto the deck (forced), removing its other slides; answers once the host has them. */
  seed(artifactId: string, files: Record<string, string>): Promise<{ changed: string[]; held: string[] }>;
  edit(artifactId: string, edit: DeckSeamEdit): Promise<void>;
  files(artifactId: string): Promise<Record<string, string>>;
  order(artifactId: string): Promise<string[]>;
  /** The open tabs showing the deck, with their timings (ms on the page's clock). */
  timings(artifactId: string): { surface: string; timings: DeckTimings }[];
}

declare global {
  interface Window {
    __maws_presentations?: PresentationsSeam;
  }
}

/** Resolves once the host holds every edit the replica made. */
function acknowledged(handle: DocumentHandle): Promise<void> {
  return new Promise((resolve) => {
    if (handle.state().unsaved === 0) return resolve();
    const off = handle.subscribe((state) => {
      if (state.unsaved > 0) return;
      off();
      resolve();
    });
  });
}

export function installPresentationsSeam(win: Window, host: () => ArtifactHost): void {
  const withReplica = async <T>(artifactId: string, write: (handle: DocumentHandle) => T): Promise<T> => {
    const handle = await host().open(artifactId);
    try {
      const result = write(handle);
      await acknowledged(handle);
      return result;
    } finally {
      handle.close();
    }
  };
  win.__maws_presentations = {
    seed: (artifactId, files) =>
      withReplica(artifactId, ({ doc }) => {
        const empty = slideOrder(doc).length === 0 && Object.keys(deckScalars(doc)).length === 0;
        const base = empty ? {} : deckFiles(doc);
        const sent: Record<string, string | null> = { ...files };
        for (const path of Object.keys(base)) if (path !== DECK_PATH && slideIdOf(path) !== null && !(path in files)) sent[path] = null;
        const outcome = publishDeck(doc, base, sent, true);
        return { changed: outcome.changed, held: outcome.held.map((h) => h.path) };
      }),
    edit: (artifactId, edit) =>
      withReplica(artifactId, ({ doc }) => {
        if (edit.op === 'setStyle') setStyle(doc, edit.slideId, edit.elementId, edit.props, 'e2e');
        else if (edit.op === 'zOrder') zOrder(doc, edit.slideId, edit.elementId, edit.to, 'e2e');
        else setNotes(doc, edit.slideId, edit.text, 'e2e');
      }),
    files: (artifactId) => withReplica(artifactId, ({ doc }) => deckFiles(doc)),
    order: (artifactId) => withReplica(artifactId, ({ doc }) => slideOrder(doc)),
    timings: (artifactId) =>
      openDeckTabs()
        .filter((tab) => tab.artifactId === artifactId)
        .flatMap((tab) => {
          const session = tab.snapshot().session;
          return session ? [{ surface: tab.surface, timings: { ...session.timings } }] : [];
        }),
  };
}
