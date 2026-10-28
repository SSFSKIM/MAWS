// The idle cost of what stays behind when the app has quit (P5 O2, M1; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md,
// acceptance 7; P5 acceptance 14): the physical footprint and CPU time of today's detached supervisor holding one kept
// idle session, which is the laptop's costly steady state (with no live session the supervisor exits after its idle
// time and costs nothing). The numbers, the readers, the validity rule, the baseline and the bound are
// test/support/daemon-idle.ts.
//
// The scene: the built app in detached mode over C3's replay transport, on a scratch profile whose machine-settings.json sets
// `supervisor.idleExitMinutes: null`, so neither the idle release nor the supervisor's idle exit fires. One replayed
// session plays the permission round trip, paced, and holds at its request; the request is answered and, while the
// rest of the turn plays, the app quits with the keep answer (an unbusy quit is never asked and stops the supervisor,
// so the quit is made mid-turn). The turn ends with no app connected and the session holds at its next prompt. Then a
// 120 s settle, and a 600 s window: every 30 s each measured process's physical footprint (proc_pid_rusage, P5 Decision
// Log 48) and `ps -o rss=` (each summed per sample; the RSS is a diagnostic) and the 1-minute load, and `ps -o time=` at
// the window's start and end. At the first sample top's MEM column reads the footprint a second, independent way. The
// measured processes are those of the profile whose argv0 is `maws-supervisor`; the replay has no `claude` child, and a
// real one is the session's cost, not the daemon's.
//
// The scene runs on the shape `MAWS_HOST_MODE` names, as e2e/supervisor.spec.ts does. `detached` is M1's, which recorded
// the baseline; `daemon` is M9's (acceptance 7): main reaches the engine host through a private `mawsd` on the profile,
// and what stays behind is `mawsd` and the engine host (and the pty host if it runs), measured together against
// DAEMON_IDLE_BOUND. The settings' `idleExitMinutes: null` reaches `mawsd` as `host.configure`'s, so neither its park
// clock nor its own idle exit arms.
//
// A run is valid when the load stays under 5 throughout the window, every measured process lives through it, the
// kept session is still held at its end and the two footprint readers agree; an invalid run fails, saying why. It
// prints one line naming each process's footprint and the app's Electron version against the runtime floor's, adds it
// as an annotation, and writes the samples to test-results/daemon-idle.json. On the daemon shape the line states the
// bound's verdict and a valid run outside the bound fails; the detached shape records only.
//
// The second case is the runtime floor, the footprint of the bare runtime `mawsd` runs on, a diagnostic outside the
// bound (P5 Decision Logs 54 and 57); it writes test-results/daemon-idle-floor.json. The third (P5 O2 M5, Decision Log
// 57's early check) is `mawsd` alone, idle with no hosts and no app; it writes test-results/daemon-idle-mawsd.json.
//
// The fourth (P5 O10 M10, Decision Log 114) is the increment an enrolled endpoint adds to the daemon shape: the first
// case's scene measured unenrolled, then with its mawsd enrolled in an org on desk-hub's local runner; it writes
// test-results/daemon-idle-enrolled.json.
//
// The fifth is A-B-A, for the bound's re-derivation: the first case's scene three times back to back, each on a fresh
// launch with its own shape, today's detached supervisor (A), the daemon shape (B) and the supervisor again (A'),
// recording each window and the deltas without a bound; it writes test-results/daemon-idle-aba.json.
//
// Six measured groups (gate.yml's MEASURED_E2E), one case each, chosen by title: `pnpm e2e:daemon-idle` (the
// scene, on the daemon shape since M9), `pnpm e2e:daemon-idle-baseline` (the same case under MAWS_HOST_MODE=detached,
// today's supervisor alone, recording only: the baseline is re-measured from it on the tree under test when a landing
// misses), `pnpm e2e:daemon-idle-floor` (the floor, which needs no build), `pnpm e2e:daemon-idle-mawsd` (mawsd
// alone), `pnpm e2e:daemon-idle-enrolled` (the enrolled endpoint, recording only) and `pnpm e2e:daemon-idle-aba` (A-B-A,
// recording only, its shapes its own whatever MAWS_HOST_MODE says). Each sets MAWS_DAEMON_IDLE_PERF=1,
// and the gate runs it only when named, on the mini's exclusive instance behind the measured-job guard. None spends
// anything or touches a keychain: a replay runs no engine, mawsd alone wakes no host, and the enrolled endpoint's hub
// is a local one on loopback, its machine key a file of the scratch profile.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { daemonPaths } from '@shared/daemon/files';
import { machineSettingsDefaults } from '@shared/settings/defaults';
import { abaDeltas, abaLine, boundMisses, cpuSeconds, DAEMON_IDLE_BOUND, ENROLLED_INCREMENT_BUDGET_KIB, enrolledLine, floorLine, IDLE_RUN, idleLine, invalidReasons, mawsdLine, measured, median, readerMismatches, readFootprints, readTopMem, type MeasuredProcess, type ShapeReading, type TopMem } from '../test/support/daemon-idle';
import { invoke, launchReady, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { startLocalOrg, type LocalOrg, type Ran } from './support/local-org';
import { isAlive, killScratchProcesses, processesNaming, ps } from './support/processes';
import { tmpSocketDirOf } from './support/supervisor-socket';

test.skip(process.env.MAWS_DAEMON_IDLE_PERF !== '1', 'the idle-cost measurement runs under pnpm e2e:daemon-idle, e2e:daemon-idle-baseline, e2e:daemon-idle-floor, e2e:daemon-idle-mawsd, e2e:daemon-idle-enrolled and e2e:daemon-idle-aba (MAWS_DAEMON_IDLE_PERF=1)');
test.describe.configure({ timeout: 20 * 60_000 }); // about 13 minutes: the scene, the settle and the window

// C3's permission round trip: a prompt, ~44 rows, a Bash `can_use_tool` (seq 49) the replay holds at until it is
// answered, ~44 more rows to the turn's result (seq 93), then a hold at the next prompt (seq 94, an `out` row).
const PERMISSION = 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl';
const ROW_MS = '500'; // about 22 s from the answer to the result: the quit lands mid-turn
const FLOOR_ARGV0 = 'maws-runtime-floor';
const MAWSD_ARGV0 = 'mawsd'; // P5 O2 M5
// P5 O2 M9: the scene's shape, one switch as in e2e/supervisor.spec.ts; `daemon` measures what the daemon shape leaves.
// The A-B-A case names each launch's shape itself; every other case runs the one this switch names.
type Shape = 'daemon' | 'detached';
const SHAPE: Shape = process.env.MAWS_HOST_MODE === 'daemon' ? 'daemon' : 'detached';
const DAEMON = SHAPE === 'daemon';
const measuredOn = (shape: Shape) => (shape === 'daemon' ? [MAWSD_ARGV0, 'maws-supervisor', 'maws-pty-host'] : ['maws-supervisor']);
// A settle and window of IDLE_RUN's form; IDLE_RUN's own unless a local trial shortens the A-B-A case's.
type IdleRun = Record<keyof typeof IDLE_RUN, number>;
// A local trial of the A-B-A case end to end (MAWS_DAEMON_IDLE_TRIAL=1, which no package script sets): each of its three
// legs settles 10 s and reads a 60 s window, so the run takes minutes; what it reads is no measurement.
const ABA_RUN: IdleRun = process.env.MAWS_DAEMON_IDLE_TRIAL === '1' ? { ...IDLE_RUN, settleS: 10, windowS: 60, samples: 3 } : IDLE_RUN;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface JournalRow { seq: number; direction: string; frame: Record<string, unknown> }
interface Sample { atS: number; load: number; footprintKiB: Record<number, number | null>; rssKiB: Record<number, number | null> }
interface CrossCheck { atS: number; readings: { pid: number; argv0: string; footprintKiB: number; top: TopMem | null }[] }

function firstPrompt(): string {
  for (const line of readFileSync(join(REPO_ROOT, PERMISSION), 'utf8').split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line) as { direction: string; frame: { type: string; message?: { content: string } } };
    if (row.direction === 'out' && row.frame.type === 'user') return row.frame.message!.content;
  }
  throw new Error(`${PERMISSION} records no prompt`);
}

