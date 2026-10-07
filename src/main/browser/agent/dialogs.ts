// A page's JavaScript dialogs where nobody could answer them (E4c execution document, Decision Log 33, 35 with the
// architect's A-42 conditions, 44 (a), 60; Task 0.3 (f), `findings-e4c-unplaced.txt`).
//
// Electron 44.4.5 hands a page's `alert` and `confirm` to main's JavaScript as the webContents' internal `-run-dialog`
// event, `(info { frame, dialogType, messageText, defaultPromptText }, callback(accept, text))`, with exactly one listener
// of its own (`lib/browser/api/web-contents.ts`): a sheet on the owner window, or, for a view that has no owner window,
// a parentless modal that freezes main. CDP's `Page.handleJavaScriptDialog` answers the page but never closes Electron's
// box, so the one lever is that listener: every tab view's is wrapped at creation (adopted pop-ups included), and the
// wrapper routes each dialog:
//   - the agent holds the tab (`control: 'agent'`): `alert` dismissed, `confirm` answered false, and the dialog's type and
//     message, cut, kept for the agent's result (`take`, drained into the next result naming the tab);
//   - no pane places the tab and the agent does not hold it (never placed, or released; the person's): answered with the
//     same defaults and held, at most ten, until a pane next places the tab, when one `browser.notice` `dialogAnswered`
//     names the last of them (A-42 condition 3: "this tab" is then the shown one);
//   - a placed tab the person holds (`idle`, `human`): Electron's own dialog, exactly as E4a landed it, except on a page
//     Electron does not bound itself (its `safeDialogs` off, which on 44.4.5 is an adopted `window.open` pop-up): there,
//     once two dialogs have ended within 5 s (sliding, reset by a committed navigation), further ones are dismissed as
//     `safeDialogs` would, with one notice per run (Decision Log 60);
//   - a `prompt` (or any other kind) is always Electron's: its renderer refuses `prompt()` before main sees it, and its
//     listener answers one that arrives at once without showing anything.
// The guard: the wrap is installed only over exactly one existing listener, Electron's own; otherwise the view is left
// native and one line is logged, so an Electron that renames or multiplies the event fails the e2e's alert step loudly
// rather than freezing. The event is Electron-internal on a version-pinned build (A-42; the tracker's re-verify row).
import type { WebContents } from 'electron';
import { BROWSER_DIALOG_EXCERPT_MAX_CHARS, BROWSER_DIALOG_MESSAGE_MAX_CHARS, BROWSER_DIALOGS_MAX } from '@shared/browser/dialog';
import type { BrowserControl } from '@shared/browser/tab';
import type { BrowserDialog } from '@shared/maws/browser';
import type { BrowserEmit, TabEntry, TabStore } from '../tabs';
import type { AgentDialogs } from './handlers';

export const RUN_DIALOG_EVENT = '-run-dialog';
export const DIALOG_BOUND_WINDOW_MS = 5_000;
export const DIALOG_BOUND_AFTER = 2; // dialogs ended within the window before the next is dismissed

export interface RunDialogInfo {
  dialogType: string;
  messageText: string;
  defaultPromptText?: string;
  frame?: unknown;
}
export type RunDialogCallback = (accept: boolean, text: string) => void;
type RunDialogListener = (this: unknown, info: RunDialogInfo, callback: RunDialogCallback) => void;

// `native(callback)` hands the dialog to Electron's own listener (with the callback the wrapper chose).
export type RunDialogHandler = (info: RunDialogInfo, callback: RunDialogCallback, native: (callback: RunDialogCallback) => void) => void;

