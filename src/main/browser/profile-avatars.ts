// cua board #90 (its spec's "The avatar and the profile popover"): `browser.profiles.list`'s items. An imported profile
// is listed with the Chrome account's names (the popover's account line) and its avatar: the 64 px `avatar.png` the
// import wrote beside the partition (import/avatar.ts), as a data URL, or the first grapheme of its name. Each import's
// file is read once (an import or a re-import changes the record's `importedAt`, which `browser.import.changed`
// announces and the renderer's list follows); the list never reads outside an imported profile's own folder.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { partitionDirName, PROFILE_AVATAR_MAX_BYTES, PROFILE_AVATAR_URL_PREFIX, type BrowserProfileListItem } from '@shared/browser/profiles';
import { AVATAR_FILE } from './import/avatar';
import type { BrowserProfile } from './partition';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// The profile's initial: the first grapheme of its name, upper-cased (an emoji or a Hangul syllable whole).
export function profileInitial(name: string): string {
  const first = graphemes.segment(name.trim())[Symbol.iterator]().next();
  return first.done ? '' : first.value.segment.toLocaleUpperCase();
}

function readAvatarFile(file: string): Buffer | null {
  try {
    if (statSync(file).size > PROFILE_AVATAR_MAX_BYTES) return null;
    return readFileSync(file);
  } catch {
    return null;
  }
}

export class ProfileAvatars {
  private readonly read = new Map<string, { importedAt: string; dataUrl: string | null }>(); // by profile directory

  constructor(
    private readonly userData: string,
    private readonly readFile: (file: string) => Buffer | null = readAvatarFile,
  ) {}

  list(profiles: readonly BrowserProfile[]): BrowserProfileListItem[] {
    const listed = new Set(profiles.map(({ profileDir }) => profileDir));
    for (const profileDir of this.read.keys()) if (!listed.has(profileDir)) this.read.delete(profileDir);
    return profiles.map((profile) => {
      const dataUrl = profile.avatar?.kind === 'picture' ? this.dataUrl(profile) : null;
      return {
        profileDir: profile.profileDir,
        name: profile.name,
        gaiaName: profile.gaiaName ?? null,
        userName: profile.userName ?? null,
        avatar: dataUrl === null ? { kind: 'initials', letter: profileInitial(profile.name) || profileInitial(profile.profileDir) } : { kind: 'picture', dataUrl },
      };
    });
  }

  private dataUrl(profile: BrowserProfile): string | null {
    const known = this.read.get(profile.profileDir);
    if (known?.importedAt === profile.importedAt) return known.dataUrl;
    let dataUrl: string | null = null;
    try {
      const bytes = this.readFile(join(this.userData, 'browser', partitionDirName(profile.partition), AVATAR_FILE));
      if (bytes !== null && bytes.length <= PROFILE_AVATAR_MAX_BYTES) dataUrl = PROFILE_AVATAR_URL_PREFIX + bytes.toString('base64');
    } catch {
      dataUrl = null; // not an imported profile's partition: no folder of its own
    }
    this.read.set(profile.profileDir, { importedAt: profile.importedAt, dataUrl });
    return dataUrl;
  }
}
