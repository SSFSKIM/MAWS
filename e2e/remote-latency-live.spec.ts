// The live remote bench (P5 O7 M7, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M7's "The live bench" and
// its Decision Log entries of 2026-11-02; acceptance 3 over the real tailnet and hub): the measured group's measures
// (e2e/remote-latency.spec.ts) from this Mac against a scratch machine on the mini (`mini-bench`) or the acceptance VM
// (`vm-bench`), on the owner's go and never on a gate. Two machines, two clocks: delta-to-frame is read across them and
// judged over the clock offset's whole interval (test/support/remote-latency.ts's live clock), from 100 exchanges at
// each carrier's start and 50 at its end, the carrier void when those exchanges can't share one offset within 5 ms (O7
// Decision Log, 2026-11-10); round trip and open to first row are this Mac's clock alone.
//
// The owner's acts are their MAWS's sheets on their own Mac, each approval signed with Touch ID (production has no admin
// device): Settings › Org › People, Pair a device… for the bench app, and Settings › Org › Machines, Enroll a machine…
// for the machine, each sheet's code copied into its file on this Mac (0600) while the sheet stays open; the app runs one
// of them at a time, and the bench waits, bounded, for each file (CODE_WAIT), saying what it waits for.
//
//   0. the precheck (M10): this Mac's load1 and the machine's (the mini's `sysctl -n vm.loadavg`, the VM's
//      `/proc/loadavg`, through the run), each under Rule B's 5, or the run refuses to start: the refusal and both loads
//      written to the run's JSON and annotated, the test skipped with its reason, a recorded outcome rather than a failure
//      (attempt 2 measured on a runner at 97.7);
//   1. local: this Mac's own case, the latency stub as a scratch profile's engine (the same run's local numbers);
//   2. the bench app: a scratch profile (the config's, kept between runs) launched with the mock keychain (MAWS_E2E),
//      signed in from a pairing code read from its file and the file removed, then the owner's Access login in this
//      Mac's browser, then the owner comparing the fingerprint the bench prints with the Pair sheet's and approving there;
//      already registered, the code is not needed and its file is removed unread, and a profile whose session or hub
//      access lapsed signs in again in the browser (org.signIn, test/support/bench-sign-in.ts);
//   3. the machine (test/support/remote-bench.ts): the bench agent prepared, the scratch mawsd staged (on the VM, the
//      pack prepare-vm built there before the sitting, started; on the mini, this checkout's head bundle copied into the
//      profile, then started by mini-ops under the MAWS binary and waited for), enrolled with the code file on the
//      enroll's stdin alone and the file removed, the owner comparing the key id the bench prints with the Enroll sheet's
//      and approving there, the stub's session served and listed for the app's member by the harness's fake sminos on the
//      scratch RL10 socket;
//   4. per carrier, a fresh launch of the app over its profile: direct (the tailnet), then relay
//      (MAWS_E2E_REMOTE_CARRIER=relay refuses the direct dial, so the link comes up through the hub): the clock's start
//      exchanges, open to first row, 3 turns of 300 deltas sent from the pane (each frame and each write on the wall
//      clock), 220 round trips, resume, the clock's end exchanges.
//
// Resume, with no routing touched (the bench seam's `drop` and `release`, src/main/machines/remote/bench-seam.ts): main
// closes the link's current channel as a loss and holds the link off the machine; once the link reports down, the agent
// sends the session a turn and the stub writes it all; then main lifts the hold, the link attempts at once, and resume
// runs from its `up` again (main's Date.now) to the first event batch of that turn in A's renderer (its Date.now: one
// clock, this Mac's), judged against the same run's local engine start plus the rtt. When the link came back over the
// other carrier, the measure is void, with its reason; a case whose link moved while it was timed (the seam's mark and
// transitions), or one of whose pings came over the other carrier, is void as a whole, with its reason. Everything goes
// to test-results/remote-latency-live.json. The machine is torn down on every path; its scratch profile is kept until
// the bench is done (`MAWS_REMOTE_BENCH_REMOVE=1`, below). The file name's `-live` keeps
// main's output out of the test's evidence (e2e/support/process-evidence.mjs's captureAllowed), and Playwright's tracing
// and screenshots must be off, so the pairing code is in no artifact.
//
// Inputs: MAWS_REMOTE_BENCH, the path of a JSON file `{ app: { scratchRoot, profile, pairingFile? }, machines:
// [BenchMachine…] }` (test/support/remote-bench.ts's `BenchMachine`: name, transport, stage, codeFile, scratchRoot,
// profile, label, port, head, commit, node, quietUtc?, runtime?, stageHead?), and MAWS_REMOTE_BENCH_MACHINE, the name of
// the machine this run benches. Two more modes of the same file: MAWS_REMOTE_BENCH_PREPARE=1, prepare-vm before the
// sitting (this checkout's source at the commit installed and packed on the VM, once per commit), and
// MAWS_REMOTE_BENCH_REMOVE=1, the machine's scratch profile removed once the bench is done; with
// MAWS_REMOTE_BENCH_REMOVE_APP=1 beside it, the bench app's scratch profile on this Mac too (it holds the device's keys),
// once no process names it.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import type { OrgStatus } from '../src/shared/ipc/schema/org';
import { addressOf } from '../src/shared/machine/address';
import type { MachineRef } from '../src/shared/machine/ref';
import { FIXTURE_ENGINE_VERSION } from '../test/support/engine-pin';
import { BENCH, summarize } from '../test/support/local-latency';
import { benchSignIn } from '../test/support/bench-sign-in';
import { appProfileProblems, awaitCodeFile, BenchRun, buildHeadBundle, buildSourceArchive, CODE_WAIT, loadPrecheck, processRunner, type BenchMachine } from '../test/support/remote-bench';
import { carrierSwitch, CARRIERS, invalidReasons, LIVE_BENCH, liveClock, liveJudgement, loadVerdict, measureResume, REMOTE_BENCH, remoteLine, rttStats, signedStats, type CaseRun, type Carrier, type Exchange, type LinkTransition, type LiveJudgement, type LiveMeasures } from '../test/support/remote-latency';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { processesNaming } from './support/processes';
import { markerOf } from '../test/support/latency-engine';
import { cleanupAll, lastTurn, linkOf, localCase, main, measureTurns, openToFirstRow, pings, prompt, raw, roundTrips, TURN_MS, type Written } from './support/remote-latency-page';
import { showProjectList, sidebarOf } from './support/sidebar';

