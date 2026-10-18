// The design's e2e seam (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3): `window.__maws_design`,
// installed only in a window main loaded for the e2e harness (`e2e=1`, as the presentations' seam). It seeds a design
// from files in the product build: a replica of an existing design opened through the window's real ArtifactHost, the
// files published onto it by the kind's own publish (`publishCanvas`, forced, every board the files leave out removed),
// acknowledged by the host before it answers; the design is created by the human's `artifacts.create`, which writes
// the kind's first board (the agent's `artifact_create` with files is the live run's). It also writes through the
// model's writers on a replica of its own (what an agent's or another replica's edit looks like to the workbench),
// reads the design back, and reports each open tab's view (its zoom, pan, active board, selection, selected frame) and
// its open-to-drawn timings. M4: it adds a thread as the owner (a comment the e2e cannot send through a session), reads
// the threads as C's model derives them, and answers the id a cross-board move would derive (so a spec can put an
// element under that id on the destination first: XE4's collision case). M6: two probes on a tab's own public parts
// (no provider patched, no timing API shared): `frameProbe` arms, before an edit is made elsewhere, a MutationObserver on
// the receiving surface and the receiving replica's `beforeTransaction`, which for a transaction whose origin is the
// replica's PortProvider (an inbound frame, applied synchronously from receipt) notes the start and asks one animation
// frame, the sentinel; the transaction that turns the expected model value true is the edit's, and the result says whether
// every expected DOM value stood when its sentinel ran (the next rendering opportunity after it arrived), and when the
// observer first saw them: remote-transaction-start to DOM-observed, not port arrival. A composition hold (an open text
// box on the receiving surface) refuses to arm, since held frames apply only when it ends. `layoutProbe` arms a fresh
// `onLayout` listener on every canvas the tab's live world draws, so a re-layout of every board is counted from new
// observations, never from a resolved `whenLaidOut`.
import type { ArtifactHost, DocumentHandle } from '@artifacts/host';
import { boardIdOf, CANVAS_PATH, type BoardFrame } from '@artifacts/design/canvas';
import { boardFrame, boardOrder, designFiles } from '@artifacts/design/model';
import { publishCanvas } from '@artifacts/design/publish';
import { moveElementToBoard } from '@artifacts/design/move';
import { setBoardFrame } from '@artifacts/design/writers';
import type { Viewport } from '@artifacts/design/editor/viewport';
import type { SlideIR } from '@artifacts/slides/ir';
import { readFlat, setStyle, setText, slideFile } from '@artifacts/slides/model';
import { addThread, threadStates } from '@artifacts/slides/threads';
import { applyV2, newDoc, stateV2, type Doc } from '@artifacts/yjs';
import { loadSlide } from '@artifacts/slides/parse';
import type { DeckTimings } from '@artifacts/slides/editor/session';
import * as Y from '@artifacts/yjs/slides';
import { PortProvider } from '@artifacts/provider/port';
import { openDesignTabs, type DesignTabState } from './tab-state';

export type DesignSeamEdit =
  | { op: 'setStyle'; boardId: string; elementId: string; props: Record<string, string | null> }
  // text put before an element's first line (a remote edit landing in a text box being edited)
  | { op: 'prependText'; boardId: string; elementId: string; text: string }
  | { op: 'setFrame'; boardId: string; frame: Partial<BoardFrame> }
  // M4: a thread on a board (`elementId` '') or an element, opened by the owner with its first message
  | { op: 'addThread'; threadId: string; boardId: string; elementId: string; body: string };

/** M4: a thread as C's model derives it, plain. */
export interface DesignSeamThread {
  id: string;
  slideId: string;
  elementId: string;
  quote: string;
  status: string;
  live: boolean;
  orphan: boolean;
  messages: { body: string; by: string }[];
}

