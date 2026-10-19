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
import { deckFiles, readFlat, setAttrs, setNotes, setStyle, setText, slideFile, slideOrder, zOrder } from '@artifacts/slides/model';
import { publishDeck } from '@artifacts/slides/publish';
import { loadSlide } from '@artifacts/slides/parse';
import type { SlideIR } from '@artifacts/slides/ir';
import { setDeckOverride } from '@artifacts/slides/writers';
import { deckScalars } from '@artifacts/yjs/slides';
import { onUpdate } from '@artifacts/yjs';
import type { DeckTimings } from '@artifacts/slides/editor/session';
import { setArmedPrototype, type ArmedMode } from '@artifacts/slides/editor/armed';
import { openDeckTabs } from './tab-state';

export type DeckSeamEdit =
  | { op: 'setStyle'; slideId: string; elementId: string; props: Record<string, string | null> }
  | { op: 'zOrder'; slideId: string; elementId: string; to: 'front' | 'back' | 'forward' | 'backward' }
  | { op: 'setNotes'; slideId: string; text: string }
  | { op: 'setOverride'; name: string; value: string | null }
  // M5: text put before an element's first line (a remote edit landing in a text box being edited)
  | { op: 'prependText'; slideId: string; elementId: string; text: string }
  // fix wave 1: attributes as another replica sets them (a picture's crop)
  | { op: 'setAttrs'; slideId: string; elementId: string; attrs: Record<string, string | null> };

/** Per-move times of a drag (ms): pointer move → the editor's transaction → the next frame (S7b's measure). */
export interface DragStats {
  moves: number;
  withTransaction: number;
  inputToTxMs: { p50: number; p95: number; max: number };
  inputToFrameMs: { p50: number; p95: number; max: number };
  longTasks: number;
}

export interface PresentationsSeam {
  /** Publishes `files` onto the deck (forced), removing its other slides; answers once the host has them. */
  seed(artifactId: string, files: Record<string, string>): Promise<{ changed: string[]; held: string[] }>;
  edit(artifactId: string, edit: DeckSeamEdit): Promise<void>;
  files(artifactId: string): Promise<Record<string, string>>;
  /** M5: a slide as the loader reads its file now (throws when the file is held). */
  slide(artifactId: string, slideId: string): Promise<SlideIR>;
  order(artifactId: string): Promise<string[]>;
  /** The open tabs showing the deck, with their timings (ms on the page's clock). */
  timings(artifactId: string): { surface: string; timings: DeckTimings }[];
  /** M5: measures the drags on the deck's open tab from now until `stop`. */
  dragProbe: { start(artifactId: string): void; stop(): DragStats };
  /** Fix wave 1: another replica selecting elements (its awareness), until cleared. */
  presence: { show(artifactId: string, slideId: string, elementIds: string[]): Promise<void>; clear(): Promise<void> };
  /** M5: an agent republishing one slide every `intervalMs` (the second slide on), until stopped; answers how many. */
  agent: { start(artifactId: string, intervalMs: number): Promise<void>; stop(): Promise<number> };
  /** P4-B2's spike S-IME: the ARMED prototype on in one mode, or off (null), in every deck editor of the window. */
  armed(mode: ArmedMode | null): void;
  /** P4-B2's spike: each open tab's selection and the text element edited, if any. */
  editorState(artifactId: string): { surface: string; selection: string[]; editingText: string | null }[];
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
        else if (edit.op === 'setNotes') setNotes(doc, edit.slideId, edit.text, 'e2e');
        else if (edit.op === 'prependText') {
          const blocks = readFlat(doc, edit.slideId).find((e) => e.id === edit.elementId)?.text ?? [{ type: 'p' as const, inline: [] }];
          const [first, ...rest] = blocks;
          setText(doc, edit.slideId, edit.elementId, [{ ...first!, inline: [{ text: edit.text, marks: {} }, ...first!.inline] }, ...rest], 'e2e');
        } else if (edit.op === 'setAttrs') setAttrs(doc, edit.slideId, edit.elementId, edit.attrs, 'e2e');
        else setDeckOverride(doc, edit.name, edit.value, 'e2e');
      }),
    files: (artifactId) => withReplica(artifactId, ({ doc }) => deckFiles(doc)),
    slide: (artifactId, slideId) =>
      withReplica(artifactId, ({ doc }) => {
        const loaded = loadSlide(slideFile(doc, slideId), { fileId: slideId });
        if (!loaded.ok) throw new Error(`slide ${slideId} is held: ${loaded.held.reasons.join('; ')}`);
        return loaded.slide;
      }),
    order: (artifactId) => withReplica(artifactId, ({ doc }) => slideOrder(doc)),
    timings: (artifactId) =>
      openDeckTabs()
        .filter((tab) => tab.artifactId === artifactId)
        .flatMap((tab) => {
          const session = tab.snapshot().session;
          return session ? [{ surface: tab.surface, timings: { ...session.timings } }] : [];
        }),
    dragProbe: dragProbe(win),
    presence: remotePresence(host),
    agent: agentRepublishing(host),
    armed: setArmedPrototype,
    editorState: (artifactId) =>
      openDeckTabs()
        .filter((tab) => tab.artifactId === artifactId)
        .flatMap((tab) => {
          const state = tab.snapshot().session?.snapshot();
          return state ? [{ surface: tab.surface, selection: [...state.selection], editingText: state.editingText }] : [];
        }),
  };
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]! * 10) / 10 : 0);
  return { p50: at(0.5), p95: at(0.95), max: s.length ? Math.round(s[s.length - 1]! * 10) / 10 : 0 };
};

