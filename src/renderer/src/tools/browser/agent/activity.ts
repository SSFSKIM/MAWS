// E13 (the in-app browser spec of 2026-10-08, "Action rows"): what an agent did in the in-app browser through cua, as
// main reports it (`browser.agent.activity`), kept per session for the transcript (transcript/model/browser-activity.ts
// attaches each to the session's `js` call). Live state, as the waiting line's (progress.ts): never an X1 event and
// never persisted, so a window reload loses these rows (accepted by the spec); main sends at most 20 a second per tab,
// and a session keeps only its latest entries.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { BrowserActivityEntry } from '../../../transcript/model/browser-activity';
import { ipc } from '../../../ipc/client';

export const BROWSER_ACTIVITY_KEPT = 200;

const NONE: readonly BrowserActivityEntry[] = [];
const activity = createStore<ReadonlyMap<AppSessionId, readonly BrowserActivityEntry[]>>()(() => new Map());
let seq = 0;

export function connectBrowserActivity(client: MawsBridge = ipc): () => void {
  return client.on('browser.agent.activity', (payload) => {
    const kept = activity.getState().get(payload.appSessionId) ?? NONE;
    const next = [...kept.slice(-(BROWSER_ACTIVITY_KEPT - 1)), { ...payload, seq: ++seq }];
    activity.setState(new Map(activity.getState()).set(payload.appSessionId, next), true);
  });
}

// A session's activity in arrival order; the same array until that session's changes.
export const browserActivityOf = (appSessionId: AppSessionId): readonly BrowserActivityEntry[] => activity.getState().get(appSessionId) ?? NONE;
export const useBrowserActivity = (appSessionId: AppSessionId | null): readonly BrowserActivityEntry[] =>
  useStore(activity, (state) => (appSessionId === null ? NONE : (state.get(appSessionId) ?? NONE)));

export const resetBrowserActivity = (): void => activity.setState(new Map(), true);
