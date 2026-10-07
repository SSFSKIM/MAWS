// E4a: the commands the browser's own surfaces send main (E4a execution document, Interfaces "IPC `browser.*`"). Every
// URL here has passed `validateBrowserUrl` and is its parsed form, never typed text (Decision Log 34). A tab that closed
// meanwhile answers `invalid_input` "unknown browser tab", which is no fault of the person's and is dropped silently;
// every other refusal is warned.
import { UNKNOWN_BROWSER_TAB, type BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { useLayout } from '../../stores/layout';

type Answer<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

// The answer's value, or null after a refusal (warned unless the tab is merely gone).
const quietly =
  (what: string) =>
  <T>(result: Answer<T>): T | null => {
    if (result.ok) return result.value;
    if (!(result.error.code === 'invalid_input' && result.error.message === UNKNOWN_BROWSER_TAB)) console.warn(`[browser] ${what} failed: ${result.error.message}`);
    return null;
  };

export function navigate(tabId: string, to: CommandInput<'browser.tabs.navigate'>['to']): void {
  void ipc.invoke('browser.tabs.navigate', { tabId, to }).then(quietly('navigating'));
}

export function place(report: CommandInput<'browser.view.place'>): void {
  void ipc.invoke('browser.view.place', report).then(quietly('placing the page'));
}

// ---- the chrome's (Task 3.3) -------------------------------------------------------------------------------------------

// A new tab of the session, selected: the tab main made, or null when it refused.
export async function openTab(appSessionId: AppSessionId, url: string | null): Promise<BrowserTab | null> {
  const value = quietly('opening a tab')(await ipc.invoke('browser.tabs.open', { appSessionId, url, select: true }));
  return value?.tab ?? null;
}

// One of the session's browser tabs as its own main tab (X14).
export function openMainTab(appSessionId: AppSessionId, browserTabId: string): void {
  useLayout.getState().openTab({ kind: 'browser', appSessionId, browserTabId });
}

export function closeTab(tabId: string): void {
  void ipc.invoke('browser.tabs.close', { tabId }).then(quietly('closing a tab'));
}

export function selectTab(appSessionId: AppSessionId, tabId: string): void {
  void ipc.invoke('browser.tabs.select', { appSessionId, tabId }).then(quietly('selecting a tab'));
}

export function zoom(tabId: string, action: CommandInput<'browser.tabs.zoom'>['action']): void {
  void ipc.invoke('browser.tabs.zoom', { tabId, action }).then(quietly('zooming'));
}

export function find(request: CommandInput<'browser.tabs.find'>): void {
  void ipc.invoke('browser.tabs.find', request).then(quietly('finding in the page'));
}

export function dismiss(tabId: string, notice: CommandInput<'browser.tabs.dismiss'>['notice']): void {
  void ipc.invoke('browser.tabs.dismiss', { tabId, notice }).then(quietly('dismissing a notice'));
}

export function inspect(tabId: string): void {
  void ipc.invoke('browser.tabs.devtools', { tabId }).then(quietly('opening the developer tools'));
}

export function revealDownload(tabId: string): void {
  void ipc.invoke('browser.tabs.revealDownload', { tabId }).then(quietly('revealing the download'));
}

export function handBack(tabId: string): void {
  void ipc.invoke('browser.control.handBack', { tabId }).then(quietly('handing the page back'));
}

export function openExternal(url: string): void {
  void ipc.invoke('layout.openExternal', { url }).then(quietly('opening the page in the system browser'));
}
