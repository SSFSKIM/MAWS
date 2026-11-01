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
// the window's start and end. At the first sample top's MEM column reads the footprint a second, independent way. Each
// sample also records two diagnostics no verdict reads: the cores' cumulative CPU times (os.cpus()), which give each
// interval's busy share, and the process outside the measured set that used the most CPU over the interval, from the
// one process table the sample reads to tell that each measured process is still the one the window started with. The
// measured processes are those of the profile whose argv0 is `maws-supervisor`; the replay has no `claude` child, and a
// real one is the session's cost, not the daemon's.
//
// The scene runs on the shape `MAWS_HOST_MODE` names, as e2e/supervisor.spec.ts does. `detached` is M1's, which recorded
// the baseline; `daemon` is M9's (acceptance 7): main reaches the engine host through a private `mawsd` on the profile,
// and what stays behind is `mawsd` and the engine host (and the pty host if it runs), measured together against
// DAEMON_IDLE_BOUND. The settings' `idleExitMinutes: null` reaches `mawsd` as `host.configure`'s, so neither its park
// clock nor its own idle exit arms. P5 O3-D (D7, Q1): on the daemon shape this case's `mawsd` is the harness's unit,
// started before the app as the owner's LaunchAgent runs it, holding the spine, which it releases 60 s after the app
// has gone (MAWS_SPINE_QUIET_MS), inside the settle; and the quit mid-turn is not asked, the session outliving the app.
//
// A run is valid when its load passes IDLE_RUN's rule, every measured process lives through it, the kept session is
// still held at its end and the two footprint readers agree; an invalid run fails, saying why. The load rule voids
// sustained load and passes a burst: a window is void when its 1-minute load reaches 5 and two adjacent 30 s intervals
// both held 4.7 or more, each interval's own load rebuilt from the 1-minute series (its 30 s pair). It prints one line
// naming each process's footprint, the app's Electron version against the runtime floor's and the load, the highest
// 1-minute load with the 30 s pair beside it, adds it as an annotation, and writes the samples to
// test-results/daemon-idle.json. On the daemon shape the line states the bound's verdict and a valid run outside the
// bound fails; the detached shape records only.
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
// The sixth (P5 O3-C M5, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, D18 and D19) is the spine alone,
// what O3-D moves into mawsd, composed by the built services entry over a profile the size of the owner's, idle while
// loaded and again after its data is released; it writes test-results/daemon-idle-spine.json.
//
// The seventh (P5 O3-D M2, docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §K; D5) is `mawsd` with the
// spine: the built mawsd over the same fixture, the spine loaded by a client's first command, released after the quiet
// period, and re-executed as a unit daemon; it writes test-results/daemon-idle-mawsd-spine.json.
//
// The eighth (P5 O5 M4, docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, acceptance 8) is warm to idle: the first
// case's scene, then a capture through `mawsd`'s render seam (`daemon.e2eRender` from a bare machine.sock client) and one
// artifact fetch through artifacts.sock, then the render host's quiet period (MAWS_RENDER_QUIET_MS 30 s) and its exit in
// mawsd.log, then the same settle, window, readers, validity rule and bound, with no render host process at the
// window's start: what the deferred chunks keep resident after use. It writes test-results/daemon-idle-render.json and
// runs as `pnpm e2e:daemon-idle-render`, which the plain group's and the baseline's --grep-invert leave out.
//
// P5 O17 M8 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M8; OX7): the first case on the daemon shape also reads
// mawsd's resources (a SIGUSR2 report under MAWS_E2E=1) at the unit's cold start and at the window: no session listener
// and neither the broker's nor the feed's chunk at the cold start, at most the kept session's listener at the window,
// still no chunk, and no timer the cold start lacked. Two more cases join `pnpm e2e:daemon-idle-render`: the agent's
// browser warm to idle (daemon-idle-render-browser.json) and four kept sessions with live connectors and no app
// (daemon-idle-render-kept.json), both waiting on O17 M7's engine host.
//
// Eight measured groups (gate.yml's MEASURED_E2E), one case each, chosen by title: `pnpm e2e:daemon-idle` (the
// scene, on the daemon shape since M9), `pnpm e2e:daemon-idle-baseline` (the same case under MAWS_HOST_MODE=detached,
// today's supervisor alone, recording only: the baseline is re-measured from it on the tree under test when a landing
// misses), `pnpm e2e:daemon-idle-floor` (the floor, which needs no build), `pnpm e2e:daemon-idle-mawsd` (mawsd
// alone), `pnpm e2e:daemon-idle-enrolled` (the enrolled endpoint, recording only), `pnpm e2e:daemon-idle-aba` (A-B-A,
// recording only, its shapes its own whatever MAWS_HOST_MODE says), `pnpm e2e:daemon-idle-spine` (the spine alone,
// recording only) and `pnpm e2e:daemon-idle-mawsd-spine` (mawsd with the spine, recording only). Each sets MAWS_DAEMON_IDLE_PERF=1,
// and the gate runs it only when named, on the mini's exclusive instance behind the measured-job guard. None spends
// anything or touches a keychain: a replay runs no engine, mawsd alone wakes no host, the spine alone has no host to
// wake, mawsd with the spine wakes an engine host that replays (MAWS_ENGINE_REPLAY=1) and runs no session, and the enrolled endpoint's hub is a local one on loopback, its machine key a file of the scratch profile.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { daemonPaths } from '@shared/daemon/files';
import { machineSettingsDefaults } from '@shared/settings/defaults';
import { abaDeltas, abaLine, mawsdSpineLine, boundMisses, busyShare, cpuSeconds, cpuTimes, DAEMON_IDLE_BOUND, ENROLLED_INCREMENT_BUDGET_KIB, enrolledLine, floorLine, IDLE_RUN, idleLine, invalidReasons, loadPair, mawsdLine, measured, median, readerMismatches, readFootprints, readProcessTable, readTopMem, SPINE_RELEASED_RUN, spineLine, topOutside, type CpuTimes, type MeasuredProcess, type ProcessRow, type ShapeReading, type SpineWindow, type TopMem, type TopProcess } from '../test/support/daemon-idle';
import { writeSpineFixture } from '../test/support/spine-fixture';
import { reachMachine } from '../src/mawsd/machine-client';
import { invoke, launchReady, value } from './support/c7-replay';
import { processEvidence } from './support/process-evidence.mjs';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { startLocalOrg, type LocalOrg, type Ran } from './support/local-org';
import { isAlive, killScratchProcesses, processesNaming, ps } from './support/processes';
import { tmpSocketDirOf } from './support/supervisor-socket';
import { launchEnvironment } from './support/scratch-env';
import { writeReplayEngine } from '../test/support/replay-engine';
import { writeScratchShellHome } from '../test/support/shell-home';
import { supervisorEnv } from '@shared/host/detached-transport';
// P5 O17 M8 start
import { cuaSocketDir } from '@shared/daemon/files';
import { answered, BEFORE_M7, ENGINE_HOST_BROWSER_WORK, startHeadlessScene, startPages, type HeadlessScene } from './support/headless-browser';
import { o17IdleProblems, type E2eResources } from '../test/support/daemon-idle';
// P5 O17 M8 end

