// The transcript harness end to end (C6). `anchoring` is G1, the anchoring spike (acceptance item 1): a five-hundred-turn
// synthetic transcript streams its last turn at sixty delta batches a second while the reader, scrolled far up, expands
// old work; the reader must not be moved, frames must hold, and "Jump to latest" must resume follow mode.
// Runs only under `pnpm e2e:transcript`, which builds with MAWS_HARNESS=1 first (playwright.config.ts).
import { expect, test as base, type Page } from '@playwright/test';
import type { HarnessApi, HarnessMetrics } from '../src/renderer/src/harness/api';
import { launchMaws, type MawsLaunch } from './support/launch';

const test = base.extend<{ harness: MawsLaunch }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
  harness: async ({}, use) => {
    const maws = await launchMaws({ env: { MAWS_HARNESS: '1' } });
    try {
      await use(maws);
    } finally {
      await maws.cleanup();
    }
  },
});

type HarnessWindow = Window & { __maws_harness: HarnessApi };
const TURN = 120;
const STREAM_WINDOW_MS = 10_000;
const WARMUP_MS = 500;

async function harnessReady(page: Page) {
  await page.waitForFunction(() => (window as unknown as Partial<HarnessWindow>).__maws_harness !== undefined);
}

// The harness window opens on the owner's desktop, where a trackpad or keyboard can reach it mid-run (observed: a
// momentum scroll with no scroll call from the app moved the list during the window). The spike measures what the
// app does, so physical scroll input is blocked for the test and counted in its report. Playwright's own clicks are
// not wheel or key events and pass.
async function blockHumanInput(page: Page) {
  await page.evaluate(() => {
    const counter = window as unknown as { __blockedInput: number };
    counter.__blockedInput = 0;
    const block = (event: Event) => {
      counter.__blockedInput += 1;
      event.preventDefault();
    };
    for (const type of ['wheel', 'keydown', 'touchmove']) window.addEventListener(type, block, { capture: true, passive: false });
  });
}

const metrics = (page: Page): Promise<HarnessMetrics> => page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness.metrics());

// Waits until the list's height and the watched cells' positions have not changed for `quietMs` (async highlighting,
// diagrams and fonts settle), so the stream window measures the stream and nothing else.
async function settle(page: Page, quietMs = 1000) {
  await page.evaluate(async (quiet) => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    const snapshot = () =>
      [scroller.scrollHeight, scroller.scrollTop, ...Array.from(document.querySelectorAll('[data-cell-id][data-expanded]')).map((cell) => cell.getBoundingClientRect().top)].join(',');
    let last = snapshot();
    let since = performance.now();
    const deadline = performance.now() + 15_000;
    while (performance.now() - since < quiet) {
      if (performance.now() > deadline) throw new Error('the list did not settle within 15 s');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const now = snapshot();
      if (now !== last) {
        last = now;
        since = performance.now();
      }
    }
  }, quietMs);
}

const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)] ?? 0;
const round = (value: number) => Math.round(value * 10) / 10;

