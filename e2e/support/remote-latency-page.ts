// The remote bench's measures as A's page and main take them (P5 O7 M7, docs/doperpowers/plans/2026-10-28-p5-o7-remote-
// lane-b.md, M7 and Interfaces §S), shared by the measured group (e2e/remote-latency.spec.ts) and its live mode
// (e2e/remote-latency-live.spec.ts): the local bench's observer and clock check (e2e/local-latency.spec.ts), open to
// first row, the round trips, one case's turns, the local case on its own scratch profile, and the link's pings through
// main's bench seam (src/main/machines/remote/bench-seam.ts).
//
// A marker's frame is read on one of two clocks: `performance`, this Mac's `performance.timeOrigin + performance.now()`,
// which the stub on this Mac writes by (one machine, one clock); or `wall`, Date.now(), the clock the live bench's
// machine stamps its writes and its pongs with (the live clock, test/support/remote-latency.ts).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import type { AppSessionId } from '../../src/shared/graph/ids';
import type { MachineState } from '../../src/shared/ipc/schema/machines';
import type { MachineRef } from '../../src/shared/machine/ref';
import { BENCH, clockCheck, summarize, type ClockBracket } from '../../test/support/local-latency';
import { MARKER_SOURCE, markerOf, writeLatencyEngine } from '../../test/support/latency-engine';
import { delaysOf, engineStartOf, EXPECTED_MARKERS, REMOTE_BENCH, type CaseRun, type Exchange, type Measures } from '../../test/support/remote-latency';
import { invoke, value } from './c7-replay';
import { launchMaws, type MawsLaunch } from './launch';
import { sidebarRow } from './sidebar';

export const now = () => performance.timeOrigin + performance.now();
export const TURN_MS = 60_000;
export const prompt = (turn: number) => `latency bench turn ${turn}`;
export type FrameClock = 'performance' | 'wall';

/** One delta the stub wrote: `writtenAt` on its process's performance clock, `wallAt` on the wall clock's millisecond. */
export type Written = { turn: number; k: number; writtenAt: number; wallAt?: number };
type Seen = { marker: string; at: number | null; present: boolean | null };
export const writtenOf = (path: string): Written[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Written) : []);
export const lastTurn = (written: readonly Written[]) => Math.max(0, ...written.map((w) => w.turn));
const markersOf = (turn: number) => Array.from({ length: BENCH.markersPerTurn }, (_, k) => markerOf(turn, k + 1).trim());
export const main = (page: Page) => page.locator('[data-region="main"]');

// The local bench's clock check: five renderer reads, each between two of this runner's.
export async function clockBrackets(page: Page): Promise<ClockBracket[]> {
  const brackets: ClockBracket[] = [];
  for (let i = 0; i < 5; i += 1) {
    const before = now();
    const renderer = await page.evaluate(() => performance.timeOrigin + performance.now());
    brackets.push({ before, renderer, after: now() });
  }
  return brackets;
}

// The local bench's observer (e2e/local-latency.spec.ts): each new marker in the main region timed at the end of the
// main-thread work of the frame that renders it, on `clock`; what is shown already is taken as found now.
async function observeMarkers(page: Page, clock: FrameClock): Promise<void> {
  await page.evaluate(([source, wall]) => {
    const region = document.querySelector('[data-region="main"]');
    if (!region) throw new Error('no main region');
    const pattern = new RegExp(source, 'g');
    const seen = new Map<string, { at: number | null; present: boolean | null }>();
    const holders = new Map<string, Node>();
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent<string>) => {
      const at = wall ? Date.now() : performance.timeOrigin + performance.now();
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
  }, [MARKER_SOURCE, clock === 'wall'] as const);
}
const seenMarkers = (page: Page): Promise<Seen[]> =>
  page.evaluate(() => [...(window as unknown as { __latencySeen: Map<string, { at: number | null; present: boolean | null }> }).__latencySeen].map(([marker, v]) => ({ marker: marker.trim(), ...v })));