test.skip(process.env.MAWS_REMOTE_LATENCY_LIVE !== '1', 'the live remote bench runs under pnpm e2e:remote-latency-live, on the owner’s go');
test.describe.configure({ timeout: 150 * 60_000 });

const REMOVE = process.env.MAWS_REMOTE_BENCH_REMOVE === '1';
const REMOVE_APP = process.env.MAWS_REMOTE_BENCH_REMOVE_APP === '1';
const PREPARE = process.env.MAWS_REMOTE_BENCH_PREPARE === '1';
const SIGN_IN_MS = 15 * 60_000; // the owner's browser step and approval
const say = (line: string) => console.log(line);

interface LiveConfig {
  /** the bench app's profile on this Mac, strictly under its scratch root (launchMaws writes it and empties its claude-config) */
  app: { scratchRoot: string; profile: string; pairingFile?: string };
  machines: BenchMachine[];
}
function benchMachine(): { config: LiveConfig; machine: BenchMachine } {
  const path = process.env.MAWS_REMOTE_BENCH;
  const name = process.env.MAWS_REMOTE_BENCH_MACHINE;
  if (!path || !name) throw new Error('MAWS_REMOTE_BENCH names the bench config file and MAWS_REMOTE_BENCH_MACHINE the machine to bench');
  const config = JSON.parse(readFileSync(path, 'utf8')) as LiveConfig;
  const machine = config.machines.find((m) => m.name === name);
  if (machine === undefined) throw new Error(`the bench config has no machine ${name} (it has ${config.machines.map((m) => m.name).join(', ')})`);
  return { config, machine };
}

