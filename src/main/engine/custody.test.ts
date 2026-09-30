// C12 M4: MAWS's custody of the pinned engine (C12 execution document, Interfaces "Engine custody"). Real files under a
// temp directory: the "binary" is a small shell script that answers `--version` the way Claude Code does
// (`2.1.283 (Claude Code)`), so the copy, the `--version` check by absolute path, the hash and the manifest are the real
// ones; only the installer's directory is a scratch one.
import { createHash } from 'node:crypto';
import { constants, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { custodyPath, custodyRefusal, custodySourceDir, ensureCustody, type Custody } from './custody';

const VERSION = '2.1.283';
const binary = (answers: string, padding = '') => `#!/bin/sh\necho "${answers} (Claude Code)"\n# ${padding}\n`;
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

let root: string;
let userData: string;
let sourceDir: string;
const install = (content = binary(VERSION), version = VERSION) => {
  mkdirSync(sourceDir, { recursive: true });
  const path = join(sourceDir, version);
  writeFileSync(path, content);
  chmodSync(path, 0o755);
  return path;
};
const log = vi.fn();
const ensure = (version = VERSION, deps: Parameters<typeof ensureCustody>[1] = {}) => ensureCustody({ userData, version, sourceDir }, { log, now: () => '2026-09-29T12:00:00.000Z', ...deps });

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-c12-custody-unit-')));
  userData = join(root, 'userData');
  sourceDir = join(root, 'source');
  mkdirSync(userData);
  log.mockReset();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the custody copy', () => {
  it('lives at <userData>/engine/<version>/claude', () => {
    expect(custodyPath('/u', '2.1.283')).toBe('/u/engine/2.1.283/claude');
  });

  it('a first start copies the installed binary (a clone where the volume allows), executable, beside a manifest with its SHA-256', async () => {
    const source = install();
    const copy = vi.fn((from: string, to: string, mode: number) => copyFile(from, to, mode));
    const custody = await ensure(VERSION, { copyFile: copy });
    const path = custodyPath(userData, VERSION);
    expect(custody).toEqual({
      state: 'ok',
      path,
      manifest: { version: VERSION, sha256: sha256(source), size: statSync(source).size, source, copiedAt: '2026-09-29T12:00:00.000Z' },
    });
    expect(copy).toHaveBeenCalledOnce();
    expect(copy.mock.calls[0]![2]).toBe(constants.COPYFILE_FICLONE); // an APFS clone on one volume, a full copy otherwise
    expect(readFileSync(path, 'utf8')).toBe(readFileSync(source, 'utf8'));
    expect(statSync(path).mode & 0o777).toBe(0o755);
    expect(JSON.parse(readFileSync(join(userData, 'engine', VERSION, 'manifest.json'), 'utf8'))).toEqual(custody.state === 'ok' && custody.manifest);
    expect(readFileSync(source, 'utf8')).toBe(binary(VERSION)); // the source is only read
  });

  it('a later start verifies the copy against its manifest and copies nothing, even with the source gone', async () => {
    install();
    const first = await ensure();
    rmSync(sourceDir, { recursive: true });
    const copy = vi.fn();
    expect(await ensure(VERSION, { copyFile: copy })).toEqual(first);
    expect(copy).not.toHaveBeenCalled();
  });

  it('a copy whose bytes changed is made again from a source that verifies, and the manifest rewritten (logged)', async () => {
    install();
    await ensure();
    const path = custodyPath(userData, VERSION);
    writeFileSync(path, binary(VERSION, 'altered'));
    const custody = await ensure();
    expect(custody).toMatchObject({ state: 'ok' });
    expect(sha256(path)).toBe(sha256(join(sourceDir, VERSION)));
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('did not match its manifest; made again from'));
  });

  it('a deleted copy is made again from the source', async () => {
    install();
    await ensure();
    rmSync(join(userData, 'engine'), { recursive: true });
    expect(await ensure()).toMatchObject({ state: 'ok', path: custodyPath(userData, VERSION) });
  });

  it('a copy with no manifest (a start cut short after the rename) is made again from the source', async () => {
    install();
    await ensure();
    rmSync(join(userData, 'engine', VERSION, 'manifest.json'));
    expect(await ensure()).toMatchObject({ state: 'ok' });
    expect(existsSync(join(userData, 'engine', VERSION, 'manifest.json'))).toBe(true);
  });

  // review fix: a read failure while verifying is a verdict, never a rejection out of ensureCustody
  it('a copy that cannot be read is treated as altered: made again from the source, else refused as mismatch', async () => {
    install();
    await ensure();
    const path = custodyPath(userData, VERSION);
    chmodSync(path, 0o000);
    expect(await ensure()).toMatchObject({ state: 'ok' });
    expect(sha256(path)).toBe(sha256(join(sourceDir, VERSION)));
    chmodSync(path, 0o000);
    rmSync(sourceDir, { recursive: true });
    expect(await ensure()).toMatchObject({ state: 'mismatch', path });
    chmodSync(path, 0o755);
  });

  it('a copy that vanishes between its stat and its hash reads as missing', async () => {
    install();
    await ensure();
    rmSync(sourceDir, { recursive: true });
    const path = custodyPath(userData, VERSION);
    const sha256Of = vi.fn(async (p: string) => {
      rmSync(p);
      throw Object.assign(new Error(`ENOENT: no such file, open '${p}'`), { code: 'ENOENT' });
    });
    expect(await ensure(VERSION, { sha256Of })).toMatchObject({ state: 'missing', path });
  });

  it('a read-stream error with the copy still there reads as altered', async () => {
    install();
    await ensure();
    rmSync(sourceDir, { recursive: true });
    const sha256Of = vi.fn(async () => {
      throw new Error('EIO: i/o error, read');
    });
    expect(await ensure(VERSION, { sha256Of })).toMatchObject({ state: 'mismatch' });
  });

  it('leaves no temporary file behind', async () => {
    install();
    await ensure();
    expect(readdir(join(userData, 'engine', VERSION))).toEqual(['claude', 'manifest.json']);
  });
});

