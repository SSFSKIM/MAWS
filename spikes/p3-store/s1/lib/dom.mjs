// S1 helper: a happy-dom window installed as Node globals so Tiptap/ProseMirror views run headless.
// Import this before any Tiptap module. Throwaway spike code (P3-0, S1).
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

/** Paste HTML into a view the way a user paste arrives: a DOM `paste` event with clipboardData. */
export const pasteHTML = (view, html, text = '') => {
  const dt = new win.DataTransfer()
  dt.setData('text/html', html)
  dt.setData('text/plain', text)
  const ev = new win.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  view.dom.dispatchEvent(ev)
  return ev.defaultPrevented
}
