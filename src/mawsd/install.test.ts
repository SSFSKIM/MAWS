// `mawsd install` and `uninstall` (P5 O2 M6; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M6's Proves): the command
// sequence of an install twice (the second changes nothing) and of an uninstall, on each platform, through fake managers
// in a scratch home; the wrapper and its link; the delegation's ref; the label a profile's unit goes by.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readMachineRef, readOrMintMachineRef } from '@shared/machine/identity-file';
import { MachineRefSchema } from '@shared/machine/ref';
import { fakePack, packProgram } from '../../test/support/fake-pack';
import { FakeManagers } from '../../test/support/fake-units';
import { installDaemon, isDefaultProfile, resolveLabel, uninstallDaemon, wrapperPath, wrapperText, type InstallDeps } from './install';

let home: string;
let managers: FakeManagers;
const PROGRAM = { runtime: '/Applications/MAWS.app/Contents/MacOS/MAWS', entry: '/Applications/MAWS.app/Contents/Resources/app.asar/out/main/mawsd.js' };
const DELEGATION = '0123456789abcdef0123456789abcdef';
// a command line run from a pack (pnpm mawsd:pack's dist/mawsd/<release>), as devenv/setup.sh runs `mawsd install`
const linuxProgram = (commit = 'a1b2c3d4') => packProgram(fakePack(join(home, 'checkout', 'dist', 'mawsd'), commit));
const current = () => join(home, '.local/share/maws/mawsd/current');
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
    const program = linuxProgram();
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program }, deps('linux'))).resolves.toMatchObject({ change: 'loaded', release: { release: '0.0.0-a1b2c3d4', previous: null, flipped: true } });
    expect(managers.changes()).toEqual(['systemctl --user daemon-reload', 'systemctl --user enable --now mawsd.service', 'loginctl enable-linger u']);
    const unit = readFileSync(join(home, '.config', 'systemd', 'user', 'mawsd.service'), 'utf8');
    expect(unit).toContain(`ExecStart=${current()}/runtime/bin/node --disable-sigusr1 ${current()}/out/main/mawsd.js run --unit --dir ${profileDir}/mawsd`);
    expect(unit).not.toContain('checkout');
    expect(readlinkSync(current())).toBe('releases/0.0.0-a1b2c3d4');
    expect(readFileSync(wrapperPath(profileDir), 'utf8')).toContain('export ELECTRON_RUN_AS_NODE=1');
    expect(readFileSync(wrapperPath(profileDir), 'utf8')).toContain(`exec '${current()}/runtime/bin/node' --disable-sigusr1 '${current()}/out/main/mawsd.js' "$@"`);

    managers.calls.length = 0;
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program }, deps('linux'))).resolves.toMatchObject({ change: 'unchanged', release: { flipped: false } });
    expect(managers.changes()).toEqual([]);

    managers.calls.length = 0;
    await uninstallDaemon({ profileDir, label: 'dev.maws.mawsd' }, deps('linux'));
    expect(managers.changes()).toEqual(['systemctl --user disable --now mawsd.service', 'systemctl --user daemon-reload']);
  });

  it('a new release flips current and restarts the running unit onto it; the release it runs from installs as current', async () => {
    const profileDir = linuxProfile();
    await installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram('aaaaaaaa') }, deps('linux'));
    const unitFile = join(home, '.config', 'systemd', 'user', 'mawsd.service');
    const text = readFileSync(unitFile, 'utf8');

    managers.calls.length = 0;
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram('bbbbbbbb') }, deps('linux'))).resolves.toMatchObject({ change: 'updated', release: { release: '0.0.0-bbbbbbbb', previous: '0.0.0-aaaaaaaa', flipped: true } });
    expect(managers.changes()).toEqual(['systemctl --user restart mawsd.service']); // the unit's text names current, so only the daemon changes
    expect(readFileSync(unitFile, 'utf8')).toBe(text);
    expect(readlinkSync(current())).toBe('releases/0.0.0-bbbbbbbb');

    // a rollback: `mawsd install` run from the previous release's own copy (its real path, as Node runs it)
    managers.calls.length = 0;
    const previous = join(home, '.local/share/maws/mawsd/releases/0.0.0-aaaaaaaa');
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: packProgram(previous) }, deps('linux'))).resolves.toMatchObject({ change: 'updated', release: { release: '0.0.0-aaaaaaaa', flipped: true } });
    expect(managers.changes()).toEqual(['systemctl --user restart mawsd.service']);

    // a unit not running when the release flips is started by the install, not restarted
    managers.active.delete('mawsd.service');
    managers.calls.length = 0;
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram('cccccccc') }, deps('linux'))).resolves.toMatchObject({ change: 'loaded' });
    expect(managers.changes()).toEqual(['systemctl --user enable --now mawsd.service']);
    expect(readdirSync(join(home, '.local/share/maws/mawsd/releases')).sort()).toEqual(['0.0.0-aaaaaaaa', '0.0.0-bbbbbbbb', '0.0.0-cccccccc']);
  });

  it('a failed restart after a flip puts current back, so the next install flips and restarts again', async () => {
    const profileDir = linuxProfile();
    await installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram('aaaaaaaa') }, deps('linux'));
    managers.script('systemctl --user restart mawsd.service', { status: 1, stderr: 'Job for mawsd.service failed.' });
    managers.calls.length = 0;
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram('bbbbbbbb') }, deps('linux'))).rejects.toThrow('Job for mawsd.service failed.');
    expect(readlinkSync(current())).toBe('releases/0.0.0-aaaaaaaa'); // the daemon still runs a, and current says so
    expect(readdirSync(join(home, '.local/share/maws/mawsd/releases')).sort()).toEqual(['0.0.0-aaaaaaaa', '0.0.0-bbbbbbbb']); // b stays installed

    managers.calls.length = 0;
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram('bbbbbbbb') }, deps('linux'))).resolves.toMatchObject({ change: 'updated', release: { release: '0.0.0-bbbbbbbb', previous: '0.0.0-aaaaaaaa', flipped: true } });
    expect(managers.changes()).toEqual(['systemctl --user restart mawsd.service']);
    expect(readlinkSync(current())).toBe('releases/0.0.0-bbbbbbbb');
  });

  it('an installed unit whose user manager is unreachable for one install keeps its release; the reachable retry restarts onto the new one', async () => {
    const profileDir = linuxProfile();
    await installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram('aaaaaaaa') }, deps('linux'));
    managers.userManager = false; // the lingering unit's daemon runs a; its bus is unreachable for a moment
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram('bbbbbbbb') }, deps('linux'))).rejects.toMatchObject({ code: 2 });
    expect(readlinkSync(current())).toBe('releases/0.0.0-aaaaaaaa');

    managers.userManager = true;
    managers.calls.length = 0;
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram('bbbbbbbb') }, deps('linux'))).resolves.toMatchObject({ change: 'updated', release: { release: '0.0.0-bbbbbbbb', previous: '0.0.0-aaaaaaaa', flipped: true } });
    expect(managers.changes()).toEqual(['systemctl --user restart mawsd.service']);
    expect(readlinkSync(current())).toBe('releases/0.0.0-bbbbbbbb');
  });

  it('a first install whose unit fails to load leaves no current; with no user manager current stays for the command line', async () => {
    const profileDir = linuxProfile();
    managers.script('systemctl --user enable --now mawsd.service', { status: 1, stderr: 'Failed to enable unit' });
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram('aaaaaaaa') }, deps('linux'))).rejects.toThrow('Failed to enable unit');
    expect(existsSync(current())).toBe(false);
    managers.userManager = false;
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram('aaaaaaaa') }, deps('linux'))).rejects.toMatchObject({ code: 2 });
    expect(readlinkSync(current())).toBe('releases/0.0.0-aaaaaaaa');
    expect(readFileSync(wrapperPath(profileDir), 'utf8')).toContain(`exec '${current()}/runtime/bin/node'`);
  });

  it('a scratch label installs no release: its unit runs the program it was given', async () => {
    const program = linuxProgram();
    await expect(installDaemon({ profileDir: join(home, 'scratch'), label: 'dev.maws.mawsd.e2e-4', program }, deps('linux'))).resolves.toMatchObject({ release: null });
    expect(readFileSync(join(home, '.config', 'systemd', 'user', 'dev.maws.mawsd.e2e-4.service'), 'utf8')).toContain(`ExecStart=${program.runtime} `);
    expect(existsSync(current())).toBe(false);
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
    expect(installed.ignoredDelegationId).toBeNull();
    expect(again.ignoredDelegationId).toBe('fedcba9876543210fedcba9876543210'); // O14 residue 9: said, not silent
    const same = await installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram(), delegationId: DELEGATION }, deps('linux'));
    expect(same.ignoredDelegationId).toBeNull(); // the existing ref is already this delegation's
  });

  it('names an existing unprefixed identity\'s id as ignored too, and an install without the flag ignores nothing', async () => {
    const profileDir = linuxProfile();
    const plain = readOrMintMachineRef(profileDir);
    const installed = await installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram(), delegationId: DELEGATION }, deps('linux'));
    expect(installed).toMatchObject({ ref: plain, ignoredDelegationId: DELEGATION });
    expect((await installDaemon({ profileDir, label: 'dev.maws.mawsd', program: linuxProgram() }, deps('linux'))).ignoredDelegationId).toBeNull();
  });
});

