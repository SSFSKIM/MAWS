// The transcript actions registry (C8's ask, Public surface): C7 (`editAndResubmit`), C8b (`openSubagent`,
// `openFullLog`) and C8c (`reviewChanges`, `openFile`) land in different waves, and each contributes its callbacks from
// its own block. Registrations merge over DEFAULT_ACTIONS in order, so a later registration of a key wins; a disposer
// removes its own registration, which restores an earlier registration of the same key if one remains.
import { useSyncExternalStore } from 'react';
import { DEFAULT_ACTIONS, type TranscriptActions } from './context';

const registrations: Partial<TranscriptActions>[] = [];
const listeners = new Set<() => void>();
let merged: TranscriptActions = DEFAULT_ACTIONS;

function changed() {
  merged = { ...DEFAULT_ACTIONS };
  for (const partial of registrations) {
    for (const [key, action] of Object.entries(partial) as [keyof TranscriptActions, TranscriptActions[keyof TranscriptActions] | undefined][]) {
      if (action !== undefined) (merged as unknown as Record<string, unknown>)[key] = action;
    }
  }
  for (const listener of listeners) listener();
}

export function registerTranscriptActions(partial: Partial<TranscriptActions>): () => void {
  const registration = { ...partial };
  registrations.push(registration);
  changed();
  return () => {
    const at = registrations.indexOf(registration);
    if (at < 0) return;
    registrations.splice(at, 1);
    changed();
  };
}

// The merged actions; the same object until a registration changes.
export const registeredActions = (): TranscriptActions => merged;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useRegisteredActions = (): TranscriptActions => useSyncExternalStore(subscribe, registeredActions);
