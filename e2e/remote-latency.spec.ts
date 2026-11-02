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
// session writing a turn while A can't see it, then both restored with the network probe a returning network brings, and
// the time from the restore to the first event after the gap in A's renderer (resume). Engine start is `session.start`
// to the process's `ready` on the machine that runs it.
//
// Everything goes to test-results/remote-latency.json (§S); the run is valid by each case's samples, markers and clock
// and by Rule B on the load sampled every 30 s (test/support/remote-latency.ts), and each carrier is held to acceptance
// 3's bounds against the local numbers. A measured group (gate.yml's MEASURED_E2E): `pnpm e2e:remote-latency` sets
// MAWS_REMOTE_LATENCY_PERF=1; it spends nothing (no network beyond 127.0.0.1) and touches no keychain.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { addressOf } from '../src/shared/machine/address';
import type { MachineRef } from '../src/shared/machine/ref';
import { BENCH, summarize, type ClockCheck } from '../test/support/local-latency';
import { markerOf, writeLatencyEngine } from '../test/support/latency-engine';
import { boundsOf, budgetMisses, CARRIERS, invalidReasons, loadVerdict, remoteLine, rttStats, type Bounds, type Carrier, type Exchange, type RemoteMeasures } from '../test/support/remote-latency';
import { launchMaws, type MawsLaunch } from './support/launch';
import { cleanupAll, lastTurn, linkOf, localCase, main, measureTurns, now, openToFirstRow, pings, probe, prompt, raw, roundTrips, statsOf, trust, TURN_MS, writtenOf, type CaseResult } from './support/remote-latency-page';
import { startRemoteScene, type RemoteScene } from './support/remote-scene';
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
