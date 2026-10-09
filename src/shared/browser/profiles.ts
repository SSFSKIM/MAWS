// `<userData>/browser/profiles.json` (E4b execution document, Design §11 and Interfaces): one record per imported Chrome
// profile, written by E4b's store in main and read by E4a through it (`BrowserDeps.profiles`). E4a's four fields come
// first (its loose `BrowserProfileSchema` reads only those), E4b's after. A record is written once, at the end of a
// `done` import, so it always describes a whole import (Decision Log 2).
import * as z from 'zod';
import { AbsolutePathSchema } from '../ipc/schema/settings';
import { BookmarkSyncErrorSchema } from './bookmarks';
import { CHROME_PROFILE_DIR, ChromeProfileDirSchema, IMPORT_TEXT_MAX, ImportedExtensionSchema, ImportNameSchema, ImportReportSchema, ImportReportV1Schema, isOwnPartition } from './import';
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

// The fields every version's record has; the report is the version's own.
const RECORD_FIELDS = {
  profileDir: ChromeProfileDirSchema,
  name: ImportNameSchema,
  partition: BrowserPartitionSchema,
  importedAt: z.iso.datetime(),
  storageDirName: StorageDirNameSchema,
  userDataDir: AbsolutePathSchema.max(IMPORT_TEXT_MAX), // the Chrome folder the profile came from
  extensions: z.array(ImportedExtensionSchema), // the toggles' state, updated after the import; P-21
};
// Removal clears `partition`: a record naming the default or another profile's partition must never parse, nor one whose
// report is another profile's.
const ownRecord = <T extends z.ZodType<{ profileDir: string; partition: string; report: { profileDir: string; partition: string } }>>(schema: T) =>
  schema
    .refine(isOwnPartition, { message: 'not the profile’s own partition', path: ['partition'] })
    .refine((record) => record.report.profileDir === record.profileDir && record.report.partition === record.partition, {
      message: 'the report is another profile’s',
      path: ['report'],
    });
const uniqueProfiles = { message: 'a profile directory is listed twice', path: ['profiles'] };
const unique = (file: { profiles: { profileDir: string }[] }) => new Set(file.profiles.map((record) => record.profileDir)).size === file.profiles.length;

// cua #90 start: profiles.json version 2 (ledger §4, taken 2026-10-08 by cua board #90). Each record gains the bookmarks
// mirror's state (null when the owner did not import bookmarks), the Chrome account's names as `Local State` gave them,
// and how its avatar is drawn. Version 1, kept whole below, is read and upgraded in memory; the next write is version 2,
// which an older build opens read-only (E11).
export const ImportedBookmarksSchema = z.strictObject({
  consentedAt: z.iso.datetime(), // the import the owner chose Bookmarks in
  syncedAt: z.iso.datetime().nullable(), // the last read that replaced the rows; null before the first succeeded
  count: z.number().int().min(0), // URL bookmarks the last successful read wrote
  error: BookmarkSyncErrorSchema.nullable(), // the last read's failure, the rows kept as they were; null once one succeeds
  errorAt: z.iso.datetime().nullable(),
});
export type ImportedBookmarks = z.infer<typeof ImportedBookmarksSchema>;
export const ProfileAvatarSchema = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('picture') }), z.strictObject({ kind: z.literal('initials') })]);
export type ProfileAvatar = z.infer<typeof ProfileAvatarSchema>;

export const ImportedProfileSchema = ownRecord(
  z.strictObject({
    ...RECORD_FIELDS,
    report: ImportReportSchema,
    bookmarks: ImportedBookmarksSchema.nullable(),
    gaiaName: ImportNameSchema.nullable(),
    userName: ImportNameSchema.nullable(),
    avatar: ProfileAvatarSchema,
  }),
);
export type ImportedProfile = z.infer<typeof ImportedProfileSchema>;

export const PROFILES_FILE_VERSION = 2;
export const ImportedProfilesFileSchema = z.strictObject({ version: z.literal(2), profiles: z.array(ImportedProfileSchema) }).refine(unique, uniqueProfiles);
export type ImportedProfilesFile = z.infer<typeof ImportedProfilesFileSchema>;

// Version 1 (E4b), as it shipped.
export const ImportedProfileV1Schema = ownRecord(z.strictObject({ ...RECORD_FIELDS, report: ImportReportV1Schema }));
export type ImportedProfileV1 = z.infer<typeof ImportedProfileV1Schema>;
export const ImportedProfilesFileV1Schema = z.strictObject({ version: z.literal(1), profiles: z.array(ImportedProfileV1Schema) }).refine(unique, uniqueProfiles);

// An imported profile as the chrome's pill, its popover and Switch profile draw it (`browser.profiles.list`; the spec's
// "Profiles list item"): the Chrome account's names, shown in the popover and the picker only, and the avatar, the 64 px
// PNG as a data URL or the profile's initial. The Default partition is never listed; the renderer draws its own glyph.
export const PROFILE_AVATAR_MAX_BYTES = 256 * 1024;
export const PROFILE_AVATAR_URL_PREFIX = 'data:image/png;base64,';
export const BrowserProfileListItemSchema = z.strictObject({
  profileDir: z.string(),
  name: z.string(),
  gaiaName: z.string().nullable(),
  userName: z.string().nullable(),
  avatar: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('picture'), dataUrl: z.string().startsWith(PROFILE_AVATAR_URL_PREFIX).max(PROFILE_AVATAR_URL_PREFIX.length + Math.ceil(PROFILE_AVATAR_MAX_BYTES / 3) * 4) }),
    z.strictObject({ kind: z.literal('initials'), letter: z.string().max(16) }), // one grapheme, upper-cased
  ]),
});
export type BrowserProfileListItem = z.infer<typeof BrowserProfileListItemSchema>;

// A version-1 record as version 2 reads it: no bookmarks imported, no account names kept, the initial for its avatar.
export function upgradeProfileV1(record: ImportedProfileV1): ImportedProfile {
  return { ...record, report: { ...record.report, bookmarks: null }, bookmarks: null, gaiaName: null, userName: null, avatar: { kind: 'initials' } };
}
// cua #90 end
