// `mawsd install` and `uninstall` (P5 O2 M6; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M6's Proves): the command
// sequence of an install twice (the second changes nothing) and of an uninstall, on each platform, through fake managers
// in a scratch home; the wrapper and its link; the delegation's ref; the label a profile's unit goes by.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readMachineRef } from '@shared/machine/identity-file';
import { MachineRefSchema } from '@shared/machine/ref';
import { FakeManagers } from '../../test/support/fake-units';
import { installDaemon, isDefaultProfile, resolveLabel, uninstallDaemon, wrapperPath, wrapperText, type InstallDeps } from './install';

let home: string;
let managers: FakeManagers;
const PROGRAM = { runtime: '/Applications/MAWS.app/Contents/MacOS/MAWS', entry: '/Applications/MAWS.app/Contents/Resources/app.asar/out/main/mawsd.js' };
const DELEGATION = '0123456789abcdef0123456789abcdef';
const linuxProgram = () => ({ runtime: join(home, '.local/share/maws/mawsd/current/runtime/bin/node'), entry: join(home, '.local/share/maws/mawsd/current/out/main/mawsd.js') });
const CHECKOUT = { runtime: '/Users/u/src/MAWS/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', entry: '/Users/u/src/MAWS/out/main/mawsd.js' };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'maws-in-'));
  managers = new FakeManagers();
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const deps = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}): InstallDeps => ({ platform, run: managers.run, home, env, uid: 501, user: 'u', sleep: async () => {} });
const darwinProfile = () => join(home, 'Library', 'Application Support', 'MAWS');
const linuxProfile = () => join(home, '.config', 'MAWS');

describe('the label a profile’s unit goes by', () => {
  it('is --label, else MAWS_MAWSD_LABEL for MAWS_USER_DATA’s profile, else dev.maws.mawsd for the default profile, else none', () => {
    const at = { platform: 'darwin' as const, home };
    expect(resolveLabel({ ...at, profileDir: '/p', profileFrom: 'flag', labelFlag: 'dev.maws.mawsd.e2e-1', env: {} })).toBe('dev.maws.mawsd.e2e-1');
    expect(resolveLabel({ ...at, profileDir: '/p', profileFrom: 'env', env: { MAWS_MAWSD_LABEL: 'dev.maws.mawsd.e2e-2' } })).toBe('dev.maws.mawsd.e2e-2');
    expect(resolveLabel({ ...at, profileDir: '/p', profileFrom: 'flag', env: { MAWS_MAWSD_LABEL: 'dev.maws.mawsd.e2e-2' } })).toBeNull(); // the env names MAWS_USER_DATA's unit only
    expect(resolveLabel({ ...at, profileDir: darwinProfile(), profileFrom: 'default', env: {} })).toBe('dev.maws.mawsd');
    expect(resolveLabel({ ...at, profileDir: '/p', profileFrom: 'env', env: {} })).toBeNull();
  });

  it('refuses a label that is no name', () => {
    expect(() => resolveLabel({ platform: 'darwin', home, profileDir: '/p', profileFrom: 'flag', labelFlag: '../x', env: {} })).toThrow(/label/);
  });

  it('knows the default profile by its real path', () => {
    mkdirSync(darwinProfile(), { recursive: true });
    symlinkSync(darwinProfile(), join(home, 'alias'));
    expect(isDefaultProfile(join(home, 'alias'), 'darwin', {}, home)).toBe(true);
    expect(isDefaultProfile(join(home, 'other'), 'darwin', {}, home)).toBe(false);
    expect(isDefaultProfile(linuxProfile(), 'linux', {}, home)).toBe(true); // not yet created
  });
});

describe('the wrapper', () => {
  it('runs the unit’s program with the profile and its label, quoted for sh', () => {
    expect(wrapperText({ label: 'dev.maws.mawsd', profileDir: "/Users/o'k/MAWS", program: PROGRAM })).toBe(
      [
        '#!/bin/sh',
        "# mawsd's command line for the profile /Users/o'k/MAWS, written by `mawsd install`",
        "export MAWS_USER_DATA='/Users/o'\\''k/MAWS'",
        "export MAWS_MAWSD_LABEL='dev.maws.mawsd'",
        'export ELECTRON_RUN_AS_NODE=1',
        `exec '${PROGRAM.runtime}' --disable-sigusr1 '${PROGRAM.entry}' "$@"`,
        '',
      ].join('\n'),
    );
  });
});

