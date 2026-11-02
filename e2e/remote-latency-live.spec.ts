// The live remote bench (P5 O7 M7, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M7's "The live bench" and
// its Decision Log entries of 2026-11-02; acceptance 3 over the real tailnet and hub): the measured group's measures
// (e2e/remote-latency.spec.ts) from this Mac against a scratch machine on the mini (`mini-bench`) or the acceptance VM
// (`vm-bench`), on the owner's go and never on a gate. Two machines, two clocks: delta-to-frame is read across them and
// judged over the clock offset's whole interval (test/support/remote-latency.ts's live clock), from 100 exchanges at
// each carrier's start and 50 at its end; round trip and open to first row are this Mac's clock alone.
//
//   1. local: this Mac's own case, the latency stub as a scratch profile's engine (the same run's local numbers);
//   2. the bench app: a scratch profile (the config's, kept between runs) launched with the mock keychain (MAWS_E2E),
//      signed in from a pairing code read from its file and the file removed, the owner comparing the fingerprint and
//      approving at their terminal; already signed in, the code is not needed and its file is removed unread;
//   3. the machine (test/support/remote-bench.ts): the bench agent prepared, the scratch mawsd staged (packed and started
//      on the VM; started by mini-ops on the mini and waited for), enrolled with the code file on the enroll's stdin
//      alone and the file removed, the stub's session served and listed for the app's member by the harness's fake
//      sminos on the scratch RL10 socket;
//   4. per carrier, a fresh launch of the app over its profile: direct (the tailnet), then relay
//      (MAWS_E2E_REMOTE_CARRIER=relay refuses the direct dial, so the link comes up through the hub): the clock's start
//      exchanges, open to first row, 3 turns of 300 deltas sent from the pane (each frame and each write on the wall
//      clock), 220 round trips, the clock's end exchanges.
//
// Resume after a drop is the measured group's (one clock) and the sitting's lid-close (P5 acceptance 7's app half), not
// this bench's. Everything goes to test-results/remote-latency-live.json. The machine is torn down on every path; its
// scratch profile is kept until the bench is done (`MAWS_REMOTE_BENCH_REMOVE=1`, below). The file name's `-live` keeps
// main's output out of the test's evidence (e2e/support/process-evidence.mjs's captureAllowed), and Playwright's tracing
// and screenshots must be off, so the pairing code is in no artifact.
//
// Inputs: MAWS_REMOTE_BENCH, the path of a JSON file `{ app: { profile, pairingFile? }, machines: [BenchMachine…] }`
// (test/support/remote-bench.ts's `BenchMachine`: name, transport, stage, codeFile, profile, label, port, head, commit,
// node, quietUtc?), and MAWS_REMOTE_BENCH_MACHINE, the name of the machine this run benches.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import type { OrgStatus } from '../src/shared/ipc/schema/org';
import { addressOf } from '../src/shared/machine/address';
import type { MachineRef } from '../src/shared/machine/ref';
import { FIXTURE_ENGINE_VERSION } from '../test/support/engine-pin';
import { BENCH, summarize } from '../test/support/local-latency';
import { BenchRun, processRunner, type BenchMachine } from '../test/support/remote-bench';
import { CARRIERS, invalidReasons, LIVE_BENCH, liveClock, liveJudgement, loadVerdict, REMOTE_BENCH, remoteLine, rttStats, type CaseRun, type Carrier, type Exchange, type LiveJudgement, type LiveMeasures } from '../test/support/remote-latency';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { cleanupAll, linkOf, localCase, main, measureTurns, openToFirstRow, pings, prompt, raw, roundTrips, type Written } from './support/remote-latency-page';
import { showProjectList, sidebarOf } from './support/sidebar';

test.skip(process.env.MAWS_REMOTE_LATENCY_LIVE !== '1', 'the live remote bench runs under pnpm e2e:remote-latency-live, on the owner’s go');
test.describe.configure({ timeout: 150 * 60_000 });

const REMOVE = process.env.MAWS_REMOTE_BENCH_REMOVE === '1';
const SIGN_IN_MS = 15 * 60_000; // the owner's browser step and approval
const say = (line: string) => console.log(line);

