// P5 O2 M3: the listening side of private paths: a host's directory created 0700 when missing and refused otherwise,
// and a socket path cleared only when it holds nothing or this uid's stale socket.
import * as fs from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSocketPath, makePrivateDirectory } from './private-listen';
import { PrivatePathError } from './private-path';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'maws-pl-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// A socket this uid owns at the path (whether its listener lives is the lock's to say, not this check's).
async function ownSocket(path: string): Promise<() => Promise<void>> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(path, () => resolve()));
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('makePrivateDirectory', () => {
  it('creates a missing directory 0700, and checks an existing one without correcting it', () => {
    const dir = join(root, 'a', 'b');
    makePrivateDirectory(dir);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    fs.chmodSync(dir, 0o755);
    expect(() => makePrivateDirectory(dir)).toThrow(PrivatePathError);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o755);
  });

  it('refuses a symlink in its place', () => {
    const target = join(root, 'target');
    fs.mkdirSync(target, { mode: 0o700 });
    const link = join(root, 'link');
    fs.symlinkSync(target, link);
    expect(() => makePrivateDirectory(link)).toThrow(`${link} is a symlink`);
  });
});

describe('clearSocketPath', () => {
  it('passes a path with nothing there, and unlinks a socket this uid owns', async () => {
    const dir = join(root, 's');
    makePrivateDirectory(dir);
    const path = join(dir, 'host.sock');
    expect(() => clearSocketPath(path)).not.toThrow();
    const close = await ownSocket(path);
    expect(fs.lstatSync(path).isSocket()).toBe(true);
    clearSocketPath(path);
    expect(fs.existsSync(path)).toBe(false);
    await close();
  });

  it('refuses a symlink, a regular file and a directory, leaving each in place', () => {
    const dir = join(root, 's');
    makePrivateDirectory(dir);
    const elsewhere = join(root, 'elsewhere');
    fs.writeFileSync(elsewhere, 'keep');
    const link = join(dir, 'link.sock');
    fs.symlinkSync(elsewhere, link);
    expect(() => clearSocketPath(link)).toThrow(`${link} is a symlink`);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    const file = join(dir, 'file.sock');
    fs.writeFileSync(file, '');
    expect(() => clearSocketPath(file)).toThrow(`${file} is not a socket`);
    expect(fs.existsSync(file)).toBe(true);
    const sub = join(dir, 'dir.sock');
    fs.mkdirSync(sub);
    expect(() => clearSocketPath(sub)).toThrow(PrivatePathError);
    expect(fs.existsSync(sub)).toBe(true);
  });
});
