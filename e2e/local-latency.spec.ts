// The local-latency bench (P5 O1, M1; docs/doperpowers/plans/2026-10-27-p5-o1-seams.md; P5 §10 and OX7): one lane B
// session on the local path, in detached mode (the owner's daily shape), measured end to end through the built app.
// Its engine is test/support/latency-engine-stub.mjs, a real child process the engine host launches through
// MAWS_E2E_ENGINE_BIN, so every hop P5 adds (mawsd, then O16's session host) lands on the measured path.
//
//   delta to frame  OX7's delta-to-paint as measured (P5 Decision Log 20): from the stub's write of a text delta to the
//                   end of the main-thread work of the frame that renders it. In the page a MutationObserver finds each
//                   new marker in the main region, schedules a requestAnimationFrame callback that posts one message on
//                   a MessageChannel, and the message's arrival (after that frame's style, layout and paint steps) is
//                   the marker's time; GPU compositing and presentation are not measured. Three turns of 300 deltas,
//                   one every 10 ms; the first warms the path and is discarded, leaving 600 markers. A marker gone from
//                   the DOM when its message arrives is not a sample, and is counted.
//   round trip      220 sequential `session.getContextUsage` invokes from the page (renderer, main, engine host, the
//                   engine and back; the stub answers at once), each timed around its await; the first 20 discarded.
//
// The stub and this runner read one clock (`performance.timeOrigin + performance.now()`, both Node); the renderer's is
// checked against the runner's before the first turn. The run is invalid, and fails saying why, under 570 samples, with
// a turn missing a marker once it completed, on a failed clock check or on a negative sample. It prints one line, adds
// it as an annotation, and writes the samples, the summary and the 1-minute load to test-results/local-latency.json.
// Once test/support/local-latency.ts records the baseline (three runs at M1's commit), each metric is held to it plus
// OX7's 2 ms at p50 and 5 ms at p95.
//
// A measured group (gate.yml's MEASURED_E2E): `pnpm e2e:local-latency` sets MAWS_LOCAL_LATENCY_PERF=1, and the gate runs
// it only when named, on the mini's exclusive instance behind the measured-job guard. It spends nothing and touches no
// keychain: the stub makes no network call, and MAWS_E2E brings the mock keychain.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import { BENCH, budgetMisses, clockCheck, invalidReasons, latencyLine, summarize, type ClockBracket } from '../test/support/local-latency';
import { MARKER_SOURCE, markerOf, writeLatencyEngine } from '../test/support/latency-engine';
import { machineLoad } from '../test/support/latency-budget';
import { invoke, value } from './support/c7-replay';
import { launchMaws, type MawsLaunch } from './support/launch';
import { killScratchProcesses } from './support/processes';
import { sidebarRow } from './support/sidebar';
import { tmpSocketDirOf } from './support/supervisor-socket';

test.skip(process.env.MAWS_LOCAL_LATENCY_PERF !== '1', 'the local-latency bench runs under pnpm e2e:local-latency (MAWS_LOCAL_LATENCY_PERF=1)');
test.describe.configure({ timeout: 5 * 60_000 });

const now = () => performance.timeOrigin + performance.now();
const TURN_MS = 60_000; // a turn's 300 deltas take 3 s; the first waits for the launch too

type Seen = { marker: string; at: number | null; present: boolean | null };
type Written = { turn: number; k: number; writtenAt: number };

// Five renderer clock reads, each between two of this runner's.
async function clockBrackets(page: Page): Promise<ClockBracket[]> {
  const brackets: ClockBracket[] = [];
  for (let i = 0; i < 5; i += 1) {
    const before = now();
    const renderer = await page.evaluate(() => performance.timeOrigin + performance.now());
    brackets.push({ before, renderer, after: now() });
  }
  return brackets;
}

