// The profile picker's source (E4b Design §2): `<userDataDir>/Local State`'s `profile.info_cache` and `profile.last_used`,
// parsed in place (Chrome rewrites the file atomically) under a size cap, one of the enumerated read-only JSON reads.
// Of each profile only `name`, `gaia_name` and `user_name` are read (cua board #90: and `gaia_picture_file_name`, for the
// import's avatar alone, never in the picker's answer). A profile directory is admitted only when it is a
// key of `info_cache`, matches Chrome's pattern, and its real directory stays under the user data directory.
// `SingletonLock` (the symlink Chrome holds while it runs) is a hint, never a block (Decision Log 14).
import { constants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import { CHROME_PROFILE_DIR, IMPORT_NAME_MAX, type ChromeProfile } from '@shared/browser/import';

export const LOCAL_STATE_MAX_BYTES = 16 * 1024 * 1024;

// `error`: Local State exists but could not be used, as a code (never its content: a JSON SyntaxError quotes the input).
export type LocalStateError = 'unreadable' | 'tooLarge' | 'invalid';
export interface ChromeProfilesAnswer {
  userDataDir: string;
  found: boolean;
  chromeRunning: boolean;
  profiles: ChromeProfile[];
  error: LocalStateError | null;
}

// Chrome's folder on macOS; under e2e only the seam's folder, so no test ever lists the owner's Chrome.
export function defaultChromeUserDataDir(env: NodeJS.ProcessEnv, home: string = homedir()): string | null {
  if (env.MAWS_E2E === '1') return env.MAWS_E2E_CHROME_USER_DATA || null;
  return join(home, 'Library', 'Application Support', 'Google', 'Chrome');
}

export async function readChromeProfiles(userDataDir: string, isImported: (profileDir: string) => boolean = () => false): Promise<ChromeProfilesAnswer> {
  const answer = (found: boolean, profiles: ChromeProfile[] = [], error: LocalStateError | null = null, chromeRunning = false): ChromeProfilesAnswer => ({
    userDataDir,
    found,
    chromeRunning,
    profiles,
    error,
  });
  const root = isAbsolute(userDataDir) ? await realDirectory(userDataDir) : null;
  if (root === null) return answer(false);
  const chromeRunning = await lstat(join(userDataDir, 'SingletonLock')).then(() => true, () => false);
  const read = await readCapped(join(userDataDir, 'Local State'));
  if (read === 'missing') return answer(false, [], null, chromeRunning);
  if (typeof read === 'string') return answer(true, [], read, chromeRunning);
  const parsed = parseLocalState(read.text);
  if (parsed === null) return answer(true, [], 'invalid', chromeRunning);
  const profiles: ChromeProfile[] = [];
  for (const { profileDir, name, gaiaName, userName } of parsed.profiles) {
    if (!(await admitted(root, userDataDir, profileDir))) continue;
    profiles.push({ profileDir, name, gaiaName, userName, lastUsed: profileDir === parsed.lastUsed, imported: isImported(profileDir) });
  }
  return answer(true, profiles, null, chromeRunning);
}

// The inspection's re-validation of a `profileDir` the renderer sent: the same admission, read again from disk.
export async function resolveChromeProfile(
  userDataDir: string,
  profileDir: string,
  isImported?: (profileDir: string) => boolean,
): Promise<{ profile: ChromeProfile; path: string } | null> {
  if (!CHROME_PROFILE_DIR.test(profileDir)) return null;
  const { profiles } = await readChromeProfiles(userDataDir, isImported);
  const profile = profiles.find((candidate) => candidate.profileDir === profileDir);
  return profile ? { profile, path: join(userDataDir, profileDir) } : null;
}

// cua #90: the profile's Google profile picture as `Local State` names it, a plain file name in its profile directory, or
// null when it has none (Work in the fixture; any profile not signed in) or Local State cannot be read. The caller
// re-applies the admission and reads the file `O_NOFOLLOW` (avatar.ts).
export async function readChromePictureName(userDataDir: string, profileDir: string): Promise<string | null> {
  if (!CHROME_PROFILE_DIR.test(profileDir) || !isAbsolute(userDataDir)) return null;
  const read = await readCapped(join(userDataDir, 'Local State'));
  if (typeof read === 'string') return null;
  return parseLocalState(read.text)?.profiles.find((entry) => entry.profileDir === profileDir)?.picture ?? null;
}

type LocalStateProfile = Omit<ChromeProfile, 'lastUsed' | 'imported'> & { picture: string | null };

function parseLocalState(text: string): { profiles: LocalStateProfile[]; lastUsed: string | null } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const profile = objectOr(objectOr(data)?.profile);
  const cache = objectOr(profile?.info_cache);
  if (!profile || !cache) return null;
  const profiles: LocalStateProfile[] = [];
  for (const [profileDir, value] of Object.entries(cache)) {
    const info = objectOr(value);
    if (!info || !CHROME_PROFILE_DIR.test(profileDir)) continue;
    profiles.push({ profileDir, name: name(info.name) ?? profileDir, gaiaName: name(info.gaia_name), userName: name(info.user_name), picture: fileName(info.gaia_picture_file_name) });
  }
  return { profiles, lastUsed: typeof profile.last_used === 'string' ? profile.last_used : null };
}

const objectOr = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const name = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value.slice(0, IMPORT_NAME_MAX) : null);
// cua #90: one path segment, whole (a name cut short would name another file), or nothing
const fileName = (value: unknown): string | null =>
  typeof value === 'string' && value.length <= 255 && value !== '.' && value !== '..' && !/[/\\\0]/.test(value) && value !== '' ? value : null;

// cua #90: exported, with `admitted`, for the bookmarks read (chrome/bookmarks.ts), which re-applies the admission at
// every read since a profile directory replaced by a symlink after the import must not be followed.
export async function realDirectory(path: string): Promise<string | null> {
  try {
    const real = await realpath(path);
    return (await stat(real)).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

export async function admitted(root: string, userDataDir: string, profileDir: string): Promise<boolean> {
  const real = await realDirectory(join(userDataDir, profileDir));
  return real !== null && real.startsWith(root + sep);
}

async function readCapped(file: string): Promise<{ text: string } | 'missing' | 'unreadable' | 'tooLarge'> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK); // a FIFO never blocks; isFile refuses it
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable';
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return 'unreadable';
    if (info.size > LOCAL_STATE_MAX_BYTES) return 'tooLarge';
    return { text: await handle.readFile('utf8') };
  } catch {
    return 'unreadable';
  } finally {
    await handle.close();
  }
}