// Every journal row of the session's launches, oldest file first.
function journal(userData: string, id: string): JournalRow[] {
  const dir = join(userData, 'engine-host', 'journal', id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()
    .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JournalRow));
}
const turnEnded = (rows: JournalRow[]) => rows.some((r) => r.direction === 'in' && r.frame.type === 'result');
const launchEnded = (rows: JournalRow[]) => rows.some((r) => r.direction === 'meta' && r.frame.event === 'exit');

const lockOf = (userData: string): { pid: number; socketPath: string } | null => {
  try {
    return JSON.parse(readFileSync(join(userData, 'supervisor', 'host.lock'), 'utf8')) as { pid: number; socketPath: string };
  } catch {
    return null;
  }
};

// The processes the scene leaves behind, filled in as they start, so the cleanup ends whatever started.
interface Held { maws: MawsLaunch | null; supervisor: number | null; daemon: number | null }

// The scene up to its idle: the app launched on `shape`, the seeded session's turn played to its request, the answer
// given, the app quit mid-turn with the keep answer, and the turn ended with no app connected, the session held at its
// next prompt. Answers the session's id and the Electron version every measured process runs as Node.
async function keptIdleScene(root: string, userData: string, held: Held, shape: Shape): Promise<{ id: AppSessionId; electron: string }> {
  const daemon = shape === 'daemon';
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  // No idle release and no idle exit (null: never), so the kept session holds through the window.
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'machine-settings.json'), JSON.stringify({ ...machineSettingsDefaults(), supervisor: { idleExitMinutes: null } })); // P5 O3-A: the machine's field
  // A session C4 files from a transcript in the engine store, so the replayed launch has a record (as e2e/supervisor.spec.ts does).
  const engineId = randomUUID();
  const project = join(userData, 'claude-config', 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  const seeded = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: 'daemon idle session' }, uuid: randomUUID(), timestamp: '2026-10-27T10:00:00.000Z', cwd: repo, sessionId: engineId, version: '2.1.283' };
  writeFileSync(join(project, `${engineId}.jsonl`), `${JSON.stringify(seeded)}\n`);

  const maws = (held.maws = await launchMaws({
    userData, keepConfigHome: true,
    env: { MAWS_HARNESS: '0', MAWS_HOST_MODE: shape, MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_ROW_MS: ROW_MS, MAWS_E2E_QUIT_ANSWER: 'keep' },
  }));
  const { page, app } = maws;
  const child = app.process();
  let output = '';
  child.stdout?.on('data', (chunk) => (output += String(chunk)));
  child.stderr?.on('data', (chunk) => (output += String(chunk)));
  const exited = new Promise<void>((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', () => resolve())));

  await expect.poll(async () => {
    const status = await invoke(page, 'host.status', undefined);
    if (!status.ok || status.value.state !== 'ready' || status.value.supervisor?.mode !== 'detached') return null;
    if (daemon && (status.value.transport !== 'daemon' || status.value.daemon?.kind !== 'private')) return null;
    held.daemon = status.value.daemon?.pid ?? null;
    return status.value.supervisor.pid;
  }, { timeout: 30_000, message: daemon ? 'main is connected to the engine host through a private mawsd' : 'main is connected to a detached supervisor' }).not.toBeNull();
  const supervisor = (held.supervisor = lockOf(userData)!.pid);
  const electron = await app.evaluate(() => process.versions.electron); // the binary every measured process runs as Node
  let id = '' as AppSessionId;
  await expect.poll(async () => (id = (value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === engineId)?.appId ?? '') as AppSessionId), { timeout: 20_000, message: 'the seeded session has a record' }).not.toBe('');

  // The session holds at its request; the answer is given, and the app quits with the keep answer mid-turn.
  await launchReady(page, id, PERMISSION, { cwd: repo });
  value(await invoke(page, 'session.send', { appSessionId: id, content: firstPrompt() }));
  let requested: SessionEvent | undefined;
  await expect.poll(async () => (requested = value(await invoke(page, 'session.events', { appSessionId: id, afterSeq: null, limit: null })).events.find((e) => e.kind === 'permission.requested')) !== undefined, { timeout: 60_000, message: 'the request is pending' }).toBe(true);
  const { requestId } = requested as Extract<SessionEvent, { kind: 'permission.requested' }>;
  value(await invoke(page, 'session.answer', { appSessionId: id, requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }));
  await app.evaluate(({ app: electron }) => electron.quit());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`MAWS did not quit; it said ${JSON.stringify(output.split('\n').filter((l) => l.startsWith('quit-guard:')))}`)), 20_000)));
  await Promise.race([exited, late]).finally(() => clearTimeout(timer));
  expect(output.split('\n'), 'the quit was asked mid-turn and answered keep').toContain('quit-guard: 1 mid-turn, auto-answered keep, 1 session kept');
  expect(isAlive(supervisor), 'the supervisor outlives the app').toBe(true);
  if (daemon) expect(isAlive(held.daemon!), 'mawsd outlives the app').toBe(true);
  await expect.poll(() => turnEnded(journal(userData, id)), { timeout: 60_000, message: 'the turn ends with no app connected' }).toBe(true);
  expect(launchEnded(journal(userData, id)), 'the kept session holds at its next prompt').toBe(false);
  return { id, electron };
}