// The observer (this file's header): installed once the session's transcript is shown; what is shown already is taken
// as found now. Its records stay in the window until read.
async function observeMarkers(page: Page): Promise<void> {
  await page.evaluate((source) => {
    const main = document.querySelector('[data-region="main"]');
    if (!main) throw new Error('no main region');
    const pattern = new RegExp(source, 'g');
    const seen = new Map<string, { at: number | null; present: boolean | null }>();
    const holders = new Map<string, Node>();
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent<string>) => {
      const at = performance.timeOrigin + performance.now();
      const marker = event.data;
      const holder = holders.get(marker)!;
      const present = (holder.isConnected && (holder.textContent ?? '').includes(marker)) || (main.textContent ?? '').includes(marker);
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
        if (node && main.contains(node)) roots.add(node);
      }
      for (const root of roots) scan(root);
    }).observe(document.body, { childList: true, characterData: true, subtree: true });
    scan(main);
    (window as unknown as { __latencySeen: typeof seen }).__latencySeen = seen;
  }, MARKER_SOURCE);
}
const seenMarkers = (page: Page): Promise<Seen[]> =>
  page.evaluate(() => [...(window as unknown as { __latencySeen: Map<string, { at: number | null; present: boolean | null }> }).__latencySeen].map(([marker, v]) => ({ marker: marker.trim(), ...v })));

const writtenOf = (path: string): Written[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Written) : []);
const markersOf = (turn: number) => Array.from({ length: BENCH.markersPerTurn }, (_, k) => markerOf(turn, k + 1).trim());

// The turn's 300 deltas written, then the turn closed in the host's status, then each of its markers in the main region
// (the completed block replaces the streamed one); the markers still missing after 10 s are returned.
async function untilTurnDone(page: Page, id: AppSessionId, samples: string, turn: number): Promise<string[]> {
  await expect.poll(() => writtenOf(samples).filter((w) => w.turn === turn).length, { timeout: TURN_MS, message: `turn ${turn}'s deltas written` }).toBe(BENCH.markersPerTurn);
  await expect.poll(async () => {
    const status = await invoke(page, 'session.status', { appSessionId: id });
    return status.ok ? `${status.value.process}/${status.value.turn === null ? 'idle' : 'turn'}` : status.error.code;
  }, { timeout: TURN_MS, message: `turn ${turn} closed` }).toBe('ready/idle');
  const expected = markersOf(turn);
  const deadline = Date.now() + 10_000;
  for (;;) {
    const text = await page.locator('[data-region="main"]').evaluate((main) => main.textContent ?? '');
    const missing = expected.filter((marker) => !text.includes(marker));
    if (missing.length === 0 || Date.now() > deadline) return missing;
    await page.waitForTimeout(100);
  }
}

async function roundTrips(page: Page, id: AppSessionId): Promise<number[]> {
  return page.evaluate(async ({ appSessionId, count }) => {
    const times: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const start = performance.now();
      const answer = await window.maws.invoke('session.getContextUsage', { appSessionId: appSessionId as never, detail: 'summary' });
      times.push(performance.now() - start);
      if (!answer.ok) throw new Error(`session.getContextUsage failed: ${answer.error.code}: ${answer.error.message}`);
    }
    return times;
  }, { appSessionId: id as string, count: BENCH.roundTrips });
}

