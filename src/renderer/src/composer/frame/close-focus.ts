// A chip's menu gives the keyboard back as it closes, in Radix's unmount timer (`onCloseAutoFocus`), only when nothing
// took the keyboard since: focus left behind in the removed menu reads as the document's body. A menu the person opened
// from it (⇧⌘M from the model menu, ⇧⌘I from the mode menu) holds the keyboard by then and keeps it; before, the
// closing menu's return closed the new one at once.
export function keyboardTaken(): boolean {
  const at = document.activeElement;
  return at !== null && at !== document.body;
}