// The scene's processes after the settle: the profile's supervisor, and on the daemon shape its mawsd beside it.
async function settledProcesses(root: string, held: Held, shape: Shape, run: IdleRun = IDLE_RUN): Promise<MeasuredProcess[]> {
  await sleep(run.settleS * 1_000);
  const procs: MeasuredProcess[] = measured(processesNaming(root), root, measuredOn(shape));
  expect(procs.map((p) => p.pid), "the profile's supervisor is what is measured").toContain(held.supervisor);
  if (shape === 'daemon') expect(procs.map((p) => p.pid), "the profile's mawsd is measured beside it").toContain(held.daemon);
  return procs;
}

test('daemon idle: the physical footprint and CPU of what stays behind holding one kept idle session after the app has quit', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-di-')));
  const userData = join(root, 'ud');
  const held: Held = { maws: null, supervisor: null, daemon: null };
  let leftover: unknown;
  try {
    const { id, electron } = await keptIdleScene(root, userData, held, SHAPE);
    const measurement = await measureWindow(await settledProcesses(root, held, SHAPE));
    const sessionEnded = launchEnded(journal(userData, id));

    const reasons = invalidReasons({ loads: measurement.samples.map((s) => s.load), measured: measurement.names, lost: measurement.lost, sessionEnded, mismatches: measurement.mismatches });
    const { footprintKiB, rssKiB, cpuS, load } = measurement;
    const bound = DAEMON ? DAEMON_IDLE_BOUND : null;
    const line = footprintKiB === null || rssKiB === null || cpuS === null ? null : idleLine({ footprintKiB, rssKiB, samples: measurement.whole, cpuS, processes: measurement.perProcess, bound, electron, load });
    const misses = bound === null || footprintKiB === null || cpuS === null ? [] : boundMisses({ footprintKiB, cpuS }, bound);
    report('daemon-idle.json', line, reasons, { shape: SHAPE, electron, bound, misses, ...measurement.record, sessionEnded });
    expect(misses, `the daemon shape's processes together are within DAEMON_IDLE_BOUND (${line})`).toEqual([]);
  } finally {
    leftover = await removeScratch(root, userData, held.maws, [held.supervisor, held.daemon]);
  }
  if (leftover !== null) throw leftover; // the body passed: a process of the scratch outliving it is the case's failure
});

