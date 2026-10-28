// The Linux release directory (P5 O2 M8; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M8 "The unit's program path
// from a checkout"): a pack copied into `~/.local/share/maws/mawsd/releases/<release>/`, `current` flipped to it, the
// two previous releases kept and older ones pruned, never one a running process runs from; a release is immutable.
// Each case runs in a scratch home with fixture packs shaped as `pnpm mawsd:pack` writes them, and an injected list of
// running processes standing in for /proc.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakePack } from '../../test/support/fake-pack';
import { currentRelease, installRelease, packOf, pruneReleases, releaseProgram, releasesRoot, restoreCurrent, type RunningProcess } from './release';

let home: string;
let clock: number;
const now = () => (clock += 1_000);
let live: RunningProcess[] = [];
const processes = () => live;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'maws-rel-'));
  clock = Date.parse('2026-10-27T10:00:00Z');
  live = [];
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const fixturePack = (commit: string, options: { runtime?: boolean; content?: string } = {}) => fakePack(join(home, 'checkout', 'dist', 'mawsd'), commit, options);
const entryOf = (root: string) => join(root, 'out', 'main', 'mawsd.js');
const releaseDir = (name: string) => join(releasesRoot(home), 'releases', name);
const releases = () => readdirSync(join(releasesRoot(home), 'releases')).sort();
const current = () => readlinkSync(join(releasesRoot(home), 'current'));
// an install as install.ts makes it, once the release is active: the flip, then the pruning
const install = (root: string) => ({ ...installRelease(packOf(entryOf(root))!, home, { now }), pruned: pruneReleases(home, { processes }) });

