// The keyboard inside the page (E4a execution document, Design §4; Decision Log 9). A chord pressed while a page has
// the focus never reaches the renderer, so the browser's own chords are read on the view's `before-input-event`:
// ⌘R reload, ⌘[ back, ⌘] forward, ⌘L the address field, ⌘F the find bar, ⌘= / ⌘+ zoom in, ⌘- zoom out; Esc only while the
// find bar is open (it closes) or the page is loading (it stops), so pages keep Esc for their own dialogs and editors.
// A taken chord is prevented (which also keeps it from the menu's own accelerators) and acted on at keyDown; its keyUp is
// swallowed so the page never sees half a keystroke. Every other chord passes: MAWS's menu accelerators (⌘K, ⌘W, ⌘0, …)
// keep winning, and ⌘L stays `composer.focus` everywhere but inside a page. No keymap action is added.
// cua #90: ⇧⌘B, Chrome's bookmarks bar chord, is told to the chrome (`toggleBookmarksBar`), which flips the setting; like
// ⌘L it shadows a MAWS chord (`panel.toggle`) inside the page only, and leaves the focus where it is. It is taken only in
// a tab whose partition can show a bar (an imported profile with its bookmarks consented, the bar shown or hidden):
// anywhere else it passes, so Toggle right panel still answers it (the spec's Decision Log, 2026-10-09: the chord
// narrowed to tabs that can show a bar).
import type { Input } from 'electron';
import type { BrowserChromeCommand } from '@shared/ipc/schema/browser';
import type { Navigator } from './navigation';
import type { BrowserProfile } from './partition';
import type { BrowserEmit, TabEntry, TabStore } from './tabs';

// cua #90: whether a tab of `partition` can show a bookmarks bar: an imported profile's, with its bookmarks consented
// (the Default partition never is; a profile imported without Bookmarks has `bookmarks: null`).
export const canShowBookmarksBar = (profiles: readonly Pick<BrowserProfile, 'partition' | 'bookmarks'>[], partition: string): boolean =>
  profiles.some((profile) => profile.partition === partition && profile.bookmarks != null);

export type KeyAction =
  | { kind: 'navigate'; to: 'reload' | 'back' | 'forward' | 'stop' }
  | { kind: 'zoom'; action: 'in' | 'out' }
  | { kind: 'chrome'; command: BrowserChromeCommand['command'] };

export type KeyInput = Pick<Input, 'type' | 'key' | 'meta' | 'control' | 'alt' | 'shift'>;

// `bookmarksBar`: the tab's partition can show a bookmarks bar (cua #90); absent, it cannot.
export function keyAction(input: KeyInput, state: { findOpen: boolean; loading: boolean; bookmarksBar?: boolean }): KeyAction | null {
  if (input.type !== 'keyDown') return null;
  const { meta, control, alt, shift } = input;
  if (input.key === 'Escape') {
    if (meta || control || alt || shift) return null;
    if (state.findOpen) return { kind: 'chrome', command: 'closeFind' };
    return state.loading ? { kind: 'navigate', to: 'stop' } : null;
  }
  if (!meta || control || alt) return null;
  const key = input.key.toLowerCase();
  if (key === 'r') return { kind: 'navigate', to: 'reload' }; // ⇧⌘R too
  if (key === '=' || key === '+') return { kind: 'zoom', action: 'in' };
  if (key === '-') return { kind: 'zoom', action: 'out' };
  if (key === 'b' && shift) return state.bookmarksBar ? { kind: 'chrome', command: 'toggleBookmarksBar' } : null; // cua #90
  if (shift) return null;
  if (key === '[') return { kind: 'navigate', to: 'back' };
  if (key === ']') return { kind: 'navigate', to: 'forward' };
  if (key === 'l') return { kind: 'chrome', command: 'focusAddress' };
  if (key === 'f') return { kind: 'chrome', command: 'openFind' };
  return null;
}

export interface KeysDeps {
  store: Pick<TabStore, 'entry'>;
  navigator: Pick<Navigator, 'navigate' | 'zoom' | 'find'>;
  emit: BrowserEmit;
  bookmarksBar(partition: string): boolean; // cua #90: whether a tab of this partition can show a bookmarks bar
}

export function attachKeys(entry: TabEntry, { store, navigator, emit, bookmarksBar }: KeysDeps): void {
  const view = entry.view!;
  const { tabId } = entry.tab;
  const taken = new Set<string>(); // the codes whose keyDown was taken: their keyUp is swallowed too
  view.webContents.on('before-input-event', (event, input) => {
    if (store.entry(tabId) !== entry || entry.view !== view) return;
    if (input.type === 'keyUp') {
      if (taken.delete(input.code)) event.preventDefault();
      return;
    }
    const action = keyAction(input, { findOpen: entry.findOpen, loading: entry.tab.loading, bookmarksBar: bookmarksBar(entry.tab.partition) });
    if (!action) {
      // a press of a key whose taken chord's keyUp went elsewhere (⌘L and ⌘F move the focus to the app's window): its
      // own keyUp now belongs to the page
      if (input.type === 'keyDown') taken.delete(input.code);
      return;
    }
    event.preventDefault();
    taken.add(input.code);
    switch (action.kind) {
      case 'navigate':
        return void navigator.navigate(tabId, action.to);
      case 'zoom':
        return void navigator.zoom(tabId, action.action);
      case 'chrome':
        if (action.command === 'closeFind') {
          navigator.find(tabId, { text: null });
          entry.findOpen = false;
        } else if (action.command !== 'toggleBookmarksBar') {
          entry.host?.webContents.focus(); // the native focus leaves the page for the chrome's field
          if (action.command === 'openFind') entry.findOpen = true;
        }
        emit('browser.chrome.command', { tabId, command: action.command });
    }
  });
}
