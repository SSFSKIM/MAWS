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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { MachineState } from '../src/shared/ipc/schema/machines';
import { addressOf } from '../src/shared/machine/address';
import type { MachineRef } from '../src/shared/machine/ref';
import { BENCH, clockCheck, summarize, type ClockBracket, type ClockCheck } from '../test/support/local-latency';
import { MARKER_SOURCE, markerOf, writeLatencyEngine } from '../test/support/latency-engine';
import { boundsOf, budgetMisses, CARRIERS, EXPECTED_MARKERS, invalidReasons, loadVerdict, REMOTE_BENCH, remoteLine, rttStats, type Bounds, type CaseRun, type Carrier, type Exchange, type Measures, type RemoteMeasures } from '../test/support/remote-latency';
import { invoke, value } from './support/c7-replay';
import { launchMaws, type MawsLaunch } from './support/launch';
import { startRemoteScene, type RemoteScene } from './support/remote-scene';
import { showProjectList, sidebarOf, sidebarRow } from './support/sidebar';

// `pnpm e2e:remote-latency-check` (MAWS_REMOTE_LATENCY_CHECK=1) runs the same scene as a functional check, anywhere an e2e
// group runs (GitHub's hosted Macs): every case measured and every ping answered, its numbers recorded and never held to
// a bound, since only the measured group's machine is the one the bounds are read on.
const CHECK = process.env.MAWS_REMOTE_LATENCY_CHECK === '1';
test.skip(process.env.MAWS_REMOTE_LATENCY_PERF !== '1' && !CHECK, 'the remote bench runs under pnpm e2e:remote-latency (MAWS_REMOTE_LATENCY_PERF=1)');
test.describe.configure({ timeout: 20 * 60_000 });

const now = () => performance.timeOrigin + performance.now();
const TURN_MS = 60_000;
const PROJECT = 'e2e-remote-latency'; // sminos's project id for B's checkout
const prompt = (turn: number) => `latency bench turn ${turn}`;

type Seen = { marker: string; at: number | null; present: boolean | null };
type Written = { turn: number; k: number; writtenAt: number };
const writtenOf = (path: string): Written[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Written) : []);
const lastTurn = (path: string) => Math.max(0, ...writtenOf(path).map((w) => w.turn));
const markersOf = (turn: number) => Array.from({ length: BENCH.markersPerTurn }, (_, k) => markerOf(turn, k + 1).trim());
const main = (page: Page) => page.locator('[data-region="main"]');

// The local bench's clock check: five renderer reads, each between two of this runner's.
async function clockBrackets(page: Page): Promise<ClockBracket[]> {
  const brackets: ClockBracket[] = [];
  for (let i = 0; i < 5; i += 1) {
    const before = now();
    const renderer = await page.evaluate(() => performance.timeOrigin + performance.now());
    brackets.push({ before, renderer, after: now() });
  }
  return brackets;
}

// The local bench's observer (e2e/local-latency.spec.ts): each new marker in the main region timed at the end of the
// main-thread work of the frame that renders it; what is shown already is taken as found now.
async function observeMarkers(page: Page): Promise<void> {
  await page.evaluate((source) => {
    const region = document.querySelector('[data-region="main"]');
    if (!region) throw new Error('no main region');
    const pattern = new RegExp(source, 'g');
    const seen = new Map<string, { at: number | null; present: boolean | null }>();
    const holders = new Map<string, Node>();
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent<string>) => {
      const at = performance.timeOrigin + performance.now();
      const marker = event.data;
      const holder = holders.get(marker)!;
      const present = (holder.isConnected && (holder.textContent ?? '').includes(marker)) || (region.textContent ?? '').includes(marker);
      seen.set(marker, { at, present });
    };
    const scan = (root: Node) => {
      for (const match of (root.textContent ?? '').matchAll(pattern)) {
        const marker = match[0];
        if (seen.has(marker)) continue;
        seen.set(marker, { at: null, present: null });
        holders.set(marker, root);
        requestAnimationFrame(() => channel.port2.postMessage(marker));
      }
    };
    new MutationObserver((records) => {
      const roots = new Set<Node>();
      for (const record of records) {
        const node = record.type === 'characterData' ? record.target.parentNode : record.target;
        if (node && region.contains(node)) roots.add(node);
      }
      for (const root of roots) scan(root);
    }).observe(document.body, { childList: true, characterData: true, subtree: true });
    scan(region);
    (window as unknown as { __latencySeen: typeof seen }).__latencySeen = seen;
  }, MARKER_SOURCE);
}
const seenMarkers = (page: Page): Promise<Seen[]> =>
  page.evaluate(() => [...(window as unknown as { __latencySeen: Map<string, { at: number | null; present: boolean | null }> }).__latencySeen].map(([marker, v]) => ({ marker: marker.trim(), ...v })));

