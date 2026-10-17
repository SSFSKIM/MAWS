// The document schema's node views (D1's `editor/nodes/`; M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md):
// math through KaTeX as the transcript renders it, mermaid diagrams drawn by a lazily loaded renderer, images through
// the host's asset URL, the callout's tone, the three chips, and the labelled placeholders of `pending` and `chart`.
// Plain DOM views: the schema module stays free of them (it is built in Node), and the editor attaches them by name.
import type { NodeViewRenderer } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import katex from 'katex';
import { CALLOUT_TONES } from '../../schema';
import type { EditorHost } from '../host-types';
import type { Doc } from '../../../yjs'; // P3-E
import { atomView, setAttr } from './atom';

export interface ViewEnvironment {
  artifactId: string;
  host: EditorHost;
  /** A mermaid source drawn as SVG markup; `into` is the element it will be shown in (its computed style themes it). */
  renderDiagram: (source: string, into: HTMLElement) => Promise<string>;
  // P3-E start (E2 M3; ledger X26 as amended, E's Decision Log 6 and 19): a dashboard's chart block drawn by E's renderer
  // into `into`, answering the disposer that releases it (its subscriptions, its pending paints) before a redraw and when
  // the node or the editor goes; absent, B's placeholder draws. `displayed` is the document this editor shows (the live
  // one, a version's in history, the suggestion replica), so a chart reads the data of what is shown, never the live doc.
  renderChart?: (into: HTMLElement, node: PMNode, env: ViewEnvironment) => () => void;
  displayed?: DisplayedDocument;
  // P3-E end
}

// P3-E start (E2 M3): the document an editor shows, and its revision when that is a retained version's; a history
// preview's editor is put on another version without being made again, so the value moves and its readers are told.
export interface DisplayedDocument {
  current(): { doc: Doc; revision?: number };
  subscribe(listener: () => void): () => void;
}

/** A displayed document that `set` moves (telling the subscribers only when the document or revision changes). */
export function displayedDocument(doc: Doc, revision?: number): DisplayedDocument & { set(doc: Doc, revision?: number): void } {
  let shown = { doc, ...(revision !== undefined && { revision }) };
  const listeners = new Set<() => void>();
  return {
    current: () => shown,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next, nextRevision) {
      if (next === shown.doc && nextRevision === shown.revision) return;
      shown = { doc: next, ...(nextRevision !== undefined && { revision: nextRevision }) };
      for (const listener of [...listeners]) listener();
    },
  };
}
// P3-E end

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
const option = (value: string, label = value): HTMLOptionElement => {
  const el = document.createElement('option');
  el.value = value;
  el.textContent = label;
  return el;
};

const math = (displayMode: boolean) => (into: HTMLElement, node: PMNode) => {
  const latex = String(node.attrs.latex ?? '');
  if (!latex) {
    into.append(element('span', 'doc-atom-empty', displayMode ? 'Equation' : 'Math'));
    return;
  }
  // KaTeX's own markup, its errors drawn in place rather than thrown (a half-typed formula is normal)
  into.innerHTML = katex.renderToString(latex, { displayMode, throwOnError: false, output: 'htmlAndMathml' });
};

// An image is shown only from an asset, an https URL or an inline picture; anything else draws no request.
const SAFE_IMAGE = /^(?:https:|maws-artifact:|blob:|data:image\/)/i;
export function imageSrc(node: PMNode, env: ViewEnvironment): string | null {
  const src = String(node.attrs.src ?? '');
  if (node.attrs.assetId) return env.host.assetUrl(env.artifactId, src);
  return SAFE_IMAGE.test(src) ? src : null;
}

// Dates in the owner's United States frame, read as calendar days (no time zone shift).
const DATE = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
export function formatDate(iso: unknown): string {
  const text = typeof iso === 'string' ? iso : '';
  const at = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : NaN;
  return Number.isNaN(at) ? text || 'Date' : DATE.format(at);
}

function diagramView(env: ViewEnvironment): NodeViewRenderer {
  return (props) => {
    let drawn = 0; // the latest draw, an empty source's included; an older one that answers late is dropped
    return atomView({
      inline: false,
      field: { attr: 'source', label: 'Diagram source', kind: 'textarea' },
      draw(into, node) {
        drawn += 1;
        const mine = drawn;
        const source = String(node.attrs.source ?? '');
        const pre = element('pre', 'doc-diagram-source', source || 'Diagram');
        into.append(pre);
        if (!source) return;
        env.renderDiagram(source, into).then(
          (svg) => {
            if (mine !== drawn || !into.isConnected) return;
            const figure = element('div', 'doc-diagram-drawing');
            figure.innerHTML = svg;
            into.replaceChildren(figure);
          },
          () => {
            if (mine === drawn) pre.classList.add('doc-diagram-error'); // the source stays, marked as not drawn
          },
        );
      },
    })(props);
  };
}

