// `mawsd`'s trash (P5 O3-D M5; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, D10): the session service's Delete
// moves its paths into the user's trash directory, by a rename, or a copy then an unlink across devices, never over a
// name the trash already holds. Over a scratch home: nothing here reaches the person's own trash.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { trashPath } from './trash';

let root: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-trash-'));
  home = join(root, 'home');
  mkdirSync(home);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function file(name: string, body = name): string {
  const path = join(root, name);
  writeFileSync(path, body);
  return path;
}

const AT = new Date(2026, 9, 29, 17, 5, 9); // local time, as a .trashinfo records it

describe('the trash on macOS', () => {
  it('moves a file and a directory into ~/.Trash under their names', async () => {
    mkdirSync(join(home, '.Trash'));
    const path = file('notes.md');
    const dir = join(root, 'worktree');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'a');
    await trashPath(path, { platform: 'darwin', home, env: {} });
    await trashPath(dir, { platform: 'darwin', home, env: {} });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(dir)).toBe(false);
    expect(readFileSync(join(home, '.Trash', 'notes.md'), 'utf8')).toBe('notes.md');
    expect(readFileSync(join(home, '.Trash', 'worktree', 'src', 'a.ts'), 'utf8')).toBe('a');
  });

  it('never overwrites what the trash holds: a second item of that name gets another', async () => {
    mkdirSync(join(home, '.Trash'));
    writeFileSync(join(home, '.Trash', 'notes.md'), 'already trashed');
    await trashPath(file('notes.md', 'second'), { platform: 'darwin', home, env: {}, now: () => AT });
    expect(readFileSync(join(home, '.Trash', 'notes.md'), 'utf8')).toBe('already trashed');
    const others = readdirSync(join(home, '.Trash')).filter((name) => name !== 'notes.md');
    expect(others).toHaveLength(1);
    expect(others[0]).toMatch(/^notes 17\.05\.09( \d+)?\.md$/);
    expect(readFileSync(join(home, '.Trash', others[0]!), 'utf8')).toBe('second');
  });

  it('creates ~/.Trash when it is missing, and refuses a path that does not exist, moving nothing', async () => {
    await trashPath(file('a.txt'), { platform: 'darwin', home, env: {} });
    expect(readFileSync(join(home, '.Trash', 'a.txt'), 'utf8')).toBe('a.txt');
    await expect(trashPath(join(root, 'gone.txt'), { platform: 'darwin', home, env: {} })).rejects.toThrow(/ENOENT/);
  });

  it('across devices (EXDEV): copies, then removes the original', async () => {
    const path = file('big.bin', 'bytes');
    const renames: string[] = [];
    await trashPath(path, {
      platform: 'darwin',
      home,
      env: {},
      rename: async (from) => {
        renames.push(from);
        throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
      },
    });
    expect(renames).toEqual([path]);
    expect(existsSync(path)).toBe(false);
    expect(readFileSync(join(home, '.Trash', 'big.bin'), 'utf8')).toBe('bytes');
  });
});

describe('the trash on Linux (freedesktop.org)', () => {
  it('moves into ~/.local/share/Trash/files with a .trashinfo naming the original path and the deletion date', async () => {
    const path = file('report one.md');
    await trashPath(path, { platform: 'linux', home, env: {}, now: () => AT });
    const trash = join(home, '.local', 'share', 'Trash');
    expect(readFileSync(join(trash, 'files', 'report one.md'), 'utf8')).toBe('report one.md');
    expect(readFileSync(join(trash, 'info', 'report one.md.trashinfo'), 'utf8')).toBe(`[Trash Info]\nPath=${path.split('/').map(encodeURIComponent).join('/')}\nDeletionDate=2026-10-29T17:05:09\n`);
    expect(existsSync(path)).toBe(false);
  });

  it('reads XDG_DATA_HOME, and never reuses a name the trash holds in files or info', async () => {
    const data = join(root, 'data');
    mkdirSync(join(data, 'Trash', 'info'), { recursive: true });
    writeFileSync(join(data, 'Trash', 'info', 'a.txt.trashinfo'), 'a stale info');
    await trashPath(file('a.txt'), { platform: 'linux', home, env: { XDG_DATA_HOME: data }, now: () => AT });
    const files = readdirSync(join(data, 'Trash', 'files'));
    expect(files).toHaveLength(1);
    expect(files[0]).not.toBe('a.txt');
    expect(existsSync(join(data, 'Trash', 'info', `${files[0]}.trashinfo`))).toBe(true);
    expect(readFileSync(join(data, 'Trash', 'info', 'a.txt.trashinfo'), 'utf8')).toBe('a stale info');
  });

  it('a move that fails leaves no .trashinfo behind', async () => {
    const path = file('kept.txt');
    await expect(
      trashPath(path, { platform: 'linux', home, env: {}, rename: async () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })) }),
    ).rejects.toThrow('denied');
    expect(readdirSync(join(home, '.local', 'share', 'Trash', 'info'))).toEqual([]);
    expect(existsSync(path)).toBe(true);
  });
});

it('refuses a platform with no trash directory it knows', async () => {
  await expect(trashPath(file('x'), { platform: 'win32', home, env: {} })).rejects.toThrow(/no trash/);
});
