// P5 O2 M3 (acceptance 9; RL §5.11): a local socket's directory and the socket itself are checked by `lstat` before a
// listen, a token read or a connect. Real files for the symlinks and modes; a foreign owner through an injected lstat.
import * as fs from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertPrivateDirectory, assertPrivateSocket, PrivatePathError } from './private-path';

let root: string;
let servers: Server[];

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'maws-pp-'));
  servers = [];
});

afterEach(async () => {
  for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});

function privateDir(name: string): string {
  const dir = join(root, name);
  fs.mkdirSync(dir, { mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}

async function listening(path: string): Promise<string> {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(path, () => resolve()));
  return path;
}

function refusal(check: () => void): PrivatePathError {
  try {
    check();
  } catch (error) {
    if (error instanceof PrivatePathError) return error;
    throw error;
  }
  throw new Error('the path was not refused');
}

// What lstat would say of a path another uid owns, everything else the real file's.
const ownedBy = (uid: number) => ((path: fs.PathLike) => Object.assign(fs.lstatSync(path), { uid })) as typeof fs.lstatSync;

describe('assertPrivateDirectory', () => {
  it('accepts a 0700 directory the process owns', () => {
    expect(() => assertPrivateDirectory(privateDir('d'))).not.toThrow();
  });

  it('refuses a symlink to a private directory, naming the path', () => {
    const target = privateDir('target');
    const link = join(root, 'link');
    fs.symlinkSync(target, link);
    const error = refusal(() => assertPrivateDirectory(link));
    expect(error).toMatchObject({ path: link, reason: 'symlink' });
    expect(error.message).toContain(link);
    expect(error.message).toContain('is a symlink');
  });

  it('refuses a directory more open than 0700', () => {
    const dir = privateDir('open');
    fs.chmodSync(dir, 0o755);
    const error = refusal(() => assertPrivateDirectory(dir));
    expect(error).toMatchObject({ path: dir, reason: 'mode' });
    expect(error.message).toContain('0755');
  });

  it('refuses a directory another uid owns', () => {
    const dir = privateDir('foreign');
    const uid = (process.getuid?.() ?? 0) + 1;
    expect(refusal(() => assertPrivateDirectory(dir, { lstat: ownedBy(uid) }))).toMatchObject({ path: dir, reason: 'owner' });
    expect(() => assertPrivateDirectory(dir, { lstat: ownedBy(uid), uid })).not.toThrow();
  });

  it('refuses a path that is not a directory, and lets a missing one throw as lstat does', () => {
    const file = join(root, 'file');
    fs.writeFileSync(file, '');
    expect(refusal(() => assertPrivateDirectory(file))).toMatchObject({ path: file, reason: 'not_directory' });
    expect(() => assertPrivateDirectory(join(root, 'missing'))).toThrow(expect.objectContaining({ code: 'ENOENT' }));
  });
});

describe('assertPrivateSocket', () => {
  it('accepts a socket the process owns in a private directory', async () => {
    const path = await listening(join(privateDir('s'), 'a.sock'));
    expect(() => assertPrivateSocket(path)).not.toThrow();
  });

  it('refuses a symlink to a socket, naming the path', async () => {
    const dir = privateDir('s');
    const real = await listening(join(dir, 'real.sock'));
    const link = join(dir, 'link.sock');
    fs.symlinkSync(real, link);
    expect(refusal(() => assertPrivateSocket(link))).toMatchObject({ path: link, reason: 'symlink' });
  });

  it('refuses a socket another uid owns, and a path that is not a socket', async () => {
    const dir = privateDir('s');
    const path = await listening(join(dir, 'a.sock'));
    const uid = (process.getuid?.() ?? 0) + 1;
    // the socket's owner is read first: a foreign directory would be refused too
    expect(refusal(() => assertPrivateSocket(path, { lstat: ownedBy(uid) }))).toMatchObject({ path, reason: 'owner' });
    const file = join(dir, 'file');
    fs.writeFileSync(file, '');
    expect(refusal(() => assertPrivateSocket(file))).toMatchObject({ path: file, reason: 'not_socket' });
  });

  it('refuses a socket whose directory is not private: open, or a symlink', async () => {
    const open = privateDir('open');
    const path = await listening(join(open, 'a.sock'));
    fs.chmodSync(open, 0o755);
    expect(refusal(() => assertPrivateSocket(path))).toMatchObject({ path: open, reason: 'mode' });
    const target = privateDir('target');
    const real = await listening(join(target, 'b.sock'));
    const linked = join(root, 'linked');
    fs.symlinkSync(target, linked);
    expect(real).toBe(join(target, 'b.sock'));
    expect(refusal(() => assertPrivateSocket(join(linked, 'b.sock')))).toMatchObject({ path: linked, reason: 'symlink' });
  });

  it('lets a missing socket throw as lstat does (nothing listens)', () => {
    expect(() => assertPrivateSocket(join(privateDir('s'), 'none.sock'))).toThrow(expect.objectContaining({ code: 'ENOENT' }));
  });
});
