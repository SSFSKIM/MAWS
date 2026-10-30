// `mawsd`'s trash (P5 O3-D M5; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, D10): the session service's Delete
// moves its paths into the user's trash directory, by a rename, or a copy then an unlink across devices, never over a
// name the trash already holds. Over a scratch home: nothing here reaches the person's own trash.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rename as fsRename } from 'node:fs/promises';
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
const existsLink = (path: string) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

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

// Review fix: two moves of a same-named item at once, each reaching its rename only once both have chosen a name (a
// rendezvous), never land on one name: each claims its name before the move, so neither item is lost.
describe('two moves of one name at once', () => {
  function rendezvous() {
    let arrived = 0;
    let release!: () => void;
    const both = new Promise<void>((resolve) => (release = resolve));
    return async (from: string, to: string) => {
      arrived += 1;
      if (arrived === 2) release();
      await both;
      await fsRename(from, to);
    };
  }

  for (const platform of ['darwin', 'linux'] as const) {
    for (const kind of ['file', 'directory'] as const) {
      it(`${platform}: two ${kind === 'file' ? 'files' : 'directories'} of one name both land, each under its own name`, async () => {
        const env = { XDG_DATA_HOME: join(root, 'xdg') };
        const trash = platform === 'darwin' ? join(home, '.Trash') : join(root, 'xdg', 'Trash', 'files');
        const read = (path: string) => readFileSync(kind === 'file' ? path : join(path, 'body'), 'utf8');
        const sources = ['one', 'two'].map((where) => {
          const path = join(root, where, 'report');
          mkdirSync(kind === 'file' ? join(root, where) : path, { recursive: true });
          writeFileSync(kind === 'file' ? path : join(path, 'body'), where);
          return path;
        });
        const rename = rendezvous();
        await Promise.all(sources.map((path) => trashPath(path, { platform, home, env, now: () => AT, rename })));
        const held = readdirSync(trash);
        expect(held).toHaveLength(2);
        expect(held.map((name) => read(join(trash, name))).sort()).toEqual(['one', 'two']);
      });
    }
  }

  it('across devices (EXDEV), a symlink lands as itself, the original gone and nothing else left in the trash', async () => {
    const link = join(root, 'shortcut');
    symlinkSync('../elsewhere/target', link);
    const exdev = async () => Promise.reject(Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' }));
    for (const platform of ['darwin', 'linux'] as const) {
      if (!existsLink(link)) symlinkSync('../elsewhere/target', link);
      await trashPath(link, { platform, home, env: { XDG_DATA_HOME: join(root, 'xdg') }, rename: exdev });
      expect(existsLink(link)).toBe(false);
      const trash = platform === 'darwin' ? join(home, '.Trash') : join(root, 'xdg', 'Trash', 'files');
      expect(readdirSync(trash)).toEqual(['shortcut']);
      expect(readlinkSync(join(trash, 'shortcut'))).toBe('../elsewhere/target');
    }
  });

  it('across devices (EXDEV), a directory lands whole on the name it claimed', async () => {
    const dir = join(root, 'worktree');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'a');
    const exdev = async () => Promise.reject(Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' }));
    await trashPath(dir, { platform: 'darwin', home, env: {}, rename: exdev });
    expect(existsSync(dir)).toBe(false);
    expect(readFileSync(join(home, '.Trash', 'worktree', 'src', 'a.ts'), 'utf8')).toBe('a');
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
