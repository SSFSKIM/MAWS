// The LaunchAgent (P5 O2 M6; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, Interfaces "The LaunchAgent"): its exact
// text for a profile, a label and a program, and what `apply`, `remove` and `restart` ask of a fake `launchctl` in a
// scratch home. Nothing here reaches the machine's launchd.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeManagers } from '../../../test/support/fake-units';
import { launchdPlist, launchdUnit } from './launchd';
import type { UnitSpec } from './unit';

const SPEC: UnitSpec = {
  label: 'dev.maws.mawsd',
  profileDir: '/Users/u/Library/Application Support/MAWS',
  program: { runtime: '/Applications/MAWS.app/Contents/MacOS/MAWS', entry: '/Applications/MAWS.app/Contents/Resources/app.asar/out/main/mawsd.js' },
};

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>dev.maws.mawsd</string>
\t<key>ProgramArguments</key>
\t<array>
\t\t<string>/Applications/MAWS.app/Contents/MacOS/MAWS</string>
\t\t<string>--disable-sigusr1</string>
\t\t<string>/Applications/MAWS.app/Contents/Resources/app.asar/out/main/mawsd.js</string>
\t\t<string>run</string>
\t\t<string>--unit</string>
\t\t<string>--dir</string>
\t\t<string>/Users/u/Library/Application Support/MAWS/mawsd</string>
\t</array>
\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>ELECTRON_RUN_AS_NODE</key>
\t\t<string>1</string>
\t\t<key>MAWS_USER_DATA</key>
\t\t<string>/Users/u/Library/Application Support/MAWS</string>
\t</dict>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<dict>
\t\t<key>SuccessfulExit</key>
\t\t<false/>
\t</dict>
\t<key>ProcessType</key>
\t<string>Interactive</string>
\t<key>ThrottleInterval</key>
\t<integer>10</integer>
\t<key>StandardOutPath</key>
\t<string>/Users/u/Library/Application Support/MAWS/mawsd/mawsd.out</string>
\t<key>StandardErrorPath</key>
\t<string>/Users/u/Library/Application Support/MAWS/mawsd/mawsd.out</string>
\t<key>AssociatedBundleIdentifiers</key>
\t<array>
\t\t<string>dev.maws.app</string>
\t</array>
</dict>
</plist>
`;

describe('the LaunchAgent’s text', () => {
  it('is exactly the Interfaces block for a profile, a label and a program', () => {
    expect(launchdPlist(SPEC)).toBe(PLIST);
  });

  it('escapes what XML would read as markup, under any label', () => {
    const text = launchdPlist({ ...SPEC, label: 'dev.maws.mawsd.e2e-7', profileDir: '/tmp/a&b <c>' });
    expect(text).toContain('<string>dev.maws.mawsd.e2e-7</string>');
    expect(text).toContain('<string>/tmp/a&amp;b &lt;c&gt;/mawsd</string>');
    expect(text).not.toContain('a&b');
  });

  it.runIf(process.platform === 'darwin')('is a property list plutil accepts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maws-plist-'));
    try {
      const file = join(dir, 'agent.plist');
      writeFileSync(file, launchdPlist({ ...SPEC, profileDir: '/tmp/a&b <c>' }));
      expect(execFileSync('plutil', ['-lint', file], { encoding: 'utf8' })).toContain('OK');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the LaunchAgent through a fake launchctl', () => {
  let home: string;
  let managers: FakeManagers;
  const deps = () => ({ run: managers.run, home, env: {}, uid: 501, user: 'u', sleep: async () => {} });
  const plistPath = (label = SPEC.label) => join(home, 'Library', 'LaunchAgents', `${label}.plist`);

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'maws-ld-'));
    managers = new FakeManagers();
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('writes and bootstraps a new agent; a second apply changes nothing', async () => {
    const unit = launchdUnit(SPEC.label, deps());
    expect(unit.file).toBe(plistPath());
    expect(unit.state()).toEqual({ installed: false, loaded: false });
    managers.calls.length = 0;
    await expect(unit.apply(launchdPlist(SPEC))).resolves.toBe('loaded');
    expect(readFileSync(plistPath(), 'utf8')).toBe(PLIST);
    expect(managers.calls).toEqual(['launchctl print gui/501/dev.maws.mawsd', `launchctl bootstrap gui/501 ${plistPath()}`]);
    expect(unit.state()).toEqual({ installed: true, loaded: true });

    managers.calls.length = 0;
    await expect(unit.apply(launchdPlist(SPEC))).resolves.toBe('unchanged');
    expect(managers.calls).toEqual(['launchctl print gui/501/dev.maws.mawsd']);
  });

  it('rewrites a stale program path and restarts the daemon: bootout, then bootstrap once the job is gone', async () => {
    const unit = launchdUnit(SPEC.label, deps());
    await unit.apply(launchdPlist({ ...SPEC, program: { runtime: '/old/MAWS.app/Contents/MacOS/MAWS', entry: '/old/mawsd.js' } }));
    managers.calls.length = 0;
    managers.bootoutLingers = 2; // launchd finds the job twice more after its bootout
    await expect(unit.apply(launchdPlist(SPEC))).resolves.toBe('updated');
    expect(readFileSync(plistPath(), 'utf8')).toBe(PLIST);
    expect(managers.changes()).toEqual(['launchctl bootout gui/501/dev.maws.mawsd', `launchctl bootstrap gui/501 ${plistPath()}`]);
    expect(managers.calls.filter((call) => call.startsWith('launchctl print')).length).toBe(4); // before, and three after the bootout
  });

  it('bootstraps an agent whose file is current but which is not loaded', async () => {
    const unit = launchdUnit(SPEC.label, deps());
    await unit.apply(launchdPlist(SPEC));
    managers.loaded.clear();
    managers.calls.length = 0;
    await expect(unit.apply(launchdPlist(SPEC))).resolves.toBe('loaded');
    expect(managers.changes()).toEqual([`launchctl bootstrap gui/501 ${plistPath()}`]);
  });

  it('fails, naming launchctl’s answer, when the job outlives its bootout', async () => {
    const unit = launchdUnit(SPEC.label, deps());
    await unit.apply(launchdPlist({ ...SPEC, label: SPEC.label, program: { runtime: '/old', entry: '/old.js' } }));
    managers.bootoutLingers = 10_000;
    await expect(unit.apply(launchdPlist(SPEC))).rejects.toThrow(/still loaded .* after its bootout/);
  });

  it('retries a bootstrap that fails with 5 after the bootout, once print no longer finds the job', async () => {
    const unit = launchdUnit(SPEC.label, deps());
    await unit.apply(launchdPlist({ ...SPEC, program: { runtime: '/old', entry: '/old.js' } }));
    managers.calls.length = 0;
    managers.script('launchctl bootstrap', { status: 5, stderr: 'Bootstrap failed: 5: Input/output error' }, 2);
    await expect(unit.apply(launchdPlist(SPEC))).resolves.toBe('updated');
    expect(managers.changes()).toEqual(['launchctl bootout gui/501/dev.maws.mawsd', ...Array(3).fill(`launchctl bootstrap gui/501 ${plistPath()}`)]);
    expect(managers.loaded.has(SPEC.label)).toBe(true);
  });

  it('gives up on a bootstrap that keeps failing with 5, keeping launchctl’s last answer, and does not retry other failures', async () => {
    const unit = launchdUnit(SPEC.label, deps());
    managers.script('launchctl bootstrap', { status: 5, stderr: 'Bootstrap failed: 5: Input/output error' }, 100);
    await expect(unit.apply(launchdPlist(SPEC))).rejects.toThrow(/after 6 attempts \(5\): Bootstrap failed: 5: Input\/output error/);
    expect(managers.calls.filter((call) => call.startsWith('launchctl bootstrap'))).toHaveLength(6);

    const other = new FakeManagers();
    other.script('launchctl bootstrap', { status: 125, stderr: 'Bootstrap failed: 125: Domain does not support specified action' });
    await expect(launchdUnit(SPEC.label, { ...deps(), run: other.run }).apply(launchdPlist(SPEC))).rejects.toThrow(/\(125\)/);
    expect(other.calls.filter((call) => call.startsWith('launchctl bootstrap'))).toHaveLength(1);
  });

  it('a failed update leaves the old file, so the retry completes it rather than reading it as unchanged', async () => {
    const old = launchdPlist({ ...SPEC, program: { runtime: '/old', entry: '/old.js' } });
    const unit = launchdUnit(SPEC.label, deps());
    await unit.apply(old);
    managers.script('launchctl bootstrap', { status: 1, stderr: 'Bootstrap failed: 1: Operation not permitted' });
    await expect(unit.apply(launchdPlist(SPEC))).rejects.toThrow(/Operation not permitted/);
    expect(readFileSync(plistPath(), 'utf8')).toBe(old);
    expect(managers.loaded.has(SPEC.label)).toBe(false); // the bootout happened

    managers.calls.length = 0;
    await expect(unit.apply(launchdPlist(SPEC))).resolves.toBe('loaded');
    expect(readFileSync(plistPath(), 'utf8')).toBe(PLIST);
    expect(managers.changes()).toEqual([`launchctl bootstrap gui/501 ${plistPath()}`]);
  });

  it('a failed first install leaves no file behind', async () => {
    const unit = launchdUnit(SPEC.label, deps());
    managers.script('launchctl bootstrap', { status: 1, stderr: 'nope' });
    await expect(unit.apply(launchdPlist(SPEC))).rejects.toThrow(/nope/);
    expect(existsSync(plistPath())).toBe(false);
    await expect(unit.apply(launchdPlist(SPEC))).resolves.toBe('loaded');
  });

  it('removes: bootout and the file; a second remove does nothing', async () => {
    const unit = launchdUnit(SPEC.label, deps());
    await unit.apply(launchdPlist(SPEC));
    managers.calls.length = 0;
    await expect(unit.remove()).resolves.toBe(true);
    expect(existsSync(plistPath())).toBe(false);
    expect(managers.changes()).toEqual(['launchctl bootout gui/501/dev.maws.mawsd']);
    managers.calls.length = 0;
    await expect(unit.remove()).resolves.toBe(false);
    expect(managers.changes()).toEqual([]);
  });

  it('restarts through kickstart -k, and fails when the job is not loaded', async () => {
    const unit = launchdUnit('dev.maws.mawsd.e2e-3', deps());
    expect(() => unit.restart()).toThrow(/kickstart/);
    await unit.apply(launchdPlist({ ...SPEC, label: 'dev.maws.mawsd.e2e-3' }));
    managers.calls.length = 0;
    unit.restart();
    expect(managers.calls).toEqual(['launchctl kickstart -k gui/501/dev.maws.mawsd.e2e-3']);
  });

  // P5 O2 M7: the app's unit start strategy asks launchd to start a loaded job that is not running, never to kill one
  it('starts through a plain kickstart, and fails when the job is not loaded', async () => {
    const unit = launchdUnit('dev.maws.mawsd.e2e-4', deps());
    expect(() => unit.start()).toThrow(/kickstart/);
    await unit.apply(launchdPlist({ ...SPEC, label: 'dev.maws.mawsd.e2e-4' }));
    managers.calls.length = 0;
    unit.start();
    expect(managers.calls).toEqual(['launchctl kickstart gui/501/dev.maws.mawsd.e2e-4']);
  });
});