// Open to first row: the press on `row` and the first frame after any marker of the session's history is in the main
// region, both by the renderer's clock, watched from before the click.
export async function openToFirstRow(page: Page, row: ReturnType<Page['locator']>): Promise<number> {
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
export function roundTrips(page: Page, appSessionId: string, machine: MachineRef | null): Promise<number[]> {
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

export interface Turns {
  send(turn: number): Promise<void>;
  closed(): Promise<boolean>; // the session's turn is over, on the machine that runs it
}

// One case's turns: 3 after the last the stub wrote, each written, closed, and its markers in the pane; the first a
// warm-up. Answers the kept markers' delays (each frame on `clock` less its write on the same clock) and what a turn
// lacked.
export async function measureTurns(page: Page, written: () => Written[], turns: Turns, clock: FrameClock = 'performance'): Promise<{ run: CaseRun; delays: number[] }> {
  await observeMarkers(page, clock);
  const first = lastTurn(written()) + 1;
  const missing: { turn: number; markers: string[] }[] = [];
  for (let turn = first; turn < first + BENCH.turns; turn += 1) {
    await turns.send(turn);
    await expect.poll(() => written().filter((w) => w.turn === turn).length, { timeout: TURN_MS, message: `turn ${turn}'s deltas written (a stub that restarted numbers its turns from 1 again)` }).toBe(BENCH.markersPerTurn);
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
  const kept = written().filter((w) => w.turn >= first + BENCH.warmupTurns && w.turn < first + BENCH.turns);
  const delays = delaysOf(kept, seen, clock, markerOf);
  return { run: { samples: delays, expected: EXPECTED_MARKERS, missing, clock: clockCheck(await clockBrackets(page)) }, delays };
}

/** One clock's delays as stats; null with none, or with a negative one (a delay can't precede its write). */
export const statsOf = (delays: number[]) => (delays.length === 0 || delays.some((d) => d < 0) ? null : summarize(delays, 0));

/** The trust a scratch engine store gives `dir`, so the stub's session starts without the trust question. */
export const trust = (dir: string) => ({ claudeConfigDir }: { claudeConfigDir: string }) => {
  writeFileSync(join(claudeConfigDir, '.claude.json'), `${JSON.stringify({ projects: { [dir]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  writeFileSync(join(claudeConfigDir, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
};

export type CaseResult = { measures: Measures | null; run: CaseRun | null; roundTripsMs: number[] };

// The local engine start, which the resume bound's allowance reads: in the page, from just before `session.start` is
// invoked to the `session.status` event that first says `ready`, less the most a renderer-to-main hop each way can add
// (the largest of ten main-owned round trips just before), so an observation delay only ever narrows the allowance.
async function localEngineStart(page: Page, id: AppSessionId, message: string): Promise<number> {
  const timed = await page.evaluate(async ({ appSessionId, content, within }) => {
    const hops: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const at = performance.now();
      await window.maws.invoke('machines.list' as never, undefined as never);
      hops.push(performance.now() - at);
    }
    let ready: number | null = null;
    const off = window.maws.on('session.status', (payload) => {
      const p = payload as { appSessionId: string; status: { process: string } };
      if (ready === null && p.appSessionId === appSessionId && p.status.process === 'ready') ready = performance.now();
    });
    const at = performance.now();
    const answer = await window.maws.invoke('session.start', { appSessionId: appSessionId as never, message: { content, display: content }, options: { gateway: 'direct' } });
    const deadline = at + within;
    while (ready === null && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    off();
    return { answer: answer.ok ? (answer.value as { status: string }).status : `${answer.error.code}: ${answer.error.message}`, observedMs: ready === null ? null : ready - at, hopMs: Math.max(...hops) };
  }, { appSessionId: id as string, content: message, within: TURN_MS });
  expect(timed.answer, 'the local session starts').toBe('starting');
  expect(timed.observedMs, 'the local session comes ready within 60 s').not.toBeNull();
  return engineStartOf(timed.observedMs!, timed.hopMs);
}

/** Every cleanup attempted whatever the ones before it threw; the first failure thrown after the last. */
export async function cleanupAll(steps: readonly (() => unknown)[]): Promise<void> {
  let first: unknown = null;
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      first ??= error;
    }
  }
  if (first !== null) throw first;
}

// The local case, on its own scratch profile under `root`.
export async function localCase(root: string): Promise<CaseResult & { engineStartMs: number }> {
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
    const engineStartMs = await localEngineStart(page, id, prompt(1));
    await expect.poll(() => writtenOf(samples).length, { timeout: TURN_MS }).toBe(BENCH.markersPerTurn);
    await expect.poll(async () => (await status())?.turn === null, { timeout: TURN_MS }).toBe(true);
    const row = await sidebarRow(page, { appSessionId: id });
    const openToFirstRowMs = await openToFirstRow(page, row);
    await page.mouse.move(700, 20);
    const { run, delays } = await measureTurns(page, () => writtenOf(samples), {
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
export async function raw<T>(page: Page, name: string, input: unknown): Promise<T> {
  const result = await page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const);
  if (!(result as { ok: boolean }).ok) throw new Error(`${name}: ${JSON.stringify((result as { error: unknown }).error)}`);
  return (result as { value: T }).value;
}
export const linkOf = async (page: Page, ref: MachineRef) => (await raw<{ machines: MachineState[] }>(page, 'machines.list', undefined)).machines.find((m) => m.ref === ref);

// The link's own exchanges: `count` pings through main's bench seam, each answered with its four stamps (the unanswered
// left out).
export async function pings(app: ElectronApplication, ref: MachineRef, count: number = REMOTE_BENCH.pings): Promise<Exchange[]> {
  const answers = await app.evaluate(async (_electron, [machine, n]) => {
    const seam = (globalThis as { __maws_remote_bench?: { ping(ref: string, count: number): Promise<unknown[]> } }).__maws_remote_bench;
    if (!seam) throw new Error('no remote bench seam in main (MAWS_E2E=1, unpackaged)');
    return seam.ping(machine, n);
  }, [ref, count] as const);
  return (answers as (Exchange | null)[]).filter((a): a is Exchange => a !== null);
}
export const probe = (app: ElectronApplication, ref: MachineRef) =>
  app.evaluate((_electron, machine) => (globalThis as { __maws_remote_bench?: { probe(ref: string, reason: string): void } }).__maws_remote_bench!.probe(machine, 'network'), ref);
