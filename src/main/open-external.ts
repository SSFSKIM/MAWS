// The one scheme-checked `shell.openExternal` (wave-2 ledger d.11): behind `layout.openExternal` (C6's links) and,
// once C9 lands, `pty.openLink`. Only http, https and mailto leave the app.
//
// P5 O7 M3 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Forwarding"): a link opened out of a session on
// another machine reaches these handlers with that machine as `ctx.target` (the router answers both here for any
// machine). A loopback link of such a session names that machine's own loopback (`isLoopbackLink`, any loopback host by
// any scheme): the forwardable ones open in the in-app browser through a forwarded port (`remote.forward.open`), the
// rest nowhere, and none is ever opened here, where it would load this Mac's.
import { appendFile } from 'node:fs/promises';
import { shell } from 'electron';
import { isLoopbackLink } from '@shared/machine/loopback-link';
import type { MachineRef } from '@shared/machine/ref';
import { registerMainHandler } from './ipc/router';
import { boundLocalMachine } from './machine/local';

/** The words for a loopback link of another machine's session, refused here. */
export const FORWARDED_ELSEWHERE = 'a localhost link of a session on another machine names that machine, not this Mac: it opens only in the in-app browser, forwarded from that machine';

/** Whether `url` is a loopback link of a session on another machine (`target`): never opened on this Mac. */
export function forwardedElsewhere(url: string, target: MachineRef | undefined): boolean {
  const local = boundLocalMachine();
  return target !== undefined && local !== null && target !== local && isLoopbackLink(url);
}

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
  registerMainHandler('layout.openExternal', ({ url }, { target }) => {
    if (forwardedElsewhere(url, target)) throw new Error(FORWARDED_ELSEWHERE);
    if (!openExternalUrl(url)) throw new Error(`layout.openExternal opens http, https and mailto links only`);
  });
}
