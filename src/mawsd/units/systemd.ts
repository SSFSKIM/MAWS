// `mawsd`'s systemd user unit (P5 O2 M6, M8; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M6 "The units", M8
// "Surviving logout and restart", Interfaces "The systemd user unit"): `${XDG_CONFIG_HOME:-~/.config}/systemd/user/<unit>`,
// `mawsd.service` for the default label and `<label>.service` for any other. `KillMode=process`, so stopping or
// restarting the unit ends `mawsd` alone and the hosts and their sessions stay; `Restart=on-failure`, so 75 or a crash
// restarts it and 0 does not; lingering, so the user manager outlives the last logout. Every `systemctl --user`,
// `loginctl` and `sudo -n` call goes through the injected runner.
//
// The program and runtime paths are the caller's: M8 installs a release directory and passes its `current` paths.
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DAEMON_FILES } from '@shared/daemon/files';
import { configHome } from '@shared/daemon/profile';
import { DEFAULT_LABEL, must, readIfPresent, restoreFile, UnitError, writeWhole, type Unit, type UnitDeps, type UnitSpec } from './unit';

export function systemdUnitName(label: string): string {
  return label === DEFAULT_LABEL ? 'mawsd.service' : `${label}.service`;
}

// One word of a unit file: `%` and `$` doubled (systemd's specifiers and variables), and the word double-quoted, with
// its backslashes and quotes escaped, when it holds anything that would split or end it.
function word(value: string, expandsVariables: boolean): string {
  let text = value.replace(/%/g, '%%');
  if (expandsVariables) text = text.replace(/\$/g, '$$$$');
  return /[\s"'\\]/.test(text) ? `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : text;
}

export function systemdUnitText({ profileDir, program }: UnitSpec): string {
  const exec = [program.runtime, '--disable-sigusr1', program.entry, 'run', '--unit', '--dir', join(profileDir, DAEMON_FILES.dir)];
  return [
    '[Unit]',
    'Description=MAWS machine daemon (mawsd)',
    '',
    '[Service]',
    `ExecStart=${exec.map((arg) => word(arg, true)).join(' ')}`,
    `Environment=${word(`MAWS_USER_DATA=${profileDir}`, false)}`,
    'Restart=on-failure',
    'RestartSec=2',
    'KillMode=process',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

export function systemdUnit(label: string, deps: UnitDeps): Unit {
  const name = systemdUnitName(label);
  const file = join(configHome(deps.env, deps.home), 'systemd', 'user', name);
  const ctl = (...args: string[]) => deps.run('systemctl', ['--user', ...args]);
  const enabled = () => ctl('is-enabled', name).stdout.trim() === 'enabled';
  const active = () => ctl('is-active', name).stdout.trim() === 'active';
  const reachable = () => {
    const shown = ctl('show-environment');
    if (shown.status !== 0) throw new UnitError(`systemctl --user has no user manager here, so no unit is installed: ${(shown.stderr || shown.stdout).trim()}`, 2);
  };
  const linger = () => {
    const shown = deps.run('loginctl', ['show-user', deps.user, '--property=Linger', '--value']);
    if (shown.status === 0 && shown.stdout.trim() === 'yes') return;
    if (deps.run('loginctl', ['enable-linger', deps.user]).status === 0) return;
    const sudo = deps.run('sudo', ['-n', 'loginctl', 'enable-linger', deps.user]);
    if (sudo.status !== 0) throw new UnitError(`lingering could not be enabled for ${deps.user}, so mawsd stops at logout: ${(sudo.stderr || sudo.stdout).trim()}`);
  };
  return {
    label,
    name,
    file,
    render: systemdUnitText,
    state: () => ({ installed: readIfPresent(file) !== null, loaded: enabled() }),
    async apply(text) {
      reachable();
      const before = readIfPresent(file);
      const wasEnabled = enabled();
      const wasActive = active();
      const changed = before !== text;
      if (changed) {
        mkdirSync(dirname(file), { recursive: true });
        writeWhole(file, text); // its temporary name never ends in `.service`, so systemd never reads it
      }
      try {
        if (changed) must(deps.run, 'systemctl', ['--user', 'daemon-reload']);
        if (!wasEnabled || !wasActive) must(deps.run, 'systemctl', ['--user', 'enable', '--now', name]);
        if (changed && wasActive) must(deps.run, 'systemctl', ['--user', 'restart', name]);
      } catch (error) {
        if (changed) {
          // so a retry sees the change and completes it; the manager reloads the file as it was, best effort
          restoreFile(file, before);
          deps.run('systemctl', ['--user', 'daemon-reload']);
        }
        throw error;
      }
      linger(); // checked at every apply, so a failure here is retried by the next
      if (changed) return before === null || !wasActive ? 'loaded' : 'updated';
      return wasEnabled && wasActive ? 'unchanged' : 'loaded';
    },
    async remove() {
      const present = readIfPresent(file) !== null;
      const wasEnabled = enabled();
      const wasActive = active();
      if (wasEnabled || wasActive) must(deps.run, 'systemctl', ['--user', 'disable', '--now', name]);
      if (present) {
        rmSync(file, { force: true });
        must(deps.run, 'systemctl', ['--user', 'daemon-reload']);
      }
      return present || wasEnabled || wasActive;
    },
    restart() {
      must(deps.run, 'systemctl', ['--user', 'restart', name]);
    },
    start() {
      must(deps.run, 'systemctl', ['--user', 'start', name]); // P5 O2 M7
    },
  };
}
