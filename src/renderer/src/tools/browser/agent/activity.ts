// E13 (the in-app browser spec of 2026-10-08, "Action rows"): what an agent did in the in-app browser through cua, as
// main reports it (`browser.agent.activity`), kept per session for the transcript (transcript/model/browser-activity.ts
// attaches each to the session's `js` call). Live state, as the waiting line's (progress.ts): never an X1 event. Main
// keeps each session's last 500, across app restarts since cua board #93, and a session's transcript lists them when it
// mounts (`listBrowserActivity`), so a window reload, a re-mount or a restart shows the rows again. Main sends
// at most 20 a second per tab, and a session keeps only its latest entries here too.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { BROWSER_ACTIVITIES_KEPT, type BrowserAgentActivity } from '@shared/browser/activity';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { BrowserActivityEntry } from '../../../transcript/model/browser-activity';
import { ipc } from '../../../ipc/client';

const NONE: readonly BrowserActivityEntry[] = [];
const activity = createStore<ReadonlyMap<AppSessionId, readonly BrowserActivityEntry[]>>()(() => new Map());
let seq = 0;

const put = (appSessionId: AppSessionId, list: readonly BrowserActivityEntry[]) =>
  activity.setState(new Map(activity.getState()).set(appSessionId, list.slice(-BROWSER_ACTIVITIES_KEPT)), true);

export function connectBrowserActivity(client: MawsBridge = ipc): () => void {
  return client.on('browser.agent.activity', (payload) => {
    put(payload.appSessionId, [...(activity.getState().get(payload.appSessionId) ?? NONE), { ...payload, seq: ++seq }]);
  });
}

// The same activity listed and heard live (main has no id for one): its time, tab and kind.
const sameKey = (entry: BrowserAgentActivity) => `${entry.at}\u0000${entry.tabId}\u0000${entry.activity.kind}`;

// What main kept for a session (oldest first), merged under what live events already brought: an entry the store has
// keeps its object (its number, so its row id) and its place; one it lacked joins in time order. A refusal changes
// nothing (the rows show what the live events brought).
export async function listBrowserActivity(appSessionId: AppSessionId, client: MawsBridge = ipc): Promise<void> {
  const listed = await client.invoke('browser.agent.activities.list', { appSessionId }).catch(() => null);
  if (!listed?.ok || listed.value.activities.length === 0) return;
  const kept = activity.getState().get(appSessionId) ?? NONE;
  const known = new Set(kept.map(sameKey));
  const added = listed.value.activities.filter((entry) => !known.has(sameKey(entry))).map((entry) => ({ ...entry, seq: ++seq }));
  if (added.length === 0) return;
  put(appSessionId, [...added, ...kept].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)));
}

// A session's activity in arrival order; the same array until that session's changes.
export const browserActivityOf = (appSessionId: AppSessionId): readonly BrowserActivityEntry[] => activity.getState().get(appSessionId) ?? NONE;
export const useBrowserActivity = (appSessionId: AppSessionId | null): readonly BrowserActivityEntry[] =>
  useStore(activity, (state) => (appSessionId === null ? NONE : (state.get(appSessionId) ?? NONE)));

export const resetBrowserActivity = (): void => activity.setState(new Map(), true);