function dropdownDraw(into: HTMLElement, node: PMNode, onChange: (value: string) => void): void {
  const select = element('select', 'doc-chip-select');
  select.setAttribute('aria-label', 'Status');
  const options = Array.isArray(node.attrs.options) ? (node.attrs.options as unknown[]).map(String) : [];
  const value = node.attrs.value == null ? '' : String(node.attrs.value);
  for (const choice of options.includes(value) || !value ? options : [value, ...options]) select.append(option(choice));
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  into.append(select);
}

function calloutView(): NodeViewRenderer {
  return ({ editor, node: initial, getPos }) => {
    let node = initial;
    const dom = element('aside', 'doc-callout');
    dom.dataset.node = 'callout';
    const header = element('div', 'doc-callout-header');
    header.contentEditable = 'false';
    const tone = element('select', 'doc-callout-tone');
    tone.setAttribute('aria-label', 'Callout tone');
    for (const value of CALLOUT_TONES) tone.append(option(value, value[0].toUpperCase() + value.slice(1)));
    tone.addEventListener('change', () => setAttr(editor, getPos, 'tone', tone.value));
    header.append(tone);
    const content = element('div', 'doc-callout-content');
    dom.append(header, content);
    const sync = () => {
      dom.setAttribute('data-callout-tone', String(node.attrs.tone));
      tone.value = String(node.attrs.tone);
      tone.disabled = !editor.isEditable;
    };
    sync();
    const view: NodeView = {
      dom,
      contentDOM: content,
      update(next) {
        if (next.type !== node.type) return false;
        node = next;
        sync();
        return true;
      },
      stopEvent: (event) => header.contains(event.target as globalThis.Node | null),
      ignoreMutation: (mutation) => mutation.type !== 'selection' && (header.contains(mutation.target) || mutation.target === dom),
    };
    return view;
  };
}

/** The node views by node name. */
export function nodeViews(env: ViewEnvironment): Record<string, NodeViewRenderer> {
  return {
    math: atomView({ inline: true, draw: math(false), field: { attr: 'latex', label: 'LaTeX', kind: 'text' } }),
    mathBlock: atomView({ inline: false, draw: math(true), field: { attr: 'latex', label: 'LaTeX', kind: 'textarea' } }),
    diagram: diagramView(env),
    image: atomView({
      inline: true,
      field: { attr: 'alt', label: 'Alt text', kind: 'text' },
      draw(into, node) {
        const img = element('img', 'doc-image');
        const src = imageSrc(node, env);
        if (src) img.setAttribute('src', src);
        img.alt = String(node.attrs.alt ?? '');
        img.draggable = false;
        into.append(img);
      },
    }),
    date: atomView({ inline: true, field: { attr: 'iso', label: 'Date', kind: 'date' }, draw: (into, node) => into.append(element('span', 'doc-chip', formatDate(node.attrs.iso))) }),
    mention: atomView({ inline: true, field: { attr: 'label', label: 'Name', kind: 'text' }, draw: (into, node) => into.append(element('span', 'doc-chip', `@${String(node.attrs.label ?? '')}`)) }),
    dropdown: (props) =>
      atomView({
        inline: true,
        interactive: (dom) => dom.querySelector('select'),
        draw: (into, node) => {
          const chip = element('span', 'doc-chip');
          dropdownDraw(chip, node, (value) => setAttr(props.editor, props.getPos, 'value', value));
          into.append(chip);
        },
      })(props),
    pending: atomView({
      inline: false,
      field: { attr: 'intent', label: 'Intent', kind: 'text' },
      draw: (into, node) => into.append(element('span', 'doc-placeholder-label', 'Pending'), element('span', 'doc-placeholder-text', String(node.attrs.intent ?? ''))),
    }),
    // E's Dashboard block, drawn as a labelled placeholder with its source until E lands (D2)
    // P3-E: through the environment's `renderChart` when given (a dashboard's editor), its disposer kept by the atom view;
    // the drawing's own controls (`[data-atom-controls]`, a source label's button) take their events, not the editor
    chart: env.renderChart
      ? atomView({ inline: false, interactive: (dom) => dom.querySelector('[data-atom-controls]'), draw: (into, node) => env.renderChart!(into, node, env) })
      : atomView({
          inline: false,
          draw: (into, node) => into.append(element('span', 'doc-placeholder-label', 'Chart'), element('span', 'doc-placeholder-text', String(node.attrs.source ?? ''))),
        }),
    callout: calloutView(),
  };
}
