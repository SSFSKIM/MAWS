// S4: the editor binding's half of the composition hold (Decision Log 33's split; the provider half is in
// port-link.ts). A remote change applied while an IME composition is open, in or next to the composing text (or one
// that makes ProseMirror's view diff rebuild the composing block), makes the browser end the composition early: the
// syllable in progress is committed and the next keystroke commits it again (doubled jamo). So the binding sets the
// provider's hold on compositionstart and clears it once `view.composing` is false again (checked after
// compositionend, after non-composing input, and on every view update), which flushes the buffered frames between
// compositions. Binding-agnostic: it only reads the ProseMirror view. Throwaway spike code meant to be copied by P3-B.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface Holdable { hold: () => void, release: () => void, readonly holding: boolean }

export const CompositionHold = Extension.create<{ provider: Holdable | null }>({
  name: 'compositionHold',
  addOptions: () => ({ provider: null }),
  addProseMirrorPlugins () {
    const provider = this.options.provider
    if (!provider) return []
    let pending: ReturnType<typeof setTimeout> | null = null
    const releaseWhenIdle = (view: any) => {
      if (pending || !provider.holding) return
      pending = setTimeout(() => { pending = null; if (!view.composing) provider.release() }, 0)
    }
    return [new Plugin({
      key: new PluginKey('compositionHold'),
      props: {
        handleDOMEvents: {
          compositionstart: () => { provider.hold(); return false },
          compositionend: view => { releaseWhenIdle(view); return false },
          input: (view, e) => { if (!(e as InputEvent).isComposing) releaseWhenIdle(view); return false }
        }
      },
      view: () => ({ update: view => { if (!view.composing) releaseWhenIdle(view) } })
    })]
  }
})