describe('the refusals and their message', () => {
  const fix = (version = VERSION) => `Reinstall Claude Code ${version} (it belongs at ${join(sourceDir, version)}) and restart MAWS, or choose a binary path in Settings › Engine.`;

  it('missing: neither a copy nor a source', async () => {
    const custody = await ensure();
    const path = custodyPath(userData, VERSION);
    expect(custody).toEqual({ state: 'missing', path, message: `Claude Code ${VERSION} is missing from MAWS's copy at ${path}. ${fix()}` });
  });

  it('mismatch: the copy was altered and no source is left to copy from', async () => {
    install();
    await ensure();
    rmSync(sourceDir, { recursive: true });
    const path = custodyPath(userData, VERSION);
    const bytes = readFileSync(path);
    bytes[20] = bytes[20]! ^ 1; // one byte
    writeFileSync(path, bytes);
    expect(await ensure()).toEqual({ state: 'mismatch', path, message: `Claude Code ${VERSION} has been altered in MAWS's copy at ${path}. ${fix()}` });
  });

  it('version: the only binary to copy from answers another version, so nothing is copied', async () => {
    install(binary('2.1.290'));
    const path = custodyPath(userData, VERSION);
    expect(await ensure()).toEqual({ state: 'version', path, message: `Claude Code ${VERSION} answers a different version (2.1.290), so MAWS's copy at ${path} was not made. ${fix()}` });
    expect(existsSync(path)).toBe(false);
    expect(readdir(join(userData, 'engine', VERSION))).toEqual([]); // the temporary copy is gone too
  });

  it('a source that does not answer --version is not copied', async () => {
    install('#!/bin/sh\nexit 3\n');
    expect(await ensure()).toMatchObject({ state: 'version', message: expect.stringContaining('answers a different version (none)') });
  });

  it('names the installer under ~ when the source is in the home directory', async () => {
    const absent = '0.0.0-maws-unit'; // no such version is ever installed, so the installer's directory is not even read
    const custody = await ensureCustody({ userData, version: absent, sourceDir: join(homedir(), '.local/share/claude/versions') }, { log });
    expect(custody).toMatchObject({ state: 'missing', message: expect.stringContaining(`(it belongs at ~/.local/share/claude/versions/${absent})`) });
  });

  it('answers the launch’s refused shape: binary_missing for missing, binary_version for mismatch and version; nothing for ok', () => {
    const refused = (state: 'missing' | 'mismatch' | 'version'): Custody => ({ state, path: '/p', message: `m-${state}` });
    expect(custodyRefusal(refused('missing'))).toEqual({ status: 'refused', reason: 'binary_missing', message: 'm-missing' });
    expect(custodyRefusal(refused('mismatch'))).toEqual({ status: 'refused', reason: 'binary_version', message: 'm-mismatch' });
    expect(custodyRefusal(refused('version'))).toEqual({ status: 'refused', reason: 'binary_version', message: 'm-version' });
    expect(custodyRefusal({ state: 'ok', path: '/p', manifest: { version: VERSION, sha256: 'x', size: 1, source: '/s', copiedAt: 't' } })).toBeNull();
  });
});

describe('where custody copies from, and when it runs at all', () => {
  const INSTALLER = '/Users/new/.local/share/claude/versions';
  it('the installer’s directory (C3’s ENGINE_BIN’s) in the product', () => {
    expect(custodySourceDir({}, true)).toBe(INSTALLER);
    expect(custodySourceDir({}, false)).toBe(INSTALLER);
  });

  it('not at all under MAWS_E2E or MAWS_ENGINE_REPLAY: the host keeps ENGINE_BIN', () => {
    expect(custodySourceDir({ MAWS_E2E: '1' }, false)).toBeNull();
    expect(custodySourceDir({ MAWS_ENGINE_REPLAY: '1' }, false)).toBeNull();
    expect(custodySourceDir({ MAWS_E2E: '1' }, true)).toBeNull();
  });

  it('MAWS_ENGINE_SOURCE_DIR opts an unpackaged run in, against that directory, and is refused when packaged', () => {
    expect(custodySourceDir({ MAWS_E2E: '1', MAWS_ENGINE_SOURCE_DIR: '/private/tmp/s/source' }, false)).toBe('/private/tmp/s/source');
    expect(custodySourceDir({ MAWS_E2E: '1', MAWS_ENGINE_SOURCE_DIR: '/private/tmp/s/source' }, true)).toBeNull();
    expect(custodySourceDir({ MAWS_ENGINE_SOURCE_DIR: '/private/tmp/s/source' }, true)).toBe(INSTALLER);
    expect(custodySourceDir({ MAWS_E2E: '1', MAWS_ENGINE_SOURCE_DIR: 'relative/source' }, false)).toBeNull(); // never a relative path
  });

  it('an invalid override is ignored, never a bypass: an ordinary run keeps the installer source (review fix)', () => {
    expect(custodySourceDir({ MAWS_ENGINE_SOURCE_DIR: './source' }, false)).toBe(INSTALLER);
    expect(custodySourceDir({ MAWS_ENGINE_SOURCE_DIR: 'relative/source' }, false)).toBe(INSTALLER);
    expect(custodySourceDir({ MAWS_ENGINE_SOURCE_DIR: '' }, false)).toBe(INSTALLER);
  });
});

function readdir(path: string): string[] {
  return existsSync(path) ? readdirSync(path).sort() : [];
}
