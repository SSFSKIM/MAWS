// E4a (Task 3.1): the renderer's mirror of main's browser tabs (E4a execution document, Design §1 and §2), one vanilla
// zustand store for the window. Main owns every tab; this store holds what it said, so the chrome and the panes render
// from data alone:
//
// - `sessions`: each session's tabs and its selected tab, from `browser.tabs.list` (the whole app's once at connect, one
//   session's when a Browser surface mounts) and `browser.tabs.changed` after; a list answer never overwrites a session
//   whose state moved while it was out (an event, or another answer, landed first);
// - `placeholders`: a covered tab's picture (`browser.view.covered`), kept while the tab is listed covered;
// - `notices`: the chrome's transient lines (Design §4; Decision Log 28), main's `browser.notice` and the chrome's own,
//   routed by session (Decision Log 44 (f)) and gone after BROWSER_NOTICE_MS.
//
// Main's `browser.chrome.command` (⌘L, ⌘F, Esc pressed inside a page) is relayed to the chrome through
// `onChromeCommand`, since it is a one-shot instruction rather than state.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { BrowserTab } from '@shared/browser/tab';
import { hostOf } from '@shared/browser/url';
import type { AppSessionId } from '@shared/graph/ids';
import type { BrowserChromeCommand, BrowserNotice, BrowserTabsChanged } from '@shared/ipc/schema/browser';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';

export const BROWSER_NOTICE_MS = 4000;

export interface SessionTabs {
  tabs: BrowserTab[];
  selected: string | null;
}

// `urlCopied` is the chrome's own (Copy URL is the renderer's clipboard write; Decision Log 37); every other kind is
// main's, which the chrome may also raise itself (the address field's refused scheme).
export type ChromeNoticeKind = BrowserNotice['kind'] | 'urlCopied';
export interface ChromeNotice {
  id: number;
  appSessionId: AppSessionId;
  tabId: string | null;
  kind: ChromeNoticeKind;
  name?: string;
  count?: number;
}

export interface BrowserState {
  ready: boolean; // the app-wide list answered: a tab absent from it is gone
  sessions: Map<AppSessionId, SessionTabs>;
  placeholders: Map<string, string | null>; // by tab id
  notices: ChromeNotice[];
}

const initial = (): BrowserState => ({ ready: false, sessions: new Map(), placeholders: new Map(), notices: [] });

export const browser = createStore<BrowserState>()(initial);
export const useBrowser = <T>(selector: (state: BrowserState) => T): T => useStore(browser, selector);

const EMPTY: SessionTabs = { tabs: [], selected: null };
export const sessionTabs = (state: BrowserState, appSessionId: AppSessionId): SessionTabs => state.sessions.get(appSessionId) ?? EMPTY;

// A tab's name in the chrome and the main tab's title: the page's title, else its host (Codex's rule), else nothing.
export const tabTitle = (tab: BrowserTab): string => tab.title || (tab.url === '' ? '' : hostOf(tab.url));

// ---- sessions ----------------------------------------------------------------------------------------------------------

// Each session's version: bumped by every change this store applies, so a list answer applies to a session only when
// nothing moved it since the list was asked for (an event in flight is newer; so is an answer that landed first, and
// whatever it lacked main sends as an event).
const versions = new Map<AppSessionId, number>();
const versionOf = (appSessionId: AppSessionId) => versions.get(appSessionId) ?? 0;
const bump = (appSessionId: AppSessionId) => versions.set(appSessionId, versionOf(appSessionId) + 1);

// The placeholders that still belong: a tab listed covered keeps its picture; uncovered or gone, it drops.
function prunePlaceholders(placeholders: Map<string, string | null>, sessions: Map<AppSessionId, SessionTabs>): Map<string, string | null> {
  if (placeholders.size === 0) return placeholders;
  const covered = new Set([...sessions.values()].flatMap(({ tabs }) => tabs.filter((tab) => tab.covered).map((tab) => tab.tabId)));
  const kept = new Map([...placeholders].filter(([tabId]) => covered.has(tabId)));
  return kept.size === placeholders.size ? placeholders : kept;
}

function setSessions(updates: Map<AppSessionId, SessionTabs>, ready?: boolean): void {
  if (updates.size === 0 && ready === undefined) return;
  for (const appSessionId of updates.keys()) bump(appSessionId);
  browser.setState((s) => {
    const sessions = new Map(s.sessions);
    for (const [appSessionId, value] of updates) sessions.set(appSessionId, value);
    return { sessions, placeholders: prunePlaceholders(s.placeholders, sessions), ...(ready !== undefined && { ready }) };
  });
}

function applyChanged({ appSessionId, tabs, selected }: BrowserTabsChanged): void {
  setSessions(new Map([[appSessionId as AppSessionId, { tabs, selected }]]));
}