describe('install and uninstall on macOS', () => {
  it('installs: the agent written and bootstrapped, the wrapper, its link; a second install changes nothing', async () => {
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    const profileDir = darwinProfile();
    const first = await installDaemon({ profileDir, label: 'dev.maws.mawsd', program: PROGRAM }, deps('darwin'));
    expect(first).toMatchObject({ change: 'loaded', linked: join(home, '.local', 'bin', 'mawsd'), ref: null });
    const plist = join(home, 'Library', 'LaunchAgents', 'dev.maws.mawsd.plist');
    expect(managers.calls).toEqual(['launchctl print gui/501/dev.maws.mawsd', `launchctl bootstrap gui/501 ${plist}`]);
    expect(lstatSync(join(profileDir, 'mawsd')).mode & 0o777).toBe(0o700);
    expect(readFileSync(wrapperPath(profileDir), 'utf8')).toContain(`exec '${PROGRAM.runtime}'`);
    expect(lstatSync(wrapperPath(profileDir)).mode & 0o777).toBe(0o700);
    expect(readlinkSync(join(home, '.local', 'bin', 'mawsd'))).toBe(wrapperPath(profileDir));

    managers.calls.length = 0;
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: PROGRAM }, deps('darwin'))).resolves.toMatchObject({ change: 'unchanged' });
    expect(managers.changes()).toEqual([]);

    managers.calls.length = 0;
    const moved = { runtime: '/Volumes/x/MAWS.app/Contents/MacOS/MAWS', entry: '/Volumes/x/MAWS.app/Contents/Resources/app.asar/out/main/mawsd.js' };
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: moved }, deps('darwin'))).resolves.toMatchObject({ change: 'updated' });
    expect(managers.changes()).toEqual(['launchctl bootout gui/501/dev.maws.mawsd', `launchctl bootstrap gui/501 ${plist}`]);
    expect(readFileSync(plist, 'utf8')).toContain(moved.entry);
    expect(readFileSync(wrapperPath(profileDir), 'utf8')).toContain(moved.entry);

    managers.calls.length = 0;
    await expect(uninstallDaemon({ profileDir, label: 'dev.maws.mawsd' }, deps('darwin'))).resolves.toMatchObject({ removed: true });
    expect(managers.changes()).toEqual(['launchctl bootout gui/501/dev.maws.mawsd']);
    expect(existsSync(plist)).toBe(false);
    expect(existsSync(wrapperPath(profileDir))).toBe(false);
    expect(existsSync(join(home, '.local', 'bin', 'mawsd'))).toBe(false);
    managers.calls.length = 0;
    await expect(uninstallDaemon({ profileDir, label: 'dev.maws.mawsd' }, deps('darwin'))).resolves.toMatchObject({ removed: false });
    expect(managers.changes()).toEqual([]);
  });

  it('links ~/.local/bin/mawsd only for the default profile, only where the directory is, and never over another mawsd', async () => {
    const profileDir = darwinProfile();
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: PROGRAM }, deps('darwin'))).resolves.toMatchObject({ linked: null }); // no ~/.local/bin

    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'mawsd'), '#!/bin/sh\n# someone else’s\n');
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: PROGRAM }, deps('darwin'))).resolves.toMatchObject({ linked: 'other' });
    expect(readFileSync(join(bin, 'mawsd'), 'utf8')).toContain('someone else');
    await uninstallDaemon({ profileDir, label: 'dev.maws.mawsd' }, deps('darwin'));
    expect(existsSync(join(bin, 'mawsd'))).toBe(true); // not ours, left

    rmSync(join(bin, 'mawsd'));
    const scratch = join(home, 'scratch-profile');
    await expect(installDaemon({ profileDir: scratch, label: 'dev.maws.mawsd.e2e-9', program: PROGRAM }, deps('darwin'))).resolves.toMatchObject({ linked: null });
    expect(existsSync(join(bin, 'mawsd'))).toBe(false);
    expect(readFileSync(wrapperPath(scratch), 'utf8')).toContain("MAWS_MAWSD_LABEL='dev.maws.mawsd.e2e-9'");
  });

  it('refuses a profile directory whose mawsd directory is not private, writing no unit', async () => {
    const profileDir = join(home, 'p');
    mkdirSync(join(profileDir, 'mawsd'), { recursive: true, mode: 0o755 });
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd.e2e-1', program: PROGRAM }, deps('darwin'))).rejects.toThrow(/more open than 0700/);
    expect(managers.calls).toEqual([]);
  });
});

