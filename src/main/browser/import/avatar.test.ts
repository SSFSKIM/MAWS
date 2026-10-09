// cua board #90 (its spec's "The avatar and the profile popover"): the Google profile picture read in place under the
// profile's admission, capped and never through a symlink, and made the 64 px PNG the record's avatar rides on.
import { mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildChromeUserData, type ChromeUserData } from '../../../../test/support/chrome-profile';
import { AVATAR_SIZE, avatarPng, PICTURE_MAX_BYTES, readChromePicture, type AvatarImage } from './avatar';

let root: string;
let chrome: ChromeUserData;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-cua90-avatar-')));
  chrome = buildChromeUserData(join(root, 'Chrome'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const picture = () => chrome.profiles.Default.picture!;

describe('readChromePicture', () => {
  it('reads the picture Local State names for Default, as bytes', async () => {
    const read = await readChromePicture(chrome.dir, 'Default');
    expect(read.ok).toBe(true);
    expect(read.ok && read.bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  it('answers none for a profile with no picture, and for one Local State does not name', async () => {
    expect(await readChromePicture(chrome.dir, 'Profile 1')).toEqual({ ok: false, error: 'none' });
    expect(await readChromePicture(chrome.dir, 'Profile 9')).toEqual({ ok: false, error: 'none' });
  });

  it('answers missing when the named file is gone', async () => {
    rmSync(picture());
    expect(await readChromePicture(chrome.dir, 'Default')).toEqual({ ok: false, error: 'missing' });
  });

  it('refuses a picture over the cap, and one that is a symlink (O_NOFOLLOW), without reading it', async () => {
    writeFileSync(picture(), Buffer.alloc(PICTURE_MAX_BYTES + 1));
    expect(await readChromePicture(chrome.dir, 'Default')).toEqual({ ok: false, error: 'tooLarge' });
    const elsewhere = join(root, 'elsewhere.png');
    writeFileSync(elsewhere, 'x');
    rmSync(picture());
    symlinkSync(elsewhere, picture());
    expect(await readChromePicture(chrome.dir, 'Default')).toEqual({ ok: false, error: 'unreadable' });
  });

  it('refuses a profile directory whose real path left the Chrome folder (admitted())', async () => {
    const moved = join(root, 'moved-profile');
    renameSync(join(chrome.dir, 'Default'), moved);
    symlinkSync(moved, join(chrome.dir, 'Default'));
    expect(await readChromePicture(chrome.dir, 'Default')).toEqual({ ok: false, error: 'unreadable' });
  });

  it('answers missing for a Chrome folder or profile directory that is gone', async () => {
    rmSync(join(chrome.dir, 'Default'), { recursive: true });
    expect(await readChromePicture(chrome.dir, 'Default')).toEqual({ ok: false, error: 'missing' });
    expect(await readChromePicture(join(root, 'nowhere'), 'Default')).toEqual({ ok: false, error: 'none' });
  });
});

// A stand-in for Electron's NativeImage that records what was asked of it.
function fakeImage(width: number, height: number, log: string[] = []): AvatarImage {
  return {
    isEmpty: () => width === 0 || height === 0,
    getSize: () => ({ width, height }),
    crop: (rect) => {
      log.push(`crop ${rect.x},${rect.y} ${rect.width}x${rect.height}`);
      return fakeImage(rect.width, rect.height, log);
    },
    resize: (options) => {
      log.push(`resize ${options.width}x${options.height} ${options.quality}`);
      return fakeImage(options.width, options.height, log);
    },
    toPNG: () => Buffer.from(`png ${width}x${height}`),
  };
}

describe('avatarPng', () => {
  it('resizes a square picture to 64 px and answers its PNG', () => {
    const log: string[] = [];
    expect(avatarPng(Buffer.from('bytes'), () => fakeImage(96, 96, log))?.toString()).toBe(`png ${AVATAR_SIZE}x${AVATAR_SIZE}`);
    expect(log).toEqual(['resize 64x64 best']);
  });

  it('crops a picture that is not square to its centred square first', () => {
    const log: string[] = [];
    avatarPng(Buffer.from('bytes'), () => fakeImage(120, 80, log));
    expect(log).toEqual(['crop 20,0 80x80', 'resize 64x64 best']);
    log.length = 0;
    avatarPng(Buffer.from('bytes'), () => fakeImage(80, 121, log));
    expect(log).toEqual(['crop 0,20 80x80', 'resize 64x64 best']);
  });

  it('answers null for bytes that decode to nothing', () => {
    expect(avatarPng(Buffer.from('not an image'), () => fakeImage(0, 0))).toBeNull();
  });
});
