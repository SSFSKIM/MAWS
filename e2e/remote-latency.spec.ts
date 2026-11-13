// The remote bench (P5 O7 M7, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M7's "The measured group" and
// Interfaces §S; acceptance 3): the local bench's measures (e2e/local-latency.spec.ts) taken through the remote pane, on
// each carrier, against the same run's local numbers. One machine, one clock: the stub engine on profile B and A's
// renderer both read this Mac's `performance.timeOrigin + performance.now()`, the renderer's checked against the runner's
// per launch as the local bench checks it.
//
//   1. local: A's scratch profile alone, the latency stub (test/support/latency-engine-stub.mjs) as its local engine.
//   2. the scene (e2e/support/remote-scene.ts): profile B a private `mawsd` enrolled in a local org with the stub as its
//      engine, its lane B session started over its machine.sock (one turn, its history) and listed through the harness's
//      fake sminos; then A launched twice over one profile, as e2e:remote is: directly (B's address mapped to a pipe in
//      front of its listener) and through the hub (mapped to a closed port).
//
// Each case: the session's row clicked and the time from the press to the first marker of its history in the pane (open
// to first row); then 3 turns of 300 deltas, the first discarded (delta to frame); 220 `session.getContextUsage` invokes,
// the first 20 discarded (round trip). Each carrier also: the link's own round trip, 100 pings through main's bench seam
// (src/main/machines/remote/bench-seam.ts); and a forced drop: A's ways to B (the hub pipe, the direct pipe) cut, B's
// session writing a turn while A can't see it, then the case's own way restored with the network probe a returning network
// brings (the other way only once the turn arrived), and the time from the restore to the first event after the gap in
// A's renderer (resume). Engine start is `session.start` to the process's `ready` on the machine that runs it.
//
// Everything goes to test-results/remote-latency.json (§S); the run is valid by each case's samples, markers and clock
// and by Rule B on the load sampled every 30 s (test/support/remote-latency.ts), and each carrier is held to acceptance
// 3's bounds against the local numbers. A measured group (gate.yml's MEASURED_E2E): `pnpm e2e:remote-latency` sets
// MAWS_REMOTE_LATENCY_PERF=1; it spends nothing (no network beyond 127.0.0.1) and touches no keychain.
//
// The second test is P5 O15 M2b's wake case (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, §I; O15's
// acceptance 6), on a scene of its own: B runs two sessions on the stub, A opens both side by side, and per carrier both
// of A's ways go silent (the pipes stalled: their connections dead, a new connect refused), each session writes 21 turns
// A can't see, so its cursor falls out of B's ring, a wake of an hour is injected through main's seam, and after 1 to 3
// s A's way back is restored, on the relay's launch with the direct pipe answering TCP and hanging above it. Main's own
// log (`<profile>/logs/main.log`), B's `mawsd.log` and `host.log` and the pipes' records say what came back and when;
// test-results/remote-wake.json holds it, one line per carrier is printed, and the measured group holds every
// subscription to 1 s from the restore and the feed to 2 s from the hub's (test/support/remote-wake.ts). Per carrier
// the inject waits until B is past its resume window, the state an hour asleep leaves it in (Decision Log 37): B's
// channel closed by its own silence check, its interest's window over and a margin, counted from the stall. Then the
// quiet admission (e2e/support/quiet.ts) settles the machine, the pipes still stalled, and the 1-minute load read at
// the instants that bracket the timed windows voids the run at 5 or more; Rule B is the first test's rule and, for this
// case, context only (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, Decision Log 33). In both modes a
// session's whole launch read on B between the restore and that session's `subbed` fails the case (Decision Log 39): A's
// tabs hold their panes' sessions through the stall, so the replay alone brings what the panes missed.
//
// The third test is UX wave U9's A5 (docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, M5; #565), on the
// wake case's scene and its stall and restore, on the direct carrier: A's left pane holds B's live session and its right
// pane B's second session, cold (its engine stopped on B after its first turn), so only the live one has a stream to
// resume. A asks B for no session's history (main's `lane B: timing history … asked`, said at each read's start whatever
// B answers it from) between the restore and its `subbed` of the live session's stream, and B logs no whole-launch read
// (`session.events <app> after start: from the journal`) before its own: the cold pane decides at main's settled word,
// which follows that answer (test/support/remote-wake.ts, historyReadsBeside). No bound is timed, so no load is read.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { addressOf } from '../src/shared/machine/address';
import type { MachineRef } from '../src/shared/machine/ref';
import { BENCH, summarize, type ClockCheck } from '../test/support/local-latency';
import { FIXTURE_ENGINE_VERSION } from '../test/support/engine-pin';
import { LATENCY_STUB, markerOf, writeLatencyEngine } from '../test/support/latency-engine';
import { parseLogText, positionOf, readLogLines } from '../test/support/main-log';
import { boundsOf, budgetMisses, CARRIERS, invalidReasons, loadVerdict, remoteLine, rttStats, type Bounds, type Carrier, type Exchange, type RemoteMeasures } from '../test/support/remote-latency';
import { besideOutcome, boundMissMessage, historyReadsBeside, historySeen, INJECT_AFTER_STALL_MS, lastPageIn, linkPending, ruleBContext, RESUME_PAGE_EVENTS, markersNotOnce, placeOfEvent, readWake, sixMissing, sixSubscriptions, subscriptionsIn, unavailableSummary, VOID_LOAD, WAKE_CASE, wakeSummary, wakeTimingSummary, wakeVerdict, type LoadInstant, type LoadRead, type WakeRecord } from '../test/support/remote-wake';
import { launchMaws, type MawsLaunch } from './support/launch';
import { QUIET_BUDGET_MS, quietWait, type QuietAdmission } from './support/quiet';
import { cleanupAll, lastTurn, linkOf, localCase, main, measureTurns, now, openToFirstRow, pings, probe, prompt, raw, roundTrips, statsOf, trust, TURN_MS, writtenOf, type CaseResult } from './support/remote-latency-page';
import { startRemoteScene, type RemoteScene } from './support/remote-scene';
import { mainTabById } from './support/shell';
import { showProjectList, sidebarOf } from './support/sidebar';

// `pnpm e2e:remote-latency-check` (MAWS_REMOTE_LATENCY_CHECK=1) runs the same scene as a functional check, anywhere an e2e
// group runs (GitHub's hosted Macs): every case measured and every ping answered, its numbers recorded and never held to
// a bound, since only the measured group's machine is the one the bounds are read on.
const CHECK = process.env.MAWS_REMOTE_LATENCY_CHECK === '1';
test.skip(process.env.MAWS_REMOTE_LATENCY_PERF !== '1' && !CHECK, 'the remote bench runs under pnpm e2e:remote-latency (MAWS_REMOTE_LATENCY_PERF=1)');
test.describe.configure({ timeout: 20 * 60_000 });

const PROJECT = 'e2e-remote-latency'; // sminos's project id for B's checkout

