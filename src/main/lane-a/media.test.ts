// A local lane A upload (P5 O9 M7, "Proves"): the checks before anything is written, the walk that follows no link, the
// exclusive create and its extension by signature, the repository's exclude entry, the records and their sweep. Scratch
// directories only (realpath'd: the system temp root is itself a link on macOS), never a real repository or `~`.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitFixture } from '../../../test/support/git-fixture';
import { createGitRunner } from '../git/runner';
import { checkUpload, EXCLUDE_LINE, excludeUploads, removeUpload, rootOf, saveUpload, typeOf, uploadId, uploadRecords, Unsafe, type DecodedFile } from './media';

// A race staged between the walk and a mutation: `node:fs` passes through, but a directory listing first runs the hook
// the test set (once it set one), the way another process could move things the moment after the walk pinned them.
const race = vi.hoisted(() => ({ onList: null as ((path: string) => void) | null }));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  const readdirSync = ((...args: Parameters<typeof fs.readdirSync>) => {
    race.onList?.(String(args[0]));
    return fs.readdirSync(...args);
  }) as typeof fs.readdirSync;
  return { ...fs, default: { ...fs, readdirSync }, readdirSync };
});
const once = (at: string, act: () => void) => {
  race.onList = (path) => {
    if (path !== at) return;
    race.onList = null;
    act();
  };
};

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const PDF = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1');
const SESSION = 'e5b1c0de-0000-4000-8000-000000000001';

const scratch: string[] = [];
const fixtures: GitFixture[] = [];
const dir = (prefix = 'o9m7-') => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratch.push(d);
  return d;
};
afterEach(() => {
  race.onList = null;
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const f of fixtures.splice(0)) f.dispose();
});

// The module as it loads on another platform than macOS (Linux CI): its walk checks each ancestor, then opens with
// O_NOFOLLOW, in place of macOS's O_NOFOLLOW_ANY. On Linux both loads are this one.
async function portableWalk(): Promise<typeof import('./media')> {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'linux' });
  try {
    vi.resetModules();
    return await import('./media');
  } finally {
    Object.defineProperty(process, 'platform', platform);
    vi.resetModules();
  }
}

const file = (name: string, mediaType: string, bytes: Buffer) =>({ name, mediaType, data: bytes.toString('base64') });
const decoded = (files: { name: string; mediaType: string; data: string }[]): DecodedFile[] => {
  const checked = checkUpload(files);
  if (!checked.ok) throw new Error(checked.reason);
  return checked.files;
};

