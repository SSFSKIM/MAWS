// E10's packaged check (E10 execution document, M4 Task 4.3 and Task 4.4; §Design 1 "The binary"): the packaged app,
// launched through the launcher with the engine host detached, runs its supervisor from its own binary in Node mode
// (`ELECTRON_RUN_AS_NODE=1`, which needs the `runAsNode` fuse enabled), named `maws-supervisor` in `ps`, with the
// engine-host chunk read from inside `app.asar`. Under MAWS_E10_SHOTS=1 (E11 W-E: a gate run leaves the committed
// evidence alone) it writes `docs/doperpowers/evidence/p1-e10/packaged.txt` whole, so a rerun changes only the run's
// own values (the gate results belong in the execution document's Concrete Steps).
// Runs only over a packaged executable with the supervisor gate on, so neither the plain smoke, nor `pnpm e2e:packaged`,
// nor `pnpm e2e:supervisor` (which names its own spec) runs it:
//   pnpm build:app && pnpm e2e:supervisor:packaged
// P5 O2 M7 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7 "The suites"): under `MAWS_HOST_MODE=daemon`
// (`pnpm e2e:supervisor-daemon:packaged`, a step of the gate's packaged job) the daemon shape's check runs instead: the
// private `mawsd` of a scratch profile is the app binary run as Node, named `mawsd`, its entry inside `app.asar`, and
// the engine host it starts is the app binary named `maws-supervisor` as above. It installs no LaunchAgent, and fails
// if it creates, removes or rewrites anything of the account's canonical `dev.maws.mawsd` that the job could cause: its
// plist, the default profile's sockets and lock, or that profile's mawsd/ tree, less what a live canonical mawsd writes
// on its own (O14 residue 18: the gate's Mac runs a real one; ./support/canonical-mawsd.ts).
//   pnpm build:app && pnpm e2e:supervisor-daemon:packaged
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { HostStatus } from '@shared/ipc/schema/host';
import { invoke } from './support/c7-replay';
import { canonicalDifferences, canonicalPaths, snapshotCanonical } from './support/canonical-mawsd'; // O14 residue 18
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { INSPECTOR_LINE, inspectorPortHolders, isAlive, killScratchProcesses, ps, tcpListeners } from './support/processes';
import { tmpSocketDirOf } from './support/supervisor-socket';

const EXECUTABLE = process.env.MAWS_E2E_EXECUTABLE ? realpathOr(resolve(REPO_ROOT, process.env.MAWS_E2E_EXECUTABLE)) : null;
test.skip(process.env.MAWS_SUPERVISOR_E2E !== '1' || EXECUTABLE === null, 'the packaged supervisor check runs under pnpm e2e:supervisor:packaged (a packaged MAWS_E2E_EXECUTABLE and MAWS_SUPERVISOR_E2E=1)');

const EVIDENCE = process.env.MAWS_E10_SHOTS === '1' ? join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e10') : null;
const DAEMON = process.env.MAWS_HOST_MODE === 'daemon';

function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path; // the launcher reports a missing executable
  }
}
// The process's executable: `lsof`'s first text (mapped program) file, which needs no privilege for one's own process.
// `ps -o comm=` follows argv0, so it reads `maws-supervisor`, not the binary.
function executableOf(pid: number): string {
  const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'txt', '-Fn'], { encoding: 'utf8' });
  const first = out.split('\n').find((line) => line.startsWith('n'));
  if (!first) throw new Error(`lsof lists no text file for pid ${pid}`);
  return first.slice(1);
}