// Wraps the webContents' one `-run-dialog` listener; false (nothing changed) when it does not have exactly one. The
// event is not in Electron's typings: the webContents is taken as the EventEmitter it is.
export function wrapRunDialog(contents: NodeJS.EventEmitter, handler: RunDialogHandler): boolean {
  const listeners = contents.listeners(RUN_DIALOG_EVENT) as RunDialogListener[];
  if (listeners.length !== 1) return false;
  const original = listeners[0]!;
  contents.removeListener(RUN_DIALOG_EVENT, original);
  contents.on(RUN_DIALOG_EVENT, (info: RunDialogInfo, callback: RunDialogCallback) => handler(info, callback, (answer) => original.call(contents, info, answer)));
  return true;
}

// Whether Electron bounds the page's dialogs itself: its own `-run-dialog` listener reads `safeDialogs` from
// `getLastWebPreferences()` (E4a Decision Log 56), which is not in the typings either.
function safeDialogsOf(contents: WebContents): boolean {
  const preferences = (contents as unknown as { getLastWebPreferences?(): { safeDialogs?: boolean } | null }).getLastWebPreferences?.();
  return preferences?.safeDialogs === true;
}

export type DialogRoute = 'native' | 'agent' | 'hidden' | 'bounded';

export interface DialogFacts {
  type: string;
  control: BrowserControl;
  placed: boolean; // a pane places the tab
  safeDialogs: boolean; // Electron bounds the page's dialogs itself
  recent: number; // the page's dialogs that ended within DIALOG_BOUND_WINDOW_MS
}

// The routing table (A-42 conditions 1 to 3; Decision Log 60).
export function routeDialog({ type, control, placed, safeDialogs, recent }: DialogFacts): DialogRoute {
  if (type !== 'alert' && type !== 'confirm') return 'native';
  if (control === 'agent') return 'agent';
  if (!placed) return 'hidden';
  if (!safeDialogs && recent >= DIALOG_BOUND_AFTER) return 'bounded';
  return 'native';
}

interface PageDialogState {
  held: { type: 'alert' | 'confirm'; excerpt: string }[]; // answered while unplaced, told when next placed
  ended: number[]; // when the page's recent dialogs ended (the adopted pop-up's bound)
  bounding: boolean; // a run of dismissed dialogs was told already
}

export interface PageDialogsDeps {
  store: Pick<TabStore, 'all' | 'entry' | 'onViewCreated' | 'onViewDestroying' | 'onUpdated'>;
  emit: BrowserEmit;
  log(line: string): void;
  now?(): number;
}

export class PageDialogs implements AgentDialogs {
  private readonly states = new WeakMap<TabEntry, PageDialogState>();
  private readonly wrapped = new WeakSet<object>();
  private readonly agent = new Map<string, BrowserDialog[]>(); // per tab id, until a result reports them
  private readonly unhook: (() => void)[];
  private readonly now: () => number;

  constructor(private readonly deps: PageDialogsDeps) {
    this.now = deps.now ?? Date.now;
    const { store } = deps;
    for (const entry of store.all()) this.install(entry);
    this.unhook = [
      store.onViewCreated((entry) => this.install(entry)),
      store.onUpdated((entry) => this.shown(entry)),
      store.onViewDestroying((entry) =>
        queueMicrotask(() => {
          if (store.entry(entry.tab.tabId) !== entry) this.agent.delete(entry.tab.tabId); // closed: nothing to report to
        }),
      ),
    ];
  }

  // AgentDialogs: the dialogs answered for the agent on this tab since its last result, forgotten once taken.
  take(tabId: string): BrowserDialog[] {
    const dialogs = this.agent.get(tabId) ?? [];
    this.agent.delete(tabId);
    return dialogs;
  }

  dispose(): void {
    for (const unhook of this.unhook.splice(0)) unhook();
  }

