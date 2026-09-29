// C9: `pty.openLink`, the one main-owned `pty.*` command. A terminal's ⌘-clicked link opens through C5's single
// scheme-checked `shell.openExternal` (`openExternalUrl`: http, https and mailto only) and answers whether it did.
// Registered once from main's startup, as the router's convention asks of main-owned commands.
import { registerMainHandler } from './ipc/router';
import { openExternalUrl } from './open-external';

export function registerPtyOpenLink(): void {
  registerMainHandler('pty.openLink', ({ url }) => ({ opened: openExternalUrl(url) }));
}
