// E10's packaged check (E10 execution document, M4 Task 4.3 and Task 4.4; §Design 1 "The binary"), on the daemon shape
// (P5 O2 M7, docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7 "The suites"): the packaged app, launched through the
// launcher, starts the private `mawsd` of a scratch profile from its own binary in Node mode (`ELECTRON_RUN_AS_NODE=1`,
// which needs the `runAsNode` fuse enabled), named `mawsd`, its entry inside `app.asar`; the engine host it starts is
// the app binary named `maws-supervisor`, its chunk read from inside `app.asar`. Both lead their own process groups and
// start with `--disable-sigusr1`, and a same-user SIGUSR1 opens no inspector in the engine host. It installs no
// LaunchAgent, and fails if it creates, removes or rewrites anything of the account's canonical `dev.maws.mawsd` that
// the job could cause: its plist, the default profile's sockets and lock, or that profile's mawsd/ tree, less what a live
// canonical mawsd writes on its own (O14 residue 18: the gate's Mac runs a real one; ./support/canonical-mawsd.ts).
// Runs only over a packaged executable with the supervisor gate on, so neither the plain smoke, nor `pnpm e2e:packaged`,
// nor `pnpm e2e:supervisor-daemon` (which names its own spec) runs it; a step of the gate's packaged job:
//   pnpm build:app && pnpm e2e:supervisor-daemon:packaged
// P5 O15 M1 (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): the embedded shape's check is gone with that
// shape; what of it held for either shape (the fuse, the engine host's group, `--disable-sigusr1` and SIGUSR1) moved here.
// Under MAWS_E10_SHOTS=1 (E11 W-E: a gate run leaves the committed evidence alone) the embedded check wrote
// docs/doperpowers/evidence/p1-e10/packaged.txt; that file stays as its record.
// P5 O10 M10 (the architect's ruling on acceptance 14): that `mawsd` loads its endpoint at the first command that needs
// it, a deferred load of a chunk beside mawsd.js, while a read-only one on an unenrolled machine is answered without it.
// So the check runs both through the packaged binary as Node: `mawsd endpoint status` answers unenrolled and loads
// nothing, and `mawsd enroll` with a code that is none loads the module from inside `app.asar`, whose own decoder
// refuses it before anything is written or sent; a package that left the chunk out answers that it could not be loaded.
// The O17 footprint fix: the zod the app ships (app.asar's, which electron-builder copies from the installed tree) carries
// patches/zod@4.6.5.patch, read by the app binary as Node as mawsd and the engine host require it (e2e/support/zod-locales.ts).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { HostStatus } from '@shared/ipc/schema/host';
import { invoke } from './support/c7-replay';
import { canonicalDifferences, canonicalPaths, snapshotCanonical } from './support/canonical-mawsd'; // O14 residue 18
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { INSPECTOR_LINE, inspectorPortHolders, isAlive, killScratchProcesses, ps, tcpListeners } from './support/processes';
import { resourcesOf } from './support/packaged-resolution';
import { launchEnvironment } from './support/scratch-env';
import { runZodLocales, zodLocaleProblems } from './support/zod-locales'; // the O17 footprint fix

const EXECUTABLE = process.env.MAWS_E2E_EXECUTABLE ? realpathOr(resolve(REPO_ROOT, process.env.MAWS_E2E_EXECUTABLE)) : null;
test.skip(process.env.MAWS_SUPERVISOR_E2E !== '1' || EXECUTABLE === null, 'the packaged supervisor check runs under pnpm e2e:supervisor-daemon:packaged (a packaged MAWS_E2E_EXECUTABLE and MAWS_SUPERVISOR_E2E=1)');


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

