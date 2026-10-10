// The one scheme-checked `shell.openExternal` (wave-2 ledger d.11): behind `layout.openExternal` (C6's links) and,
// once C9 lands, `pty.openLink`. Only http, https and mailto leave the app.
import { appendFile } from 'node:fs/promises';
import { shell } from 'electron';
import { registerMainHandler } from './ipc/router';

const ALLOWED = new Set(['http:', 'https:', 'mailto:']);

export function openExternalUrl(url: string): boolean {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    console.warn(`[open-external] refused a malformed URL`);
    return false;
  }
  if (!ALLOWED.has(protocol)) {
    console.warn(`[open-external] refused a ${protocol} URL`);
    return false;
  }
  // The overflow menu uses layout.openExternal, not the browser's context-menu seam. Keep its hand-off inside
  // the scratch e2e log too, after the same scheme check and without ever launching the system browser.
  const log = process.env.MAWS_E2E === '1' ? process.env.MAWS_E2E_OPEN_LOG : undefined;
  if (log) {
    void appendFile(log, `openExternal ${url}\n`).catch((error: unknown) => console.warn('[open-external] could not write the e2e seam log', error));
    return true;
  }
  shell.openExternal(url).catch((error: unknown) => console.error('[open-external] could not open the URL', error));
  return true;
}

export function registerOpenExternal(): void {
  registerMainHandler('layout.openExternal', ({ url }) => {
    if (!openExternalUrl(url)) throw new Error(`layout.openExternal opens http, https and mailto links only`);
  });
}
