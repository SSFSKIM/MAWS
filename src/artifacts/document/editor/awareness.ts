// Awareness in the editor (D11 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; X24's `setPresence`): the other
// replicas' cursors and the blocks an agent is editing. A person's replica publishes `{user: {name, color}, cursor}`
// (the binding's cursor plugin); an agent's replica publishes A's presence `{name, color, cursor?, editing?: {blocks}}`
// while a batch runs, cleared after it. The cursor builder below draws either shape in its author colour (a colour may
// be named by its custom property, `--author-3`); the `Presence` extension outlines each block an agent's state names,
// with the agent's name as its label, until the state drops the block or goes.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type DecorationAttrs } from '@tiptap/pm/view';
import type { Awareness } from '@y/protocols/awareness';
import { isBindingTransaction } from '../../yjs';
import { ySyncPluginKey } from '../../yjs/prosemirror';
import { cssColor } from './host-types';

/** Who a replica's awareness state names and in what colour (CSS), whichever shape it publishes; null if nobody. */
export function presenceOf(state: unknown): { name: string; color: string } | null {
  if (state === null || typeof state !== 'object') return null;
  const record = state as Record<string, unknown>;
  const who = (record.user !== null && typeof record.user === 'object' ? record.user : record) as Record<string, unknown>;
  const name = typeof who.name === 'string' ? who.name : null;
  const color = typeof who.color === 'string' ? who.color : null;
  return name === null && color === null ? null : { name: name ?? 'Someone', color: cssColor(color ?? '--fg-muted') };
}

/** The blocks an agent's awareness state says it is editing. */
export function editingOf(state: unknown): string[] {
  const editing = state !== null && typeof state === 'object' ? (state as { editing?: { blocks?: unknown } }).editing : undefined;
  return Array.isArray(editing?.blocks) ? editing.blocks.filter((id): id is string => typeof id === 'string') : [];
}

/** The binding's cursor plugin's builders, reading the state of the replica the cursor belongs to. */
export function cursorBuilders(awareness: Awareness): { cursorBuilder: (user: unknown, clientId: number) => HTMLElement; selectionBuilder: (user: unknown, clientId: number) => DecorationAttrs } {
  const who = (clientId: number) => presenceOf(awareness.getStates().get(clientId)) ?? { name: 'Someone', color: cssColor('--fg-muted') };
  return {
    cursorBuilder: (_user, clientId) => {
      const { name, color } = who(clientId);
      const cursor = document.createElement('span');
      cursor.className = 'ProseMirror-yjs-cursor';
      cursor.style.setProperty('--user-color', color);
      const label = document.createElement('div');
      label.textContent = name;
      cursor.append('⁠', label, '⁠');
      return cursor;
    },
    selectionBuilder: (_user, clientId) => ({ class: 'ProseMirror-yjs-selection', style: `--user-color: ${who(clientId).color}` }),
  };
}

const presenceKey = new PluginKey<DecorationSet>('agentEditing');

// Who edits which blocks, as one comparable string.
function editingSignature(awareness: Awareness): string {
  const parts: string[] = [];
  awareness.getStates().forEach((value, clientId) => {
    const blocks = clientId === awareness.clientID ? [] : editingOf(value);
    if (blocks.length > 0) parts.push(`${clientId}:${JSON.stringify(presenceOf(value))}:${blocks.join(',')}`);
  });
  return parts.sort().join('|');
}

function editingDecorations(state: EditorState, awareness: Awareness): DecorationSet {
  if ((ySyncPluginKey.getState(state) as { renderer?: unknown } | undefined)?.renderer != null) return DecorationSet.empty; // a diff is shown
  const byBlock = new Map<string, { name: string; color: string }>();
  awareness.getStates().forEach((value, clientId) => {
    if (clientId === awareness.clientID) return;
    const who = presenceOf(value);
    if (who) for (const id of editingOf(value)) byBlock.set(id, who);
  });
  if (byBlock.size === 0) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  state.doc.descendants((node: PMNode, pos: number) => {
    const who = byBlock.get(node.attrs.id as string);
    if (!who) return true;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-agent-editing': who.name, style: `--doc-presence: ${who.color}` }));
    return false;
  });
  return DecorationSet.create(state.doc, decorations);
}

/** Outlines the blocks other replicas' awareness names as being edited, each labelled with who edits it. */
export const Presence = Extension.create<{ awareness: Awareness | null }>({
  name: 'presence',
  addOptions: () => ({ awareness: null }),
  addProseMirrorPlugins() {
    const { awareness } = this.options;
    if (!awareness) return [];
    return [
      new Plugin<DecorationSet>({
        key: presenceKey,
        state: {
          init: (_config, state) => editingDecorations(state, awareness),
          // redrawn (a walk of the whole document) when the others' awareness changed or a remote change arrived (an agent's
          // new blocks); the person's own typing only maps it (M9: the scale gate's keystroke → frame at 200 pages)
          apply: (tr, value, _old, state) =>
            tr.getMeta(presenceKey) || tr.getMeta(ySyncPluginKey) || (tr.docChanged && isBindingTransaction(tr)) ? editingDecorations(state, awareness) : value.map(tr.mapping, tr.doc),
        },
        props: { decorations: (state) => presenceKey.getState(state) },
        view: (view) => {
          // redrawn only when what the others are editing changed, not on every cursor move
          let last = editingSignature(awareness);
          const changed = () => {
            const now = editingSignature(awareness);
            if (now === last || view.isDestroyed) return;
            last = now;
            view.dispatch(view.state.tr.setMeta(presenceKey, true).setMeta('addToHistory', false));
          };
          awareness.on('change', changed);
          return { destroy: () => awareness.off('change', changed) };
        },
      }),
    ];
  },
});