describe('install and uninstall on Linux', () => {
  it('installs: the unit written, reloaded, enabled with --now, lingering; a second install changes nothing; uninstall', async () => {
    const profileDir = linuxProfile();
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram() }, deps('linux'))).resolves.toMatchObject({ change: 'loaded' });
    expect(managers.changes()).toEqual(['systemctl --user daemon-reload', 'systemctl --user enable --now mawsd.service', 'loginctl enable-linger u']);
    expect(existsSync(join(home, '.config', 'systemd', 'user', 'mawsd.service'))).toBe(true);
    expect(readFileSync(wrapperPath(profileDir), 'utf8')).toContain('export ELECTRON_RUN_AS_NODE=1');

    managers.calls.length = 0;
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram() }, deps('linux'))).resolves.toMatchObject({ change: 'unchanged' });
    expect(managers.changes()).toEqual([]);

    managers.calls.length = 0;
    await uninstallDaemon({ profileDir, label: 'dev.maws.mawsd' }, deps('linux'));
    expect(managers.changes()).toEqual(['systemctl --user disable --now mawsd.service', 'systemctl --user daemon-reload']);
  });

  it('is not available on a platform with neither manager', async () => {
    await expect(installDaemon({ profileDir: join(home, 'p'), label: 'dev.maws.mawsd.e2e-1', program: PROGRAM }, deps('win32'))).rejects.toMatchObject({ code: 2 });
    expect(existsSync(join(home, 'p'))).toBe(false);
  });
});

describe('install --delegation-id', () => {
  it('refuses a malformed id before anything is written', async () => {
    const profileDir = linuxProfile();
    for (const id of ['0123', 'G123456789abcdef0123456789abcdef', '0123456789ABCDEF0123456789ABCDEF']) {
      await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram(), delegationId: id }, deps('linux'))).rejects.toThrow(/delegation id/);
    }
    expect(existsSync(profileDir)).toBe(false);
    expect(managers.calls).toEqual([]);
  });

  it('mints a 55-character ref with the delegation’s prefix before the unit’s first start, once', async () => {
    const profileDir = linuxProfile();
    let atFirstStart: unknown = undefined;
    const run = managers.run;
    const watching = { ...deps('linux'), run: (command: string, args: readonly string[]) => {
      if (args.includes('enable')) atFirstStart = readMachineRef(profileDir);
      return run(command, args);
    } };
    const installed = await installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram(), delegationId: DELEGATION }, watching);
    const ref = readMachineRef(profileDir);
    expect(ref).toHaveLength(55);
    expect(ref!.startsWith(`${DELEGATION}_`)).toBe(true);
    expect(MachineRefSchema.safeParse(ref).success).toBe(true);
    expect(installed.ref).toBe(ref);
    expect(atFirstStart).toBe(ref);
    expect(lstatSync(join(profileDir, 'machine.json')).mode & 0o777).toBe(0o600);

    const again = await installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram(), delegationId: 'fedcba9876543210fedcba9876543210' }, deps('linux'));
    expect(again.ref).toBe(ref); // an existing ref is never rewritten
    expect(readMachineRef(profileDir)).toBe(ref);
  });
});

describe('the canonical unit runs a packaged build only (residue 21)', () => {
  it('on macOS, refuses an entry outside an app.asar under the default label, before writing anything', async () => {
    const profileDir = darwinProfile();
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: CHECKOUT, programGiven: true }, deps('darwin'))).rejects.toThrow(`${CHECKOUT.entry} is not inside a packaged app's app.asar`);
    expect(existsSync(profileDir)).toBe(false);
    expect(managers.calls).toEqual([]);
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: PROGRAM }, deps('darwin'))).resolves.toMatchObject({ change: 'loaded' });
  });

  it('on Linux, takes the release directory’s current, or a program the caller named, and refuses any other', async () => {
    const profileDir = linuxProfile();
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: CHECKOUT }, deps('linux'))).rejects.toThrow(`${CHECKOUT.entry} is not in the release directory`);
    expect(existsSync(profileDir)).toBe(false);
    expect(managers.calls).toEqual([]);
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: CHECKOUT, programGiven: true }, deps('linux'))).resolves.toMatchObject({ change: 'loaded' });
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram() }, deps('linux'))).resolves.toMatchObject({ change: 'updated' });
  });

  it('lets any other label run an unpackaged build', async () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const profileDir = join(home, `scratch-${platform}`);
      await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd.e2e-3', program: CHECKOUT }, deps(platform))).resolves.toMatchObject({ change: 'loaded' });
    }
  });
});