test('anchoring: 500 turns stream while old work is expanded', async ({ harness }) => {
  test.setTimeout(120_000);
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);

  const loaded = await page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness.load('synthetic/500'));
  expect(loaded.ms, 'synthetic/500 loads in under three seconds').toBeLessThan(3000);

  // Stream the last turn in view, following, then move away to turn 120.
  await page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness.play(1));
  await page.waitForTimeout(1500);
  expect((await metrics(page)).following, 'following while the stream is in view').toBe(true);
  await page.evaluate((turn) => (window as unknown as HarnessWindow).__maws_harness.scrollToTurn(turn), TURN);
  await settle(page, 500);
  await page.evaluate((turn) => (window as unknown as HarnessWindow).__maws_harness.expandTurn(turn), TURN);
  await settle(page, 500);

  // One group of turn 120 with at least two cells, and two of its cell details.
  const group = page.locator(`[data-turn="${TURN}"][data-kind="group"]`).filter({ hasText: /\d+ tool calls/ }).first();
  await group.getByRole('button', { expanded: false }).first().click();
  const cellButtons = group.locator('[data-cell-id] > button');
  await cellButtons.nth(0).click();
  await cellButtons.nth(1).click();
  await expect(group.locator('[data-cell-id][data-expanded]')).toHaveCount(2);
  await settle(page);
  expect((await metrics(page)).following, 'reading turn 120 breaks follow mode').toBe(false);

  // The stream window: sample every frame for ten seconds.
  const before = await metrics(page);
  const window10s = await page.evaluate(async (durationMs) => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    const cells = Array.from(document.querySelectorAll('[data-cell-id][data-expanded]'));
    const baseTop = scroller.scrollTop;
    const baseRects = cells.map((cell) => cell.getBoundingClientRect().top);
    let scrollDelta = 0;
    let drift = 0;
    let domRows = 0;
    const started = performance.now();
    while (performance.now() - started < durationMs) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      scrollDelta = Math.max(scrollDelta, Math.abs(scroller.scrollTop - baseTop));
      cells.forEach((cell, i) => (drift = Math.max(drift, Math.abs(cell.getBoundingClientRect().top - baseRects[i]))));
      domRows = Math.max(domRows, scroller.querySelectorAll('[data-index]').length);
    }
    return { scrollDelta, drift, domRows, connected: cells.every((cell) => cell.isConnected) };
  }, STREAM_WINDOW_MS);
  const after = await metrics(page);

  const intervals = after.frameIntervals.slice(before.frameIntervals.length);
  let elapsed = 0;
  const measured = intervals.filter((interval) => (elapsed += interval) > WARMUP_MS);
  const framesP95 = p95(measured);
  const framesMax = Math.max(...measured);
  const batches = after.batches - before.batches;
  const longTasks = after.longTasks.slice(before.longTasks.length);
  const report = {
    framesP95: round(framesP95), framesMax: round(framesMax), frames: measured.length, drift: round(window10s.drift), scrollDelta: window10s.scrollDelta,
    domRows: window10s.domRows, rows: after.rows, batches, loadMs: Math.round(loaded.ms), events: loaded.events, longTasks: longTasks.map((task) => round(task.duration)),
    deriveMs: round(after.deriveMs), lastBatchMs: round(after.lastBatchMs),
    blockedInput: await page.evaluate(() => (window as unknown as { __blockedInput: number }).__blockedInput),
  };
  console.log(`anchoring: ${JSON.stringify(report)}`);
  test.info().annotations.push({ type: 'anchoring', description: JSON.stringify(report) });

  expect(batches, 'the stream ran at about sixty batches a second throughout the window').toBeGreaterThanOrEqual(540);
  expect(window10s.connected, 'the expanded cells stayed mounted').toBe(true);
  expect(window10s.scrollDelta, 'scrollTop did not change').toBe(0);
  expect(window10s.drift, 'the expanded cell drifted at most 1 px').toBeLessThanOrEqual(1);
  expect(framesP95, 'frame interval p95 after the first 500 ms').toBeLessThanOrEqual(17);
  expect(framesMax, 'frame interval max after the first 500 ms').toBeLessThanOrEqual(50);
  expect(window10s.domRows, 'DOM rows').toBeLessThanOrEqual(40);

  // Jump to latest lands at the end and follow mode resumes: the next batches keep the end pinned.
  await page.getByRole('button', { name: 'Jump to latest' }).click();
  const distanceFromEnd = () =>
    page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
      return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    });
  await expect.poll(distanceFromEnd, { message: 'Jump to latest lands within 80 px of the end' }).toBeLessThanOrEqual(80);
  const pinned = await metrics(page);
  await expect.poll(async () => (await metrics(page)).batches, { message: 'more batches arrive' }).toBeGreaterThan(pinned.batches + 30);
  expect(await distanceFromEnd(), 'the end stays pinned as batches arrive').toBeLessThanOrEqual(80);
  expect((await metrics(page)).following, 'follow mode resumed').toBe(true);

  // Reported, not asserted (knowledge for the spike's verdict): frames while the stream renders in view, and over the
  // whole run from play (the jump to turn 120 and the expansions included).
  await page.waitForTimeout(3000);
  const end = await metrics(page);
  const inView = end.frameIntervals.slice(pinned.frameIntervals.length);
  let sincePlay = 0;
  const run = end.frameIntervals.filter((interval) => (sincePlay += interval) > WARMUP_MS);
  const context = {
    inViewP95: round(p95(inView)), inViewMax: round(Math.max(...inView)), runP95: round(p95(run)), runMax: round(Math.max(...run)),
    longTasks: end.longTasks.map((task) => round(task.duration)), stillPinned: (await distanceFromEnd()) <= 80,
  };
  console.log(`anchoring context: ${JSON.stringify(context)}`);
  test.info().annotations.push({ type: 'anchoring context', description: JSON.stringify(context) });
  expect(harness.consoleErrors()).toEqual([]);
});