/** M6: what the edit sets in the model, which tells its transaction from any other. */
export type FrameProbeModel = { kind: 'frame'; boardId: string; key: 'x' | 'y' | 'w' | 'h'; value: number } | { kind: 'style'; boardId: string; elementId: string; prop: string; value: string };
/** M6: a DOM value the receiving surface must show: a node's inline style property (no style or layout is forced). */
export interface FrameProbeDom {
  /** Under the receiving surface's root. */
  selector: string;
  style: string;
  equals: string;
}
export interface FrameProbeResult {
  surface: string;
  /** Inbound transactions seen while armed, the edit's included. */
  inbound: number;
  /** The edit's transaction start (performance.now()). */
  startedAt: number;
  /** Remote-transaction-start to the observer first seeing every expected value; null if not seen by the sentinel. */
  domObservedMs: number | null;
  /** Remote-transaction-start to the sentinel (the next animation frame's callback). */
  sentinelMs: number;
  /** Each expected value as the sentinel read it. */
  atSentinel: { selector: string; style: string; value: string | null; ok: boolean }[];
  /** Every expected value stood at the sentinel and the observer saw them before it. */
  withinFrame: boolean;
}
export interface LayoutProbeResult {
  armedAt: number;
  /** DL39: when the requested token first stood in the world's scope style (performance.now()); null until it does, or without one asked. */
  scopeAt: number | null;
  /** Each board's layout passes since arming (performance.now()), by board. */
  layouts: Record<string, number[]>;
}
/**
 * DL39: what the layout probe adds for a trace's reader: with `mark`, a `performance.mark` at each canvas's layout
 * (`<mark>:layout:<board>:<n>`) and, with `scope`, one when the token's value first stands in the world's scope style
 * (`<mark>:scope`): the last declaration of `token` in the `<style>` of the scope the world's boards draw in, read as
 * text, so no style or layout is forced while the pass is pending.
 */
export interface LayoutProbeOptions {
  mark?: string;
  scope?: { token: string; value: string };
}

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
  /** M4: every thread with its derived state. */
  threads(artifactId: string): Promise<DesignSeamThread[]>;
  /** M4: the id a move of `elementId` from `from` to `to` would give it now (on a copy; nothing written). */
  derivedId(artifactId: string, from: string, to: string, elementId: string): Promise<string>;
  /** M6: the within-a-frame proof on the receiving `surface`, armed before the edit is made elsewhere. */
  frameProbe: {
    arm(artifactId: string, surface: string, model: FrameProbeModel, dom: FrameProbeDom[]): string;
    /** The result once the edit's sentinel ran (the probe disarmed then), else null. */
    result(probe: string): FrameProbeResult | null;
    disarm(probe: string): void;
  };
  /** M6: fresh layout observations on every canvas of the tab on `surface`. */
  layoutProbe: {
    arm(artifactId: string, surface: string, options?: LayoutProbeOptions): string;
    result(probe: string): LayoutProbeResult;
    disarm(probe: string): void;
  };
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

function tabOn(artifactId: string, surface: string): DesignTabState {
  const tab = openDesignTabs().find((t) => t.artifactId === artifactId && t.surface === surface);
  if (!tab) throw new Error(`no ${surface} tab shows ${artifactId}`);
  return tab;
}

function modelHolds(doc: Doc, model: FrameProbeModel): boolean {
  if (model.kind === 'frame') return boardFrame(doc, model.boardId)?.[model.key] === model.value;
  return readFlat(doc, model.boardId).find((e) => e.id === model.elementId)?.style[model.prop] === model.value;
}

/** M6: the within-a-frame probe on the tab showing `artifactId` on `surface` (see the header). */
function armFrameProbe(win: Window, artifactId: string, surface: string, model: FrameProbeModel, dom: FrameProbeDom[]): { result(): FrameProbeResult | null; disarm(): void } {
  const tab = tabOn(artifactId, surface);
  const doc = tab.snapshot().handle?.doc;
  if (!doc) throw new Error(`the ${surface} tab of ${artifactId} has no replica`);
  const root = win.document.querySelector<HTMLElement>(`[data-design-artifact="${artifactId}"][data-design-surface="${surface}"]`);
  if (!root) throw new Error(`no ${surface} body shows ${artifactId}`);
  return frameProbe(win, doc, root, surface, model, dom);
}