// S7b's drag measure (spikes/p3-store/s7/electron/deck-page.ts): each pointer move while a button is down, the editor's
// transaction it caused (the replica's update with the session's origin), and the animation frame after it.
function dragProbe(win: Window): PresentationsSeam['dragProbe'] {
  let stop: (() => DragStats) | null = null;
  return {
    start(artifactId) {
      stop?.();
      const session = openDeckTabs().find((tab) => tab.artifactId === artifactId && tab.snapshot().session)?.snapshot().session;
      if (!session) throw new Error(`no open tab shows ${artifactId}`);
      const moves: { tIn: number; tTx?: number; tFrame?: number }[] = [];
      let longTasks = 0;
      const observer = new PerformanceObserver((list) => (longTasks += list.getEntries().length));
      observer.observe({ type: 'longtask' });
      const onMove = (e: PointerEvent) => {
        if (e.buttons) moves.push({ tIn: e.timeStamp });
      };
      win.document.addEventListener('pointermove', onMove, true);
      const off = onUpdate(session.doc, (_update, origin) => {
        const m = moves[moves.length - 1];
        if (origin !== session.origin || !m || m.tTx !== undefined) return;
        m.tTx = win.performance.now();
        win.requestAnimationFrame(() => (m.tFrame = win.performance.now()));
      });
      stop = () => {
        win.document.removeEventListener('pointermove', onMove, true);
        off();
        observer.disconnect();
        stop = null;
        const tx = moves.filter((m) => m.tTx !== undefined);
        return {
          moves: moves.length,
          withTransaction: tx.length,
          inputToTxMs: stats(tx.map((m) => m.tTx! - m.tIn)),
          inputToFrameMs: stats(tx.filter((m) => m.tFrame !== undefined).map((m) => m.tFrame! - m.tIn)),
          longTasks,
        };
      };
    },
    stop: () => {
      if (!stop) throw new Error('the drag probe is not running');
      return stop();
    },
  };
}

// An agent's one-slide publishes, on a replica of its own: the slide's file read, a line of its first text element
// changed, published through the kind's three-way publish (A's tools do the same in the host); the editor's replica
// takes each as a remote update through the host, as it takes an agent's.
function agentRepublishing(host: () => ArtifactHost): PresentationsSeam['agent'] {
  let running: { handle: DocumentHandle; timer: ReturnType<typeof setInterval>; count: number } | null = null;
  return {
    async start(artifactId, intervalMs) {
      const handle = await host().open(artifactId);
      const state = { handle, count: 0, timer: undefined as unknown as ReturnType<typeof setInterval> };
      state.timer = setInterval(() => {
        const order = slideOrder(handle.doc);
        if (order.length < 2) return;
        const id = order[1 + (state.count % (order.length - 1))]!;
        const path = `project/slides/${id}.html`;
        const before = slideFile(handle.doc, id);
        const after = before.replace(/(<(?:h1|h2|p)\b[^>]*>)([^<]*)/, (_m, open: string, text: string) => `${open}${text.replace(/ \(rev \d+\)$/, '')} (rev ${state.count + 1})`);
        publishDeck(handle.doc, { [path]: before }, { [path]: after }, false);
        state.count++;
      }, intervalMs);
      running = state;
    },
    async stop() {
      if (!running) return 0;
      const { handle, timer, count } = running;
      running = null;
      clearInterval(timer);
      await acknowledged(handle);
      handle.close();
      return count;
    },
  };
}

// Another replica's selection, as its editor publishes it (DeckSession's presence): a replica of its own, held open
// with its awareness set, until cleared.
function remotePresence(host: () => ArtifactHost): PresentationsSeam['presence'] {
  let held: DocumentHandle | null = null;
  return {
    async show(artifactId, slideId, elementIds) {
      held ??= await host().open(artifactId);
      held.awareness.setLocalState({ name: 'Claude', color: '--author-3', deck: { slideId, elementIds } });
    },
    async clear() {
      held?.awareness.setLocalState(null);
      held?.close();
      held = null;
    },
  };
}