// The runtime floor (P5 Decision Logs 54 and 57, a diagnostic): what `mawsd` runs on, before any of its code. The Electron binary the engine
// host runs, as Node (ELECTRON_RUN_AS_NODE=1, `--disable-sigusr1` as the supervisor is spawned), on an empty script that
// stays alive, with an environment of its own (no NODE_OPTIONS or loader from the test runner). Its argv names the
// scratch root, so the window finds it and the cleanup kills it. The same settle, window, readers and load rule.
// `pnpm e2e:daemon-idle-floor` runs this case alone; `pnpm e2e:daemon-idle` runs the other alone.
test('daemon idle runtime floor: the physical footprint and CPU of the bare Electron runtime as Node holding an empty script alive', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-dif-')));
  const script = join(root, 'floor.js');
  writeFileSync(script, 'setInterval(() => {}, 1 << 30);\n');
  const binary = electronBinary();
  const env = { ELECTRON_RUN_AS_NODE: '1', PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root };
  const electron = execFileSync(binary, ['-p', 'process.versions.electron'], { env, encoding: 'utf8' }).trim();
  let floor: ChildProcess | null = null;
  let leftover: unknown = null;
  try {
    floor = spawn(binary, ['--disable-sigusr1', script], { env, stdio: 'ignore', argv0: FLOOR_ARGV0 });
    await sleep(IDLE_RUN.settleS * 1_000);
    const procs = measured(processesNaming(root), root, [FLOOR_ARGV0]);
    expect(procs.map((p) => p.pid), 'the bare runtime is what is measured').toEqual([floor.pid]);
    const measurement = await measureWindow(procs);

    const reasons = invalidReasons({ loads: measurement.samples.map((s) => s.load), measured: measurement.names, lost: measurement.lost, sessionEnded: false, mismatches: measurement.mismatches });
    const { footprintKiB, rssKiB, cpuS, load } = measurement;
    const line = footprintKiB === null || rssKiB === null || cpuS === null ? null : floorLine({ footprintKiB, rssKiB, samples: measurement.whole, cpuS, electron, load });
    report('daemon-idle-floor.json', line, reasons, { shape: 'runtime floor', electron, ...measurement.record });
  } finally {
    floor?.kill('SIGKILL');
    await killScratchProcesses(root, floor?.pid === undefined ? [] : [floor.pid]).catch((error: unknown) => (leftover = error));
    rmSync(root, { recursive: true, force: true });
  }
  if (leftover !== null) throw leftover;
});

