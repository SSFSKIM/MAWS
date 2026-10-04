import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
function setup() {
  const home = mkdtempSync(join(tmpdir(), 'maws-test-engine-'));
  roots.push(home);
  const versions = join(home, '.local/share/claude/versions');
  mkdirSync(versions, { recursive: true });
  const binary = (name: string, version = name) => {
    const path = join(versions, name);
    writeFileSync(path, `#!/bin/sh\nif [ "$#" = 1 ] && [ "$1" = --version ]; then echo probe >> '${home}/probes'; echo '${version} (Claude Code)'; exit 0; fi\nexit 64\n`, { mode: 0o755 });
    return path;
  };
  const resolve = (override = '') => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `import { ENGINE_BIN, ENGINE_VERSION } from ${JSON.stringify(join(__dirname, 'engine-pin.ts'))}; console.log(JSON.stringify({bin: ENGINE_BIN, version: ENGINE_VERSION}));`], {
    env: { ...process.env, HOME: home, MAWS_E2E_ENGINE_BIN: override }, encoding: 'utf8',
  })) as { bin: string; version: string };
  return { home, versions, binary, resolve };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('uses an explicit engine before the retained fixture pin and probes its actual version once', () => {
  const s = setup();
  s.binary('2.1.283');
  const override = s.binary('custom', '3.0.1');
  expect(s.resolve(override)).toEqual({ bin: override, version: '3.0.1' });
  expect(readFileSync(join(s.home, 'probes'), 'utf8')).toBe('probe\n');
});
it('prefers the retained fixture pin over newer installed versions', () => {
  const s = setup();
  const pin = s.binary('2.1.283');
  s.binary('2.1.300');
  expect(s.resolve()).toEqual({ bin: pin, version: '2.1.283' });
});
it('falls back numerically to the newest installed binary after retention removes the pin', () => {
  const s = setup();
  s.binary('2.1.99');
  const latest = s.binary('2.1.300', '2.1.301');
  mkdirSync(join(s.versions, '9.0.0'));
  s.binary('download.tmp');
  expect(s.resolve()).toEqual({ bin: latest, version: '2.1.301' });
});
it('keeps missing engines reportable without breaking replay-only imports', () => {
  const s = setup();
  expect(s.resolve()).toEqual({ bin: join(s.versions, '2.1.283'), version: '' });
  expect(s.resolve('/nonexistent/fx4-engine')).toEqual({ bin: '/nonexistent/fx4-engine', version: '' });
});

it('does not claim the fixture version for a binary with invalid version output', () => {
  const s = setup();
  const override = s.binary('custom', 'not a version');
  expect(s.resolve(override)).toEqual({ bin: override, version: '' });
});
it('can be imported on a machine without an installer directory', () => {
  const s = setup();
  rmSync(s.versions, { recursive: true });
  expect(s.resolve()).toEqual({ bin: join(s.versions, '2.1.283'), version: '' });
});
