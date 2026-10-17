// P3-H H4: whether the window's document is visible (not minimized, not behind another space), read from the document
// itself, never from a page; with the editor's own `visible`, what shows or hides a page's connector surface.
import { useSyncExternalStore } from 'react';

const subscribe = (changed: () => void) => {
  document.addEventListener('visibilitychange', changed);
  return () => document.removeEventListener('visibilitychange', changed);
};

export const useDocumentVisible = (): boolean => useSyncExternalStore(subscribe, () => document.visibilityState === 'visible');
