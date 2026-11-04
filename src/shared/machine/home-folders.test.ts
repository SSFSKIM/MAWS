// The machine's home as a remote setup reads it (P5 O7 M9, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "Remote setup"): which folders are macOS's protected ones, and a path resolved under the home one component at a time,
// touching nothing inside a protected folder that wasn't opened. Every case runs on a fake home under a temp directory
// with the platform injected: no test reads a real protected folder.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expandHome, isProtected, resolveInHome, within, type Home } from './home-folders';

let home: string;
let outside: string;
let mac: Home;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'home-folders-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'home-folders-out-')));
  mac = { home, platform: 'darwin' };
  for (const dir of ['Documents/proj', 'Developer/GitHub/maws', 'Library/Mobile Documents/com~apple~CloudDocs/x']) mkdirSync(join(home, dir), { recursive: true });
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const none = () => false;
const all = () => true;

describe('the protected folders', () => {
  it('are the seven under the home, and anything under ~/Library/Mobile Documents, on macOS alone', () => {
    for (const name of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'Library']) expect([name, isProtected(join(home, name), mac)]).toEqual([name, true]);
    expect(isProtected(join(home, 'Library/Mobile Documents'), mac)).toBe(true);
    expect(isProtected(join(home, 'Library/Mobile Documents/com~apple~CloudDocs/x'), mac)).toBe(true);
    expect(isProtected(join(home, 'Library/Caches'), mac)).toBe(false); // inside ~/Library, which governs it, but not one itself
    expect(isProtected(join(home, 'Documents/proj'), mac)).toBe(false);
    expect(isProtected(join(home, 'Developer'), mac)).toBe(false);
    expect(isProtected(home, mac)).toBe(false);
    expect(isProtected(join(home, 'Documents'), { home, platform: 'linux' })).toBe(false);
  });
});

describe('a path under the home', () => {
  it('expands `~` and `~/…`, keeps an absolute path normalized, and takes nothing relative', () => {
    expect(expandHome('~', home)).toBe(home);
    expect(expandHome('~/Developer/GitHub', home)).toBe(join(home, 'Developer/GitHub'));
    expect(expandHome(`${home}/Developer/../Documents/`, home)).toBe(join(home, 'Documents'));
    expect(expandHome('Developer', home)).toBeNull();
    expect(expandHome('~other/x', home)).toBeNull();
    expect(within(join(home, 'a'), home)).toBe(true);
    expect(within(home, home)).toBe(true);
    expect(within(`${home}-sibling`, home)).toBe(false);
  });

  it('resolves to its real path when it exists, is a directory and lies under the home', async () => {
    expect(await resolveInHome(join(home, 'Developer/GitHub/maws'), mac, none)).toEqual({ ok: true, real: join(home, 'Developer/GitHub/maws') });
    expect(await resolveInHome(home, mac, none)).toEqual({ ok: true, real: home });
  });

  it('refuses one that is missing or is no directory', async () => {
    writeFileSync(join(home, 'Developer/notes.txt'), '');
    expect(await resolveInHome(join(home, 'Developer/missing'), mac, none)).toEqual({ ok: false, reason: 'no-folder' });
    expect(await resolveInHome(join(home, 'Developer/notes.txt'), mac, none)).toEqual({ ok: false, reason: 'no-folder' });
    expect(await resolveInHome(join(home, 'Developer/notes.txt/x'), mac, none)).toEqual({ ok: false, reason: 'no-folder' });
  });

  it('refuses one outside the home, by its path or by `..`', async () => {
    expect(await resolveInHome(outside, mac, all)).toEqual({ ok: false, reason: 'outside-home' });
    expect(await resolveInHome(join(home, '..'), mac, all)).toEqual({ ok: false, reason: 'outside-home' });
    expect(await resolveInHome('Developer', mac, all)).toEqual({ ok: false, reason: 'outside-home' });
  });

  it('follows a link that stays under the home, and refuses one that leaves it (a link’s escape), at any depth', async () => {
    symlinkSync(join(home, 'Developer/GitHub'), join(home, 'code'));
    expect(await resolveInHome(join(home, 'code/maws'), mac, none)).toEqual({ ok: true, real: join(home, 'Developer/GitHub/maws') });
    symlinkSync('../Developer/GitHub', join(home, 'Developer/gh')); // relative to its own folder
    expect(await resolveInHome(join(home, 'Developer/gh/maws'), mac, none)).toEqual({ ok: true, real: join(home, 'Developer/GitHub/maws') });
    mkdirSync(join(outside, 'repo'));
    symlinkSync(outside, join(home, 'Developer/out'));
    expect(await resolveInHome(join(home, 'Developer/out/repo'), mac, all)).toEqual({ ok: false, reason: 'symlink-escape' });
    symlinkSync(join(outside, 'repo'), join(home, 'repo'));
    expect(await resolveInHome(join(home, 'repo'), mac, all)).toEqual({ ok: false, reason: 'symlink-escape' });
    // a link out and back in still left the home on its way
    symlinkSync(join(home, 'Developer'), join(outside, 'back'));
    symlinkSync(join(outside, 'back'), join(home, 'round'));
    expect(await resolveInHome(join(home, 'round'), mac, all)).toEqual({ ok: false, reason: 'symlink-escape' });
  });

  it('refuses a loop of links', async () => {
    symlinkSync(join(home, 'loop-b'), join(home, 'loop-a'));
    symlinkSync(join(home, 'loop-a'), join(home, 'loop-b'));
    expect(await resolveInHome(join(home, 'loop-a'), mac, all)).toEqual({ ok: false, reason: 'symlink-escape' });
  });

  it('reads inside a protected folder only when it was opened: a folder in one, the folder itself, or a link into one', async () => {
    const documents = join(home, 'Documents');
    const opened = (folder: string) => folder === documents;
    expect(await resolveInHome(join(documents, 'proj'), mac, none)).toEqual({ ok: false, reason: 'protected' });
    expect(await resolveInHome(join(documents, 'proj'), mac, opened)).toEqual({ ok: true, real: join(documents, 'proj') });
    expect(await resolveInHome(documents, mac, none)).toEqual({ ok: false, reason: 'protected' }); // read inside it
    expect(await resolveInHome(documents, mac, opened)).toEqual({ ok: true, real: documents });
    symlinkSync(join(documents, 'proj'), join(home, 'Developer/proj'));
    expect(await resolveInHome(join(home, 'Developer/proj'), mac, none)).toEqual({ ok: false, reason: 'protected' });
    expect(await resolveInHome(join(home, 'Developer/proj'), mac, opened)).toEqual({ ok: true, real: join(documents, 'proj') });
    // ~/Library opened does not open what is under Mobile Documents
    const library = (folder: string) => folder === join(home, 'Library');
    expect(await resolveInHome(join(home, 'Library/Mobile Documents/com~apple~CloudDocs'), mac, library)).toEqual({ ok: false, reason: 'protected' });
    // on Linux nothing is protected
    expect(await resolveInHome(join(documents, 'proj'), { home, platform: 'linux' }, none)).toEqual({ ok: true, real: join(documents, 'proj') });
  });

  it('touches nothing inside an unopened protected folder: a missing path in one is `protected`, never `no-folder`', async () => {
    expect(await resolveInHome(join(home, 'Documents/nothing-here'), mac, none)).toEqual({ ok: false, reason: 'protected' });
    expect(await resolveInHome(join(home, 'Desktop/nothing-here'), mac, none)).toEqual({ ok: false, reason: 'no-folder' }); // ~/Desktop itself is absent: its own entry, read in the home
  });
});