// Lists every session (`appSessionId` absent) or one, applying the answer where nothing moved meanwhile.
function list(client: MawsBridge, appSessionId?: AppSessionId): void {
  const asked = new Map(versions);
  void client.invoke('browser.tabs.list', appSessionId === undefined ? {} : { appSessionId }).then((result) => {
    if (!result.ok) {
      console.warn(`[browser] listing tabs failed: ${result.error.message}`);
      return;
    }
    const { tabs, selected } = result.value;
    const answered = new Map<AppSessionId, SessionTabs>();
    const touched = new Set<AppSessionId>(appSessionId === undefined ? [...browser.getState().sessions.keys()] : [appSessionId]);
    for (const tab of tabs) touched.add(tab.appSessionId);
    for (const id of Object.keys(selected)) touched.add(id as AppSessionId);
    for (const id of touched) {
      if (versionOf(id) !== (asked.get(id) ?? 0)) continue;
      answered.set(id, { tabs: tabs.filter((tab) => tab.appSessionId === id), selected: selected[id] ?? null });
    }
    setSessions(answered, appSessionId === undefined ? true : undefined);
  });
}

// A Browser surface's mount: its session listed afresh, which is also when main tells a broken tabs file (Decision Log
// 37 and 44 (a)).
export function listSession(appSessionId: AppSessionId, client: MawsBridge = ipc): void {
  list(client, appSessionId);
}

// ---- notices -----------------------------------------------------------------------------------------------------------

let lastNotice = 0;
const noticeTimers = new Map<number, ReturnType<typeof setTimeout>>();

export function raiseNotice(notice: Omit<ChromeNotice, 'id'>): void {
  const id = ++lastNotice;
  browser.setState((s) => ({ notices: [...s.notices, { ...notice, id }] }));
  noticeTimers.set(
    id,
    setTimeout(() => dismissNotice(id), BROWSER_NOTICE_MS),
  );
}

export function dismissNotice(id: number): void {
  clearTimeout(noticeTimers.get(id));
  noticeTimers.delete(id);
  browser.setState((s) => (s.notices.some((notice) => notice.id === id) ? { notices: s.notices.filter((notice) => notice.id !== id) } : s));
}

// ---- chrome commands ---------------------------------------------------------------------------------------------------

const commandListeners = new Set<(command: BrowserChromeCommand) => void>();

export function onChromeCommand(listener: (command: BrowserChromeCommand) => void): () => void {
  commandListeners.add(listener);
  return () => void commandListeners.delete(listener);
}

// ---- the connection ----------------------------------------------------------------------------------------------------

// App.tsx's E4a block. `browser.notice` first: main raises a broken tabs file inside the first session-scoped list
// (Decision Log 44 (a)). `browser.download.refused` is E4c's to read; its chrome line arrives as a notice.
export function connectBrowser(client: MawsBridge = ipc): () => void {
  const offs = [
    client.on('browser.notice', ({ appSessionId, tabId, kind, name, count }) =>
      raiseNotice({ appSessionId: appSessionId as AppSessionId, tabId, kind, ...(name !== undefined && { name }), ...(count !== undefined && { count }) }),
    ),
    client.on('browser.tabs.changed', applyChanged),
    client.on('browser.view.covered', ({ tabId, placeholder }) => browser.setState((s) => ({ placeholders: new Map(s.placeholders).set(tabId, placeholder) }))),
    client.on('browser.control.changed', ({ tabId, control, controlSince }) => {
      const held = [...browser.getState().sessions].find(([, { tabs }]) => tabs.some((tab) => tab.tabId === tabId));
      if (!held) return;
      const [appSessionId, value] = held;
      setSessions(new Map([[appSessionId, { ...value, tabs: value.tabs.map((tab) => (tab.tabId === tabId ? { ...tab, control, controlSince } : tab)) }]]));
    }),
    client.on('browser.chrome.command', (command) => commandListeners.forEach((listener) => listener(command))),
  ];
  list(client);
  return () => offs.forEach((off) => off());
}

// ---- reads -------------------------------------------------------------------------------------------------------------

// A `browser` main tab's title for the strip and the toolbar: its tab's, else null (the caller says "Browser").
export function useBrowserTitle(appSessionId: AppSessionId | null, browserTabId: string | null): string | null {
  return useBrowser((s) => {
    if (appSessionId === null || browserTabId === null) return null;
    const tab = sessionTabs(s, appSessionId).tabs.find((candidate) => candidate.tabId === browserTabId);
    return tab ? tabTitle(tab) || null : null;
  });
}

// Tests.
export function resetBrowser(): void {
  versions.clear();
  for (const timer of noticeTimers.values()) clearTimeout(timer);
  noticeTimers.clear();
  commandListeners.clear();
  browser.setState(initial());
}
