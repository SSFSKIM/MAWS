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
import { PortProvider } from '@artifacts/provider/port';
import { DECK_PATH, slideIdOf } from '@artifacts/slides/deck';
import { deckFiles, readFlat, setAttrs, setNotes, setStyle, setText, slideFile, slideOrder, zOrder } from '@artifacts/slides/model';
import { publishDeck } from '@artifacts/slides/publish';
import { loadSlide } from '@artifacts/slides/parse';
import type { SlideIR } from '@artifacts/slides/ir';
import { setDeckOverride } from '@artifacts/slides/writers';
import { deckScalars } from '@artifacts/yjs/slides';
import type { DeckTimings } from '@artifacts/slides/editor/session';
import { summarizeDrag, type DragRecord, type DragStats, type RemoteApply } from './drag-stats';
import { openDeckTabs } from './tab-state';

export type { DragStats } from './drag-stats';

export type DeckSeamEdit =
  | { op: 'setStyle'; slideId: string; elementId: string; props: Record<string, string | null> }
  | { op: 'zOrder'; slideId: string; elementId: string; to: 'front' | 'back' | 'forward' | 'backward' }
  | { op: 'setNotes'; slideId: string; text: string }
  | { op: 'setOverride'; name: string; value: string | null }
  // M5: text put before an element's first line (a remote edit landing in a text box being edited)
  | { op: 'prependText'; slideId: string; elementId: string; text: string }
  // fix wave 1: attributes as another replica sets them (a picture's crop)
  | { op: 'setAttrs'; slideId: string; elementId: string; attrs: Record<string, string | null> };

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
  /**
   * M5: measures one drag on the deck's open tab from now until `stop`; P4-B2 M0: each move's queue, handler and paint,
   * and the remote applies beside them (`drag-stats.ts`); M6: the gesture hold's frames at the drop, its 5 s caps and
   * the frames it released.
   */
  dragProbe: { start(artifactId: string): void; stop(): DragStats };
  /** Fix wave 1: another replica selecting elements (its awareness), until cleared. */
  presence: { show(artifactId: string, slideId: string, elementIds: string[]): Promise<void>; clear(): Promise<void> };
  /** P4-B2: each open tab's selection, the text element edited if any, and whether its stage owns the keyboard. */
  editorState(artifactId: string): { surface: string; selection: string[]; editingText: string | null; keyboard: 'stage' | 'away' }[];
  /**
   * P4-B2 (tracker row 256): each open tab's replica, the remote content frames it has received and those its hold
   * buffers now (`PortProvider.counts`); M6: the times the hold's 5 s cap cleared it, the buffered frames its clearings
   * released, and the highest row the replica has integrated (its saved state's `integrated`, which a held row reaches
   * only once applied).
   */
  frames(artifactId: string): { surface: string; received: number; held: number; capped: number; released: number; integrated: number }[];
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
    editorState: (artifactId) =>
      openDeckTabs()
        .filter((tab) => tab.artifactId === artifactId)
        .flatMap((tab) => {
          const state = tab.snapshot().session?.snapshot();
          return state ? [{ surface: tab.surface, selection: [...state.selection], editingText: state.editingText, keyboard: state.keyboard }] : [];
        }),
    frames: (artifactId) =>
      openDeckTabs()
        .filter((tab) => tab.artifactId === artifactId)
        .flatMap((tab) => {
          const provider = providerOf(tab);
          return provider ? [{ surface: tab.surface, ...provider.counts(), integrated: provider.state.integrated }] : [];
        }),
  };
}

// The window's replica carries its provider (the renderer host's); the interface does not, being any host's.
function providerOf(tab: ReturnType<typeof openDeckTabs>[number]): PortProvider | null {
  const handle = tab.snapshot().handle as (DocumentHandle & { provider?: unknown }) | null;
  return handle?.provider instanceof PortProvider ? handle.provider : null;
}