// Open to first row: the press on `row` and the first frame after any marker of the session's history is in the main
// region, both by the renderer's clock, watched from before the click.
async function openToFirstRow(page: Page, row: ReturnType<Page['locator']>): Promise<number> {
  await page.evaluate((source) => {
    const region = document.querySelector('[data-region="main"]')!;
    const pattern = new RegExp(source);
    const open = { pressed: null as number | null, shown: null as number | null };
    (window as unknown as { __open: typeof open }).__open = open;
    document.addEventListener('pointerdown', () => void (open.pressed ??= performance.timeOrigin + performance.now()), { capture: true, once: true });
    const observer = new MutationObserver(() => {
      if (open.pressed === null || !pattern.test(region.textContent ?? '')) return;
      observer.disconnect();
      requestAnimationFrame(() => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => void (open.shown = performance.timeOrigin + performance.now());
        channel.port2.postMessage(null);
      });
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  }, MARKER_SOURCE);
  await row.click();
  let open: { pressed: number | null; shown: number | null } = { pressed: null, shown: null };
  await expect.poll(async () => (open = await page.evaluate(() => (window as unknown as { __open: { pressed: number | null; shown: number | null } }).__open)).shown, { timeout: 60_000, message: 'the session’s history in the pane' }).not.toBeNull();
  return open.shown! - open.pressed!;
}

// 220 sequential `session.getContextUsage` invokes from the page, each timed around its await (on `machine`, or this Mac).
function roundTrips(page: Page, appSessionId: string, machine: MachineRef | null): Promise<number[]> {
  return page.evaluate(async ({ id, on, count }) => {
    const times: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const start = performance.now();
      const answer = await window.maws.invoke('session.getContextUsage', { appSessionId: id as never, detail: 'summary' }, (on ?? undefined) as never);
      times.push(performance.now() - start);
      if (!answer.ok) throw new Error(`session.getContextUsage failed: ${answer.error.code}: ${answer.error.message}`);
    }
    return times;
  }, { id: appSessionId, on: machine, count: BENCH.roundTrips });
}

interface Turns {
  send(turn: number): Promise<void>;
  closed(): Promise<boolean>; // the session's turn is over, on the machine that runs it
}

// One case's turns: 3 after the last the stub wrote, each written, closed, and its markers in the pane; the first a
// warm-up. Answers the kept markers' delays and what a turn lacked.
async function measureTurns(page: Page, samples: string, turns: Turns): Promise<{ run: CaseRun; delays: number[] }> {
  await observeMarkers(page);
  const first = lastTurn(samples) + 1;
  const missing: { turn: number; markers: string[] }[] = [];
  for (let turn = first; turn < first + BENCH.turns; turn += 1) {
    await turns.send(turn);
    await expect.poll(() => writtenOf(samples).filter((w) => w.turn === turn).length, { timeout: TURN_MS, message: `turn ${turn}'s deltas written (a stub that restarted numbers its turns from 1 again)` }).toBe(BENCH.markersPerTurn);
    await expect.poll(() => turns.closed(), { timeout: TURN_MS, message: `turn ${turn} closed` }).toBe(true);
    const expected = markersOf(turn);
    const deadline = Date.now() + 10_000;
    for (;;) {
      const text = await main(page).evaluate((region) => region.textContent ?? '');
      const lacking = expected.filter((marker) => !text.includes(marker));
      if (lacking.length === 0 || Date.now() > deadline) {
        if (lacking.length > 0) missing.push({ turn, markers: lacking });
        break;
      }
      await page.waitForTimeout(100);
    }
  }
  const seen = new Map((await seenMarkers(page)).map((s) => [s.marker, s]));
  const kept = writtenOf(samples).filter((w) => w.turn >= first + BENCH.warmupTurns && w.turn < first + BENCH.turns);
  const delays = kept.flatMap((w) => {
    const s = seen.get(markerOf(w.turn, w.k).trim());
    return s?.at != null && s.present === true ? [s.at - w.writtenAt] : [];
  });
  return { run: { samples: delays, expected: EXPECTED_MARKERS, missing, clock: clockCheck(await clockBrackets(page)) }, delays };
}