test('packaged: the supervisor is the app binary run as Node, named maws-supervisor, its chunk inside app.asar', async () => {
  test.skip(DAEMON, 'the embedded shape’s check (pnpm e2e:supervisor:packaged)');
  test.setTimeout(120_000);
  const exe = EXECUTABLE!;
  const macOS = dirname(exe); // …/MAWS.app/Contents/MacOS
  const bundle = resolve(macOS, '../..');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-e10-packaged-')));
  const userData = join(root, 'ud');
  mkdirSync(userData);
  let maws: MawsLaunch | null = null;
  let socketPath: string | null = null;
  let supervisorPid: number | null = null;
  let leftover: unknown = null; // a survivor, reported after the files are removed all the same (the body's error first)
  try {
    const fuses = execFileSync(join(REPO_ROOT, 'node_modules/.bin/electron-fuses'), ['read', '--app', bundle], { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } }).trimEnd();
    expect(fuses, 'the runAsNode fuse is enabled').toMatch(/^\s*RunAsNode is Enabled$/m);

    maws = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_HOST_MODE: 'detached' } });
    const app = maws.app;
    const appPid = app.process().pid!;
    const exited = new Promise<void>((done) => app.process().once('exit', () => done()));

    let status: HostStatus | null = null;
    await expect
      .poll(async () => {
        const answer = await invoke(maws!.page, 'host.status', undefined);
        status = answer.ok ? answer.value : null;
        return status !== null && status.state === 'ready' && status.supervisor !== null;
      }, { timeout: 30_000, message: 'main is connected to a supervisor' })
      .toBe(true);
    const s = status as unknown as HostStatus;
    expect(s.transport).toBe('detached');
    expect(s.supervisor!.mode).toBe('detached');
    supervisorPid = s.supervisor!.pid;
    socketPath = s.supervisor!.socketPath;

    const lockPath = join(userData, 'supervisor', 'host.lock');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number; socketPath: string };
    expect(lock.pid, 'the lock names the connected supervisor').toBe(supervisorPid);
    expect(isAlive(lock.pid)).toBe(true);
    expect(lock.pid).not.toBe(appPid);

    const command = ps(lock.pid, 'command');
    const comm = ps(lock.pid, 'comm');
    const ucomm = ps(lock.pid, 'ucomm');
    const pgid = ps(lock.pid, 'pgid');
    const binary = realpathOr(executableOf(lock.pid));
    expect(command.split(' ')[0], 'argv0').toBe('maws-supervisor');
    expect(command, 'the engine-host chunk is read from inside the asar').toContain(`${bundle}/Contents/Resources/app.asar/`);
    expect(command).toContain(` --detached ${join(userData, 'supervisor')}`);
    expect(binary.startsWith(`${macOS}/`), `the executable ${binary} lies inside ${macOS}/`).toBe(true);
    expect(binary, 'the supervisor runs the app binary itself').toBe(exe);
    expect(Number(pgid), 'the supervisor leads its own process group').toBe(lock.pid);
    expect(maws.consoleErrors()).toEqual([]);

    // a same-user SIGUSR1 opens no Node inspector in the supervisor (closed 2026-10-10: the socket peer authentication
    // spec's SIGUSR1 route; `--disable-sigusr1` at the spawn, src/shared/host/detached-transport.ts, and the entry's
    // listener, src/engine-host/detached.ts): it stays alive, listens on no new TCP address and its log (its stderr)
    // holds no inspector line; with 9229 taken an inspector could not bind, so the port must be free first
    expect(command, 'the supervisor starts with --disable-sigusr1').toMatch(/^maws-supervisor --disable-sigusr1 /);
    expect(inspectorPortHolders(), 'something already listens on 127.0.0.1:9229: free it, or an inspector could not bind and this check would pass falsely').toEqual([]);
    const listenersBefore = tcpListeners(lock.pid);
    process.kill(lock.pid, 'SIGUSR1');
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(isAlive(lock.pid), 'the supervisor survives SIGUSR1').toBe(true);
    expect(tcpListeners(lock.pid), 'no inspector opened in the supervisor').toEqual(listenersBefore);
    expect(readFileSync(join(userData, 'supervisor', 'host.log'), 'utf8'), 'no inspector started or tried to start').not.toMatch(INSPECTOR_LINE);

    // an unbusy quit stops the supervisor with the app (residue 23)
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await exited;
    await expect.poll(() => isAlive(lock.pid), { timeout: 10_000, message: 'the supervisor exits with an unbusy quit' }).toBe(false);

    if (EVIDENCE !== null) {
      mkdirSync(EVIDENCE, { recursive: true });
      writeFileSync(
        join(EVIDENCE, 'packaged.txt'),
        [
          'E10 Task 4.3: the packaged check (e2e/supervisor-packaged.spec.ts, pnpm e2e:supervisor:packaged; unsigned build:app).',
          "Written whole by the spec on every run under MAWS_E10_SHOTS=1; the gate results are in the execution document's Concrete Steps.",
          `Executable: ${exe}`,
          '',
          `electron-fuses read --app ${bundle}:`,
          fuses,
          '',
          'The packaged app launched through launchMaws with MAWS_HOST_MODE=detached (scratch userData):',
          `  host.status.transport: ${s.transport}`,
          `  host.status.supervisor.mode: ${s.supervisor!.mode}`,
          `  host.status.state: ${s.state}; matches: ${s.matches}`,
          `  supervisor pid (host.status and supervisor/host.lock): ${lock.pid}; app pid ${appPid}; pgid ${pgid}`,
          `  ps -o command=: ${command}`,
          `  ps -o comm= (follows argv0): ${comm}`,
          `  ps -o ucomm= (the kernel's name, the executable's): ${ucomm}`,
          `  executable (lsof -d txt, realpath): ${binary}`,
          '',
          'Results (every assertion held):',
          '  RunAsNode is Enabled',
          "  transport === 'detached' and supervisor.mode === 'detached'",
          '  argv0 is maws-supervisor; the chunk is under MAWS.app/Contents/Resources/app.asar/',
          '  the executable lies inside MAWS.app/Contents/MacOS/ and is the app binary itself',
          '  the supervisor leads its own process group; no console error',
          '  an unbusy quit stopped the supervisor (pid gone)',
        ].join('\n') + '\n',
      );
    }
  } finally {
    if (maws) await maws.cleanup().catch((error: unknown) => console.error(error));
    // E11 W-E: the survivor check of supervisor.spec.ts's cleanup, so a run that leaves a supervisor behind fails
    await killScratchProcesses(root, supervisorPid !== null ? [supervisorPid] : []).catch((error: unknown) => (leftover = error));
    const tmpSocketDir = socketPath !== null ? tmpSocketDirOf(userData, socketPath) : null; // a socket under root goes with it
    if (tmpSocketDir !== null) rmSync(tmpSocketDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
  if (leftover !== null) throw leftover;
});

