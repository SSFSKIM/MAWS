// The document editor's binding (D1 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.2 and §4.7 of the
// parent): one Tiptap extension, `collaboration`, that binds an editor to one tab body of a replica's Y.Doc through
// `@y/prosemirror` 2 and carries the binding's rules. Copied and typed from P3-0: S3's `YCollaboration`
// (`s3/lib/collab.mjs`: S1's v14 binding plus history mode and the undo guards) with S4's `CompositionHold`
// (`s4/src/composition-hold.ts`) and `CaretFollowsId` (`s4/src/caret-follows-id.ts`) folded in.
//
// - The live binding: the sync plugin, bound to `ytype` a microtask after the view exists (S1 pitfall 3), the other
//   replicas' cursors from awareness, and an UndoManager scoped to this binding's own changes.
// - History mode: `showVersion` puts the same editor on a version's fragment through a DiffRenderer, read-only;
//   `leaveHistory` goes back to the live fragment. While the binding is not on the live fragment, undo and redo refuse
//   (they would edit the live doc behind the preview) and a filter refuses every local document change.
// - A restore this replica did not make clears the UndoManager (Decision Log 16): an undo across it would revert it.
// - The composition hold (Decision Log 33, 35): the provider buffers remote frames from compositionstart until
//   `view.composing` is false again, so a remote change never ends an IME composition early (doubled jamo).
// - The caret follows its block's id across a remote re-insert (a move, a retype): ProseMirror maps a caret inside a
//   deleted node to the deletion point, so the next keystrokes would land in the neighbouring block (S4).
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Awareness } from '@y/protocols/awareness';
import { isBindingTransaction, type Node as YType } from '../yjs';
import { UndoManager } from '../yjs/document';
import { configureYProsemirror, defaultMapAttributionToMark, redoCommand, syncPlugin, undoCommand, yCursorPlugin, ySyncPluginKey, yUndoPlugin } from '../yjs/prosemirror';
import { attributedNodes } from './schema';

/** What the hold is set on: the document handle (`DocumentHandle.holdRemote`, X24). */
export interface Holdable {
  holdRemote(on: boolean): void;
}

/** A version's view: its fragment and the renderer that draws it (a DiffRenderer, or null for the plain state). */
export interface VersionView {
  ytype: YType;
  renderer: Renderer | null;
}

export interface CollaborationOptions {
  /** The live tab body this editor binds. */
  ytype: YType | null;
  awareness: Awareness | null;
  /** This replica's user as the other replicas' cursors show it; `color` is any CSS colour. */
  user: { name: string; color: string } | null;
  /** The composition hold's target; none, no hold. */
  hold: Holdable | null;
  /** Subscribes to restores this replica did not make (`DocumentHandle.onRestored`); returns the unsubscribe. */
  onRestored: ((listener: () => void) => () => void) | null;
}

interface CollaborationStorage {
  undoManager: UndoManager | null;
  history: VersionView | null;
  offRestored: (() => void) | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    collaboration: {
      /** Undoes this replica's last change, never another's; refused in history. */
      undo: () => ReturnType;
      redo: () => ReturnType;
      /** Shows a version's fragment through `renderer`, read-only. */
      showVersion: (version: VersionView) => ReturnType;
      /** Back to the live fragment; the version's docs are the caller's to destroy. */
      leaveHistory: () => ReturnType;
    };
  }
  interface Storage {
    collaboration: CollaborationStorage;
  }
}

/** True while the editor shows something other than its live fragment (a version, a diff). */
export const inHistory = (state: EditorState, live: YType | null): boolean => {
  const sync = ySyncPluginKey.getState(state) as { ytype?: unknown; renderer?: unknown } | undefined;
  return sync == null || sync.ytype !== live || sync.renderer != null;
};

