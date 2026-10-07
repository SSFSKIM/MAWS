// E4c (Task 3.1): the browser action row's waiting line (E4c execution document, Design §10). Main reports
// `maws.browser.progress` while an action waits on the person or a cover; the line is live state, never an X1 event (a
// reload would re-deliver it), so it lives here, keyed by the call's tool use: set while a wait holds, removed when it
// ends (`waiting: null`) or when the row's result is in (the row clears what it no longer reads).
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { MawsBridge } from '@shared/ipc/schema';
import type { BrowserWaitReason } from '@shared/maws/browser';
import { ipc } from '../../../ipc/client';

export interface BrowserProgress {
  waiting: BrowserWaitReason;
  since: string; // ISO: when the wait began
}

const progress = createStore<ReadonlyMap<string, BrowserProgress>>()(() => new Map());

export function connectBrowserProgress(client: MawsBridge = ipc): () => void {
  return client.on('maws.browser.progress', ({ toolUseId, waiting, since }) => {
    if (toolUseId === null) return; // the e2e seam's runs have no row
    const next = new Map(progress.getState());
    if (waiting === null) next.delete(toolUseId);
    else next.set(toolUseId, { waiting, since });
    progress.setState(next, true);
  });
}

// The wait a call is in, null when none (or no call).
export const useBrowserProgress = (toolUseId: string | null): BrowserProgress | null => useStore(progress, (state) => (toolUseId === null ? null : (state.get(toolUseId) ?? null)));

export function clearBrowserProgress(toolUseId: string): void {
  if (!progress.getState().has(toolUseId)) return;
  const next = new Map(progress.getState());
  next.delete(toolUseId);
  progress.setState(next, true);
}

export const resetBrowserProgress = (): void => progress.setState(new Map(), true);
