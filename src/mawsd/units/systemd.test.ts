// The systemd user unit (P5 O2 M6; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, Interfaces "The systemd user unit"):
// its exact text for a profile, a label and a program, and what `apply`, `remove` and `restart` ask of fake `systemctl
// --user`, `loginctl` and `sudo -n` in a scratch home. Nothing here reaches the machine's systemd.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeManagers } from '../../../test/support/fake-units';
import { systemdUnit, systemdUnitName, systemdUnitText } from './systemd';
import type { UnitSpec } from './unit';

const SPEC: UnitSpec = {
  label: 'dev.maws.mawsd',
  profileDir: '/home/user/.config/MAWS',
  program: { runtime: '/home/user/.local/share/maws/mawsd/current/runtime/bin/node', entry: '/home/user/.local/share/maws/mawsd/current/out/main/mawsd.js' },
};

const UNIT = `[Unit]
Description=MAWS machine daemon (mawsd)

[Service]
ExecStart=/home/user/.local/share/maws/mawsd/current/runtime/bin/node --disable-sigusr1 /home/user/.local/share/maws/mawsd/current/out/main/mawsd.js run --unit --dir /home/user/.config/MAWS/mawsd
Environment=MAWS_USER_DATA=/home/user/.config/MAWS
Restart=on-failure
RestartSec=2
KillMode=process

[Install]
WantedBy=default.target
`;

describe('the systemd user unit’s text', () => {
  it('is exactly the Interfaces block for a profile, a label and a program', () => {
    expect(systemdUnitText(SPEC)).toBe(UNIT);
  });

  it('names the default label’s unit mawsd.service, and any other label’s <label>.service', () => {
    expect(systemdUnitName('dev.maws.mawsd')).toBe('mawsd.service');
    expect(systemdUnitName('dev.maws.mawsd.e2e-4')).toBe('dev.maws.mawsd.e2e-4.service');
  });

  it('quotes a path with a space and escapes what systemd would expand', () => {
    const text = systemdUnitText({ ...SPEC, profileDir: '/home/u/My Profile 100%', program: { runtime: '/opt/n"ode', entry: '/opt/$x/mawsd.js' } });
    expect(text).toContain('ExecStart="/opt/n\\"ode" --disable-sigusr1 /opt/$$x/mawsd.js run --unit --dir "/home/u/My Profile 100%%/mawsd"\n');
    expect(text).toContain('Environment="MAWS_USER_DATA=/home/u/My Profile 100%%"\n');
  });
});

