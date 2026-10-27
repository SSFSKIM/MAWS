import * as fs from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertPrivateDirectory, assertPrivateSocket, PrivatePathError } from './private-path';

let root: string;
const servers: Server[] = [];
beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'private-path-'));
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
  fs.rmSync(root, { recursive: true, force: true });
});

const privateDir = (name = 'd') => {
  const dir = join(root, name);
  fs.mkdirSync(dir, { mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
};
const reasonOf = (run: () => void) => {
  try {
    run();
  } catch (error) {
    if (error instanceof PrivatePathError) return { reason: error.reason, path: error.path, message: error.message };
    throw error;
  }
  return null;
};
const listen = async (path: string) => {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((done) => server.listen(path, done));
};

describe('assertPrivateDirectory', () => {
  it('accepts a 0700 directory the uid owns', () => {
    expect(reasonOf(() => assertPrivateDirectory(privateDir()))).toBeNull();
  });

  it('refuses a symlink to a private directory, naming the path', () => {
    const link = join(root, 'link');
    fs.symlinkSync(privateDir(), link);
    expect(reasonOf(() => assertPrivateDirectory(link))).toMatchObject({ reason: 'symlink', path: link });
  });

  it('refuses a 0755 directory and a file', () => {
    const open = privateDir('open');
    fs.chmodSync(open, 0o755);
    expect(reasonOf(() => assertPrivateDirectory(open))?.reason).toBe('mode');
    const file = join(root, 'file');
    fs.writeFileSync(file, '', { mode: 0o600 });
    expect(reasonOf(() => assertPrivateDirectory(file))?.reason).toBe('not_directory');
  });

  it('refuses a directory another uid owns', () => {
    const dir = privateDir();
    const lstat = ((path: fs.PathLike) => ({ ...fs.lstatSync(path), isSymbolicLink: () => false, isDirectory: () => true, uid: 4242, mode: 0o40700 })) as unknown as typeof fs.lstatSync;
    expect(reasonOf(() => assertPrivateDirectory(dir, { lstat }))?.reason).toBe('owner');
    expect(reasonOf(() => assertPrivateDirectory(dir, { uid: 4242 }))?.reason).toBe('owner');
  });
});

describe('assertPrivateSocket', () => {
  it('accepts a socket the uid owns in a private directory', async () => {
    const path = join(privateDir(), 's.sock');
    await listen(path);
    expect(reasonOf(() => assertPrivateSocket(path))).toBeNull();
  });

  it('refuses a symlinked socket, a file, and a socket in an open directory', async () => {
    const dir = privateDir();
    const path = join(dir, 's.sock');
    await listen(path);
    const link = join(dir, 'link.sock');
    fs.symlinkSync(path, link);
    expect(reasonOf(() => assertPrivateSocket(link))?.reason).toBe('symlink');
    const file = join(dir, 'file');
    fs.writeFileSync(file, '');
    expect(reasonOf(() => assertPrivateSocket(file))?.reason).toBe('not_socket');
    fs.chmodSync(dir, 0o755);
    expect(reasonOf(() => assertPrivateSocket(path))).toMatchObject({ reason: 'mode', path: dir });
  });

  it('refuses a socket another uid owns', async () => {
    const path = join(privateDir(), 's.sock');
    await listen(path);
    expect(reasonOf(() => assertPrivateSocket(path, { uid: 4242 }))?.reason).toBe('owner');
  });
});