// The bench agent (test/support/remote-bench-agent.ts), bundled to CommonJS for the machine's runtime.
async function bundleAgent(dir: string): Promise<string> {
  const outfile = join(dir, 'bench-agent.cjs');
  await build({
    stdin: { contents: "require('./remote-bench-agent').main(process.argv.slice(2)).catch((e) => { process.stderr.write(`[bench-agent] ${e && e.message || e}\\n`); process.exit(1); });", resolveDir: join(REPO_ROOT, 'test/support'), loader: 'ts' },
    outfile, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'error', alias: { '@shared': join(REPO_ROOT, 'src/shared') },
  });
  return outfile;
}

// The app's sign-in over its page (test/support/bench-sign-in.ts): a registered profile signs in again; only an
// unregistered one waits for the pairing file and reads it, every path removing it.
function signIn(page: Page, pairingFile: string | undefined): Promise<string> {
  const removePairing = () => {
    if (pairingFile !== undefined) rmSync(pairingFile, { force: true });
  };
  return benchSignIn({
    status: () => raw<OrgStatus>(page, 'org.status', undefined),
    register: (code) => page.evaluate((c) => window.maws.invoke('org.register', { code: c }), code).then((r) => (r.ok ? (r.value as { ok: boolean; reason?: { code?: string } }) : { ok: false, reason: { code: r.error.code } })),
    signIn: () => page.evaluate(() => window.maws.invoke('org.signIn', undefined)).then((r) => (r.ok ? (r.value as { ok: boolean; reason?: { code?: string } }) : { ok: false, reason: { code: r.error.code } })),
    takePairing: async () => {
      if (pairingFile === undefined) return null;
      const act = 'the owner, in their MAWS: Settings › Org › People, Pair a device… on their own row, A Mac with MAWS, Make a code, Copy, and the code into that file (0600); the sheet stays open, since closing it cancels the pairing';
      if (!(await awaitCodeFile(pairingFile, { who: 'app', code: 'the pairing code', act }, CODE_WAIT.pairingMs, { say, sleep: (ms) => page.waitForTimeout(ms), now: Date.now }))) {
        throw new Error(`no pairing code came to ${pairingFile} within ${CODE_WAIT.pairingMs / 60_000} minutes`);
      }
      try {
        return readFileSync(pairingFile, 'utf8').trim();
      } finally {
        removePairing();
      }
    },
    removePairing,
    say,
    sleep: (ms) => page.waitForTimeout(ms),
    now: Date.now,
  }, SIGN_IN_MS);
}

// What the agent streams: its session ready, listed, and each delta the stub wrote.
interface Served {
  ready: { ref: MachineRef; app: string; engine: string; engineStartMs: number | null } | null;
  listed: boolean;
  failed: string | null;
  samples: Written[];
}
function served(): Served & { onLine(line: string): void } {
  const state: Served = { ready: null, listed: false, failed: null, samples: [] };
  return Object.assign(state, {
    onLine(line: string) {
      let message: { ready?: Served['ready']; listed?: unknown; failed?: { message: string }; sample?: Written };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        return;
      }
      if (message.ready) state.ready = message.ready;
      if (message.listed) state.listed = true;
      if (message.failed) state.failed = message.failed.message;
      if (message.sample) state.samples.push(message.sample);
    },
  });
}

/** A carrier's case; `void`, why its measures are not judged (its link moved while it was timed). */
type LiveCase = { measures: LiveMeasures | null; void: string | null; run: CaseRun | null; exchanges: { start: Exchange[]; end: Exchange[] }; roundTripsMs: number[] };