// A's renderer's event batches of one session, each with its arrival by the renderer's clock, kept from now on.
async function keepArrivals(page: Page, machine: MachineRef, app: string): Promise<void> {
  await page.evaluate(([on, id]) => {
    const kept: number[] = [];
    (window as unknown as { __arrivals: number[] }).__arrivals = kept;
    window.maws.on('session.eventBatch', (batch, from) => {
      if (from === on && (batch as { appSessionId?: string }).appSessionId === id) kept.push(performance.timeOrigin + performance.now());
    });
  }, [machine, app] as const);
}
const arrivals = (page: Page) => page.evaluate(() => (window as unknown as { __arrivals: number[] }).__arrivals);

// `session.start` to the process's `ready`, polled every 10 ms on the machine that runs it (B's, for the record only: no
// bound reads it).
async function startTimed(start: () => Promise<unknown>, ready: () => Promise<boolean>): Promise<number> {
  const at = now();
  await start();
  for (;;) {
    if (await ready()) return now() - at;
    if (now() - at > TURN_MS) throw new Error('the session did not come ready within 60 s');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('remote latency: delta to frame, round trip, open, resume and the link’s round trip of a lane B session on another machine, per carrier, against the same run’s local numbers (acceptance 3)', async () => {
  // Rule B's samples every 30 s from the start; the reading at the end, a shorter interval, is kept apart from them
  const loads = [loadavg()[0]];
  const sampler = setInterval(() => loads.push(loadavg()[0]), 30_000);
  let terminalLoad: number | undefined;
  const carrierReasons: string[] = [];
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-rl-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-rla-'));
  const checkout = join(root, 'b-checkout');
  mkdirSync(checkout);
  const bSamples = join(root, 'b-samples.jsonl');
  const bBin = writeLatencyEngine(join(root, 'b-engine'), bSamples);
  let scene: RemoteScene | null = null;
  let a: MawsLaunch | null = null;
  const cases: Record<'local' | Carrier, CaseResult | null> = { local: null, direct: null, relay: null };
  const remote: Partial<Record<Carrier, RemoteMeasures>> = {};
  const exchanges: Record<Carrier, Exchange[]> = { direct: [], relay: [] };
  let bEngineStartMs: number | undefined;
  try {
    const local = await localCase(root);
    cases.local = local;

    // 2. The scene, B's engine the stub; B's session started and its first turn over, then listed.
    scene = await startRemoteScene({ scratch: join(root, 'scene'), aUserData, directPipe: true, b: { env: { MAWS_E2E_ENGINE_BIN: bBin }, prepare: trust(checkout) } });
    const { b } = scene;
    await b.request('machineSettings.set', { patch: { gateway: { defaultRoute: 'direct' } } });
    const project = await b.request<{ id: string }>('session.projects.add', { directory: checkout });
    const app = (await b.request<{ appSessionId: string }>('session.create', { projectId: project.id, location: null })).appSessionId;
    await b.request('session.intent.patch', { appSessionId: app, patch: { gateway: 'direct' } });
    type Status = { process: string; turn: unknown; engineSessionId: string | null };
    const bStatus = () => b.request<Status>('session.status', { appSessionId: app }).catch(() => null);
    bEngineStartMs = await startTimed(
      async () => expect((await b.request<{ status: string }>('session.start', { appSessionId: app, message: { content: prompt(1), display: prompt(1) }, options: {} })).status).not.toBe('needs_trust'),
      async () => (await bStatus())?.process === 'ready',
    );
    await expect.poll(() => writtenOf(bSamples).length, { timeout: TURN_MS, message: `B's first turn written\n${b.log().slice(-3000)}` }).toBe(BENCH.markersPerTurn);
    let engine: string | null = null;
    await expect.poll(async () => {
      const s = await bStatus();
      engine = s?.engineSessionId ?? null;
      return s?.process === 'ready' && s.turn === null;
    }, { timeout: TURN_MS, message: "B's first turn over" }).toBe(true);
    await scene.sminos.list({ engine: engine!, app, owners: [scene.member], project: PROJECT, title: 'B’s bench session', cwd: checkout });
    const address = addressOf(b.ref, app);
    const bClosed = async () => {
      const s = await bStatus();
      return s?.process === 'ready' && s.turn === null;
    };

    for (const carrier of CARRIERS) {
      // each launch opens B's row from a fresh layout: a restored tab would show the history before the click
      rmSync(join(aUserData, 'layout.json'), { force: true });
      a = await launchMaws({ userData: aUserData, env: { MAWS_DEV_ORG: scene.devOrgDir(carrier === 'direct'), MAWS_MACHINE_NAME: 'A' } });
      const page = a.page;
      await expect.poll(async () => {
        const m = await linkOf(page, b.ref);
        return m === undefined ? null : `${m.state}/${m.carrier ?? ''}`;
      }, { timeout: 60_000, message: `A's link to B comes up over ${carrier}` }).toBe(`up/${carrier}`);
      await expect.poll(async () => (await raw<{ rows: { machine: string; session: string }[] }>(page, 'org.rows', undefined)).rows.some((r) => r.machine === b.ref && r.session === app), { timeout: 60_000, message: "B's session is a row of A's" }).toBe(true);
      await showProjectList(page);
      const machineRow = sidebarOf(page).locator(`[data-kind="project"][data-tree-id="p:machine:${b.ref}"]`);
      await expect(async () => {
        if ((await machineRow.getAttribute('aria-expanded')) !== 'true') await machineRow.locator('[data-project-line]').click();
        await expect(machineRow).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
      }).toPass({ timeout: 30_000 });
      const row = sidebarOf(page).locator(`[role="treeitem"][data-tree-id="s:${address}"]`);
      await expect(row).toBeVisible({ timeout: 30_000 });
      const openToFirstRowMs = await openToFirstRow(page, row);
      const composer = main(page).getByRole('textbox', { name: 'Message' });
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await page.mouse.move(700, 20);
      const { run, delays } = await measureTurns(page, () => writtenOf(bSamples), {
        send: async (turn) => {
          await composer.click();
          await page.keyboard.type(prompt(turn));
          await page.keyboard.press('Enter');
          await page.mouse.move(700, 20);
        },
        closed: bClosed,
      });
      const trips = await roundTrips(page, app, b.ref);
      exchanges[carrier] = await pings(a.app, b.ref);
      const after = await linkOf(page, b.ref);
      if (after?.state !== 'up' || after.carrier !== carrier) carrierReasons.push(`${carrier}: the link was ${after?.state ?? 'gone'}/${after?.carrier ?? 'none'} after the case's measures, not up/${carrier}`);

      // The forced drop: both of A's ways to B cut, B's session writes a turn A can't see; then only the case's own way
      // restored, with the probe a returning network brings, so the recovery can come back over that carrier alone.
      await keepArrivals(page, b.ref, app);
      scene.aHub.cut();
      scene.aDirect!.cut();
      await expect.poll(async () => (await linkOf(page, b.ref))?.state, { timeout: 30_000, message: 'A’s link to B down once its ways are cut' }).toBe('down');
      const gapTurn = lastTurn(writtenOf(bSamples)) + 1;
      await b.request('session.send', { appSessionId: app, content: prompt(gapTurn) });
      await expect.poll(() => writtenOf(bSamples).filter((w) => w.turn === gapTurn).length, { timeout: TURN_MS }).toBe(BENCH.markersPerTurn);
      await expect.poll(bClosed, { timeout: TURN_MS }).toBe(true);
      const before = (await arrivals(page)).length;
      (carrier === 'direct' ? scene.aDirect! : scene.aHub).restore();
      const restoredAt = now();
      await probe(a.app, b.ref);
      let first: number | null = null;
      await expect.poll(async () => (first = (await arrivals(page)).slice(before)[0] ?? null), { timeout: 60_000, message: 'the first event after the gap in A' }).not.toBeNull();
      const recovered = await linkOf(page, b.ref);
      // the event came over the case's carrier, or its resume is no number of that carrier's
      const resumeMs = recovered?.carrier === carrier ? first! - restoredAt : null;
      if (resumeMs === null) carrierReasons.push(`${carrier}: the first event after the gap came with the link ${recovered?.state ?? 'gone'}/${recovered?.carrier ?? 'none'}, so its resume is not ${carrier}'s`);
      await expect.poll(async () => (await main(page).evaluate((region) => region.textContent ?? '')).includes(markerOf(gapTurn, BENCH.markersPerTurn).trim()), { timeout: 30_000, message: 'the gap’s turn in A’s pane' }).toBe(true);
      (carrier === 'direct' ? scene.aHub : scene.aDirect!).restore();

      const deltaToFrame = statsOf(delays);
      cases[carrier] = { measures: null, run, roundTripsMs: trips };
      if (deltaToFrame !== null && exchanges[carrier].length > 0) {
        const measures: RemoteMeasures = { deltaToFrame, roundTrip: summarize(trips, BENCH.roundTripWarmup), openToFirstRowMs, resumeMs, engineStartMs: bEngineStartMs, rtt: rttStats(exchanges[carrier]) };
        remote[carrier] = measures;
        cases[carrier]!.measures = measures;
      }
      await a.cleanup();
      a = null;
    }
  } finally {
    clearInterval(sampler);
    terminalLoad = loadavg()[0];
    await cleanupAll([() => a?.cleanup(), () => scene?.stop(), () => rmSync(aUserData, { recursive: true, force: true }), () => rmSync(root, { recursive: true, force: true })]);
  }

  const reasons = invalidReasons({ cases: { local: cases.local?.run ?? null, direct: cases.direct?.run ?? null, relay: cases.relay?.run ?? null }, pings: { direct: exchanges.direct.length, relay: exchanges.relay.length }, loads, terminalLoad: terminalLoad ?? null, notes: carrierReasons });
  const localMeasures = cases.local?.measures ?? null;
  const bounds: Partial<Record<Carrier, Bounds>> = {};
  const misses: string[] = [];
  for (const carrier of CARRIERS) {
    const measured = remote[carrier];
    if (localMeasures === null || measured === undefined) continue;
    bounds[carrier] = boundsOf(localMeasures, measured.rtt);
    misses.push(...budgetMisses(carrier, measured, bounds[carrier]!));
  }
  const load = loadVerdict(loads, terminalLoad ?? null);
  const lines = [...(localMeasures === null ? [] : [remoteLine('local', localMeasures)]), ...CARRIERS.flatMap((c) => (remote[c] === undefined ? [] : [remoteLine(c, remote[c]!)]))];
  const info = test.info();
  mkdirSync(info.project.outputDir, { recursive: true });
  const clockOf = (c: CaseResult | null): ClockCheck | null => c?.run?.clock ?? null;
  writeFileSync(join(info.project.outputDir, 'remote-latency.json'), `${JSON.stringify({
    lines, valid: reasons.length === 0, sha: process.env.GITHUB_SHA ?? null, runId: process.env.GITHUB_RUN_ID ?? null,
    local: localMeasures, direct: remote.direct ?? null, relay: remote.relay ?? null, bounds, invalidReasons: reasons, budgetMisses: misses,
    load: { samples: loads, terminal: terminalLoad ?? null, peak: load.peak, pair: load.pair },
    bEngineStartMs: bEngineStartMs ?? null,
    clocks: { local: clockOf(cases.local), direct: clockOf(cases.direct), relay: clockOf(cases.relay) },
    roundTripsMs: { local: cases.local?.roundTripsMs ?? [], direct: cases.direct?.roundTripsMs ?? [], relay: cases.relay?.roundTripsMs ?? [] },
    pings: exchanges,
  }, null, 2)}\n`);
  for (const line of lines) {
    console.log(line);
    info.annotations.push({ type: 'remote-latency', description: line });
  }
  if (CHECK) {
    // the functional check: every case went through and every ping was answered; the rest is the measured group's
    expect(reasons.filter((r) => / not measured$| pings answered$/.test(r)), 'every case measured and every ping answered').toEqual([]);
    for (const line of [...reasons, ...misses]) console.log(`[remote-latency] (check, not held) ${line}`);
    return;
  }
  expect(reasons, 'the run is valid').toEqual([]);
  expect(misses, 'every carrier within acceptance 3’s bounds of the same run’s local numbers').toEqual([]);
});

// ---- The wake case (P5 O15 M2b §I) ----

const MAIN_LOG = (userData: string) => join(userData, 'logs', 'main.log');

// The latency stub as B's engine for the wake case's two sessions, one samples file per engine session
// (`<dir>/<its --session-id or --resume>.jsonl`), so each session numbers its own turns (the stub numbers on from its
// samples file's last) and its markers are its own.
function writeSessionLatencyEngine(path: string, dir: string): string {
  const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
  const script = [
    '#!/bin/sh',
    'sid=none',
    'prev=',
    'for arg in "$@"; do',
    '  case "$prev" in --session-id|--resume) sid=$arg ;; esac',
    '  prev=$arg',
    'done',
    `MAWS_LATENCY_STUB_VERSION=${quote(FIXTURE_ENGINE_VERSION)} exec ${quote(process.execPath)} ${quote(LATENCY_STUB)} ${quote(dir)}/"$sid.jsonl" "$@"`,
    '',
  ];
  writeFileSync(path, script.join('\n'), { mode: 0o755 });
  return path;
}

type BSession = { app: string; engine: string; address: string; samples: string };
type Daemon = RemoteScene['b'];
type BStatus = { process: string; turn: unknown; engineSessionId: string | null };
const bStatusOf = (b: Daemon, app: string) => b.request<BStatus>('session.status', { appSessionId: app }).catch(() => null);
const bTurnOver = async (b: Daemon, app: string) => {
  const s = await bStatusOf(b, app);
  return s?.process === 'ready' && s.turn === null;
};

// One of B's sessions, its first turn over and its 300 deltas written, then listed through sminos.
async function startBSession(scene: RemoteScene, projectId: string, checkout: string, samplesDir: string, title: string): Promise<BSession> {
  const { b } = scene;
  const app = (await b.request<{ appSessionId: string }>('session.create', { projectId, location: null })).appSessionId;
  await b.request('session.intent.patch', { appSessionId: app, patch: { gateway: 'direct' } });
  const started = await b.request<{ status: string }>('session.start', { appSessionId: app, message: { content: prompt(1), display: prompt(1) }, options: {} });
  expect(started.status, `B's session ${title} starts without the trust question`).not.toBe('needs_trust');
  const engineOf = async () => (await bStatusOf(b, app))?.engineSessionId ?? null;
  await expect.poll(engineOf, { timeout: TURN_MS, message: `B's session ${title} names its engine session` }).not.toBeNull();
  const engine = (await engineOf())!;
  const samples = join(samplesDir, `${engine}.jsonl`);
  await expect.poll(() => writtenOf(samples).length, { timeout: TURN_MS, message: `B's session ${title}: its first turn's deltas in ${samples}\n${b.log().slice(-3000)}` }).toBe(BENCH.markersPerTurn);
  await expect.poll(() => bTurnOver(b, app), { timeout: TURN_MS, message: `B's session ${title}: its first turn over` }).toBe(true);
  await scene.sminos.list({ engine, app, owners: [scene.member], project: PROJECT, title, cwd: checkout });
  return { app, engine, address: addressOf(b.ref, app), samples };
}

// `count` turns of one of B's sessions, one after another, each written whole and over before the next.
async function writeTurns(b: Daemon, s: BSession, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const turn = lastTurn(writtenOf(s.samples)) + 1;
    await b.request('session.send', { appSessionId: s.app, content: prompt(turn) });
    await expect.poll(() => writtenOf(s.samples).filter((w) => w.turn === turn).length, { timeout: TURN_MS, intervals: [100], message: `B's session ${s.app}: turn ${turn}'s deltas written` }).toBe(BENCH.markersPerTurn);
    await expect.poll(() => bTurnOver(b, s.app), { timeout: TURN_MS, intervals: [100], message: `B's session ${s.app}: turn ${turn} over` }).toBe(true);
  }
}

const paneOf = (page: Page, index: number) => main(page).locator(`[data-pane="${index}"]`);
const paneText = (page: Page, index: number, timeout?: number) => paneOf(page, index).evaluate((el) => el.textContent ?? '', undefined, timeout === undefined ? {} : { timeout });
const turnMarkers = (turn: number) => Array.from({ length: BENCH.markersPerTurn }, (_, k) => markerOf(turn, k + 1).trim());

// B's first session in A's left pane and its second in the right, as a person puts two of another machine's sessions side
// by side. Before its tab opens, a session of B's is a listed row (sidebar/ListedRow.tsx), whose click calls lane B's
// opener (lane-b/remote-connect.ts): `openSession` with no options, so a ⌘-click on it replaces the focused pane's
// session like a plain one. So the first is opened and its tab pinned (shell.spec.ts's way: the tab's menu, Pin tab), the
// second clicked opens after the pinned tab (`replaceActive` leaves a pinned tab alone), and the split moves the active
// tab, the second, to a pane of its own (requests.spec.ts's way: the menu's pane.split).
async function openSideBySide(launch: MawsLaunch, ref: MachineRef, sessions: readonly BSession[]): Promise<void> {
  const { page } = launch;
  await showProjectList(page);
  const machineRow = sidebarOf(page).locator(`[data-kind="project"][data-tree-id="p:machine:${ref}"]`);
  await expect(async () => {
    if ((await machineRow.getAttribute('aria-expanded')) !== 'true') await machineRow.locator('[data-project-line]').click();
    await expect(machineRow).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  const rowOf = (s: BSession) => sidebarOf(page).locator(`[role="treeitem"][data-tree-id="s:${s.address}"]`);
  const tabOf = (s: BSession) => mainTabById(page, `session:${s.address}`);
  const composerIn = (pane: number, s: BSession) => paneOf(page, pane).locator(`[data-composer="${s.address}"]`);
  // the strips' tabs, for a failure: whether a tab was replaced, or never opened
  const strips = async () => (await page.locator('[role="tablist"]').evaluateAll((lists) => lists.map((l) => `${l.getAttribute('aria-label')}: ${Array.from(l.querySelectorAll('[role="tab"]'), (t) => t.getAttribute('data-tab-id')).join(', ') || 'none'}`))).join('; ');
  const left = sessions[0]!;
  const right = sessions[1]!;
  for (const s of sessions) await expect(rowOf(s), `B's session ${s.app} is a row of A's sidebar`).toBeVisible({ timeout: 30_000 });
  await rowOf(left).click();
  await expect(composerIn(0, left), `B's session ${left.app} open in A's pane`).toBeVisible({ timeout: 30_000 });
  await tabOf(left).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin tab' }).click();
  await expect(tabOf(left).getByRole('img', { name: 'Pinned' }), `B's session ${left.app}'s tab pinned`).toBeVisible({ timeout: 30_000 });
  await rowOf(right).click();
  await expect(composerIn(0, right), `B's session ${right.app} open in A's pane`).toBeVisible({ timeout: 30_000 });
  await expect(tabOf(left), `B's session ${left.app}'s pinned tab stays beside ${right.app}'s (the strips: ${await strips()})`).toBeVisible();
  await launch.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('pane.split')?.click());
  await expect(composerIn(1, right), `B's session ${right.app} in A's right pane after the split`).toBeVisible({ timeout: 30_000 });
  await expect(composerIn(0, left), `B's session ${left.app} still in A's left pane`).toBeVisible({ timeout: 30_000 });
}

// The rows B's journal holds for a resume's first page from `after` (the cursor's row less one): from the cursor's row
// through the row the page reads ahead and carries to the next, the first event-bearing row past the page's last event
// (the journal is read seq after seq, so rows between are counted too). Read with the resume's own page, as B's endpoint
// asks it (RESUME_PAGE_EVENTS events, no byte bound: the longest page), then the next event after it. Null when the page
// reached the journal's end, where the rows after its last event are not known.
type EventsPage = { events: { seq?: number | null }[]; lastSeq: number; complete: boolean };
async function bPageRows(b: Daemon, s: BSession, after: number): Promise<number | null> {
  const page = await b.request<EventsPage>('session.events', { appSessionId: s.app, afterSeq: after, limit: RESUME_PAGE_EVENTS });
  if (page.complete) return null;
  const next = await b.request<EventsPage>('session.events', { appSessionId: s.app, afterSeq: page.lastSeq, limit: 1 });
  const ahead = next.events.find((e) => typeof e.seq === 'number')?.seq;
  return typeof ahead === 'number' ? ahead - after : null;
}

// The last event of B's session, read on B once its turn is over: with nothing writing, it is the last event the launch's
// stream can deliver, so a stream delivered to its end holds its place as its cursor. Read from the status's last row
// back a little (a row may yield no event), paged to the end.
const HEAD_ROWS = 50;
async function bHead(b: Daemon, s: BSession): Promise<{ id: string; place: string }> {
  const status = await b.request<{ launchId: string; lastEventSeq: number }>('session.status', { appSessionId: s.app });
  let afterSeq = Math.max(0, status.lastEventSeq - HEAD_ROWS);
  let last: string | null = null;
  for (let pages = 0; pages < 20; pages += 1) {
    const read = await b.request<{ events: { id: string }[]; lastSeq: number; complete: boolean }>('session.events', { appSessionId: s.app, afterSeq, limit: null });
    last = read.events.map((e) => e.id).filter((id) => placeOfEvent(s.app, id) !== null).at(-1) ?? last;
    if (read.complete || read.lastSeq <= afterSeq) break;
    afterSeq = read.lastSeq;
  }
  const place = last === null ? null : placeOfEvent(s.app, last);
  if (last === null || place === null || !place.startsWith(`${status.launchId}:`)) throw new Error(`B's session ${s.app}: no last event of launch ${status.launchId} after row ${Math.max(0, status.lastEventSeq - HEAD_ROWS)} (last read: ${last ?? 'none'})`);
  return { id: last, place };
}

// A's renderer's last event of a launch of each of B's sessions (an id `<app>:<launch>:<seq>:<i>`, the only events a
// stream's cursor moves on), by its bare app id, kept from now on.
async function keepLastEvents(page: Page, machine: MachineRef): Promise<void> {
  await page.evaluate((on) => {
    const last: Record<string, string> = {};
    (window as unknown as { __lastEvent: Record<string, string> }).__lastEvent = last;
    window.maws.on('session.eventBatch', (batch, from) => {
      const { appSessionId, events } = batch as { appSessionId?: string; events?: { id?: unknown }[] };
      if (from !== on || typeof appSessionId !== 'string') return;
      for (const { id } of events ?? []) if (typeof id === 'string' && id.startsWith(`${appSessionId}:`) && /:\d+:\d+$/.test(id)) last[appSessionId] = id;
    });
  }, machine);
}
const lastEventOf = (page: Page, app: string) => page.evaluate((id) => (window as unknown as { __lastEvent?: Record<string, string> }).__lastEvent?.[id] ?? null, app);

type Bounded<T> = { done: boolean; last: T | null; error: string | null };
/**
 * Reads until `done` holds or `timeoutMs` has passed. Each read is itself cut at the time left (and given it, as `leftMs`,
 * for a read that takes a timeout of its own), and one that fails or is cut counts as not done, so whatever is missing
 * is a recorded miss, never the test's whole timeout. `last` is the last read that answered.
 */
async function within<T>(read: (leftMs: number) => T | Promise<T>, done: (value: T) => boolean, timeoutMs: number): Promise<Bounded<T>> {
  const end = Date.now() + timeoutMs;
  let last: T | null = null;
  let error: string | null = null;
  for (;;) {
    const left = end - Date.now();
    if (left <= 0) return { done: false, last, error };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await new Promise<T>((answer, fail) => {
        timer = setTimeout(() => fail(new Error(`no answer within ${left} ms`)), left);
        Promise.resolve()
          .then(() => read(left))
          .then(answer, fail);
      });
      last = value;
      error = null;
      if (done(value)) return { done: true, last, error };
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(0, end - Date.now()))));
  }
}

