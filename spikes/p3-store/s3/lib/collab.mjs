// S3 (P3-0): S1's v14 Tiptap binding extension (s1/v14/collab.mjs) plus the history mode §4.2 and §4.7 ask for:
// `showVersion` switches the same editor onto a throwaway version doc rendered by a DiffRenderer (read-only),
// `leaveHistory` rebinds it to the live ytype with `renderer: null`, and undo/redo are refused while the binding is
// not on the live ytype (S1's commands call the live UndoManager unconditionally, which would edit the live doc behind
// the preview). `guardUndo: false` reproduces the unguarded behaviour for the spike's negative check.
// Throwaway spike code (copy target for P3-B).
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import * as Y from '@y/y'
import {
  syncPlugin, yCursorPlugin, yUndoPlugin, undoCommand, redoCommand, configureYProsemirror, defaultMapAttributionToMark, ySyncPluginKey
} from '@y/prosemirror'

/** True for transactions the binding dispatched (remote changes, its fixes, its reconfigurations). */
export const isBindingTransaction = tr =>
  tr.getMeta('y-sync-transaction') != null || tr.getMeta('y-sync-append') != null || tr.getMeta('y-sync$') != null

/** True while the editor shows something other than its live ytype (a version, a diff). */
export const inHistory = (state, liveYtype) => {
  const s = ySyncPluginKey.getState(state)
  return s == null || s.ytype !== liveYtype || s.renderer != null
}

export const YCollaboration = Extension.create({
  name: 'collaboration',
  priority: 1000,
  addOptions: () => ({
    ytype: null,
    awareness: null,
    user: null,
    renderer: null,
    syncOptions: {},
    cursorOptions: {},
    guardUndo: true
  }),
  addStorage: () => ({ undoManager: null, history: null }),
  addCommands () {
    const blocked = state => this.options.guardUndo && inHistory(state, this.options.ytype)
    return {
      undo: () => ({ tr, state, dispatch }) => {
        if (blocked(state)) return false
        tr.setMeta('preventDispatch', true); return undoCommand(state, dispatch && (() => {}))
      },
      redo: () => ({ tr, state, dispatch }) => {
        if (blocked(state)) return false
        tr.setMeta('preventDispatch', true); return redoCommand(state, dispatch && (() => {}))
      },
      /** Show `ytype` (a version doc's fragment) through `renderer` (a DiffRenderer), read-only. */
      showVersion: ({ ytype, renderer }) => ({ editor, tr }) => {
        tr.setMeta("preventDispatch", true) // the binding dispatches its own transaction (S1 pitfall 2)
        this.storage.history = { ytype, renderer }
        editor.setEditable(false, false)
        return configureYProsemirror({ ytype, renderer })(editor.state, editor.view.dispatch)
      },
      /** Back to the live ytype; the preview's docs are the caller's to destroy. */
      leaveHistory: () => ({ editor, tr }) => {
        tr.setMeta("preventDispatch", true)
        this.storage.history = null
        const ok = configureYProsemirror({ ytype: this.options.ytype, renderer: null })(editor.state, editor.view.dispatch)
        editor.setEditable(true, false)
        return ok
      }
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
    // While history is shown, refuse every local document change (commands still run on a read-only view and would
    // write into the throwaway version doc); the binding's own render transactions pass.
    const readOnlyHistory = new Plugin({
      key: new PluginKey('yHistoryReadOnly'),
      filterTransaction: (tr, state) => !(tr.docChanged && !isBindingTransaction(tr) && tr.getMeta(ySyncPluginKey) == null && inHistory(state, ytype))
    })
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
      ...(this.options.guardUndo ? [readOnlyHistory] : []),
      yUndoPlugin(um),
      ...(awareness ? [yCursorPlugin(awareness, cursorOptions)] : [])
    ]
  }
})