// P5 O2 M5, Decision Log 57's early check: `mawsd` alone, idle, with no hosts and no app, as the unit runs it (a unit
// mawsd never exits by itself; a private one would after its 10 minutes). The built out/main/mawsd.js under the same
// Electron binary as Node, `--disable-sigusr1`, argv0 `mawsd`, on a scratch profile with an environment of its own; no
// client ever connects, so neither host is woken. The same settle, window, readers and load rule; it writes
// test-results/daemon-idle-mawsd.json. `pnpm e2e:daemon-idle-mawsd` runs this case alone (it needs the plain build).
test('daemon idle mawsd alone: the physical footprint and CPU of mawsd idle with no hosts and no app', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-dim-')));
  const profile = join(root, 'ud');
  mkdirSync(profile, { recursive: true });
  const script = join(REPO_ROOT, 'out', 'main', 'mawsd.js');
  expect(existsSync(script), 'the build has out/main/mawsd.js (scripts/e2e-build.sh plain)').toBe(true);
  const binary = electronBinary();
  const env = { ELECTRON_RUN_AS_NODE: '1', PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root, MAWS_USER_DATA: profile };
  const log = () => (existsSync(join(profile, 'mawsd', 'mawsd.log')) ? readFileSync(join(profile, 'mawsd', 'mawsd.log'), 'utf8') : '');
  let mawsd: ChildProcess | null = null;
  let leftover: unknown = null;
  try {
    mawsd = spawn(binary, ['--disable-sigusr1', script, 'run', '--unit', '--dir', join(profile, 'mawsd')], { env, stdio: 'ignore', argv0: MAWSD_ARGV0 });
    await expect.poll(() => log().includes(' serving; engine host parked, pty host parked'), { timeout: 20_000, message: `mawsd serves with both hosts parked:\n${log()}` }).toBe(true);
    await sleep(IDLE_RUN.settleS * 1_000);
    const procs = measured(processesNaming(root), root, [MAWSD_ARGV0]);
    expect(procs.map((p) => p.pid), 'mawsd alone is what is measured (no host woken)').toEqual([mawsd.pid]);
    const measurement = await measureWindow(procs);

    const reasons = invalidReasons({ loads: measurement.samples.map((s) => s.load), measured: measurement.names, lost: measurement.lost, sessionEnded: false, mismatches: measurement.mismatches });
    const { footprintKiB, rssKiB, cpuS, load } = measurement;
    const line = footprintKiB === null || rssKiB === null || cpuS === null ? null : mawsdLine({ footprintKiB, rssKiB, samples: measurement.whole, cpuS, load });
    report('daemon-idle-mawsd.json', line, reasons, { shape: 'mawsd alone', ...measurement.record });
  } finally {
    mawsd?.kill('SIGTERM');
    await killScratchProcesses(root, mawsd?.pid === undefined ? [] : [mawsd.pid]).catch((error: unknown) => (leftover = error));
    rmSync(root, { recursive: true, force: true });
  }
  if (leftover !== null) throw leftover;
});

