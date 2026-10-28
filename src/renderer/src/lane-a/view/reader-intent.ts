// What only a reader does to a transcript's list, told apart from the list's own scrolling. MAWS's list scrolls itself
// (a jump, its realignments while it measures rows, its anchoring) and raises no input event for it; a reader wheels,
// touches, presses on the list or its scrollbar, or pages with the keys. A gesture already under way when the watch
// begins (a finger down, a scrollbar held) raised its start before anything watched: while one is down, the scrolls
// it makes are the reader's too. Something waiting to move the reader (the place kept through an older page, a
// landing) gives way to any of these. A landing also gives way to focus taken elsewhere (`focus`): the reader went to
// the composer, the column, another control.
const INTENT = ['wheel', 'touchstart', 'touchmove', 'pointerdown'] as const;
/** A press or a touch, from its start on the scroller until it ends anywhere: while one is down, a scroll is the reader's. */
const GESTURE_START = ['touchstart', 'pointerdown'] as const;
const GESTURE_END = ['touchend', 'touchcancel', 'pointerup', 'pointercancel'] as const;
const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

/** Calls `onIntent` at each move of the reader's on the scroller (and, with `focus`, at focus moving anywhere); returns the stop. */
export function watchReaderIntent(scroller: HTMLElement, onIntent: () => void, options: { focus?: boolean } = {}): () => void {
  let gesture = false;
  const scrolled = () => {
    if (gesture) onIntent();
  };
  const began = () => void (gesture = true);
  const ended = () => void (gesture = false);
  const keyed = (event: KeyboardEvent) => {
    if (NAVIGATION_KEYS.has(event.key)) onIntent();
  };
  const focused = () => onIntent();
  scroller.addEventListener('scroll', scrolled, { passive: true });
  for (const kind of INTENT) scroller.addEventListener(kind, onIntent, { passive: true });
  scroller.addEventListener('keydown', keyed);
  for (const kind of GESTURE_START) scroller.addEventListener(kind, began, { passive: true });
  for (const kind of GESTURE_END) addEventListener(kind, ended, { passive: true });
  if (options.focus) document.addEventListener('focusin', focused);
  return () => {
    scroller.removeEventListener('scroll', scrolled);
    for (const kind of INTENT) scroller.removeEventListener(kind, onIntent);
    scroller.removeEventListener('keydown', keyed);
    for (const kind of GESTURE_START) scroller.removeEventListener(kind, began);
    for (const kind of GESTURE_END) removeEventListener(kind, ended);
    if (options.focus) document.removeEventListener('focusin', focused);
  };
}
