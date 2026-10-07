// E10's packaged check (E10 execution document, M4 Task 4.3 and Task 4.4; §Design 1 "The binary"): the packaged app,
// launched through the launcher with the engine host detached, runs its supervisor from its own binary in Node mode
// (`ELECTRON_RUN_AS_NODE=1`, which needs the `runAsNode` fuse enabled), named `maws-supervisor` in `ps`, with the
// engine-host chunk read from inside `app.asar`. It writes `docs/doperpowers/evidence/p1-e10/packaged.txt`.
// Runs only over a packaged executable with the supervisor gate on, so neither the plain smoke, nor `pnpm e2e:packaged`,
// nor `pnpm e2e:supervisor` (which names its own spec) runs it:
//   pnpm build:app && pnpm e2e:supervisor:packaged
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { HostStatus } from '@shared/ipc/schema/host';
import { invoke } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { tmpSocketDirOf } from './support/supervisor-socket';

const EXECUTABLE = process.env.MAWS_E2E_EXECUTABLE ? realpathOr(resolve(REPO_ROOT, process.env.MAWS_E2E_EXECUTABLE)) : null;
test.skip(process.env.MAWS_SUPERVISOR_E2E !== '1' || EXECUTABLE === null, 'the packaged supervisor check runs under pnpm e2e:supervisor:packaged (a packaged MAWS_E2E_EXECUTABLE and MAWS_SUPERVISOR_E2E=1)');

const EVIDENCE = join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e10');

function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path; // the launcher reports a missing executable
  }
}
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
function ps(pid: number, field: string): string {
  try {
    return execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch {
    return ''; // no such process
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
function processesNaming(text: string): number[] {
  return execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null && m[2]!.includes(text))
    .map((m) => Number(m[1]))
    .filter((pid) => pid !== process.pid);
}

test('packaged: the supervisor is the app binary run as Node, named maws-supervisor, its chunk inside app.asar', async () => {
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

    // an unbusy quit stops the supervisor with the app (residue 23)
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await exited;
    await expect.poll(() => isAlive(lock.pid), { timeout: 10_000, message: 'the supervisor exits with an unbusy quit' }).toBe(false);

    mkdirSync(EVIDENCE, { recursive: true });
    writeFileSync(
      join(EVIDENCE, 'packaged.txt'),
      [
        'E10 Task 4.3: the packaged check (e2e/supervisor-packaged.spec.ts, pnpm e2e:supervisor:packaged; unsigned build:app).',
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
  } finally {
    if (maws) await maws.cleanup().catch((error: unknown) => console.error(error));
    for (const pid of new Set([...(supervisorPid !== null ? [supervisorPid] : []), ...processesNaming(root)])) {
      if (!isAlive(pid) || !ps(pid, 'command').includes(root)) continue; // never a reused pid
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.error(error);
      }
    }
    const tmpSocketDir = socketPath !== null ? tmpSocketDirOf(userData, socketPath) : null; // a socket under root goes with it
    if (tmpSocketDir !== null) rmSync(tmpSocketDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