const statsOf = (delays: number[]) => (delays.length === 0 || delays.some((d) => d < 0) ? null : summarize(delays, 0));

// `session.start` to the process's `ready`, polled every 10 ms on the machine that runs it.
async function startTimed(start: () => Promise<unknown>, ready: () => Promise<boolean>): Promise<number> {
  const at = now();
  await start();
  for (;;) {
    if (await ready()) return now() - at;
    if (now() - at > TURN_MS) throw new Error('the session did not come ready within 60 s');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const trust = (dir: string) => ({ claudeConfigDir }: { claudeConfigDir: string }) => {
  writeFileSync(join(claudeConfigDir, '.claude.json'), `${JSON.stringify({ projects: { [dir]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  writeFileSync(join(claudeConfigDir, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
};

type CaseResult = { measures: Measures | null; run: CaseRun | null; roundTripsMs: number[] };

// 1. The local case, on its own scratch profile.
async function localCase(root: string): Promise<CaseResult & { engineStartMs: number }> {
  const repo = join(root, 'local-repo');
  const userData = join(root, 'ud-local');
  mkdirSync(repo);
  mkdirSync(userData);
  const samples = join(root, 'local-samples.jsonl');
  const bin = writeLatencyEngine(join(root, 'local-engine'), samples);
  let maws: MawsLaunch | null = null;
  try {
    maws = await launchMaws({ userData, syntheticEngineBin: bin, env: { MAWS_E2E_ENGINE_BIN: bin }, prepare: trust(repo) });
    const { page } = maws;
    const project = value(await invoke(page, 'session.projects.add', { directory: repo }));
    const { appSessionId: id } = value(await invoke(page, 'session.create', { projectId: project.id, location: { kind: 'directory', path: repo } }));
    const status = async () => {
      const s = await invoke(page, 'session.status', { appSessionId: id });
      return s.ok ? s.value : null;
    };
    // the first turn is the history the open shows, before any tab of the session
    const engineStartMs = await startTimed(
      async () => expect(value(await invoke(page, 'session.start', { appSessionId: id, message: { content: prompt(1), display: prompt(1) }, options: { gateway: 'direct' } })).status).toBe('starting'),
      async () => (await status())?.process === 'ready',
    );
    await expect.poll(() => writtenOf(samples).length, { timeout: TURN_MS }).toBe(BENCH.markersPerTurn);
    await expect.poll(async () => (await status())?.turn === null, { timeout: TURN_MS }).toBe(true);
    const row = await sidebarRow(page, { appSessionId: id });
    const openToFirstRowMs = await openToFirstRow(page, row);
    await page.mouse.move(700, 20);
    const { run, delays } = await measureTurns(page, samples, {
      send: async (turn) => void value(await invoke(page, 'session.send', { appSessionId: id, content: prompt(turn) })),
      closed: async () => {
        const s = await status();
        return s?.process === 'ready' && s.turn === null;
      },
    });
    const trips = await roundTrips(page, id, null);
    const deltaToFrame = statsOf(delays);
    value(await invoke(page, 'session.stop', { appSessionId: id, reason: 'stop' }));
    return { measures: deltaToFrame === null ? null : { deltaToFrame, roundTrip: summarize(trips, BENCH.roundTripWarmup), openToFirstRowMs, resumeMs: null, engineStartMs }, run, roundTripsMs: trips, engineStartMs };
  } finally {
    await maws?.cleanup();
  }
}

// The raw bridge's answer to a main-owned command (machines.*, org.*), or the test fails with the error it carried.
async function raw<T>(page: Page, name: string, input: unknown): Promise<T> {
  const result = await page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const);
  if (!(result as { ok: boolean }).ok) throw new Error(`${name}: ${JSON.stringify((result as { error: unknown }).error)}`);
  return (result as { value: T }).value;
}
const linkOf = async (page: Page, ref: MachineRef) => (await raw<{ machines: MachineState[] }>(page, 'machines.list', undefined)).machines.find((m) => m.ref === ref);
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

// The link's own round trip: 100 pings through main's bench seam.
async function pings(app: ElectronApplication, ref: MachineRef): Promise<Exchange[]> {
  const answers = await app.evaluate(async (_electron, [machine, count]) => {
    const seam = (globalThis as { __maws_remote_bench?: { ping(ref: string, count: number): Promise<unknown[]> } }).__maws_remote_bench;
    if (!seam) throw new Error('no remote bench seam in main (MAWS_E2E=1, unpackaged)');
    return seam.ping(machine, count);
  }, [ref, REMOTE_BENCH.pings] as const);
  return (answers as (Exchange | null)[]).filter((a): a is Exchange => a !== null);
}
const probe = (app: ElectronApplication, ref: MachineRef) =>
  app.evaluate((_electron, machine) => (globalThis as { __maws_remote_bench?: { probe(ref: string, reason: string): void } }).__maws_remote_bench!.probe(machine, 'network'), ref);

test('remote latency: delta to frame, round trip, open, resume and the link’s round trip of a lane B session on another machine, per carrier, against the same run’s local numbers (acceptance 3)', async () => {
  const loads = [loadavg()[0]];
  const sampler = setInterval(() => loads.push(loadavg()[0]), 30_000);
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
      const { run, delays } = await measureTurns(page, bSamples, {
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

      // The forced drop: both of A's ways to B cut, B's session writes a turn A can't see, both restored with the probe.
      await keepArrivals(page, b.ref, app);
      scene.aHub.cut();
      scene.aDirect!.cut();
      await expect.poll(async () => (await linkOf(page, b.ref))?.state, { timeout: 30_000, message: 'A’s link to B down once its ways are cut' }).toBe('down');
      const gapTurn = lastTurn(bSamples) + 1;
      await b.request('session.send', { appSessionId: app, content: prompt(gapTurn) });
      await expect.poll(() => writtenOf(bSamples).filter((w) => w.turn === gapTurn).length, { timeout: TURN_MS }).toBe(BENCH.markersPerTurn);
      await expect.poll(bClosed, { timeout: TURN_MS }).toBe(true);
      const before = (await arrivals(page)).length;
      scene.aHub.restore();
      scene.aDirect!.restore();
      const restoredAt = now();
      await probe(a.app, b.ref);
      let first: number | null = null;
      await expect.poll(async () => (first = (await arrivals(page)).slice(before)[0] ?? null), { timeout: 60_000, message: 'the first event after the gap in A' }).not.toBeNull();
      const resumeMs = first! - restoredAt;
      await expect.poll(async () => (await main(page).evaluate((region) => region.textContent ?? '')).includes(markerOf(gapTurn, BENCH.markersPerTurn).trim()), { timeout: 30_000, message: 'the gap’s turn in A’s pane' }).toBe(true);

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
    loads.push(loadavg()[0]);
    await a?.cleanup();
    await scene?.stop();
    rmSync(aUserData, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }

  const reasons = invalidReasons({ cases: { local: cases.local?.run ?? null, direct: cases.direct?.run ?? null, relay: cases.relay?.run ?? null }, pings: { direct: exchanges.direct.length, relay: exchanges.relay.length }, loads });
  const localMeasures = cases.local?.measures ?? null;
  const bounds: Partial<Record<Carrier, Bounds>> = {};
  const misses: string[] = [];
  for (const carrier of CARRIERS) {
    const measured = remote[carrier];
    if (localMeasures === null || measured === undefined) continue;
    bounds[carrier] = boundsOf(localMeasures, measured.rtt);
    misses.push(...budgetMisses(carrier, measured, bounds[carrier]!));
  }
  const load = loadVerdict(loads);
  const lines = [...(localMeasures === null ? [] : [remoteLine('local', localMeasures)]), ...CARRIERS.flatMap((c) => (remote[c] === undefined ? [] : [remoteLine(c, remote[c]!)]))];
  const info = test.info();
  mkdirSync(info.project.outputDir, { recursive: true });
  const clockOf = (c: CaseResult | null): ClockCheck | null => c?.run?.clock ?? null;
  writeFileSync(join(info.project.outputDir, 'remote-latency.json'), `${JSON.stringify({
    lines, valid: reasons.length === 0, sha: process.env.GITHUB_SHA ?? null, runId: process.env.GITHUB_RUN_ID ?? null,
    local: localMeasures, direct: remote.direct ?? null, relay: remote.relay ?? null, bounds, invalidReasons: reasons, budgetMisses: misses,
    load: { samples: loads, peak: load.peak, pair: load.pair },
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