// P5 O10 M10 and Decision Log 114: the increment an enrolled endpoint adds to the daemon shape. The first case's scene,
// its window read unenrolled (mawsd has not loaded its endpoint, endpoint-seam.ts), then the scene's mawsd enrolled with
// its code on stdin through the command line, listed by the member of an org on desk-hub's local runner
// (./support/local-org.ts; wrangler dev on loopback, its heartbeat the deployed hub's 15 s), and, once its hub link is
// up, the same settle and window again over the same processes. The local hub runs through both windows, so both read
// the same machine. Valid when both windows are, the kept session holds through both, and the hub link is still up at
// the end. Its line names the increment in footprint and CPU, each process's share, the budget's verdict, the validity
// and both loads, and asserts no bound; it writes test-results/daemon-idle-enrolled.json. `pnpm e2e:daemon-idle-enrolled`
// runs this case alone, on the daemon shape (about 27 minutes: two settles and two windows). Its unenrolled window is
// this scene's own baseline, raised by the local hub running beside it (M10's readings: mawsd 34.0 and 41.7 MiB there,
// 31.2 to 31.8 in the first case's scene), and is never compared with DAEMON_IDLE_BOUND, which the first case reads.
test('daemon idle enrolled endpoint: the footprint and CPU an enrolled, listed endpoint adds to the daemon shape holding one kept idle session', async () => {
  test.skip(!DAEMON, 'the enrolled endpoint is measured on the daemon shape (pnpm e2e:daemon-idle-enrolled)');
  test.setTimeout(40 * 60_000);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-die-')));
  const userData = join(root, 'ud');
  const held: Held = { maws: null, supervisor: null, daemon: null };
  // The command line of the scene's mawsd, as the app's own binary runs it as Node, on the scene's profile.
  const env = { ELECTRON_RUN_AS_NODE: '1', PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root, TMPDIR: process.env.TMPDIR ?? tmpdir(), MAWS_USER_DATA: userData };
  const cli = (args: string[], input = '') =>
    new Promise<Ran>((done) => {
      const child = spawn(electronBinary(), [join(REPO_ROOT, 'out', 'main', 'mawsd.js'), ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += String(chunk)));
      child.stderr.on('data', (chunk) => (stderr += String(chunk)));
      child.once('exit', (status) => done({ status, stdout, stderr }));
      child.stdin.end(input);
    });
  const hubConnected = async () => {
    const status = await cli(['endpoint', 'status', '--json']);
    return status.status === 0 && (JSON.parse(status.stdout) as { hub: { connected: boolean } }).hub.connected;
  };
  let org: LocalOrg | null = null;
  let leftover: unknown;
  try {
    org = await startLocalOrg(root, { heartbeatMs: 15_000 });
    const { id, electron } = await keptIdleScene(root, userData, held, SHAPE);
    const procs = await settledProcesses(root, held, SHAPE);
    const unenrolled = await measureWindow(procs);
    const unenrolledEnded = launchEnded(journal(userData, id));

    const enrolling = await org.enroll('idle-scene', (code) => cli(['enroll', '--name', 'idle-scene', '--wait', '60', '--json'], `${code}\n`));
    expect(JSON.parse(enrolling.stdout), 'the scene’s mawsd is enrolled and listed').toMatchObject({ enrollment: 'org-listed', name: 'idle-scene' });
    await expect.poll(hubConnected, { timeout: 60_000, message: 'the enrolled endpoint’s hub link is up' }).toBe(true);
    const enrolled = await measureWindow(await settledProcesses(root, held, SHAPE));
    const sessionEnded = launchEnded(journal(userData, id));
    const linkUp = await hubConnected(); // after the window's last reading, so the command's own cost is outside it

    const reasons = [
      ...windowReasons(unenrolled, unenrolledEnded).map((reason) => `unenrolled: ${reason}`),
      ...windowReasons(enrolled, sessionEnded).map((reason) => `enrolled: ${reason}`),
      ...(linkUp ? [] : ['the enrolled endpoint’s hub link was down at the window’s end']),
    ];
    const [before, after] = [shapeReading(unenrolled), shapeReading(enrolled)];
    const line = before === null || after === null ? null : enrolledLine({ unenrolled: before, enrolled: after, reasons });
    const increment = before === null || after === null ? null : { footprintKiB: Math.round(after.footprintKiB) - Math.round(before.footprintKiB), cpuS: Math.round((after.cpuS - before.cpuS) * 100) / 100 };
    report('daemon-idle-enrolled.json', line, reasons, { shape: 'daemon, enrolled', electron, budgetKiB: ENROLLED_INCREMENT_BUDGET_KIB, increment, linkUp, sessionEnded, unenrolled: unenrolled.record, enrolled: enrolled.record });
  } finally {
    leftover = await removeScratch(root, userData, held.maws, [held.supervisor, held.daemon]);
    await org?.stop().catch((error: unknown) => console.error(error));
  }
  if (leftover !== null) throw leftover;
});

// The bound's re-derivation (after P5 O10 M10): A-B-A, the first case's scene three times back to back in one job, each
// leg a fresh launch on a scratch profile of its own with the shape the leg names in that launch's MAWS_HOST_MODE:
// today's detached supervisor (A), the daemon shape (B) and the supervisor again (A'). A leg's processes are ended and
// its scratch removed before the next launches, so no window reads beside another leg's. Each window is the first
// case's settle and window under the same readers and validity rule, applied to each. Its line names the deltas (B
// against the mean of A and A', A against A'), each window's per-process medians and CPU, and the validity, and asserts
// no bound; it writes test-results/daemon-idle-aba.json. `pnpm e2e:daemon-idle-aba` runs this case alone (about 40
// minutes: three scenes, settles and windows).
test("daemon idle A-B-A: today's detached supervisor, the daemon shape and the supervisor again, each holding one kept idle session on a fresh launch, back to back", async () => {
  test.setTimeout(60 * 60_000);
  const a = { name: 'A', ...(await keptIdleLeg('detached', ABA_RUN)) };
  const b = { name: 'B', ...(await keptIdleLeg('daemon', ABA_RUN)) };
  const a2 = { name: "A'", ...(await keptIdleLeg('detached', ABA_RUN)) };
  const legs = [a, b, a2];
  const reasons = legs.flatMap((leg) => windowReasons(leg.measurement, leg.sessionEnded).map((reason) => `${leg.name}: ${reason}`));
  const [ra, rb, ra2] = [shapeReading(a.measurement), shapeReading(b.measurement), shapeReading(a2.measurement)];
  const line = ra === null || rb === null || ra2 === null ? null : abaLine({ a: ra, b: rb, a2: ra2, reasons, windowS: ABA_RUN.windowS });
  const deltas = ra === null || rb === null || ra2 === null ? null : abaDeltas(ra, rb, ra2);
  report('daemon-idle-aba.json', line, reasons, {
    shape: 'A-B-A', deltas,
    windows: legs.map((leg) => ({ window: leg.name, shape: leg.shape, electron: leg.electron, sessionEnded: leg.sessionEnded, ...leg.measurement.record })),
  });
});

