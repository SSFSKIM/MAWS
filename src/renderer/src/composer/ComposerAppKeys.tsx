// The one app-level handler for ⌘. and ⌘L, and the three menu chords (C7 execution document, "Keymap additions"):
// mounted once from App.tsx. C5's dispatcher selects a single enabled app-scoped handler and ignores `within`, so a
// registration per composer in a split would be arbitrated by registration order rather than by focus; there is only
// this one, and it resolves the target centrally: the layout store's focused pane → that pane's active tab → its
// session → the session's status. Stop interrupts only a live, busy session (an idle, unstarted or ended one, or an
// Overview tab, gets nothing), as the plain stop (W1): `holdEngineQueued` holds every waiting `next` steer in MAWS's
// queue first, so nothing runs after it; Focus puts focus in that session's composer (its docked frame when a card
// holds the composer's place). UX wave U4a M5 (decision 21): ⇧⌘I, ⇧⌘E and ⇧⌘M ask that session's composer for the model
// chip's model list, its effort view with the keyboard on the slider, and the mode chip's menu, through the composer's
// store; a chord pressed while its menu is on screen closes it, and none asks for anything while the pane shows no
// session's composer or a card holds its place.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { useKeyChord } from '../keymap/useKeyChord';
import { chipViewOf, closeChipWidget, closeModeMenu, requestChipWidget, requestModeMenu, useComposerStore } from '../stores/composer';
import { tabOnScreen, useLayout } from '../stores/layout';
import { useQueueStore } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { sessionControls } from '../session/controls/controls-for'; // P5 O9 M4
import { isBusy } from './submit/submit-state';
import { followStop } from '../lane-b/stop-act'; // the UX wave, U9 (S-01)

// The session of the focused pane's active tab (in the strip's set, W12), if that tab is a session's. UX wave U7b (§N, the
// second table): none behind a page, so these keys work on nothing the person cannot see.
export function focusedSession(): AppSessionId | null {
  const tab = tabOnScreen(useLayout.getState());
  return tab?.kind === 'session' ? tab.appSessionId : null;
}

export function stopFocused(client: MawsBridge = ipc): void {
  const appSessionId = focusedSession();
  if (appSessionId === null) return;
  const controls = sessionControls(appSessionId, client);
  // P5 O9 M5: a session another process runs (lane A) is busy as its holder reports its turn
  const elsewhere = controls?.turn() ?? null;
  if (elsewhere !== null) {
    if (!elsewhere.running) return;
  } else {
    const status = useSessions.getState().engine.get(appSessionId) ?? null;
    const entries = useQueueStore.getState().bySession.get(appSessionId)?.entries ?? [];
    if (status?.process !== 'ready' || !isBusy(status, entries)) return;
  }
  followStop(appSessionId, () => controls?.interrupt({ cancelEngineQueued: false, holdEngineQueued: true })); // the UX wave, U9 (S-01): one decision closes it (offline, one out), and a failed one says so
}

export function focusFocused(): void {
  const appSessionId = focusedSession();
  if (appSessionId !== null) useComposerStore.getState().focusTargets.get(appSessionId)?.focusFrame();
}

export type ComposerMenu = 'model' | 'effort' | 'mode';

export function toggleFocusedMenu(menu: ComposerMenu): void {
  const appSessionId = focusedSession();
  if (appSessionId === null) return;
  const state = useComposerStore.getState();
  const target = state.focusTargets.get(appSessionId);
  if (target === undefined || target.draftShown?.() === false) return;
  if (menu === 'mode') {
    if (state.modeMenus.has(appSessionId)) closeModeMenu(appSessionId);
    else requestModeMenu(appSessionId);
    return;
  }
  // the view on screen decides, not the request that opened the menu: the selector moves between its views itself
  if (chipViewOf(state, appSessionId) === menu) closeChipWidget(appSessionId);
  else requestChipWidget(appSessionId, menu, '', menu === 'effort' ? 'slider' : undefined);
}

export function ComposerAppKeys({ client = ipc }: { client?: MawsBridge }) {
  useKeyChord('composer.stop', () => stopFocused(client));
  useKeyChord('composer.focus', focusFocused);
  useKeyChord('composer.modelMenu', () => toggleFocusedMenu('model'));
  useKeyChord('composer.effortMenu', () => toggleFocusedMenu('effort'));
  useKeyChord('composer.modeMenu', () => toggleFocusedMenu('mode'));
  return null;
}
