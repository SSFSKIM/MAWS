// Provenance: spikes/p3-store/s1/lib/dom.mjs (S1, P3-0), copied so happy-dom resolves from this package; S5 adds the
// clipboard helpers (cut and copy through ProseMirror's own DOM handlers, paste of what they put on the clipboard).
// A happy-dom window installed as Node globals so Tiptap/ProseMirror views run headless. Import before Tiptap.
import { Window } from 'happy-dom'

export const win = new Window({ url: 'http://localhost/' })
const keys = ['window', 'document', 'navigator', 'Node', 'Text', 'HTMLElement', 'Element', 'DocumentFragment', 'getComputedStyle',
  'MutationObserver', 'DOMParser', 'XMLSerializer', 'requestAnimationFrame', 'cancelAnimationFrame', 'DragEvent', 'Event',
  'KeyboardEvent', 'ClipboardEvent', 'DataTransfer', 'InputEvent', 'FocusEvent', 'MouseEvent', 'CompositionEvent', 'getSelection', 'Range', 'Selection']
for (const k of keys) {
  if (win[k] === undefined) continue
  const v = k === 'window' ? win : (typeof win[k] === 'function' && !/^[A-Z]/.test(k) ? win[k].bind(win) : win[k])
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v })
}

export const tick = (ms = 5) => new Promise(r => setTimeout(r, ms))

/**
 * Fire a DOM `copy` or `cut` on the view: ProseMirror's own handler serializes the selection into clipboardData
 * (and for `cut` deletes it with uiEvent "cut"). Returns the clipboard's {html, text}.
 */
export const clip = (view, type) => {
  const dt = new win.DataTransfer()
  const ev = new win.ClipboardEvent(type, { clipboardData: dt, bubbles: true, cancelable: true })
  view.dom.dispatchEvent(ev)
  return { html: dt.getData('text/html'), text: dt.getData('text/plain'), handled: ev.defaultPrevented }
}

/** Paste HTML into a view the way a user paste arrives: a DOM `paste` event with clipboardData. */
export const pasteHTML = (view, html, text = '') => {
  const dt = new win.DataTransfer()
  dt.setData('text/html', html)
  dt.setData('text/plain', text)
  const ev = new win.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  view.dom.dispatchEvent(ev)
  return ev.defaultPrevented
}
