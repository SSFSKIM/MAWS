// The Linux release directory (P5 O2 M8; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M8 "The unit's program path
// from a checkout"): a pack copied into `~/.local/share/maws/mawsd/releases/<version>-<commit>/`, `current` flipped to
// it, the two previous releases kept and older ones pruned. Each case runs in a scratch home with fixture packs shaped
// as `pnpm mawsd:pack` writes them.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakePack } from '../../test/support/fake-pack';
import { installRelease, packOf, releaseProgram, releasesRoot } from './release';

let home: string;
let clock: number;
const now = () => (clock += 1_000);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'maws-rel-'));
  clock = Date.parse('2026-10-27T10:00:00Z');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const fixturePack = (commit: string, options: { runtime?: boolean } = {}) => fakePack(join(home, 'checkout', 'dist', 'mawsd'), commit, options);
const entryOf = (root: string) => join(root, 'out', 'main', 'mawsd.js');
const releases = () => readdirSync(join(releasesRoot(home), 'releases')).sort();
const current = () => readlinkSync(join(releasesRoot(home), 'current'));

describe('a pack', () => {
  it('is known by its package.json’s release, from its entry', () => {
    const root = fixturePack('aaaaaaaa');
    expect(packOf(entryOf(root))).toEqual({ root, release: '0.0.0-aaaaaaaa', runtime: true });
  });

  it('is not a checkout’s out/main, nor a pack whose release is no plain name', () => {
    mkdirSync(join(home, 'repo', 'out', 'main'), { recursive: true });
    writeFileSync(join(home, 'repo', 'package.json'), JSON.stringify({ name: 'maws', version: '0.0.0' }));
    expect(packOf(join(home, 'repo', 'out', 'main', 'mawsd.js'))).toBeNull();
    expect(packOf(join(home, 'nowhere', 'out', 'main', 'mawsd.js'))).toBeNull();
    const root = fixturePack('bbbbbbbb');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'maws-mawsd', mawsd: { release: '../escape' } }));
    expect(packOf(entryOf(root))).toBeNull();
    expect(packOf(join(root, 'mawsd.js'))).toBeNull(); // an entry not at <pack>/out/main/mawsd.js
  });
});

describe('installing a release', () => {
  it('copies the pack under releases/, points current at it, and the unit’s program is current’s', () => {
    const pack = fixturePack('aaaaaaaa');
    const installed = installRelease(packOf(entryOf(pack))!, home, now);
    expect(installed).toEqual({ release: '0.0.0-aaaaaaaa', previous: null, flipped: true, pruned: [] });
    expect(releases()).toEqual(['0.0.0-aaaaaaaa']);
    expect(current()).toBe(join('releases', '0.0.0-aaaaaaaa')); // relative, so the tree can be read under another root
    const target = join(releasesRoot(home), 'releases', '0.0.0-aaaaaaaa');
    expect(readFileSync(join(target, 'out', 'main', 'mawsd.js'), 'utf8')).toBe('// mawsd aaaaaaaa\n');
    expect(lstatSync(join(target, 'runtime', 'bin', 'node')).mode & 0o111).not.toBe(0);
    expect(existsSync(join(target, 'node_modules', 'zod', 'package.json'))).toBe(true);
    expect(releaseProgram(home)).toEqual({ runtime: join(releasesRoot(home), 'current', 'runtime', 'bin', 'node'), entry: join(releasesRoot(home), 'current', 'out', 'main', 'mawsd.js') });
    expect(releasesRoot(home)).toBe(join(home, '.local', 'share', 'maws', 'mawsd'));
  });

  it('installs the same pack again in place, leaving current where it was; from the installed release itself it copies nothing', () => {
    const pack = fixturePack('aaaaaaaa');
    installRelease(packOf(entryOf(pack))!, home, now);
    writeFileSync(entryOf(pack), '// mawsd aaaaaaaa, rebuilt\n');
    expect(installRelease(packOf(entryOf(pack))!, home, now)).toMatchObject({ previous: '0.0.0-aaaaaaaa', flipped: false });
    const target = join(releasesRoot(home), 'releases', '0.0.0-aaaaaaaa');
    expect(readFileSync(entryOf(target), 'utf8')).toBe('// mawsd aaaaaaaa, rebuilt\n');

    writeFileSync(join(target, 'marker'), 'kept');
    expect(installRelease(packOf(entryOf(join(releasesRoot(home), 'current')))!, home, now)).toMatchObject({ flipped: false });
    expect(readFileSync(join(target, 'marker'), 'utf8')).toBe('kept'); // not copied over itself
    expect(readdirSync(join(releasesRoot(home), 'releases'))).toEqual(['0.0.0-aaaaaaaa']); // no temporary left
  });

  it('flips current to a new release and keeps the two previous ones, pruning the rest', () => {
    const order = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd', 'eeeeeeee'];
    const results = order.map((commit) => installRelease(packOf(entryOf(fixturePack(commit)))!, home, now));
    expect(results.map((r) => [r.previous, r.flipped])).toEqual([
      [null, true],
      ['0.0.0-aaaaaaaa', true],
      ['0.0.0-bbbbbbbb', true],
      ['0.0.0-cccccccc', true],
      ['0.0.0-dddddddd', true],
    ]);
    expect(results[3]!.pruned).toEqual(['0.0.0-aaaaaaaa']);
    expect(results[4]!.pruned).toEqual(['0.0.0-bbbbbbbb']);
    expect(releases()).toEqual(['0.0.0-cccccccc', '0.0.0-dddddddd', '0.0.0-eeeeeeee']);
    expect(current()).toBe(join('releases', '0.0.0-eeeeeeee'));
  });

  it('orders the previous releases by when each was last installed, so a reinstalled old one is kept', () => {
    for (const commit of ['aaaaaaaa', 'bbbbbbbb', 'cccccccc']) installRelease(packOf(entryOf(fixturePack(commit)))!, home, now);
    // back to a, from its installed copy (a rollback), then a new release: c and a are the two previous
    installRelease(packOf(entryOf(join(releasesRoot(home), 'releases', '0.0.0-aaaaaaaa')))!, home, now);
    expect(current()).toBe(join('releases', '0.0.0-aaaaaaaa'));
    const next = installRelease(packOf(entryOf(fixturePack('dddddddd')))!, home, now);
    expect(next.pruned).toEqual(['0.0.0-bbbbbbbb']);
    expect(releases()).toEqual(['0.0.0-aaaaaaaa', '0.0.0-cccccccc', '0.0.0-dddddddd']);
  });

  it('refuses a pack with no runtime, changing nothing', () => {
    const pack = fixturePack('aaaaaaaa', { runtime: false });
    expect(() => installRelease(packOf(entryOf(pack))!, home, now)).toThrow(`the release 0.0.0-aaaaaaaa at ${pack} has no runtime/bin/node`);
    expect(existsSync(releasesRoot(home))).toBe(false);
  });
});
