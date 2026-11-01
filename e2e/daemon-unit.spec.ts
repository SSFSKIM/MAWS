// The LaunchAgent end to end (P5 O2 M7, docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7 "The suites"; acceptance
// 5's unit half): a scratch profile's `mawsd` installed through M6's command line (out/main/mawsd.js under the Electron
// binary as Node) as a LaunchAgent with a label of its own, `dev.maws.mawsd.e2e-<run>-<case>`, in the account's GUI
// domain. launchd starts `mawsd` at load; a kill -9 is followed by a new pid (KeepAlive, a crash); `mawsd restart` gives
// a new `mawsd` with the engine host's pid unchanged (the new one adopts it); `uninstall` leaves no plist and no job.
//
// It loads real LaunchAgents, so it runs only in CI (the hosted Macs, or the gate's own Mac): `pnpm e2e:daemon-unit`
// refuses outside CI before Playwright starts, and so does this file before any test (./support/daemon-unit-guard.mjs). Its
// first step removes every `dev.maws.mawsd.e2e-*` an earlier run left (.github/scripts/launchd-sweep.sh), and the gate
// job that runs the group sweeps again at its end, whatever happened. The owner's `dev.maws.mawsd` is never addressed.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ciRefusal, e2eLabel, homeInstanceRefusal, OWNER_UNIT_LABEL, runIdOf } from './support/daemon-unit-guard.mjs';
import { REPO_ROOT } from './support/launch';
import { isAlive, killScratchProcesses, ps } from './support/processes';

const ON = process.env.MAWS_DAEMON_UNIT_E2E === '1';
test.skip(!ON, 'the launchd group runs under pnpm e2e:daemon-unit (MAWS_DAEMON_UNIT_E2E=1), in CI only');
test.skip(process.platform !== 'darwin', 'launchd is macOS’s');

const RUN = runIdOf(process.env);
const UID = process.getuid?.() ?? -1;
const MAWSD = join(REPO_ROOT, 'out', 'main', 'mawsd.js');
const SWEEP = join(REPO_ROOT, '.github', 'scripts', 'launchd-sweep.sh');
const electronBinary = () => join(REPO_ROOT, 'node_modules', 'electron', 'dist', readFileSync(join(REPO_ROOT, 'node_modules', 'electron', 'path.txt'), 'utf8').trim());

interface Status {
  running: boolean;
  pid: number;
  kind: 'unit' | 'private';
  hosts: Record<'engine-host' | 'pty-host', { state: string; pid: number | null }>;
  unit: { label: string; installed: boolean; loaded: boolean } | null;
}

// launchd's pid for the job, or null while it runs none (or does not know the label).
function jobPid(label: string): number | null {
  const printed = spawnSync('launchctl', ['print', `gui/${UID}/${label}`], { encoding: 'utf8' });
  if (printed.status !== 0) return null;
  const pid = /^\s*pid = (\d+)$/m.exec(printed.stdout);
  return pid ? Number(pid[1]) : null;
}

// The refusal first, before the sweep and every test, so outside CI nothing reaches launchd; a hook, so a listing of the
// file (the gate's derivation of default's specs) never runs it.
test.beforeAll(() => {
  const refusal = ciRefusal(process.env);
  if (refusal !== null) throw new Error(refusal);
  // P5 O5 M4 (the architect's ruling): never on the mini's home instance, whose launchd holds the owner's own unit
  const home = homeInstanceRefusal(process.env, spawnSync('launchctl', ['print', `gui/${UID}/${OWNER_UNIT_LABEL}`], { encoding: 'utf8' }).status === 0);
  if (home !== null) throw new Error(`e2e:daemon-unit: ${home}`);
});

test.beforeAll(() => {
  if (!ON) return;
  console.log(execFileSync('bash', [SWEEP], { encoding: 'utf8' }).trimEnd()); // what an earlier run left
});

