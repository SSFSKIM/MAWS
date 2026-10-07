// E4d: which browser tabs are in comment mode, as this window knows it (E4d execution document, Design §2 and Decision
// Log 1). Main owns the mode; the store mirrors it from `browser.comment.changed` (connect.ts) and from the answer to the
// toggle's own `browser.comment.set`, so a window that loaded while a tab was armed shows the truth after one click. It
// is not a `BrowserTab` field: only the toggle reads it.
import { UNKNOWN_BROWSER_TAB } from '@shared/browser/tab';
import type { MawsBridge } from '@shared/ipc/schema';
import { create } from 'zustand';
import { ipc } from '../../../ipc/client';

interface CommentModeState {
  armed: ReadonlySet<string>; // tab ids
}

export const useCommentMode = create<CommentModeState>()(() => ({ armed: new Set() }));

export function setCommentArmed(tabId: string, on: boolean): void {
  const { armed } = useCommentMode.getState();
  if (armed.has(tabId) === on) return;
  const next = new Set(armed);
  if (on) next.add(tabId);
  else next.delete(tabId);
  useCommentMode.setState({ armed: next });
}

export function resetCommentMode(): void {
  useCommentMode.setState({ armed: new Set() });
}

// The toggle's command: main arms or disarms the tab and answers what it is now (`on: false` with the reason when it
// cannot arm, no error). `arming` changes nothing here: main waits for the page to confirm the shield, and only its
// `changed {on: true}` presses the toggle (Decision Log 34), which may even arrive before this answer. A tab that closed
// meanwhile is no fault of the person's and is dropped silently, as E4a's actions do; any other refusal is warned and
// leaves the store as it was.
export async function setCommentMode(tabId: string, on: boolean, client: MawsBridge = ipc): Promise<void> {
  const result = await client.invoke('browser.comment.set', { tabId, on });
  if (result.ok) {
    if (result.value.reason !== 'arming') setCommentArmed(tabId, result.value.on);
  }
  else if (!(result.error.code === 'invalid_input' && result.error.message === UNKNOWN_BROWSER_TAB)) console.warn(`[browser] comment mode refused: ${result.error.message}`);
}