test.skip(process.env.MAWS_DAEMON_IDLE_PERF !== '1', 'the idle-cost measurement runs under pnpm e2e:daemon-idle, e2e:daemon-idle-baseline, e2e:daemon-idle-floor, e2e:daemon-idle-mawsd, e2e:daemon-idle-enrolled, e2e:daemon-idle-aba, e2e:daemon-idle-spine and e2e:daemon-idle-mawsd-spine (MAWS_DAEMON_IDLE_PERF=1)');
test.describe.configure({ timeout: 20 * 60_000 }); // about 13 minutes: the scene, the settle and the window

// C3's permission round trip: a prompt, ~44 rows, a Bash `can_use_tool` (seq 49) the replay holds at until it is
// answered, ~44 more rows to the turn's result (seq 93), then a hold at the next prompt (seq 94, an `out` row).
const PERMISSION = 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl';
const ROW_MS = '500'; // about 22 s from the answer to the result: the quit lands mid-turn
const FLOOR_ARGV0 = 'maws-runtime-floor';
const MAWSD_ARGV0 = 'mawsd'; // P5 O2 M5
const SPINE_ARGV0 = 'maws-spine'; // P5 O3-C M5
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
// A sample's readings, then its diagnostics: the cores' cumulative CPU times, the interval's busy share and the top
// process outside the measured set over the interval (both null at the window's first sample, which has no interval).
interface Sample { atS: number; load: number; footprintKiB: Record<number, number | null>; rssKiB: Record<number, number | null>; cpuTimesMs: CpuTimes; busyShare: number | null; topProcess: TopProcess | null }
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

// The processes the scene leaves behind, filled in as they start, so the cleanup ends whatever started. `endUnit` stops
// the harness's restarts of a unit daemon (D7), before the cleanup kills it.
interface Held { maws: MawsLaunch | null; supervisor: number | null; daemon: number | null; endUnit?: () => void; evidence?: ReturnType<typeof processEvidence>; cold?: { report: E2eResources; listeners: number } /* P5 O17 M8 */ }

// The scene's launch environment beyond launchMaws's own
const sceneEnv = (shape: Shape) => ({ MAWS_HARNESS: '0', MAWS_HOST_MODE: shape, MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_ROW_MS: ROW_MS, MAWS_E2E_QUIT_ANSWER: 'keep' });

// P5 O3-D D7 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md): the daemon as the harness's unit, as the owner's
// LaunchAgent runs it: `mawsd run --unit` started on the scratch profile before the app, with the environment the app
// would give a private one (launchMaws's base, the replay stub launchMaws then keeps, the scratch shell home, the scene's
// seams; supervisorEnv's rewrite) and MAWS_SPINE_QUIET_MS=60000 (D6's measured seam), so the app's launch finds it up
// and the lock arbitrates. Restarted on exit 75 as launchd would, following the new pid in `held.daemon`; re-execution
// is off by default (D38), so a restart is not expected and, before the window, not a lost process.
async function startUnitDaemon(userData: string, held: Held, extraEnv: Record<string, string> = {}): Promise<void> {
  const script = join(REPO_ROOT, 'out', 'main', 'mawsd.js');
  expect(existsSync(script), 'the build has out/main/mawsd.js (scripts/e2e-build.sh plain)').toBe(true);
  const binary = electronBinary();
  const base: Record<string, string> = { ...launchEnvironment(process.env, userData), MAWS_E2E_ENGINE_BIN: writeReplayEngine(userData), ...writeScratchShellHome(join(userData, 'shell-home')).env, ...sceneEnv('daemon') };
  const env = { ...supervisorEnv(base, { userData, packaged: false }), MAWS_SPINE_QUIET_MS: '60000', ...extraEnv }; // P5 O5 M4: extraEnv, the render case's
  const logFile = join(userData, 'mawsd', 'mawsd.log');
  const serving = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter((line) => line.includes(' serving; ')).length : 0);
  let ending = false;
  held.endUnit = () => void (ending = true);
  const run = () => {
    const child = spawn(binary, ['--disable-sigusr1', script, 'run', '--unit', '--dir', join(userData, 'mawsd')], { env, stdio: 'ignore', argv0: MAWSD_ARGV0 });
    held.daemon = child.pid ?? null;
    child.once('exit', (code) => void (code === 75 && !ending && run()));
  };
  run();
  await expect.poll(serving, { timeout: 30_000, message: 'the unit mawsd serves before the app launches' }).toBeGreaterThan(0);
  held.cold = { report: await mawsdResources(userData, held.daemon!), listeners: sessionListeners(userData) }; // P5 O17 M8: what the cold start holds
}

// P5 O17 M8 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M8; OX7): mawsd's e2e resource report (SIGUSR2 under
// MAWS_E2E=1, src/mawsd/e2e-seam.ts), read now, and the session listeners in its cua socket directory
async function mawsdResources(userData: string, pid: number): Promise<E2eResources> {
  const file = join(userData, 'mawsd', 'e2e-resources.json');
  rmSync(file, { force: true });
  process.kill(pid, 'SIGUSR2');
  await expect.poll(() => existsSync(file), { timeout: 10_000, message: 'mawsd writes its e2e resource report' }).toBe(true);
  return JSON.parse(readFileSync(file, 'utf8')) as E2eResources;
}
const sessionListeners = (userData: string) => {
  const dir = cuaSocketDir(userData);
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.sock')).length : 0;
};

