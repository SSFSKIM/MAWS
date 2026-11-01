// The LaunchAgent end to end (P5 O2 M7, docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7 "The suites"; acceptance
// 5's unit half): a scratch profile's `mawsd` installed through M6's command line (out/main/mawsd.js under the Electron
// binary as Node) as a LaunchAgent with a label of its own, `dev.maws.mawsd.e2e-<run>-<case>`, in the account's GUI
// domain. launchd starts `mawsd` at load; a kill -9 is followed by a new pid (KeepAlive, a crash); `mawsd restart` gives
// a new `mawsd` with the engine host's pid unchanged (the new one adopts it); `uninstall` leaves no plist and no job.
//
// P5 O5 M6 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, acceptance 6's second half): the render host's first run
// under a unit. The unit's `mawsd` (Electron as Node, under launchd) is asked an export over machine.sock with no app
// anywhere; it spawns the app's binary windowless as its own child (this checkout's Electron with the app root, as every
// scene launches the app), the PDF lands under the profile, `mawsd.log` shows the start and the quiet exit, and the
// status reads no render host after it. Its packaged case (`pnpm e2e:daemon-unit:packaged`, on a hosted Mac's packaged
// job) installs the packaged app's own `mawsd` as the unit, starts the packaged app on the profile first (its
// single-instance lock taken), and checks the render host is the bundle's binary on Interfaces §E's packaged line and
// no second instance of the app. Linux's half (the render cache's Electron under Xvfb and a systemd user unit) is
// the acceptance VM's run (spikes/u4-render-service/FINDINGS.md §4): no gate lane runs Linux e2e.
//
// It loads real LaunchAgents, so it runs only in CI (the hosted Macs, or the gate's own Mac): `pnpm e2e:daemon-unit`
// refuses outside CI before Playwright starts, and so does this file before any test (./support/daemon-unit-guard.mjs). Its
// first step removes every `dev.maws.mawsd.e2e-*` an earlier run left (.github/scripts/launchd-sweep.sh), and the gate
// job that runs the group sweeps again at its end, whatever happened. The owner's `dev.maws.mawsd` is never addressed.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { ciRefusal, e2eLabel, homeInstanceRefusal, OWNER_UNIT_LABEL, runIdOf } from './support/daemon-unit-guard.mjs';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { isAlive, killScratchProcesses, ps } from './support/processes';
import { installUnitDaemon, packagedProgram, type UnitDaemon } from './support/unit-daemon'; // P5 O5 M6

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

// The render host's binary: this checkout's Electron with the app root, or (P5 O5 M6, acceptance 6) the packaged app's
// own binary MAWS_RENDER_HOST_EXECUTABLE names (`pnpm e2e:daemon-unit:packaged`, the packaged gate job on a hosted Mac),
// resolved from the repository root as MAWS_E2E_EXECUTABLE is
const PACKAGED = process.env.MAWS_RENDER_HOST_EXECUTABLE ? resolve(REPO_ROOT, process.env.MAWS_RENDER_HOST_EXECUTABLE) : null;

