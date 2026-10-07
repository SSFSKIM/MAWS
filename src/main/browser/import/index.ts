// The Chrome profile import's side of main (E4b execution document, Design §1; Interfaces "Main"; Decision Log 31 to
// 34), wired from `src/main/index.ts` in three E4b blocks: `ImportedProfiles.open` and `sweepBrowserImports` before
// E4a's `startBrowser` (the sweep runs before any partition session exists, and E4a reads the records through the
// store), then `startBrowserImport` with E4a's handle. It builds the extensions loader, the import service and the
// removal, registers `browser.import.*`, hooks the per-boot extension loading into E4a's partition preparation, holds
// the first page of a partition whose extensions are still loading, and loads the active profile's extensions at boot.
// Under MAWS_E2E=1 it exposes `globalThis.__maws_browser_import`. `stop` (at will-quit) cancels a running import as far
// as can be done synchronously and deletes every staging directory.
import { BrowserWindow, dialog } from 'electron';
import type { ImportedProfile } from '@shared/browser/profiles';
import type { BrowserSettings } from '@shared/ipc/schema/settings';
import { openDialogFor } from '../../files/e2e-pick';
import type { Index } from '../../index/index';
import type { registerMainHandler } from '../../ipc/router';
import type { Partitions } from '../partition';
import type { BrowserEmit, TabStore } from '../tabs';
import { createImportView } from './chips-import';
import { ExtensionsLoader } from './extensions-loader';
import { readSafeStorageKey } from './keychain';
import { errorCode, importLog } from './log';
import type { ImportedProfiles } from './profiles';
import { registerBrowserImportHandlers, type ChooseDirectory } from './register';
import { removeImportedProfile } from './remove';
import { BrowserImportService } from './service';

export { ImportedProfiles } from './profiles';
export { sweepBrowserImports } from './sweep';

// The e2e's view of the import (Acceptance G1): the run under way, and a profile's record as main holds it.
export interface BrowserImportInspector {
  importing(): string | null; // the running import's id
  record(profileDir: string): ImportedProfile | null;
}

declare global {
  var __maws_browser_import: BrowserImportInspector | undefined;
}

export interface BrowserImportDeps {
  userData: string;
  settings(): Pick<BrowserSettings, 'profile'>; // the active profile, whose extensions load at boot
  index: Pick<Index, 'browserHistory'>;
  register: typeof registerMainHandler;
  emit: BrowserEmit;
  env: NodeJS.ProcessEnv;
  // E4a's `Browser` handle (Decision Log 31): its tabs, for removal and the first-page hold, and its partitions.
  browser: { store: Pick<TabStore, 'all' | 'close' | 'onViewCreated'>; partitions: Pick<Partitions, 'session' | 'registerPreparer'> };
  profiles: ImportedProfiles;
  chooseDirectory?: ChooseDirectory;
}

export interface BrowserImport {
  stop(): void;
  onPartitionPrepared(ses: Electron.Session, partition: string): void;
}

export function startBrowserImport({ userData, settings, index, register, emit, env, browser, profiles, chooseDirectory = nativeChooser(env) }: BrowserImportDeps): BrowserImport {
  const announce = () => {
    try {
      emit('browser.import.changed', { profiles: profiles.list() });
    } catch (error) {
      importLog({ kind: 'error', where: 'changed', code: errorCode(error) }, env);
    }
  };
  const extensions = new ExtensionsLoader({ userData, profiles, env, changed: announce });
  const service = new BrowserImportService({
    userData,
    env,
    partitions: browser.partitions,
    history: index.browserHistory,
    profiles,
    emit,
    keychain: (signal) => readSafeStorageKey({ env, signal }),
    createImportView,
    extensions: extensions.importExtensions,
  });
  registerBrowserImportHandlers({
    service,
    profiles,
    extensions,
    remove: (profileDir) =>
      removeImportedProfile(
        { userData, env, importing: () => service.running(), store: browser.store, partitions: browser.partitions, extensions, history: index.browserHistory, profiles },
        profileDir,
      ),
    chooseDirectory,
    emit,
    env,
    register,
  });

  // Per boot (Decision Log 32): a partition prepared loads its record's enabled extensions; a page created in it while
  // those loads are pending has its first load held until its loadExtension calls have settled, at most
  // FIRST_LOAD_HOLD_MS (the boot race; the loader's header says what that does and does not guarantee).
  const onPartitionPrepared = (ses: Electron.Session, partition: string) => extensions.onPartitionPrepared(ses, partition);
  const unregister = browser.partitions.registerPreparer(onPartitionPrepared);
  const stopHold = browser.store.onViewCreated((entry) => extensions.holdNewView(entry));
  // The active profile's partition is prepared now, so its extensions are loaded and their content scripts settled well
  // before the first tab opens; any other imported profile loads when a tab first needs its partition.
  try {
    const active = settings().profile;
    const record = active === null ? null : profiles.get(active);
    if (record) browser.partitions.session(record.partition);
  } catch (error) {
    importLog({ kind: 'error', where: 'boot_partition', code: errorCode(error) }, env);
  }

  const inspector: BrowserImportInspector | null =
    env.MAWS_E2E === '1' ? { importing: () => service.running()?.importId ?? null, record: (profileDir) => profiles.get(profileDir) } : null;
  if (inspector) globalThis.__maws_browser_import = inspector;

  return {
    onPartitionPrepared,
    stop: () => {
      if (inspector && globalThis.__maws_browser_import === inspector) delete globalThis.__maws_browser_import;
      unregister();
      stopHold();
      service.stop();
    },
  };
}

// The native folder dialog over the sender's window; under MAWS_E2E=1 the pick seam answers (MAWS_E2E_PICK_PATHS).
function nativeChooser(env: NodeJS.ProcessEnv): ChooseDirectory {
  return (sender, options) =>
    openDialogFor(env, (dialogOptions) => {
      const win = BrowserWindow.fromWebContents(sender);
      return win ? dialog.showOpenDialog(win, dialogOptions) : dialog.showOpenDialog(dialogOptions);
    })(options);
}
