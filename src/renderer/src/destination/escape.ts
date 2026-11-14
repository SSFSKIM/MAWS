// Who takes an Esc pressed inside the Settings dialog or a page (UX wave U7b, Interfaces §H, rows 3 to 5): an element that
// handles the key itself, a text field the keyboard leaves first, or nobody, which lets the dialog or the page close.
// Radix's dialog dismisses from a capture listener before any handler inside it runs, so the dialog asks this before the
// element sees the key; the page asks it from its window listener.

const TEXT_INPUTS = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** A field a person types in: a text input, a textarea, or editable content. */
export function isTextField(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return TEXT_INPUTS.has(element.getAttribute('type')?.toLowerCase() ?? '');
  return element instanceof HTMLElement && (element.isContentEditable || element.closest('[contenteditable=""], [contenteditable="true"]') !== null);
}

/** Whether an Esc at `target` belongs to something inside: 'own' (it handles it itself), 'field' (a text field: leave it first), or null. */
export function escapeTaker(target: EventTarget | null): 'own' | 'field' | null {
  if (!(target instanceof Element)) return null;
  // The shortcut recorder, and an in-place confirmation marked as keeping its own Esc.
  if (target.closest('[data-chord-capture], [data-escape-own]') !== null) return 'own';
  // A search field that holds text clears itself, and the layer around it stays.
  if (target instanceof HTMLInputElement && target.matches('[data-escape-clears]') && target.value !== '') return 'own';
  return isTextField(target) ? 'field' : null;
}

/**
 * After the field's own handler has had the key: the keyboard moves from the field to `host` (the dialog or the page),
 * unless that handler moved it somewhere else. A task later, since the field's handler runs after the listener that asks.
 */
export function leaveField(field: EventTarget | null, host: () => HTMLElement | null): void {
  setTimeout(() => {
    const active = document.activeElement;
    if (active === field || active === null || active === document.body) host()?.focus({ preventScroll: true });
  }, 0);
}