/** M6: the within-a-frame probe over a receiving replica's doc and the surface `root` drawing it. */
export function frameProbe(win: Window, doc: Doc, root: HTMLElement, surface: string, model: FrameProbeModel, dom: FrameProbeDom[]): { result(): FrameProbeResult | null; disarm(): void } {
  if (root.querySelector('.deck-textbox')) throw new Error(`a text box is open on the ${surface} surface: its composition hold would hold the edit`);
  if (modelHolds(doc, model)) throw new Error(`the ${surface} replica already holds the expected value`);
  const read = () =>
    dom.map((d) => {
      const node = root.querySelector<HTMLElement>(d.selector);
      const value = node ? node.style.getPropertyValue(d.style) : null;
      return { selector: d.selector, style: d.style, value, ok: value === d.equals };
    });
  let inbound = 0;
  let edit: { startedAt: number } | null = null;
  let observedAt: number | null = null;
  let done: FrameProbeResult | null = null;
  const observer = new (win as Window & typeof globalThis).MutationObserver(() => {
    if (observedAt === null && read().every((r) => r.ok)) observedAt = win.performance.now();
  });
  const before = (tr: { origin: unknown }) => {
    if (!(tr.origin instanceof PortProvider) || edit !== null) return;
    inbound += 1;
    const startedAt = win.performance.now();
    const wasTrue = modelHolds(doc, model);
    // the sentinel asked before the transaction applies: the next rendering opportunity after this frame arrived
    win.requestAnimationFrame(() => {
      if (done !== null || edit?.startedAt !== startedAt) return;
      const sentinelAt = win.performance.now();
      const atSentinel = read();
      done = { surface, inbound, startedAt, domObservedMs: observedAt === null ? null : observedAt - startedAt, sentinelMs: sentinelAt - startedAt, atSentinel, withinFrame: observedAt !== null && observedAt <= sentinelAt && atSentinel.every((r) => r.ok) };
      disarm();
    });
    // the transaction's own effect decides whether it is the edit's: the expected value turned true by it (read once the
    // synchronous apply, its observers included, has returned)
    queueMicrotask(() => {
      if (edit === null && !wasTrue && modelHolds(doc, model)) edit = { startedAt };
    });
  };
  const disarm = () => {
    observer.disconnect();
    doc.off('beforeTransaction', before);
  };
  observer.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
  doc.on('beforeTransaction', before);
  return { result: () => done, disarm };
}

/** M6: fresh `onLayout` observations on every canvas the tab's live world draws. */
/** DL39: the value a stylesheet's last declaration of the custom property `token` gives it (an override block comes last), else null. */
export function lastDeclaration(css: string, token: string): string | null {
  const escaped = token.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const found = [...css.matchAll(new RegExp(`(?:^|[;{\\s])${escaped}\\s*:\\s*([^;}]+)`, 'g'))].at(-1);
  return found ? found[1]!.trim() : null;
}

