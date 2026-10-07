// E4a: the commands the browser's own surfaces send main (E4a execution document, Interfaces "IPC `browser.*`"). Every
// URL here has passed `validateBrowserUrl` and is its parsed form, never typed text (Decision Log 34). A tab that closed
// meanwhile answers `invalid_input`, which is no fault of the person's and is dropped silently.
import type { CommandInput } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';

const quietly = (what: string) => (result: { ok: true } | { ok: false; error: { code: string; message: string } }) => {
  if (!result.ok && result.error.code !== 'invalid_input') console.warn(`[browser] ${what} failed: ${result.error.message}`);
};

export function navigate(tabId: string, to: CommandInput<'browser.tabs.navigate'>['to']): void {
  void ipc.invoke('browser.tabs.navigate', { tabId, to }).then(quietly('navigating'));
}

export function place(report: CommandInput<'browser.view.place'>): void {
  void ipc.invoke('browser.view.place', report).then(quietly('placing the page'));
}