// The scene up to its idle: the app launched on `shape`, the seeded session's turn played to its request, the answer
// given, the app quit mid-turn, and the turn ended with no app connected, the session held at its next prompt. The
// embedded shape asks the quit and the scene answers keep; the daemon shape's sessions outlive the app, so nothing is
// asked (P5 O3-D, Q1). On the daemon shape `daemonKind` says whose daemon the app reaches: its private one, or the
// harness's unit (D7), started here before the launch. Answers the session's id and the Electron version every measured
// process runs as Node.
async function keptIdleScene(root: string, userData: string, held: Held, shape: Shape, daemonKind: 'private' | 'unit' = 'private', unitEnv: Record<string, string> = {}): Promise<{ id: AppSessionId; electron: string }> {
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

  // P5 O3-D M6 (fix round 1): mawsd's own log published beside the launch's host log (as the mawsd-spine case does), so
  // a run can be read for mawsd's attach and spine lines; taken before the harness's unit starts, so its log is this scene's
  if (daemon) held.evidence = processEvidence(test.info().outputDir, userData, () => true, process.env, { daemon: join(userData, 'mawsd'), host: false });
  if (daemon && daemonKind === 'unit') await startUnitDaemon(userData, held, unitEnv);
  const maws = (held.maws = await launchMaws({ userData, keepConfigHome: true, env: sceneEnv(shape) }));
  const { page, app } = maws;
  const child = app.process();
  let output = '';
  child.stdout?.on('data', (chunk) => (output += String(chunk)));
  child.stderr?.on('data', (chunk) => (output += String(chunk)));
  const exited = new Promise<void>((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', () => resolve())));

  await expect.poll(async () => {
    const status = await invoke(page, 'host.status', undefined);
    if (!status.ok || status.value.state !== 'ready' || status.value.supervisor?.mode !== 'detached') return null;
    if (daemon && (status.value.transport !== 'daemon' || status.value.daemon?.kind !== daemonKind)) return null;
    held.daemon = status.value.daemon?.pid ?? null;
    return status.value.supervisor.pid;
  }, { timeout: 30_000, message: daemon ? `main is connected to the engine host through a ${daemonKind} mawsd` : 'main is connected to a detached supervisor' }).not.toBeNull();
  const supervisor = (held.supervisor = lockOf(userData)!.pid);
  const electron = await app.evaluate(() => process.versions.electron); // the binary every measured process runs as Node
  let id = '' as AppSessionId;
  await expect.poll(async () => (id = (value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === engineId)?.appId ?? '') as AppSessionId), { timeout: 20_000, message: 'the seeded session has a record' }).not.toBe('');

  // The session holds at its request; the answer is given, and the app quits mid-turn (keeping the session).
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
  if (daemon) expect(output.split('\n'), 'the quit mid-turn is not asked: the session outlives the app').toContain('quit-guard: 1 mid-turn, not asked: they outlive the app');
  else expect(output.split('\n'), 'the quit was asked mid-turn and answered keep').toContain('quit-guard: 1 mid-turn, auto-answered keep, 1 session kept');
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
    const { id, electron } = await keptIdleScene(root, userData, held, SHAPE, DAEMON ? 'unit' : 'private'); // D7
    const procs = await settledProcesses(root, held, SHAPE);
    // P5 O17 M8 (OX7): from the cold start, no session listener, neither the broker's nor the feed's chunk; at the
    // window, at most the kept session's listener (P5 Decision Log 187), still no chunk, and no timer the cold start lacked
    if (DAEMON) {
      const cold = held.cold!;
      const idle = await mawsdResources(userData, held.daemon!);
      console.log(`[daemon-idle] mawsd's resources: cold start ${JSON.stringify(cold.report.resources)}, the window ${JSON.stringify(idle.resources)}`);
      expect([
        ...o17IdleProblems('cold start', cold.report, { listeners: cold.listeners, allowedListeners: 0 }),
        ...o17IdleProblems('the window', idle, { listeners: sessionListeners(userData), allowedListeners: 1, cold: cold.report }),
      ], 'nothing of O17 at the cold start or the idle').toEqual([]);
    }
    const measurement = await measureWindow(procs);
    const sessionEnded = launchEnded(journal(userData, id));

    const reasons = invalidReasons({ loads: measurement.samples.map((s) => s.load), measured: measurement.names, lost: measurement.lost, sessionEnded, mismatches: measurement.mismatches });
    const { footprintKiB, rssKiB, cpuS, load } = measurement;
    const bound = DAEMON ? DAEMON_IDLE_BOUND : null;
    const line = footprintKiB === null || rssKiB === null || cpuS === null ? null : idleLine({ footprintKiB, rssKiB, samples: measurement.whole, cpuS, processes: measurement.perProcess, bound, electron, load, loadPair: measurement.loadPair });
    const misses = bound === null || footprintKiB === null || cpuS === null ? [] : boundMisses({ footprintKiB, cpuS }, bound);
    report('daemon-idle.json', line, reasons, { shape: SHAPE, electron, bound, misses, ...measurement.record, sessionEnded });
    expect(misses, `the daemon shape's processes together are within DAEMON_IDLE_BOUND (${line})`).toEqual([]);
  } finally {
    held.endUnit?.();
    leftover = await removeScratch(root, userData, held.maws, [held.supervisor, held.daemon], held.evidence);
  }
  if (leftover !== null) throw leftover; // the body passed: a process of the scratch outliving it is the case's failure
});

// P5 O5 M4 (acceptance 8): warm to idle, the render seam's chunk and the endpoint's handler used once, then the window
const RENDER_QUIET_MS = 30_000;
const RENDER_PAGE = '<!doctype html><html><head><title>Idle</title></head><body style="margin:0;background:#2a6"><p>DAEMON_IDLE_RENDER</p></body></html>';
// One artifact fetch through mawsd's artifact endpoint, as the scheme proxy asks it (src/services/artifacts/scheme/http.ts)
const fetchThroughEndpoint = (socketPath: string, url: string) =>
  new Promise<number>((resolve, reject) => {
    const req = httpRequest({ socketPath, path: `/${encodeURIComponent(url)}`, method: 'GET', agent: false }, (res) => {
      res.resume();
      res.once('end', () => resolve(res.statusCode ?? 0));
    });
    req.once('error', reject);
    req.end();
  });

