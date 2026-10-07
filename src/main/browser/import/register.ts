// Main's handlers for `browser.import.*` (E4b Interfaces "IPC"; Design §2, §15). Only the app window's top frame
// reaches them (the router's `isAppSender`), and every input has passed its strict schema; the Chrome folder and the
// profile directory are checked again here, before anything reads the disk. Whatever a handler's work throws leaves as a
// `CommandFailure`: a refusal (`ImportRefused`) as `invalid_input` with its fixed sentence, anything else as `internal`
// with its message redacted (the router would log any other throw whole, and a JSON SyntaxError quotes its input).
import { isAbsolute, normalize } from 'node:path';
import type { OpenDialogOptions, WebContents } from 'electron';
import { CHROME_PROFILE_DIR, EXTENSION_ID } from '@shared/browser/import';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName } from '@shared/ipc/schema';
import { CommandFailure, type MainHandler, type registerMainHandler } from '../../ipc/router';
import type { BrowserEmit } from '../tabs';
import { defaultChromeUserDataDir, readChromeProfiles } from './chrome/local-state';
import type { ExtensionsLoader } from './extensions-loader';
import { errorCode, importLog, redactMessage } from './log';
import type { ImportedProfiles } from './profiles';
import type { Removed } from './remove';
import { ImportRefused, type BrowserImportService } from './service';

export type ChooseDirectory = (sender: WebContents, options: OpenDialogOptions) => Promise<{ canceled: boolean; filePaths: string[] }>;

export interface ImportHandlerDeps {
  service: Pick<BrowserImportService, 'inspect' | 'discard' | 'start' | 'cancel' | 'running'>;
  profiles: Pick<ImportedProfiles, 'list' | 'get' | 'fileBroken'>;
  extensions: Pick<ExtensionsLoader, 'setExtension'>;
  remove(profileDir: string): Promise<Removed>;
  chooseDirectory: ChooseDirectory; // the native folder dialog, through openDialogFor's e2e seam
  emit: BrowserEmit;
  env: NodeJS.ProcessEnv;
  register: typeof registerMainHandler;
  home?: string;
}

export function registerBrowserImportHandlers({ service, profiles, extensions, remove, chooseDirectory, emit, env, register, home }: ImportHandlerDeps): void {
  const handle = <N extends CommandName>(name: N, handler: MainHandler<N>) => register(name, guarded(handler, env));
  const isImported = (profileDir: string) => profiles.get(profileDir) !== null;
  const announce = () => {
    try {
      emit('browser.import.changed', { profiles: profiles.list() });
    } catch (error) {
      importLog({ kind: 'error', where: 'changed', code: errorCode(error) }, env);
    }
  };

  // Chrome's folder (under e2e only MAWS_E2E_CHROME_USER_DATA's; without it, nothing is found and nothing is read).
  handle('browser.import.profiles', async ({ userDataDir }) => {
    const dir = userDataDir === null ? defaultChromeUserDataDir(env, home) : chromeFolder(userDataDir);
    if (dir === null) return { userDataDir: defaultChromeUserDataDir({}, home)!, found: false, chromeRunning: false, profiles: [], error: null };
    return readChromeProfiles(dir, isImported);
  });
  handle('browser.import.chooseUserData', async (_input, { sender }) => {
    const { canceled, filePaths } = await chooseDirectory(sender, {
      properties: ['openDirectory'],
      defaultPath: defaultChromeUserDataDir(env, home) ?? undefined,
      message: 'Choose the Chrome folder that holds “Local State”',
    });
    const chosen = canceled ? undefined : filePaths[0];
    return { userDataDir: chosen === undefined ? null : chromeFolder(chosen) };
  });
  handle('browser.import.inspect', ({ userDataDir, profileDir }) => service.inspect({ userDataDir: chromeFolder(userDataDir), profileDir: chromeProfile(profileDir) }));
  handle('browser.import.discard', ({ inspectionId }) => service.discard(inspectionId));
  handle('browser.import.start', (input) => {
    const { importId } = service.start(input); // its `finished` never rejects; the run's end is browser.import.finished
    return { importId };
  });
  handle('browser.import.cancel', ({ importId }) => service.cancel(importId));
  handle('browser.import.list', () => ({ profiles: profiles.list(), fileBroken: profiles.fileBroken, running: service.running() }));
  handle('browser.import.remove', async ({ profileDir }) => {
    const removed = await remove(chromeProfile(profileDir));
    announce();
    return { removed };
  });
  handle('browser.import.setExtension', async ({ profileDir, extensionId, enabled }) => {
    if (!EXTENSION_ID.test(extensionId)) throw new ImportRefused('notInRecord');
    const extension = await extensions.setExtension(chromeProfile(profileDir), extensionId, enabled);
    announce();
    return { extension };
  });
}

// A Chrome folder as a native dialog would give it: absolute and already normal (no `..`, no doubled separator).
function chromeFolder(path: string): string {
  if (!isAbsolute(path) || path.includes('\0') || normalize(path) !== path) throw new ImportRefused('badFolder');
  return path;
}

function chromeProfile(profileDir: string): string {
  if (!CHROME_PROFILE_DIR.test(profileDir)) throw new ImportRefused('unknownProfile');
  return profileDir;
}

function guarded<N extends CommandName>(handler: MainHandler<N>, env: NodeJS.ProcessEnv): MainHandler<N> {
  return async (input, context) => {
    try {
      return await handler(input, context);
    } catch (error) {
      if (error instanceof CommandFailure) throw error;
      if (error instanceof ImportRefused) throw new CommandFailure(ipcError('invalid_input', error.message));
      const message = redactMessage(error instanceof Error ? error.message : String(error));
      importLog({ kind: 'error', where: 'handler', code: errorCode(error), message }, env);
      throw new CommandFailure(ipcError('internal', message || 'the import failed'));
    }
  };
}

