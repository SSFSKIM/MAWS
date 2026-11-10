// The anchor of a stored statement (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §D, §B's
// `anchors`): the comparison pinned across the two runtimes by the shared vectors, and the reading of a folder.
import { mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../../test/support/index-fixture';
import { anchorOf, readAnchor, readFolder, sameFolder, type FolderReading } from './anchor';
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
    expect(anchorOf(stat({ dev: 18446744073709551615n, ino: 9007199254740993n }), 'darwin')).toEqual({ dev: '18446744073709551615', ino: '9007199254740993', birth: '197164871453944374' });
  });

  it('on Linux, a filesystem with no birth time anchors with birth "0", never with its change time', () => {
    expect(anchorOf(stat({ birthtimeNs: 0n }), 'linux').birth).toBe('0');
    // libuv's stat fallback reports the change time as the birth time where it has none
    expect(anchorOf(stat({ birthtimeNs: 197164999000000000n, ctimeNs: 197164999000000000n }), 'linux').birth).toBe('0');
    expect(anchorOf(stat(), 'linux').birth).toBe('197164871453944374');
    expect(anchorOf(stat({ birthtimeNs: 0n }), 'darwin').birth).toBe('0');
  });

  describe('on disk', () => {
    let root: ReturnType<typeof tempDir>;
    beforeEach(() => {
      root = tempDir('maws-anchor-');
    });
    afterEach(() => root.dispose());

    it('reads the same folder as itself, a folder made anew at its path as another, and nothing where there is none', () => {
      const path = join(root.path, 'f');
      mkdirSync(path);
      const anchor = readAnchor(path)!;
      expect(anchor).toMatchObject({ dev: expect.stringMatching(/^\d+$/), ino: expect.stringMatching(/^\d+$/), birth: expect.stringMatching(/^\d+$/) });
      expect(sameFolder(anchor, readFolder(path)!)).toBe(true);
      rmSync(path, { recursive: true });
      mkdirSync(path);
      expect(sameFolder(anchor, readFolder(path)!)).toBe(false);
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
