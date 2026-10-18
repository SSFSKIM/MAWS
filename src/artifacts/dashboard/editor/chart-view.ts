// A dashboard's chart and table blocks in B's editor (P3-E2 M3; ledger X26's `renderChart`, E's Decision Log 6 and 19):
// the drawing of one `chart` atom through E's renderer, over the descriptor the displayed document names for the
// block's dataset (the live doc, a version's in history, the suggestion replica's) and the snapshot that descriptor
// names. It owns its lifetime: it follows the displayed document and that document's descriptor (a replacement changes
// neither of the atom's attributes, so B's redraw on an attribute change alone would miss it), reads the snapshot's rows
// through the tab's shared reader, drops any paint a later change has made stale, keeps the earlier figure dimmed while
// a replacement's rows are read, and releases everything (its subscriptions, its pending paint, its hover) through the
// disposer it answers. Under the figure: the source label (a button opening the source sheet on the descriptor as it
// was drawn) and the notes (validation mismatches, what the view could not show). The caption above is the spec's title.
// Portable: DOM only, no window.maws; the renderer's tab supplies the reader and the source sheet.
import type { TiptapEditorHTMLElement } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Actor } from '@shared/artifacts/actor';
import type { ViewEnvironment } from '../../document/editor/nodes/views';
import { onUpdate, type Doc } from '../../yjs';
import { datasetIdFromSource, readDataset, snapshotOf, type DatasetDescriptor } from '../datasets';
import { dsOverrides } from '../../document/meta';
import { captionOf, renderFailure, renderView, themeFrom, THEME_PROPERTIES, type Rendered, type Theme } from '../render';
import { parseSpec } from '../spec';
import { DATASET_STATES, mismatchNotes, sourceLabel } from '../states';
import { attachHover } from './hover';
import { livePauseLabel, livePauseOf, type LiveDatasets } from './live'; // E3
import type { SnapshotReader } from '../snapshots';

/** What the source sheet opens on: the dataset as the view drew it (a copy of its descriptor, never a live lookup) and
 * the view's spec, whose transformed rows the sheet shows beside the snapshot's. */
export interface SourceCapture {
  datasetId: string;
  descriptor: DatasetDescriptor;
  view?: { spec: unknown; caption: string };
}

export interface ChartRendererDeps {
  reader: SnapshotReader;
  /** The name an actor's updates are credited to (the human "You", a session its title, else "Claude"). */
  actorName(actor: Actor): string;
  openSource(capture: SourceCapture): void;
  /** E3 M3: the tab's live datasets, whose pause and clock a live view's label says (never a history preview's). */
  live?: LiveDatasets;
}

const CONNECT_MS = 2_000; // how long a view drawn detached (a preview's editor's) waits to be placed before it draws anyway

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  el.className = className;
  return el;
};

/** The figure's theme from the page's resolved `--ds-*` values (D's scope around the page; the house system without). */
function themeOf(into: HTMLElement): Theme {
  const style = getComputedStyle(into);
  return themeFrom(Object.fromEntries(THEME_PROPERTIES.map((name) => [name, style.getPropertyValue(name)]))).theme;
}

// The theme's input changes with no change of a view's own: D's scope style is rewritten in place when the governing
// system changes, a scope moves to another id when the document's overrides or system do (C's slide canvas follows the
// same two signals), and the document's own overrides live in its doc. Each live view registers its re-check; a signal
// re-checks them in the next frame, once, after the styles apply; a view whose resolved theme differs draws again from
// its cached rows.
const live = new Set<() => void>();
const due = new Set<() => void>();
let frameAsked = false;
function recheckSoon(check: () => void): void {
  due.add(check);
  if (frameAsked) return;
  frameAsked = true;
  requestAnimationFrame(() => {
    frameAsked = false;
    const checks = [...due];
    due.clear();
    for (const run of checks) run();
  });
}
const watched = new WeakSet<Document>();
function watchScopes(document: Document): void {
  if (watched.has(document)) return;
  watched.add(document);
  const Observer = document.defaultView?.MutationObserver;
  if (!Observer) return;
  const all = () => live.forEach(recheckSoon);
  const isScopeStyle = (node: Node | null) => node instanceof Element && node.tagName === 'STYLE' && node.hasAttribute('data-ds-scope-style');
  new Observer((records) => {
    if (records.some((r) => isScopeStyle(r.target) || isScopeStyle(r.target.parentNode) || [...r.addedNodes, ...r.removedNodes].some(isScopeStyle))) all();
  }).observe(document.head, { childList: true, subtree: true, characterData: true });
  new Observer(all).observe(document.body, { attributes: true, attributeFilter: ['data-ds-scope'], subtree: true });
}

