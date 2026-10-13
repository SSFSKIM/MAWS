// S1 (P3-0): the custom Tiptap 3 extension that replaces @tiptap/extension-collaboration (+ -caret) on Yjs v14.
// Binds a Tiptap editor to a v14 YNode through @y/prosemirror 2's syncPlugin, renders remote cursors from
// awareness, and scopes undo to this binding through Y.UndoManager. Everything else (schema hardening, the
// attribution marks, UniqueID's filter) lives in schema.mjs. Throwaway spike code; this is the line count S1 reports.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import * as Y from '@y/y'
import {
  syncPlugin, yCursorPlugin, yUndoPlugin, undoCommand, redoCommand, configureYProsemirror, defaultMapAttributionToMark
} from '@y/prosemirror'

/** True for transactions the binding dispatched (remote changes, its fixes, its reconfigurations). */
export const isBindingTransaction = tr =>
  tr.getMeta('y-sync-transaction') != null || tr.getMeta('y-sync-append') != null || tr.getMeta('y-sync$') != null

export const YCollaboration = Extension.create({
  // Named like Tiptap's Collaboration so UniqueID takes its collaborative path (no ids written at create).
  name: 'collaboration',
  priority: 1000,
  addOptions: () => ({
    ytype: null, // the YNode to bind (doc.get('default'))
    awareness: null, // @y/protocols Awareness, optional
    user: null, // { name, color } published in awareness
    renderer: null, // optional Y renderer (DiffRenderer for suggestions/diffs)
    syncOptions: {}, // forwarded to syncPlugin (mapAttributionToMark, attributedNodes, ...)
    cursorOptions: {}
  }),
  addStorage: () => ({ undoManager: null }),
  addCommands () {
    return {
      // Y.UndoManager mutates Y, and the binding dispatches the result itself; Tiptap must not dispatch its own tr.
      undo: () => ({ tr, state, dispatch }) => { tr.setMeta('preventDispatch', true); return undoCommand(state, dispatch && (() => {})) },
      redo: () => ({ tr, state, dispatch }) => { tr.setMeta('preventDispatch', true); return redoCommand(state, dispatch && (() => {})) }
    }
  },
  addKeyboardShortcuts () {
    return {
      'Mod-z': () => this.editor.commands.undo(),
      'Mod-y': () => this.editor.commands.redo(),
      'Shift-Mod-z': () => this.editor.commands.redo()
    }
  },
  addProseMirrorPlugins () {
    const { ytype, awareness, user, renderer, syncOptions, cursorOptions } = this.options
    const um = new Y.UndoManager(ytype, { trackedOrigins: new Set() })
    this.storage.undoManager = um
    if (awareness && user) awareness.setLocalStateField('user', user)
    // The binding must be configured after EditorView's constructor returns (Tiptap's dispatch needs editor.view).
    const bind = new Plugin({
      key: new PluginKey('yCollaborationBind'),
      view: view => {
        queueMicrotask(() => { if (!view.isDestroyed) configureYProsemirror({ ytype, renderer })(view.state, view.dispatch) })
        return {}
      }
    })
    return [
      syncPlugin({ mapAttributionToMark: defaultMapAttributionToMark, ...syncOptions }),
      bind,
      yUndoPlugin(um),
      ...(awareness ? [yCursorPlugin(awareness, cursorOptions)] : [])
    ]
  }
})