describe('the checks before anything is written', () => {
  it('names each type by its bytes’ signature', () => {
    expect([PNG, JPEG, GIF, WEBP, PDF, Buffer.from('hello')].map(typeOf)).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', null]);
  });

  it('takes one to four images or PDFs whose bytes are what they say', () => {
    const checked = checkUpload([file('shot.png', 'image/png', PNG), file('notes.pdf', 'application/pdf', PDF)]);
    expect(checked).toMatchObject({ ok: true, files: [{ name: 'shot.png', mediaType: 'image/png', ext: 'png' }, { name: 'notes.pdf', mediaType: 'application/pdf', ext: 'pdf' }] });
    expect(checked.ok && checked.files[0]!.bytes.equals(PNG)).toBe(true);
    expect(checkUpload([file('a.jpg', 'image/jpeg', JPEG)])).toMatchObject({ ok: true, files: [{ ext: 'jpg' }] });
  });

  it('refuses no file, a fifth, another type, bytes that are another type, and base64 that is not strict', () => {
    expect(checkUpload([])).toMatchObject({ ok: false, reason: expect.stringContaining('1 to 4') });
    expect(checkUpload(Array.from({ length: 5 }, (_, i) => file(`${i}.png`, 'image/png', PNG)))).toMatchObject({ ok: false, reason: expect.stringContaining('1 to 4') });
    expect(checkUpload([file('a.svg', 'image/svg+xml', PNG)])).toMatchObject({ ok: false, reason: expect.stringContaining('a.svg') });
    expect(checkUpload([file('a.png', 'image/png', JPEG)])).toMatchObject({ ok: false, reason: expect.stringContaining('a.png') });
    expect(checkUpload([{ name: 'a.png', mediaType: 'image/png', data: `${PNG.toString('base64')}!` }])).toMatchObject({ ok: false });
    expect(checkUpload([{ name: 'a.png', mediaType: 'image/png', data: PNG.toString('base64').replace(/=+$/, '') }])).toMatchObject({ ok: false }); // unpadded
  });

  it('refuses an image over 5 MB and a PDF over 32 MB, by name', () => {
    const big = (head: Buffer, size: number) => Buffer.concat([head, Buffer.alloc(size - head.length)]);
    expect(checkUpload([file('big.png', 'image/png', big(PNG, 5 * 1024 * 1024 + 1))])).toMatchObject({ ok: false, reason: expect.stringContaining('big.png') });
    expect(checkUpload([file('ok.png', 'image/png', big(PNG, 5 * 1024 * 1024))])).toMatchObject({ ok: true });
    expect(checkUpload([file('big.pdf', 'application/pdf', big(PDF, 32 * 1024 * 1024 + 1))])).toMatchObject({ ok: false, reason: expect.stringContaining('big.pdf') });
  });

  it('mints an upload id the bridge takes: 16 random bytes, base64url', () => {
    const ids = new Set(Array.from({ length: 50 }, uploadId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe('the save', () => {
  it('writes each file exclusively under <cwd>/.claude/desk-uploads/<session>/ as <upload>.<n>.<ext>, 0600, directories 0700', () => {
    const base = dir();
    const { root, names } = saveUpload(base, SESSION, 'up1', decoded([file('shot.png', 'image/png', PNG), file('notes.pdf', 'application/pdf', PDF)]));
    expect(root).toBe(join(base, '.claude', 'desk-uploads', SESSION));
    expect(root).toBe(rootOf(base, SESSION));
    expect(names).toEqual(['up1.0.png', 'up1.1.pdf']);
    expect(readFileSync(join(root, 'up1.0.png')).equals(PNG)).toBe(true);
    expect(readFileSync(join(root, 'up1.1.pdf')).equals(PDF)).toBe(true);
    expect(statSync(join(root, 'up1.0.png')).mode & 0o777).toBe(0o600);
    expect(statSync(join(base, '.claude', 'desk-uploads')).mode & 0o777).toBe(0o700);
    expect(statSync(root).mode & 0o777).toBe(0o700);
  });

  it('keeps a .claude directory that is already there, and a second upload beside the first', () => {
    const base = dir();
    mkdirSync(join(base, '.claude'));
    writeFileSync(join(base, '.claude', 'settings.json'), '{}');
    saveUpload(base, SESSION, 'up1', decoded([file('a.png', 'image/png', PNG)]));
    saveUpload(base, SESSION, 'up2', decoded([file('b.gif', 'image/gif', GIF)]));
    expect(readdirSync(rootOf(base, SESSION)).sort()).toEqual(['up1.0.png', 'up2.0.gif']);
    expect(readFileSync(join(base, '.claude', 'settings.json'), 'utf8')).toBe('{}');
  });

  it.for([
    ['an ancestor of the working directory', (base: string) => {
      const real = join(base, 'real');
      mkdirSync(join(real, 'sub'), { recursive: true });
      symlinkSync(real, join(base, 'via'));
      return join(base, 'via', 'sub');
    }],
    ['.claude', (base: string) => {
      const elsewhere = dir('o9m7-elsewhere-');
      symlinkSync(elsewhere, join(base, '.claude'));
      return base;
    }],
    ['desk-uploads', (base: string) => {
      mkdirSync(join(base, '.claude'));
      symlinkSync(dir('o9m7-elsewhere-'), join(base, '.claude', 'desk-uploads'));
      return base;
    }],
    ['the session’s directory', (base: string) => {
      mkdirSync(join(base, '.claude', 'desk-uploads'), { recursive: true });
      symlinkSync(dir('o9m7-elsewhere-'), join(base, '.claude', 'desk-uploads', SESSION));
      return base;
    }],
    ['a file’s own name', (base: string) => {
      mkdirSync(rootOf(base, SESSION), { recursive: true });
      symlinkSync(join(dir('o9m7-elsewhere-'), 'target.png'), join(rootOf(base, SESSION), 'up1.0.png'));
      return base;
    }],
  ] as const)('refuses a link at %s, and writes nothing through it (both walks)', async ([, plant]) => {
    for (const media of [await import('./media'), await portableWalk()]) {
      const base = dir();
      const cwd = plant(base);
      expect(() => media.saveUpload(cwd, SESSION, 'up1', decoded([file('a.png', 'image/png', PNG)]))).toThrow(media.Unsafe);
      for (const d of scratch) {
        const walk = (p: string): string[] => (lstatSync(p).isDirectory() && !lstatSync(p).isSymbolicLink() ? readdirSync(p).flatMap((n) => walk(join(p, n))) : [p]);
        expect(walk(d).filter((p) => p.endsWith('.png') && lstatSync(p).isFile())).toEqual([]);
      }
    }
  });

  it('saves through the portable walk as through the native one', async () => {
    const media = await portableWalk();
    const base = dir();
    expect(media.saveUpload(base, SESSION, 'up1', decoded([file('a.png', 'image/png', PNG)])).names).toEqual(['up1.0.png']);
    expect(readFileSync(join(rootOf(base, SESSION), 'up1.0.png')).equals(PNG)).toBe(true);
  });

  it('refuses a directory component that is a file', () => {
    const base = dir();
    writeFileSync(join(base, '.claude'), 'not a directory');
    expect(() => saveUpload(base, SESSION, 'up1', decoded([file('a.png', 'image/png', PNG)]))).toThrow(Unsafe);
  });

  it('refuses a name already there, and takes back only the files this upload made', () => {
    const base = dir();
    const root = rootOf(base, SESSION);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'up1.1.pdf'), 'someone else’s');
    expect(() => saveUpload(base, SESSION, 'up1', decoded([file('a.png', 'image/png', PNG), file('b.pdf', 'application/pdf', PDF)]))).toThrow(Unsafe);
    expect(readdirSync(root)).toEqual(['up1.1.pdf']);
    expect(readFileSync(join(root, 'up1.1.pdf'), 'utf8')).toBe('someone else’s');
  });

  it('removes an upload’s files, then its directory once empty, and nothing through a link', () => {
    const base = dir();
    const { root } = saveUpload(base, SESSION, 'up1', decoded([file('a.png', 'image/png', PNG), file('b.pdf', 'application/pdf', PDF)]));
    saveUpload(base, SESSION, 'up2', decoded([file('c.png', 'image/png', PNG)]));
    removeUpload(root, ['up1.0.png', 'up1.1.pdf']);
    expect(readdirSync(root)).toEqual(['up2.0.png']);
    removeUpload(root);
    expect(existsSync(root)).toBe(false);

    // the recorded path's ancestor became a link since: nothing behind it is touched
    const other = dir();
    const kept = saveUpload(other, SESSION, 'up3', decoded([file('d.png', 'image/png', PNG)]));
    const moved = join(dir(), 'moved');
    symlinkSync(other, moved);
    expect(removeUpload(join(moved, '.claude', 'desk-uploads', SESSION))).toBe(false);
    expect(readdirSync(kept.root)).toEqual(['up3.0.png']);
  });

  it('refuses a removal whose root was swapped for a link after the walk pinned it, touching nothing outside the tree', () => {
    const base = dir();
    const { root } = saveUpload(base, SESSION, 'up1', decoded([file_('a.png')]));
    const outside = dir('o9m7-outside-');
    writeFileSync(join(outside, 'up9.0.png'), 'sentinel');
    once(root, () => {
      renameSync(root, `${root}.moved`);
      symlinkSync(outside, root);
    });
    const removed = removeUpload(root);
    expect(existsSync(join(outside, 'up9.0.png')), 'nothing outside the tree is touched').toBe(true);
    expect(removed).toBe(false);
    expect(readdirSync(`${root}.moved`)).toEqual(['up1.0.png']);
  });

  it('refuses to unlink a file swapped for a link, or anything that is no regular file, and leaves it', () => {
    const base = dir();
    const { root } = saveUpload(base, SESSION, 'up1', decoded([file_('a.png'), file_('b.png')]));
    const target = join(dir('o9m7-outside-'), 'target');
    writeFileSync(target, 'sentinel');
    execFileSync('/usr/bin/mkfifo', [join(root, 'up2.0.png')]);
    once(root, () => {
      rmSync(join(root, 'up1.0.png'));
      symlinkSync(target, join(root, 'up1.0.png'));
    });
    expect(removeUpload(root)).toBe(false);
    expect(readFileSync(target, 'utf8')).toBe('sentinel');
    expect(lstatSync(join(root, 'up1.0.png')).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(root, 'up2.0.png')).isFIFO()).toBe(true);
    expect(existsSync(join(root, 'up1.1.png'))).toBe(false); // the regular one went
  });

  it('removes only upload files and never recurses: another name or a directory in the root stays, and so does the root', () => {
    const base = dir();
    const { root } = saveUpload(base, SESSION, 'up1', decoded([file_('a.png')]));
    writeFileSync(join(root, 'notes.txt'), 'kept');
    mkdirSync(join(root, 'up2.0.png'));
    writeFileSync(join(root, 'up2.0.png', 'inside'), 'kept');
    expect(removeUpload(root)).toBe(false); // the directory named like an upload file is no regular file
    expect(readdirSync(root).sort()).toEqual(['notes.txt', 'up2.0.png']);
    expect(readFileSync(join(root, 'up2.0.png', 'inside'), 'utf8')).toBe('kept');
  });
});

describe('the exclude entry', () => {
  async function repo(): Promise<GitFixture> {
    const f = await GitFixture.create();
    fixtures.push(f);
    return f;
  }
  const exclude = (f: GitFixture) => join(f.root, '.git', 'info', 'exclude');

  it('adds the line to the repository’s common info/exclude once, on a line of its own', async () => {
    const f = await repo();
    const git = createGitRunner({ env: f.serviceEnv() });
    writeFileSync(exclude(f), '# mine\n*.log'); // no final newline
    expect(await excludeUploads(f.root, git)).toBe(true);
    expect(await excludeUploads(f.root, git)).toBe(true);
    expect(readFileSync(exclude(f), 'utf8')).toBe(`# mine\n*.log\n${EXCLUDE_LINE}\n`);
    saveUpload(f.root, SESSION, 'up1', decoded([file('a.png', 'image/png', PNG)]));
    expect(await f.git('status', '--porcelain', '--untracked-files=all')).toBe(''); // the upload never shows
  });

  it('reaches the common exclude from a linked worktree, and from a subdirectory', async () => {
    const f = await repo();
    const git = createGitRunner({ env: f.serviceEnv() });
    rmSync(exclude(f), { force: true });
    const worktree = await f.addWorktree('wt');
    mkdirSync(join(worktree, 'sub'));
    expect(await excludeUploads(join(worktree, 'sub'), git)).toBe(true);
    expect(readFileSync(exclude(f), 'utf8')).toBe(`${EXCLUDE_LINE}\n`);
  });

  it('answers false outside a repository', async () => {
    const git = createGitRunner({ env: { PATH: process.env.PATH, HOME: dir() } });
    expect(await excludeUploads(dir(), git)).toBe(false);
  });

  it('refuses a linked exclude, a linked info and an exclude that is no regular file', async () => {
    const f = await repo();
    const git = createGitRunner({ env: f.serviceEnv() });
    const target = join(dir(), 'target');
    writeFileSync(target, 'kept\n');
    rmSync(exclude(f), { force: true });
    symlinkSync(target, exclude(f));
    await expect(excludeUploads(f.root, git)).rejects.toThrow(Unsafe);
    expect(readFileSync(target, 'utf8')).toBe('kept\n');

    rmSync(exclude(f));
    mkdirSync(exclude(f));
    await expect(excludeUploads(f.root, git)).rejects.toThrow(Unsafe);

    const info = join(f.root, '.git', 'info');
    rmSync(info, { recursive: true });
    const elsewhere = dir();
    symlinkSync(elsewhere, info);
    await expect(excludeUploads(f.root, git)).rejects.toThrow(Unsafe);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it('refuses an exclude that is a socket or a FIFO, which fail the open itself', async () => {
    const f = await repo();
    const git = createGitRunner({ env: f.serviceEnv() });
    rmSync(exclude(f), { force: true });
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(exclude(f), resolve));
    try {
      await expect(excludeUploads(f.root, git)).rejects.toThrow(Unsafe);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    rmSync(exclude(f), { force: true });
    execFileSync('/usr/bin/mkfifo', [exclude(f)]);
    await expect(excludeUploads(f.root, git)).rejects.toThrow(Unsafe);
  });
});

describe('the records and the sweep', () => {
  it('records each root before the save, refreshes it, and sweeps a root a day old, keeping a younger one', () => {
    const data = dir();
    const file = join(data, 'lane-a', 'uploads.json');
    let now = Date.parse('2026-10-28T10:00:00Z');
    const records = uploadRecords(file, { now: () => now, log: () => {} });
    const [old, young] = [dir(), dir()];
    const oldRoot = saveUpload(old, SESSION, 'up1', decoded([file_('a.png')])).root;
    records.record(SESSION, oldRoot);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, roots: [{ path: oldRoot, session: SESSION, at: '2026-10-28T10:00:00.000Z' }] });
    expect(statSync(file).mode & 0o777).toBe(0o600);

    now += 20 * 3600_000;
    const youngRoot = saveUpload(young, SESSION, 'up2', decoded([file_('b.png')])).root;
    records.record(SESSION, youngRoot);
    now += 5 * 3600_000; // the first is 25 h old, the second 5 h
    expect(records.sweep()).toBe(1);
    expect(existsSync(oldRoot)).toBe(false);
    expect(readdirSync(youngRoot)).toEqual(['up2.0.png']);
    expect(JSON.parse(readFileSync(file, 'utf8')).roots.map((r: { path: string }) => r.path)).toEqual([youngRoot]);

    records.record(SESSION, youngRoot); // a later upload to the same root keeps it another day
    now += 23 * 3600_000;
    expect(records.sweep()).toBe(0);
    expect(existsSync(youngRoot)).toBe(true);
  });

  it('leaves a root whose ancestor became a link, touching nothing behind the link, and keeps its record for a later pass', () => {
    const data = dir();
    let now = 0;
    const records = uploadRecords(join(data, 'uploads.json'), { now: () => now, log: () => {} });
    const real = dir();
    const kept = saveUpload(real, SESSION, 'up1', decoded([file_('a.png')])).root;
    const parent = dir();
    symlinkSync(real, join(parent, 'checkout'));
    const linked = join(parent, 'checkout', '.claude', 'desk-uploads', SESSION);
    records.record(SESSION, linked);
    now += 25 * 3600_000;
    expect(records.sweep()).toBe(0);
    expect(readdirSync(kept)).toEqual(['up1.0.png']);
    expect(JSON.parse(readFileSync(join(data, 'uploads.json'), 'utf8')).roots.map((r: { path: string }) => r.path)).toEqual([linked]);
  });

  it('refuses a sweep whose root was swapped for a link after its checked open, deleting nothing outside the tree, and keeps the record', () => {
    const data = dir();
    let now = 0;
    const records = uploadRecords(join(data, 'uploads.json'), { now: () => now, log: () => {} });
    const { root } = saveUpload(dir(), SESSION, 'up1', decoded([file_('a.png')]));
    records.record(SESSION, root);
    const outside = dir('o9m7-outside-');
    writeFileSync(join(outside, 'up9.0.png'), 'sentinel');
    once(root, () => {
      renameSync(root, `${root}.moved`);
      symlinkSync(outside, root);
    });
    now += 25 * 3600_000;
    expect(records.sweep()).toBe(0);
    expect(readFileSync(join(outside, 'up9.0.png'), 'utf8')).toBe('sentinel');
    expect(readdirSync(outside)).toEqual(['up9.0.png']);
    expect(JSON.parse(readFileSync(join(data, 'uploads.json'), 'utf8')).roots.map((r: { path: string }) => r.path)).toEqual([root]);
    expect(records.sweep(), 'the root still a link on the next pass: refused again, before any listing').toBe(0);
    expect(readdirSync(outside)).toEqual(['up9.0.png']);
  });

  it('drops the record of a root already gone', () => {
    const data = dir();
    let now = 0;
    const records = uploadRecords(join(data, 'uploads.json'), { now: () => now, log: () => {} });
    records.record(SESSION, join(dir(), 'gone', '.claude', 'desk-uploads', SESSION));
    now += 25 * 3600_000;
    expect(records.sweep()).toBe(1);
    expect(JSON.parse(readFileSync(join(data, 'uploads.json'), 'utf8')).roots).toEqual([]);
  });

  it('starts empty from a missing or unreadable file', () => {
    const data = dir();
    writeFileSync(join(data, 'uploads.json'), 'not json');
    const records = uploadRecords(join(data, 'uploads.json'), { log: () => {} });
    expect(records.sweep()).toBe(0);
    expect(uploadRecords(join(data, 'none.json'), { log: () => {} }).sweep()).toBe(0);
  });
});

const file_ = (name: string) => file(name, 'image/png', PNG);
