// P4-A2 (X35, the document editor's provisional layer; docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.2's four
// rules [binding]; the child's execution document R10 and M5): the agent's batch drawn as it is written, beside
// `Presence`. Each streaming call's ops (`ProvisionalLayers`, src/artifacts/provisional/) are decorations in the agent's
// colour at their targets: `replace_text` dims the quoted passage and draws the streamed text after it (a quote not
// found in the block's text, markdown syntax in it say, is drawn as a block after the block); `replace_block` dims the
// block and draws the text after it; `insert` draws it after or before its anchor; `set_cell` after the table; `delete`
// and `move` stream no text (presence outlines them); a dashboard's `dataset` labels every chart block bound to that
// dataset, "<name> is updating <dataset>…" (G2's G-R7). Rule 1: decorations only, never a document change, never history.
// Rule 4: an op that would draw inside the block the person composes in waits until the composition ends, and no
// widget takes focus or the selection. Rule 2's and 3's withdrawal is the store's; this redraws when it changes, in the
// same task, so the real text and the layer swap within one task. A redraw tells `onGrow` (the page frame's `moved`,
// coalesced to one `layoutKey` bump per animation frame), since the layer's text grows the page.
import { Extension } from '@tiptap/core';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { Plugin, type EditorState, type PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { useEffect, useMemo } from 'react';
import type { ArtifactProvisional, ProvisionalOp } from '@shared/artifacts/provisional';
import { datasetIdFromSource } from '../../dashboard/datasets';
import { ProvisionalLayers } from '../../provisional';
import { provisionalKey as layerKey } from '../provisional-key';
import { isBindingTransaction } from '../../yjs';
import { ySyncPluginKey } from '../../yjs/prosemirror';
import { cssColor, type DocumentHandle } from './host-types';

/**
 * The open document's layers, one store per handle (DocumentEditor holds it, so a tab switch keeps the layers that
 * stand), listening while the component is mounted: a StrictMode remount stops and restarts the same store.
 */
export function useProvisionalLayers(handle: DocumentHandle): ProvisionalLayers {
  const layers = useMemo(() => new ProvisionalLayers(handle), [handle]);
  useEffect(() => layers.attach(), [layers]);
  return layers;
}

export interface ProvisionalOptions {
  /** The open document's layers; null for an editor that draws none (the suggestion review, a version's preview). */
  layers: ProvisionalLayers | null;
  /** Told after each redraw: the layer changed the page's layout. */
  onGrow?: () => void;
}

/** The plugin's state: the decorations, and how many times they were drawn afresh (a mapping is not a redraw). */
export interface ProvisionalState {
  set: DecorationSet;
  drawn: number;
}

// the key the schema's repairs know a redraw by (../provisional-key.ts), typed with this plugin's state
export const provisionalKey: PluginKey<ProvisionalState> = layerKey;

const NO_IDS: ReadonlySet<string> = new Set();

interface Who {
  id: string;
  name: string;
  color: string;
}

// A provisional element: never editable, never focusable, named for its call, op and author, in the author's colour
// (`--doc-presence`, as the presence outline reads it). The text is the op's as streamed so far; empty, the element still
// stands, so a layer is there from its first frame.
function widget(view: EditorView, tag: 'span' | 'div', className: string, op: ProvisionalOp['op'], who: Who, text: string): HTMLElement {
  const element = view.dom.ownerDocument.createElement(tag);
  element.className = className;
  element.setAttribute('contenteditable', 'false');
  element.dataset.provisional = who.id;
  element.dataset.provisionalOp = op;
  element.dataset.provisionalBy = who.name;
  element.style.setProperty('--doc-presence', who.color);
  element.textContent = text;
  return element;
}

// Widgets are compared by key, so an unchanged one keeps its DOM across a redraw and a changed one is made anew.
const keyOf = (who: Who, index: number, op: ProvisionalOp['op'], text: string) => `provisional:${who.id}:${index}:${op}:${who.name}:${who.color}:${text}`;

// A block's worth of streamed text at `pos`, between blocks: hugging the block before it (`after`) or after it.
function blockWidget(pos: number, place: 'after' | 'before', op: ProvisionalOp['op'], who: Who, index: number, text: string): Decoration {
  return Decoration.widget(pos, (view) => widget(view, 'div', 'doc-provisional-block', op, who, text), {
    side: place === 'after' ? -1 : 1,
    ignoreSelection: true,
    key: keyOf(who, index, op, text),
  });
}

// Where `quote` first stands in a textblock's text, as document positions (inline atoms count as their leaf text, so
// an image or a mention between words is stepped over); `start` is the textblock's content start.
function inTextblock(node: PMNode, start: number, quote: string): { from: number; to: number } | null {
  let text = '';
  const at: number[] = [];
  node.forEach((child, offset) => {
    const piece = child.isText ? child.text! : (child.type.spec.leafText?.(child) ?? '');
    for (let i = 0; i < piece.length; i += 1) at.push(start + offset + (child.isText ? i : 0));
    text += piece;
  });
  const index = text.indexOf(quote);
  return index < 0 ? null : { from: at[index], to: at[index + quote.length - 1] + 1 };
}

// The quote's first occurrence in the block (`pos` its position): in its own text, or in its first textblock holding it.
function quoteRange(block: PMNode, pos: number, quote: string): { from: number; to: number } | null {
  if (!quote) return null;
  if (block.isTextblock) return inTextblock(block, pos + 1, quote);
  let range: { from: number; to: number } | null = null;
  block.descendants((child, offset) => {
    if (range) return false;
    if (!child.isTextblock) return true;
    range = inTextblock(child, pos + 1 + offset + 1, quote);
    return false;
  });
  return range;
}

// The blocks the ops name, each with its position (inline content carries no block ids, so textblocks are not entered).
function locate(doc: PMNode, ids: ReadonlySet<string>): Map<string, { node: PMNode; pos: number }> {
  const found = new Map<string, { node: PMNode; pos: number }>();
  if (ids.size === 0) return found;
  doc.descendants((node, pos) => {
    if (found.size === ids.size) return false;
    const id = node.attrs.id as unknown;
    if (typeof id === 'string' && ids.has(id) && !found.has(id)) found.set(id, { node, pos });
    return !node.isTextblock && !node.isAtom;
  });
  return found;
}

interface Bound {
  node: PMNode;
  pos: number;
  /** The ids of the blocks the chart stands in. */
  around: ReadonlySet<string>;
}

// The chart blocks bound to each dataset (a chart's source names it, read as the dashboard's views read it), each with
// the blocks it stands in; textblocks hold no chart, so they are not entered.
function boundCharts(doc: PMNode, datasets: ReadonlySet<string>): Map<string, Bound[]> {
  const found = new Map<string, Bound[]>();
  if (datasets.size === 0) return found;
  doc.descendants((node, pos) => {
    if (node.type.name !== 'chart') return !node.isTextblock && !node.isAtom;
    const dataset = datasetIdFromSource(node.attrs.source);
    if (datasets.has(dataset)) found.set(dataset, [...(found.get(dataset) ?? []), { node, pos, around: blocksAround(doc.resolve(pos)) }]);
    return false;
  });
  return found;
}

interface Targets {
  blocks: Map<string, { node: PMNode; pos: number }>;
  charts: Map<string, Bound[]>;
}

const targetsOf = (op: ProvisionalOp): Array<string | null | undefined> => {
  switch (op.op) {
    case 'replace_text':
    case 'replace_block':
      return [op.block];
    case 'insert':
      return [op.after ?? op.before];
    case 'set_cell':
      return [op.table];
    default:
      return [];
  }
};

function opDecorations(op: ProvisionalOp, index: number, who: Who, { blocks: found, charts }: Targets, composing: ReadonlySet<string>): Decoration[] {
  const style = `--doc-presence: ${who.color}`;
  switch (op.op) {
    case 'replace_text': {
      // unresolved (the host found no block holding the quote) draws nothing; the transcript shows the call
      if (op.block === null || composing.has(op.block)) return [];
      const target = found.get(op.block);
      if (!target) return [];
      const range = quoteRange(target.node, target.pos, op.old);
      if (!range) return op.old ? [blockWidget(target.pos + target.node.nodeSize, 'after', op.op, who, index, op.text)] : [];
      return [
        Decoration.inline(range.from, range.to, { class: 'doc-provisional-old', style }),
        Decoration.widget(range.to, (view) => widget(view, 'span', 'doc-provisional-text', op.op, who, op.text), { side: 1, ignoreSelection: true, key: keyOf(who, index, op.op, op.text) }),
      ];
    }
    case 'replace_block': {
      if (composing.has(op.block)) return [];
      const target = found.get(op.block);
      if (!target) return [];
      const end = target.pos + target.node.nodeSize;
      return [Decoration.node(target.pos, end, { class: 'doc-provisional-replaced', style }), blockWidget(end, 'after', op.op, who, index, op.text)];
    }
    case 'insert': {
      const anchor = op.after ?? op.before;
      const target = anchor !== undefined ? found.get(anchor) : undefined;
      if (!target) return [];
      return [op.after !== undefined ? blockWidget(target.pos + target.node.nodeSize, 'after', op.op, who, index, op.text) : blockWidget(target.pos, 'before', op.op, who, index, op.text)];
    }
    case 'set_cell': {
      const target = found.get(op.table);
      return target ? [blockWidget(target.pos + target.node.nodeSize, 'after', op.op, who, index, op.text)] : [];
    }
    case 'dataset': {
      // the label rides the chart block itself (its node view keeps its drawing through a decoration change), so no
      // line moves; a chart inside the block the person composes in waits, as every op does
      const attrs = {
        class: 'doc-provisional-dataset',
        style,
        'data-provisional': who.id,
        'data-provisional-op': op.op,
        'data-provisional-by': who.name,
        'data-provisional-dataset': op.dataset,
        'data-provisional-label': `${who.name} is updating ${op.dataset}…`,
      };
      return (charts.get(op.dataset) ?? []).filter((chart) => ![...chart.around].some((id) => composing.has(id))).map((chart) => Decoration.node(chart.pos, chart.pos + chart.node.nodeSize, attrs));
    }
    default:
      return [];
  }
}

function draw(state: EditorState, layers: ReadonlyMap<string, ArtifactProvisional>, composing: ReadonlySet<string>): DecorationSet {
  if (layers.size === 0) return DecorationSet.empty;
  if ((ySyncPluginKey.getState(state) as { renderer?: unknown } | undefined)?.renderer != null) return DecorationSet.empty; // a diff is shown
  const ids = new Set<string>();
  const datasets = new Set<string>();
  for (const layer of layers.values()) {
    for (const op of layer.ops) {
      for (const id of targetsOf(op)) if (id) ids.add(id);
      if (op.op === 'dataset') datasets.add(op.dataset);
    }
  }
  const targets: Targets = { blocks: locate(state.doc, ids), charts: boundCharts(state.doc, datasets) };
  const decorations: Decoration[] = [];
  for (const layer of layers.values()) {
    const who = { id: layer.toolUseId as string, name: layer.name, color: cssColor(layer.color) };
    layer.ops.forEach((op, index) => decorations.push(...opDecorations(op, index, who, targets, composing)));
  }
  return DecorationSet.create(state.doc, decorations);
}

// The ids of the blocks a position stands in, outermost first: a layer drawn inside any of them is inside the composition.
function blocksAround($pos: ResolvedPos): ReadonlySet<string> {
  const ids = new Set<string>();
  for (let depth = 1; depth <= $pos.depth; depth += 1) {
    const id = $pos.node(depth).attrs.id as unknown;
    if (typeof id === 'string') ids.add(id);
  }
  return ids;
}

const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((id) => b.has(id));

/** Draws the agent's streaming edits over the page (X35), never inside the block the person is composing in. */
export const Provisional = Extension.create<ProvisionalOptions>({
  name: 'provisional',
  addOptions: () => ({ layers: null }),
  addProseMirrorPlugins() {
    const { layers, onGrow } = this.options;
    if (!layers) return [];
    // The blocks around the composition's start, while it stands. Kept beside the plugin's state, as Presence keeps the
    // awareness: a composition that starts or ends with no layer up dispatches nothing.
    let composing = NO_IDS;
    let ending: ReturnType<typeof setTimeout> | null = null;
    const redraw = (view: EditorView) => {
      if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(provisionalKey, true).setMeta('addToHistory', false));
    };
    return [
      new Plugin<ProvisionalState>({
        key: provisionalKey,
        state: {
          init: (_config, state) => ({ set: draw(state, layers.get(), composing), drawn: 0 }),
          // drawn afresh when the layers or the composition changed, or a remote change arrived (a target block may have
          // come or gone, the history preview may show); the person's own typing only maps it
          apply: (tr, value, _old, state) => {
            // nothing drawn and nothing to draw: the person's keystrokes and the others' writes cost the plugin nothing
            if (value.set === DecorationSet.empty && layers.get().size === 0 && !tr.getMeta(provisionalKey)) return value;
            if (tr.getMeta(provisionalKey) || tr.getMeta(ySyncPluginKey) || (tr.docChanged && isBindingTransaction(tr))) {
              const set = draw(state, layers.get(), composing);
              return set === DecorationSet.empty && value.set === DecorationSet.empty ? value : { set, drawn: value.drawn + 1 };
            }
            return tr.docChanged ? { set: value.set.map(tr.mapping, tr.doc), drawn: value.drawn } : value;
          },
        },
        props: {
          decorations: (state) => provisionalKey.getState(state)?.set,
          handleDOMEvents: {
            compositionstart: (view) => {
              if (ending !== null) clearTimeout(ending);
              ending = null;
              const around = blocksAround(view.state.selection.$head);
              if (sameIds(around, composing)) return false;
              composing = around;
              if (layers.get().size > 0) redraw(view);
              return false;
            },
            // once the view has left the composition (an IME's next syllable starts another at once, which keeps it)
            compositionend: (view) => {
              if (ending !== null) clearTimeout(ending);
              ending = setTimeout(() => {
                ending = null;
                if (view.isDestroyed || view.composing || composing.size === 0) return;
                composing = NO_IDS;
                if (layers.get().size > 0) redraw(view);
              }, 0);
              return false;
            },
          },
        },
        view: (view) => {
          const off = layers.subscribe(() => redraw(view));
          return {
            update: (current, previous) => {
              if (provisionalKey.getState(current.state)?.drawn !== provisionalKey.getState(previous)?.drawn) onGrow?.();
            },
            destroy: () => {
              off();
              if (ending !== null) clearTimeout(ending);
              ending = null;
            },
          };
        },
      }),
    ];
  },
});
