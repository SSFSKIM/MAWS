// The design's e2e seam (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3): `window.__maws_design`,
// installed only in a window main loaded for the e2e harness (`e2e=1`, as the presentations' seam). It seeds a design
// from files in the product build: a replica of an existing design opened through the window's real ArtifactHost, the
// files published onto it by the kind's own publish (`publishCanvas`, forced, every board the files leave out removed),
// acknowledged by the host before it answers; the design is created by the human's `artifacts.create`, which writes
// the kind's first board (the agent's `artifact_create` with files is the live run's). It also writes through the
// model's writers on a replica of its own (what an agent's or another replica's edit looks like to the workbench),
// reads the design back, and reports each open tab's view (its zoom, pan, active board, selection, selected frame) and
// its open-to-drawn timings.
import type { ArtifactHost, DocumentHandle } from '@artifacts/host';
import { boardIdOf, CANVAS_PATH, type BoardFrame } from '@artifacts/design/canvas';
import { boardFrame, boardOrder, designFiles } from '@artifacts/design/model';
import { publishCanvas } from '@artifacts/design/publish';
import { setBoardFrame } from '@artifacts/design/writers';
import type { Viewport } from '@artifacts/design/editor/viewport';
import type { SlideIR } from '@artifacts/slides/ir';
import { readFlat, setStyle, setText, slideFile } from '@artifacts/slides/model';
import { loadSlide } from '@artifacts/slides/parse';
import type { DeckTimings } from '@artifacts/slides/editor/session';
import * as Y from '@artifacts/yjs/slides';
import { openDesignTabs } from './tab-state';

export type DesignSeamEdit =
  | { op: 'setStyle'; boardId: string; elementId: string; props: Record<string, string | null> }
  // text put before an element's first line (a remote edit landing in a text box being edited)
  | { op: 'prependText'; boardId: string; elementId: string; text: string }
  | { op: 'setFrame'; boardId: string; frame: Partial<BoardFrame> };

export interface DesignTabView {
  surface: string;
  viewport: Viewport | null;
  /** The room the view last fitted into (the world's size as measured). */
  room: { w: number; h: number } | null;
  frame: string | null;
  currentBoard: string | null;
  selection: readonly string[];
  timings: DeckTimings;
}

export interface DesignSeam {
  /** Publishes `files` onto the design (forced), removing its other boards; answers once the host has them. */
  seed(artifactId: string, files: Record<string, string>): Promise<{ changed: string[]; held: string[] }>;
  edit(artifactId: string, edit: DesignSeamEdit): Promise<void>;
  files(artifactId: string): Promise<Record<string, string>>;
  /** The boards in order with their frames and titles, as the model holds them. */
  boards(artifactId: string): Promise<{ id: string; frame: BoardFrame | null; title: string | null }[]>;
  /** A board as the loader reads its file now (throws when the file is held). */
  board(artifactId: string, boardId: string): Promise<SlideIR>;
  /** The open tabs showing the design, with their views. */
  tabs(artifactId: string): DesignTabView[];
}

declare global {
  interface Window {
    __maws_design?: DesignSeam;
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

export function installDesignSeam(win: Window, host: () => ArtifactHost): void {
  if (win.__maws_design) return;
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
  win.__maws_design = {
    seed: (artifactId, files) =>
      withReplica(artifactId, ({ doc }) => {
        const base = designFiles(doc);
        const sent: Record<string, string | null> = { ...files };
        for (const path of Object.keys(base)) if (path !== CANVAS_PATH && boardIdOf(path) !== null && !(path in files)) sent[path] = null;
        const outcome = publishCanvas(doc, base, sent, true);
        return { changed: outcome.changed, held: outcome.held.map((h) => h.path) };
      }),
    edit: (artifactId, edit) =>
      withReplica(artifactId, ({ doc }) => {
        if (edit.op === 'setStyle') setStyle(doc, edit.boardId, edit.elementId, edit.props, 'e2e');
        else if (edit.op === 'setFrame') setBoardFrame(doc, edit.boardId, edit.frame, 'e2e');
        else {
          const blocks = readFlat(doc, edit.boardId).find((e) => e.id === edit.elementId)?.text ?? [{ type: 'p' as const, inline: [] }];
          const [first, ...rest] = blocks;
          setText(doc, edit.boardId, edit.elementId, [{ ...first!, inline: [{ text: edit.text, marks: {} }, ...first!.inline] }, ...rest], 'e2e');
        }
      }),
    files: (artifactId) => withReplica(artifactId, ({ doc }) => designFiles(doc)),
    boards: (artifactId) =>
      withReplica(artifactId, ({ doc }) =>
        boardOrder(doc).map((id) => {
          const title = Y.slideScalars(doc, id).title;
          return { id, frame: boardFrame(doc, id), title: typeof title === 'string' ? title : null };
        }),
      ),
    board: (artifactId, boardId) =>
      withReplica(artifactId, ({ doc }) => {
        const loaded = loadSlide(slideFile(doc, boardId), { fileId: boardId });
        if (!loaded.ok) throw new Error(`board ${boardId} is held: ${loaded.held.reasons.join('; ')}`);
        return loaded.slide;
      }),
    tabs: (artifactId) =>
      openDesignTabs()
        .filter((tab) => tab.artifactId === artifactId)
        .flatMap((tab) => {
          const session = tab.snapshot().session;
          if (!session) return [];
          const { viewport, room, frame } = tab.view.snapshot();
          const { currentSlide, selection } = session.snapshot();
          return [{ surface: tab.surface, viewport, room, frame, currentBoard: currentSlide, selection, timings: { ...session.timings } }];
        }),
  };
}