describe('the systemd user unit through fake managers', () => {
  let home: string;
  let managers: FakeManagers;
  const deps = (env: NodeJS.ProcessEnv = {}) => ({ run: managers.run, home, env, uid: 1000, user: 'user', sleep: async () => {} });
  const unitPath = (name = 'mawsd.service') => join(home, '.config', 'systemd', 'user', name);

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'maws-sd-'));
    managers = new FakeManagers();
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('writes, reloads, enables with --now and enables lingering; a second apply changes nothing', async () => {
    const unit = systemdUnit(SPEC.label, deps());
    expect(unit.file).toBe(unitPath());
    await expect(unit.apply(systemdUnitText(SPEC))).resolves.toBe('loaded');
    expect(readFileSync(unitPath(), 'utf8')).toBe(UNIT);
    expect(managers.calls).toEqual([
      'systemctl --user show-environment',
      'systemctl --user is-enabled mawsd.service',
      'systemctl --user is-active mawsd.service',
      'systemctl --user daemon-reload',
      'systemctl --user enable --now mawsd.service',
      'loginctl show-user user --property=Linger --value',
      'loginctl enable-linger user',
    ]);
    expect(unit.state()).toEqual({ installed: true, loaded: true });

    managers.calls.length = 0;
    await expect(unit.apply(systemdUnitText(SPEC))).resolves.toBe('unchanged');
    expect(managers.changes()).toEqual([]);
  });

  it('rewrites a stale program path and restarts the daemon', async () => {
    const unit = systemdUnit(SPEC.label, deps());
    await unit.apply(systemdUnitText({ ...SPEC, program: { runtime: '/old/node', entry: '/old/mawsd.js' } }));
    managers.calls.length = 0;
    await expect(unit.apply(systemdUnitText(SPEC))).resolves.toBe('updated');
    expect(readFileSync(unitPath(), 'utf8')).toBe(UNIT);
    expect(managers.changes()).toEqual(['systemctl --user daemon-reload', 'systemctl --user restart mawsd.service']);
  });

  it('a failed restart puts the old file back and reloads it, so the retry completes the update', async () => {
    const old = systemdUnitText({ ...SPEC, program: { runtime: '/old/node', entry: '/old/mawsd.js' } });
    const unit = systemdUnit(SPEC.label, deps());
    await unit.apply(old);
    managers.calls.length = 0;
    managers.script('systemctl --user restart', { status: 1, stderr: 'Job for mawsd.service failed' });
    await expect(unit.apply(systemdUnitText(SPEC))).rejects.toThrow(/Job for mawsd.service failed/);
    expect(readFileSync(unitPath(), 'utf8')).toBe(old);
    expect(managers.changes()).toEqual(['systemctl --user daemon-reload', 'systemctl --user restart mawsd.service', 'systemctl --user daemon-reload']);

    managers.calls.length = 0;
    await expect(unit.apply(systemdUnitText(SPEC))).resolves.toBe('updated');
    expect(readFileSync(unitPath(), 'utf8')).toBe(UNIT);
    expect(managers.changes()).toEqual(['systemctl --user daemon-reload', 'systemctl --user restart mawsd.service']);
  });

  it('a failed reload of a first install leaves no file, and the retry installs it', async () => {
    const unit = systemdUnit(SPEC.label, deps());
    managers.script('systemctl --user daemon-reload', { status: 1, stderr: 'Failed to reload daemon' });
    await expect(unit.apply(systemdUnitText(SPEC))).rejects.toThrow(/Failed to reload daemon/);
    expect(existsSync(unitPath())).toBe(false);
    await expect(unit.apply(systemdUnitText(SPEC))).resolves.toBe('loaded');
    expect(readFileSync(unitPath(), 'utf8')).toBe(UNIT);
  });

  it('enables lingering through sudo -n when the plain call is refused, and fails when neither may', async () => {
    managers.lingerNeedsSudo = true;
    const unit = systemdUnit(SPEC.label, deps());
    await unit.apply(systemdUnitText(SPEC));
    expect(managers.changes().slice(-2)).toEqual(['loginctl enable-linger user', 'sudo -n loginctl enable-linger user']);
    expect(managers.linger).toBe(true);

    managers.linger = false;
    managers.sudoAllowed = false;
    await expect(unit.apply(systemdUnitText(SPEC))).rejects.toThrow(/lingering .* stops at logout/);
  });

  it('is not available where systemctl --user reaches no user manager, and writes nothing', async () => {
    managers.userManager = false;
    const unit = systemdUnit(SPEC.label, deps());
    await expect(unit.apply(systemdUnitText(SPEC))).rejects.toMatchObject({ code: 2, message: expect.stringMatching(/no user manager/) });
    expect(existsSync(unitPath())).toBe(false);
  });

  it('honours an absolute XDG_CONFIG_HOME, as systemd does', () => {
    expect(systemdUnit('dev.maws.mawsd.e2e-1', deps({ XDG_CONFIG_HOME: '/xdg' })).file).toBe('/xdg/systemd/user/dev.maws.mawsd.e2e-1.service');
    expect(systemdUnit('dev.maws.mawsd.e2e-1', deps({ XDG_CONFIG_HOME: 'rel' })).file).toBe(unitPath('dev.maws.mawsd.e2e-1.service'));
  });

  it('removes: disable --now, the file, a reload; lingering stays; a second remove does nothing', async () => {
    const unit = systemdUnit(SPEC.label, deps());
    await unit.apply(systemdUnitText(SPEC));
    managers.calls.length = 0;
    await expect(unit.remove()).resolves.toBe(true);
    expect(existsSync(unitPath())).toBe(false);
    expect(managers.changes()).toEqual(['systemctl --user disable --now mawsd.service', 'systemctl --user daemon-reload']);
    expect(managers.linger).toBe(true);
    managers.calls.length = 0;
    await expect(unit.remove()).resolves.toBe(false);
    expect(managers.changes()).toEqual([]);
  });

  it('restarts through systemctl --user restart', () => {
    const unit = systemdUnit(SPEC.label, deps());
    unit.restart();
    expect(managers.calls).toEqual(['systemctl --user restart mawsd.service']);
  });

  it('starts through systemctl --user start (P5 O2 M7: the app\'s unit start strategy)', () => {
    const unit = systemdUnit(SPEC.label, deps());
    unit.start();
    expect(managers.calls).toEqual(['systemctl --user start mawsd.service']);
  });
});
