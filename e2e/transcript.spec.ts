// The transcript harness end to end (C6), over the real model and row components. `anchoring` is G1, the anchoring
// spike (acceptance item 1): a five-hundred-turn synthetic transcript streams its last turn at sixty delta batches a
// second while the reader, scrolled far up, expands old work; the reader must not be moved, frames must hold, and
// "Jump to latest" must resume follow mode. The others pin follow mode, the divider collapse and the theme switch.
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
// momentum scroll with no scroll call from the app moved the list during the window). These tests measure what the
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
const load = (page: Page, fixture: string) => page.evaluate((name) => (window as unknown as HarnessWindow).__maws_harness.load(name), fixture);
const play = (page: Page, speed: number) => page.evaluate((value) => (window as unknown as HarnessWindow).__maws_harness.play(value), speed);
const turnIdOf = (page: Page, n: number) => page.evaluate((turn) => (window as unknown as HarnessWindow).__maws_harness.turnId(turn), n);
const scrollerTop = (page: Page) => page.evaluate(() => document.querySelector<HTMLElement>('[data-transcript-scroller]')!.scrollTop);
const distanceFromEnd = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
  });
// A list row by its X3 id.
const rowSelector = (rowId: string) => `[data-row-id="${rowId}"]`;

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

// Scrolls to turn 120 and opens its work area.
async function openTurn(page: Page) {
  await page.evaluate((turn) => (window as unknown as HarnessWindow).__maws_harness.scrollToTurn(turn), TURN);
  await settle(page, 500);
  await page.evaluate((turn) => (window as unknown as HarnessWindow).__maws_harness.expandTurn(turn), TURN);
  await settle(page, 500);
  return turnIdOf(page, TURN);
}

const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)] ?? 0;
const round = (value: number) => Math.round(value * 10) / 10;

test('anchoring: 500 turns stream while old work is expanded', async ({ harness }) => {
  test.setTimeout(120_000);
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);

  const loaded = await load(page, 'synthetic/500');
  expect(loaded.ms, 'synthetic/500 loads in under three seconds').toBeLessThan(3000);

  // Stream the last turn in view, following, then move away to turn 120.
  await play(page, 1);
  await page.waitForTimeout(1500);
  expect((await metrics(page)).following, 'following while the stream is in view').toBe(true);
  const turnId = await openTurn(page);

  // One group of turn 120 with at least two cells, and two of its cell details.
  const groupRowId = await page.evaluate((id) => {
    const groups = Array.from(document.querySelectorAll(`[data-kind="group"][data-turn-id="${id}"]`));
    const group = groups.find((element) => Number(element.querySelector('[data-cell-count]')?.getAttribute('data-cell-count')) >= 2);
    return group?.closest('[data-row-id]')?.getAttribute('data-row-id') ?? null;
  }, turnId);
  expect(groupRowId, `turn ${TURN} shows a group of at least two cells`).not.toBeNull();
  const group = page.locator(rowSelector(groupRowId!));
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
  await expect.poll(() => distanceFromEnd(page), { message: 'Jump to latest lands within 80 px of the end' }).toBeLessThanOrEqual(80);
  const pinned = await metrics(page);
  await expect.poll(async () => (await metrics(page)).batches, { message: 'more batches arrive' }).toBeGreaterThan(pinned.batches + 30);
  expect(await distanceFromEnd(page), 'the end stays pinned as batches arrive').toBeLessThanOrEqual(80);
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
    longTasks: end.longTasks.map((task) => round(task.duration)), stillPinned: (await distanceFromEnd(page)) <= 80,
  };
  console.log(`anchoring context: ${JSON.stringify(context)}`);
  test.info().annotations.push({ type: 'anchoring context', description: JSON.stringify(context) });
  expect(harness.consoleErrors()).toEqual([]);
});

