// C9: `pty.openLink`, the one main-owned `pty.*` command. A terminal's ⌘-clicked link opens through C5's single
// scheme-checked `shell.openExternal` (`openExternalUrl`: http, https and mailto only) and answers whether it did.
// Registered once from main's startup, as the router's convention asks of main-owned commands. P5 O7 M3: a terminal of a
// session on another machine opens its links with that machine as `ctx.target`; a loopback one is that machine's, opened
// in the in-app browser through a forward, so here it answers `opened: false` (./open-external.ts).
import { registerMainHandler } from './ipc/router';
import { FORWARDED_ELSEWHERE, forwardedElsewhere, openExternalUrl } from './open-external';

export function registerPtyOpenLink(): void {
  registerMainHandler('pty.openLink', ({ url }, { target }) => {
    if (!forwardedElsewhere(url, target)) return { opened: openExternalUrl(url) };
    console.warn(`[pty-links] ${FORWARDED_ELSEWHERE}`);
    return { opened: false };
  });
}