type Seam = {
  drop(ref: string): boolean;
  unhold(ref: string): void;
  release(ref: string, timeoutMs: number): Promise<{ upAt: number; carrier: Carrier | null } | null>;
  mark(ref: string): void;
  transitions(ref: string): LinkTransition[];
};

// A's renderer's event batches of the session that carry `turn` (its prompt or one of its markers), each with its
// arrival on the renderer's Date.now, kept from now on.
async function keepTurnArrivals(page: Page, machine: MachineRef, app: string, turn: number): Promise<void> {
  await page.evaluate(([on, id, needles]) => {
    const kept: number[] = [];
    (window as unknown as { __turnArrivals: number[] }).__turnArrivals = kept;
    window.maws.on('session.eventBatch', (batch, from) => {
      if (from !== on || (batch as { appSessionId?: string }).appSessionId !== id) return;
      const at = Date.now();
      const text = JSON.stringify(batch);
      if (needles.some((needle) => text.includes(needle))) kept.push(at);
    });
  }, [machine, app, [prompt(turn), `${markerOf(turn, 1).split(':')[0]}:`]] as const);
}
const turnArrivals = (page: Page) => page.evaluate(() => (window as unknown as { __turnArrivals: number[] }).__turnArrivals);

// The live resume (test/support/remote-latency.ts's measureResume, which lifts the hold on every path): the link dropped
// through the seam and held down while the machine's session writes a turn, then released; from its `up` again to the
// turn's first event batch in A. Null with the reason when not measured.
async function liveResume(page: Page, app: Parameters<typeof pings>[0], ref: MachineRef, session: string, carrier: Carrier, samples: () => Written[], turn: (content: string) => void, reasons: string[]): Promise<number | null> {
  const gapTurn = lastTurn(samples()) + 1;
  await keepTurnArrivals(page, ref, session, gapTurn);
  const { resumeMs, reason } = await measureResume(carrier, {
    drop: () => app.evaluate((_electron, machine) => (globalThis as { __maws_remote_bench?: Seam }).__maws_remote_bench!.drop(machine), ref),
    unhold: () => app.evaluate((_electron, machine) => (globalThis as { __maws_remote_bench?: Seam }).__maws_remote_bench!.unhold(machine), ref),
    down: () => expect.poll(async () => (await linkOf(page, ref))?.state, { timeout: 30_000, message: 'the link down once dropped' }).toBe('down'),
    writeTurn: async () => {
      turn(prompt(gapTurn));
      await expect.poll(() => samples().filter((w) => w.turn === gapTurn).length, { timeout: TURN_MS, message: `turn ${gapTurn} written on the machine while the link is down` }).toBe(BENCH.markersPerTurn);
    },
    reachedWhileHeld: async () => (await turnArrivals(page)).length > 0,
    release: () => app.evaluate((_electron, machine) => (globalThis as { __maws_remote_bench?: Seam }).__maws_remote_bench!.release(machine, 60_000), ref),
    firstArrival: async () => {
      let first: number | null = null;
      await expect.poll(async () => (first = (await turnArrivals(page))[0] ?? null), { timeout: 60_000, message: `turn ${gapTurn}'s first event in A` }).not.toBeNull();
      return first!;
    },
    shown: () => expect.poll(async () => (await main(page).evaluate((region) => region.textContent ?? '')).includes(markerOf(gapTurn, BENCH.markersPerTurn).trim()), { timeout: 30_000, message: `turn ${gapTurn} in A’s pane` }).toBe(true),
  });
  if (reason !== null) reasons.push(reason);
  return resumeMs;
}