// One leg of the A-B-A case: the first case's scene on a fresh launch on `shape`, on a scratch of its own, then its
// settle and window, and the scratch removed. A process of the scratch outliving the removal fails the run here, before
// the next leg's window could read beside it.
async function keptIdleLeg(shape: Shape, run: IdleRun): Promise<{ shape: Shape; electron: string; measurement: IdleWindow; sessionEnded: boolean }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-dia-')));
  const userData = join(root, 'ud');
  const held: Held = { maws: null, supervisor: null, daemon: null };
  let leg: { shape: Shape; electron: string; measurement: IdleWindow; sessionEnded: boolean };
  let leftover: unknown;
  try {
    const { id, electron } = await keptIdleScene(root, userData, held, shape);
    const measurement = await measureWindow(await settledProcesses(root, held, shape, run), run);
    leg = { shape, electron, measurement, sessionEnded: launchEnded(journal(userData, id)) };
  } finally {
    leftover = await removeScratch(root, userData, held.maws, [held.supervisor, held.daemon]);
  }
  if (leftover !== null) throw leftover;
  return leg;
}

// The Electron binary every measured process runs as Node (ELECTRON_RUN_AS_NODE=1), as its `electron` package names it.
function electronBinary(): string {
  return join(REPO_ROOT, 'node_modules', 'electron', 'dist', readFileSync(join(REPO_ROOT, 'node_modules', 'electron', 'path.txt'), 'utf8').trim());
}

// The window over the measured processes: their start times, then a sample every 30 s on a fixed schedule, each
// process's footprint (proc_pid_rusage) and `ps -o rss=` summed per sample and the 1-minute load, top's cross-check at
// the first sample, and `ps -o time=` at the start and the end.
async function measureWindow(procs: readonly MeasuredProcess[], run: IdleRun = IDLE_RUN) {
  const started = new Map(procs.map((p) => [p.pid, ps(p.pid, 'lstart')]));
  const cpuAtStart = new Map(procs.map((p) => [p.pid, cpuSeconds(ps(p.pid, 'time'))]));
  const cpuAtEnd = new Map<number, number>();
  const samples: Sample[] = [];
  const lost: { pid: number; argv0: string; atS: number }[] = [];
  let crossCheck: CrossCheck | null = null;
  const windowStart = Date.now();
  for (let k = 0; k < run.samples; k += 1) {
    await sleep(Math.max(0, windowStart + k * run.everyS * 1_000 - Date.now()));
    const atS = Math.round((Date.now() - windowStart) / 1_000);
    const live = procs.filter((p) => ps(p.pid, 'lstart') === started.get(p.pid));
    const read = readFootprints(live.map((p) => p.pid));
    const footprintOf = (pid: number) => { const f = read.get(pid); return f === undefined || 'errno' in f ? null : f.footprintKiB; };
    if (k === 0 && live.length > 0) {
      const top = readTopMem(live.map((p) => p.pid)); // back to back with the first reader
      crossCheck = { atS, readings: live.filter((p) => footprintOf(p.pid) !== null).map((p) => ({ pid: p.pid, argv0: p.argv0, footprintKiB: footprintOf(p.pid)!, top: top.get(p.pid) ?? null })) };
      console.log(`[daemon-idle] readers at ${atS} s: ${crossCheck.readings.map((r) => `${r.argv0} pid ${r.pid} proc_pid_rusage ${Math.round(r.footprintKiB)} KiB, top ${r.top?.text ?? 'none'}`).join('; ')}`);
    }
    const footprintKiB: Record<number, number | null> = {};
    const rssKiB: Record<number, number | null> = {};
    for (const p of procs) {
      const alive = live.includes(p) && ps(p.pid, 'lstart') === started.get(p.pid); // still the same process after the read
      if (alive && footprintOf(p.pid) === null) throw new Error(`proc_pid_rusage could not read ${p.argv0} pid ${p.pid}, which is alive (${JSON.stringify(read.get(p.pid))})`);
      footprintKiB[p.pid] = alive ? footprintOf(p.pid) : null;
      rssKiB[p.pid] = alive ? Number(ps(p.pid, 'rss')) : null;
      if (!alive && !lost.some((l) => l.pid === p.pid)) lost.push({ pid: p.pid, argv0: p.argv0, atS });
      if (alive && k === run.samples - 1) cpuAtEnd.set(p.pid, cpuSeconds(ps(p.pid, 'time')));
    }
    samples.push({ atS, load: loadavg()[0]!, footprintKiB, rssKiB });
  }

  const names = [...new Set(procs.map((p) => p.argv0))];
  const mismatches = readerMismatches(crossCheck?.readings ?? []);
  const whole = samples.filter((s) => procs.every((p) => s.footprintKiB[p.pid] !== null && s.rssKiB[p.pid] !== null));
  const summed = (of: (s: Sample) => Record<number, number | null>) => (whole.length === 0 ? null : median(whole.map((s) => procs.reduce((sum, p) => sum + of(s)[p.pid]!, 0))));
  const footprintKiB = summed((s) => s.footprintKiB);
  const rssKiB = summed((s) => s.rssKiB);
  const cpuOf = (pid: number) => (cpuAtEnd.has(pid) ? Math.round((cpuAtEnd.get(pid)! - cpuAtStart.get(pid)!) * 100) / 100 : null);
  const perProcess = whole.length === 0 ? [] : procs.map((p) => ({ argv0: p.argv0, pid: p.pid, footprintKiB: median(whole.map((s) => s.footprintKiB[p.pid]!)), cpuS: cpuOf(p.pid) }));
  const cpuS = lost.length > 0 ? null : Math.round(procs.reduce((sum, p) => sum + cpuAtEnd.get(p.pid)! - cpuAtStart.get(p.pid)!, 0) * 100) / 100;
  const load = Math.max(...samples.map((s) => s.load));
  const processes = procs.map((p) => ({ ...p, started: started.get(p.pid), cpuStartS: cpuAtStart.get(p.pid), cpuEndS: cpuAtEnd.get(p.pid) ?? null }));
  return {
    samples, lost, mismatches, names, whole: whole.length, footprintKiB, rssKiB, perProcess, cpuS, load,
    record: { run, footprintKiB, rssKiB, perProcess, cpuS, load, processes, crossCheck, mismatches, lost, samples },
  };
}

