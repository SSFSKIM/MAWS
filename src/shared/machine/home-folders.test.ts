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
  it('expands `~` and `~/…`, keeps an absolute path as given, and takes nothing relative', () => {
    expect(expandHome('~', home)).toBe(home);
    expect(expandHome('~/Developer/GitHub', home)).toBe(join(home, 'Developer/GitHub'));
    expect(expandHome(`${home}/Developer/../Documents/`, home)).toBe(`${home}/Developer/../Documents/`); // the walk resolves `..`, never a lexical collapse
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

  // The task review's findings 1 and 2: a name the volume takes for a protected folder's is that folder; a `..` climbs from
  // where the link before it led, as the kernel resolves it.
  it('takes a name as its folder lists it, so a case alias of a protected folder is that folder', async () => {
    expect(isProtected(join(home, 'documents'), mac)).toBe(true);
    expect(isProtected(join(home, 'LIBRARY/mobile documents/x'), mac)).toBe(true);
    mkdirSync(join(home, 'Documents/secret'));
    const alias = await resolveInHome(join(home, 'documents/secret'), mac, none);
    expect(alias.ok).toBe(false); // `protected` on a case-insensitive volume (macOS's), `no-folder` where the alias names nothing
    expect(['protected', 'no-folder']).toContain(alias.ok ? null : alias.reason);
    const library = (folder: string) => folder === join(home, 'Library');
    const mobile = await resolveInHome(join(home, 'Library/mobile documents/com~apple~CloudDocs'), mac, library);
    expect(mobile.ok).toBe(false);
    expect(['protected', 'no-folder']).toContain(mobile.ok ? null : mobile.reason);
    // opened under its own name, the alias reaches it by the name the home lists
    const documents = (folder: string) => folder === join(home, 'Documents');
    const opened = await resolveInHome(join(home, 'documents/secret'), mac, documents);
    if (opened.ok) expect(opened.real).toBe(join(home, 'Documents/secret')); // a case-insensitive volume: its listed spelling
  });

  it('climbs a `..` from where the link before it led, never collapsing it first', async () => {
    mkdirSync(join(home, 'Documents/sub'));
    mkdirSync(join(home, 'Documents/secret'));
    mkdirSync(join(home, 'secret'));
    symlinkSync(join(home, 'Documents/sub'), join(home, 'shortcut'));
    expect(await resolveInHome(`${home}/shortcut/../secret`, mac, none)).toEqual({ ok: false, reason: 'protected' }); // the kernel's `~/Documents/secret`
    expect(await resolveInHome(`${home}/shortcut/../secret`, mac, (folder) => folder === join(home, 'Documents'))).toEqual({ ok: true, real: join(home, 'Documents/secret') });
    expect(await resolveInHome(`${home}/Developer/../secret`, mac, none)).toEqual({ ok: true, real: join(home, 'secret') });
    expect(await resolveInHome(`${home}/Developer/../..`, mac, all)).toEqual({ ok: false, reason: 'outside-home' });
    symlinkSync('..', join(home, 'Developer/up'));
    expect(await resolveInHome(`${home}/Developer/up/..`, mac, all)).toEqual({ ok: false, reason: 'symlink-escape' }); // a link's climb out of the home
  });

  it('touches nothing inside an unopened protected folder: a missing path in one is `protected`, never `no-folder`', async () => {
    expect(await resolveInHome(join(home, 'Documents/nothing-here'), mac, none)).toEqual({ ok: false, reason: 'protected' });
    expect(await resolveInHome(join(home, 'Desktop/nothing-here'), mac, none)).toEqual({ ok: false, reason: 'no-folder' }); // ~/Desktop itself is absent: its own entry, read in the home
  });
});
