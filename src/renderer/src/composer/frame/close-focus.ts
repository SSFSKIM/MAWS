import { OPEN_OVERLAY } from '../../keymap/dispatcher';

// A chip's menu gives the keyboard back as it closes, in Radix's unmount timer (`onCloseAutoFocus`), only when nothing
// took the keyboard since: focus left behind in the removed menu reads as the document's body. A menu the person opened
// from it (⇧⌘M from the model menu, ⇧⌘I from the mode menu) holds the keyboard by then and keeps it; before, the
// closing menu's return closed the new one at once.
export function keyboardTaken(): boolean {
  const at = document.activeElement;
  return at !== null && at !== document.body;
}

// The open menu, dialog or popover holding the keyboard, if one does: the editor's deferred return asks it at the call and
// again at its frame, and yields only to one that took the keyboard in between. `keyboardTaken()`, the close timer's gate,
// counts any holder but the body; the frame counts only an overlay opened since the call, because a library putting the
// focus back on a menu's trigger is a holder nobody chose.
export function overlayHolding(): Element | null {
  return document.activeElement?.closest(OPEN_OVERLAY) ?? null;
}
