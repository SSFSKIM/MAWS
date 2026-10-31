// The shared no-link open (P5 O3-E M2 fix round 1): the ancestors' walk on every platform, the bits per platform, and
// on Linux the descriptor's own path, which refuses an open that followed a link put above the walked path.
import { closeSync, constants, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { confirmOpened, confirmOpenedSync, LinkOnTheWay, NO_LINK, O_NOFOLLOW_ANY, walk, walkSync, WALKED } from './no-link';

let base: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'maws-no-link-')));
  mkdirSync(join(base, 'real', 'dir'), { recursive: true });
  writeFileSync(join(base, 'real', 'dir', 'f.txt'), 'in');
  writeFileSync(join(base, 'file'), 'not a directory');
  symlinkSync(join(base, 'real'), join(base, 'link'));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('the no-link open', () => {
  it('takes O_NOFOLLOW_ANY alone on macOS, and walks with O_NOFOLLOW elsewhere', () => {
    if (process.platform === 'darwin') expect([NO_LINK, WALKED]).toEqual([O_NOFOLLOW_ANY, false]);
    else expect([NO_LINK, WALKED]).toEqual([constants.O_NOFOLLOW, true]);
  });

  it('walks every directory from the root: a link or a file on the way is LinkOnTheWay (ELOOP), a missing one ENOENT', async () => {
    for (const check of [walkSync, walk]) {
      await expect(Promise.resolve().then(() => check(join(base, 'real', 'dir')))).resolves.toBeUndefined();
      await expect(Promise.resolve().then(() => check(join(base, 'link', 'dir')))).rejects.toMatchObject({ constructor: LinkOnTheWay, part: 'link', code: 'ELOOP' });
      await expect(Promise.resolve().then(() => check(join(base, 'file')))).rejects.toMatchObject({ constructor: LinkOnTheWay, part: 'file' });
      await expect(Promise.resolve().then(() => check(join(base, 'gone', 'dir')))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  // Linux: the kernel's name for the descriptor (/proc/self/fd) is the walked path, or the open followed a link
  it.runIf(process.platform === 'linux')('confirms a descriptor at the walked path, and refuses one that followed a link above it', async () => {
    const walked = join(base, 'link', 'dir', 'f.txt'); // as a walk that passed before the link appeared would name it
    const at = openSync(join(base, 'real', 'dir', 'f.txt'), constants.O_RDONLY | NO_LINK);
    const through = openSync(walked, constants.O_RDONLY | NO_LINK); // O_NOFOLLOW guards the last component alone
    try {
      expect(() => confirmOpenedSync(at, join(base, 'real', 'dir', 'f.txt'))).not.toThrow();
      await expect(confirmOpened(at, join(base, 'real', 'dir', 'f.txt'))).resolves.toBeUndefined();
      expect(() => confirmOpenedSync(through, walked)).toThrow(LinkOnTheWay);
      await expect(confirmOpened(through, walked)).rejects.toBeInstanceOf(LinkOnTheWay);
    } finally {
      closeSync(at);
      closeSync(through);
    }
  });
});
