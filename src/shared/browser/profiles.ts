// `<userData>/browser/profiles.json` (E4b execution document, Design §11 and Interfaces): one record per imported Chrome
// profile, written by E4b's store in main and read by E4a through it (`BrowserDeps.profiles`). E4a's four fields come
// first (its loose `BrowserProfileSchema` reads only those), E4b's after. A record is written once, at the end of a
// `done` import, so it always describes a whole import (Decision Log 2).
import * as z from 'zod';
import { AbsolutePathSchema } from '../ipc/schema/settings';
import { CHROME_PROFILE_DIR, ChromeProfileDirSchema, IMPORT_NAME_MAX, IMPORT_TEXT_MAX, ImportedExtensionSchema, ImportReportSchema } from './import';
import { BrowserPartitionSchema, profilePartition } from './tab';

const PERSIST = 'persist:';
const PROFILE_PARTITION_PREFIX = profilePartition('');

// The partition's own folder under `<userData>/browser/` (it holds `extensions/<id>/`): the partition without
// `persist:`, the profile directory's case kept (Decision Log 15). Only an imported profile's partition has one, and
// its profile directory must be one Chrome could name, so the result is always one safe path segment.
export function partitionDirName(partition: string): string {
  const profileDir = partition.startsWith(PROFILE_PARTITION_PREFIX) ? partition.slice(PROFILE_PARTITION_PREFIX.length) : '';
  if (!CHROME_PROFILE_DIR.test(profileDir)) throw new Error('not an imported profile’s partition');
  return partition.slice(PERSIST.length);
}

// Electron's storage directory for the partition, the basename of `ses.storagePath` recorded at import: Chromium's
// lower-cased, percent-escaped form of the name (`maws-chrome-profile%201`), never derived (Decision Log 24).
const StorageDirNameSchema = z.string().regex(/^maws-chrome-[^/\\]+$/).max(255);

export const ImportedProfileSchema = z
  .strictObject({
    profileDir: ChromeProfileDirSchema,
    name: z.string().max(IMPORT_NAME_MAX),
    partition: BrowserPartitionSchema,
    importedAt: z.iso.datetime(),
    storageDirName: StorageDirNameSchema,
    userDataDir: AbsolutePathSchema.max(IMPORT_TEXT_MAX), // the Chrome folder the profile came from
    extensions: z.array(ImportedExtensionSchema), // the toggles' state, updated after import (P-21)
    report: ImportReportSchema,
  })
  // Removal clears `partition`: a record naming the default or another profile's partition must never parse.
  .refine((record) => record.partition === profilePartition(record.profileDir), { message: 'not the profile’s own partition', path: ['partition'] });
export type ImportedProfile = z.infer<typeof ImportedProfileSchema>;

export const ImportedProfilesFileSchema = z
  .strictObject({ version: z.literal(1), profiles: z.array(ImportedProfileSchema) })
  .refine((file) => new Set(file.profiles.map((record) => record.profileDir)).size === file.profiles.length, {
    message: 'a profile directory is listed twice',
    path: ['profiles'],
  });
export type ImportedProfilesFile = z.infer<typeof ImportedProfilesFileSchema>;