const READ_WITHIN_MS = 30_000; // each wait for what the logs and the panes should show after the restore

// The wake case's timeout, from its waits (Decision Log 37). Per carrier: the launch to the six answered and both panes
// shown, about 2 min; from the stall to the inject's earliest, INJECT_AFTER_STALL_MS (158 s; B's writes, 45 to 65 s, run
// inside it); the settle, at most QUIET_BUDGET_MS (180 s); the drawn wait, at most 3 s; the reads after the restore,
// five bounded waits of READ_WITHIN_MS (the link, the feed's last page, the two panes, the final reading: 150 s); the
// cleanup, about 10 s: 621 s in all. Two carriers, 1,242 s; the scene and B's two sessions before them, about 2 min;
// a margin of 5 min: 1,662 s, under 28 minutes, inside the group's 60 beside the first test's 20.
const WAKE_LAUNCH_MS = 2 * 60_000;
const WAKE_CLEANUP_MS = 10_000;
const WAKE_PER_CARRIER_MS = WAKE_LAUNCH_MS + INJECT_AFTER_STALL_MS + QUIET_BUDGET_MS + WAKE_CASE.restoreAfterMs.max + 5 * READ_WITHIN_MS + WAKE_CLEANUP_MS;
const WAKE_TIMEOUT_MS = 2 * 60_000 + CARRIERS.length * WAKE_PER_CARRIER_MS + 5 * 60_000;

