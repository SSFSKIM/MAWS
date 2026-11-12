// The anchor of a stored statement (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §D, §B's
// `anchors`): the comparison pinned across the two runtimes by the shared vectors, and the reading of a folder.
import { mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../../test/support/index-fixture';
import { anchorOf, birthFollowsChange, readAnchor, readFolder, sameFolder, type FolderReading } from './anchor';
import type { Anchor } from '@shared/machine/registry';

const VECTORS = join(__dirname, '../../../apps/org-protocol/vectors/project-rule.json');
const { anchors } = JSON.parse(readFileSync(VECTORS, 'utf8')) as { anchors: { name: string; anchor: Anchor; reading: FolderReading; same: boolean }[] };

describe("the shared vectors' anchors", () => {
  it('holds the cases §B lists', () => {
    expect(anchors.length).toBeGreaterThanOrEqual(8);
  });

  it.each(anchors)('$name', ({ anchor, reading, same }) => {
    expect(sameFolder(anchor, reading)).toBe(same);
  });
});

describe('a folder’s anchor', () => {
  const stat = (over: Partial<{ dev: bigint; ino: bigint; birthtimeNs: bigint; ctimeNs: bigint }> = {}) => ({ dev: 16777231n, ino: 53301125n, birthtimeNs: 197164871453944374n, ctimeNs: 197164999000000000n, ...over });

  it('writes the exact decimals of a 64-bit stat', () => {
    expect(anchorOf(stat({ dev: 18446744073709551615n, ino: 9007199254740993n }), false)).toEqual({ dev: '18446744073709551615', ino: '9007199254740993', birth: '197164871453944374' });
  });

  it('on Linux, a filesystem with no birth time anchors with birth "0", never with its change time', () => {
    // statx with no birth time: libuv gives 0
    expect(anchorOf(stat({ birthtimeNs: 0n }), false).birth).toBe('0');
    // a process whose libuv falls back to stat reports the change time as every birth time: none is a birth time
    expect(anchorOf(stat({ birthtimeNs: 197164999000000000n, ctimeNs: 197164999000000000n }), true).birth).toBe('0');
    expect(anchorOf(stat(), true).birth).toBe('0');
    // elsewhere a real birth time is kept, even one equal to the change time (a folder not changed since it was made)
    expect(anchorOf(stat({ birthtimeNs: 197164999000000000n, ctimeNs: 197164999000000000n }), false).birth).toBe('197164999000000000');
  });

  it('the probe reads a birth time that moves with the change time as the change time, and one that stays as a birth time', () => {
    let ctime = 100n;
    const moving = () => ({ birthtimeNs: ctime, ctimeNs: (ctime += 5n) - 5n });
    expect(birthFollowsChange(moving)).toBe(true);
    let changes = 100n;
    const staying = () => ({ birthtimeNs: 100n, ctimeNs: (changes += 5n) });
    expect(birthFollowsChange(staying)).toBe(false);
    // this process's own reading: Node on macOS, and libuv with statx on Linux, report a birth time of its own
    expect(birthFollowsChange()).toBe(false);
  });

  describe('on disk', () => {
    let root: ReturnType<typeof tempDir>;
    beforeEach(() => {
      root = tempDir('maws-anchor-');
    });
    afterEach(() => root.dispose());

    it('reads the same folder as itself, a folder made anew at its path as another, and nothing where there is none', async () => {
      const path = join(root.path, 'f');
      mkdirSync(path);
      const anchor = readAnchor(path)!;
      expect(anchor).toMatchObject({ dev: expect.stringMatching(/^\d+$/), ino: expect.stringMatching(/^\d+$/), birth: expect.stringMatching(/^\d+$/) });
      expect(sameFolder(anchor, readFolder(path)!)).toBe(true);
      rmSync(path, { recursive: true });
      // past the filesystem clock's tick (ext4 stamps at the kernel's coarse clock), where a reused inode tells nothing
      await new Promise((resolve) => setTimeout(resolve, 30));
      mkdirSync(path);
      const anew = readFolder(path)!;
      // with no birth time a reused inode is the one case the weaker check cannot tell (§D); every other one it does
      if (anchor.birth !== '0' || anew.ino !== anchor.ino) expect(sameFolder(anchor, anew)).toBe(false);
      expect(readAnchor(join(root.path, 'none'))).toBeNull();
      expect(readFolder(join(root.path, 'none'))).toBeNull();
    });

    it('reads a folder through a link as the folder', () => {
      const path = join(root.path, 'real');
      mkdirSync(path);
      symlinkSync(path, join(root.path, 'alias'));
      expect(readAnchor(join(root.path, 'alias'))).toEqual(readAnchor(path));
    });
  });
});