test('daemon idle render: the footprint and CPU the daemon shape keeps after a render through the seam and an artifact fetch, once the render host has ended', async () => {
  test.skip(!DAEMON, 'the render seam is the daemon shape’s (MAWS_HOST_MODE=daemon)');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-di-render-')));
  const userData = join(root, 'ud');
  const held: Held = { maws: null, supervisor: null, daemon: null };
  let leftover: unknown;
  try {
    const { id, electron } = await keptIdleScene(root, userData, held, SHAPE, 'unit', { MAWS_RENDER_QUIET_MS: String(RENDER_QUIET_MS) });
    const paths = daemonPaths(userData);
    const reached = await reachMachine(paths, { build: 'e2e-daemon-idle-render' });
    if (!reached.ok) throw new Error(`machine.sock: ${reached.state}: ${reached.why}`);
    let artifactId = '';
    try {
      const created = await reached.link.request('artifacts.create', { kind: 'html', title: 'Idle render', content: { bytes: new TextEncoder().encode(RENDER_PAGE), name: 'index.html' } }, 30_000);
      if (!created.ok) throw new Error(`artifacts.create: ${created.error.message}`);
      const { artifact } = created.value as { artifact: { id: string; revision: number } };
      artifactId = artifact.id;
      const rendered = await reached.link.request('daemon.e2eRender', { artifactId, revision: artifact.revision, width: 640, height: 480, to: join(root, 'render.png') }, 150_000);
      expect(rendered, JSON.stringify(rendered)).toMatchObject({ ok: true });
    } finally {
      reached.link.close();
    }
    expect(await fetchThroughEndpoint(paths.artifactsSocket, `maws-artifact://${artifactId}/live/index.html`), 'the artifact fetch through artifacts.sock').toBe(200);
    const mawsdLog = () => readFileSync(join(userData, 'mawsd', 'mawsd.log'), 'utf8');
    await expect.poll(mawsdLog, { timeout: RENDER_QUIET_MS + 60_000, message: 'the render host ends after its quiet period' }).toMatch(/\[render\] the render host exited/);
    const procs = await settledProcesses(root, held, SHAPE);
    expect(processesNaming(root).filter((p) => p.command.includes('--render-host') || p.command.includes(join('mawsd', 'render-host'))).map((p) => p.command), 'no render host process at the window’s start').toEqual([]);
    const measurement = await measureWindow(procs);
    const sessionEnded = launchEnded(journal(userData, id));
    const reasons = invalidReasons({ loads: measurement.samples.map((s) => s.load), measured: measurement.names, lost: measurement.lost, sessionEnded, mismatches: measurement.mismatches });
    const { footprintKiB, rssKiB, cpuS, load } = measurement;
    const line = footprintKiB === null || rssKiB === null || cpuS === null ? null : idleLine({ footprintKiB, rssKiB, samples: measurement.whole, cpuS, processes: measurement.perProcess, bound: DAEMON_IDLE_BOUND, electron, load, loadPair: measurement.loadPair });
    const misses = footprintKiB === null || cpuS === null ? [] : boundMisses({ footprintKiB, cpuS }, DAEMON_IDLE_BOUND);
    report('daemon-idle-render.json', line, reasons, { shape: SHAPE, electron, bound: DAEMON_IDLE_BOUND, misses, ...measurement.record, sessionEnded });
    expect(misses, `warm to idle, the daemon shape's processes together are within DAEMON_IDLE_BOUND (${line})`).toEqual([]);
  } finally {
    held.endUnit?.();
    leftover = await removeScratch(root, userData, held.maws, [held.supervisor, held.daemon], held.evidence);
  }
  if (leftover !== null) throw leftover;
});

// P5 O17 M8 start (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M8; acceptance 9, OX7): the agent's browser warm
// to idle, and four kept sessions with live connectors, each on a profile's mawsd with no app (e2e/support/headless-browser.ts)
// whose engines are the cua engine stub that comes ready (the ordinary start path) with its connector, cua's host,
// connected throughout; no idle release, so the sessions stay live through the window. Both measure mawsd, the engine
// host and the pty host against DAEMON_IDLE_BOUND: the broker's code, each session's listener and connected socket are
// counted, never excluded. Before O17 M7 no engine host selects the headless route, so neither runs (BEFORE_M7).
const CUA_RETRY_MS = 5_000; // cua's CLIENT_RETRY_MS
const BROWSER_QUIET_MS = 30_000;
const browserElectron = () => execFileSync(electronBinary(), ['-p', 'process.versions.electron'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }).trim();
const workHeld = async (scene: HeadlessScene, id: AppSessionId) => ((await scene.sessionStatus(id)).work as { holds?: { browser?: string } } | undefined)?.holds?.browser;
const renderHosts = (root: string) => processesNaming(root).filter((p) => p.command.includes('--render-host') || p.command.includes(join('mawsd', 'render-host'))).map((p) => p.command);

// The window over a headless scene's daemon processes, its report written as `file`, the bound asserted
async function measuredHeadless(scene: HeadlessScene, ids: readonly AppSessionId[], file: string, extra: Record<string, unknown>): Promise<void> {
  await sleep(IDLE_RUN.settleS * 1_000);
  const procs = measured(processesNaming(scene.root), scene.root, measuredOn('daemon'));
  expect(procs.map((p) => p.pid), "the profile's mawsd is measured").toContain(scene.daemon.pid);
  const electron = browserElectron();
  const measurement = await measureWindow(procs);
  const ended = (await Promise.all(ids.map(async (id) => (await scene.sessionStatus(id)).process === 'exited'))).some(Boolean);
  const reasons = windowReasons(measurement, ended);
  const { footprintKiB, rssKiB, cpuS, load } = measurement;
  const line = footprintKiB === null || rssKiB === null || cpuS === null ? null : idleLine({ footprintKiB, rssKiB, samples: measurement.whole, cpuS, processes: measurement.perProcess, bound: DAEMON_IDLE_BOUND, electron, load, loadPair: measurement.loadPair });
  const misses = footprintKiB === null || cpuS === null ? [] : boundMisses({ footprintKiB, cpuS }, DAEMON_IDLE_BOUND);
  report(file, line, reasons, { shape: 'daemon', electron, bound: DAEMON_IDLE_BOUND, misses, ...extra, ...measurement.record, sessionEnded: ended });
  expect(misses, `the daemon shape's processes together are within DAEMON_IDLE_BOUND (${line})`).toEqual([]);
}

test('daemon idle render: the agent’s browser warm to idle, a real cua connector connected across two quiet periods and two 5 s retry intervals, the render host gone', async () => {
  test.skip(!ENGINE_HOST_BROWSER_WORK, BEFORE_M7);
  test.skip(!DAEMON, 'the agent’s headless browser is the daemon shape’s (MAWS_HOST_MODE=daemon)');
  const pages = await startPages();
  const scene = await startHeadlessScene({ keepSessions: true, engine: { retryMs: CUA_RETRY_MS, lifeMs: 60 * 60_000 }, env: { MAWS_RENDER_QUIET_MS: String(BROWSER_QUIET_MS) } });
  try {
    const repo = scene.repo(0);
    const id = await scene.start(repo);
    const cua = await scene.connector(repo);
    await expect.poll(async () => (await cua.state()).connected, { timeout: 15_000 }).toBe(true);
    const created = await answered('cua’s creation sequence', cua.sequence(pages.url('/')));
    await answered('tabs.remove', cua.call('tabs.remove', { tabId: created.tabId }));
    const exitLine = `[render] quiet for ${BROWSER_QUIET_MS / 1000} s: ending the render host`;
    await expect.poll(scene.mawsdLog, { timeout: BROWSER_QUIET_MS + 60_000, message: 'the first quiet period ends the render host' }).toContain(exitLine);
    await expect.poll(async () => (await scene.render()).pid, { timeout: 15_000 }).toBeNull();
    const starts = (await scene.render()).starts;
    const { closes, hellos } = await cua.state();
    // a second quiet period, spanning two of cua's retry intervals, with nothing asked: cua stays on the broker
    await sleep(Math.max(BROWSER_QUIET_MS, 2 * CUA_RETRY_MS) + 5_000);
    expect(await cua.state(), 'cua stayed connected: no close, no new hello').toMatchObject({ connected: true, closes, hellos });
    cua.close(); // the scene's control link only; the connector stays connected to the session's socket

    const render = await scene.render();
    expect(render, 'no render child and no tab; no start since the first exit').toMatchObject({ pid: null, starts });
    expect(render.browserTabs ?? 0).toBe(0);
    expect(await workHeld(scene, id), 'no browser-work hold').toBeUndefined();
    expect(renderHosts(scene.root), 'no render host process').toEqual([]);
    const resources = await mawsdResources(scene.userData, scene.daemon.pid);
    expect(resources.modules.some((name) => name.startsWith('cua-broker-')), 'the broker’s code is resident, and counted').toBe(true);
    expect(sessionListeners(scene.userData), 'the session’s listener, counted').toBe(1);
    await measuredHeadless(scene, [id], 'daemon-idle-render-browser.json', { case: 'browser warm to idle', starts, resources });
  } finally {
    await scene.stop();
    await pages.close();
  }
});