test('a wake after a silent cut: every subscription answered within 1 s of the restore, one upgrade, nothing lost or repeated, per carrier', async () => {
  test.setTimeout(WAKE_TIMEOUT_MS);
  // Rule B's samples every 30 s from the start, printed as context: this case voids on its window reads alone
  const loads = [loadavg()[0]];
  const sampler = setInterval(() => loads.push(loadavg()[0]), 30_000);
  let terminalLoad: number | undefined;
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-rw-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-rwa-'));
  const checkout = join(root, 'b-checkout');
  mkdirSync(checkout);
  const samplesDir = join(root, 'b-samples');
  mkdirSync(samplesDir);
  const bBin = writeSessionLatencyEngine(join(root, 'b-engine'), samplesDir);
  let scene: RemoteScene | null = null;
  let a: MawsLaunch | null = null;
  type CarrierRecord = WakeRecord & { linkBeforeWake: string; resumeWaitMs: number; settle: QuietAdmission; settleMs: number; loads: LoadRead[]; turns: { app: string; lastSeen: number; lastWritten: number }[] };
  const records: Partial<Record<Carrier, CarrierRecord>> = {};
  // each carrier's 1-minute load at the instants that bracket its timed windows (Decision Log 33 (c)), kept for a launch
  // whose evidence was unavailable too
  const windowLoads: Partial<Record<Carrier, LoadRead[]>> = {};
  const unavailable: Partial<Record<Carrier, string>> = {}; // a launch whose every final read of its evidence failed, and why
  const failures: string[] = [];
  try {
    scene = await startRemoteScene({ scratch: join(root, 'scene'), aUserData, directPipe: true, b: { env: { MAWS_E2E_ENGINE_BIN: bBin }, prepare: trust(checkout) } });
    const { b } = scene;
    const direct = scene.aDirect!;
    await b.request('machineSettings.set', { patch: { gateway: { defaultRoute: 'direct' } } });
    const project = await b.request<{ id: string }>('session.projects.add', { directory: checkout });
    const sessions: BSession[] = [];
    for (const title of ['B’s first wake session', 'B’s second wake session']) sessions.push(await startBSession(scene, project.id, checkout, samplesDir, title));
    const expected = sixSubscriptions(sessions.map((s) => s.app));
    const mainLog = () => readLogLines(MAIN_LOG(aUserData));
    const hostLog = join(b.userData, 'supervisor', 'host.log');

    for (const carrier of CARRIERS) {
      // both launches map B's address to the direct pipe: open for the direct launch, on hold for the relay's, so its
      // own direct race times out and the link comes up over the relay
      scene.aHub.restore();
      if (carrier === 'direct') direct.restore();
      else direct.hold();
      rmSync(join(aUserData, 'layout.json'), { force: true });
      a = await launchMaws({ userData: aUserData, env: { MAWS_DEV_ORG: scene.devOrgDir(true), MAWS_MACHINE_NAME: 'A' } });
      const { page, launchedAt } = a;
      await keepLastEvents(page, b.ref); // before any tab of B's: no stream of B's runs yet

      // 1. Up over the carrier, both sessions open side by side and their histories shown to their last turns, and the
      //    six subscriptions answered since the launch
      await expect.poll(async () => {
        const m = await linkOf(page, b.ref);
        return m === undefined ? null : `${m.state}/${m.carrier ?? ''}`;
      }, { timeout: 60_000, message: `A's link to B comes up over ${carrier}` }).toBe(`up/${carrier}`);
      await expect.poll(async () => {
        const rows = (await raw<{ rows: { machine: string; session: string }[] }>(page, 'org.rows', undefined)).rows;
        return sessions.filter((s) => !rows.some((r) => r.machine === b.ref && r.session === s.app)).map((s) => s.app);
      }, { timeout: 60_000, message: "B's sessions are rows of A's (received: those that are not)" }).toEqual([]);
      await openSideBySide(a, b.ref, sessions);
      const seen = sessions.map((s) => lastTurn(writtenOf(s.samples)));
      for (const [i, s] of sessions.entries()) {
        const last = markerOf(seen[i]!, BENCH.markersPerTurn).trim();
        await expect.poll(async () => (await paneText(page, i)).includes(last), { timeout: 60_000, message: `A's pane ${i} shows B's session ${s.app} to its last turn (${last})` }).toBe(true);
      }
      await expect.poll(() => sixMissing(expected, subscriptionsIn(mainLog(), b.ref, launchedAt)), { timeout: READ_WITHIN_MS, message: `main.log's subbed lines since the launch give the link's six subscriptions (received: what they lack)` }).toEqual([]);
      const ids = [...subscriptionsIn(mainLog(), b.ref, launchedAt).values()].map((held) => held.id);
      // The cursor each stream holds at the stall, established from B's side: both sessions are idle, so B's last event
      // is the last the stream can deliver, and A's renderer showing that very event received is A's sink holding it
      // (the link's cursor is the last event it delivered to the sink, src/main/machines/remote/subs.ts)
      const held: Record<string, string> = {};
      for (const s of sessions) {
        const head = await bHead(b, s);
        await expect.poll(async () => placeOfEvent(s.app, (await lastEventOf(page, s.app)) ?? ''), { timeout: READ_WITHIN_MS, message: `A's renderer received B's session ${s.app}'s last event, ${head.id}, before the stall` }).toBe(head.place);
        held[s.app] = head.place;
      }

      // 2. Both ways silent; each session writes its turns unseen, past the ring's first trim
      const stalledAt = Date.now();
      scene.aHub.stall();
      direct.stall();
      await Promise.all(sessions.map((s) => writeTurns(b, s, WAKE_CASE.turns)));
      // each resume page's rows on B, read now: B is idle, and its journal lines fall before the restore, apart from the
      // resume's own (readWake reads those from the restore on)
      const pageRows: Record<string, number> = {};
      for (const s of sessions) {
        const at = positionOf(held[s.app]!);
        const rows = at === null ? null : await bPageRows(b, s, at.seq - 1);
        if (rows !== null) pageRows[s.app] = rows;
      }
      // B past its resume window at the inject, the state an hour asleep leaves it in (Decision Log 37): B's endpoint
      // closes the stalled channel by its own silence check (the pipe keeps both sockets open, so A's close never reaches
      // it) and writes no line there, so the close is counted from the stall, then its interest's window and a margin
      const resumeWaitStarted = Date.now();
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, stalledAt + INJECT_AFTER_STALL_MS - resumeWaitStarted)));
      const resumeWaitMs = Date.now() - resumeWaitStarted;
      // the pipes still stalled: the machine settled once (Decision Log 33 (b)), so the timed windows start at a settled
      // load whatever the scene's own setup cost; the link is down by now whatever the wait
      const settle = await quietWait();
      console.log(`[remote-wake] ${carrier}: the settle before the inject: ${settle.summary}`);
      const before = await linkOf(page, b.ref); // the link as the wake finds it
      const reads: LoadRead[] = [];
      windowLoads[carrier] = reads;
      const readLoad = (at: LoadInstant) => void reads.push({ at, load: +loadavg()[0]!.toFixed(2) });

      // 3. The hour asleep, through main's seam
      readLoad('inject');
      const injectedAt = Date.now();
      await a.app.evaluate((_electron, sleptMs) => {
        const seam = (globalThis as { __maws_wake?: { inject(ms: number): void } }).__maws_wake;
        if (seam === undefined) throw new Error('no wake seam in main (MAWS_E2E=1, unpackaged)');
        seam.inject(sleptMs);
      }, WAKE_CASE.sleptMs);

      // 4. After a drawn wait, the way back, at an instant the app is not told
      const { min, max } = WAKE_CASE.restoreAfterMs;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, injectedAt + min + Math.round(Math.random() * (max - min)) - Date.now())));
      const restoredAt = Date.now();
      if (carrier === 'direct') direct.restore();
      else {
        scene.aHub.restore();
        direct.hold();
      }

      // 5. and 6. What main's log, B's logs, the pipes and the panes show; the hub restored, on the direct launch, once
      //    the link's lines are in, still inside the window
      await within(() => linkPending(mainLog(), b.ref, carrier, ids, restoredAt), (pending) => pending.length === 0, READ_WITHIN_MS);
      readLoad('last subbed');
      let hubRestoredAt = restoredAt;
      if (carrier === 'direct') {
        readLoad("hub's restore");
        hubRestoredAt = Date.now();
        scene.aHub.restore();
      }
      await within(() => lastPageIn(mainLog(), hubRestoredAt), (inside) => inside, READ_WITHIN_MS);
      readLoad('last page');
      const panes: string[] = [];
      for (const [i, s] of sessions.entries()) {
        const turn = lastTurn(writtenOf(s.samples));
        const markers = turnMarkers(turn);
        const pane = await within((left) => paneText(page, i, left), (text) => markers.every((marker) => text.includes(marker)), READ_WITHIN_MS);
        const off = pane.last === null ? null : markersNotOnce(pane.last, markers);
        if (off === null) panes.push(`${carrier}: A's pane ${i} (B's session ${s.app}) could not be read within ${READ_WITHIN_MS} ms: ${pane.error ?? 'no answer'}`);
        else if (off.length > 0) panes.push(`${carrier}: A's pane ${i} shows ${off.length} of the ${markers.length} markers of B's session ${s.app}'s turn ${turn} other than once: ${off.slice(0, 5).map((m) => `${m.marker} ×${m.count}`).join(', ')}${off.length > 5 ? ', …' : ''}`);
      }
      // the last read is the launch's record: its counts run to here
      const inputOf = () => ({
        carrier, ref: b.ref, expected, held, pageRows, main: mainLog(), endpoint: parseLogText(b.log()), host: readLogLines(hostLog), launchedAt, stalledAt, injectedAt, restoredAt, hubRestoredAt,
        requests: { hub: scene!.aHub.requests(), direct: direct.requests() },
      });
      const final = await within(() => readWake(inputOf()), (wake) => wake.failures.length === 0, READ_WITHIN_MS);
      // the evidence the verdict takes is fixed here: a line that came after a bounded wait above gave up is still
      // inside a pair of reads
      readLoad('final');
      if (final.last === null) {
        unavailable[carrier] = final.error ?? 'no answer';
        failures.push(`${carrier}: main.log, B's logs or the pipes could not be read: ${unavailable[carrier]}`, ...panes);
        await a.cleanup();
        a = null;
        continue;
      }
      const { record, failures: read } = final.last;
      records[carrier] = { ...record, linkBeforeWake: before === undefined ? 'gone' : `${before.state}/${before.carrier ?? 'none'}`, resumeWaitMs, settle, settleMs: settle.waitedMs, loads: reads, turns: sessions.map((s, i) => ({ app: s.app, lastSeen: seen[i]!, lastWritten: lastTurn(writtenOf(s.samples)) })) };
      failures.push(...read, ...panes);
      await a.cleanup();
      a = null;
    }
  } finally {
    clearInterval(sampler);
    terminalLoad = loadavg()[0];
    await cleanupAll([() => a?.cleanup(), () => scene?.stop(), () => rmSync(aUserData, { recursive: true, force: true }), () => rmSync(root, { recursive: true, force: true })]);
  }

  // The void rule as built (Decision Log 33 (c)): each carrier's 1-minute load read at the inject, after the last subbed,
  // at the hub's restore where it comes later (the direct launch), after the feed's last page is in and after the final
  // reading, so no timed window and no line the verdict takes lies outside a pair of reads; a read of 5 or more voids the run, as the artifacts case voids a window. The
  // load at the case's start and end and Rule B's 30 s samples are printed as context and void nothing here.
  const verdict = wakeVerdict(CARRIERS.flatMap((c) => (records[c] === undefined ? [] : [records[c]!])), windowLoads, failures);
  const ruleB = ruleBContext(loads, terminalLoad ?? null);
  const startLoad = loads[0]!;
  const endLoad = terminalLoad ?? null;
  const loadText = (value: number | null) => (value === null ? 'not read' : value.toFixed(2));
  const readsText = (reads: readonly LoadRead[] | undefined) => (reads === undefined || reads.length === 0 ? 'none read' : reads.map((r) => `${r.load.toFixed(2)} (${r.at})`).join(', '));
  const lines = [
    `[remote-wake] the machine's 1-minute load (context): ${loadText(startLoad)} at the case's start, ${loadText(endLoad)} at its end; Rule B ${ruleB.length === 0 ? 'met' : `not met: ${ruleB.join('; ')}`}`,
    ...CARRIERS.flatMap((c) => (windowLoads[c] === undefined ? [] : [`[remote-wake] ${c}: the 1-minute load at its windows ${readsText(windowLoads[c])}`])),
    ...CARRIERS.flatMap((c) => (records[c] === undefined ? [] : [wakeTimingSummary(records[c]!, { resumeWaitMs: records[c]!.resumeWaitMs, settleMs: records[c]!.settleMs })])),
    ...CARRIERS.flatMap((c) => (records[c] !== undefined ? [wakeSummary(records[c]!)] : unavailable[c] !== undefined ? [unavailableSummary(c, unavailable[c]!)] : [])),
    `[remote-wake] void: ${verdict.void}, outside: ${verdict.outside}, pass: ${verdict.pass}`,
  ];
  const load = loadVerdict(loads, terminalLoad ?? null);
  const info = test.info();
  mkdirSync(info.project.outputDir, { recursive: true });
  writeFileSync(join(info.project.outputDir, 'remote-wake.json'), `${JSON.stringify({
    lines, mode: CHECK ? 'check' : 'perf', void: verdict.void, outside: verdict.outside, pass: verdict.pass, sha: process.env.GITHUB_SHA ?? null, runId: process.env.GITHUB_RUN_ID ?? null,
    bounds: { linkWithinMs: WAKE_CASE.linkWithinMs, feedWithinMs: WAKE_CASE.feedWithinMs, voidLoad: VOID_LOAD },
    voidReasons: verdict.voidReasons, failures, boundMisses: verdict.boundMisses, outsideMisses: verdict.outsideMisses, outsideConditions: verdict.outsideConditions,
    load: { start: startLoad, end: endLoad, samples: loads, peak: load.peak, pair: load.pair, ruleB },
    direct: records.direct ?? null, relay: records.relay ?? null, unavailable,
  }, null, 2)}\n`);
  for (const line of lines) {
    console.log(line);
    info.annotations.push({ type: 'remote-wake', description: line });
  }
  if (CHECK) {
    // the functional check: every line and count there; the times recorded, never held
    expect(failures, 'every line and count the wake case reads, per carrier').toEqual([]);
    for (const line of [...verdict.voidReasons, ...verdict.boundMisses, ...verdict.outsideMisses]) console.log(`[remote-wake] (check, not held) ${line}`);
    return;
  }
  expect(verdict.void, `the wake case is void by load, not a bound miss: ${verdict.voidReasons.join('; ')}; rerun the group in a quiet window (no verdict)`).toBe(false);
  expect(failures, 'every line and count the wake case reads, per carrier').toEqual([]);
  expect(verdict.boundMisses, boundMissMessage(CARRIERS.flatMap((c) => (records[c] === undefined ? [] : [records[c]!])))).toEqual([]);
  expect(verdict.outsideMisses, `outside §F's conditions, neither a breach nor a pass of the bounds: a carrier whose wake met one of the conditions missed a bound (${verdict.outsideConditions.join('; ')}); no verdict`).toEqual([]);
});