function armLayoutProbe(win: Window, artifactId: string, surface: string, options: LayoutProbeOptions = {}): { result(): LayoutProbeResult; disarm(): void } {
  const tab = tabOn(artifactId, surface);
  if (tab.canvases.size === 0) throw new Error(`the ${surface} tab of ${artifactId} draws no canvas`);
  const { mark, scope } = options;
  const armedAt = win.performance.now();
  const layouts: Record<string, number[]> = {};
  const offs = [...tab.canvases].map(([boardId, canvas]) => {
    layouts[boardId] = [];
    return canvas.onLayout(() => {
      layouts[boardId]!.push(win.performance.now());
      if (mark) win.performance.mark(`${mark}:layout:${boardId}:${layouts[boardId]!.length}`);
    });
  });
  let scopeAt: number | null = null;
  let observer: MutationObserver | null = null;
  if (scope) {
    const root = win.document.querySelector<HTMLElement>(`[data-design-artifact="${artifactId}"][data-design-surface="${surface}"]`);
    if (!root) throw new Error(`no ${surface} body shows ${artifactId}`);
    const stands = () => {
      const id = root.querySelector<HTMLElement>('[data-design-world] .deck-ds-scope[data-ds-scope]')?.dataset.dsScope;
      const style = id ? [...win.document.head.querySelectorAll<HTMLStyleElement>('style[data-ds-scope-style]')].find((el) => el.dataset.dsScopeStyle === id) : undefined;
      const declared = lastDeclaration(style?.textContent ?? '', scope.token);
      return declared !== null && declared.toLowerCase() === scope.value.toLowerCase();
    };
    if (stands()) {
      offs.forEach((off) => off());
      throw new Error(`the ${surface} scope already declares ${scope.token}: ${scope.value}`);
    }
    observer = new (win as Window & typeof globalThis).MutationObserver(() => {
      if (scopeAt !== null || !stands()) return;
      scopeAt = win.performance.now();
      if (mark) win.performance.mark(`${mark}:scope`);
    });
    observer.observe(win.document.head, { childList: true, subtree: true, characterData: true });
    observer.observe(root, { attributes: true, attributeFilter: ['data-ds-scope'], subtree: true });
  }
  return {
    result: () => ({ armedAt, scopeAt, layouts: Object.fromEntries(Object.entries(layouts).map(([b, at]) => [b, [...at]])) }),
    disarm: () => {
      observer?.disconnect();
      offs.forEach((off) => off());
    },
  };
}

export function installDesignSeam(win: Window, host: () => ArtifactHost): void {
  if (win.__maws_design) return;
  const probes = new Map<string, { result(): unknown; disarm(): void }>();
  let probeSeq = 0;
  const keep = (probe: { result(): unknown; disarm(): void }) => {
    const id = `probe-${++probeSeq}`;
    probes.set(id, probe);
    return id;
  };
  const probe = (id: string) => {
    const p = probes.get(id);
    if (!p) throw new Error(`no probe ${id}`);
    return p;
  };
  const drop = (id: string) => {
    probe(id).disarm();
    probes.delete(id);
  };
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
        else if (edit.op === 'addThread') addThread(doc, { threadId: edit.threadId, slideId: edit.boardId, elementId: edit.elementId, quote: '', by: { kind: 'human' }, at: Date.now(), body: edit.body }, 'deck-comments');
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
    threads: (artifactId) =>
      withReplica(artifactId, ({ doc }) =>
        threadStates(doc).map((t) => ({ id: t.id, slideId: t.slideId, elementId: t.elementId, quote: t.quote, status: t.status, live: t.live, orphan: t.orphan, messages: t.messages.map((m) => ({ body: m.body, by: m.by.kind === 'session' ? `session:${m.by.appSessionId}` : m.by.kind })) })),
      ),
    derivedId: (artifactId, from, to, elementId) =>
      withReplica(artifactId, ({ doc }) => {
        const scratch = newDoc();
        try {
          applyV2(scratch, stateV2(doc));
          return moveElementToBoard(scratch, from, to, elementId).ids.get(elementId)!;
        } finally {
          scratch.destroy();
        }
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
    frameProbe: {
      arm: (artifactId, surface, model, dom) => keep(armFrameProbe(win, artifactId, surface, model, dom)),
      result: (id) => probe(id).result() as FrameProbeResult | null,
      disarm: drop,
    },
    layoutProbe: {
      arm: (artifactId, surface, options) => keep(armLayoutProbe(win, artifactId, surface, options)),
      result: (id) => probe(id).result() as LayoutProbeResult,
      disarm: drop,
    },
  };
}
