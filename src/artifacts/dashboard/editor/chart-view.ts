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
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Actor } from '@shared/artifacts/actor';
import type { ViewEnvironment } from '../../document/editor/nodes/views';
import { onUpdate, type Doc } from '../../yjs';
import { readDataset, snapshotOf, type DatasetDescriptor } from '../datasets';
import { captionOf, renderFailure, renderView, themeFrom, THEME_PROPERTIES, type Rendered, type Theme } from '../render';
import { parseSpec } from '../spec';
import { DATASET_STATES, mismatchNotes, sourceLabel } from '../states';
import { attachHover } from './hover';
import type { SnapshotReader } from './snapshots';

/** What the source sheet opens on: the dataset as the view drew it (a copy of its descriptor, never a live lookup). */
export interface SourceCapture {
  datasetId: string;
  descriptor: DatasetDescriptor;
}

export interface ChartRendererDeps {
  reader: SnapshotReader;
  /** The name an actor's updates are credited to (the human "You", a session its title, else "Claude"). */
  actorName(actor: Actor): string;
  openSource(capture: SourceCapture): void;
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

export function createChartRenderer(deps: ChartRendererDeps): NonNullable<ViewEnvironment['renderChart']> {
  return (into: HTMLElement, node: PMNode, env: ViewEnvironment) => {
    const datasetId = String(node.attrs.source ?? '').trim();
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
    const detachHover = attachHover(frame, tip);

    let released = false;
    let generation = 0;
    let drawnKey: string | null = null; // the descriptor last asked for, as JSON ('' for none)
    let stopDoc = () => {};

    const label = (descriptor: DatasetDescriptor | null) => {
      source.replaceChildren();
      if (!descriptor) {
        const missing = element('span', 'dash-source-label');
        missing.textContent = DATASET_STATES.noDataset(datasetId);
        source.append(missing);
        return;
      }
      const button = element('button', 'dash-source-label');
      button.type = 'button';
      button.textContent = sourceLabel(descriptor, deps.actorName(descriptor.updated.by));
      button.setAttribute('aria-label', `Source of “${caption}”: ${button.textContent}`);
      const captured: SourceCapture = { datasetId, descriptor: structuredClone(descriptor) };
      button.addEventListener('click', () => deps.openSource(captured));
      source.append(button);
    };
    const show = (rendered: Rendered, descriptor: DatasetDescriptor | null) => {
      frame.innerHTML = rendered.svg; // the renderer's escaped, script-free SVG (its grade), never a string of the page's
      frame.append(tip);
      tip.hidden = true;
      label(descriptor);
      // what the view could not show as asked; a view that cannot be drawn says so in its own frame already
      const drawnInPlace = rendered.svg.includes('<desc>This view cannot be drawn: ');
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
      if (frame.querySelector('svg')) view.setAttribute('aria-busy', 'true'); // the earlier figure stays, dimmed
      else if (descriptor) {
        frame.textContent = `Loading ${descriptor.title}…`;
        frame.classList.add('dash-loading');
      }
      let rendered: Rendered;
      try {
        const table = descriptor ? await deps.reader.read(snapshotOf(descriptor)) : null;
        if (!(await placed(mine))) return;
        rendered = renderView(spec, table, themeOf(into), datasetId);
      } catch {
        if (!(await placed(mine))) return;
        rendered = renderFailure(spec, themeOf(into), datasetId, DATASET_STATES.unreadable(datasetId));
      }
      frame.classList.remove('dash-loading');
      show(rendered, descriptor);
    };

    // The displayed document's descriptor for this block, drawn whenever it changes (a replacement, a removal, a restore).
    const check = (doc: Doc) => {
      const descriptor = readDataset(doc, datasetId);
      const key = descriptor ? JSON.stringify(descriptor) : '';
      if (key === drawnKey) return;
      drawnKey = key;
      void paint(descriptor);
    };
    const follow = () => {
      stopDoc();
      const doc = env.displayed?.current().doc;
      if (!doc) {
        drawnKey = '';
        void paint(null);
        return;
      }
      stopDoc = onUpdate(doc, () => check(doc));
      check(doc);
    };
    const stopDisplayed = env.displayed?.subscribe(follow) ?? (() => {});
    follow();

    return () => {
      released = true;
      generation += 1;
      stopDoc();
      stopDisplayed();
      detachHover();
    };
  };
}
