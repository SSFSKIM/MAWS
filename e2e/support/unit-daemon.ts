// A build's `mawsd` as a scratch profile's LaunchAgent (P5 O5 M4; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md,
// acceptance 10): e2e:cross-build's render scenes put an app of one build on a `mawsd` of the other. A private `mawsd` of
// another build cannot hold such an app: the app's build check asks it to restart at its first status read
// (src/main/hosts/daemon.ts, watchDaemon), and the private daemon the app then starts is its own build's. A unit whose
// program is another bundle is left as it is, so the scene installs that build's `mawsd` as a unit for the profile, as
// e2e:daemon-unit does (`<build>/out/main/mawsd.js install --profile <profile> --label dev.maws.mawsd.e2e-<run>-<case>`,
// under that build's Electron as Node), with the scene's environment added to the plist (the e2e mark, the scratch
// engine store) and the job loaded again, then waits for its `mawsd` to answer `daemon.status` as a unit.
//
// It loads a LaunchAgent, so it runs in CI alone (./daemon-unit-guard.mjs's refusal) and on a Mac; `remove` boots the job
// out and deletes its plist, and the gate job's sweep (.github/scripts/launchd-sweep.sh) removes whatever a failed run
// left under the label prefix.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { daemonPaths } from '@shared/daemon/files';
import type { DaemonStatus } from '@shared/ipc/schema/daemon';
import { reachMachine } from '../../src/mawsd/machine-client';

const UID = process.getuid?.() ?? -1;
const SERVE_WITHIN_MS = 45_000; // launchd's start, and a restart past its ThrottleInterval (10 s)

export interface UnitDaemon {
  label: string;
  pid: number; // the unit's `mawsd` once it served with the scene's environment
  status(): Promise<DaemonStatus>;
  request<T>(name: string, input?: unknown, timeoutMs?: number): Promise<T>; // a bare machine.sock client's, as the CLI's
  remove(): void;
}

const electronOf = (root: string) => join(root, 'node_modules', 'electron', 'dist', readFileSync(join(root, 'node_modules', 'electron', 'path.txt'), 'utf8').trim());

function jobPid(label: string): number | null {
  const printed = spawnSync('launchctl', ['print', `gui/${UID}/${label}`], { encoding: 'utf8' });
  if (printed.status !== 0) return null;
  const pid = /^\s*pid = (\d+)$/m.exec(printed.stdout);
  return pid ? Number(pid[1]) : null;
}

// `root`: the build's checkout, its out/ built; `env`: what the plist adds to the unit's own environment
export async function installUnitDaemon(o: { root: string; userData: string; label: string; env: Record<string, string> }): Promise<UnitDaemon> {
  const mawsd = join(o.root, 'out', 'main', 'mawsd.js');
  expect(existsSync(mawsd), `${o.root} has out/main/mawsd.js`).toBe(true);
  const plist = join(homedir(), 'Library', 'LaunchAgents', `${o.label}.plist`);
  const cliEnv: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete cliEnv.MAWS_USER_DATA;
  delete cliEnv.MAWS_MAWSD_LABEL;
  const remove = () => {
    spawnSync('launchctl', ['bootout', `gui/${UID}/${o.label}`]);
    rmSync(plist, { force: true });
  };
  const installed = spawnSync(electronOf(o.root), [mawsd, 'install', '--profile', o.userData, '--label', o.label], { encoding: 'utf8', env: cliEnv, timeout: 60_000 });
  expect(installed.status, `${installed.stdout}${installed.stderr}`).toBe(0);
  try {
    // the scene's environment, then the job loaded again with it (bootout ends the first mawsd, which served nothing yet)
    spawnSync('launchctl', ['bootout', `gui/${UID}/${o.label}`]);
    for (const [key, value] of Object.entries(o.env)) {
      const set = spawnSync('plutil', ['-replace', `EnvironmentVariables.${key}`, '-string', value, plist], { encoding: 'utf8' });
      expect(set.status, `plutil ${key}: ${set.stderr}`).toBe(0);
    }
    await expect.poll(() => jobPid(o.label), { timeout: 15_000, message: 'the first mawsd booted out' }).toBeNull();
    const loaded = spawnSync('launchctl', ['bootstrap', `gui/${UID}`, plist], { encoding: 'utf8' });
    expect(loaded.status, `launchctl bootstrap: ${loaded.stderr}`).toBe(0);

    const paths = daemonPaths(o.userData);
    const request = async <T>(name: string, input?: unknown, timeoutMs?: number): Promise<T> => {
      const reached = await reachMachine(paths, { build: 'e2e-unit-daemon' });
      if (!reached.ok) throw new Error(`machine.sock: ${reached.state}: ${reached.why}`);
      try {
        const answer = await reached.link.request(name, input, timeoutMs);
        if (!answer.ok) throw new Error(`${name}: ${answer.error.code} ${answer.error.message}`);
        return answer.value as T;
      } finally {
        reached.link.close();
      }
    };
    const status = () => request<DaemonStatus>('daemon.status');
    let pid: number | null = null;
    await expect
      .poll(async () => {
        pid = jobPid(o.label);
        const read = pid === null ? null : await status().catch(() => null);
        return read !== null && read.pid === pid && read.kind === 'unit';
      }, { timeout: SERVE_WITHIN_MS, message: `the unit ${o.label}'s mawsd answers daemon.status` })
      .toBe(true);
    return { label: o.label, pid: pid!, status, request, remove };
  } catch (error) {
    remove();
    throw error;
  }
}