test('daemon idle render: four kept sessions with live stub engines and connected cua connectors and no app', async () => {
  test.skip(!ENGINE_HOST_BROWSER_WORK, BEFORE_M7);
  test.skip(!DAEMON, 'the agent’s headless browser is the daemon shape’s (MAWS_HOST_MODE=daemon)');
  const scene = await startHeadlessScene({ repos: 4, keepSessions: true, engine: { retryMs: CUA_RETRY_MS, lifeMs: 60 * 60_000 } });
  try {
    const ids: AppSessionId[] = [];
    for (let n = 0; n < 4; n += 1) ids.push(await scene.start(scene.repo(n), `kept session ${n + 1}`));
    for (let n = 0; n < 4; n += 1) {
      const cua = await scene.connector(scene.repo(n));
      await expect.poll(async () => (await cua.state()).connected, { timeout: 15_000, message: `session ${n + 1}’s cua connected` }).toBe(true);
      expect(await answered('tabs.query', cua.call('tabs.query')), 'answered cold').toEqual([]);
      cua.close();
    }
    expect(sessionListeners(scene.userData), 'one listener per live session with no app').toBe(4);
    expect((await scene.render()).starts, 'no Chromium started').toBe(0);
    await measuredHeadless(scene, ids, 'daemon-idle-render-kept.json', { case: 'four kept sessions' });
  } finally {
    await scene.stop();
  }
});
// P5 O17 M8 end

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
    const line = footprintKiB === null || rssKiB === null || cpuS === null ? null : floorLine({ footprintKiB, rssKiB, samples: measurement.whole, cpuS, electron, load, loadPair: measurement.loadPair });
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
    const line = footprintKiB === null || rssKiB === null || cpuS === null ? null : mawsdLine({ footprintKiB, rssKiB, samples: measurement.whole, cpuS, load, loadPair: measurement.loadPair });
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
    leftover = await removeScratch(root, userData, held.maws, [held.supervisor, held.daemon], held.evidence);
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
    leftover = await removeScratch(root, userData, held.maws, [held.supervisor, held.daemon], held.evidence);
  }
  if (leftover !== null) throw leftover;
  return leg;
}

// P5 O3-C M5 (D18, D19; O3 §11's diagnostic reading): the spine alone, O3-D's starting point. The profile-sized fixture
// (test/support/spine-fixture.ts: 5,000 sessions over 50 project folders, attention, library rows, drafts and the
// prompt history) written into a scratch profile, then the built out/main/services.js's idleReading run by a wrapper
// under the same Electron binary as Node, `--disable-sigusr1 --expose-gc`, argv0 `maws-spine`, with an environment of
// its own (HOME the scratch root, MAWS_USER_DATA the profile). It composes the spine with no host, no client and no
// interest, and says what it read. The loaded window is IDLE_RUN's settle and window; then SIGUSR2 stops the root and
// releases its data (V8's last-resort collection since P5 O3-D M2), and the released window is SPINE_RELEASED_RUN's. The
// same readers and validity rule over each window, which the line names with the fixture's counts and what the
// collection gave back; it asserts no bound and writes test-results/daemon-idle-spine.json. `pnpm e2e:daemon-idle-spine` runs this case alone (it needs
// the plain build; about 20 minutes: two settles and two windows).
test('daemon idle spine alone: the physical footprint and CPU of the spine composed alone over a profile-sized fixture, idle while loaded and after its data is released', async () => {
  test.setTimeout(35 * 60_000);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-dis-')));
  const profile = join(root, 'ud');
  const services = join(REPO_ROOT, 'out', 'main', 'services.js');
  expect(existsSync(services), 'the build has out/main/services.js (scripts/e2e-build.sh plain)').toBe(true);
  const binary = electronBinary();
  const env = { ELECTRON_RUN_AS_NODE: '1', PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root, MAWS_USER_DATA: profile };
  const electron = execFileSync(binary, ['-p', 'process.versions.electron'], { env, encoding: 'utf8' }).trim();
  let spine: ChildProcess | null = null;
  let output = '';
  const said = (line: RegExp) => output.split('\n').find((l) => line.test(l)) ?? null;
  let leftover: unknown = null;
  try {
    const counts = await writeSpineFixture({ profile, folders: join(root, 'projects') });
    const wrapper = join(root, 'spine.js');
    writeFileSync(wrapper, [
      `const { idleReading } = require(${JSON.stringify(services)});`,
      "idleReading({ profile: process.env.MAWS_USER_DATA, build: 'daemon-idle-spine', log: (line) => console.log(line) })",
      '  .catch((error) => { console.error(error); process.exit(1); });',
    ].join('\n'));
    spine = spawn(binary, ['--disable-sigusr1', '--expose-gc', wrapper], { env, stdio: ['ignore', 'pipe', 'pipe'], argv0: SPINE_ARGV0 });
    spine.stdout!.on('data', (chunk) => (output += String(chunk)));
    spine.stderr!.on('data', (chunk) => (output += String(chunk)));
    await expect.poll(() => output, { timeout: 60_000, message: 'the spine composes over the fixture' }).toMatch(/^spine idle: composed: /m); // a miss prints what it said
    expect(said(/^spine idle: composed: /), 'the spine holds the fixture').toBe(`spine idle: composed: ${counts.sessions} sessions in ${counts.projects} projects`);
    await sleep(IDLE_RUN.settleS * 1_000);
    const procs = measured(processesNaming(root), root, [SPINE_ARGV0]);
    expect(procs.map((p) => p.pid), 'the spine alone is what is measured').toEqual([spine.pid]);
    const loaded = await measureWindow(procs);

    spine.kill('SIGUSR2');
    await expect.poll(() => output, { timeout: 60_000, message: 'the spine releases its data' }).toMatch(/^spine idle: released /m);
    const collection = /^spine idle: released \((.*)\)$/.exec(said(/^spine idle: released /) ?? '')?.[1] ?? 'no release line';
    await sleep(SPINE_RELEASED_RUN.settleS * 1_000);
    const released = await measureWindow(procs, SPINE_RELEASED_RUN);

    const reasons = [
      ...windowReasons(loaded, false).map((reason) => `loaded: ${reason}`),
      ...windowReasons(released, false).map((reason) => `released: ${reason}`),
    ];
    const [before, after] = [shapeReading(loaded), shapeReading(released)];
    const line = before === null || after === null ? null : spineLine({ loaded: before, released: after, counts, collection, reasons });
    report('daemon-idle-spine.json', line, reasons, { shape: 'spine alone', electron, counts, collection, output: output.split('\n').filter(Boolean), loaded: loaded.record, released: released.record });
  } finally {
    spine?.kill('SIGKILL');
    await killScratchProcesses(root, spine?.pid === undefined ? [] : [spine.pid]).catch((error: unknown) => (leftover = error));
    rmSync(root, { recursive: true, force: true });
  }
  if (leftover !== null) throw leftover;
});