// E2 M6: a drawing's cost (the renderer's view and its insertion into the page, from the snapshot's rows in hand) as a
// User Timing entry, `dash:view` with the dataset and the caption, which the scale gate observes (acceptance 7's
// 10,000-point row); cleared from the timeline at once, so a long session keeps none (an observer has it already).
function timed(start: number, dataset: string, caption: string): void {
  performance.measure('dash:view', { start, end: performance.now(), detail: { dataset, caption } });
  performance.clearMeasures('dash:view');
}

export function createChartRenderer(deps: ChartRendererDeps): NonNullable<ViewEnvironment['renderChart']> {
  return (into: HTMLElement, node: PMNode, env: ViewEnvironment) => {
    const datasetId = datasetIdFromSource(node.attrs.source);
    const spec: unknown = node.attrs.spec ?? null;
    const parsed = parseSpec(spec);
    const caption = parsed.ok ? captionOf(parsed.spec, datasetId) : (parsed.title ?? 'Chart');

    const view = element('figure', 'dash-view');
    const title = element('div', 'dash-caption');
    title.textContent = caption;
    const frame = element('div', 'dash-figure');
    const tip = element('div', 'dash-tip');
    tip.hidden = true;
    tip.setAttribute('role', 'status');
    const source = element('figcaption', 'dash-source');
    source.setAttribute('data-atom-controls', ''); // its button's clicks and keys are its own, not the editor's (B's atom view)
    view.append(title, frame, source);
    into.append(view);
    // E2 M6 (the tracker's last-block row): a press on the view is left to the editor. The default is refused once the
    // press has bubbled past the editor (ProseMirror ignores a press already refused), so the editor focuses itself and
    // selects the block on the click; the source label's controls keep their own presses. The evidence is one matched
    // stable-runner reproduction of the original layout, not a universal account of browser focus: without the refusal
    // (run 39001816938 at 30d7035fd) the Word comment case fails, 9/10, its log showing the block selection, the
    // editor's focus, a DOM caret in the first paragraph and a text selection replacing the block's; with it (run
    // 39002799612 at e6168906c) 10/10 pass, the editor's own DOM range and its NodeSelection held through Comment.
    // A press while the editor does not hold the keyboard (it went to a control since gone, a drawer's Close) has the
    // editor take it at once through its own focus, which puts the editor's selection in the DOM with it, so the
    // block's cut and keys reach the editor whether or not the editor's click handling then focuses it (E2 landing).
    // After the press in the failing landing run 39035344107 the chart was selected and the keyboard outside the
    // editor; why the editor did not take it there is not established.
    const pressed = (event: MouseEvent) => {
      if (event.button !== 0 || !view.contains(event.target as Node) || source.contains(event.target as Node)) return;
      event.preventDefault();
      const editor = into.closest<TiptapEditorHTMLElement>('.ProseMirror')?.editor;
      if (editor && !editor.view.dom.contains(into.ownerDocument.activeElement)) editor.view.focus();
    };
    into.ownerDocument.addEventListener('mousedown', pressed);
    const detachHover = attachHover(frame, tip);

    let released = false;
    let generation = 0;
    let drawnTheme: string | null = null; // the resolved theme the view was last drawn with
    let shown: { descriptor: DatasetDescriptor | null } | null = null; // the descriptor last asked for
    let drawnKey: string | null = null; // the descriptor last asked for, as JSON ('' for none)
    let stopDoc = () => {};

    // E3 M3: the label at the live clock with the live pause, for a view of a document that is not a retained version
    const labelText = (descriptor: DatasetDescriptor): string => {
      const by = descriptor.updated ? deps.actorName(descriptor.updated.by) : ''; // E3: a query never fetched names no author
      const live = deps.live;
      if (!live || descriptor.source.kind !== 'query' || env.displayed?.current().revision !== undefined) return sourceLabel(descriptor, by);
      const pause = livePauseOf(live.snapshot().queries.get(datasetId));
      return sourceLabel(descriptor, by, { now: live.now(), pause: pause && livePauseLabel(pause) });
    };
    const named = (button: HTMLElement) => button.setAttribute('aria-label', `Source of “${caption}”: ${button.textContent}`);
    let labelled: DatasetDescriptor | null = null; // the descriptor the label names, relabelled as the live status moves
    const relabel = () => {
      const button = source.querySelector<HTMLElement>('button.dash-source-label');
      if (released || !labelled || !button) return;
      const text = labelText(labelled);
      if (button.textContent === text) return;
      button.textContent = text;
      named(button);
    };
    const stopLive = deps.live?.subscribe(relabel) ?? (() => {});
    const label = (descriptor: DatasetDescriptor | null) => {
      labelled = descriptor; // E3
      source.replaceChildren();
      if (!descriptor) {
        const missing = element('span', 'dash-source-label');
        missing.textContent = DATASET_STATES.noDataset(datasetId);
        source.append(missing);
        return;
      }
      const button = element('button', 'dash-source-label');
      button.type = 'button';
      button.textContent = labelText(descriptor); // E3 M3
      named(button);
      const captured: SourceCapture = { datasetId, descriptor: structuredClone(descriptor), view: { spec: structuredClone(spec), caption } };
      button.addEventListener('click', () => deps.openSource(captured));
      source.append(button);
    };
    const show = (rendered: Rendered, descriptor: DatasetDescriptor | null) => {
      frame.innerHTML = rendered.svg ?? rendered.html; // the renderer's escaped, script-free SVG or table (its grade), never a string of the page's
      frame.append(tip);
      tip.hidden = true;
      label(descriptor);
      // what the view could not show as asked; a view that cannot be drawn says so in its own frame already
      const drawnInPlace = rendered.svg?.includes('<desc>This view cannot be drawn: ') ?? false;
      const notes = [...(descriptor ? mismatchNotes(descriptor) : []), ...(drawnInPlace ? [] : rendered.warnings)];
      if (notes.length > 0) {
        const list = element('div', 'dash-notes');
        list.textContent = [...new Set(notes)].join(' · ');
        source.append(list);
      }
      view.removeAttribute('aria-busy');
    };

    // Waits for the view to be in the page (its theme is the page's), a frame at a time, else draws with the house theme;
    // false if released or superseded meanwhile.
    const placed = async (mine: number): Promise<boolean> => {
      const since = performance.now();
      while (!into.isConnected && !released && performance.now() - since < CONNECT_MS) await new Promise((resolve) => requestAnimationFrame(resolve));
      return !released && mine === generation;
    };

    const paint = async (descriptor: DatasetDescriptor | null) => {
      const mine = ++generation;
      shown = { descriptor };
      if (frame.querySelector('svg, table')) view.setAttribute('aria-busy', 'true'); // the earlier view stays, dimmed
      else if (descriptor) {
        frame.textContent = `Loading ${descriptor.title}…`;
        frame.classList.add('dash-loading');
      }
      let rendered: Rendered;
      let started: number | null = null;
      try {
        const snapshot = descriptor && snapshotOf(descriptor); // E3: null for a query never fetched, nothing to read
        const table = snapshot ? await deps.reader.read(snapshot) : null;
        if (!(await placed(mine))) return;
        const theme = themeOf(into);
        drawnTheme = JSON.stringify(theme);
        started = performance.now();
        rendered = descriptor && !snapshot ? renderFailure(spec, theme, datasetId, DATASET_STATES.notFetched) : renderView(spec, table, theme, datasetId);
      } catch {
        if (!(await placed(mine))) return;
        const theme = themeOf(into);
        drawnTheme = JSON.stringify(theme);
        rendered = renderFailure(spec, theme, datasetId, DATASET_STATES.unreadable(datasetId));
      }
      frame.classList.remove('dash-loading');
      show(rendered, descriptor);
      if (started !== null) timed(started, datasetId, caption);
    };

    // The displayed document's descriptor for this block, drawn whenever it changes (a replacement, a removal, a restore).
    const check = (doc: Doc) => {
      const descriptor = readDataset(doc, datasetId);
      const key = descriptor ? JSON.stringify(descriptor) : '';
      if (key === drawnKey) return;
      drawnKey = key;
      void paint(descriptor);
    };
    // The theme re-checked: drawn again, from the cached rows, when its resolved input is no longer the one drawn.
    const recheck = () => {
      if (released || shown === null || drawnTheme === null || !into.isConnected) return;
      if (JSON.stringify(themeOf(into)) !== drawnTheme) void paint(shown.descriptor);
    };
    live.add(recheck);
    watchScopes(into.ownerDocument);
    const follow = () => {
      stopDoc();
      const doc = env.displayed?.current().doc;
      if (!doc) {
        drawnKey = '';
        void paint(null);
        return;
      }
      let overrides = JSON.stringify(dsOverrides(doc));
      stopDoc = onUpdate(doc, () => {
        check(doc);
        const now = JSON.stringify(dsOverrides(doc)); // the document's own overrides, which its page's scope applies
        if (now === overrides) return;
        overrides = now;
        recheckSoon(recheck);
      });
      check(doc);
    };
    const stopDisplayed = env.displayed?.subscribe(follow) ?? (() => {});
    follow();

    return () => {
      released = true;
      generation += 1;
      live.delete(recheck);
      due.delete(recheck);
      stopDoc();
      stopDisplayed();
      stopLive(); // E3
      detachHover();
      into.ownerDocument.removeEventListener('mousedown', pressed);
    };
  };
}