export const Collaboration = Extension.create<CollaborationOptions, CollaborationStorage>({
  name: 'collaboration', // Tiptap's name: UniqueID takes its collaborative path (no ids written at create) for it
  priority: 1000,

  addOptions: () => ({ ytype: null, awareness: null, user: null, hold: null, onRestored: null }),
  addStorage: () => ({ undoManager: null, history: null, offRestored: null }),

  addCommands() {
    const refused = (state: EditorState) => inHistory(state, this.options.ytype);
    return {
      undo:
        () =>
        ({ tr, state, dispatch }) => {
          if (refused(state)) return false;
          tr.setMeta('preventDispatch', true); // the UndoManager writes Y; the binding dispatches the result
          return undoCommand(state, dispatch && (() => {}));
        },
      redo:
        () =>
        ({ tr, state, dispatch }) => {
          if (refused(state)) return false;
          tr.setMeta('preventDispatch', true);
          return redoCommand(state, dispatch && (() => {}));
        },
      showVersion:
        ({ ytype, renderer }) =>
        ({ editor, tr }) => {
          tr.setMeta('preventDispatch', true); // the binding dispatches its own transaction (S1 pitfall 2)
          this.storage.history = { ytype, renderer };
          editor.setEditable(false, false);
          return configureYProsemirror({ ytype, renderer })(editor.state, editor.view.dispatch);
        },
      leaveHistory:
        () =>
        ({ editor, tr }) => {
          tr.setMeta('preventDispatch', true);
          this.storage.history = null;
          const left = configureYProsemirror({ ytype: this.options.ytype, renderer: null })(editor.state, editor.view.dispatch);
          editor.setEditable(true, false);
          return left;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-z': () => this.editor.commands.undo(),
      'Mod-y': () => this.editor.commands.redo(),
      'Shift-Mod-z': () => this.editor.commands.redo(),
    };
  },

  onCreate() {
    const { onRestored } = this.options;
    this.storage.offRestored = onRestored?.(() => this.storage.undoManager?.clear()) ?? null;
  },

  onDestroy() {
    this.storage.offRestored?.();
    this.storage.offRestored = null;
    this.storage.undoManager?.destroy();
    this.storage.undoManager = null;
  },

  addProseMirrorPlugins() {
    const { ytype, awareness, user, hold } = this.options;
    if (!ytype) return [];
    // An empty tracked set: the undo plugin adds the sync plugin, so only this binding's own changes are undoable.
    const undoManager = new UndoManager(ytype, { trackedOrigins: new Set() });
    this.storage.undoManager = undoManager;
    if (awareness && user) awareness.setLocalStateField('user', user);

    // While history is shown, refuse every local document change: commands still run on a read-only view and would
    // write into the version's doc. The binding's own render transactions pass.
    const readOnlyHistory = new Plugin({
      key: new PluginKey('collaborationReadOnlyHistory'),
      filterTransaction: (tr, state) => !(tr.docChanged && !isBindingTransaction(tr) && tr.getMeta(ySyncPluginKey) == null && inHistory(state, ytype)),
    });
    const bind = new Plugin({
      key: new PluginKey('collaborationBind'),
      view: (view) => {
        queueMicrotask(() => {
          if (!view.isDestroyed) configureYProsemirror({ ytype, renderer: null })(view.state, view.dispatch);
        });
        return {};
      },
    });
    return [
      syncPlugin({ mapAttributionToMark: defaultMapAttributionToMark, attributedNodes }),
      bind,
      readOnlyHistory,
      yUndoPlugin(undoManager),
      ...(awareness ? [yCursorPlugin(awareness)] : []),
      ...(hold ? [compositionHold(hold)] : []),
      caretFollowsId(),
    ];
  },
});

// The binding's half of the hold: set on compositionstart, cleared once `view.composing` is false again (checked after
// compositionend, after input that is not composing, and on every view update), so the buffered frames land between
// compositions as one merged update (the provider's half).
function compositionHold(target: Holdable): Plugin {
  let holding = false;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const releaseWhenIdle = (view: EditorView) => {
    if (pending !== null || !holding) return;
    pending = setTimeout(() => {
      pending = null;
      if (view.composing || !holding) return;
      holding = false;
      target.holdRemote(false);
    }, 0);
  };
  return new Plugin({
    key: new PluginKey('compositionHold'),
    props: {
      handleDOMEvents: {
        compositionstart: () => {
          holding = true;
          target.holdRemote(true); // again on every composition: restarts the provider's cap
          return false;
        },
        compositionend: (view) => {
          releaseWhenIdle(view);
          return false;
        },
        input: (view, event) => {
          if (!(event as { isComposing?: boolean }).isComposing) releaseWhenIdle(view);
          return false;
        },
      },
    },
    view: () => ({
      update: (view) => {
        if (!view.composing) releaseWhenIdle(view);
      },
      destroy: () => {
        if (pending !== null) clearTimeout(pending);
        pending = null;
        if (holding) target.holdRemote(false);
        holding = false;
      },
    }),
  });
}

// After a remote transaction, a caret whose textblock's id is gone from under it but exists elsewhere goes back into
// that block at the same offset.
function caretFollowsId(): Plugin {
  return new Plugin({
    key: new PluginKey('caretFollowsId'),
    appendTransaction(trs, oldState, newState) {
      if (!trs.some((tr) => tr.docChanged && isBindingTransaction(tr))) return null;
      const $old = oldState.selection.$head;
      const id: unknown = $old.parent.attrs.id;
      if (!$old.parent.isTextblock || id == null || !oldState.selection.empty) return null;
      if (newState.selection.$head.parent.attrs.id === id) return null;
      let target = -1;
      newState.doc.descendants((node, pos) => {
        if (target >= 0) return false;
        if (node.isTextblock && node.attrs.id === id) {
          target = pos + 1 + Math.min($old.parentOffset, node.content.size);
          return false;
        }
        return true;
      });
      return target < 0 ? null : newState.tr.setSelection(TextSelection.create(newState.doc, target)).setMeta('addToHistory', false);
    },
  });
}