// The export with no app anywhere (the checkout's), or with the packaged app running on the same profile first, holding
// its single-instance lock: the render host is the same bundle's binary, and must come up beside it as no second
// instance of it (no `second-instance` in the app, no window gained), from Interfaces §E's packaged line
// `<bundle>/Contents/MacOS/MAWS --render-host <profile>`, no app root
async function renderUnderUnit(packaged: string | null): Promise<void> {
  test.setTimeout(packaged === null ? 240_000 : 360_000);
  if (packaged === null) expect(existsSync(MAWSD), 'the build has out/main/mawsd.js (scripts/e2e-build.sh plain)').toBe(true);
  else expect(existsSync(packaged), `MAWS_RENDER_HOST_EXECUTABLE exists: ${packaged} (pnpm build:app)`).toBe(true);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-o5-unit-')));
  const profile = join(root, 'profile');
  const pids = new Set<number>();
  let unit: UnitDaemon | null = null;
  let app: MawsLaunch | null = null;
  let leftover: unknown = null;
  const log = () => (existsSync(join(profile, 'mawsd', 'mawsd.log')) ? readFileSync(join(profile, 'mawsd', 'mawsd.log'), 'utf8') : '');
  const launchedExecutable = process.env.MAWS_E2E_EXECUTABLE;
  try {
    // the scratch engine store, as a launch gives a private daemon; a short quiet period so the scene sees the host end
    const env = { CLAUDE_CONFIG_DIR: join(profile, 'claude-config'), MAWS_CLAUDE_USAGE_DIR: join(profile, 'claude-usage'), MAWS_MACHINE_ROLE: 'laptop', MAWS_RENDER_QUIET_MS: '5000' };
    unit = await installUnitDaemon({ root: REPO_ROOT, userData: profile, label: e2eLabel(RUN, packaged === null ? 'render' : 'render-packaged'), env, ...(packaged !== null && { program: packagedProgram(packaged) }) });
    pids.add(unit.pid);
    expect((await unit.status()).render, 'no render host at the unit’s start').toMatchObject({ state: 'off', pid: null });

    let windowsBefore = 0;
    if (packaged !== null) {
      // the app on the profile, its single-instance lock taken; its own start of a private mawsd loses to the unit's lock
      // and it attaches to the unit (the same build: no restart asked)
      process.env.MAWS_E2E_EXECUTABLE = packaged;
      app = await launchMaws({ userData: profile, keepConfigHome: true, env: { MAWS_HOST_MODE: 'daemon', MAWS_MACHINE_ROLE: 'laptop' } });
      pids.add(app.app.process().pid!);
      windowsBefore = await app.app.evaluate(({ app: electronApp, BrowserWindow }) => {
        const seen = globalThis as { secondInstances?: string[][] };
        seen.secondInstances = [];
        electronApp.on('second-instance', (_event, argv) => void seen.secondInstances!.push(argv));
        return BrowserWindow.getAllWindows().length;
      });
    }

    const page = '<!doctype html><html><head><title>Unit</title></head><body><h1>UNIT_RENDER_HOST</h1></body></html>';
    const { artifact } = await unit.request<{ artifact: { id: string; revision: number } }>('artifacts.create', { kind: 'html', title: 'Unit page', content: { bytes: new TextEncoder().encode(page), name: 'index.html' } });
    const exported = await unit.request<{ path: string; revision: number }>('artifacts.export', { artifactId: artifact.id, format: 'pdf' }, 150_000);
    expect(exported.path.startsWith(join(profile, 'artifacts', artifact.id, 'exports')), 'the file is under the profile').toBe(true);
    expect(readFileSync(exported.path).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const started = /\[render\] starting the render host for the library’s Export \(pid (\d+)\)/.exec(log());
    expect(started, `mawsd.log names the render host's start:\n${log()}`).not.toBeNull();
    const host = Number(started![1]);
    pids.add(host);
    expect(log()).toContain(`[render] the render host is ready (pid ${host})`);
    if (packaged !== null || isAlive(host)) {
      // the packaged case reads it within its 5 s quiet period: the export has just returned
      expect(ps(host, 'ppid'), 'the unit’s mawsd spawned it').toBe(String(unit.pid));
      expect(ps(host, 'ucomm'), 'the binary it runs').toBe(basename(packaged ?? electronBinary()));
      if (packaged === null) expect(ps(host, 'command'), 'the app’s binary, windowless, on the app root and the profile').toContain(` ${REPO_ROOT} --render-host ${profile}`);
      else expect(ps(host, 'command').split(' ').slice(1).join(' '), 'the bundle’s binary with no app root, on the profile').toBe(`--render-host ${profile}`);
    }
    if (app !== null) {
      const after = await app.app.evaluate(({ BrowserWindow }) => ({ secondInstances: (globalThis as { secondInstances?: string[][] }).secondInstances, windows: BrowserWindow.getAllWindows().length }));
      expect(after.secondInstances, 'the running app heard no second instance').toEqual([]);
      expect(after.windows, 'and gained no window').toBe(windowsBefore);
    }
    await expect.poll(log, { timeout: 30_000, message: 'the render host ended after its quiet period' }).toContain('[render] quiet for 5 s: ending the render host');
    await expect.poll(() => isAlive(host), { timeout: 15_000, message: 'the render host exited' }).toBe(false);
    expect((await unit.status()).render, 'the status reads no render host after it').toMatchObject({ state: 'off', pid: null });
  } finally {
    unit?.remove(); // before the scratch's processes end: KeepAlive would restart a killed unit
    if (app !== null) await app.cleanup().catch((error: unknown) => (leftover = error));
    if (launchedExecutable === undefined) delete process.env.MAWS_E2E_EXECUTABLE;
    else process.env.MAWS_E2E_EXECUTABLE = launchedExecutable;
    await killScratchProcesses(root, pids).catch((error: unknown) => (leftover ??= error));
    rmSync(root, { recursive: true, force: true });
  }
  if (leftover !== null) throw leftover;
}

test('the render host under the LaunchAgent: the unit’s mawsd spawns the app’s binary windowless for an export with no app, the PDF under the profile, then ends it when quiet', async () => {
  await renderUnderUnit(null);
});

test('packaged: the packaged app’s unit spawns the bundle’s own binary as the render host beside the app holding the profile’s lock, no second instance of it and no window, then ends it when quiet', async () => {
  test.skip(PACKAGED === null, 'pnpm e2e:daemon-unit:packaged names the packaged binary (MAWS_RENDER_HOST_EXECUTABLE)');
  await renderUnderUnit(PACKAGED);
});
