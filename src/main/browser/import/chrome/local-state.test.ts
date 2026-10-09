// The profile picker's source (E4b Design §2): `Local State`'s `profile.info_cache`, `profile.last_used`, the
// SingletonLock hint and the profile directory's admission rules, over the synthetic user data directory.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildChromeUserData, type ChromeUserData } from '../../../../../test/support/chrome-profile';
import { defaultChromeUserDataDir, LOCAL_STATE_MAX_BYTES, readChromePictureName, readChromeProfiles, resolveChromeProfile } from './local-state';

let root: string;
let fixture: ChromeUserData;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-e4b-local-state-')));
  fixture = buildChromeUserData(join(root, 'Chrome'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

let counter = 0;
const userData = (localState: unknown | string, dirs: string[] = []) => {
  const dir = join(root, `ud-${++counter}`);
  mkdirSync(dir);
  writeFileSync(join(dir, 'Local State'), typeof localState === 'string' ? localState : JSON.stringify(localState));
  for (const name of dirs) mkdirSync(join(dir, name), { recursive: true });
  return dir;
};

describe('readChromeProfiles', () => {
  it('lists the fixture’s two profiles by their Chrome names, the last used one marked', async () => {
    expect(await readChromeProfiles(fixture.dir)).toEqual({
      userDataDir: fixture.dir,
      found: true,
      chromeRunning: false,
      error: null,
      profiles: [
        { profileDir: 'Default', name: 'Person 1', gaiaName: 'Probe Owner', userName: 'probe@example.test', lastUsed: true, imported: false },
        { profileDir: 'Profile 1', name: 'Work', gaiaName: null, userName: null, lastUsed: false, imported: false },
      ],
    });
  });

  it('marks a profile that already has a record as imported', async () => {
    const answer = await readChromeProfiles(fixture.dir, (profileDir) => profileDir === 'Profile 1');
    expect(answer.profiles.map((profile) => [profile.profileDir, profile.imported])).toEqual([['Default', false], ['Profile 1', true]]);
  });

  it('reads the SingletonLock symlink Chrome holds while it runs as the running hint', async () => {
    const dir = userData({ profile: { info_cache: { Default: { name: 'P' } } } }, ['Default']);
    symlinkSync('host-12345', join(dir, 'SingletonLock')); // dangling, as Chrome's is from another process's view
    expect((await readChromeProfiles(dir)).chromeRunning).toBe(true);
  });

  it('answers found: false for a folder without Local State, a missing folder and a relative path', async () => {
    const empty = join(root, 'empty');
    mkdirSync(empty);
    for (const dir of [empty, join(root, 'nowhere'), 'Library/Chrome'])
      expect(await readChromeProfiles(dir), dir).toMatchObject({ userDataDir: dir, found: false, profiles: [], error: null });
  });

  it('answers an unreadable Local State with an error code and no content', async () => {
    const notJson = await readChromeProfiles(userData('{"profile": {"info_cache": e4b-sentinel-local-state'));
    expect(notJson).toMatchObject({ found: true, profiles: [], error: 'invalid' });
    expect(JSON.stringify(notJson)).not.toContain('sentinel');
    expect(await readChromeProfiles(userData({ profile: 7 }))).toMatchObject({ found: true, profiles: [], error: 'invalid' });
    const fifo = join(root, `ud-fifo-${++counter}`);
    mkdirSync(fifo);
    execFileSync('mkfifo', [join(fifo, 'Local State')]);
    expect(await readChromeProfiles(fifo)).toMatchObject({ found: true, profiles: [], error: 'unreadable' }); // never blocks
    const big = userData('');
    writeFileSync(join(big, 'Local State'), Buffer.alloc(LOCAL_STATE_MAX_BYTES + 1, 0x20));
    expect(await readChromeProfiles(big)).toMatchObject({ found: true, profiles: [], error: 'tooLarge' });
  });

  it('admits a profile directory only when it is a well-formed key whose real directory stays under the folder', async () => {
    const outside = join(root, 'outside-profile');
    mkdirSync(outside, { recursive: true });
    const dir = userData(
      {
        profile: {
          info_cache: { Default: { name: 'Kept' }, '../escape': { name: 'Up' }, 'a/b': { name: 'Nested' }, '.hidden': { name: 'Dot' }, 'Profile 2': { name: 'No folder' }, Linked: { name: 'Symlink' }, 'Profile 3': 'not an object' },
          last_used: 'Profile 2',
        },
      },
      ['Default', 'a/b', '.hidden'],
    );
    symlinkSync(outside, join(dir, 'Linked'));
    const answer = await readChromeProfiles(dir);
    expect(answer.profiles.map((profile) => profile.profileDir)).toEqual(['Default']);
    expect(answer.profiles[0]!.lastUsed).toBe(false);
  });

  it('bounds the names it shows and reads nothing but name, gaia_name and user_name', async () => {
    const dir = userData({ profile: { info_cache: { Default: { name: 'n'.repeat(500), gaia_name: '', user_name: 42, avatar_icon: 'x' } } } }, ['Default']);
    const [profile] = (await readChromeProfiles(dir)).profiles;
    expect(profile).toEqual({ profileDir: 'Default', name: 'n'.repeat(200), gaiaName: null, userName: null, lastUsed: false, imported: false });
  });
});

describe('resolveChromeProfile (the inspection’s re-validation)', () => {
  it('answers the profile and its real directory for an admitted key', async () => {
    expect(await resolveChromeProfile(fixture.dir, 'Profile 1')).toEqual({
      path: join(fixture.dir, 'Profile 1'),
      profile: { profileDir: 'Profile 1', name: 'Work', gaiaName: null, userName: null, lastUsed: false, imported: false },
    });
  });

  it('refuses a key Local State does not name, a malformed one and a missing folder', async () => {
    for (const profileDir of ['Profile 9', '../Default', 'Default/..', ''])
      expect(await resolveChromeProfile(fixture.dir, profileDir), profileDir).toBeNull();
    expect(await resolveChromeProfile(join(root, 'nowhere'), 'Default')).toBeNull();
  });
});

// cua #90: the Google profile picture's file name, for the import's avatar; never part of the picker's answer
describe('readChromePictureName', () => {
  it('answers the fixture’s picture for Default and none for Work, which has no gaia_picture_file_name', async () => {
    expect(await readChromePictureName(fixture.dir, 'Default')).toBe('Google Profile Picture.png');
    expect(await readChromePictureName(fixture.dir, 'Profile 1')).toBeNull();
  });

  it('answers null for an absent, empty, non-string or path-like name, never a path out of the profile directory', async () => {
    const names: unknown[] = [undefined, '', 42, null, { file: 'x.png' }, '../Local State', 'a/b.png', 'a\\b.png', '.', '..', 'x\0.png', 'p'.repeat(256)];
    const info_cache = Object.fromEntries(names.map((name, k) => [`Profile ${k + 1}`, { name: `P${k}`, gaia_picture_file_name: name }]));
    const dir = userData({ profile: { info_cache } }, names.map((_, k) => `Profile ${k + 1}`));
    for (let k = 0; k < names.length; k++) expect(await readChromePictureName(dir, `Profile ${k + 1}`), String(names[k])).toBeNull();
  });

  it('answers null for a profile Local State does not name, a malformed key, and an unreadable or missing Local State', async () => {
    expect(await readChromePictureName(fixture.dir, 'Profile 9')).toBeNull();
    expect(await readChromePictureName(fixture.dir, '../Default')).toBeNull();
    expect(await readChromePictureName(userData('not json'), 'Default')).toBeNull();
    expect(await readChromePictureName(join(root, 'nowhere'), 'Default')).toBeNull();
  });

  it('keeps the picker’s answer as it was: the picture’s name is not a field of a listed profile', async () => {
    const { profiles } = await readChromeProfiles(fixture.dir);
    expect(Object.keys(profiles[0]!)).toEqual(['profileDir', 'name', 'gaiaName', 'userName', 'lastUsed', 'imported']);
  });
});

describe('defaultChromeUserDataDir', () => {
  it('is Chrome’s folder in the home directory, and under e2e only the seam’s folder, never the owner’s', () => {
    expect(defaultChromeUserDataDir({}, '/Users/someone')).toBe('/Users/someone/Library/Application Support/Google/Chrome');
    expect(defaultChromeUserDataDir({ MAWS_E2E: '1', MAWS_E2E_CHROME_USER_DATA: '/tmp/fixture' }, '/Users/someone')).toBe('/tmp/fixture');
    expect(defaultChromeUserDataDir({ MAWS_E2E: '1' }, '/Users/someone')).toBeNull();
  });
});