describe('a pack', () => {
  it('is known by its package.json’s release, from its entry', () => {
    const root = fixturePack('aaaaaaaa', { content: '0f0f0f0f' });
    expect(packOf(entryOf(root))).toEqual({ root, release: '0.0.0-aaaaaaaa-0f0f0f0f', runtime: true });
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
    expect(install(pack)).toEqual({ release: '0.0.0-aaaaaaaa', previous: null, flipped: true, pruned: [] });
    expect(releases()).toEqual(['0.0.0-aaaaaaaa']);
    expect(current()).toBe(join('releases', '0.0.0-aaaaaaaa')); // relative, so the tree can be read under another root
    const target = releaseDir('0.0.0-aaaaaaaa');
    expect(readFileSync(join(target, 'out', 'main', 'mawsd.js'), 'utf8')).toBe('// mawsd aaaaaaaa\n');
    expect(lstatSync(join(target, 'runtime', 'bin', 'node')).mode & 0o111).not.toBe(0);
    expect(existsSync(join(target, 'node_modules', 'zod', 'package.json'))).toBe(true);
    expect(releaseProgram(home)).toEqual({ runtime: join(releasesRoot(home), 'current', 'runtime', 'bin', 'node'), entry: join(releasesRoot(home), 'current', 'out', 'main', 'mawsd.js') });
    expect(releasesRoot(home)).toBe(join(home, '.local', 'share', 'maws', 'mawsd'));
  });

  it('is immutable: the same release again copies nothing and leaves current, from its pack or from the installed copy', () => {
    const pack = fixturePack('aaaaaaaa', { content: '11111111' });
    install(pack);
    const target = releaseDir('0.0.0-aaaaaaaa-11111111');
    writeFileSync(join(target, 'marker'), 'kept');
    writeFileSync(entryOf(pack), '// tampered after the install\n'); // the same name is the same content: never read again
    expect(install(pack)).toEqual({ release: '0.0.0-aaaaaaaa-11111111', previous: '0.0.0-aaaaaaaa-11111111', flipped: false, pruned: [] });
    expect(install(join(releasesRoot(home), 'current'))).toMatchObject({ flipped: false });
    expect(readFileSync(join(target, 'marker'), 'utf8')).toBe('kept');
    expect(readFileSync(entryOf(target), 'utf8')).toBe('// mawsd aaaaaaaa 11111111\n');
    expect(readdirSync(join(releasesRoot(home), 'releases'))).toEqual(['0.0.0-aaaaaaaa-11111111']); // no staging left
  });

  it('a rebuild of the same commit with other content is another release, and a live host’s asset files survive it', () => {
    install(fixturePack('aaaaaaaa', { content: '11111111' }));
    const first = releaseDir('0.0.0-aaaaaaaa-11111111');
    const asset = join(first, 'out', 'main', 'assets', 'asset-11111111.css');
    // the engine host, spawned through the first release's real runtime path, reads its asset files while it runs
    live = [{ exe: join(first, 'runtime', 'bin', 'node'), cmdline: `maws-supervisor --disable-sigusr1 ${join(first, 'out', 'main', 'index-a.js')} --detached /p/supervisor` }];
    const rebuilt = install(fixturePack('aaaaaaaa', { content: '22222222' }));
    expect(rebuilt).toEqual({ release: '0.0.0-aaaaaaaa-22222222', previous: '0.0.0-aaaaaaaa-11111111', flipped: true, pruned: [] });
    expect(readFileSync(asset, 'utf8')).toBe('/* 0.0.0-aaaaaaaa-11111111 */\n');
    for (const content of ['33333333', '44444444', '55555555']) install(fixturePack('aaaaaaaa', { content }));
    expect(readFileSync(asset, 'utf8')).toBe('/* 0.0.0-aaaaaaaa-11111111 */\n'); // past two previous releases, still in use
    expect(releases()).toEqual(['0.0.0-aaaaaaaa-11111111', '0.0.0-aaaaaaaa-33333333', '0.0.0-aaaaaaaa-44444444', '0.0.0-aaaaaaaa-55555555']);
  });

  it('flips current to a new release and keeps the two previous ones, pruning the rest', () => {
    const order = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd', 'eeeeeeee'];
    const results = order.map((commit) => install(fixturePack(commit)));
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
    for (const commit of ['aaaaaaaa', 'bbbbbbbb', 'cccccccc']) install(fixturePack(commit));
    // back to a, from its installed copy (a rollback), then a new release: c and a are the two previous
    install(releaseDir('0.0.0-aaaaaaaa'));
    expect(current()).toBe(join('releases', '0.0.0-aaaaaaaa'));
    expect(install(fixturePack('dddddddd')).pruned).toEqual(['0.0.0-bbbbbbbb']);
    expect(releases()).toEqual(['0.0.0-aaaaaaaa', '0.0.0-cccccccc', '0.0.0-dddddddd']);
  });

  it('never prunes a release a running process’s executable lies under, though its command line names only current/', () => {
    install(fixturePack('aaaaaaaa'));
    const link = join(releasesRoot(home), 'current');
    // the unit's mawsd, exec'd as current/runtime/bin/node while current named a: the kernel resolved its executable then
    const mawsd = { exe: join(releaseDir('0.0.0-aaaaaaaa'), 'runtime', 'bin', 'node'), cmdline: `${link}/runtime/bin/node --disable-sigusr1 ${link}/out/main/mawsd.js run --unit --dir /p/mawsd` };
    live = [mawsd, { exe: '/usr/bin/sleep', cmdline: '/usr/bin/sleep 100' }, { exe: null, cmdline: '' }];
    const results = ['bbbbbbbb', 'cccccccc', 'dddddddd'].map((commit) => install(fixturePack(commit)));
    expect(results.flatMap((r) => r.pruned)).toEqual([]); // a is past the two previous at d, and kept
    expect(releases()).toEqual(['0.0.0-aaaaaaaa', '0.0.0-bbbbbbbb', '0.0.0-cccccccc', '0.0.0-dddddddd']);
    // `current/` in a command line is never read against the link as it is now (d): only the executable counts
    live = [{ exe: null, cmdline: mawsd.cmdline }];
    expect(install(fixturePack('eeeeeeee')).pruned).toEqual(['0.0.0-aaaaaaaa', '0.0.0-bbbbbbbb']);
  });

  it('keeps a release a command line names under releases/, whatever its executable', () => {
    install(fixturePack('aaaaaaaa'));
    live = [{ exe: '/usr/bin/node', cmdline: `/usr/bin/node ${join(releaseDir('0.0.0-aaaaaaaa'), 'out', 'main', 'index-x.js')}` }];
    for (const commit of ['bbbbbbbb', 'cccccccc', 'dddddddd']) install(fixturePack(commit));
    expect(releases()).toContain('0.0.0-aaaaaaaa');
  });

  it('puts current back after a failed activation, or removes it when there was none', () => {
    install(fixturePack('aaaaaaaa'));
    const flip = installRelease(packOf(entryOf(fixturePack('bbbbbbbb')))!, home, { now });
    expect(currentRelease(home)).toBe('0.0.0-bbbbbbbb');
    restoreCurrent(home, flip.previous);
    expect(currentRelease(home)).toBe('0.0.0-aaaaaaaa');
    expect(installRelease(packOf(entryOf(fixturePack('bbbbbbbb')))!, home, { now })).toMatchObject({ previous: '0.0.0-aaaaaaaa', flipped: true }); // a retry flips again
    restoreCurrent(home, null);
    expect(currentRelease(home)).toBeNull();
    expect(existsSync(join(releasesRoot(home), 'current'))).toBe(false);
  });

  it('refuses a pack with no runtime, changing nothing', () => {
    const pack = fixturePack('aaaaaaaa', { runtime: false });
    expect(() => installRelease(packOf(entryOf(pack))!, home, { now })).toThrow(`the release 0.0.0-aaaaaaaa at ${pack} has no runtime/bin/node`);
    expect(existsSync(releasesRoot(home))).toBe(false);
  });
});