test('packaged, the daemon shape: mawsd is the app binary run as Node, named mawsd, its entry inside app.asar', async () => {
  test.skip(!DAEMON, 'the daemon shape’s check (pnpm e2e:supervisor-daemon:packaged)');
  test.setTimeout(120_000);
  const exe = EXECUTABLE!;
  const macOS = dirname(exe);
  const bundle = resolve(macOS, '../..');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-o2-packaged-')));
  const userData = join(root, 'ud'); // not the default profile: a private mawsd, never the LaunchAgent
  mkdirSync(userData);
  // The account's canonical mawsd is never touched, even by a packaged app: the gate's Mac runs the owner's real one
  // once its account is cut over (O14), so the check fails if the job creates, removes or rewrites anything of it the job
  // could cause, whether or not each part exists (./support/canonical-mawsd.ts says which differences count).
  const canonical = canonicalPaths();
  const canonicalBefore = snapshotCanonical(canonical);
  let maws: MawsLaunch | null = null;
  const pids: number[] = [];
  let leftover: unknown = null;
  try {
    maws = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_HOST_MODE: 'daemon' } });
    const app = maws.app;
    const exited = new Promise<void>((done) => app.process().once('exit', () => done()));
    let status: HostStatus | null = null;
    await expect
      .poll(async () => {
        const answer = await invoke(maws!.page, 'host.status', undefined);
        status = answer.ok ? answer.value : null;
        return status !== null && status.state === 'ready' && status.supervisor !== null && status.daemon !== null;
      }, { timeout: 30_000, message: 'main is connected to the engine host through mawsd' })
      .toBe(true);
    const s = status as unknown as HostStatus;
    expect(s.transport).toBe('daemon');
    expect(s.daemon!.kind).toBe('private');
    const daemonPid = s.daemon!.pid;
    const enginePid = s.supervisor!.pid;
    pids.push(daemonPid, enginePid);
    const lock = JSON.parse(readFileSync(join(userData, 'mawsd', 'mawsd.lock'), 'utf8')) as { pid: number };
    expect(lock.pid, 'the lock names the daemon main reports').toBe(daemonPid);

    const command = ps(daemonPid, 'command');
    expect(command.split(' ')[0], 'argv0').toBe('mawsd');
    expect(command, 'the entry is read from inside the asar').toContain(`${bundle}/Contents/Resources/app.asar/out/main/mawsd.js run --private --dir ${join(userData, 'mawsd')}`);
    expect(command, 'mawsd starts with --disable-sigusr1').toMatch(/^mawsd --disable-sigusr1 /);
    expect(realpathOr(executableOf(daemonPid)), 'mawsd runs the app binary itself').toBe(exe);
    expect(Number(ps(daemonPid, 'pgid')), 'mawsd leads its own process group').toBe(daemonPid);
    // the engine host it started: the app binary as Node too, from the same asar
    const engine = ps(enginePid, 'command');
    expect(engine.split(' ')[0]).toBe('maws-supervisor');
    expect(engine).toContain(`${bundle}/Contents/Resources/app.asar/`);
    expect(realpathOr(executableOf(enginePid))).toBe(exe);
    expect(maws.consoleErrors()).toEqual([]);

    // an unbusy quit parks the engine host; mawsd stays for its idle time
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await exited;
    await expect.poll(() => isAlive(enginePid), { timeout: 10_000, message: 'the unbusy quit parks the engine host' }).toBe(false);
    expect(canonicalDifferences(canonicalBefore, snapshotCanonical(canonical)), "the account's canonical mawsd (its plist, sockets, lock and profile) is untouched").toEqual([]);
  } finally {
    if (maws) await maws.cleanup().catch((error: unknown) => console.error(error));
    await killScratchProcesses(root, pids).catch((error: unknown) => (leftover = error));
    rmSync(root, { recursive: true, force: true });
  }
  if (leftover !== null) throw leftover;
});