// P5 O3-D M2 (Interfaces §K; D5, D6): mawsd with the spine, §11's mechanism measured. The fixture of the spine-alone case
// in a scratch profile whose machine-settings.json sets `supervisor.idleExitMinutes: null` (no park, no idle exit), and
// the built out/main/mawsd.js under the same Electron binary as Node, `--disable-sigusr1`, argv0 `mawsd`, with an
// environment of its own: MAWS_SPINE_QUIET_MS=60000 (the measured seam of D6: the product's quiet is the idle time) and
// MAWS_ENGINE_REPLAY=1, so the engine host the spine's start wakes runs no engine. Two daemons in sequence, since a
// released unit daemon exits at once (D5) and a private one never re-executes (D6): (1) `run --private`, the spine
// loaded by a bare machine.sock client's session.list (the fixture's sessions read back) that holds its connection, read
// LOADED; the client closes, the quiet passes, the log reads `[spine] released`, read RELEASED; the daemon is stopped
// (SIGTERM). (2) `run --unit` with MAWS_SPINE_REEXECUTE=1 (re-execution is off by default, D38), restarted here on exit 75 as launchd would, following the new pid: the client loads the
// spine and closes, the quiet passes, the log reads `exited (spine released, code 75)`, the restart serves, read
// RE-EXECUTED. P5 O3-D M6 (fix round 1, the architect's ruling (a)): each load's bare session.list finds the engine
// host parked, so it wakes the host for its discovery pass (daemon.ts's discovery wake) and the host is asked to park
// again once the pass is heard. The fixture writes the transcripts its index rows name (CLAUDE_CONFIG_DIR is the
// profile's claude-config), each row the file's own stat and its text stamped ready, so the scan finds nothing to do:
// the case asserts the index unchanged by it (no removal, addition or re-index) and the host parked again before the
// LOADED window's settle ends, and annotates both; the RELEASED and RE-EXECUTED windows run with the host parked
// (asserted). M2's LOADED readings followed no wake, so they and these are not one-to-one comparable. Each window is SPINE_RELEASED_RUN's (120 s settle, 300 s, 11 samples, the load rule), over the
// processes measuredOn('daemon') finds once the window's daemon is stable. The line (mawsdSpineLine) names the three
// medians for mawsd and the engine host, the peak load and its pair, each window's validity and D5's verdict; it
// asserts no bound and writes test-results/daemon-idle-mawsd-spine.json. `pnpm e2e:daemon-idle-mawsd-spine` runs this
// case alone (it needs the plain build; about 24 minutes).
test('daemon idle mawsd with the spine: loaded, released, re-executed', async () => {
  test.setTimeout(27 * 60_000);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-dims-')));
  const profile = join(root, 'ud');
  const script = join(REPO_ROOT, 'out', 'main', 'mawsd.js');
  expect(existsSync(script), 'the build has out/main/mawsd.js (scripts/e2e-build.sh plain)').toBe(true);
  const binary = electronBinary();
  const claudeConfig = join(profile, 'claude-config'); // P5 O3-D M6: the store the fixture's transcripts are in, which the woken host scans
  const env = { ELECTRON_RUN_AS_NODE: '1', PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root, TMPDIR: process.env.TMPDIR ?? tmpdir(), MAWS_USER_DATA: profile, CLAUDE_CONFIG_DIR: claudeConfig, MAWS_SPINE_QUIET_MS: '60000', MAWS_ENGINE_REPLAY: '1' };
  const electron = execFileSync(binary, ['-p', 'process.versions.electron'], { env, encoding: 'utf8' }).trim();
  const logFile = join(profile, 'mawsd', 'mawsd.log');
  const log = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '');
  const lines = (text: string) => log().split('\n').filter((line) => line.includes(text)).length;
  const daemons: ChildProcess[] = [];
  let ending = false;
  const run = (kind: 'private' | 'unit'): ChildProcess => {
    // D38: re-execution is off by default; the unit daemon turns it on for itself so the scene reads the re-executed state
    const own = kind === 'unit' ? { ...env, MAWS_SPINE_REEXECUTE: '1' } : env;
    const child = spawn(binary, ['--disable-sigusr1', script, 'run', `--${kind}`, '--dir', join(profile, 'mawsd')], { env: own, stdio: 'ignore', argv0: MAWSD_ARGV0 });
    daemons.push(child);
    if (kind === 'unit') child.once('exit', (code) => void (code === 75 && !ending && run('unit'))); // launchd's restart on 75
    return child;
  };
  const serving = async (before: number) => expect.poll(() => lines(' serving; '), { timeout: 30_000, message: `mawsd serves:\n${log()}` }).toBeGreaterThan(before);
  const build = `${process.env.npm_package_version ?? '0.0.0'}+daemon-idle-mawsd-spine`;
  // A bare machine.sock client (machine-client.ts's hello): its session.list loads the spine and reads the fixture back
  // What the wake's scan could change in the index: each session's transcript stamp, archive and removal, and its text
  // index's stamp (P5 O3-D M6: compared before the first daemon and after each load)
  const indexFacts = () => {
    const db = new DatabaseSync(join(profile, 'index.sqlite'), { readOnly: true });
    try {
      return {
        sessions: db.prepare('SELECT app_id, engine_session_id, transcript_path, transcript_size, transcript_mtime_ms, archived, removed_at FROM sessions ORDER BY app_id').all(),
        text: db.prepare('SELECT app_id, session_id, size, mtime_ms, status FROM session_text_state ORDER BY app_id').all(),
      };
    } finally {
      db.close();
    }
  };
  // The engine host the latest wake woke: mawsd's `[hosts] connected to supervisor pid N` after its wake line (logged
  // before the pass can be heard). Not host.lock: the host drops it as it parks, which can come before the answer does.
  const wokenPid = () => {
    const text = log();
    const at = text.lastIndexOf('[spine] discovery: session.list wakes the parked engine host');
    const connected = at < 0 ? null : /\[hosts\] connected to supervisor pid (\d+) /.exec(text.slice(at));
    return connected ? Number(connected[1]) : null;
  };
  const wakeNotes: string[] = [];
  let factsBefore: ReturnType<typeof indexFacts> | null = null;
  // A bare machine.sock client (machine-client.ts's hello): its session.list loads the spine, wakes the parked engine
  // host for its discovery pass and reads the fixture back; then the host parks again, and the index is as it was
  const load = async (which: string) => {
    const wakesBefore = lines('[spine] discovery: session.list wakes the parked engine host');
    const startedAt = Date.now();
    const reached = await reachMachine(daemonPaths(profile, env.TMPDIR), { build });
    if (!reached.ok) throw new Error(`machine.sock: ${reached.state}: ${reached.why}`);
    const listed = await reached.link.request('session.list', { includeArchived: true }, 180_000);
    if (!listed.ok) throw new Error(`session.list: ${listed.error.code}: ${listed.error.message}`);
    const answeredAt = Date.now();
    expect(lines('[spine] discovery: session.list wakes the parked engine host'), `${which}: the read woke the parked engine host for its discovery pass:\n${log()}`).toBe(wakesBefore + 1);
    const heard = log().split('\n').filter((l) => l.includes('[spine] discovery: the pass is heard ')).at(-1) ?? 'no pass heard';
    const woken = wokenPid();
    expect(woken, `${which}: mawsd names the engine host its wake woke:\n${log()}`).not.toBeNull();
    await expect.poll(() => !isAlive(woken!) && log().includes(`[hosts] supervisor pid ${woken} exited (code 0)`), { timeout: 60_000, message: `${which}: the woken engine host (pid ${woken}) parks again:\n${log()}` }).toBe(true);
    const parkedAt = Date.now();
    const facts = indexFacts();
    const noOp = JSON.stringify(facts) === JSON.stringify(factsBefore);
    wakeNotes.push(`${which}: the read answered ${answeredAt - startedAt} ms after it was sent (${heard.trim()}); the woken engine host (pid ${woken}) parked again ${parkedAt - answeredAt} ms after the answer, before the LOADED settle (${SPINE_RELEASED_RUN.settleS} s) ends; the scan was ${noOp ? 'a no-op: the index unchanged' : 'NOT a no-op: the index changed'}`);
    test.info().annotations.push({ type: 'discovery wake', description: wakeNotes.at(-1)! });
    expect(facts, `${which}: the wake's scan changed nothing in the index (no removal, addition or re-index)`).toEqual(factsBefore);
    return { link: reached.link, sessions: (listed.value as { sessions: unknown[] }).sessions.length };
  };
  const hostParked = (procs: MeasuredProcess[], window: string) => expect(procs.filter((p) => p.argv0 === 'maws-supervisor').map((p) => p.pid), `the ${window} window runs with the engine host parked (D36)`).toEqual([]);
  const settled = async () => {
    await sleep(SPINE_RELEASED_RUN.settleS * 1_000);
    const procs = measured(processesNaming(root), root, measuredOn('daemon'));
    const live = daemons.filter((d) => d.exitCode === null && d.signalCode === null).map((d) => d.pid);
    expect(procs.filter((p) => p.argv0 === MAWSD_ARGV0).map((p) => p.pid), 'the live mawsd is what is measured').toEqual(live);
    return procs;
  };
  const windows: Record<SpineWindow, IdleWindow | null> = { loaded: null, released: null, reexecuted: null };
  // The engine host's log (its `idle: collected` lines) and mawsd's own (its `spine:` lines, its idle collection, the
  // exit 75), published redacted beside the JSON on pass or failure, once every process of the scratch has stopped. One
  // capture covers both daemons: each file is appended by both, and the engine host is one process through both (the
  // unit adopts it), so a second capture would find its log inherited and exclude it. The scene runs no engine (the
  // replay transport and no session, over a scratch HOME), so no account state can reach either log.
  const evidence = processEvidence(test.info().outputDir, profile, () => true, env, { daemon: join(profile, 'mawsd') });
  let leftover: unknown = null;
  try {
    const counts = await writeSpineFixture({ profile, folders: join(root, 'projects'), transcripts: claudeConfig });
    writeFileSync(join(profile, 'machine-settings.json'), JSON.stringify({ ...machineSettingsDefaults(), supervisor: { idleExitMinutes: null } }));
    factsBefore = indexFacts();

    // (1) a private daemon: loaded, then released
    const first = run('private');
    await serving(0);
    const holding = await load('private');
    expect(holding.sessions, 'the spine in mawsd reads the fixture').toBe(counts.sessions);
    const loadedProcs = await settled();
    const overlap = loadedProcs.some((p) => p.argv0 === 'maws-supervisor');
    test.info().annotations.push({ type: 'discovery wake', description: `the LOADED window ${overlap ? 'OVERLAPS the woken engine host: it is still measured' : 'starts with the engine host parked: no sample overlaps the host or its scan'}` });
    windows.loaded = await measureWindow(loadedProcs, SPINE_RELEASED_RUN);
    holding.link.close();
    await expect.poll(() => lines('[spine] released'), { timeout: 5 * 60_000, message: `the spine is released after the quiet:\n${log()}` }).toBe(1);
    const releasedProcs = await settled();
    hostParked(releasedProcs, 'RELEASED');
    windows.released = await measureWindow(releasedProcs, SPINE_RELEASED_RUN);
    first.kill('SIGTERM');
    await expect.poll(() => first.exitCode !== null || first.signalCode !== null, { timeout: 30_000, message: 'the private mawsd exits at SIGTERM' }).toBe(true);

    // (2) a unit daemon: loaded and closed, released, exit 75, restarted cold: re-executed
    const servedBefore = lines(' serving; ');
    run('unit');
    await serving(servedBefore);
    const loading = await load('unit');
    expect(loading.sessions, 'the unit mawsd reads the fixture').toBe(counts.sessions);
    loading.link.close();
    await expect.poll(() => lines('exited (spine released, code 75)'), { timeout: 5 * 60_000, message: `the unit mawsd re-executes after its release:\n${log()}` }).toBe(1);
    await serving(servedBefore + 1);
    expect(daemons, 'the harness restarted the unit').toHaveLength(3);
    const reexecutedProcs = await settled();
    hostParked(reexecutedProcs, 'RE-EXECUTED');
    windows.reexecuted = await measureWindow(reexecutedProcs, SPINE_RELEASED_RUN);

    const reasons = { loaded: [] as string[], released: [] as string[], reexecuted: [] as string[] };
    for (const key of Object.keys(windows) as SpineWindow[]) reasons[key] = windows[key] === null ? ['not read'] : windowReasons(windows[key]!, false);
    const readings = { loaded: read(windows.loaded), released: read(windows.released), reexecuted: read(windows.reexecuted) };
    const line = mawsdSpineLine({ windows: readings, reasons, counts });
    const all = (Object.keys(reasons) as SpineWindow[]).flatMap((key) => reasons[key].map((reason) => `${key}: ${reason}`));
    const spineLines = log().split('\n').filter((l) => /\[spine\] |exit(ing|ed) \(/.test(l));
    report('daemon-idle-mawsd-spine.json', line, all, { shape: 'mawsd with the spine', electron, counts, readings, reasons, spineLines, discoveryWake: wakeNotes, loaded: windows.loaded?.record, released: windows.released?.record, reexecuted: windows.reexecuted?.record });
  } finally {
    ending = true;
    for (const daemon of daemons) daemon.kill('SIGTERM');
    const pids = daemons.flatMap((d) => (d.pid === undefined ? [] : [d.pid]));
    await killScratchProcesses(root, pids).catch((error: unknown) => (leftover = error));
    try {
      evidence.finish();
    } catch (error) {
      leftover ??= error;
    }
    const sockets = daemonPaths(profile, env.TMPDIR).socketDir;
    if (!sockets.startsWith(root)) rmSync(sockets, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
  if (leftover !== null) throw leftover;
});

const read = (window: IdleWindow | null): ShapeReading | null => (window === null ? null : shapeReading(window));

// The Electron binary every measured process runs as Node (ELECTRON_RUN_AS_NODE=1), as its `electron` package names it.
function electronBinary(): string {
  return join(REPO_ROOT, 'node_modules', 'electron', 'dist', readFileSync(join(REPO_ROOT, 'node_modules', 'electron', 'path.txt'), 'utf8').trim());
}

// The window over the measured processes: their start times, then a sample every 30 s on a fixed schedule, each
// process's footprint (proc_pid_rusage) and `ps -o rss=` summed per sample and the 1-minute load, top's cross-check at
// the first sample, and `ps -o time=` at the start and the end; the window's 30 s pair from its loads. Each sample's one
// process table (`ps -axo`) tells which measured processes are still the ones it started with and, with the cores' CPU
// times read beside the load, gives the sample's diagnostics.
async function measureWindow(procs: readonly MeasuredProcess[], run: IdleRun = IDLE_RUN) {
  const started = new Map(procs.map((p) => [p.pid, ps(p.pid, 'lstart')]));
  const cpuAtStart = new Map(procs.map((p) => [p.pid, cpuSeconds(ps(p.pid, 'time'))]));
  const cpuAtEnd = new Map<number, number>();
  const samples: Sample[] = [];
  const lost: { pid: number; argv0: string; atS: number }[] = [];
  let crossCheck: CrossCheck | null = null;
  let lastTable: Map<number, ProcessRow> | null = null; // the previous sample's, for the interval's top process
  let lastTimes: CpuTimes | null = null; // the previous sample's, for the interval's busy share
  const windowStart = Date.now();
  for (let k = 0; k < run.samples; k += 1) {
    await sleep(Math.max(0, windowStart + k * run.everyS * 1_000 - Date.now()));
    const atS = Math.round((Date.now() - windowStart) / 1_000);
    const table = readProcessTable();
    const topProcess = topOutside(lastTable, table, procs.map((p) => p.pid));
    lastTable = table;
    const live = procs.filter((p) => table.get(p.pid)?.started === started.get(p.pid));
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
    const cpuTimesMs = cpuTimes();
    samples.push({ atS, load: loadavg()[0]!, footprintKiB, rssKiB, cpuTimesMs, busyShare: lastTimes === null ? null : busyShare(lastTimes, cpuTimesMs), topProcess });
    lastTimes = cpuTimesMs;
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
  const pair = loadPair(samples.map((s) => s.load));
  const processes = procs.map((p) => ({ ...p, started: started.get(p.pid), cpuStartS: cpuAtStart.get(p.pid), cpuEndS: cpuAtEnd.get(p.pid) ?? null }));
  return {
    samples, lost, mismatches, names, whole: whole.length, footprintKiB, rssKiB, perProcess, cpuS, load, loadPair: pair,
    record: { run, footprintKiB, rssKiB, perProcess, cpuS, load, loadPair: pair, processes, crossCheck, mismatches, lost, samples },
  };
}

type IdleWindow = Awaited<ReturnType<typeof measureWindow>>;

// Why a window is invalid under the load, liveness, held-session and readers rule (invalidReasons); empty when valid.
const windowReasons = (run: IdleWindow, sessionEnded: boolean) => invalidReasons({ loads: run.samples.map((s) => s.load), measured: run.names, lost: run.lost, sessionEnded, mismatches: run.mismatches });

// A window's reading as the lines take it; null when no sample read every process or one was lost.
const shapeReading = (run: IdleWindow): ShapeReading | null =>
  run.footprintKiB === null || run.cpuS === null ? null : { footprintKiB: run.footprintKiB, cpuS: run.cpuS, samples: run.whole, load: run.load, loadPair: run.loadPair, processes: run.perProcess.map((p) => ({ ...p, cpuS: p.cpuS! })) };

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
async function removeScratch(root: string, userData: string, maws: MawsLaunch | null, pids: readonly (number | null)[], evidence?: { finish(): void }): Promise<unknown> {
  const lock = lockOf(userData);
  await maws?.cleanup().catch((error: unknown) => console.error(error));
  let leftover: unknown = null;
  await killScratchProcesses(root, [lock?.pid, ...pids].filter((pid): pid is number => typeof pid === 'number')).catch((error: unknown) => (leftover = error));
  const socketDir = lock ? tmpSocketDirOf(userData, lock.socketPath) : null;
  if (socketDir !== null) rmSync(socketDir, { recursive: true, force: true });
  const daemonSockets = daemonPaths(userData).socketDir; // the daemon shape's, when its sockets took the fallback
  if (!daemonSockets.startsWith(root)) rmSync(daemonSockets, { recursive: true, force: true });
  try {
    evidence?.finish(); // the processes stopped, the directory not yet removed
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return leftover;
}