// A5's timeout, from its waits: the scene and B's two sessions, about 2 min; the launch to both panes shown, 2 min; the
// stall to the inject, INJECT_AFTER_STALL_MS (158 s; the live session's turns written inside it); the drawn wait, at most
// 3 s; three bounded reads after the restore (B's subbed, the panes, the reading); the cleanup; a margin of 2 min.
const BESIDE_TIMEOUT_MS = 2 * 60_000 + WAKE_LAUNCH_MS + INJECT_AFTER_STALL_MS + WAKE_CASE.restoreAfterMs.max + 3 * READ_WITHIN_MS + WAKE_CLEANUP_MS + 2 * 60_000;
// the settled word's backstop (SETTLE_BACKSTOP_MS, 2 s, src/renderer/src/lane-b/remote-session.ts) and a margin: a tab
// beside the live one reads by then whatever main says
const PAST_BACKSTOP_MS = 3_000;
const BESIDE_TURNS = 3; // the live session's turns unseen through the stall, so its resume replays something

test('U9 A5: beside a live session’s resume, a cold session’s pane reads nothing on the other machine until that resume is answered', async () => {
  test.setTimeout(BESIDE_TIMEOUT_MS);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-rb-')));
  const aUserData = mkdtempSync(join(tmpdir(), 'maws-rba-'));
  const checkout = join(root, 'b-checkout');
  mkdirSync(checkout);
  const samplesDir = join(root, 'b-samples');
  mkdirSync(samplesDir);
  const bBin = writeSessionLatencyEngine(join(root, 'b-engine'), samplesDir);
  let scene: RemoteScene | null = null;
  let a: MawsLaunch | null = null;
  try {
    scene = await startRemoteScene({ scratch: join(root, 'scene'), aUserData, directPipe: true, b: { env: { MAWS_E2E_ENGINE_BIN: bBin }, prepare: trust(checkout) } });
    const { b } = scene;
    const direct = scene.aDirect!;
    await b.request('machineSettings.set', { patch: { gateway: { defaultRoute: 'direct' } } });
    const project = await b.request<{ id: string }>('session.projects.add', { directory: checkout });
    const live = await startBSession(scene, project.id, checkout, samplesDir, 'B’s live session');
    const cold = await startBSession(scene, project.id, checkout, samplesDir, 'B’s cold session');
    await b.request('session.stop', { appSessionId: cold.app, reason: 'stop' });
    await expect.poll(async () => (await bStatusOf(b, cold.app))?.process ?? null, { timeout: TURN_MS, message: `B's session ${cold.app}'s engine stopped` }).toBe('exited');
    const mainLog = () => readLogLines(MAIN_LOG(aUserData));
    const hostLog = join(b.userData, 'supervisor', 'host.log');
    const liveWhat = `session B:${live.app}`;

    // 1. Up over the direct carrier, both sessions side by side and shown to their last turns, the live one subscribed
    a = await launchMaws({ userData: aUserData, env: { MAWS_DEV_ORG: scene.devOrgDir(true), MAWS_MACHINE_NAME: 'A' } });
    const { page, launchedAt } = a;
    await expect.poll(async () => {
      const m = await linkOf(page, b.ref);
      return m === undefined ? null : `${m.state}/${m.carrier ?? ''}`;
    }, { timeout: 60_000, message: "A's link to B comes up over direct" }).toBe('up/direct');
    await openSideBySide(a, b.ref, [live, cold]);
    const lastOf = (s: BSession) => markerOf(lastTurn(writtenOf(s.samples)), BENCH.markersPerTurn).trim();
    for (const [i, s] of [live, cold].entries()) {
      const last = lastOf(s);
      await expect.poll(async () => (await paneText(page, i)).includes(last), { timeout: 60_000, message: `A's pane ${i} shows B's session ${s.app} to its last turn (${last})` }).toBe(true);
    }
    await expect.poll(() => subscriptionsIn(mainLog(), b.ref, launchedAt).has(liveWhat), { timeout: READ_WITHIN_MS, message: `main.log's subbed line for ${liveWhat} since the launch` }).toBe(true);
    // the check below stands on A's history start lines: each pane's first read shows its start and its end before the stall
    await expect.poll(() => historySeen(mainLog(), [live.app, cold.app], launchedAt, Infinity), { timeout: READ_WITHIN_MS, message: "main.log's history start and end lines of each pane's first read (received: the sessions without)" }).toEqual([]);

    // 2. and 3. The wake case's stall, the live session's turns written unseen, B past its resume window, the hour asleep
    const stalledAt = Date.now();
    scene.aHub.stall();
    direct.stall();
    await writeTurns(b, live, BESIDE_TURNS);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, stalledAt + INJECT_AFTER_STALL_MS - Date.now())));
    const injectedAt = Date.now();
    await a.app.evaluate((_electron, sleptMs) => {
      const seam = (globalThis as { __maws_wake?: { inject(ms: number): void } }).__maws_wake;
      if (seam === undefined) throw new Error('no wake seam in main (MAWS_E2E=1, unpackaged)');
      seam.inject(sleptMs);
    }, WAKE_CASE.sleptMs);

    // 4. The way back after a drawn wait; the hub once the live session's stream is answered on B
    const { min, max } = WAKE_CASE.restoreAfterMs;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, injectedAt + min + Math.round(Math.random() * (max - min)) - Date.now())));
    const restoredAt = Date.now();
    direct.restore();
    const endpointLog = () => parseLogText(b.log());
    await expect.poll(() => subscriptionsIn(mainLog(), b.ref, restoredAt).has(liveWhat), { timeout: READ_WITHIN_MS, message: `main.log's subbed line for ${liveWhat} after the restore` }).toBe(true);
    scene.aHub.restore();

    // 5. Both panes whole after the return: the live one to the turns it missed, the cold one as it was
    for (const [i, s] of [live, cold].entries()) {
      const last = lastOf(s);
      await expect.poll(async () => (await paneText(page, i)).includes(last), { timeout: READ_WITHIN_MS, message: `A's pane ${i} shows B's session ${s.app} to its last turn (${last}) after the return` }).toBe(true);
    }

    // 6. The logs: no history read A asked of B between the restore and its subbed of the live stream, and no whole-launch
    //    read on B before B's; read once every read since the restore has ended (A's start and end lines pair) and past
    //    the settled word's backstop after that subbed, so no read that would have started is still to come
    const heardAt = Date.now();
    const besideOf = () => historyReadsBeside({ carrier: 'direct', ref: b.ref, live: live.app, sessions: [live.app, cold.app], main: mainLog(), endpoint: endpointLog(), host: readLogLines(hostLog), launchedAt, stalledAt, restoredAt });
    const final = await within(besideOf, (r) => r.inFlight.length === 0 && Date.now() >= heardAt + PAST_BACKSTOP_MS, READ_WITHIN_MS);
    const reads = besideOutcome(final, READ_WITHIN_MS); // the reading completed, or why not
    console.log(`[remote-beside] restore at +${restoredAt - stalledAt} ms after the stall; ${reads.length === 0 ? 'no history read beside the resume' : reads.join('; ')}`);
    expect(reads, 'no history read asked or made between the restore and the live session’s subbed, and none left in flight').toEqual([]);
  } finally {
    await cleanupAll([() => a?.cleanup(), () => scene?.stop(), () => rmSync(aUserData, { recursive: true, force: true }), () => rmSync(root, { recursive: true, force: true })]);
  }
});