describe('the canonical unit runs a packaged build only (residue 21)', () => {
  it('on macOS, refuses an entry outside an app.asar under the default label, before writing anything', async () => {
    const profileDir = darwinProfile();
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: CHECKOUT }, deps('darwin'))).rejects.toThrow(`${CHECKOUT.entry} is not inside a packaged app's app.asar`);
    expect(existsSync(profileDir)).toBe(false);
    expect(managers.calls).toEqual([]);
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: PROGRAM }, deps('darwin'))).resolves.toMatchObject({ change: 'loaded' });
  });

  it('on Linux, refuses a program that is not a pack, before writing anything', async () => {
    const profileDir = linuxProfile();
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: CHECKOUT }, deps('linux'))).rejects.toThrow(`${CHECKOUT.entry} is not a mawsd release (pnpm mawsd:pack makes one)`);
    const named = { runtime: join(current(), 'runtime/bin/node'), entry: join(current(), 'out/main/mawsd.js') }; // current/ with nothing installed there
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: named }, deps('linux'))).rejects.toThrow('is not a mawsd release');
    const bare = packProgram(fakePack(join(home, 'mac-dist'), 'ffffffff', { runtime: false })); // a pack made on a Mac carries no runtime
    await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd', program: bare }, deps('linux'))).rejects.toThrow('has no runtime/bin/node');
    expect(existsSync(profileDir)).toBe(false);
    expect(existsSync(current())).toBe(false);
    expect(managers.calls).toEqual([]);
  });

  it('lets any other label run an unpackaged build', async () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const profileDir = join(home, `scratch-${platform}`);
      await expect(installDaemon({ profileDir, label: 'dev.maws.mawsd.e2e-3', program: CHECKOUT }, deps(platform))).resolves.toMatchObject({ change: 'loaded' });
    }
  });
});