test('packaged, the daemon shape: mawsd is the app binary run as Node, named mawsd, its entry inside app.asar', async () => {
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
    const fuses = execFileSync(join(REPO_ROOT, 'node_modules/.bin/electron-fuses'), ['read', '--app', bundle], { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } }).trimEnd();
    expect(fuses, 'the runAsNode fuse is enabled').toMatch(/^\s*RunAsNode is Enabled$/m);

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
    // the engine host it started: the app binary as Node too, from the same asar, in a process group of its own
    const engine = ps(enginePid, 'command');
    expect(engine.split(' ')[0], 'argv0').toBe('maws-supervisor');
    expect(engine, 'the engine-host chunk is read from inside the asar').toContain(`${bundle}/Contents/Resources/app.asar/`);
    expect(engine).toContain(` --detached ${join(userData, 'supervisor')}`);
    expect(realpathOr(executableOf(enginePid)), 'the engine host runs the app binary itself').toBe(exe);
    expect(Number(ps(enginePid, 'pgid')), 'the engine host leads its own process group').toBe(enginePid);
    expect(maws.consoleErrors()).toEqual([]);

    // a same-user SIGUSR1 opens no Node inspector in the engine host (closed 2026-10-10: the socket peer authentication
    // spec's SIGUSR1 route; `--disable-sigusr1` at the spawn, src/shared/host/detached-transport.ts, and the entry's
    // listener, src/engine-host/detached.ts): it stays alive, listens on no new TCP address and its log (its stderr)
    // holds no inspector line; with 9229 taken an inspector could not bind, so the port must be free first
    expect(engine, 'the engine host starts with --disable-sigusr1').toMatch(/^maws-supervisor --disable-sigusr1 /);
    expect(inspectorPortHolders(), 'something already listens on 127.0.0.1:9229: free it, or an inspector could not bind and this check would pass falsely').toEqual([]);
    const listenersBefore = tcpListeners(enginePid);
    process.kill(enginePid, 'SIGUSR1');
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(isAlive(enginePid), 'the engine host survives SIGUSR1').toBe(true);
    expect(tcpListeners(enginePid), 'no inspector opened in the engine host').toEqual(listenersBefore);
    expect(readFileSync(join(userData, 'supervisor', 'host.log'), 'utf8'), 'no inspector started or tried to start').not.toMatch(INSPECTOR_LINE);

    // P5 O10 M10: unenrolled, `endpoint status` answers without the endpoint; `enroll` loads it from its chunk inside the asar
    const mawsdLog = () => readFileSync(join(userData, 'mawsd', 'mawsd.log'), 'utf8');
    const mawsd = (args: string[], input = '') => {
      const ran = spawnSync(exe, [`${bundle}/Contents/Resources/app.asar/out/main/mawsd.js`, ...args], { env: { ...launchEnvironment(process.env, userData), ELECTRON_RUN_AS_NODE: '1' }, input, encoding: 'utf8', timeout: 30_000 });
      return { ...ran, said: `mawsd ${args.join(' ')}: ${ran.status ?? ran.signal} ${ran.stdout}${ran.stderr}\n${mawsdLog()}` };
    };
    expect(mawsdLog(), 'an unenrolled mawsd starts without its endpoint').not.toContain('loading the endpoint');
    const unenrolled = mawsd(['endpoint', 'status']);
    expect(unenrolled.status, unenrolled.said).toBe(0);
    expect(unenrolled.stdout, unenrolled.said).toBe('enrollment: none\nhub: not connected; channels: 0 relayed, 0 direct; sminos: not connected\n');
    expect(mawsdLog(), 'a read-only command loads no endpoint').not.toContain('loading the endpoint');
    const enroll = mawsd(['enroll'], 'not-a-code\n');
    expect(enroll.status, enroll.said).toBe(1);
    expect(enroll.stderr, enroll.said).toBe('not an enrollment code: not smns-enroll-v2\n');
    expect(mawsdLog()).toContain('loading the endpoint for its first command');
    expect(mawsdLog()).not.toContain('could not be loaded');

    // the quit stops nothing (P5 O3-D Q1, D12): mawsd and its engine host outlive the app, the host parked by mawsd's
    // idle clock only after the idle time (D38: 10 min; e2e:supervisor-daemon (a) proves the park with its idle seam set);
    // the scene's cleanup ends them
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await exited;
    expect([daemonPid, enginePid].filter((pid) => !isAlive(pid)), 'mawsd and its engine host outlive the app').toEqual([]);
    expect(canonicalDifferences(canonicalBefore, snapshotCanonical(canonical)), "the account's canonical mawsd (its plist, sockets, lock and profile) is untouched").toEqual([]);
  } finally {
    if (maws) await maws.cleanup().catch((error: unknown) => console.error(error));
    await killScratchProcesses(root, pids).catch((error: unknown) => (leftover = error));
    rmSync(root, { recursive: true, force: true });
  }
  if (leftover !== null) throw leftover;
});

test('packaged: the app’s zod loads no non-English locale until one is read, its English messages as before', () => {
  const exe = EXECUTABLE!;
  const asar = join(resourcesOf(exe), 'app.asar');
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete env.NODE_OPTIONS; // as the hosts run (src/shared/host/detached-transport.ts's supervisorEnv)
  const result = runZodLocales(exe, env, join(asar, 'out', 'main'));
  expect(result.zod, 'zod resolves inside app.asar').toBe(join(asar, 'node_modules', 'zod'));
  expect(zodLocaleProblems(result)).toEqual([]);
});