// One carrier over a fresh launch of the bench app: its link up over that carrier, the clock's start, open, turns, round
// trips, the clock's end, and the carrier asserted again; null with the reason when the link came up over another. Its
// link is watched over the timed part (the seam's mark and transitions: from its start to the resume's drop, and from
// the resume's up to its end, the resume's own drop being no switch), and every ping's carrier read: a case whose link
// moved, or whose pings came over another carrier, is void with its reason.
async function liveCarrier(page: Page, app: Parameters<typeof pings>[0], ref: MachineRef, session: string, carrier: Carrier, samples: () => Written[], turn: (content: string) => void, reasons: string[]): Promise<LiveCase | null> {
  const carried = async () => {
    const m = await linkOf(page, ref);
    return m === undefined ? 'gone' : `${m.state}/${m.carrier ?? 'none'}`;
  };
  let seen = await carried();
  for (const deadline = Date.now() + 90_000; seen !== `up/${carrier}` && Date.now() < deadline; seen = await carried()) await page.waitForTimeout(500);
  if (seen !== `up/${carrier}`) {
    reasons.push(`${carrier}: the link was ${seen} after 90 s, not up/${carrier}`);
    return null;
  }
  const transitions = () => app.evaluate((_electron, machine) => (globalThis as { __maws_remote_bench?: Seam }).__maws_remote_bench!.transitions(machine), ref);
  await app.evaluate((_electron, machine) => (globalThis as { __maws_remote_bench?: Seam }).__maws_remote_bench!.mark(machine), ref);
  await expect.poll(async () => (await raw<{ rows: { machine: string; session: string }[] }>(page, 'org.rows', undefined)).rows.some((r) => r.machine === ref && r.session === session), { timeout: 60_000, message: 'the bench session is a row of the app’s' }).toBe(true);
  const start = await pings(app, ref, REMOTE_BENCH.pings);
  await showProjectList(page);
  const machineRow = sidebarOf(page).locator(`[data-kind="project"][data-tree-id="p:machine:${ref}"]`);
  await expect(async () => {
    if ((await machineRow.getAttribute('aria-expanded')) !== 'true') await machineRow.locator('[data-project-line]').click();
    await expect(machineRow).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  const row = sidebarOf(page).locator(`[role="treeitem"][data-tree-id="s:${addressOf(ref, session)}"]`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  const openToFirstRowMs = await openToFirstRow(page, row);
  const composer = main(page).getByRole('textbox', { name: 'Message' });
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await page.mouse.move(700, 20);
  const closed = () =>
    page.evaluate(async ([id, on]) => {
      const answer = await window.maws.invoke('session.status', { appSessionId: id as never }, on as never);
      return answer.ok && (answer.value as { process: string; turn: unknown }).process === 'ready' && (answer.value as { turn: unknown }).turn === null;
    }, [session, ref] as const);
  const { run, delays } = await measureTurns(page, samples, {
    send: async (turn) => {
      await composer.click();
      await page.keyboard.type(prompt(turn));
      await page.keyboard.press('Enter');
      await page.mouse.move(700, 20);
    },
    closed,
  }, 'wall');
  const trips = await roundTrips(page, session, ref);
  const timed = carrierSwitch(carrier, 'the start exchanges, the open, the turns and the round trips', await transitions(), start);
  const resumeMs = await liveResume(page, app, ref, session, carrier, samples, turn, reasons);
  await expect.poll(closed, { timeout: TURN_MS, message: 'the resume’s turn closed' }).toBe(true);
  const end = await pings(app, ref, LIVE_BENCH.clockExchanges);
  const ended = carrierSwitch(carrier, 'the resume and the end exchanges', await transitions(), end);
  const after = await carried();
  if (after !== `up/${carrier}`) reasons.push(`${carrier}: the link was ${after} after the case's measures, not up/${carrier}`);
  const voided = timed ?? ended;
  if (voided !== null) reasons.push(voided);
  const measures: LiveMeasures | null = delays.length === 0 || start.length === 0 ? null : { rawDelta: signedStats(delays)!, rawSamples: delays, roundTrip: summarize(trips, BENCH.roundTripWarmup), openToFirstRowMs, rtt: rttStats(start), clock: liveClock(start, end), resumeMs };
  return { measures, void: voided, run, exchanges: { start, end }, roundTripsMs: trips };
}

test('remote latency, live: delta to frame across two clocks, round trip and open of a lane B session on a scratch bench machine, per carrier, against the same run’s local numbers (acceptance 3)', async () => {
  test.skip(REMOVE || PREPARE, 'MAWS_REMOTE_BENCH_REMOVE=1 removes the scratch profile alone, MAWS_REMOTE_BENCH_PREPARE=1 prepares the VM alone');
  const use = test.info().project.use as { trace?: unknown; screenshot?: unknown; video?: unknown };
  for (const what of ['trace', 'screenshot', 'video'] as const) {
    const setting = use[what];
    const mode = typeof setting === 'object' && setting !== null ? (setting as { mode?: unknown }).mode : setting;
    expect(mode === undefined || mode === 'off', `Playwright's ${what} is off, so the pairing step is in no artifact`).toBe(true);
  }
  const { config, machine } = benchMachine();
  const bench = new BenchRun(machine, { runner: processRunner(), engineVersion: FIXTURE_ENGINE_VERSION, say });
  // the precheck, before anything starts: a loaded runner or mini refuses the run, recorded
  const macLoad = loadavg()[0];
  const machineLoad = await bench.load1();
  const precheckLoads = { mac: macLoad, machine: machineLoad };
  const refused = loadPrecheck({ mac: macLoad, machine: { name: machine.name, load: machineLoad } });
  if (refused !== null) {
    const info = test.info();
    mkdirSync(info.project.outputDir, { recursive: true });
    writeFileSync(join(info.project.outputDir, 'remote-latency-live.json'), `${JSON.stringify({ machine: machine.name, transport: machine.transport.kind, commit: machine.commit, valid: false, precheck: { refused, loads: precheckLoads } }, null, 2)}\n`);
    const line = `[remote-latency-live] ${machine.name}: the precheck refused the run: ${refused}`;
    console.log(line);
    info.annotations.push({ type: 'remote-latency-live', description: line });
    test.skip(true, `the precheck refused the run: ${refused}`);
    return;
  }
  say(`[bench] ${machine.name}: the precheck passed (this Mac’s load1 ${macLoad.toFixed(2)}, ${machine.name}’s ${typeof machineLoad === 'number' ? machineLoad.toFixed(2) : machineLoad})`);
  const loads = [loadavg()[0]];
  const sampler = setInterval(() => loads.push(loadavg()[0]), 30_000);
  let terminalLoad: number | undefined;
  const reasons: string[] = [];
  const appProblems = appProfileProblems(config.app.profile, config.app.scratchRoot, homedir());
  expect(appProblems, 'the bench app’s profile is a scratch profile').toEqual([]);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-rll-')));
  mkdirSync(config.app.profile, { recursive: true });
  const stream = served();
  let a: MawsLaunch | null = null;
  const cases: Record<'local' | Carrier, CaseRun | null> = { local: null, direct: null, relay: null };
  const live: Partial<Record<Carrier, LiveCase>> = {};
  let local: Awaited<ReturnType<typeof localCase>> | undefined;
  let member: string | undefined;
  try {
    local = await localCase(root);
    cases.local = local.run;

    // 2. The bench app, signed in.
    a = await launchMaws({ userData: config.app.profile });
    member = await signIn(a.page, config.app.pairingFile);
    await a.cleanup();
    a = null;

    // 3. The machine: staged, enrolled, its session served and listed for the app's member.
    await bench.prepare(await bundleAgent(root));
    // the machine's head: the VM's prepared before the sitting (MAWS_REMOTE_BENCH_PREPARE=1, below); the mini's head
    // bundle from this checkout by default (its HEAD must be the commit), nothing for a mini whose head mini-ops put there
    const copied = machine.stage === 'mini-ops' && (machine.stageHead ?? 'copy') === 'copy';
    await bench.stage(copied ? await buildHeadBundle(REPO_ROOT, join(root, 'head-bundle'), processRunner(), machine.commit) : undefined);
    await bench.enroll();
    bench.serve((line) => stream.onLine(line));
    await expect.poll(() => stream.failed ?? (stream.ready === null ? null : 'ready'), { timeout: 5 * 60_000, message: 'the bench agent’s session ready' }).toBe('ready');
    bench.list([member], 'MAWS remote bench');
    await expect.poll(() => stream.failed ?? (stream.listed ? 'listed' : null), { timeout: 60_000, message: 'the bench session listed' }).toBe('listed');
    const { ref, app } = stream.ready!;
    say(`[bench] ${machine.name}: the bench session is served and listed (its first turn ${stream.samples.length} deltas)`);

    // 4. Per carrier, a fresh launch over the app's profile.
    for (const carrier of CARRIERS) {
      rmSync(join(config.app.profile, 'layout.json'), { force: true }); // a restored tab would show the history before the click
      a = await launchMaws({ userData: config.app.profile, env: carrier === 'relay' ? { MAWS_E2E_REMOTE_CARRIER: 'relay' } : {} });
      const one = await liveCarrier(a.page, a.app, ref, app, carrier, () => stream.samples, (content) => bench.turn(content), reasons);
      if (one !== null) {
        live[carrier] = one;
        cases[carrier] = one.run;
      }
      await a.cleanup();
      a = null;
    }
  } finally {
    clearInterval(sampler);
    terminalLoad = loadavg()[0];
    await cleanupAll([() => a?.cleanup(), () => bench.teardown(), () => rmSync(root, { recursive: true, force: true })]);
  }

  const judged: Partial<Record<Carrier, LiveJudgement>> = {};
  const misses: string[] = [];
  const inconclusive: string[] = [];
  const localMeasures = local?.measures ?? null;
  for (const carrier of CARRIERS) {
    const measures = live[carrier]?.measures ?? null;
    if (localMeasures === null || measures === null || live[carrier]?.void != null) continue; // a void case is not judged
    const j = (judged[carrier] = liveJudgement(carrier, localMeasures, measures));
    if (j.void !== null) reasons.push(j.void);
    misses.push(...j.misses);
    inconclusive.push(...j.inconclusive);
  }
  const all = invalidReasons({ cases, pings: { direct: live.direct?.exchanges.start.length ?? 0, relay: live.relay?.exchanges.start.length ?? 0 }, loads, terminalLoad: terminalLoad ?? null, notes: reasons, signed: CARRIERS });
  const load = loadVerdict(loads, terminalLoad ?? null);
  const lines = [
    ...(localMeasures === null ? [] : [remoteLine('local', localMeasures)]),
    ...CARRIERS.flatMap((c) => {
      const m = live[c]?.measures;
      const j = judged[c];
      if (m == null || j === undefined) return [];
      const f = (value: number) => value.toFixed(1);
      const delta = j.delta === null ? 'not judged (the clock voids it)' : `[${f(j.delta.p50IntervalMs[0])}, ${f(j.delta.p50IntervalMs[1])}] ms, ${j.delta.verdict}`;
      return [`[remote-latency-live] ${c}: delta-to-frame p50 ${delta} (bound ${f(j.bounds.deltaToFrameP50Ms)} ms, n=${m.rawDelta.n}) · round trip p50 ${f(m.roundTrip.p50)} ms · open to first row ${f(m.openToFirstRowMs)} ms · resume ${m.resumeMs === null ? 'not measured' : `${f(m.resumeMs)} ms (bound ${f(j.bounds.resumeMs)} ms)`} · rtt p50 ${f(m.rtt.p50)} ms (n=${m.rtt.n}) · clock gap ${m.clock === null ? '?' : f(m.clock.gapMs)} ms (spread ${m.clock === null ? '?' : f(m.clock.spreadMs)} ms)`];
    }),
  ];
  const info = test.info();
  mkdirSync(info.project.outputDir, { recursive: true });
  writeFileSync(join(info.project.outputDir, 'remote-latency-live.json'), `${JSON.stringify({
    lines, machine: machine.name, transport: machine.transport.kind, commit: machine.commit, valid: all.length === 0,
    local: localMeasures,
    direct: live.direct === undefined ? null : { measures: live.direct.measures, void: live.direct.void, judgement: judged.direct ?? null },
    relay: live.relay === undefined ? null : { measures: live.relay.measures, void: live.relay.void, judgement: judged.relay ?? null },
    invalidReasons: all, budgetMisses: misses, inconclusive,
    load: { samples: loads, terminal: terminalLoad ?? null, peak: load.peak, pair: load.pair, precheck: precheckLoads },
    machineEngineStartMs: stream.ready?.engineStartMs ?? null,
    roundTripsMs: { local: local?.roundTripsMs ?? [], direct: live.direct?.roundTripsMs ?? [], relay: live.relay?.roundTripsMs ?? [] },
    exchanges: { direct: live.direct?.exchanges ?? null, relay: live.relay?.exchanges ?? null },
  }, null, 2)}\n`);
  for (const line of [...lines, ...inconclusive.map((l) => `[remote-latency-live] inconclusive: ${l}`)]) {
    console.log(line);
    info.annotations.push({ type: 'remote-latency-live', description: line });
  }
  say(`[bench] ${machine.name}: done; the scratch profiles are kept until the bench is done (MAWS_REMOTE_BENCH_REMOVE=1, with MAWS_REMOTE_BENCH_REMOVE_APP=1 for the app's), and the owner, in their MAWS with Touch ID, drops the machine (Settings › Org › Machines, Drop… on ${machine.name}, "Its key may be compromised" ticked) and removes the bench app's device (Settings › Org › People, Remove device… on its line)${member === undefined ? '; no member was read' : ''}`);
  expect(all, 'the run is valid').toEqual([]);
  expect(misses, 'every carrier within acceptance 3’s bounds of the same run’s local numbers, or inconclusive').toEqual([]);
});

test('remote latency, live: prepare-vm, the VM’s head installed and packed at the commit from this checkout’s source, before the sitting', async () => {
  test.skip(!PREPARE, 'runs under MAWS_REMOTE_BENCH_PREPARE=1, before the sitting');
  test.setTimeout(75 * 60_000);
  const { machine } = benchMachine();
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'maws-rll-prep-')));
  try {
    const bench = new BenchRun(machine, { runner: processRunner(), engineVersion: FIXTURE_ENGINE_VERSION, say });
    await bench.prepareVm(await buildSourceArchive(REPO_ROOT, out, processRunner(), machine.commit));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('remote latency, live: the bench machine’s scratch profile removed once the bench is done, refused while a bench process lives', async () => {
  test.skip(!REMOVE, 'runs under MAWS_REMOTE_BENCH_REMOVE=1, once the bench is done');
  const { config, machine } = benchMachine();
  const bench = new BenchRun(machine, { runner: processRunner(), engineVersion: FIXTURE_ENGINE_VERSION, say });
  expect(await bench.removeProfile(), 'no bench process is left on the machine').toBe(true);
  if (!REMOVE_APP) return;
  // the bench app's profile on this Mac (its device's keys, its Access token, its logs): a scratch profile only, and
  // only while nothing runs over it
  const app = config.app.profile;
  expect(appProfileProblems(app, config.app.scratchRoot, homedir()), 'the bench app’s profile is a scratch profile').toEqual([]);
  if (!existsSync(app)) {
    say(`[bench] app: no scratch profile at ${app}; nothing to remove`);
    return;
  }
  expect(processesNaming(app).map((p) => `${p.pid} ${p.command}`), 'no process runs over the bench app’s profile').toEqual([]);
  rmSync(app, { recursive: true, force: true });
  say(`[bench] app: the scratch profile ${app} is removed; the owner removes its device in their MAWS if they have not (Settings › Org › People, Remove device…)`);
});
