// S4: the caret follows its block's id across a remote re-insert. A move (or a type change) re-inserts a block as
// a new node with the same id; ProseMirror maps a caret inside the deleted node to the deletion point, so the
// person's next keystrokes land in whatever block now sits there. After a remote transaction, if the caret's
// textblock id is gone from where it was but a textblock with that id exists, put the caret back in it at the same
// offset. Throwaway spike code meant to be copied by P3-B.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { isBindingTransaction } from './schema.ts'

export const CaretFollowsId = Extension.create({
  name: 'caretFollowsId',
  addProseMirrorPlugins () {
    return [new Plugin({
      key: new PluginKey('caretFollowsId'),
      appendTransaction (trs, oldState, newState) {
        if (!trs.some(tr => tr.docChanged && isBindingTransaction(tr))) return null
        const $old = oldState.selection.$head
        const id = $old.parent.attrs?.id
        if (!$old.parent.isTextblock || id == null || !oldState.selection.empty) return null
        const $now = newState.selection.$head
        if ($now.parent.attrs?.id === id) return null
        let target = -1
        newState.doc.descendants((n, pos) => {
          if (target >= 0) return false
          if (n.isTextblock && n.attrs?.id === id) { target = pos + 1 + Math.min($old.parentOffset, n.content.size); return false }
          return true
        })
        return target < 0 ? null : newState.tr.setSelection(TextSelection.create(newState.doc, target)).setMeta('addToHistory', false)
      }
    })]
  }
})
