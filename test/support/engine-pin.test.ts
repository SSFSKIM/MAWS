import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
function setup() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'maws-test-engine-')));
  roots.push(home);
  const versions = join(home, '.local/share/claude/versions');
  mkdirSync(versions, { recursive: true });
  const binary = (name: string, version = name) => {
    const path = join(versions, name);
    writeFileSync(path, `#!/bin/sh\nif [ "$#" = 1 ] && [ "$1" = --version ]; then echo probe >> '${home}/probes'; echo '${version} (Claude Code)'; exit 0; fi\nexit 64\n`, { mode: 0o755 });
    return path;
  };
  const resolve = (override = '') => JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `import { ENGINE_BIN, ENGINE_VERSION } from ${JSON.stringify(join(__dirname, 'engine-pin.ts'))}; console.log(JSON.stringify({bin: ENGINE_BIN, version: ENGINE_VERSION}));`], {
    env: { ...process.env, HOME: home, MAWS_E2E_ENGINE_BIN: override }, encoding: 'utf8',
  })) as { bin: string; version: string };
  return { home, versions, binary, resolve };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('uses an explicit engine before the retained fixture pin and probes its actual version once', () => {
  const s = setup();
  s.binary('2.1.283');
  const override = s.binary('custom', '3.0.1-dev+local');
  expect(s.resolve(override)).toEqual({ bin: override, version: '3.0.1-dev+local' });
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

it('keeps an override on the probed binary when its symlink advances', () => {
  const s = setup();
  const before = s.binary('2.1.290');
  const after = s.binary('2.1.291');
  const link = join(s.home, 'claude');
  symlinkSync(before, link);
  const output = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
    import { ENGINE_BIN, ENGINE_VERSION } from ${JSON.stringify(join(__dirname, 'engine-pin.ts'))};
    import { unlinkSync, symlinkSync } from 'node:fs';
    import { execFileSync } from 'node:child_process';
    unlinkSync(${JSON.stringify(link)});
    symlinkSync(${JSON.stringify(after)}, ${JSON.stringify(link)});
    console.log(JSON.stringify({ bin: ENGINE_BIN, version: ENGINE_VERSION, ran: execFileSync(ENGINE_BIN, ['--version'], {encoding: 'utf8'}).trim() }));
  `], { env: { ...process.env, HOME: s.home, MAWS_E2E_ENGINE_BIN: link }, encoding: 'utf8' });
  expect(JSON.parse(output)).toEqual({ bin: before, version: '2.1.290', ran: '2.1.290 (Claude Code)' });
});

it('records the resolved version even when a probe exits before system/init', () => {
  const s = setup();
  const bin = s.binary('custom', '4.2.7');
  const output = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
    import { probe, root } from ${JSON.stringify(join(__dirname, '../../spikes/protocol-probe/scenarios/pass2/common.mjs'))};
    import { readFileSync } from 'node:fs';
    import { relative } from 'node:path';
    const p = probe('startup-only', {cwd: ${JSON.stringify(s.home)}, dir: relative(root, ${JSON.stringify(s.home)}) + '/'});
    await p.closed;
    console.log(JSON.stringify(readFileSync(p.file, 'utf8').trim().split('\\n').map(JSON.parse)));
  `], { env: { ...process.env, HOME: s.home, MAWS_E2E_ENGINE_BIN: bin }, encoding: 'utf8', timeout: 10_000 });
  const rows = JSON.parse(output) as { frame: Record<string, unknown> }[];
  expect(rows.some(({ frame }) => frame.type === 'system' && frame.subtype === 'init')).toBe(false);
  expect(rows.find(({ frame }) => frame.event === 'provenance')?.frame).toMatchObject({ engineVersion: '4.2.7', engineBin: bin });
});
