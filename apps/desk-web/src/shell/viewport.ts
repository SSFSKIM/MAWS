// The phone's layouts (§4): below this width the desk draws one column at a time — the grid, or one channel with the
// channel list a tap away — and no depth column, which stays desktop-only.
import { useSyncExternalStore } from 'react';

export const NARROW_QUERY = '(max-width: 767px)';

const query = () => (typeof matchMedia === 'function' ? matchMedia(NARROW_QUERY) : null);

function subscribe(onChange: () => void): () => void {
  const list = query();
  list?.addEventListener('change', onChange);
  return () => list?.removeEventListener('change', onChange);
}

/** Whether the viewport is a phone's: one column, no depth. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => query()?.matches ?? false);
}
