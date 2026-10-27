// The client port in Electron main (P5 OX4; O1 M3): the app's own windows perform every client-only effect a machine-bound
// service asks for. The composition root builds it once and injects it. A dialog or question is parented to the asking
// client's window while its page lives, and is app-level for `null` or a gone client (as `win ? dialog.x(win, o) :
// dialog.x(o)` always was), so this port never answers `noClient`.
//
// The e2e seams that stand for the native UI stay as the specs see them: the pick seam (`./e2e-pick.ts`) answers in
// place of the open panel, and a URL goes through `openExternalUrl`, whose MAWS_E2E_OPEN_LOG line the specs follow. The
// seams in front of a caller's own call (the files' and library's open log, the save folder) stay with the caller.
import { app, BrowserWindow, dialog, Notification, shell, type MessageBoxOptions, type OpenDialogOptions } from 'electron';
import type { ClientRef } from '@shared/ipc/client';
import type { ClientPort, NotifyEvent } from '@shared/client/port';
import { pageOf } from '../ipc/clients';
import { openExternalUrl } from '../open-external';
import { appWindows } from '../windows';
import { openDialogFor } from './e2e-pick';

export function electronClientPort(deps: { env: NodeJS.ProcessEnv; openWindow(): BrowserWindow }): ClientPort {
  // The window showing the client's page while the page lives; null for no client or a gone one.
  const windowOf = (client: ClientRef | null): BrowserWindow | null => {
    const page = client && pageOf(client);
    return page ? BrowserWindow.fromWebContents(page) : null;
  };
  return {
    async pick(client, request) {
      // a directory pick may make a new folder there (New chat: Codex's folder dialog does, main-BvBtZhys.js:121436-121458)
      const base: OpenDialogOptions['properties'] = request.kind === 'directory' ? ['openDirectory', 'createDirectory'] : ['openFile'];
      const options: OpenDialogOptions = { properties: request.multiple ? [...base!, 'multiSelections'] : base };
      if (request.filters) options.filters = request.filters;
      if (request.defaultPath !== undefined) options.defaultPath = request.defaultPath;
      const win = windowOf(client);
      const { canceled, filePaths } = await openDialogFor(deps.env, (o) => (win ? dialog.showOpenDialog(win, o) : dialog.showOpenDialog(o)))(options);
      return canceled ? { cancelled: true } : { paths: filePaths };
    },

    async save(client, { defaultPath }) {
      const win = windowOf(client);
      const { canceled, filePath } = await (win ? dialog.showSaveDialog(win, { defaultPath }) : dialog.showSaveDialog({ defaultPath }));
      return canceled || !filePath ? { cancelled: true } : { path: filePath };
    },

    async confirm(client, request) {
      const win = windowOf(client);
      // the cancel is the default and the Escape answer: a question never confirms by a stray Return
      const options: MessageBoxOptions = { type: request.kind, message: request.message, ...(request.detail !== undefined && { detail: request.detail }), buttons: [request.confirm, request.cancel], defaultId: 1, cancelId: 1, noLink: true };
      const { response } = await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
      return { confirmed: response === 0 };
    },

    async reveal(_client, path) {
      shell.showItemInFolder(path); // reports nothing
      return { revealed: true };
    },

    async openExternal(_client, target) {
      if ('url' in target) {
        // handed off as it always was: the scheme check, then the e2e log or the system browser, whose own failure is logged
        return openExternalUrl(target.url) ? { opened: true } : { opened: false, reason: 'only http, https and mailto links open outside MAWS' };
      }
      const message = await shell.openPath(target.path); // '' on success, else the error text
      return message === '' ? { opened: true } : { opened: false, reason: message };
    },

    notify(_client, request, onEvent) {
      if (!Notification.isSupported()) return { unsupported: 'notifications are not supported' };
      const notification = new Notification({
        title: request.title,
        body: request.body,
        silent: request.silent,
        ...(request.reply && { hasReply: true, replyPlaceholder: request.reply.placeholder }),
        ...(request.actions && { actions: request.actions.map((text) => ({ type: 'button' as const, text })) }),
      });
      const relay = (event: NotifyEvent) => () => onEvent(event);
      notification.on('show', relay({ kind: 'shown' }));
      notification.on('failed', (_event, error) => onEvent({ kind: 'failed', error }));
      notification.on('click', relay({ kind: 'clicked' }));
      notification.on('reply', (_event, text: string) => onEvent({ kind: 'replied', text }));
      notification.on('action', (_event, index: number) => onEvent({ kind: 'action', index }));
      notification.on('close', relay({ kind: 'closed' }));
      notification.show();
      return { close: () => notification.close() };
    },

    badge(_client, count) {
      app.dock?.setBadge(count > 0 ? String(count) : '');
    },

    focus(client, mode) {
      if (mode === 'request') {
        app.dock?.bounce('informational');
        return;
      }
      // the client's window, else the app's first, re-created through the dock's `activate` path when none is open
      const win = windowOf(client) ?? appWindows()[0] ?? deps.openWindow();
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    },
  };
}