  private install(entry: TabEntry): void {
    const view = entry.view;
    if (!view || this.wrapped.has(view.webContents)) return;
    const contents = view.webContents;
    this.wrapped.add(contents);
    const handled = wrapRunDialog(contents as unknown as NodeJS.EventEmitter, (info, callback, native) => this.handle(entry, contents, info, callback, native));
    if (!handled) {
      const count = contents.listenerCount(RUN_DIALOG_EVENT);
      this.deps.log(`${RUN_DIALOG_EVENT}: tab ${entry.tab.tabId}'s page has ${count} listeners where Electron 44.4.5 has one; its dialogs stay native (re-verify the wrap on this Electron)`);
      return;
    }
    // a committed document is a new page: its predecessor's dialogs no longer count against it
    contents.on('did-navigate', () => {
      if (entry.view?.webContents === contents) this.stateOf(entry).ended = [];
    });
  }

  private handle(entry: TabEntry, contents: WebContents, info: RunDialogInfo, callback: RunDialogCallback, native: (callback: RunDialogCallback) => void): void {
    // a page no longer the tab's has no pane and may have no owner window: Electron's dialog would be the parentless modal
    // that blocks main, so it is dismissed
    if (this.deps.store.entry(entry.tab.tabId) !== entry || entry.view?.webContents !== contents) return callback(false, '');
    const state = this.stateOf(entry);
    const now = this.now();
    state.ended = state.ended.filter((at) => now - at < DIALOG_BOUND_WINDOW_MS);
    const type = info.dialogType;
    const route = routeDialog({
      type,
      control: entry.tab.control,
      placed: entry.tab.placedIn !== null,
      safeDialogs: safeDialogsOf(contents),
      recent: state.ended.length,
    });
    if (route === 'native') {
      if (type === 'alert' || type === 'confirm') state.bounding = false;
      // the page's dialog counts from when the person closed it (a slow loop is a loop all the same)
      return native((accept, text) => {
        state.ended.push(this.now());
        callback(accept, text);
      });
    }
    callback(false, ''); // alert dismissed, confirm false: the page's non-destructive answer
    const dialogType = type as 'alert' | 'confirm';
    const message = info.messageText ?? '';
    switch (route) {
      case 'agent': {
        const kept = this.agent.get(entry.tab.tabId) ?? [];
        kept.push({ type: dialogType, message: cut(message, BROWSER_DIALOG_MESSAGE_MAX_CHARS) });
        this.agent.set(entry.tab.tabId, kept.slice(-BROWSER_DIALOGS_MAX));
        return;
      }
      case 'hidden':
        state.held.push({ type: dialogType, excerpt: cut(message, BROWSER_DIALOG_EXCERPT_MAX_CHARS) });
        state.held = state.held.slice(-BROWSER_DIALOGS_MAX);
        return;
      case 'bounded':
        state.ended.push(now);
        if (state.bounding) return;
        state.bounding = true;
        this.notice(entry, { dialogType, excerpt: cut(message, BROWSER_DIALOG_EXCERPT_MAX_CHARS) });
        return;
    }
  }

  // A pane places the tab: the dialogs answered while nobody could see it are told, once.
  private shown(entry: TabEntry): void {
    const state = this.states.get(entry);
    if (!state || state.held.length === 0 || entry.tab.placedIn === null) return;
    const last = state.held.at(-1)!;
    const count = state.held.length;
    state.held = [];
    this.notice(entry, { dialogType: last.type, excerpt: last.excerpt, count });
  }

  private notice(entry: TabEntry, notice: { dialogType: 'alert' | 'confirm'; excerpt: string; count?: number }): void {
    const { appSessionId, tabId } = entry.tab;
    this.deps.emit('browser.notice', { appSessionId, tabId, kind: 'dialogAnswered', ...notice });
  }

  private stateOf(entry: TabEntry): PageDialogState {
    let state = this.states.get(entry);
    if (!state) this.states.set(entry, (state = { held: [], ended: [], bounding: false }));
    return state;
  }
}

// Page text kept as plain text, cut, never inside a surrogate pair.
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = /[\uD800-\uDBFF]/.test(text[max - 1]!) ? max - 1 : max;
  return text.slice(0, end);
}
