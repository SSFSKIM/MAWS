// cua #90: the partition pill's avatar and its popover (cua board #90's spec, "The avatar and the profile popover"),
// pure: the disc colour of a profile drawn by its initial, the popover's account line and bookmarks line, and the
// profiles Switch profile offers.
import type { BrowserProfileListItem, ImportedBookmarks } from '@shared/browser/profiles';
import { DEFAULT_PARTITION, profilePartition } from '@shared/browser/tab';
import { relativeAge } from '../../../app/relative-age';
import { BROWSER_COPY } from '../copy';

// The theme's accent palette, as tokens: an initial's disc takes one by its profile directory, so a profile keeps its
// colour across launches and windows.
export const AVATAR_TONES = ['bg-accent', 'bg-info', 'bg-success', 'bg-warning'] as const;

export function avatarTone(profileDir: string): (typeof AVATAR_TONES)[number] {
  let hash = 0x811c9dc5; // FNV-1a, 32 bit
  for (let i = 0; i < profileDir.length; i++) hash = Math.imul(hash ^ profileDir.charCodeAt(i), 0x01000193);
  return AVATAR_TONES[(hash >>> 0) % AVATAR_TONES.length]!;
}

// The Chrome account the profile is signed in to, as `Local State` named it; or that it is signed in to none.
export function accountLine({ gaiaName, userName }: Pick<BrowserProfileListItem, 'gaiaName' | 'userName'>): string {
  const parts = [gaiaName, userName].filter((part): part is string => part !== null && part !== '');
  return parts.length > 0 ? BROWSER_COPY.profile.signedIn(parts) : BROWSER_COPY.profile.notSignedIn;
}

// Under Sync bookmarks now: when the mirror last read Chrome's file, or why the last read failed (the rows kept from
// the last good one); null before any read succeeded or failed.
export function syncLine(bookmarks: ImportedBookmarks, now: number): string | null {
  const age = bookmarks.syncedAt === null ? null : relativeAge(Math.max(0, now - Date.parse(bookmarks.syncedAt)));
  if (bookmarks.error === 'indexUnavailable') return BROWSER_COPY.profile.indexUnavailable;
  if (bookmarks.error !== null) return BROWSER_COPY.profile.unreadable(age);
  return age === null ? null : BROWSER_COPY.profile.lastSynced(age);
}

// Switch profile's rows from a tab of `partition`: every other imported profile in the list's order, then Default
// (`profileDir: null`, the setting's value for it) unless the tab is Default's.
export interface SwitchTarget {
  profileDir: string | null;
  partition: string;
  profile: BrowserProfileListItem | null;
}

export function switchTargets(profiles: readonly BrowserProfileListItem[], partition: string): SwitchTarget[] {
  const others = profiles
    .map((profile) => ({ profileDir: profile.profileDir, partition: profilePartition(profile.profileDir), profile }))
    .filter((target) => target.partition !== partition);
  return partition === DEFAULT_PARTITION ? others : [...others, { profileDir: null, partition: DEFAULT_PARTITION, profile: null }];
}
