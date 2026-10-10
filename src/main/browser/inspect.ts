// The e2e's window into main's browser (E4a execution document, Interfaces "Main"; E2's pattern, `deliverables/index.ts`):
// installed as `globalThis.__maws_browser` under MAWS_E2E=1 only, read through `app.evaluate`, since a view's placement,
// visibility and window are main's alone and no IPC command reports them. `tab` reads `visible`, `bounds` and `attached`
// from the view as Electron holds it (so the e2e checks what the screen shows), and `windowId` and `owner` from main's
// records of the window holding the view and the pane placing it; `showPane` hands the windows a `maws.pane.show` as
// the engine host would for `show_pane` (the e2e runs no engine; it answers whether the event was sent); `metrics` says
// how many tabs are loaded and measured.
import type { CuaBackend } from './cua';
import type { NativeMenuSeam } from './bookmarks/menu';
import type { ExtensionsInspector } from './extensions';
import type { MawsPaneShow } from '@shared/ipc/schema/maws';
import type { BrowserEmit, TabEntry, TabStore } from './tabs';

export interface InspectedTab {
  visible: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
  attached: boolean; // the view is a child of its window's contentView
  windowId: number | null; // the window holding the view (it stays there, hidden, after its owner lets go)
  owner: { paneId: string; surface: 'panel' | 'main'; windowId: number } | null; // the pane that places it
}

export interface BrowserInspector {
  tab(tabId: string): InspectedTab | null;
  showPane(request: MawsPaneShow): boolean; // `emit`'s answer: false when the request was invalid and nothing was sent
  metrics(): { loaded: number; sampled: number };
  // E13, under MAWS_E2E=1; `trustRoot(pid)` makes the process a root every session's socket accepts descendants of
  // (false when it is gone or the addon is missing)
  cua?: Pick<CuaBackend, 'socketPathFor' | 'inspect' | 'holds'> & { trustRoot(pid: number): boolean };
  menu?: NativeMenuSeam & { openAllAsked(): number[] }; // cua #90: the last native menu, chosen from by id path; "Open all"'s questions
  extensions?: ExtensionsInspector; // cua #90: the open extension popup, and its page's answers
}

declare global {
  var __maws_browser: BrowserInspector | undefined;
}

export interface BrowserInspectorDeps {
  store: Pick<TabStore, 'entry' | 'all' | 'loadedCount'>;
  emit: BrowserEmit;
}

export function browserInspector({ store, emit }: BrowserInspectorDeps): BrowserInspector {
  return {
    tab: (tabId) => {
      const entry = store.entry(tabId);
      return entry ? inspect(entry) : null;
    },
    showPane: (request) => emit('maws.pane.show', request) === true,
    metrics: () => ({
      loaded: store.loadedCount(),
      sampled: store.all().filter((entry) => entry.view !== null && entry.tab.memoryKiB !== null).length,
    }),
  };
}

function inspect({ view, host, placement }: TabEntry): InspectedTab {
  const live = view !== null && !view.webContents.isDestroyed() ? view : null;
  const window = host !== null && !host.isDestroyed() ? host : null;
  return {
    visible: live?.getVisible() ?? false,
    bounds: live ? { ...live.getBounds() } : null,
    attached: live !== null && window !== null && window.contentView.children.includes(live),
    windowId: window?.id ?? null,
    owner: placement && { paneId: placement.paneId, surface: placement.surface, windowId: placement.window.id },
  };
}