interface LiveConfig {
  app: { profile: string; pairingFile?: string };
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

const orgStatus = (page: Page) => raw<OrgStatus>(page, 'org.status', undefined);
const signedIn = (s: OrgStatus) => s.state === 'registered' && s.session === 'signed-in' && s.hubAccess === 'connected';

// The app's sign-in: already signed in, or registered from the pairing code read from its file, which is removed at
// once whatever follows. The code crosses only into org.register's input; nothing here prints it, and an error that
// could carry it is replaced by one that cannot.
async function signIn(page: Page, pairingFile: string | undefined): Promise<string> {
  const now = await orgStatus(page);
  if (signedIn(now)) {
    if (pairingFile !== undefined && existsSync(pairingFile)) rmSync(pairingFile, { force: true });
    say(`[bench] app: already signed in to ${now.state === 'registered' ? now.org : '?'}; the unused pairing file is removed`);
    return (now as Extract<OrgStatus, { state: 'registered' }>).member.id;
  }
  if (pairingFile === undefined || !existsSync(pairingFile)) throw new Error(`the bench app is not signed in (${now.state}) and the config names no pairing file that exists`);
  let attempt: { ok: boolean; reason?: { code?: string } };
  try {
    const code = readFileSync(pairingFile, 'utf8').trim();
    rmSync(pairingFile, { force: true });
    attempt = await page.evaluate((c) => window.maws.invoke('org.register', { code: c }), code).then((r) => (r.ok ? (r.value as typeof attempt) : { ok: false, reason: { code: r.error.code } }));
  } catch {
    throw new Error('org.register did not answer (its error is not shown, since it could carry the code)');
  } finally {
    rmSync(pairingFile, { force: true });
  }
  if (!attempt.ok) throw new Error(`org.register refused the pairing code: ${attempt.reason?.code ?? 'no reason'}`);
  say('[bench] app: the pairing file is removed; the owner signs in in the browser, then compares the fingerprint below with `admin pair`’s and approves');
  let last = '';
  for (const deadline = Date.now() + SIGN_IN_MS; ; ) {
    const s = await orgStatus(page);
    if (signedIn(s)) {
      say(`[bench] app: signed in to ${(s as Extract<OrgStatus, { state: 'registered' }>).org}`);
      return (s as Extract<OrgStatus, { state: 'registered' }>).member.id;
    }
    const line = s.state === 'registering' ? `registering: ${s.step}${s.fingerprint === null ? '' : `; the fingerprint to compare: ${s.fingerprint}`}` : s.state === 'registered' ? `registered: ${s.session}, hub ${s.hubAccess}` : s.state;
    if (line !== last) say(`[bench] app: ${(last = line)}`);
    if (Date.now() > deadline) throw new Error(`the bench app did not sign in within ${SIGN_IN_MS / 60_000} minutes (${line})`);
    await page.waitForTimeout(2_000);
  }
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

type LiveCase = { measures: LiveMeasures | null; run: CaseRun | null; exchanges: { start: Exchange[]; end: Exchange[] }; roundTripsMs: number[] };

// One carrier over a fresh launch of the bench app: its link up over that carrier, the clock's start, open, turns, round
// trips, the clock's end, and the carrier asserted again; null with the reason when the link came up over another.
async function liveCarrier(page: Page, app: Parameters<typeof pings>[0], ref: MachineRef, session: string, carrier: Carrier, samples: () => Written[], reasons: string[]): Promise<LiveCase | null> {
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
  const end = await pings(app, ref, LIVE_BENCH.clockExchanges);
  const after = await carried();
  if (after !== `up/${carrier}`) reasons.push(`${carrier}: the link was ${after} after the case's measures, not up/${carrier}`);
  const measures: LiveMeasures | null = delays.length === 0 || start.length === 0 ? null : { rawDelta: summarize(delays, 0), roundTrip: summarize(trips, BENCH.roundTripWarmup), openToFirstRowMs, rtt: rttStats(start), clock: liveClock(start, end) };
  return { measures, run, exchanges: { start, end }, roundTripsMs: trips };
}

test('remote latency, live: delta to frame across two clocks, round trip and open of a lane B session on a scratch bench machine, per carrier, against the same run’s local numbers (acceptance 3)', async () => {
  test.skip(REMOVE, 'MAWS_REMOTE_BENCH_REMOVE=1 removes the scratch profile alone');
  const use = test.info().project.use as { trace?: unknown; screenshot?: unknown; video?: unknown };
  for (const what of ['trace', 'screenshot', 'video'] as const) {
    const setting = use[what];
    const mode = typeof setting === 'object' && setting !== null ? (setting as { mode?: unknown }).mode : setting;
    expect(mode === undefined || mode === 'off', `Playwright's ${what} is off, so the pairing step is in no artifact`).toBe(true);
  }
  const { config, machine } = benchMachine();
  const loads = [loadavg()[0]];
  const sampler = setInterval(() => loads.push(loadavg()[0]), 30_000);
  let terminalLoad: number | undefined;
  const reasons: string[] = [];
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-rll-')));
  mkdirSync(config.app.profile, { recursive: true });
  const bench = new BenchRun(machine, { runner: processRunner(), engineVersion: FIXTURE_ENGINE_VERSION, say });
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
    await bench.stage();
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
      const one = await liveCarrier(a.page, a.app, ref, app, carrier, () => stream.samples, reasons);
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
    if (localMeasures === null || measures === null) continue;
    const j = (judged[carrier] = liveJudgement(carrier, localMeasures, measures));
    if (j.void !== null) reasons.push(j.void);
    misses.push(...j.misses);
    inconclusive.push(...j.inconclusive);
  }
  const all = invalidReasons({ cases, pings: { direct: live.direct?.exchanges.start.length ?? 0, relay: live.relay?.exchanges.start.length ?? 0 }, loads, terminalLoad: terminalLoad ?? null, notes: reasons });
  const load = loadVerdict(loads, terminalLoad ?? null);
  const lines = [
    ...(localMeasures === null ? [] : [remoteLine('local', localMeasures)]),
    ...CARRIERS.flatMap((c) => {
      const m = live[c]?.measures;
      const j = judged[c];
      if (m == null || j === undefined) return [];
      const f = (value: number) => value.toFixed(1);
      const delta = j.delta === null ? 'not judged (the clock voids it)' : `[${f(j.delta.p50IntervalMs[0])}, ${f(j.delta.p50IntervalMs[1])}] ms, ${j.delta.verdict}`;
      return [`[remote-latency-live] ${c}: delta-to-frame p50 ${delta} (bound ${f(j.bounds.deltaToFrameP50Ms)} ms, n=${m.rawDelta.n}) · round trip p50 ${f(m.roundTrip.p50)} ms · open to first row ${f(m.openToFirstRowMs)} ms · rtt p50 ${f(m.rtt.p50)} ms (n=${m.rtt.n}) · clock spread ${m.clock === null ? '?' : f(m.clock.spreadMs)} ms`];
    }),
  ];
  const info = test.info();
  mkdirSync(info.project.outputDir, { recursive: true });
  writeFileSync(join(info.project.outputDir, 'remote-latency-live.json'), `${JSON.stringify({
    lines, machine: machine.name, transport: machine.transport.kind, commit: machine.commit, valid: all.length === 0,
    local: localMeasures,
    direct: live.direct === undefined ? null : { measures: live.direct.measures, judgement: judged.direct ?? null },
    relay: live.relay === undefined ? null : { measures: live.relay.measures, judgement: judged.relay ?? null },
    invalidReasons: all, budgetMisses: misses, inconclusive,
    load: { samples: loads, terminal: terminalLoad ?? null, peak: load.peak, pair: load.pair },
    machineEngineStartMs: stream.ready?.engineStartMs ?? null,
    roundTripsMs: { local: local?.roundTripsMs ?? [], direct: live.direct?.roundTripsMs ?? [], relay: live.relay?.roundTripsMs ?? [] },
    exchanges: { direct: live.direct?.exchanges ?? null, relay: live.relay?.exchanges ?? null },
  }, null, 2)}\n`);
  for (const line of [...lines, ...inconclusive.map((l) => `[remote-latency-live] inconclusive: ${l}`)]) {
    console.log(line);
    info.annotations.push({ type: 'remote-latency-live', description: line });
  }
  say(`[bench] ${machine.name}: done; the scratch profile is kept until the bench is done (MAWS_REMOTE_BENCH_REMOVE=1), the app's device and the machine revoked by the owner (${member === undefined ? 'no member read' : 'admin machine drop <name> --revoke'})`);
  expect(all, 'the run is valid').toEqual([]);
  expect(misses, 'every carrier within acceptance 3’s bounds of the same run’s local numbers, or inconclusive').toEqual([]);
});

test('remote latency, live: the bench machine’s scratch profile removed once the bench is done, refused while a bench process lives', async () => {
  test.skip(!REMOVE, 'runs under MAWS_REMOTE_BENCH_REMOVE=1, once the bench is done');
  const { machine } = benchMachine();
  const bench = new BenchRun(machine, { runner: processRunner(), engineVersion: FIXTURE_ENGINE_VERSION, say });
  expect(await bench.removeProfile(), 'no bench process is left on the machine').toBe(true);
});
