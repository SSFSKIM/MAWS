// W13 (charter D-1 as amended 2026-10-01): the binary a launch runs is resolved at every call (the chosen path, else
// MAWS_E2E's named binary, else ~/.local/bin/claude, else `claude` on the login shell's PATH), answered by its real path,
// and probed for its version once per file, in the login shell's environment; no version refuses but a missing one.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBinaryProbe, INSTALLED_LINK } from './binary-info';
import { TESTED_ENGINE_VERSION } from './engine-compat';
import { setBinaryConfig } from './launch';
import { ENGINE_VERSION } from '../../test/support/engine-pin';

let root: string;
let home: string;
let log: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-binary-'))); // /var is /private/var: the probe answers real paths
  home = join(root, 'home');
  log = join(root, 'runs.log');
  mkdirSync(join(home, '.local/bin'), { recursive: true });
});
afterEach(() => {
  setBinaryConfig({ binaryPath: null });
  rmSync(root, { recursive: true, force: true });
});

// An engine stand-in: prints its version (or `output`) and logs each run.
function engine(path: string, output: string): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `#!/bin/sh\necho "${path}" >> "${log}"\necho "${output}"\n`);
  chmodSync(path, 0o755);
  return path;
}
const runs = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
const version = (v: string) => join(home, '.local/share/claude/versions', v);
const link = (target: string) => {
  const at = join(home, INSTALLED_LINK);
  rmSync(at, { force: true }); // the link itself, never its target
  symlinkSync(target, at);
};
const probeWith = (o: { env?: Record<string, string>; captureEnv?: () => Promise<Record<string, string>> } = {}) =>
  createBinaryProbe({ home, env: o.env ?? {}, captureEnv: o.captureEnv ?? (async () => ({ PATH: '/usr/bin:/bin' })) });

