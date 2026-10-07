// Page permissions (E4a execution document, Design §8; A-31; Decision Log 12): every request a page makes is denied and
// shown in the chrome's banner (one line per host and permission, cleared on the next navigation), with one carve-out:
// `clipboard-sanitized-write` is granted within 2 s of the human's own input to that page while the agent does not hold
// it, since Chrome grants it on user activation without a prompt and a site's Copy button would otherwise fail on every
// page; the agent never gets it, and `clipboard-read` stays denied. Checks answer the same; devices and screen capture
// are refused; a fullscreen request is a denied permission like any other. HTTP authentication is cancelled (the page
// shows the server's 401). The context menu's Copy and ⌘C are native and untouched.
import type { Session } from 'electron';
import { BROWSER_DENIED_MAX, type BrowserTab } from '@shared/browser/tab';
import { hostOf } from '@shared/browser/url';
import type { PreparePartition } from './partition';
import type { TabEntry, TabInput, TabStore } from './tabs';

export const CLIPBOARD_HUMAN_INPUT_MS = 2000;

// The one permission a page may get, and when.
export function permissionGranted(permission: string, tab: Pick<BrowserTab, 'control'>, input: TabInput, now: number): boolean {
  if (permission !== 'clipboard-sanitized-write' || tab.control === 'agent' || input.lastHumanAt === null) return false;
  const since = now - input.lastHumanAt;
  return since >= 0 && since <= CLIPBOARD_HUMAN_INPUT_MS;
}

// The banner's lines with one more denial: one line per (host, permission), the newest eight.
export function withDenied(denied: BrowserTab['denied'], next: BrowserTab['denied'][number]): BrowserTab['denied'] {
  if (denied.some((line) => line.host === next.host && line.permission === next.permission)) return denied;
  return [...denied, next].slice(-BROWSER_DENIED_MAX);
}

type PermissionSession = Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler' | 'setDevicePermissionHandler' | 'setDisplayMediaRequestHandler'>;

export function preparePermissions(store: Pick<TabStore, 'entryOf' | 'update'>, now: () => number = Date.now): PreparePartition {
  const granted = (entry: TabEntry | undefined, permission: string) => entry !== undefined && permissionGranted(permission, entry.tab, entry.input, now());
  return (ses: PermissionSession) => {
    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const entry = store.entryOf(webContents);
      if (granted(entry, permission)) return callback(true);
      callback(false);
      if (!entry) return;
      const host = hostOf(details.requestingUrl || webContents.getURL());
      const denied = withDenied(entry.tab.denied, { host, permission });
      if (denied !== entry.tab.denied) store.update(entry.tab.tabId, { denied });
    });
    ses.setPermissionCheckHandler((webContents, permission) => webContents !== null && granted(store.entryOf(webContents), permission));
    ses.setDevicePermissionHandler(() => false);
    ses.setDisplayMediaRequestHandler((_request, callback) => callback({})); // no stream: the capture is refused
  };
}

// The per-page answers no session handler gives.
export function guardPage(entry: TabEntry): void {
  entry.view!.webContents.on('login', (event, _details, _authInfo, callback) => {
    event.preventDefault();
    callback(); // no credentials: the request is cancelled
  });
}
