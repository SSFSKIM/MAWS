// `machine.folders.list` (P5 O7 M9, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Remote setup", §U): the
// folders under the machine's home, a page at a time, names only; macOS's protected folders listed and marked, read inside
// only with `open: true`. A fake home under a temp directory, the platform injected: no test reads a real protected folder.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Home } from '@shared/machine/home-folders';
import { listFolders } from './folders';

let home: string;
let mac: Home;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'folders-')));
  mac = { home, platform: 'darwin' };
  for (const dir of ['Developer/GitHub', 'Documents/proj', 'Library/Caches', '.config', 'Music']) mkdirSync(join(home, dir), { recursive: true });
  writeFileSync(join(home, 'notes.txt'), '');
  symlinkSync(join(home, 'Developer'), join(home, 'dev'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const names = (out: { entries: { name: string }[] }) => out.entries.map((entry) => entry.name);
const refusal = async (run: Promise<unknown>) => {
  try {
    await run;
  } catch (error) {
    return (error as Error).message.split(':')[0];
  }
  return 'answered';
};

describe('machine.folders.list', () => {
  it('lists the home’s folders by name, the protected ones marked, no file and no link, the hidden ones last', async () => {
    const out = await listFolders({}, mac);
    expect(out).toEqual({
      entries: [
        { name: 'Developer', path: join(home, 'Developer'), protected: false },
        { name: 'Documents', path: join(home, 'Documents'), protected: true },
        { name: 'Library', path: join(home, 'Library'), protected: true },
        { name: 'Music', path: join(home, 'Music'), protected: true },
        { name: '.config', path: join(home, '.config'), protected: false },
      ],
      cursor: null,
    });
    expect(names(await listFolders({}, { home, platform: 'linux' }))).toEqual(['Developer', 'Documents', 'Library', 'Music', '.config']);
    expect((await listFolders({}, { home, platform: 'linux' })).entries.every((entry) => !entry.protected)).toBe(true);
  });

  it('lists a folder named by its path, absolute or `~`-relative', async () => {
    expect(names(await listFolders({ path: join(home, 'Developer') }, mac))).toEqual(['GitHub']);
    expect(names(await listFolders({ path: '~/Developer' }, mac))).toEqual(['GitHub']);
    expect((await listFolders({ path: '~/dev' }, mac)).entries).toEqual([{ name: 'GitHub', path: join(home, 'Developer/GitHub'), protected: false }]); // its real path
  });

  it('reads inside a protected folder only when the call opens it', async () => {
    expect(await refusal(listFolders({ path: '~/Documents' }, mac))).toBe('protected');
    expect(await refusal(listFolders({ path: '~/Documents/proj' }, mac))).toBe('protected');
    expect(names(await listFolders({ path: '~/Documents', open: true }, mac))).toEqual(['proj']);
    expect(names(await listFolders({ path: '~/Documents/proj', open: true }, mac))).toEqual([]);
    expect(names(await listFolders({ path: '~/Library', open: true }, mac))).toEqual(['Caches']);
    expect(names(await listFolders({ path: '~/Documents' }, { home, platform: 'linux' }))).toEqual(['proj']);
    // the task review's finding 1: a case alias is the folder it names (or, on a case-sensitive volume, no folder)
    expect(['protected', 'no-folder']).toContain(await refusal(listFolders({ path: '~/documents' }, mac)));
    expect(['protected', 'no-folder']).toContain(await refusal(listFolders({ path: '~/documents/proj' }, mac)));
    // `..` climbs from where a link led: `~/shortcut/..` is `~/Documents`, which the call didn't open
    symlinkSync(join(home, 'Documents/proj'), join(home, 'shortcut'));
    expect(await refusal(listFolders({ path: '~/shortcut/..' }, mac))).toBe('protected');
  });

  it('refuses a path outside the home, a missing one, and a link out of the home', async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'folders-out-')));
    try {
      symlinkSync(outside, join(home, 'out'));
      expect(await refusal(listFolders({ path: outside }, mac))).toBe('outside-home');
      expect(await refusal(listFolders({ path: 'Developer' }, mac))).toBe('outside-home');
      expect(await refusal(listFolders({ path: '~/missing' }, mac))).toBe('no-folder');
      expect(await refusal(listFolders({ path: '~/out', open: true }, mac))).toBe('symlink-escape');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('answers a page at a time, each page’s cursor naming the next', async () => {
    for (let i = 0; i < 5; i++) mkdirSync(join(home, 'Developer', `r${i}`));
    const first = await listFolders({ path: '~/Developer' }, mac, 2);
    expect(first).toMatchObject({ cursor: expect.any(String) });
    expect(names(first)).toEqual(['GitHub', 'r0']);
    const second = await listFolders({ path: '~/Developer', cursor: first.cursor! }, mac, 2);
    expect(names(second)).toEqual(['r1', 'r2']);
    const third = await listFolders({ path: '~/Developer', cursor: second.cursor! }, mac, 2);
    expect(third).toEqual({ entries: [expect.objectContaining({ name: 'r3' }), expect.objectContaining({ name: 'r4' })], cursor: null });
  });
});
