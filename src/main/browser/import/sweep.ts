// The boot sweep (E4b Design §14; Decision Log 18, 24, 26): what a crash, a quit mid-import or a removal left behind,
// removed at boot before E4a's `startBrowser` creates any partition session. Four patterns and nothing else:
//   1. every `<userData>/browser/import/*` (staging is never kept across a boot);
//   2. every `<userData>/browser/maws-chrome-*/` folder that is no listed record's `partitionDirName`;
//   3. every `<userData>/Partitions/maws-chrome-*/` directory that is no listed record's `storageDirName` (the name
//      recorded from `ses.storagePath`, never derived from `profileDir`: Chromium lower-cases and escapes it);
//   4. every `browser_history` row of a `persist:maws-chrome-` partition no record lists.
// Synchronous, so nothing can open a partition while it runs; a removal that fails is logged and skipped, never thrown,
// because a sweep must not stop the app from starting. Names compare case-insensitively (APFS is), so a listed
// profile's directory is never taken for an unlisted one. E11: skipped whole while profiles.json is a newer MAWS's
// (`readOnly`): its records are unknown here, so nothing of theirs may be taken for residue.
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ImportedProfile } from '@shared/browser/profiles';
import { partitionDirName } from '@shared/browser/profiles';
import { profilePartition } from '@shared/browser/tab';
import type { BrowserHistoryStore } from '../../index/browser-history';
import { importLog } from './log';

const PREFIX = 'maws-chrome-';

export interface SweepResult {
  staging: number;
  partitionFolders: number;
  storageDirs: number;
  historyRows: number;
}

export function sweepBrowserImports({
  userData,
  profiles,
  history,
}: {
  userData: string;
  profiles: { list(): readonly ImportedProfile[]; readOnly?: boolean };
  history: Pick<BrowserHistoryStore, 'removeImportedExcept'>;
}): SweepResult {
  if (profiles.readOnly === true) return { staging: 0, partitionFolders: 0, storageDirs: 0, historyRows: 0 }; // E11
  const records = profiles.list();
  const folders = new Set(records.map((record) => partitionDirName(record.partition).toLowerCase()));
  const storage = new Set(records.map((record) => record.storageDirName.toLowerCase()));
  return {
    staging: removeEntries(join(userData, 'browser', 'import'), () => true),
    partitionFolders: removeEntries(join(userData, 'browser'), (name, isDirectory) => isDirectory && unlisted(name, folders)),
    storageDirs: removeEntries(join(userData, 'Partitions'), (name, isDirectory) => isDirectory && unlisted(name, storage)),
    historyRows: removeHistory(history, records),
  };
}

const unlisted = (name: string, listed: ReadonlySet<string>) => name.toLowerCase().startsWith(PREFIX) && !listed.has(name.toLowerCase());

function removeEntries(dir: string, chosen: (name: string, isDirectory: boolean) => boolean): number {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0; // nothing there yet
  }
  let removed = 0;
  for (const entry of entries) {
    if (!chosen(entry.name, entry.isDirectory())) continue;
    try {
      rmSync(join(dir, entry.name), { recursive: true, force: true }); // a symlink is removed, never followed
      removed++;
    } catch (error) {
      importLog({ kind: 'error', where: 'sweep', code: String((error as NodeJS.ErrnoException).code ?? 'unknown') });
    }
  }
  return removed;
}

function removeHistory(history: Pick<BrowserHistoryStore, 'removeImportedExcept'>, records: readonly ImportedProfile[]): number {
  try {
    return history.removeImportedExcept(profilePartition(''), records.map((record) => record.partition));
  } catch (error) {
    importLog({ kind: 'error', where: 'sweep', code: String((error as NodeJS.ErrnoException).code ?? 'history') });
    return 0;
  }
}
