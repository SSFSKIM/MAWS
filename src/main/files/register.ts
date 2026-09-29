// Main's handlers for `files.*` (C8c execution document, M1). Every failure is `internal` with the service's message
// (the refusal `path outside the session's directories`, `unknown app session: <id>`, `not found: <path>`, …). Watches
// are held per requesting window, as `registerGitHandlers` holds git's: a window that closes or navigates (a reload
// included) releases whatever it still holds, since its page can no longer unwatch and a reloaded page watches afresh.
import type { WebContents } from 'electron';
import type { AppSessionId } from '@shared/graph/ids';
import type { FilesChanged } from '@shared/ipc/schema/files';
import { registerMainHandler } from '../ipc/router';
import type { AllowlistRecord } from './allowlist';
import { createFilesService, type FilesService } from './service';

export interface FilesHandlerDeps {
  emit(payload: FilesChanged): void;
  openPath(path: string): Promise<string>; // Electron's shell.openPath
  env?: NodeJS.ProcessEnv;
}

export function registerFilesHandlers(model: { record(appSessionId: AppSessionId): AllowlistRecord | null }, deps: FilesHandlerDeps): FilesService {
  const files = createFilesService({ records: (appSessionId) => model.record(appSessionId), ...deps });
  const followed = new WeakSet<WebContents>();
  const owner = (sender: WebContents) => {
    if (!followed.has(sender)) {
      followed.add(sender);
      const release = () => files.release(sender.id);
      sender.once('destroyed', release);
      sender.on('did-navigate', release);
    }
    return sender.id;
  };
  const session = (id: string) => id as AppSessionId;
  registerMainHandler('files.list', ({ appSessionId, path }) => files.list({ appSessionId: session(appSessionId), path }));
  registerMainHandler('files.read', (input) => files.read({ ...input, appSessionId: session(input.appSessionId) }));
  registerMainHandler('files.watch', ({ appSessionId, path }, { sender }) => files.watch(session(appSessionId), path, owner(sender)));
  registerMainHandler('files.unwatch', ({ appSessionId, path }, { sender }) => files.unwatch(session(appSessionId), path, sender.id));
  registerMainHandler('files.openExternal', ({ appSessionId, path }) => files.openExternal(session(appSessionId), path));
  return files;
}
