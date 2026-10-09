// cua board #90: `browser.profiles.list`'s items, the account's names and the avatar (the 64 px PNG beside the partition
// as a data URL, read once per import, or the profile's initial).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserProfileListItemSchema, PROFILE_AVATAR_MAX_BYTES } from '@shared/browser/profiles';
import type { BrowserProfile } from './partition';
import { profileInitial, ProfileAvatars } from './profile-avatars';

let userData: string;
beforeEach(() => void (userData = mkdtempSync(join(tmpdir(), 'maws-cua90-avatars-'))));
afterEach(() => rmSync(userData, { recursive: true, force: true }));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const profile = (over: Partial<BrowserProfile> & Record<string, unknown> = {}): BrowserProfile => ({
  profileDir: 'Default',
  name: 'Person 1',
  partition: 'persist:maws-chrome-Default',
  importedAt: '2026-10-09T00:00:00.000Z',
  gaiaName: 'Probe Owner',
  userName: 'probe@example.test',
  avatar: { kind: 'picture' },
  ...over,
});
const writeAvatar = (folder = 'maws-chrome-Default', bytes = PNG) => {
  mkdirSync(join(userData, 'browser', folder), { recursive: true });
  writeFileSync(join(userData, 'browser', folder, 'avatar.png'), bytes);
};

describe('profileInitial', () => {
  it('is the first grapheme of the name, upper-cased', () => {
    expect(['Work', 'person 1', '  émile', '민혁', '👩‍💻 Dev', 'ǆungla'].map(profileInitial)).toEqual(['W', 'P', 'É', '민', '👩‍💻', 'ǅ'.toLocaleUpperCase()]);
  });
});

describe('ProfileAvatars.list', () => {
  it('answers a picture profile with its avatar.png as a data URL, and the account names', () => {
    writeAvatar();
    const [item] = new ProfileAvatars(userData).list([profile()]);
    expect(item).toEqual({
      profileDir: 'Default',
      name: 'Person 1',
      gaiaName: 'Probe Owner',
      userName: 'probe@example.test',
      avatar: { kind: 'picture', dataUrl: `data:image/png;base64,${PNG.toString('base64')}` },
    });
    expect(BrowserProfileListItemSchema.parse(item)).toEqual(item);
  });

  it('answers the initial for an initials profile, a version-1 record without the fields, and a picture whose file is gone or too large', () => {
    const avatars = new ProfileAvatars(userData);
    expect(avatars.list([profile({ profileDir: 'Profile 1', name: 'Work', partition: 'persist:maws-chrome-Profile 1', avatar: { kind: 'initials' }, gaiaName: null, userName: null })])).toEqual([
      { profileDir: 'Profile 1', name: 'Work', gaiaName: null, userName: null, avatar: { kind: 'initials', letter: 'W' } },
    ]);
    const v1: BrowserProfile = { profileDir: 'Default', name: 'Person 1', partition: 'persist:maws-chrome-Default', importedAt: '2026-10-09T00:00:00.000Z' };
    expect(avatars.list([v1])[0]).toMatchObject({ gaiaName: null, userName: null, avatar: { kind: 'initials', letter: 'P' } });
    expect(avatars.list([profile()])[0]!.avatar).toEqual({ kind: 'initials', letter: 'P' }); // no file
    writeAvatar('maws-chrome-Default', Buffer.alloc(PROFILE_AVATAR_MAX_BYTES + 1));
    expect(new ProfileAvatars(userData).list([profile()])[0]!.avatar).toEqual({ kind: 'initials', letter: 'P' });
  });

  it('reads each import’s file once, and again for a new import of the profile (its importedAt)', () => {
    writeAvatar();
    const read = vi.fn((file: string) => (file.endsWith('avatar.png') ? PNG : null));
    const avatars = new ProfileAvatars(userData, read);
    avatars.list([profile()]);
    avatars.list([profile()]);
    expect(read).toHaveBeenCalledTimes(1);
    avatars.list([profile({ importedAt: '2026-10-10T00:00:00.000Z' })]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('never reads outside an imported profile’s own folder', () => {
    const read = vi.fn(() => PNG);
    expect(new ProfileAvatars(userData, read).list([profile({ partition: 'persist:maws-browser' })])[0]!.avatar).toEqual({ kind: 'initials', letter: 'P' });
    expect(read).not.toHaveBeenCalled();
  });
});
