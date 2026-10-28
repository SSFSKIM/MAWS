// `mawsd`'s LaunchAgent (P5 O2 M6; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M6 "The units" and Interfaces "The
// LaunchAgent"): `~/Library/LaunchAgents/<label>.plist`, loaded into the user's GUI domain (`gui/<uid>`). launchd starts
// `mawsd run --unit` at load, restarts it after 75 or a crash (KeepAlive's SuccessfulExit false) and never after 0, which
// is what a unit `mawsd` exits with when another holds the lock. Every `launchctl` call goes through the injected runner.
//
// A changed file takes a bootout and a fresh bootstrap, since launchd reads a job's plist only at its bootstrap; the
// bootout ends `mawsd` alone (its hosts run in sessions of their own), and the bootstrap waits, within a bound, for
// launchd to have torn the old job down. AssociatedBundleIdentifiers only groups the job under MAWS in Login Items until
// M8's TCC probe decides more.
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DAEMON_FILES } from '@shared/daemon/files';
import { must, readIfPresent, restoreFile, UnitError, within, writeWhole, type Unit, type UnitDeps, type UnitSpec } from './unit';

const APP_BUNDLE_ID = 'dev.maws.app'; // electron-builder.yml's appId
const BOOTOUT_BUDGET_MS = 5_000; // how long a bootout may take to leave the domain
const BOOTOUT_POLL_MS = 100;
// `bootstrap` right after a `bootout` can fail with 5 (Input/output error) while launchd still tears the old job down,
// even once `print` no longer finds it: retried within this bound, the last answer kept as the diagnostic.
const BOOTSTRAP_ATTEMPTS = 6;
const BOOTSTRAP_RETRY_MS = 500;
const BOOTSTRAP_EIO = 5;

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function launchdPlist({ label, profileDir, program }: UnitSpec): string {
  const dir = join(profileDir, DAEMON_FILES.dir);
  const out = join(dir, DAEMON_FILES.out);
  const string = (value: string, indent = '\t') => `${indent}<string>${xml(value)}</string>`;
  const key = (name: string, indent = '\t') => `${indent}<key>${name}</key>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    key('Label'),
    string(label),
    key('ProgramArguments'),
    '\t<array>',
    ...[program.runtime, '--disable-sigusr1', program.entry, 'run', '--unit', '--dir', dir].map((arg) => string(arg, '\t\t')),
    '\t</array>',
    key('EnvironmentVariables'),
    '\t<dict>',
    key('ELECTRON_RUN_AS_NODE', '\t\t'),
    string('1', '\t\t'),
    key('MAWS_USER_DATA', '\t\t'),
    string(profileDir, '\t\t'),
    '\t</dict>',
    key('RunAtLoad'),
    '\t<true/>',
    key('KeepAlive'),
    '\t<dict>',
    key('SuccessfulExit', '\t\t'),
    '\t\t<false/>',
    '\t</dict>',
    key('ProcessType'),
    string('Interactive'),
    key('ThrottleInterval'),
    '\t<integer>10</integer>',
    key('StandardOutPath'),
    string(out),
    key('StandardErrorPath'),
    string(out),
    key('AssociatedBundleIdentifiers'),
    '\t<array>',
    string(APP_BUNDLE_ID, '\t\t'),
    '\t</array>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export function launchdUnit(label: string, deps: UnitDeps): Unit {
  const file = join(deps.home, 'Library', 'LaunchAgents', `${label}.plist`);
  const domain = `gui/${deps.uid}`;
  const target = `${domain}/${label}`;
  const loaded = () => deps.run('launchctl', ['print', target]).status === 0;
  const bootout = async () => {
    must(deps.run, 'launchctl', ['bootout', target]);
    if (!(await within(BOOTOUT_BUDGET_MS, BOOTOUT_POLL_MS, deps.sleep, () => !loaded()))) {
      throw new UnitError(`${target} is still loaded ${BOOTOUT_BUDGET_MS / 1000} s after its bootout`);
    }
  };
  const bootstrap = async () => {
    for (let attempt = 1; ; attempt++) {
      const result = deps.run('launchctl', ['bootstrap', domain, file]);
      if (result.status === 0) return;
      if (result.status !== BOOTSTRAP_EIO || attempt >= BOOTSTRAP_ATTEMPTS) {
        const tries = attempt > 1 ? ` after ${attempt} attempts` : '';
        throw new UnitError(`launchctl bootstrap ${domain} ${file} failed${tries} (${result.status ?? 'signal'}): ${(result.stderr || result.stdout).trim()}`);
      }
      await deps.sleep(BOOTSTRAP_RETRY_MS);
    }
  };
  return {
    label,
    name: label,
    file,
    render: launchdPlist,
    state: () => ({ installed: readIfPresent(file) !== null, loaded: loaded() }),
    async apply(text) {
      const before = readIfPresent(file);
      const changed = before !== text;
      const wasLoaded = loaded();
      if (!changed && wasLoaded) return 'unchanged';
      if (changed) {
        mkdirSync(dirname(file), { recursive: true });
        writeWhole(file, text);
      }
      try {
        if (wasLoaded) await bootout(); // the file changed: launchd reads it only at a bootstrap
        await bootstrap();
      } catch (error) {
        if (changed) restoreFile(file, before); // so a retry sees the change and completes it
        throw error;
      }
      return wasLoaded ? 'updated' : 'loaded';
    },
    async remove() {
      const present = readIfPresent(file) !== null;
      const wasLoaded = loaded();
      if (wasLoaded) await bootout();
      if (present) rmSync(file, { force: true });
      return present || wasLoaded;
    },
    restart() {
      must(deps.run, 'launchctl', ['kickstart', '-k', target]);
    },
    start() {
      must(deps.run, 'launchctl', ['kickstart', target]); // P5 O2 M7: without -k, a running job is left as it is
    },
  };
}