test('local latency: delta to frame and command round trip of a lane B session on the local path (OX7)', async () => {
  const load = machineLoad().load;
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-ll-')));
  const repo = join(root, 'repo');
  const userData = join(root, 'ud');
  mkdirSync(repo);
  mkdirSync(userData);
  const samples = join(root, 'samples.jsonl');
  const bin = writeLatencyEngine(join(root, 'latency-engine'), samples);
  let maws: MawsLaunch | null = null;
  let leftover: unknown;
  try {
    maws = await launchMaws({
      userData,
      env: { MAWS_HARNESS: '0', MAWS_E2E_QUIET: '1', MAWS_HOST_MODE: 'detached', MAWS_E2E_ENGINE_BIN: bin },
      // the bench's directory trusted and the user's default mode `default`, so the launch runs no trust bootstrap and
      // no auto-mode fallback: the stub's prelude is Session's minimal one
      prepare: ({ claudeConfigDir }) => {
        writeFileSync(join(claudeConfigDir, '.claude.json'), `${JSON.stringify({ projects: { [repo]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
        writeFileSync(join(claudeConfigDir, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
      },
    });
    const { page } = maws;
    const clock = clockCheck(await clockBrackets(page));

    // The session as the composer's first Send starts one (e2e/bench-edit-live.spec.ts), on the direct route.
    const project = value(await invoke(page, 'session.projects.add', { directory: repo }));
    const { appSessionId: id } = value(await invoke(page, 'session.create', { projectId: project.id, location: { kind: 'directory', path: repo } }));
    const prompt = (turn: number) => `latency bench turn ${turn}`;
    const started = value(await invoke(page, 'session.start', { appSessionId: id, message: { content: prompt(1), display: prompt(1) }, options: { gateway: 'direct' } }));
    expect(started.status, `the session started (${JSON.stringify(started)})`).toBe('starting');

    // Its tab opened from the sidebar (e2e/supervisor.spec.ts's showSession), then the observer; turn 1 is the warm-up.
    await expect(async () => {
      const row = await sidebarRow(page, { appSessionId: id });
      await row.click({ timeout: 2_000 });
      await expect(page.locator(`[data-region="main"] [data-composer="${id}"]`)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: TURN_MS });
    await page.mouse.move(700, 20);
    await observeMarkers(page);
    const missing: { turn: number; markers: string[] }[] = [];
    for (let turn = 1; turn <= BENCH.turns; turn += 1) {
      if (turn > 1) value(await invoke(page, 'session.send', { appSessionId: id, content: prompt(turn) }));
      const lacking = await untilTurnDone(page, id, samples, turn);
      if (lacking.length > 0) missing.push({ turn, markers: lacking });
    }

    // The delays of the kept turns' markers, in the order they were written.
    const seen = new Map((await seenMarkers(page)).map((s) => [s.marker, s]));
    const kept = writtenOf(samples).filter((w) => w.turn > BENCH.warmupTurns);
    const marks = kept.map((w) => {
      const s = seen.get(markerOf(w.turn, w.k).trim());
      return { turn: w.turn, k: w.k, writtenAt: w.writtenAt, at: s?.at ?? null, present: s?.present ?? null };
    });
    const sampled = marks.filter((m) => m.at !== null && m.present === true);
    const delays = sampled.map((m) => m.at! - m.writtenAt);
    const expected = BENCH.markersPerTurn * (BENCH.turns - BENCH.warmupTurns);

    const trips = await roundTrips(page, id);
    const reasons = invalidReasons({ samples: delays, expected, missing, clock });
    const roundTrip = summarize(trips, BENCH.roundTripWarmup);
    const deltaToFrame = delays.some((d) => d < 0) || delays.length === 0 ? null : summarize(delays, 0);
    const line = deltaToFrame === null ? null : latencyLine({ deltaToFrame, roundTrip, expected, load });
    const info = test.info();
    mkdirSync(info.project.outputDir, { recursive: true });
    writeFileSync(join(info.project.outputDir, 'local-latency.json'), `${JSON.stringify({
      line, valid: reasons.length === 0, reasons, sha: process.env.GITHUB_SHA ?? null, runId: process.env.GITHUB_RUN_ID ?? null, load, clock,
      deltaToFrame, roundTrip,
      markers: { expected, samples: delays.length, gone: marks.filter((m) => m.present === false).length, unseen: marks.filter((m) => m.at === null).length },
      samples: marks.map((m) => ({ turn: m.turn, k: m.k, delayMs: m.at === null ? null : m.at - m.writtenAt, present: m.present })),
      roundTripsMs: trips,
    }, null, 2)}\n`);
    if (line !== null) {
      console.log(line);
      info.annotations.push({ type: 'local-latency', description: line });
    }
    expect(reasons, 'the run is valid').toEqual([]);
    expect(budgetMisses({ deltaToFrame: deltaToFrame!, roundTrip }), "within OX7's budget of the baseline").toEqual([]);

    value(await invoke(page, 'session.stop', { appSessionId: id, reason: 'stop' }));
  } finally {
    leftover = await removeScratch(root, userData, maws);
  }
  if (leftover !== null) throw leftover; // the body passed: a process of the scratch outliving it is the case's failure
});

// The app closed, then every process of the scratch killed (the detached supervisor by its lock's pid too), then the
// supervisor's socket directory and the scratch removed. A survivor is answered, after the files are removed all the same.
async function removeScratch(root: string, userData: string, maws: MawsLaunch | null): Promise<unknown> {
  const lock = (() => {
    try {
      return JSON.parse(readFileSync(join(userData, 'supervisor', 'host.lock'), 'utf8')) as { pid: number; socketPath: string };
    } catch {
      return null;
    }
  })();
  await maws?.cleanup().catch((error: unknown) => console.error(error));
  let leftover: unknown = null;
  await killScratchProcesses(root, lock ? [lock.pid] : []).catch((error: unknown) => (leftover = error));
  const socketDir = lock ? tmpSocketDirOf(userData, lock.socketPath) : null;
  if (socketDir !== null) rmSync(socketDir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
  return leftover;
}