test('the LaunchAgent: launchd starts mawsd at load; a kill -9 is followed by a new pid; restart gives a new mawsd with the engine host unchanged; uninstall leaves no plist and no job', async () => {
  test.setTimeout(240_000);
  expect(existsSync(MAWSD), 'the build has out/main/mawsd.js (scripts/e2e-build.sh plain)').toBe(true);
  const label = e2eLabel(RUN, 'unit');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-o2-unit-')));
  const profile = join(root, 'profile');
  const plist = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  const pids = new Set<number>();
  let leftover: unknown = null; // a survivor of the scratch, the case's failure once the body passed
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete env.MAWS_USER_DATA;
  delete env.MAWS_MAWSD_LABEL;
  const cli = (...args: string[]) => {
    const run = spawnSync(electronBinary(), [MAWSD, ...args, '--profile', profile, '--label', label], { encoding: 'utf8', env, timeout: 60_000 });
    return { status: run.status, out: run.stdout, err: run.stderr, both: `${run.stdout}${run.stderr}` };
  };
  const status = (): Status | null => {
    const run = cli('status', '--json');
    return run.status === 0 ? (JSON.parse(run.out) as Status) : null;
  };
  // the running daemon as its own status reads it, once it answers with `pid` and its engine host awake
  const servedBy = async (pid: number): Promise<Status> => {
    let read: Status | null = null;
    await expect.poll(() => (read = status()) !== null && read.pid === pid && read.hosts['engine-host'].pid !== null, { timeout: 30_000, message: `mawsd pid ${pid} answers with its engine host` }).toBe(true);
    return read!;
  };
  // launchd's next pid for the job, other than `old`
  const nextPid = async (old: number | null, message: string): Promise<number> => {
    let pid: number | null = null;
    await expect.poll(() => (pid = jobPid(label)) !== null && pid !== old, { timeout: 45_000, message }).toBe(true); // ThrottleInterval is 10 s
    pids.add(pid!);
    return pid!;
  };
  try {
    const installed = cli('install');
    expect(installed.status, installed.both).toBe(0);
    expect(installed.out).toContain(`unit ${label} loaded (${plist})`);
    expect(existsSync(plist)).toBe(true);

    // launchd starts it at load (RunAtLoad), as the unit's program: this build's mawsd.js, `run --unit`
    const first = await nextPid(null, 'launchd starts mawsd at load');
    expect(ps(first, 'command')).toContain(`${realpathSync(MAWSD)} run --unit --dir ${join(profile, 'mawsd')}`);
    const one = await servedBy(first);
    expect(one).toMatchObject({ running: true, kind: 'unit', unit: { label, installed: true, loaded: true } });
    const engine = one.hosts['engine-host'].pid!; // woken by daemon.status
    pids.add(engine);

    // a kill -9 is a crash, which KeepAlive restarts; the engine host serves on and the new mawsd adopts it
    process.kill(first, 'SIGKILL');
    const second = await nextPid(first, 'launchd starts a new mawsd after its kill -9');
    expect(isAlive(first)).toBe(false);
    expect((await servedBy(second)).hosts['engine-host'].pid, 'the engine host outlives mawsd').toBe(engine);

    // restart: the unit's kickstart, a new mawsd; the engine host and its sessions keep running
    const restarted = cli('restart');
    expect(restarted.status, restarted.both).toBe(0);
    expect(restarted.out).toBe(`restarted ${label}\n`);
    const third = await nextPid(second, 'mawsd restart gives a new pid');
    expect((await servedBy(third)).hosts['engine-host'].pid, 'the engine host’s pid is unchanged').toBe(engine);
    expect(isAlive(engine)).toBe(true);

    // uninstall: no plist, no job, and the daemon ended with its job
    const removed = cli('uninstall');
    expect(removed.status, removed.both).toBe(0);
    expect(removed.out).toBe(`unit ${label} removed; the hosts and their sessions keep running\n`);
    expect(existsSync(plist), 'no plist').toBe(false);
    expect(spawnSync('launchctl', ['print', `gui/${UID}/${label}`]).status, 'no job').not.toBe(0);
    await expect.poll(() => isAlive(third), { timeout: 10_000, message: 'the bootout ends mawsd' }).toBe(false);
    expect(isAlive(engine), 'its hosts keep running').toBe(true);
  } finally {
    // whatever happened: this case's job and plist, then every process of the scratch (the engine and pty hosts)
    spawnSync('launchctl', ['bootout', `gui/${UID}/${label}`]);
    rmSync(plist, { force: true });
    await killScratchProcesses(root, pids).catch((error: unknown) => (leftover = error));
    rmSync(root, { recursive: true, force: true });
  }
  if (leftover !== null) throw leftover;
});