test('follow mode breaks on scroll-up and Jump to latest restores it', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await load(page, 'synthetic/500');
  await play(page, 1);
  await page.waitForTimeout(1000);
  expect((await metrics(page)).following, 'following at the end while streaming').toBe(true);
  const jump = page.getByRole('button', { name: /^Jump to latest/ });
  await expect(jump).toHaveCount(0);

  // Scrolling up 200 px during streaming leaves follow mode and shows the control; the stream no longer moves the reader.
  await page.evaluate(() => document.querySelector<HTMLElement>('[data-transcript-scroller]')!.scrollBy(0, -200));
  await expect.poll(async () => (await metrics(page)).following, { message: 'a scroll up leaves follow mode' }).toBe(false);
  await expect(jump).toBeVisible();
  const readingAt = await scrollerTop(page);
  await page.waitForTimeout(500);
  expect(await scrollerTop(page), 'the stream does not move a reader').toBe(readingAt);

  await jump.click();
  await expect.poll(() => distanceFromEnd(page), { message: 'Jump to latest lands at the end' }).toBeLessThanOrEqual(80);
  await expect.poll(async () => (await metrics(page)).following, { message: 'follow mode resumes' }).toBe(true);
  await expect(jump).toHaveCount(0);
  const batches = (await metrics(page)).batches;
  await expect.poll(async () => (await metrics(page)).batches).toBeGreaterThan(batches + 30);
  expect(await distanceFromEnd(page), 'the end stays pinned as batches arrive').toBeLessThanOrEqual(80);
  expect(harness.consoleErrors()).toEqual([]);
});

test('collapsing a divider keeps its position', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await load(page, 'synthetic/500');
  const turnId = await openTurn(page);
  const divider = page.locator(rowSelector(`divider:${turnId}`));
  const toggle = divider.locator('button[aria-expanded]').first();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const rowsOpen = (await metrics(page)).rows;
  const top = await divider.evaluate((element) => element.getBoundingClientRect().top);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await settle(page, 500);
  expect((await metrics(page)).rows, 'the work-area rows left the list').toBeLessThan(rowsOpen);
  const workRows = page.locator(`[data-turn-id="${turnId}"][data-kind="group"], [data-turn-id="${turnId}"][data-kind="cell"]`);
  expect(await workRows.count(), 'no work-area row of the turn is rendered').toBe(0);
  const after = await divider.evaluate((element) => element.getBoundingClientRect().top);
  expect(Math.abs(after - top), 'the divider did not move').toBeLessThanOrEqual(1);
  expect(harness.consoleErrors()).toEqual([]);
});

test('theme switch re-themes highlighted code without reload', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  await load(page, 'transcript/edit-and-receipt');
  await play(page, 0);
  // A highlighted token of the answer's fenced code block: Shiki paints both themes through CSS variables and the
  // `dark:` variant (app.css) picks one by `data-theme`.
  await expect(page.locator('[data-streamdown="code-block"] pre span[style*="--shiki-dark"]').first()).toBeVisible();
  // One whose two themes differ (github-light and github-dark share some colours, comments among them).
  const marked = await page.evaluate(() => {
    const tokens = Array.from(document.querySelectorAll<HTMLElement>('[data-streamdown="code-block"] pre span[style*="--shiki-dark"]'));
    const differing = tokens.find((span) => span.style.getPropertyValue('--shiki-dark').toLowerCase() !== span.style.getPropertyValue('--sdm-c').toLowerCase());
    differing?.setAttribute('data-theme-probe', '');
    return differing !== undefined;
  });
  expect(marked, 'the code block has a token whose light and dark colours differ').toBe(true);
  const token = page.locator('[data-theme-probe]');
  const colour = () => token.evaluate((element) => getComputedStyle(element).color);
  const light = await colour();
  const navigations = await page.evaluate(() => performance.getEntriesByType('navigation').length);
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);

  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await expect.poll(colour, { message: 'the token takes its dark colour' }).not.toBe(light);
  // The dark colour is the one Shiki assigned the token for the dark theme.
  const expected = await token.evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.color = (element as HTMLElement).style.getPropertyValue('--shiki-dark');
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  expect(await colour()).toBe(expected);
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length), 'no navigation').toBe(navigations);
  expect(await page.evaluate(() => performance.timeOrigin), 'no reload').toBe(timeOrigin);

  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  await expect.poll(colour, { message: 'and back' }).toBe(light);
  expect(harness.consoleErrors()).toEqual([]);
});