describe('engine.binaryInfo resolves the installed Claude Code at every call', () => {
  it('follows ~/.local/bin/claude to its real path and version; a flipped link is followed at the next call', async () => {
    const v287 = engine(version('2.1.287'), '2.1.287 (Claude Code)');
    const v288 = engine(version('2.1.288'), '2.1.288 (Claude Code)');
    link(v287);
    const probe = probeWith();
    expect(await probe()).toEqual({ path: v287, testedVersion: TESTED_ENGINE_VERSION, version: '2.1.287', ok: true, error: null });
    link(v288);
    expect(await probe()).toMatchObject({ path: v288, version: '2.1.288', ok: true });
  });

  it('runs --version once per file, by real path, and again when the file changes in place', async () => {
    const v287 = engine(version('2.1.287'), '2.1.287 (Claude Code)');
    link(v287);
    const probe = probeWith();
    await probe();
    await probe();
    expect(runs()).toEqual([v287]);
    writeFileSync(v287, `#!/bin/sh\necho "${v287}" >> "${log}"\necho "2.1.289 (Claude Code) rebuilt"\n`); // size and mtime change
    expect(await probe()).toMatchObject({ path: v287, version: '2.1.289', ok: true });
    expect(runs()).toEqual([v287, v287]);
  });

  it('never refuses a version other than the tested one', async () => {
    link(engine(version('9.0.0'), '9.0.0 (Claude Code)'));
    expect(await probeWith()()).toMatchObject({ version: '9.0.0', testedVersion: '2.1.283', ok: true, error: null });
  });

  it('a chosen path wins over the installed link and answers its own real path', async () => {
    link(engine(version('2.1.287'), '2.1.287 (Claude Code)'));
    const chosen = engine(join(root, 'opt/claude-dev'), '2.1.300-dev (Claude Code)');
    const alias = join(root, 'claude-alias');
    symlinkSync(chosen, alias);
    setBinaryConfig({ binaryPath: alias });
    expect(await probeWith()()).toMatchObject({ path: chosen, version: '2.1.300-dev', ok: true });
  });

  it('without the link, takes the first executable claude on the login shell’s PATH; one capture serves the lookup and --version', async () => {
    const skipped = join(root, 'not-exec');
    mkdirSync(skipped);
    writeFileSync(join(skipped, 'claude'), 'not executable'); // 0644: passed over
    mkdirSync(join(root, 'dir-named/claude'), { recursive: true }); // a directory named claude: passed over
    const found = engine(join(root, 'bin/claude'), '2.1.286 (Claude Code)');
    const captureEnv = vi.fn(async () => ({ PATH: `relative/bin:${join(root, 'empty')}:${skipped}:${join(root, 'dir-named')}:${join(root, 'bin')}` }));
    expect(await probeWith({ captureEnv })()).toMatchObject({ path: found, version: '2.1.286', ok: true });
    expect(captureEnv).toHaveBeenCalledOnce();

    link(engine(version('2.1.287'), '2.1.287 (Claude Code)'));
    const withLink = vi.fn(async () => ({ PATH: join(root, 'bin') }));
    const probe = probeWith({ captureEnv: withLink });
    expect(await probe()).toMatchObject({ version: '2.1.287' });
    expect(withLink).toHaveBeenCalledOnce(); // for --version alone
    await probe();
    expect(withLink).toHaveBeenCalledOnce(); // a cached version reads no capture
  });

  it('runs --version in the login shell’s environment, so a script whose interpreter is only on that PATH answers', async () => {
    const interpreters = join(root, 'shell-only'); // on the captured PATH, never on the host's own
    engine(join(interpreters, 'maws-fake-node'), '2.1.291 (Claude Code)');
    const script = (path: string) => {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, '#!/usr/bin/env maws-fake-node\n'); // an npm-installed claude: `#!/usr/bin/env node`
      chmodSync(path, 0o755);
      return path;
    };
    const found = script(join(root, 'bin/claude'));
    const captureEnv = async () => ({ PATH: `${interpreters}:${join(root, 'bin')}` });
    expect(process.env.PATH?.split(':')).not.toContain(interpreters);
    expect(await probeWith({ captureEnv })()).toMatchObject({ path: found, version: '2.1.291', ok: true });
    setBinaryConfig({ binaryPath: script(join(root, 'opt/claude')) }); // a chosen path runs in the same environment
    expect(await probeWith({ captureEnv })()).toMatchObject({ path: join(root, 'opt/claude'), version: '2.1.291', ok: true });
  });

  it('a dangling installed link falls through to PATH', async () => {
    link(join(home, '.local/share/claude/versions/2.1.280')); // removed by the installer's cleanup
    const found = engine(join(root, 'bin/claude'), '2.1.286 (Claude Code)');
    expect(await probeWith({ captureEnv: async () => ({ PATH: join(root, 'bin') }) })()).toMatchObject({ path: found, ok: true });
  });

  it('names a missing install without running anything, and a chosen path that is gone', async () => {
    expect(await probeWith()()).toEqual({
      path: join(home, INSTALLED_LINK), testedVersion: TESTED_ENGINE_VERSION, version: null, ok: false,
      error: expect.stringContaining('Claude Code is not installed'),
    });
    setBinaryConfig({ binaryPath: join(root, 'gone/claude') });
    expect(await probeWith()()).toMatchObject({ path: join(root, 'gone/claude'), ok: false, error: expect.stringContaining('no executable engine binary') });
    expect(runs()).toEqual([]);
  });

  it('a binary whose --version prints no version is refused and probed again next time', async () => {
    const silent = engine(version('2.1.287'), 'hello');
    link(silent);
    const probe = probeWith();
    expect(await probe()).toMatchObject({ path: silent, version: null, ok: false, error: expect.stringContaining('printed no version') });
    await probe();
    expect(runs()).toEqual([silent, silent]);
  });

  it('under MAWS_E2E runs MAWS_E2E_ENGINE_BIN and never the installed link; without it, nothing', async () => {
    link(engine(version('2.1.287'), '2.1.287 (Claude Code)'));
    const pinned = engine(join(root, 'pin/2.1.283'), '2.1.283 (Claude Code)');
    expect(await probeWith({ env: { MAWS_E2E: '1', MAWS_E2E_ENGINE_BIN: pinned } })()).toMatchObject({ path: pinned, version: '2.1.283', ok: true });
    expect(await probeWith({ env: { MAWS_E2E: '1' } })()).toMatchObject({ ok: false, error: expect.stringContaining('MAWS_E2E_ENGINE_BIN') });
    expect(runs()).toEqual([pinned]);
  });
});

it('the tested version MAWS reports is the fixtures’ pin', () => {
  expect(TESTED_ENGINE_VERSION).toBe(ENGINE_VERSION);
});