// S7b's drag measure (spikes/p3-store/s7/electron/deck-page.ts), split by P4-B2 M0 (`drag-stats.ts`): each pointer move
// while a button is down, when its first listener ran (the probe's, capturing on the window, so before the editor's on
// its overlay), the editor's transaction it caused (the replica's update with the session's origin) and the animation
// frame after it; beside them each update of another origin (an agent's publish reaching the tab through the host) with
// its transaction's start, its next frame and the frame after that, and the drop. One drag per probe: a move after the
// drop, or a write of the session's after it (the gesture's end), is no move's. P4-B2 M6: the drop's listener
// (capturing on the window, before the editor's) reads the frames the replica's hold buffers, which the drop is about
// to flush; a clearance by the hold's 5 s cap is seen at the apply it causes (the provider counts it first), else at
// the next move or the drop; and the frames the hold released over the probe (the provider's count, from its start to
// its stop), the one proof that it buffered any (a cap over an empty buffer is counted too).
function dragProbe(win: Window): PresentationsSeam['dragProbe'] {
  let running: { record: DragRecord; end(): void } | null = null;
  return {
    start(artifactId) {
      running?.end();
      running = null;
      const tab = openDeckTabs().find((t) => t.artifactId === artifactId && t.snapshot().session);
      const session = tab?.snapshot().session;
      if (!tab || !session) throw new Error(`no open tab shows ${artifactId}`);
      const provider = providerOf(tab);
      const record: DragRecord = { moves: [], remotes: [], longTasks: 0, caps: [] };
      const now = () => win.performance.now();
      const nextFrame = (then: (at: number) => void) => win.requestAnimationFrame(() => then(now()));
      const observer = new PerformanceObserver((list) => (record.longTasks += list.getEntries().length));
      observer.observe({ type: 'longtask' });
      let capped = provider?.counts().capped ?? 0;
      const releasedBefore = provider?.counts().released ?? 0;
      const sawCaps = (at: number) => {
        for (const seen = provider?.counts().capped ?? 0; capped < seen; capped += 1) record.caps!.push(at);
      };
      const onMove = (e: PointerEvent) => {
        if (!e.buttons || record.drop !== undefined) return;
        record.moves.push({ tIn: e.timeStamp, tDispatch: now() });
        sawCaps(e.timeStamp);
      };
      const onUp = (e: PointerEvent) => {
        if (record.moves.length === 0 || record.drop !== undefined) return;
        record.drop = { tIn: e.timeStamp, tDispatch: now(), held: provider?.counts().held ?? 0 };
        sawCaps(e.timeStamp);
      };
      const begun = new WeakMap<object, number>();
      const onBefore = (tr: { origin: unknown }) => {
        if (tr.origin !== session.origin) begun.set(tr, now());
      };
      const onApplied = (_update: Uint8Array, origin: unknown, _doc: unknown, tr: object) => {
        const at = now();
        if (origin !== session.origin) {
          const remote: RemoteApply = { tStart: begun.get(tr) ?? at, tEnd: at };
          sawCaps(remote.tStart);
          record.remotes.push(remote);
          nextFrame((frame) => {
            remote.tFrame = frame;
            nextFrame((after) => (remote.tFrameEnd = after));
          });
          return;
        }
        const m = record.moves[record.moves.length - 1];
        if (record.drop !== undefined || !m || m.tTx !== undefined) return;
        m.tTx = at;
        nextFrame((frame) => (m.tFrame = frame));
      };
      win.addEventListener('pointermove', onMove, true);
      win.addEventListener('pointerup', onUp, true);
      session.doc.on('beforeTransaction', onBefore);
      session.doc.on('update', onApplied);
      running = {
        record,
        end() {
          record.released = (provider?.counts().released ?? 0) - releasedBefore;
          win.removeEventListener('pointermove', onMove, true);
          win.removeEventListener('pointerup', onUp, true);
          session.doc.off('beforeTransaction', onBefore);
          session.doc.off('update', onApplied);
          observer.disconnect();
        },
      };
    },
    stop: () => {
      if (!running) throw new Error('the drag probe is not running');
      const { record, end } = running;
      running = null;
      end();
      return summarizeDrag(record);
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
