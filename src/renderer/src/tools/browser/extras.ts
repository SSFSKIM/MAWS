// E4a (Task 3.3): the navigation row's slot for later children's controls (E4a execution document, Design §4; E4d's
// Comment toggle). A registered component renders in both surfaces, in registration order, between the control slot
// and the overflow menu, whenever the chrome shows a tab; it decides its own state from the tab (E4d's toggle is
// disabled while `control === 'agent'`). Registering returns its own removal.
import { useSyncExternalStore, type ComponentType } from 'react';
import type { BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';

export interface ChromeExtraProps {
  tab: BrowserTab;
  appSessionId: AppSessionId;
  surface: 'panel' | 'main';
}

export type ChromeExtra = ComponentType<ChromeExtraProps>;

let extras: readonly ChromeExtra[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

export function registerChromeExtra(component: ChromeExtra): () => void {
  extras = [...extras, component];
  changed();
  return () => {
    if (!extras.includes(component)) return;
    extras = extras.filter((extra) => extra !== component);
    changed();
  };
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useChromeExtras = (): readonly ChromeExtra[] => useSyncExternalStore(subscribe, () => extras);
