// Provenance: copied (code unchanged, comments shortened) from spikes/p3-store/s1/v14/collab.mjs (S1, P3-0) so that this package
// loads its own single @y/y (importing S1's file across packages trips v14's duplicate guard; S6's pitfall).
// S1 (P3-0): the custom Tiptap 3 extension that replaces @tiptap/extension-collaboration (+ -caret) on Yjs v14.
// Binds a Tiptap editor to a v14 YNode through @y/prosemirror 2's syncPlugin, renders remote cursors from
// awareness, and scopes undo to this binding through Y.UndoManager. Throwaway spike code.
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
  name: 'collaboration',
  priority: 1000,
  addOptions: () => ({
    ytype: null, awareness: null, user: null, renderer: null, syncOptions: {}, cursorOptions: {}
  }),
  addStorage: () => ({ undoManager: null }),
  addCommands () {
    return {
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