type IdleWindow = Awaited<ReturnType<typeof measureWindow>>;

// Why a window is invalid under the load, liveness, held-session and readers rule (invalidReasons); empty when valid.
const windowReasons = (run: IdleWindow, sessionEnded: boolean) => invalidReasons({ loads: run.samples.map((s) => s.load), measured: run.names, lost: run.lost, sessionEnded, mismatches: run.mismatches });

// A window's reading as the lines take it; null when no sample read every process or one was lost.
const shapeReading = (run: IdleWindow): ShapeReading | null =>
  run.footprintKiB === null || run.cpuS === null ? null : { footprintKiB: run.footprintKiB, cpuS: run.cpuS, samples: run.whole, load: run.load, processes: run.perProcess.map((p) => ({ ...p, cpuS: p.cpuS! })) };

// The run's JSON beside the report, then its line printed and annotated, then the validity asserted.
function report(file: string, line: string | null, reasons: string[], record: Record<string, unknown>): void {
  const info = test.info();
  mkdirSync(info.project.outputDir, { recursive: true });
  writeFileSync(join(info.project.outputDir, file), `${JSON.stringify({
    line, valid: reasons.length === 0, reasons, sha: process.env.GITHUB_SHA ?? null, runId: process.env.GITHUB_RUN_ID ?? null, ...record,
  }, null, 2)}\n`);
  if (line !== null) {
    console.log(line);
    info.annotations.push({ type: 'daemon-idle', description: line });
  }
  expect(reasons, 'the run is valid').toEqual([]);
}

// The app closed if it is still open, then every process of the scratch killed (the supervisor by its lock's pid too,
// and on the daemon shape `mawsd` by the pid main reported), then the supervisor's socket directory, `mawsd`'s sockets'
// $TMPDIR fallback when they took it, and the scratch removed. A survivor is answered, after the files are removed.
async function removeScratch(root: string, userData: string, maws: MawsLaunch | null, pids: readonly (number | null)[]): Promise<unknown> {
  const lock = lockOf(userData);
  await maws?.cleanup().catch((error: unknown) => console.error(error));
  let leftover: unknown = null;
  await killScratchProcesses(root, [lock?.pid, ...pids].filter((pid): pid is number => typeof pid === 'number')).catch((error: unknown) => (leftover = error));
  const socketDir = lock ? tmpSocketDirOf(userData, lock.socketPath) : null;
  if (socketDir !== null) rmSync(socketDir, { recursive: true, force: true });
  const daemonSockets = daemonPaths(userData).socketDir; // the daemon shape's, when its sockets took the fallback
  if (!daemonSockets.startsWith(root)) rmSync(daemonSockets, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
  return leftover;
}
