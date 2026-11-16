// The transcript harness end to end (C6), over the real model and row components. `anchoring` is G1, the anchoring
// spike (acceptance item 1): a five-hundred-turn synthetic transcript streams its last turn at sixty delta batches a
// second while the reader, scrolled far up, expands old work; the reader must not be moved, frames must hold, and
// "Jump to latest" must resume follow mode. The others pin follow mode, the divider collapse, the theme switch, the
// denial jump (acceptance item 4), the child transcript (acceptance item 9) and expanded old work over every fixture.
// R1 adds one case in the product app: a mod's pushes (pass3/mods-pushes) replayed through C3's replay transport into a
// session tab, showing its toast, its log lines in the transcript and its status line in the panel summary.
// UX wave U2b adds the to-human view where MAWS draws it: over the harness's synthetic session in that view, the fold by
// stretch, its record lines and a jump into a closed record, and the anchoring bound of 40 mounted rows there; and,
// in the product app, the report scene redrawn as that view, with its switch above the composer.
// Runs only under `pnpm e2e:transcript`, which builds with MAWS_HARNESS=1 first (playwright.config.ts).
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import type { HarnessApi, HarnessMetrics, HarnessQuestion } from '../src/renderer/src/harness/api';
import { thinkingTier } from '../src/renderer/src/transcript/model/copy'; // decision 17: the tiers' words live in the copy only
import { addressed } from './support/address';
import { withNativeClipboard } from './support/clipboard';
import { invoke, launchReady, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { rowOf } from './support/request-keys';
import { sidebarRow } from './support/sidebar';
import { unfoldSessionCard } from './support/shell';
import { addSurfaceSeedEchoes, ownerMarkedText, r3Output, r3Question, recordedSurfaceJournal, recordedSurfaceSessionId, sittingSeed, transcriptSeed } from '../test/support/r3-surface';

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
// The anchoring case's wall-clock and frame budgets (the load, the stream's rate, frame p95 and max) are measured bounds,
// class 2 of the gate-offload spec (§3.1, §8): asserted only under MAWS_TRANSCRIPT_PERF=1, on the quiet Mac under the
// load rule, which the gate never sets. Without it the case keeps its anchoring invariants and reports the numbers.
// The frame budget is one 60 Hz display's: the Mac mini's virtual display paces frames at 18.4 ms with no long task.
const MEASURED = process.env.MAWS_TRANSCRIPT_PERF === '1';

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

// UX wave U2 (O-29): a run of calls is one folded line until the reader opens it. Opens, in the turn, the first run whose
// body draws at least `calls` calls (folding again each one it opened that draws fewer), lets its motion end, and
// returns its row id; null when the turn has none.
async function openRunOf(page: Page, turnId: string, calls = 2): Promise<string | null> {
  const runs = page.locator(`[data-kind="group"][data-turn-id="${turnId}"]`);
  const count = await runs.count();
  for (let i = 0; i < count; i += 1) {
    const run = runs.nth(i);
    if (Number(await run.locator('.transcript-group').getAttribute('data-cell-count')) < calls) continue;
    const line = run.locator('.transcript-run-line');
    await line.click();
    await expect(line).toHaveAttribute('aria-expanded', 'true');
    if ((await run.locator('.transcript-tool-block [data-cell-id]').count()) >= calls) {
      await settle(page, 500);
      return run.evaluate((element) => element.closest('[data-row-id]')?.getAttribute('data-row-id') ?? null);
    }
    await line.click();
    await expect(line).toHaveAttribute('aria-expanded', 'false');
  }
  return null;
}

// Opens every folded run drawn in `scope`.
async function openEveryRun(scope: Page | Locator) {
  const folded = scope.locator('.transcript-run-line[aria-expanded="false"]');
  for (let guard = 0; guard < 20 && (await folded.count()) > 0; guard += 1) await folded.first().click();
  await expect(folded).toHaveCount(0);
}

const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)] ?? 0;
const round = (value: number) => Math.round(value * 10) / 10;

test('anchoring: 500 turns stream while old work is expanded', async ({ harness }) => {
  test.setTimeout(120_000);
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);

  const loaded = await load(page, 'synthetic/500');
  if (MEASURED) expect(loaded.ms, 'synthetic/500 loads in under three seconds').toBeLessThan(3000);

  // Stream the last turn in view, following, then move away to turn 120.
  await play(page, 1);
  await page.waitForTimeout(1500);
  expect((await metrics(page)).following, 'following while the stream is in view').toBe(true);
  const turnId = await openTurn(page);

  // One run of turn 120 with at least two calls, opened (UX wave U2: a run is folded until the reader opens it), and two
  // of its call details.
  const groupRowId = await openRunOf(page, turnId);
  expect(groupRowId, `turn ${TURN} shows a run of at least two calls`).not.toBeNull();
  const group = page.locator(rowSelector(groupRowId!));
  const cellButtons = group.locator('.transcript-tool-block [data-cell-id] > button');
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

  expect(batches, 'the stream ran throughout the window').toBeGreaterThan(0);
  expect(window10s.connected, 'the expanded cells stayed mounted').toBe(true);
  expect(window10s.scrollDelta, 'scrollTop did not change').toBe(0);
  expect(window10s.drift, 'the expanded cell drifted at most 1 px').toBeLessThanOrEqual(1);
  expect(window10s.domRows, 'DOM rows').toBeLessThanOrEqual(40);
  if (MEASURED) {
    expect(batches, 'the stream ran at about sixty batches a second throughout the window').toBeGreaterThanOrEqual(540);
    expect(framesP95, 'frame interval p95 after the first 500 ms').toBeLessThanOrEqual(17);
    expect(framesMax, 'frame interval max after the first 500 ms').toBeLessThanOrEqual(50);
  }

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

// UX wave U2b (A18): the same five hundred turns in the to-human view where MAWS draws it (`synthetic/500/report`: the
// lane on, each turn's final answer a message, the last one streaming), so no turn folds and the list holds every
// turn's rows, the mirror folding each stretch of work to one line. Far up the history, with one record opened, the
// list mounts at most 40 rows while the last turn streams below. A count, never a time: the measured half of the
// anchoring spike stays the lane-off case's above.
test('the mirrored view mounts at most 40 rows while 500 turns stream', async ({ harness }) => {
  test.setTimeout(120_000);
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await load(page, 'synthetic/500/report');
  const list = page.locator('[data-transcript-scroller]');
  await play(page, 1);
  await page.waitForTimeout(1500);
  // In force: the work between the messages is folded to record lines, and no turn's line offers a fold of its own (its
  // disclosure; the line keeps its summary's trigger, `Turn summary`, as `TurnLine` in `Divider.tsx` draws it).
  await expect(list.locator('[data-row-id^="record-fold:closed:"]').first()).toBeAttached();
  await expect(list.locator('.transcript-divider .transcript-disclosure')).toHaveCount(0);

  // Far up, one stretch opened onto its rows.
  await page.evaluate((turn) => (window as unknown as HarnessWindow).__maws_harness.scrollToTurn(turn), TURN);
  await settle(page, 500);
  const shown = await list.evaluate((scroller) => {
    const top = scroller.getBoundingClientRect().top;
    const bottom = scroller.getBoundingClientRect().bottom;
    const lines = Array.from(scroller.querySelectorAll<HTMLElement>('[data-row-id^="record-fold:closed:"]'));
    return lines.find((line) => line.getBoundingClientRect().top >= top && line.getBoundingClientRect().bottom <= bottom)?.getAttribute('data-row-id') ?? null;
  });
  expect(shown, 'a closed record line in view far up the history').not.toBeNull();
  const stretch = shown!.slice('record-fold:closed:'.length);
  await list.locator(rowSelector(shown!)).getByRole('button').click();
  await expect(list.locator(rowSelector(`record-fold:open:${stretch}`)).getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  await settle(page);

  // The stream window: the most rows mounted in any frame of ten seconds.
  const before = await metrics(page);
  const streamWindow = await page.evaluate(async (durationMs) => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    let most = 0;
    const started = performance.now();
    while (performance.now() - started < durationMs) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      most = Math.max(most, scroller.querySelectorAll('[data-index]').length);
    }
    return { domRows: most };
  }, STREAM_WINDOW_MS);
  const after = await metrics(page);
  console.log(`mirrored anchoring: ${JSON.stringify({ domRows: streamWindow.domRows, rows: after.rows, batches: after.batches - before.batches })}`);
  test.info().annotations.push({ type: 'mirrored anchoring', description: JSON.stringify({ domRows: streamWindow.domRows, rows: after.rows, batches: after.batches - before.batches }) });
  expect(after.batches - before.batches, 'the stream ran during the window').toBeGreaterThan(0);
  await expect.poll(async () => (await metrics(page)).batches, { message: 'the stream still runs at the window’s end' }).toBeGreaterThan(after.batches);
  expect(streamWindow.domRows, 'DOM rows').toBeLessThanOrEqual(40);
  expect(harness.consoleErrors()).toEqual([]);
});

// UX wave U2b (A13): the to-human view where MAWS draws it, over the synthetic session in that view
// (`synthetic/20/report`; the harness's unit suite pins that the fifth turn's first text is commentary inside a
// stretch). Each stretch of work is one closed `› working record` line; a press opens it onto the plain transcript's
// rows, with its turn's line (no chevron) and `‹ fold to report` under its last row, and hands focus to that line; a
// press there folds it again. A jump to a row inside a closed record opens that record and lands on the row.
test('the to-human view folds by stretch, opens, folds again, and a jump opens the record that holds its target', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await load(page, 'synthetic/20/report');
  const list = page.locator('[data-transcript-scroller]');
  // The reader goes to the first turn, out of follow mode, so a stretch opening grows below them.
  await list.evaluate((el) => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); el.scrollTop = 0; });
  await settle(page, 500);
  const WORK = '[data-kind="group"], [data-kind="cell"], [data-kind="thinking"]';
  const closedLines = list.locator('[data-row-id^="record-fold:closed:"]');
  const openLines = list.locator('[data-row-id^="record-fold:open:"]');

  // Folded: messages in sight, each stretch of work one line, no work mounted, no turn's line (the running turn's is at
  // the end, out of the mounted range) and no turn's fold.
  await expect(closedLines.first().getByRole('button')).toHaveText('› working record');
  await expect(closedLines.first().getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  await expect(openLines).toHaveCount(0);
  await expect(list.locator('.owner-message-ink > .owner-message-label').first()).toHaveText('● message');
  await expect(list.locator(WORK)).toHaveCount(0);
  await expect(list.locator('[data-kind="divider"]')).toHaveCount(0);
  await expect(list.locator('.transcript-divider .transcript-disclosure')).toHaveCount(0);

  // Opened: the stretch's rows as the plain transcript draws them, its turn's line with no chevron, the other line under
  // its last row, focused.
  const first = (await closedLines.first().getAttribute('data-row-id'))!;
  const stretch = first.slice('record-fold:closed:'.length);
  await list.locator(rowSelector(first)).getByRole('button').click();
  const openLine = list.locator(rowSelector(`record-fold:open:${stretch}`)).getByRole('button');
  await expect(openLine).toHaveText('‹ fold to report');
  await expect(openLine).toHaveAttribute('aria-expanded', 'true');
  await expect(openLine).toBeFocused();
  await expect(list.locator(rowSelector(first))).toHaveCount(0);
  await expect.poll(() => list.locator(WORK).count(), { message: 'the stretch’s work is drawn' }).toBeGreaterThan(0);
  await expect.poll(() => list.locator('[data-kind="divider"]').count(), { message: 'its turn’s line is drawn' }).toBeGreaterThan(0);
  await expect(list.locator('.transcript-divider .transcript-disclosure')).toHaveCount(0);

  // Folded again: the closed line back in its place, focused, the work gone.
  await openLine.click();
  const closedLine = list.locator(rowSelector(first)).getByRole('button');
  await expect(closedLine).toHaveAttribute('aria-expanded', 'false');
  await expect(closedLine).toBeFocused();
  await expect(openLines).toHaveCount(0);
  await expect(list.locator(WORK)).toHaveCount(0);
  await expect(list.locator('[data-kind="divider"]')).toHaveCount(0);

  // A jump to the fifth turn's commentary, which a closed record holds: the record opens and the jump lands on the row.
  const h = '__maws_harness';
  const target = await page.evaluate(([key, turn]) => (window as unknown as Record<string, HarnessApi>)[key]!.rowOfText(turn), [h, 5] as const);
  expect(target, 'the fifth turn’s first text is loaded').not.toBeNull();
  await expect(list.locator(rowSelector(target!))).toHaveCount(0);
  await page.evaluate(([key, turn]) => (window as unknown as Record<string, HarnessApi>)[key]!.reach(turn), [h, 5] as const);
  const text = list.locator(rowSelector(target!)).locator('[data-kind="assistant_text"]').first();
  await expect(text).toBeFocused();
  await expect(text.locator('.owner-message-ink')).toHaveCount(0); // commentary, drawn as the plain transcript draws it
  // Its record is the one open: its line follows the target with no closed line between, and the view is still the report.
  await expect(openLines).toHaveCount(1);
  await expect(openLines.getByRole('button')).toHaveText('‹ fold to report');
  await expect(openLines.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  const order = await list.evaluate((scroller, id) => {
    const row = scroller.querySelector(`[data-row-id="${CSS.escape(id)}"]`);
    const open = scroller.querySelector('[data-row-id^="record-fold:open:"]');
    const after = (el: Element | null) => !!row && !!el && (row.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const between = Array.from(scroller.querySelectorAll('[data-row-id^="record-fold:closed:"]')).filter((line) => after(line) && open && (line.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    return { follows: after(open), closedBetween: between.length };
  }, target!);
  expect(order, 'the target’s record is the open one').toEqual({ follows: true, closedBetween: 0 });
  // Still the report: the other stretches stay folded (the full transcript draws no record line). The harness mounts a
  // transcript and no composer, so no view switch stands here; the app's report scene reads the switch.
  await expect.poll(() => closedLines.count(), { message: 'the other stretches stay folded' }).toBeGreaterThan(0);
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
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 }));
    scroller.scrollBy(0, -200);
  });
  await expect.poll(async () => (await metrics(page)).following, { message: 'a scroll up leaves follow mode' }).toBe(false);
  await expect(jump).toBeVisible();
  // W2 (B3): Codex's round 32px button, right of the column, never over the prose of a pane with room for it
  const button = (await jump.boundingBox())!;
  const column = (await page.locator('.transcript-row').first().boundingBox())!;
  expect([button.width, button.height]).toEqual([32, 32]);
  await expect(jump).toHaveCSS('border-radius', '50%');
  expect(button.x, 'the button sits right of the column').toBeGreaterThanOrEqual(column.x + column.width);
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

// P4-TF (2026-10-25): a follower sees the end in every frame the streamed answer grows in. The last row's content
// overflows the list's sizer the moment it grows, and the sizer's height commits a frame or two later; the end used to
// wait for that commit, so a reader saw it 20 to 212 px away for two frames at a time. What a frame paints is read in a
// ResizeObserver created after the list's own: the observers of one rendering step are delivered in the order they were
// created, so it reads each step after the list has followed and before the frame paints. A read between frames (a
// rAF, or a test's own page.evaluate) can still land after a commit and before the next step, a state no frame paints:
// those are reported, not asserted.
test('a follower is at the end in every frame the streamed answer grows in', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await load(page, 'synthetic/500');
  await play(page, 1);
  await page.waitForTimeout(1000);
  expect((await metrics(page)).following, 'following at the end while streaming').toBe(true);
  const before = await metrics(page);
  const seen = await page.evaluate(async (durationMs) => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    const away = () => scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    const painted: number[] = [];
    let grew = 0;
    let height = scroller.scrollHeight;
    const observer = new ResizeObserver(() => {
      if (scroller.scrollHeight > height) grew += 1;
      height = scroller.scrollHeight;
      painted.push(away());
    });
    const watched = new WeakSet<Element>();
    const watch = () => {
      for (const row of Array.from(scroller.querySelectorAll('[data-index]'))) {
        if (watched.has(row)) continue;
        watched.add(row);
        observer.observe(row);
      }
    };
    watch();
    const rows = new MutationObserver(watch);
    rows.observe(scroller, { childList: true, subtree: true });
    const betweenFrames: number[] = [];
    const started = performance.now();
    while (performance.now() - started < durationMs) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      betweenFrames.push(away());
    }
    observer.disconnect();
    rows.disconnect();
    const over = (values: number[], px: number) => values.filter((value) => value > px).length;
    return {
      steps: painted.length, grew, paintedMax: Math.max(0, ...painted), paintedOver1: over(painted, 1),
      rafFrames: betweenFrames.length, rafMax: Math.max(0, ...betweenFrames), rafOver1: over(betweenFrames, 1), rafOver80: over(betweenFrames, 80),
    };
  }, 5000);
  const after = await metrics(page);
  console.log(`follow frames: ${JSON.stringify({ ...seen, batches: after.batches - before.batches })}`);
  test.info().annotations.push({ type: 'follow frames', description: JSON.stringify(seen) });
  expect(after.batches - before.batches, 'the stream ran throughout').toBeGreaterThan(100);
  expect(seen.grew, 'the streamed answer grew').toBeGreaterThan(20);
  expect(seen.paintedMax, 'no painted frame leaves a follower away from the end').toBeLessThanOrEqual(1);
  expect(after.following, 'still following').toBe(true);
  expect(harness.consoleErrors()).toEqual([]);
});

// P2-C (2026-10-09): a viewport that shrinks with no scroll is not a scroll upward, even right after the browser clamped
// the offset upward as the viewport grew (a permission card leaving the composer, then the ask notice growing it): the
// follower stays in follow mode and the end in view, however far past the 80 px threshold the shrink moves it.
test('a viewport that grows and then shrinks with no scroll keeps a follower at the end', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await load(page, 'synthetic/500');
  await settle(page, 500);
  expect((await metrics(page)).following, 'following at the end').toBe(true);
  await page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    const frames = async (n: number) => {
      for (let k = 0; k < n; k++) await new Promise((resolve) => requestAnimationFrame(resolve));
    };
    const full = scroller.clientHeight;
    scroller.style.height = '120px'; // shrinks: the follower is kept at the end
    await frames(3);
    scroller.style.height = `${full}px`; // grows: the browser clamps the offset upward, at the end
    await frames(2);
    scroller.style.height = '120px'; // shrinks again before that scroll settles, by more rows than the overscan
  });
  await expect.poll(() => distanceFromEnd(page), { message: 'the end is kept in view' }).toBeLessThanOrEqual(1);
  expect((await metrics(page)).following, 'still following').toBe(true);
  await expect(page.getByRole('button', { name: /^Jump to latest/ })).toHaveCount(0);
  expect(harness.consoleErrors()).toEqual([]);
});

// P2-C (2026-10-09): a viewport that shrinks while a scroll is still settling, which the virtualiser need not report,
// does not hide the owner's next scroll upward: it leaves follow mode, shows the control, and the stream leaves the
// reader where they are.
test('a scroll upward after a viewport shrinks mid-scroll leaves follow mode', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await load(page, 'synthetic/500');
  await settle(page, 500);
  expect((await metrics(page)).following, 'following at the end').toBe(true);
  await page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    const frames = async (n: number) => {
      for (let k = 0; k < n; k++) await new Promise((resolve) => requestAnimationFrame(resolve));
    };
    scroller.scrollBy(0, -1); // a programmatic settling move, not reader intent; still following
    await frames(1);
    scroller.style.height = `${scroller.clientHeight - 80}px`; // shrinks while that scroll settles
    await frames(3);
    scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 }));
    scroller.scrollBy(0, -200); // the owner scrolls up
  });
  const jump = page.getByRole('button', { name: /^Jump to latest/ });
  await expect.poll(async () => (await metrics(page)).following, { message: 'the scroll up leaves follow mode' }).toBe(false);
  await expect(jump).toBeVisible();
  const readingAt = await scrollerTop(page);
  const batches = (await metrics(page)).batches;
  await play(page, 1);
  await expect.poll(async () => (await metrics(page)).batches).toBeGreaterThan(batches + 30);
  expect(await scrollerTop(page), 'the stream does not move the reader').toBe(readingAt);
  expect((await metrics(page)).following, 'still not following').toBe(false);
  await expect(jump).toBeVisible();
  expect(harness.consoleErrors()).toEqual([]);
});

// P2-C (2026-10-09): the list's own scroll to the end (a row growing under a follower) moves the offset a frame before
// its scroll event arrives; a scroll upward in that interval is measured from where the list put the reader, not from
// before, so it leaves follow mode and the stream leaves the reader where they are.
test('a scroll upward right after the list follows a row growth leaves follow mode', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await load(page, 'synthetic/500');
  await settle(page, 500);
  expect((await metrics(page)).following, 'following at the end').toBe(true);
  const offsets = await page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    // A fixed viewport, so no resize is involved; the follower's scroll to the end for this one settles first.
    scroller.style.height = `${scroller.clientHeight}px`;
    for (let k = 0; k < 5; k++) await new Promise((resolve) => requestAnimationFrame(resolve));
    // The first row mounted, above the viewport and outside the turn the stream replays; a style rule keeps it grown
    // across a remount.
    const rows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-index]'));
    const first = rows.reduce((a, b) => (Number(b.dataset.index) < Number(a.dataset.index) ? b : a));
    const before = scroller.scrollTop;
    return new Promise<{ before: number; followed: number; scrolled: number }>((resolve) => {
      // Observed after the list's own observer, so this runs in the same frame, after the list has followed the growth
      // to the end and before that scroll's event.
      const observer = new ResizeObserver(() => {
        observer.disconnect();
        const followed = scroller.scrollTop;
        scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 }));
        scroller.scrollBy(0, -200); // the owner scrolls up
        resolve({ before, followed, scrolled: scroller.scrollTop });
      });
      const grow = document.createElement('style');
      grow.textContent = `[data-row-id="${first.dataset.rowId}"] { padding-bottom: 400px; }`; // the row grows by 400 px
      document.head.append(grow);
      observer.observe(first);
    });
  });
  expect(offsets.followed, 'the list followed the growth to the end').toBeGreaterThan(offsets.before + 200);
  expect(offsets.scrolled, 'the scroll up still lands below where the list was before').toBeGreaterThan(offsets.before);
  const jump = page.getByRole('button', { name: /^Jump to latest/ });
  await expect.poll(async () => (await metrics(page)).following, { message: 'the scroll up leaves follow mode' }).toBe(false);
  await expect(jump).toBeVisible();
  const readingAt = await scrollerTop(page);
  const batches = (await metrics(page)).batches;
  await play(page, 1);
  await expect.poll(async () => (await metrics(page)).batches).toBeGreaterThan(batches + 30);
  expect(await scrollerTop(page), 'the stream does not move the reader').toBe(readingAt);
  expect((await metrics(page)).following, 'still not following').toBe(false);
  await expect(jump).toBeVisible();
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

// W8 (T3): a call detail opens and closes as Codex's disclosures do, its height running through the values between closed and
// open (300 ms opening, 150 ms closing) rather than jumping, the row below following it frame by frame and flush with it
// at the end, and its detail unmounted once it has closed.
test('a tool detail moves through its disclosure rather than jumping, and the row below follows it', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await load(page, 'synthetic/500');
  const turnId = await openTurn(page);
  const groupRowId = await openRunOf(page, turnId); // UX wave U2: the run opened first, its calls' rows drawn
  expect(groupRowId, `turn ${TURN} shows a run of at least two calls`).not.toBeNull();
  // Clicks a visible call's summary and samples, every frame for 600 ms, the row's height and the next row's top.
  const sample = () =>
    page.evaluate(async (id) => {
      const row = document.querySelector<HTMLElement>(`[data-row-id="${id}"]`)!;
      const next = () => document.querySelector<HTMLElement>(`[data-index="${Number(row.dataset.index) + 1}"]`)!;
      const before = row.getBoundingClientRect().height;
      const heights: number[] = [];
      const gaps: number[] = [];
      const started = performance.now();
      row.querySelector<HTMLElement>('.transcript-tool-block .transcript-cell-line')!.click();
      while (performance.now() - started < 600) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const box = row.getBoundingClientRect();
        heights.push(box.height);
        gaps.push(next().getBoundingClientRect().top - box.bottom);
      }
      return { before, heights, gaps, cells: row.querySelectorAll('.transcript-tool-block .transcript-cell-detail').length };
    }, groupRowId!);
  const between = (values: number[], a: number, b: number) => values.filter((value) => value > Math.min(a, b) + 1 && value < Math.max(a, b) - 1);

  const opened = await sample();
  const open = opened.heights.at(-1)!;
  console.log(`group motion, opening: ${JSON.stringify({ from: opened.before, to: open, heights: opened.heights.map(Math.round), gaps: opened.gaps.map(Math.round) })}`);
  expect(open - opened.before, 'the group opened').toBeGreaterThan(40);
  expect(between(opened.heights, opened.before, open).length, 'heights between closed and open while it opens').toBeGreaterThanOrEqual(2);
  expect(opened.heights.every((height, i) => i === 0 || height >= opened.heights[i - 1] - 1), 'it only grows').toBe(true);
  expect(Math.abs(opened.gaps.at(-1)!), 'the row below sits flush at the end').toBeLessThanOrEqual(1);
  expect(opened.cells).toBe(1);

  const closed = await sample();
  console.log(`group motion, closing: ${JSON.stringify({ from: closed.before, to: closed.heights.at(-1), heights: closed.heights.map(Math.round), gaps: closed.gaps.map(Math.round) })}`);
  expect(closed.before).toBeCloseTo(open, 0);
  expect(closed.heights.at(-1), 'back to its closed height').toBeCloseTo(opened.before, 0);
  expect(between(closed.heights, open, opened.before).length, 'heights between open and closed while it closes').toBeGreaterThanOrEqual(1);
  expect(Math.abs(closed.gaps.at(-1)!), 'the row below sits flush at the end').toBeLessThanOrEqual(1);
  expect(closed.cells, 'its cells unmounted once closed').toBe(0);

  // Under reduced motion the same click jumps: the first frame already has the end height.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const jumped = await sample();
  expect(jumped.heights[0]).toBeCloseTo(open, 0);
  expect(harness.consoleErrors()).toEqual([]);
});

// UX wave U2 (O-29; the U2a document, M4 "The row"): a run of calls is one line, folded while the turn runs and after
// it. While the turn runs the line reads the call running now (or the run's caption between calls) and mounts none of
// its calls; once the turn has closed and is opened, the run's line reads what it did, a click opens it onto its calls'
// rows in order, a call's detail opens as before, and another click folds the run and unmounts its calls.
test('a run folds while its turn runs, opens onto its calls’ rows, and folds again', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  const loaded = await load(page, 'p4/p4-tool-summaries-live'); // turn 1 reads three files, one call after another
  // Every event released one at a time, the first turn's runs read after each paints, until the second turn starts.
  const seen = await page.evaluate(async (events) => {
    const api = (window as unknown as HarnessWindow).__maws_harness;
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const turnOf = (n: number) => { try { return api.turnId(n); } catch { return null; } };
    const steps: { runs: number; mounted: number; lines: string[]; running: string[] }[] = [];
    for (let i = 0; i < events && turnOf(2) === null; i += 1) {
      api.step();
      await frame();
      const turn = turnOf(1);
      if (turn === null) continue;
      const runs = Array.from(document.querySelectorAll(`[data-kind="group"][data-turn-id="${turn}"] .transcript-group`));
      steps.push({
        runs: runs.length,
        mounted: runs.reduce((n, run) => n + run.querySelectorAll('.transcript-cell').length, 0),
        lines: runs.map((run) => { const line = run.querySelector('.transcript-run-line')!; return `${line.getAttribute('data-line')} ${line.getAttribute('aria-expanded')}`; }),
        running: runs.map((run) => run.querySelector('.transcript-run-line[data-line="running"] .transcript-run-label')?.textContent ?? '').filter((label) => label !== ''),
      });
    }
    return steps;
  }, loaded.events);
  console.log(`a run while its turn runs: ${JSON.stringify(seen)}`);
  expect(seen.some((step) => step.runs === 1), 'the turn draws its run while it runs').toBe(true);
  expect(seen.every((step) => step.runs <= 1), 'one run for the turn’s three calls').toBe(true);
  expect(seen.every((step) => step.mounted === 0), 'a folded run mounts none of its calls').toBe(true);
  const lines = new Set(seen.flatMap((step) => step.lines));
  expect(lines.has('running false'), 'the line reads the call running now').toBe(true);
  expect([...lines].every((line) => line === 'running false' || line === 'caption false'), `folded throughout: ${[...lines].join(', ')}`).toBe(true);
  const running = [...new Set(seen.flatMap((step) => step.running))];
  expect(running.length, 'each call in turn').toBeGreaterThan(1);
  for (const label of running) expect(label).toMatch(/^Read (first|second|third)\.txt$/);

  // The turn closed: opened, its run reads what it did, folded, until a click opens it onto the three calls in order.
  await play(page, 0);
  const turn = await turnIdOf(page, 1);
  await expect(page.locator(`${rowSelector(`divider:${turn}`)} button.transcript-disclosure`)).toHaveText(/^Worked for /);
  await settle(page, 300);
  await page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness.expandTurn(1));
  const run = page.locator(`[data-kind="group"][data-turn-id="${turn}"]`);
  await expect(run).toHaveCount(1);
  const line = run.locator('.transcript-run-line');
  await expect(line).toHaveAttribute('data-line', 'caption');
  await expect(line).toHaveText('Read 3 files');
  await expect(line).toHaveAttribute('aria-expanded', 'false');
  await expect(run.locator('.transcript-cell')).toHaveCount(0);
  await line.click();
  await expect(line).toHaveAttribute('aria-expanded', 'true');
  const calls = run.locator('.transcript-tool-block .transcript-cell-line');
  await expect(calls).toHaveText([/^Read first\.txt/, /^Read second\.txt/, /^Read third\.txt/]);
  await calls.nth(1).click();
  await expect(run.locator('.transcript-cell[data-expanded]')).toHaveCount(1);
  await expect(run.locator('.transcript-cell-detail')).toHaveCount(1);
  await line.click();
  await expect(line).toHaveAttribute('aria-expanded', 'false');
  await expect(run.locator('.transcript-cell'), 'its calls unmounted once it has folded').toHaveCount(0);
  await expect(line).toHaveText('Read 3 files');
  expect(harness.consoleErrors()).toEqual([]);
});

// UX wave U2 (O-27; the U2a document, M4 "One component, two identities", decision 12): an opened run draws a thought
// of ten seconds or more at its place, between the blocks of calls it parts or under the last, in the words a thinking
// row reads; a shorter one is not drawn; a thought with no text has nothing to open, and its label starts where a
// line with a chevron starts its label.
test('an opened run draws each thought of ten seconds or more at its place', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await loadAll(page, 'events/run-thoughts');
  const turn = await turnIdOf(page, 1);
  await page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness.expandTurn(1));
  const run = page.locator(`[data-kind="group"][data-turn-id="${turn}"]`);
  await expect(run).toHaveCount(1);
  await run.locator('.transcript-run-line').click();
  await expect(run.locator('.transcript-run-line')).toHaveAttribute('aria-expanded', 'true');
  await settle(page, 500);
  const blocks = await run.evaluate((element) => Array.from(element.querySelectorAll('.transcript-tool-block, .transcript-thinking'), (block) =>
    block.classList.contains('transcript-tool-block')
      ? `calls ${Array.from(block.querySelectorAll('[data-cell-id]'), (cell) => cell.getAttribute('data-cell-id')).join(',')}`
      : `thought ${block.querySelector('.transcript-disclosure')!.textContent!.trim()}${block.querySelector('button.transcript-disclosure') ? ', opens' : ''}`));
  expect(blocks).toEqual([
    'calls cell:toolu_rt_read,cell:toolu_rt_edit', // the 4 s thought between them is not drawn
    'thought Thought for 12s, opens',
    'calls cell:toolu_rt_test',
    'thought Thought for 12s', // no text: nothing to open
    'calls cell:toolu_rt_grep',
    'thought Thought for 12s, opens', // under the last call
  ]);
  await expect(page.getByText('The test reads', { exact: false })).toHaveCount(0);
  // Where each thought's label starts, measured on its text: the one with no text where the others do.
  const starts = await run.evaluate((element) => Array.from(element.querySelectorAll('.transcript-thinking .transcript-disclosure'), (line) => {
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT, { acceptNode: (node) => (node.textContent!.includes('Thought for') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    const range = document.createRange();
    range.selectNodeContents(walker.nextNode()!);
    return Math.round(range.getBoundingClientRect().left * 10) / 10;
  }));
  expect(starts).toHaveLength(3);
  expect(Math.max(...starts) - Math.min(...starts), `label starts ${starts.join(', ')}`).toBeLessThanOrEqual(0.5);
  // A thought opens onto its text.
  const first = run.locator('.transcript-thinking > button.transcript-disclosure').first();
  await first.click();
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await expect(run.locator('.transcript-thinking-text').first()).toHaveText('Run the parser tests before touching the callers, so a failure there is the fix and not a caller.');
  expect(harness.consoleErrors()).toEqual([]);
});

// UX wave U2 (O-15; the U2a document, M3): a turn's line reads its verb and the lines its finished edits changed while
// it runs, and once it has closed what it did, its caption's parts in the turn summary; a turn with no work draws no
// line. No line counts tool calls.
test('a closed turn’s line says what the turn did, and a turn with no work has none', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await load(page, 'events/run-thoughts');
  // Through the edit's result: the turn runs, its line reads its verb and the edit's lines.
  for (let i = 0; i < 9; i += 1) await page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness.step());
  const divider = page.locator('[data-kind="divider"] button.transcript-disclosure').first();
  await expect(divider).toHaveText(/^Working(?: for \d+s)?\s*\+2\s*−1$/);
  await play(page, 0);
  await expect(divider).toHaveText(/^Worked for 45s · Read and edited parser\.ts, ran a command, searched code\s*\+2\s*−1$/);
  await expect(divider).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Turn summary' }).click();
  const summary = page.locator('.transcript-popover');
  await expect(summary).toContainText('Read and edited parser.ts, ran a command, searched code');
  await expect(summary).not.toContainText('tool call');
  await expect(page.locator('[data-kind="divider"]'), 'the turn that only answers has no line').toHaveCount(1);
  await expect(page.locator('[data-kind="assistant_text"]').last()).toContainText('No, that was the only failing test.');
  await expect(page.locator('[data-transcript-scroller]')).not.toContainText('tool call');
  expect(harness.consoleErrors()).toEqual([]);
});

test('M2 commentary uses answer typography in both themes and still folds with the work', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await loadAll(page, 'transcript/edit-and-receipt');
  const divider = page.locator('[data-kind="divider"] button[aria-expanded]').first();
  const commentary = page.locator('.transcript-commentary');
  await expect(divider).toHaveAttribute('aria-expanded', 'false');
  await expect(commentary).toHaveCount(0);
  await divider.click();
  await expect(commentary).toContainText('Edits applied; running the suite.');
  await page.mouse.move(0, 0); // the disclosure deliberately uses body ink while hovered
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    const styles = await page.evaluate(() => {
      const typography = (selector: string) => {
        const style = getComputedStyle(document.querySelector(selector)!);
        return { color: style.color, font: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight };
      };
      return { commentary: typography('.transcript-commentary p'), answer: typography('.transcript-answer p'), activity: typography('.transcript-disclosure') };
    });
    expect(styles.commentary, `${theme}: intermediate assistant text is message prose`).toEqual(styles.answer);
    expect(styles.activity.color, `${theme}: activity stays muted`).not.toBe(styles.answer.color);
  }
  await divider.click();
  await expect(commentary).toHaveCount(0);
  await expect(page.locator('.transcript-answer')).toContainText('Tests pass');
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

// The FIXTURES catalogue as the harness offers it (its fixture picker).
const fixtureNames = (page: Page) =>
  page.evaluate(() => Array.from(document.querySelectorAll<HTMLOptionElement>('select[aria-label="Fixture"] option')).map((option) => option.value));

// Loads a fixture and releases all of it; resolves once the rows stopped changing.
async function loadAll(page: Page, fixture: string) {
  await load(page, fixture);
  await play(page, 0);
  await expect.poll(async () => (await metrics(page)).batches, { message: `${fixture} released`, timeout: 20_000 }).toBeGreaterThan(0);
  await settle(page, 300);
}

// W4: an answered question is one compact widget, a line per question reading "header → answer", no options listed,
// and it stays in view with its turn folded (the owner's ruling), where the thinking around it folds away.
test('an answered question reads as one compact receipt that stays in view when its turn folds', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await loadAll(page, 'pass1/question-roundtrip');
  const divider = page.locator('[data-kind="divider"] button[aria-expanded]').first();
  await expect(divider).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-kind="thinking"]')).toHaveCount(0); // the folded work
  const widget = page.locator('[data-kind="question"] .transcript-question');
  await expect(widget).toBeVisible();
  expect(await widget.locator('[data-question]').allTextContents()).toEqual(['Color→Red', 'Fruits→Apple, Pear']);
  await expect(widget).not.toContainText('Blue');
  await expect(widget).not.toContainText('Chosen');
  const box = (await widget.boundingBox())!;
  expect(box.width, 'a compact widget, 480 px at most').toBeLessThanOrEqual(480);
  expect(box.height, 'two lines').toBeLessThan(72);
  expect(harness.consoleErrors()).toEqual([]);
});

// ---- UX wave U1b: a question's form in the row of its call (Proof 3, acceptance 6 and 13; the architect's ruling A2) ----
// `synthetic/questions` is the seeded transcript with three question calls put in it (harness/questions.ts): two of a
// terminal session's asynchronous questions (the sminos ask mod's call and its immediate result, the agent going on for a
// hundred turns and more with them open), a hundred turns apart, and, as its last turn, the engine's own AskUserQuestion
// dismissed whole. `raise` makes an asynchronous call a waiting request of the transcript's session as its bridge raises
// one (an `async_input` item and its request view, read by the shared `laneAEntryOf`, in the attention store), and from
// then on the page draws requests through the real card's renderer.
const QUESTIONS = 'synthetic/questions';
const questionsOf = (page: Page): Promise<HarnessQuestion[]> => page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness.questions());
const raise = (page: Page, call: string): Promise<string> => page.evaluate((c) => (window as unknown as HarnessWindow).__maws_harness.raise(c), call);
const lower = (page: Page, id: string) => page.evaluate((i) => (window as unknown as HarnessWindow).__maws_harness.lower(i), id);
const scrollToTurn = (page: Page, n: number) => page.evaluate((turn) => (window as unknown as HarnessWindow).__maws_harness.scrollToTurn(turn), n);
const PILL = 'Needs your input. Scroll to the request';
// The reader leaves follow mode as a wheel turned upward leaves it (the list releases on that intent).
const leaveFollow = (page: Page) =>
  page.evaluate(() => document.querySelector<HTMLElement>('[data-transcript-scroller]')!.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })));
// The first row whose box shows in the scroller, and how far its top stands from the scroller's top (negative: partly
// scrolled past).
const firstShown = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    const top = scroller.getBoundingClientRect().top;
    const rows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-row-id]'))
      .map((row) => ({ id: row.dataset.rowId!, box: row.getBoundingClientRect() }))
      .filter(({ box }) => box.height > 0 && box.bottom > top + 0.5)
      .sort((a, b) => a.box.top - b.box.top);
    return rows.length === 0 ? null : { id: rows[0].id, offset: rows[0].box.top - top };
  });
// Where a row stands against the scroller: above it, in it, below it, or not mounted by the virtual list.
const placeOf = (page: Page, rowId: string) =>
  page.evaluate((id) => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    const row = scroller.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
    if (row === null) return 'unmounted';
    const view = scroller.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    return box.bottom <= view.top ? 'above' : box.top >= view.bottom ? 'below' : 'in view';
  }, rowId);

// The child's check, "a row that mounts a card far from the end" (Proof 3, acceptance 13): with the reader in the middle
// of a transcript of several hundred rows, an asynchronous question raised for a call whose row stands just above the viewport (mounted
// by the list's overscan, so its form mounts there and the row grows) and one for a call far below leave the reader's
// first visible row where it was, to the pixel. The form scrolled out (the list unmounts its row) and back holds what was
// picked in it: the draft is held by the request, not by the row. With requests waiting out of view the jump button is
// the pill, and it goes to the oldest of them.
test('an asynchronous question raised above and below a reader mid-transcript moves nothing they see, and its form scrolled away and back keeps its draft', async ({ harness }) => {
  test.setTimeout(90_000);
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await loadAll(page, QUESTIONS);
  expect((await metrics(page)).rows, 'several hundred rows').toBeGreaterThan(500);
  const [above, below] = (await questionsOf(page)).filter((question) => !question.dismissed);
  expect(below.turn - above.turn, 'the two calls a hundred turns apart').toBeGreaterThan(50);

  // The reader in the middle: the row of the first call just above the viewport, the second's far below it.
  await leaveFollow(page);
  await scrollToTurn(page, above.turn);
  await settle(page, 500);
  await expect.poll(() => placeOf(page, above.row), { message: 'the first call’s row is mounted' }).not.toBe('unmounted');
  await page.evaluate((id) => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    const row = scroller.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)!;
    scroller.scrollTop += row.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + 24;
  }, above.row);
  await settle(page, 500);
  expect((await metrics(page)).following, 'a reader in the middle').toBe(false);
  expect(await placeOf(page, above.row), 'the first call’s row stands just above the viewport, mounted').toBe('above');
  expect(await placeOf(page, below.row), 'the second call’s row is below the viewport').not.toBe('in view');
  const before = await firstShown(page);
  expect(before, 'a row is shown').not.toBeNull();
  const scrolled = await scrollerTop(page);

  // Both raised: the first's form mounts in its row above the reader, the second's is out of reach below.
  const first = await raise(page, above.call);
  await raise(page, below.call);
  const form = page.locator(`[data-waiting-form="${first}"]`);
  await expect(form, 'the form mounts in the row above the reader').toBeAttached();
  await expect(form.getByRole('group', { name: 'Question waiting' }), 'a terminal session’s asynchronous question').toBeAttached();
  await settle(page, 500);
  const after = await firstShown(page);
  expect(after?.id, 'the same row is the first the reader sees').toBe(before!.id);
  expect(Math.abs(after!.offset - before!.offset), `the reader's first row stays to the pixel (scrollTop ${scrolled} → ${await scrollerTop(page)})`).toBeLessThanOrEqual(1);
  expect(await placeOf(page, above.row), 'the grown row is still above the reader').toBe('above');

  // Two requests wait out of view: the jump button is the pill, and it goes to the older, the keyboard on its row.
  const pill = page.getByRole('button', { name: PILL });
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute('data-state', 'input');
  await expect(pill).toHaveText(/Needs your input/);
  await pill.click();
  await expect(form, 'the pill shows the oldest request out of view').toBeInViewport();
  await expect(rowOf(form), 'and puts the keyboard on its row').toBeFocused();

  // A pick in the form, the form scrolled out until the list unmounts its row, and back: the pick is still there.
  const thursday = form.getByRole('radio', { name: /Thursday/ });
  await thursday.click();
  await expect(thursday).toHaveAttribute('aria-checked', 'true');
  await scrollToTurn(page, 1);
  await settle(page, 300);
  await expect(form, 'scrolled far away, the row and its form are unmounted').toHaveCount(0);
  await scrollToTurn(page, above.turn);
  await expect(form).toBeVisible();
  await expect(form.getByRole('radio', { name: /Thursday/ }), 'the draft is held by the request').toHaveAttribute('aria-checked', 'true');
  await expect(form.getByRole('radio', { name: /Tuesday/ })).toHaveAttribute('aria-checked', 'false');
  expect(harness.consoleErrors()).toEqual([]);
});

// Acceptance 6 (the jump button's request state, §D): with the reader at the end, following, an asynchronous question
// that waits in a row far above (the agent having gone on past it) makes the jump button the pill, though the reader is at the end; the pill scrolls to the question and puts
// the keyboard on its row; once no request waits the pill is gone, and the reader, away from the end, has the round
// button back.
test('an asynchronous question waiting far above a reader at the end: the pill reads Needs your input, goes to it, and goes once it no longer waits', async ({ harness }) => {
  test.setTimeout(90_000);
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await loadAll(page, QUESTIONS);
  expect((await metrics(page)).following, 'the reader at the end').toBe(true);
  await expect(page.getByRole('button', { name: /^Jump to latest/ }), 'following, nothing out of view: no button').toHaveCount(0);
  const [, waiting] = (await questionsOf(page)).filter((question) => !question.dismissed);
  const id = await raise(page, waiting.call);

  const pill = page.getByRole('button', { name: PILL });
  await expect(pill, 'at the end, the pill: the request is out of view').toBeVisible();
  await expect(pill).toHaveAttribute('data-state', 'input');
  await expect(pill).toHaveAttribute('title', PILL);
  await expect(pill).toHaveText(/Needs your input/);
  expect((await metrics(page)).following, 'a request waiting above moves no follower').toBe(true);
  expect(await distanceFromEnd(page), 'the reader is still at the end').toBeLessThanOrEqual(80);

  await pill.click();
  const form = page.locator(`[data-waiting-form="${id}"]`);
  await expect(form, 'the pill scrolls to the question').toBeInViewport();
  await expect(form.getByRole('group', { name: 'Question waiting' })).toBeVisible();
  await expect(rowOf(form), 'and puts the keyboard on its row').toBeFocused();
  await expect(pill, 'in view, the request needs no pill').toHaveCount(0);

  await lower(page, id);
  await expect(form, 'no longer waiting, the row draws its receipt').toHaveCount(0);
  await expect(page.locator(`[data-row-id="question:${waiting.call}"] .transcript-question`)).toBeVisible();
  await expect(pill, 'nothing waits: no pill').toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Jump to latest/ }), 'away from the end, the round button').toBeVisible();
  expect(harness.consoleErrors()).toEqual([]);
});

// The architect's ruling A2 (M1 builds it, this scene asserts it on a real layout; the unit DOM computes none): a question
// dismissed whole reads Dismissed on each of its lines (the owner's card 2), and a header of fourteen characters beside it
// is shown whole, not cut: a header is cut only when header and answer together exceed the widget's widest width.
test('a dismissed question’s receipt shows each header whole beside Dismissed', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await loadAll(page, QUESTIONS);
  const dismissed = (await questionsOf(page)).find((question) => question.dismissed)!;
  const widget = page.locator(`[data-row-id="${dismissed.row}"] .transcript-question`);
  await expect(widget).toBeVisible();
  const lines = widget.locator('[data-question]');
  await expect(lines).toHaveCount(2);
  await expect(lines.locator('.transcript-question-answer')).toHaveText(['Dismissed', 'Dismissed']);
  await expect(lines.locator('[data-question-label]')).toHaveText(['Release window', 'Sign-off']);
  const layout = await lines.first().evaluate((line) => {
    const label = line.querySelector<HTMLElement>('[data-question-label]')!;
    const answer = line.querySelector<HTMLElement>('.transcript-question-answer')!;
    return { cut: label.scrollWidth > label.clientWidth, labelRight: label.getBoundingClientRect().right, answerLeft: answer.getBoundingClientRect().left, answerLines: Math.round(answer.getBoundingClientRect().height / parseFloat(getComputedStyle(answer).lineHeight)) };
  });
  expect(layout.cut, 'the fourteen-character header is not cut beside Dismissed').toBe(false);
  expect(layout.labelRight, 'the header stands before its answer, on its line').toBeLessThan(layout.answerLeft);
  expect(layout.answerLines, 'Dismissed on one line').toBe(1);
  expect(harness.consoleErrors()).toEqual([]);
});

// W8 (T1): a streaming thinking block's label in the CLI's words (tier, effort, time) and colour (the warning colour
// from 20 s), under Codex's shimmer, static under reduced motion. UX wave U2 (O-27; the owner's answer "The label
// only"): the label reads nothing else while the thought runs, and its summary is read by opening the line; a thought
// streaming in a folded run has its line under the run's. With MAWS_W8_SHOTS=1 it also writes the screenshots the wave
// hands back (docs/doperpowers/plans/shots/w8-thinking-*.png), in both themes.
test('a streaming thought reads its label under the shimmer, warm from 20 s, and opens onto its summary', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness.setEffort('xhigh'));
  const cases = [
    // 50 s in at load, a thinking row of its own
    { fixture: 'events/thinking-live', shot: 'deep', thought: '[data-kind="thinking"] .transcript-thinking', tier: thinkingTier(50_000), text: 'Weighing where the anchor should sit: the reader’s row keeps their place, the end keeps the stream in view.', warm: true },
    // 12 s in, the last member of a folded run: its line under the run's
    { fixture: 'events/thinking-live-group', shot: 'still', thought: '[data-kind="group"] .transcript-group > .transcript-thinking', tier: thinkingTier(12_000), text: 'It passes. Now, why the reader stays put: the virtualiser anchors to the end only while following.', warm: false },
  ];
  for (const { fixture, shot, thought, tier, text, warm } of cases) {
    await loadAll(page, fixture);
    const label = page.locator(`${thought} [data-shimmer]`);
    await expect(label).toHaveText(new RegExp(`^${tier} with xhigh effort · [^·]+$`));
    await expect(label, 'the label reads nothing of the summary').not.toContainText(text.slice(0, 24));
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      const style = await label.evaluate((element) => {
        const computed = getComputedStyle(element);
        // The warning colour as the label mixes it: wholly the theme's --warning, read in the same colour space.
        const probe = document.createElement('span');
        probe.style.backgroundColor = 'color-mix(in oklab, var(--warning) 100%, var(--fg))';
        element.parentElement!.append(probe);
        const warning = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          animation: `${computed.animationName} ${computed.animationDuration} ${computed.animationTimingFunction} ${computed.animationDelay} ${computed.animationIterationCount}`,
          clip: computed.backgroundClip, fill: computed.webkitTextFillColor, colour: computed.backgroundColor, warning, image: computed.backgroundImage,
        };
      });
      expect(style.animation, `${fixture} ${theme}: Codex's sweep`).toBe('transcript-shimmer 4s steps(48) 0.6s infinite');
      expect(style.clip, 'drawn through the text').toBe('text');
      expect(style.image, 'the highlight band').toContain('linear-gradient');
      if (warm) expect(style.colour, `${fixture} ${theme}: the warning colour past 20 s`).toBe(style.warning);
      else expect(style.colour, `${fixture} ${theme}: not yet the warning colour`).not.toBe(style.warning);
      if (process.env.MAWS_W8_SHOTS === '1') {
        // The sweep held where its band is over the text (0.4 s into a pass that starts at 0.6 s), released after.
        await label.evaluate((element) => {
          const sweep = element.getAnimations()[0];
          sweep.pause();
          sweep.currentTime = 1000;
        });
        const turn = page.locator('[data-kind="user"], [data-kind="divider"], [data-kind="cell"], [data-kind="thinking"], [data-kind="group"]');
        const boxes = (await turn.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON() as DOMRect))).filter((box) => box.height > 0);
        const top = Math.min(...boxes.map((box) => box.top)) - 12;
        const bottom = Math.max(...boxes.map((box) => box.bottom)) + 12;
        const left = Math.min(...boxes.map((box) => box.left)) - 12;
        const right = Math.max(...boxes.map((box) => box.right)) + 12;
        await page.screenshot({ path: join(REPO_ROOT, `docs/doperpowers/plans/shots/w8-thinking-${shot}-${theme}.png`), clip: { x: left, y: top, width: right - left, height: bottom - top } });
        await label.evaluate((element) => element.getAnimations()[0].play());
      }
    }
    await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
    // Opening the line reads the summary streamed so far, while the label goes on reading only the label.
    const opener = page.locator(`${thought} > button.transcript-disclosure`);
    await opener.click();
    await expect(opener).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(`${thought} .transcript-thinking-text`)).toContainText(text);
    await expect(label).toHaveText(new RegExp(`^${tier} with xhigh effort · [^·]+$`));
  }
  // Reduced motion: the same words and colour, no sweep.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = await page.locator('.transcript-thinking [data-shimmer]').evaluate((element) => [getComputedStyle(element).animationName, getComputedStyle(element).backgroundImage]);
  expect(still).toEqual(['none', 'none']);
  expect(harness.consoleErrors()).toEqual([]);
});

test('the denied count jumps to the standalone denied cell', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await loadAll(page, 'pass1/permission-roundtrip');

  // Three turns of one Bash call each; the second was denied by a permission rule. Its turn is collapsed.
  const turnId = await turnIdOf(page, 2);
  const divider = page.locator(rowSelector(`divider:${turnId}`));
  const toggle = divider.locator('button[aria-expanded]').first();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // UX wave U2 (O-15): the line names what the turn did, never a count of tool calls; a refused call is no work done,
  // so a turn whose one call was refused reads its time and its denied count only
  await expect(toggle).toHaveText(/^Worked for [^·]+$/);
  await expect(toggle).not.toContainText('tool call');
  const count = divider.getByRole('link', { name: '1 denied' });
  const cellId = await count.evaluate((link) => link.getAttribute('href')!.slice(1));
  expect(cellId).toBe('cell:toolu_01WfZTvMV6147Psn1MBSesXw');
  expect(await page.locator(`[data-cell-id="${cellId}"]`).count(), 'the denied cell is not rendered while its turn is collapsed').toBe(0);

  await count.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const cell = page.locator(`[data-cell-id="${cellId}"]`);
  await expect(cell).toBeFocused();
  await settle(page, 300);
  const placed = await cell.evaluate((element) => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    const row = element.closest<HTMLElement>('[data-row-id]')!;
    const view = scroller.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    const max = scroller.scrollHeight - scroller.clientHeight;
    return {
      kind: element.closest('[data-kind]')?.getAttribute('data-kind'),
      inGroup: element.closest('[data-group-cells]') !== null,
      label: element.querySelector('button')?.textContent ?? '',
      offCentre: Math.round(Math.abs(rect.top + rect.height / 2 - (view.top + view.height / 2))),
      clamped: scroller.scrollTop <= 1 || scroller.scrollTop >= max - 1, // a list too short to centre the row stops at an edge
      inView: rect.top >= view.top && rect.bottom <= view.bottom,
      focused: document.activeElement === element,
    };
  });
  console.log(`denial jump: ${JSON.stringify(placed)}`);
  test.info().annotations.push({ type: 'denial jump', description: JSON.stringify(placed) });
  expect(placed.kind, 'the denied cell is a standalone row').toBe('cell');
  expect(placed.inGroup, 'not inside a group').toBe(false);
  expect(placed.label).toMatch(/^Denied: git branch --show-current · /);
  expect(placed.focused, 'focus is on the cell itself').toBe(true);
  expect(placed.inView, 'the denied cell is in view').toBe(true);
  expect(placed.offCentre <= 2 || placed.clamped, `centred (off by ${placed.offCentre} px) unless the list stops at an edge`).toBe(true);

  // The same jump deep in a long transcript, where the list can centre it: synthetic/500 denies a call every 40th turn.
  await loadAll(page, 'synthetic/500');
  await page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness.scrollToTurn(200));
  await settle(page, 300);
  const link = page.locator('[data-kind="divider"] a[href^="#cell:"]').first();
  await expect(link).toBeVisible();
  const deep = await link.evaluate((element) => element.getAttribute('href')!.slice(1));
  await link.click();
  const deepCell = page.locator(`[data-cell-id="${deep}"]`);
  await expect(deepCell).toBeFocused();
  await settle(page, 300);
  const deepPlaced = await deepCell.evaluate((element) => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    const view = scroller.getBoundingClientRect();
    const rect = element.closest<HTMLElement>('[data-row-id]')!.getBoundingClientRect();
    return { kind: element.closest('[data-kind]')?.getAttribute('data-kind'), offCentre: Math.round(Math.abs(rect.top + rect.height / 2 - (view.top + view.height / 2))) };
  });
  console.log(`denial jump, synthetic/500: ${JSON.stringify(deepPlaced)}`);
  expect(deepPlaced.kind).toBe('cell');
  expect(deepPlaced.offCentre, 'the denied row is centred').toBeLessThanOrEqual(2);
  expect(harness.consoleErrors()).toEqual([]);
});

// The long-transcript window's jumps into history (residue 2 of docs/doperpowers/plans/2026-10-30-long-transcript-window.md):
// a long session opens on its newest window; a jump to text many pages back (an attention item's mark) says it is
// loading, can be given up, and otherwise lands on the text once its page is in; one in none of the history says so.
// The wire is the harness's stand-in for the host (harness/paged.ts); the store, pager and bar are the product's.
test('a jump into a long session\u2019s history loads the pages back to its text and lands there, or says it is missing', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  const h = '__maws_harness';
  const opened = await page.evaluate((key) => (window as unknown as Record<string, HarnessApi>)[key]!.loadPaged('synthetic/120', 250), h);
  console.log(`paged open: ${JSON.stringify(opened)}`);
  expect(opened.turns, 'the open draws the newest window only').toBeLessThan(opened.total / 3);
  const reach = (n: number | 'missing') => page.evaluate(([key, target]) => (window as unknown as Record<string, HarnessApi>)[key]!.reach(target), [h, n] as const);
  const rowOfText = (n: number) => page.evaluate(([key, turn]) => (window as unknown as Record<string, HarnessApi>)[key]!.rowOfText(turn), [h, n] as const);
  const bar = page.getByTestId('reach');

  // Given up on the way: nothing it walked is taken in, and no jump happens.
  expect(await rowOfText(2)).toBeNull();
  await reach(2);
  await expect(bar).toHaveAttribute('data-phase', 'loading');
  await expect(bar).toContainText('Loading earlier messages to reach the message');
  await bar.getByRole('button', { name: 'Stop' }).click();
  await expect(bar).toBeHidden();
  expect(await rowOfText(2)).toBeNull();

  // Landed: the pages back to turn 3 are in, and its text is in view with focus.
  await reach(3);
  await expect(bar).toHaveAttribute('data-phase', 'loading');
  await expect(bar).toBeHidden({ timeout: 30_000 });
  const row = await rowOfText(3);
  expect(row, 'turn 3\u2019s text is loaded').not.toBeNull();
  const text = page.locator(rowSelector(row!)).locator('[data-kind="assistant_text"]').first();
  await expect(text).toBeFocused();
  await settle(page, 300);
  const placed = await text.evaluate((element) => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return { inView: rect.top >= scroller.top && rect.top < scroller.bottom, kind: element.closest('[data-kind]')?.getAttribute('data-kind') };
  });
  console.log(`history jump: ${JSON.stringify(placed)}`);
  expect(placed).toEqual({ inView: true, kind: 'assistant_text' });

  // In none of the history: said at once, until dismissed.
  await reach('missing');
  await expect(bar).toHaveAttribute('data-phase', 'missing');
  await expect(bar).toContainText('That message is no longer in this transcript.');
  await bar.getByRole('button', { name: 'Dismiss' }).click();
  await expect(bar).toBeHidden();
  expect(harness.consoleErrors()).toEqual([]);
});

// A long unbreakable token (a path, a URL) in answer or commentary prose wraps inside a narrow transcript instead of
// scrolling it sideways (R7 measured 80 px of horizontal overflow at 280 px before the prose wrapped).
test('a long token in prose wraps in a narrow transcript', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await loadAll(page, 'transcript/edit-and-receipt');
  const overflow = await page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    scroller.closest<HTMLElement>('.transcript')!.style.flex = '0 0 280px'; // the harness lays it out as flex-1
    const token = `/tmp/${'averylongdirectoryname/'.repeat(12)}file.ts`; // no hyphen: nothing to break at
    const paragraphs = ['.transcript-answer p', '.transcript-commentary p'].map((selector) => scroller.querySelector(selector)).filter((p) => p !== null);
    for (const paragraph of paragraphs) paragraph.append(document.createTextNode(` ${token}`));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { width: scroller.clientWidth, paragraphs: paragraphs.length, overflow: scroller.scrollWidth - scroller.clientWidth };
  });
  expect(overflow.width, 'the transcript is narrow').toBeLessThanOrEqual(280);
  expect(overflow.paragraphs, 'the fixture shows answer prose').toBeGreaterThan(0);
  expect(overflow.overflow, 'no horizontal overflow').toBeLessThanOrEqual(0);
  expect(harness.consoleErrors()).toEqual([]);
});

// ---- UX wave U3b, landing 1 (docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md, M6) -------------
// The rows' pixels, which happy-dom cannot hold: the unit tests pin each row's structure, these scenes its widths,
// heights and overlaps, what hovering moves and what the clipboard gets, on three fixtures written for them
// (test/fixtures/transcript/events/command-lines, column-blocks and message-actions; invented content, X1 events in the
// shapes the model's tests write). Each claim names its ruling in the document's Decision Log (R1 to R23, M2-2, M2-5).

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const boxOf = (locator: Locator): Promise<Box> =>
  locator.evaluate((element) => {
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
    return { left, top, right, bottom, width, height };
  });
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
// A pixel claim held to a pixel (a rounding of layout, never a different rule)
const expectNear = (actual: number, expected: number, message: string) => expect(Math.abs(actual - expected), `${message}: ${actual} against ${expected}`).toBeLessThanOrEqual(1);

// The transcript's pane `width` px wide (the harness lays it out as flex-1), settled.
async function paneWidth(page: Page, width: number) {
  await page.evaluate((w) => {
    document.querySelector<HTMLElement>('[data-transcript-scroller]')!.closest<HTMLElement>('.transcript')!.style.flex = `0 0 ${w}px`;
  }, width);
  await settle(page, 300);
}
// The three values of `appearance.transcriptWidth` (settings-tab/transcript-width.ts): the column `--measure` the
// transcript's rows share, set at the document's root.
const TRANSCRIPT_WIDTHS = [768, 960, 1280] as const;
// A window with room for the widest column (1280 px, the pane's scrollbar beside it), the pane on the harness's flex-1.
async function roomForWidths({ app, page }: MawsLaunch) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())!.setContentSize(1440, 820)); // 820: the e2e launch's own default height
  await page.waitForFunction(() => window.innerWidth === 1440);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-transcript-scroller]')!.closest<HTMLElement>('.transcript')!.style.flex = '';
  });
  await settle(page, 300);
}
// The transcript width set as the app sets it (applyTranscriptWidth: the default removes the root's `--measure`, the
// others set it), settled, and the text column it gives held: the width less the column's two 16 px pads.
async function transcriptWidth(page: Page, width: (typeof TRANSCRIPT_WIDTHS)[number]) {
  await page.evaluate((w) => {
    if (w === 768) document.documentElement.style.removeProperty('--measure');
    else document.documentElement.style.setProperty('--measure', `${w}px`);
  }, width);
  await settle(page, 300);
  const column = await page.evaluate(() => {
    const row = document.querySelector('[data-transcript-scroller] .transcript-row')!;
    const style = getComputedStyle(row);
    return row.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  });
  expectNear(column, width - 32, `the transcript width ${width}: its text column`);
}
// Whether an element scrolls on `axis`: its computed overflow lets it, and an offset set on it reads back.
const scrollsOn = (locator: Locator, axis: 'x' | 'y') =>
  locator.evaluate((element, a) => {
    const overflow = a === 'x' ? getComputedStyle(element).overflowX : getComputedStyle(element).overflowY;
    if (a === 'x') element.scrollLeft = 40;
    else element.scrollTop = 40;
    const offset = a === 'x' ? element.scrollLeft : element.scrollTop;
    if (a === 'x') element.scrollLeft = 0;
    else element.scrollTop = 0;
    return { overflow, offset };
  }, axis);
const expectScrolls = async (locator: Locator, axis: 'x' | 'y', message: string) => {
  const { overflow, offset } = await scrollsOn(locator, axis);
  expect(['auto', 'scroll'], `${message}: its overflow lets it (${overflow})`).toContain(overflow);
  expect(offset, `${message}: an offset set on it holds`).toBeGreaterThan(0);
};
// A row brought into the list's mounted range and settled, so a measurement in the page finds it.
async function mounted(page: Page, row: Locator) {
  await row.scrollIntoViewIfNeeded();
  await settle(page, 200);
}
// What a token computes to on this page (a colour or a font), read through a probe element.
const tokenValue = (page: Page, property: 'color' | 'fontFamily', value: string) =>
  page.evaluate(
    ([name, token]) => {
      const probe = document.createElement('span');
      probe.style[name as 'color'] = token;
      document.querySelector('.transcript')!.append(probe);
      const read = getComputedStyle(probe)[name as 'color'];
      probe.remove();
      return read;
    },
    [property, value] as const,
  );
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

// Acceptance 1 (O-18; decision 4, R1 to R5, R19, R23): a slash command's output is a dim line led by `⎿` under its
// command, in the line's own type (12 px at 1.5), with 16 px under it. A one-line output sits on the bubble's side as wide
// as its words; one with a line end is a block from the column's left edge after the mark, and opening it moves nothing
// sideways. Closed, the one drawing is cut at the bottom of its second drawn line (36 px for a paragraph, 40 px for a
// heading over a line), under a fade of at most a third of a line that ends at the bound; "Show more" opens the same
// text, each source line on a line of its own. Inside it markdown is drawn at the line's scale; a terminal's grid is
// preformatted, scrolls sideways and never wraps; an error is in `--danger`; a line standing alone names its command in
// the line's own font.
test('a command’s output is a dim line under its command, cut at the bottom of its second drawn line until opened, in the line’s own type', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await loadAll(page, 'events/command-lines');
  const transcript = page.locator('[data-transcript-scroller]');
  await expect(transcript).not.toContainText('Command output');
  await expect(page.locator('[data-kind="local_command"] .transcript-replayed')).toHaveCount(0);
  const row = (text: string) => page.locator('[data-kind="local_command"]').filter({ hasText: text });
  const measure = async (frame: Locator) => {
    await mounted(page, frame);
    return frame.evaluate((element) => {
      const box = (el: Element) => {
        const { left, top, right, bottom, width, height } = el.getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      const frameStyle = getComputedStyle(element);
      const line = element.querySelector<HTMLElement>('.transcript-command')!;
      const output = line.querySelector<HTMLElement>('.transcript-command-output')!;
      const style = getComputedStyle(output);
      return {
        column: { left: box(element).left + parseFloat(frameStyle.paddingLeft), right: box(element).right - parseFloat(frameStyle.paddingRight) },
        mark: { box: box(line.querySelector('.transcript-command-mark')!), color: getComputedStyle(line.querySelector('.transcript-command-mark')!).color },
        output: box(output),
        text: output.textContent,
        type: { size: style.fontSize, lineHeight: parseFloat(style.lineHeight), color: style.color, font: style.fontFamily },
        mask: style.maskImage || style.webkitMaskImage || 'none',
        under: parseFloat(getComputedStyle(line).paddingBottom),
        block: line.hasAttribute('data-block'),
        error: line.hasAttribute('data-error'),
        button: line.querySelector('.transcript-quiet-button')?.textContent ?? null,
      };
    });
  };
  const muted = await tokenValue(page, 'color', 'var(--fg-muted)');
  const faint = await tokenValue(page, 'color', 'var(--fg-faint)');

  // a one-line output (/rename): on the bubble's side, as wide as its words, one line and no bound
  const renamed = await measure(row('Session renamed to: north gauges'));
  const renameBubble = await boxOf(page.locator('[data-kind="user"]').filter({ hasText: '/rename north gauges' }).locator('[data-bubble]'));
  expect(renamed.text).toBe('Session renamed to: north gauges');
  expect(renamed.type, 'R1: the line’s type, muted').toMatchObject({ size: '12px', lineHeight: 18, color: muted });
  expect(renamed.mark.color, 'the lead mark is faint').toBe(faint);
  expect(renamed.under, '16 px under the line').toBe(16);
  expect(renamed.block, 'R2: one line of text is no block').toBe(false);
  expectNear(renamed.output.right, renameBubble.right, 'R2: on the bubble’s side, its right edge at the bubble’s');
  expect(renamed.output.width, 'R2: as wide as its words').toBeLessThan((renamed.column.right - renamed.column.left) / 2);
  expectNear(renamed.output.height, renamed.type.lineHeight, 'R19: one line, no bound');
  expect(renamed.button, 'no Show more for a line that is not cut').toBeNull();

  // a paragraph of seven lines (/cost): a block from the column's left edge, cut at two lines under the fade
  const cost = row('Total duration (API)');
  const closed = await measure(cost);
  expect(closed.block, 'R2: a text with a line end is a block').toBe(true);
  expectNear(closed.mark.box.left, closed.column.left, 'R2: the mark at the column’s left edge');
  expect(closed.output.left, 'R2: the output starts after the mark').toBeGreaterThan(closed.mark.box.right);
  expectNear(closed.output.height, 2 * closed.type.lineHeight, 'R19 and acceptance 1: closed at the bottom of its second drawn line, two lines of its type');
  const fade = /calc\((?:100% - ([\d.]+)px|-([\d.]+)px \+ 100%)\)/.exec(closed.mask); // either order a computed calc() may take
  expect(fade, `R3: the closed line fades out (${closed.mask})`).not.toBeNull();
  expect(Number(fade![1] ?? fade![2]), 'R3: the fade is at most a third of one line, ending at the bound').toBeLessThanOrEqual(closed.type.lineHeight / 3);
  expect(closed.button).toBe('Show more');
  await cost.getByRole('button', { name: 'Show more' }).click();
  const open = await measure(cost);
  expect(open.text, 'one drawing: the open state holds the closed state’s text, in its order').toBe(closed.text);
  expectNear(open.output.height, 7 * open.type.lineHeight, 'R4: each of the seven source lines on a line of its own');
  expect(open.mask, 'open: no fade').toBe('none');
  expect([open.output.left, open.output.width], 'R2: opening moves nothing sideways').toEqual([closed.output.left, closed.output.width]);
  expect(open.button).toBe('Show less');
  await cost.getByRole('button', { name: 'Show less' }).click();
  expectNear((await measure(cost)).output.height, 2 * closed.type.lineHeight, 'closed again');

  // markdown at the line's scale (/context): a heading over a line is cut at 40 px; open, the heading is the line's size
  // in bold, the blocks stand 4 px apart and the table's text is the line's size; no heading marker is drawn
  const context = row('Context Usage').filter({ has: page.locator('table') });
  const shut = await measure(context);
  expectNear(shut.output.height, 2 * shut.type.lineHeight + 4, 'R19 and R1: a heading over a line, 4 px apart, comes to 40 px');
  await context.getByRole('button', { name: 'Show more' }).click();
  await mounted(page, context);
  const drawn = await context.locator('.transcript-command-output').evaluate((output) => {
    const prose = output.querySelector('.transcript-prose')!;
    const blocks = Array.from(prose.children).flatMap((child) => (child.hasAttribute('dir') || getComputedStyle(child).display === 'contents' ? Array.from(child.children) : [child])); // a per-block wrapper, where one is drawn
    const heading = prose.querySelector('h2')!;
    const style = getComputedStyle(heading);
    return {
      heading: { size: style.fontSize, lineHeight: style.lineHeight, weight: style.fontWeight },
      gaps: blocks.slice(1).map((block, i) => Math.round((block.getBoundingClientRect().top - blocks[i]!.getBoundingClientRect().bottom) * 10) / 10),
      cells: Array.from(output.querySelectorAll('th, td')).map((cell) => getComputedStyle(cell).fontSize),
      text: output.textContent ?? '',
    };
  });
  expect(drawn.heading, 'R1: the heading is the line’s size in bold').toEqual({ size: '12px', lineHeight: '18px', weight: '600' });
  expect(drawn.gaps, 'R1: blocks stand 4 px apart').toEqual(drawn.gaps.map(() => 4));
  expect(new Set(drawn.cells), 'R1: the table’s text is the line’s size').toEqual(new Set(['12px']));
  expect(drawn.text, 'drawn, not its source').not.toContain('##');
  expect(drawn.text, 'one drawing: opening shows the closed state’s text').toBe(shut.text);

  // an error: all of it in the error tag, in --danger
  const failed = await measure(row('Error: No messages to compact'));
  expect(failed.error).toBe(true);
  expect(failed.type.color, 'in --danger').toBe(await tokenValue(page, 'color', 'var(--danger)'));

  // a terminal's grid: preformatted in the monospace font, scrolling sideways, never wrapping, cut at two lines
  const grid = row('Context Usage · demo-model').filter({ has: page.locator('pre') });
  const gridShut = await measure(grid);
  expectNear(gridShut.output.height, 2 * gridShut.type.lineHeight, 'R19: a grid is cut at two of its lines');
  await grid.getByRole('button', { name: 'Show more' }).click();
  await mounted(page, grid);
  const pre = await grid.locator('.transcript-command-output > pre').evaluate((element) => ({
    whiteSpace: getComputedStyle(element).whiteSpace,
    font: getComputedStyle(element).fontFamily,
    lineHeight: parseFloat(getComputedStyle(element).lineHeight),
    sideways: element.scrollWidth > element.clientWidth,
    clientHeight: element.clientHeight,
    text: element.textContent,
  }));
  expect(pre.whiteSpace, 'R5: it does not wrap').toBe('pre');
  expect(pre.sideways, 'R5: wider than the column').toBe(true);
  await expectScrolls(grid.locator('.transcript-command-output > pre'), 'x', 'R5: the grid scrolls sideways inside the row');
  expectNear(pre.clientHeight, 4 * pre.lineHeight, 'R5: each of the grid’s four lines on one drawn line');
  expect(pre.font, 'a terminal’s grid is monospace').toBe(await tokenValue(page, 'fontFamily', 'var(--font-mono)'));
  expect(pre.text, 'one drawing').toBe(gridShut.text);

  // a line standing alone (an output before any turn): its command named first, in the line's own font (R23)
  const alone = row('Total cost: $0.0000');
  await mounted(page, alone);
  await expect(alone.locator('.transcript-command-name')).toHaveText(/^\/usage ·\s*$/);
  const fonts = await alone.evaluate((frame) => [frame.querySelector('.transcript-command-name')!, frame.querySelector('.transcript-command-output')!].map((el) => getComputedStyle(el).fontFamily));
  expect(fonts[0], 'R23: the command’s name in the line’s own font').toBe(fonts[1]);
  expect(fonts[0]).not.toBe(pre.font);
  expect(harness.consoleErrors()).toEqual([]);
});

// The words of the column-blocks fixture's fences (test/fixtures/transcript/events/column-blocks.events.jsonl)
const CHECKSUM_LINE = 'gauge_offset_reading_'.repeat(15).slice(0, 300);
const BENCH_LINES = ['north_bench_reading_', 'south_bench_reading_', 'west_bench_readings_'].map((word) => word.repeat(10));

// Acceptance 4 (O-07; decision 7, R6 to R9): a fenced block is Streamdown's, restyled. At each transcript width (the
// setting's 768, 960 and 1280 px): one frame (its outer box carries the one border and ground, at the table's radius)
// exactly the text column's width; no header band, the code starting where the frame's padding ends; long lines wrap inside it and nothing scrolls sideways; the
// first two source lines keep 32 px at their end on every line they wrap to, the third does not; the copy control is a
// 24 px target on its own ground and covers none of those lines' text; the body keeps its 480 px bound and scrolls down,
// which leaves the control in its place, and the control's row is sticky in the transcript's viewport (R8).
// The control copies the fence's one line as it is, and a selection of a whole block copied by hand has a line end
// between source lines only.
test('a code block wraps its long lines in one frame the column’s width, with no band over it and its copy control clear of the first lines’ text; the control and a selection copy the source’s line ends', async ({ harness }) => {
  const { page, app } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await loadAll(page, 'events/column-blocks');
  const answer = page.locator('[data-kind="assistant_text"] .transcript-answer');
  const fence = (text: string) => answer.locator('[data-streamdown="code-block"]').filter({ hasText: text });
  const [checksum, bench, loader] = [fence(CHECKSUM_LINE.slice(0, 40)), fence(BENCH_LINES[0]!.slice(0, 40)), fence('const step_40')];
  const tableRadius = await answer.locator('[data-streamdown="table-wrapper"]').first().evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
  const measure = (block: Locator) =>
    block.evaluate((frame) => {
      const box = (el: Element) => {
        const { left, top, right, bottom, width, height } = el.getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      const textRects = (el: Element) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return Array.from(range.getClientRects()).filter((rect) => rect.width > 0).map((rect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }));
      };
      const row = frame.closest('.transcript-row')!;
      const rowStyle = getComputedStyle(row);
      const style = getComputedStyle(frame);
      const body = frame.querySelector('[data-streamdown="code-block-body"]')!;
      const pre = body.querySelector('pre')!;
      const actions = frame.querySelector('[data-streamdown="code-block-actions"]')!;
      return {
        column: { left: box(row).left + parseFloat(rowStyle.paddingLeft), width: box(row).width - parseFloat(rowStyle.paddingLeft) - parseFloat(rowStyle.paddingRight) },
        frame: box(frame),
        look: { border: style.borderTopWidth, ground: style.backgroundColor, radius: style.borderTopLeftRadius, bodyBorder: getComputedStyle(body).borderTopWidth, bodyGround: getComputedStyle(body).backgroundColor, preGround: getComputedStyle(pre).backgroundColor },
        header: getComputedStyle(frame.querySelector('[data-streamdown="code-block-header"]')!).display,
        band: box(body).top - (box(frame).top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)),
        sideways: [frame, body, pre].map((el) => el.scrollWidth - el.clientWidth),
        lines: Array.from(pre.querySelector('code')!.children).map((line) => ({ box: box(line), pad: getComputedStyle(line).paddingRight, text: textRects(line) })),
        button: box(frame.querySelector('[data-streamdown="code-block-copy-button"]')!),
        controlGround: getComputedStyle(actions).backgroundColor,
        // the 480 px bound (STREAMDOWN_OPTIONS.codeBlockMaxHeight), on whichever of the body's boxes Streamdown puts it
        bound: [body, ...Array.from(body.querySelectorAll('*'))].filter((el) => getComputedStyle(el).maxHeight === '480px').map((el) => ({ client: el.clientHeight, scroll: el.scrollHeight })),
      };
    });

  await roomForWidths(harness);
  for (const width of TRANSCRIPT_WIDTHS) {
    await transcriptWidth(page, width);
    await mounted(page, checksum);
    const one = await measure(checksum);
    const three = await measure(bench);
    for (const [name, m] of [['the checksum fence', one], ['the bench fence', three]] as const) {
      expectNear(m.frame.width, m.column.width, `${width} px, ${name}: one frame exactly the column’s width`);
      expectNear(m.frame.left, m.column.left, `${width} px, ${name}: at the column’s left edge`);
      expect(m.header, `${width} px, ${name}: no header`).toBe('none');
      expect(Math.abs(m.band), `${width} px, ${name}, R6: no band over the code (${m.band} px)`).toBeLessThanOrEqual(1);
      expect(m.sideways.every((overflow) => overflow <= 0), `${width} px, ${name}: nothing scrolls sideways (${m.sideways.join(', ')})`).toBe(true);
      expect(m.look.border, `${name}, R7: the outer box carries the border`).not.toBe('0px');
      expect(m.look.ground, `${name}, R7: and the ground`).not.toBe(TRANSPARENT);
      expect([m.look.bodyBorder, m.look.bodyGround, m.look.preGround], `${name}, R7: the body and its pre carry neither`).toEqual(['0px', TRANSPARENT, TRANSPARENT]);
      expect(m.look.radius, `${name}, R7: the table’s radius`).toBe(tableRadius);
      expect(m.button.width >= 24 && m.button.height >= 24, `${name}, R9: the copy control is a 24 px target (${m.button.width} × ${m.button.height})`).toBe(true);
      expect(m.controlGround, `${name}, R8: the sticky control has its ground`).not.toBe(TRANSPARENT);
      for (const line of m.lines.slice(0, 2)) expect(line.text.some((rect) => overlaps(rect, m.button)), `${width} px, ${name}: the control covers none of the first lines’ text`).toBe(false);
    }
    expect(new Set(one.lines[0]!.text.map((rect) => Math.round(rect.top))).size, `${width} px: the 300-character line wraps`).toBeGreaterThan(1);
    // R7's room: 32 px at the end of every line source lines 1 and 2 wrap to; line 3 runs to the frame's edge
    const [first, second, third] = three.lines;
    for (const [n, line] of [[1, first!], [2, second!]] as const) {
      expect(line.pad, `${width} px: source line ${n} keeps 32 px at its end`).toBe('32px');
      expect(Math.max(...line.text.map((rect) => rect.right)), `${width} px: no drawn line of source line ${n} reaches into its 32 px`).toBeLessThanOrEqual(line.box.right - 32 + 0.5);
    }
    expect(third!.pad, `${width} px: source line 3 keeps none`).toBe('0px');
    expect(Math.max(...third!.text.map((rect) => rect.right)), `${width} px: source line 3’s drawn lines run past where the room starts`).toBeGreaterThan(third!.box.right - 32);
  }
  // the body's 480 px bound, and the code scrolls down inside it; scrolling the code leaves the control where it is, at the
  // frame's top right (R8)
  await mounted(page, loader);
  const tall = await measure(loader);
  expect(tall.bound, 'the body keeps its 480 px bound').toHaveLength(1);
  const [boxed] = tall.bound;
  expect(boxed!.client <= 480 && boxed!.scroll > boxed!.client, `the forty lines are taller than it (${boxed!.client} of ${boxed!.scroll} px)`).toBe(true);
  const codeScroll = await loader.evaluate((frame) => {
    const body = frame.querySelector<HTMLElement>('[data-streamdown="code-block-body"]')!;
    const viewport = [body, ...Array.from(body.querySelectorAll<HTMLElement>('*'))].find((el) => getComputedStyle(el).maxHeight === '480px')!;
    const control = frame.querySelector('[data-streamdown="code-block-copy-button"]')!;
    const place = () => {
      const [outer, own] = [frame.getBoundingClientRect(), control.getBoundingClientRect()];
      return { top: Math.round(own.top - outer.top), right: Math.round(outer.right - own.right) };
    };
    const before = place();
    viewport.scrollTop = 200;
    return { overflow: getComputedStyle(viewport).overflowY, offset: viewport.scrollTop, before, after: place() };
  });
  expect(['auto', 'scroll'], `the code’s viewport scrolls down (${codeScroll.overflow})`).toContain(codeScroll.overflow);
  expect(codeScroll.offset, 'an offset set on the code’s viewport holds').toBeGreaterThan(0);
  expect(codeScroll.after, 'R8: scrolling the code leaves the control in its place').toEqual(codeScroll.before);
  expect(codeScroll.before.top <= 16 && codeScroll.before.right <= 16, `R8: that place is the frame’s top right (${JSON.stringify(codeScroll.before)})`).toBe(true);
  // sticky: with the frame's top scrolled 160 px above the transcript's viewport, the control stays in view inside it.
  // The fence ends the fixture and the list has no trailing space, so in a 900 px window the scroll would stop short:
  // for this step the viewport is capped at 300 px, shorter than the frame, so the list can carry its top that far up (the
  // window cannot be made that short: main gives it a 600 px minimum height, src/main/window.ts).
  await page.evaluate(() => void (document.querySelector<HTMLElement>('[data-transcript-scroller]')!.style.maxHeight = '300px'));
  await settle(page, 300);
  await mounted(page, loader);
  const stuck = await loader.evaluate(async (frame) => {
    const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
    const control = frame.querySelector('[data-streamdown="code-block-copy-button"]')!;
    let sticky = false;
    for (let el = control.parentElement; el !== null && el !== frame; el = el.parentElement) sticky = sticky || getComputedStyle(el).position === 'sticky';
    scroller.scrollTop += frame.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 160;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const [view, outer, own] = [scroller.getBoundingClientRect(), frame.getBoundingClientRect(), control.getBoundingClientRect()];
    return { sticky, above: Math.round(view.top - outer.top), fromViewTop: Math.round(own.top - view.top), inside: own.bottom <= outer.bottom, viewport: scroller.clientHeight, frameHeight: Math.round(outer.height) };
  });
  expect(stuck.sticky, 'R8: the control’s row is sticky').toBe(true);
  expect(stuck.above, `the frame’s top is above the viewport (a ${stuck.viewport} px viewport, a ${stuck.frameHeight} px frame)`).toBeGreaterThan(100);
  expect(stuck.fromViewTop, 'R8: the control stays at the viewport’s top, not scrolled away with the frame’s').toBeGreaterThanOrEqual(-1);
  expect(stuck.inside, 'and inside its frame').toBe(true);
  await page.evaluate(() => void (document.querySelector<HTMLElement>('[data-transcript-scroller]')!.style.maxHeight = ''));
  await settle(page, 300);

  // the clipboard: the control takes the fence's one line as it is; a selection copied by hand, a line end between the
  // source lines only (a soft wrap is no character), with at most the one a selection that ends a block carries
  const pasteboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
  const benchText = BENCH_LINES.join('\n');
  await withNativeClipboard(app, [CHECKSUM_LINE, `${CHECKSUM_LINE}\n`, benchText, `${benchText}\n`], async () => {
    await mounted(page, checksum);
    await checksum.hover();
    await checksum.locator('[data-streamdown="code-block-copy-button"]').click();
    await expect.poll(async () => (await pasteboard()).replace(/\n$/, ''), { message: 'the control copies the one source line' }).toBe(CHECKSUM_LINE);
    await mounted(page, bench);
    await bench.evaluate((frame) => {
      const range = document.createRange();
      range.selectNodeContents(frame.querySelector('pre code')!);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
    await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find((contents) => contents.getURL() === url)!.copy(), page.url());
    await expect.poll(async () => (await pasteboard()).replace(/\n$/, ''), { message: 'a selection copied by hand holds exactly the source’s line ends' }).toBe(benchText);
  });
  expect(harness.consoleErrors()).toEqual([]);
});

// Acceptance 5 (O-08, reversing W2's breakout; decisions 8 and 9, R10, R11, M2-5): at each transcript width (768, 960 and
// 1280 px) a wide table and a code block are exactly the text column's width in an answer, in a commentary block and in
// a message to the person; a wide table's inner scroller scrolls sideways and its frame does not; a narrow table keeps
// the text's left edge. A table is one frame with one ground; its inner scroller keeps the 320 px bound and its cells wrap as before; its
// copy control adds no height, sits 9 px from the frame's outer top and right edges on its own ground, a 24 px target,
// and shows on hover or focus within.
test('a wide table and a code block are the text column’s width in an answer, a commentary and a message to the person; a wide table scrolls inside its one frame', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await loadAll(page, 'events/column-blocks');
  await page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness.expandAll()); // the commentary is the turn's work
  await settle(page, 300);
  const hosts = {
    answer: page.locator('[data-kind="assistant_text"] .transcript-answer'),
    commentary: page.locator('[data-kind="assistant_text"] .transcript-commentary'),
    message: page.locator('[data-kind="to_human"] .transcript-prose'),
  };
  for (const host of Object.values(hosts)) await expect(host).toHaveCount(1);
  const measure = (host: Locator) =>
    host.evaluate((element) => {
      // the text column: the host's content box, and for the answer the row's (the shared column, less its pads)
      const contentOf = (el: Element) => {
        const style = getComputedStyle(el);
        const { left, width } = el.getBoundingClientRect();
        return { left: left + parseFloat(style.paddingLeft), width: width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) };
      };
      const text = contentOf(element);
      const column = contentOf(element.closest('.transcript-row')!);
      const blocks = Array.from(element.querySelectorAll<HTMLElement>('[data-streamdown="table-wrapper"], [data-streamdown="code-block"]')).map((block) => {
        const { left, width } = block.getBoundingClientRect();
        const table = block.querySelector('table');
        const scroller = table === null ? null : (block.lastElementChild as HTMLElement);
        return { kind: block.dataset.streamdown!, left, width, frameScrolls: block.scrollWidth > block.clientWidth, wide: table !== null && table.getBoundingClientRect().width > width, scrollerScrolls: scroller !== null && scroller.scrollWidth > scroller.clientWidth };
      });
      return { text, column, blocks };
    });

  await roomForWidths(harness);
  for (const width of TRANSCRIPT_WIDTHS) {
    await transcriptWidth(page, width);
    for (const [name, host] of Object.entries(hosts)) {
      await mounted(page, host);
      const { text, column, blocks } = await measure(host);
      if (name === 'answer') expect([text.left, text.width], `${width} px: the answer’s text is the column`).toEqual([column.left, column.width]);
      expect(blocks.filter((block) => block.kind === 'code-block').length, `${name}: a code block`).toBeGreaterThan(0);
      expect(blocks.filter((block) => block.wide).length, `${name}: a table wider than the column`).toBeGreaterThan(0);
      for (const block of blocks) {
        expectNear(block.width, text.width, `${width} px, ${name}, its ${block.kind}: exactly the text column’s width`);
        expectNear(block.left, text.left, `${width} px, ${name}, its ${block.kind}: at the text’s left edge`);
        expect(block.frameScrolls, `${width} px, ${name}, its ${block.kind}: the frame does not scroll sideways`).toBe(false);
        if (block.wide) expect(block.scrollerScrolls, `${width} px, ${name}: the wide table’s inner scroller scrolls sideways`).toBe(true);
      }
      if (name === 'answer') expect(blocks[0], `${width} px: the narrow table keeps the text’s left edge`).toMatchObject({ kind: 'table-wrapper', wide: false });
    }
  }

  // the answer's wide table: its inner scroller takes a sideways scroll and its frame does not
  const wide = hosts.answer.locator('[data-streamdown="table-wrapper"]').filter({ hasText: 'Readings' });
  await mounted(page, wide);
  const scrolled = await wide.evaluate((frame) => {
    const scroller = frame.lastElementChild as HTMLElement;
    scroller.scrollLeft = 120;
    return { scroller: scroller.scrollLeft, frame: frame.scrollLeft };
  });
  expect(scrolled.scroller, 'the inner scroller moved').toBeGreaterThan(0);
  expect(scrolled.frame, 'the frame did not').toBe(0);
  // one frame, one ground; the cells wrap as before; the copy control adds no height
  const look = await wide.evaluate((frame) => {
    const [controls, scroller] = [frame.firstElementChild as HTMLElement, frame.lastElementChild as HTMLElement];
    const style = getComputedStyle(frame);
    const inner = getComputedStyle(scroller);
    const chrome = ['borderTopWidth', 'borderBottomWidth', 'paddingTop', 'paddingBottom'].reduce((sum, key) => sum + parseFloat(style[key as 'paddingTop']), 0);
    return {
      frame: [style.borderTopWidth !== '0px', style.backgroundColor !== 'rgba(0, 0, 0, 0)'],
      scroller: [inner.borderTopWidth, inner.backgroundColor],
      cells: [...new Set(Array.from(frame.querySelectorAll('td')).map((cell) => getComputedStyle(cell).whiteSpace))],
      controlsPlaced: getComputedStyle(controls).position,
      addedHeight: frame.getBoundingClientRect().height - chrome - scroller.getBoundingClientRect().height,
    };
  });
  expect(look.frame, 'R10: the frame carries a border and the ground').toEqual([true, true]);
  expect(look.scroller, 'R10: the inner scroller neither').toEqual(['0px', TRANSPARENT]);
  expect(look.cells, 'R11: cells wrap as before').not.toContain('nowrap');
  expect(look.controlsPlaced, 'the control’s row is out of the flow').toBe('absolute');
  expect(Math.abs(look.addedHeight), `the copy control adds no height (${look.addedHeight} px)`).toBeLessThanOrEqual(1);
  // the control: hidden at rest, shown on hover and on focus within, 9 px from the outer top and right, a 24 px target
  const controls = wide.locator(':scope > div').first();
  const copy = controls.locator(':scope > div > button').first();
  await page.mouse.move(0, 0);
  await expect(controls).toHaveCSS('opacity', '0');
  await wide.hover();
  await expect(controls).toHaveCSS('opacity', '1');
  const [frameBox, controlsBox, copyBox] = [await boxOf(wide), await boxOf(controls), await boxOf(copy)];
  expectNear(controlsBox.top - frameBox.top, 9, 'M2-5: 9 px from the frame’s outer top');
  expectNear(frameBox.right - controlsBox.right, 9, 'M2-5: 9 px from its outer right');
  expect(copyBox.width >= 24 && copyBox.height >= 24, `R9: a 24 px target (${copyBox.width} × ${copyBox.height})`).toBe(true);
  expect(await controls.evaluate((element) => getComputedStyle(element).backgroundColor), 'R10: on its own ground').not.toBe(TRANSPARENT);
  await page.mouse.move(0, 0);
  await expect(controls).toHaveCSS('opacity', '0');
  await copy.focus();
  await expect(controls, 'shown on focus within').toHaveCSS('opacity', '1');
  // the 320 px bound: a tall table scrolls down inside it
  const tall = hosts.answer.locator('[data-streamdown="table-wrapper"]').filter({ hasText: 'day 24' });
  await mounted(page, tall);
  const bound = await tall.evaluate((frame) => {
    const scroller = frame.lastElementChild as HTMLElement;
    // the 320 px bound (STREAMDOWN_OPTIONS.tableMaxHeight), on the scroller or a box inside it
    return [scroller, ...Array.from(scroller.querySelectorAll('*'))].filter((el) => getComputedStyle(el).maxHeight === '320px').map((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
  });
  expect(bound, 'the inner scroller keeps its 320 px bound').toHaveLength(1);
  expect(bound[0]!.scroll > bound[0]!.client && bound[0]!.client <= 320, `the tall table is taller than it (${bound[0]!.client} of ${bound[0]!.scroll} px)`).toBe(true);
  const tallScroll = await tall.evaluate((frame) => {
    const scroller = frame.lastElementChild as HTMLElement;
    const viewport = [scroller, ...Array.from(scroller.querySelectorAll<HTMLElement>('*'))].find((el) => getComputedStyle(el).maxHeight === '320px')!;
    viewport.scrollTop = 120;
    return { overflow: getComputedStyle(viewport).overflowY, offset: viewport.scrollTop };
  });
  expect(['auto', 'scroll'], `the tall table scrolls down inside it (${tallScroll.overflow})`).toContain(tallScroll.overflow);
  expect(tallScroll.offset, 'an offset set on it holds').toBeGreaterThan(0);
  expect(harness.consoleErrors()).toEqual([]);
});

// Acceptance 6 (O-02, amending W2's B2; decision 10, R12 to R14, R20 to R22, M2-2): the owner's time, Copy and Edit sit
// on one line under the bubble, at its side, shown on hover or focus within, in the 16 px the row already has under the
// bubble: the row is the bubble's height plus 16 px at rest, hovered and focused, a short message and one of twenty lines
// alike, at each transcript width (768, 960 and 1280 px). At rest the controls take no width, so a caption has the whole line; shown, they stand left of it in the order
// time, Copy, Edit, and the caption (or "Not sent") stays flush with the bubble's edge without moving. Tab reaches Copy.
// In a pane too narrow for the line the caption alone shrinks. Copy's and Edit's targets overhang the line 6 px up and
// 2 px down and overlap neither each other nor the turn line's button at 360 and 280 px; their focus rings, at offset 0,
// cover no neighbour's words. The nineteen-line fold still works.
test('the owner’s time, Copy and Edit sit on one line under the bubble, shown on hover or focus within, and the row keeps its height', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page); // no blockHumanInput: Tab is pressed
  await loadAll(page, 'events/message-actions');
  const userRow = (text: string) => page.locator('.transcript-row[data-kind="user"]').filter({ hasText: text });
  const short = userRow('Check the north gauge against the bench rig.');
  const steer = userRow("Also note the rig's serial number.");
  const long = userRow("Here are this week's gauge notes:");
  const measure = async (row: Locator) => {
    await mounted(page, row);
    return row.evaluate((frame) => {
      const box = (el: Element) => {
        const { left, top, right, bottom, width, height } = el.getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      const frameStyle = getComputedStyle(frame);
      const line = frame.querySelector('.transcript-user-line')!;
      const actions = line.querySelector('.transcript-user-line-actions')!;
      const tail = line.querySelector<HTMLElement>('.transcript-user-caption, .transcript-not-sent');
      return {
        row: box(frame),
        column: { left: box(frame).left + parseFloat(frameStyle.paddingLeft), right: box(frame).right - parseFloat(frameStyle.paddingRight) },
        bubble: box(frame.querySelector('[data-bubble]')!),
        line: box(line),
        lineScrolls: line.scrollWidth > line.clientWidth + 1,
        actions: box(actions),
        shown: getComputedStyle(actions).opacity,
        parts: [...Array.from(actions.children), ...(tail ? [tail] : [])].map((part) => ({ text: part.textContent ?? '', box: box(part) })),
        tail: tail && { box: box(tail), whole: tail.scrollWidth <= tail.clientWidth, title: tail.title, last: line.lastElementChild === tail },
      };
    });
  };
  const atRest = async () => {
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  };
  const checkRow = async (row: Locator, name: string, words: string[], caption: string | null) => {
    await atRest();
    const rest = await measure(row);
    expect(rest.shown, `${name}: at rest the controls are hidden`).toBe('0');
    expect(rest.actions.width, `${name}, R20: at rest they take no width`).toBe(0);
    expect(rest.row.height - rest.bubble.height, `${name}: the row is the bubble’s height plus 16 px`).toBe(16);
    await row.hover();
    await expect(row.locator('.transcript-user-line-actions'), `${name}: shown on hover`).toHaveCSS('opacity', '1');
    const hovered = await measure(row);
    expect(hovered.row.height, `${name}: hovering adds no height`).toBe(rest.row.height);
    expect(hovered.parts.map((part) => part.text), `${name}, R12: time, Copy, Edit, then the caption`).toEqual([expect.stringMatching(/\d/), ...words, ...(caption === null ? [] : [caption])]);
    const lefts = hovered.parts.map((part) => part.box.left);
    expect(lefts, `${name}, R12: in that order on the line`).toEqual([...lefts].sort((a, b) => a - b));
    expect(hovered.line.top, `${name}: under the bubble`).toBeGreaterThanOrEqual(hovered.bubble.bottom - 0.5);
    expect(hovered.line.bottom, `${name}: inside the row`).toBeLessThanOrEqual(hovered.row.bottom + 0.5);
    if (caption === null) expectNear(hovered.actions.right, hovered.bubble.right, `${name}: the controls end at the bubble’s edge`);
    else {
      expectNear(hovered.tail!.box.right, hovered.bubble.right, `${name}, R12: the caption flush with the bubble’s edge`);
      expect(hovered.tail!.box, `${name}, R20: the caption does not move when the controls appear`).toEqual(rest.tail!.box);
    }
    await atRest();
    await row.getByRole('button', { name: 'Copy' }).focus();
    await expect(row.locator('.transcript-user-line-actions'), `${name}: shown on focus within`).toHaveCSS('opacity', '1');
    expect((await measure(row)).row.height, `${name}: focus adds no height`).toBe(rest.row.height);
  };
  // at each transcript width
  await roomForWidths(harness);
  for (const width of TRANSCRIPT_WIDTHS) {
    await transcriptWidth(page, width);
    await checkRow(short, `${width} px, a one-line message`, ['Copy', 'Edit'], null);
    await checkRow(steer, `${width} px, a steer`, ['Copy', 'Edit'], 'Sent during this turn');
    await checkRow(long, `${width} px, a message of twenty lines`, ['Copy', 'Edit'], null);
  }
  await transcriptWidth(page, 768);

  // the nineteen-line fold still works under the line
  await mounted(page, long);
  await expect(long.locator('[data-bubble]')).toHaveAttribute('data-collapsed', '');
  await long.getByRole('button', { name: 'Show more' }).click();
  await expect(long.locator('[data-bubble]')).toHaveAttribute('data-open', '');
  const opened = await measure(long);
  expect(opened.row.height - opened.bubble.height, 'opened, still the bubble’s height plus 16 px').toBe(16);
  await long.getByRole('button', { name: 'Show less' }).click();

  // Tab reaches Copy from the message's row and shows the controls (R20); the rings sit at offset 0 and cover no words (R22)
  await atRest();
  await mounted(page, short);
  await short.focus();
  await page.keyboard.press('Tab');
  const copy = short.getByRole('button', { name: 'Copy' });
  await expect(copy, 'R20: Tab lands on Copy').toBeFocused();
  await expect(short.locator('.transcript-user-line-actions')).toHaveCSS('opacity', '1');
  const turnId = await short.getAttribute('data-turn-id');
  const turnLine = page.locator(`.transcript-row[data-kind="divider"][data-turn-id="${turnId}"]`);
  for (const control of [copy, short.getByRole('button', { name: 'Edit' })]) {
    if (!(await control.evaluate((element) => element === document.activeElement))) await page.keyboard.press('Tab');
    await expect(control).toBeFocused();
    const ring = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      const width = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset));
      const { left, top, right, bottom } = element.getBoundingClientRect();
      return { offset: style.outlineOffset, box: { left: left - width, top: top - width, right: right + width, bottom: bottom + width, width: right - left + 2 * width, height: bottom - top + 2 * width } };
    });
    expect(ring.offset, 'R22: the ring at offset 0').toBe('0px');
    const words = await page.evaluate(
      ([turn]) => {
        const rects = (el: Element | null) => {
          if (!el) return [];
          const range = document.createRange();
          range.selectNodeContents(el);
          return Array.from(range.getClientRects()).filter((rect) => rect.width > 0).map((rect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }));
        };
        const user = Array.from(document.querySelectorAll(`.transcript-row[data-kind="user"][data-turn-id="${turn}"]`)).find((row) => row.textContent?.includes('Check the north gauge'));
        return [...rects(user?.querySelector('[data-user-content]') ?? null), ...rects(document.querySelector(`.transcript-row[data-kind="divider"][data-turn-id="${turn}"] button`))];
      },
      [turnId] as const,
    );
    expect(words.length, 'the bubble’s and the turn line’s words were read').toBeGreaterThan(0);
    expect(words.filter((rect) => overlaps(rect, ring.box)), 'R22: the ring covers no neighbour’s words').toEqual([]);
  }

  // R21: Copy's and Edit's targets overhang the line 6 px up and 2 px down; at 360 and 280 px neither overlaps the other
  // or the turn line's button. R20 at 280 px: at rest the caption is whole.
  for (const width of [360, 280]) {
    await paneWidth(page, width);
    await atRest();
    if (width === 280) {
      const rest = await measure(steer);
      expect(rest.tail!.whole, '280 px, R20: at rest the caption is whole').toBe(true);
    }
    await mounted(page, short);
    await short.getByRole('button', { name: 'Copy' }).focus();
    await expect(short.locator('.transcript-user-line-actions')).toHaveCSS('opacity', '1');
    const line = await boxOf(short.locator('.transcript-user-line'));
    const [copyBox, editBox, turnButton] = [await boxOf(short.getByRole('button', { name: 'Copy' })), await boxOf(short.getByRole('button', { name: 'Edit' })), await boxOf(turnLine.locator('button').first())];
    for (const [name, target] of [['Copy', copyBox], ['Edit', editBox]] as const) {
      expectNear(line.top - target.top, 6, `${width} px, R21: ${name}’s target overhangs 6 px up`);
      expectNear(target.bottom - line.bottom, 2, `${width} px, R21: and 2 px down`);
      expect(target.height, `${width} px, R9 and R21: ${name} is a 24 px target`).toBeGreaterThanOrEqual(24);
      expect(overlaps(target, turnButton), `${width} px, R21: ${name}’s target clear of the turn line’s button`).toBe(false);
    }
    expect(overlaps(copyBox, editBox), `${width} px, R21: Copy’s and Edit’s targets do not overlap`).toBe(false);
  }

  // R14: where the line cannot fit, the caption alone shrinks, cut with an ellipsis, its sentence its title; the controls
  // keep their width and nothing wraps or spills past the column
  await paneWidth(page, 1280);
  await mounted(page, steer);
  await steer.getByRole('button', { name: 'Copy' }).focus();
  const wideControls = (await measure(steer)).actions.width;
  await paneWidth(page, 200);
  await mounted(page, steer);
  await steer.getByRole('button', { name: 'Copy' }).focus();
  const narrow = await measure(steer);
  expect(narrow.tail!.whole, '200 px, R14: the caption is cut').toBe(false);
  expect(narrow.tail!.title, 'its whole sentence as its title').toBe('Sent during this turn');
  expectNear(narrow.actions.width, wideControls, '200 px, R14: the controls keep their width');
  expect(narrow.line.height, 'nothing wraps').toBe(16);
  expect(narrow.lineScrolls, 'nothing spills').toBe(false);
  expect(narrow.line.left >= narrow.column.left - 0.5 && narrow.line.right <= narrow.column.right + 0.5, 'the line stays inside the column').toBe(true);

  // M2-2: a dropped prompt's "Not sent" stands last on the line, always shown, flush with the bubble's edge
  await paneWidth(page, 1280);
  await loadAll(page, 'transcript/idle-drop');
  await atRest();
  const dropped = await measure(userRow('Summarise the last release notes.'));
  expect(dropped.tail, 'M2-2: “Not sent” last on the line').toMatchObject({ last: true, whole: true });
  expect(dropped.parts.at(-1)!.text).toBe('Not sent');
  expectNear(dropped.tail!.box.right, dropped.bubble.right, 'M2-2: flush with the bubble’s edge');
  await expect(page.locator('.transcript-not-sent')).toBeVisible();
  expect(harness.consoleErrors()).toEqual([]);
});

// Acceptance 7 (l2-transcript-07; decisions 12 to 15, R15): the last answer before the owner's next prompt, and the list's
// last answer, carry Copy, "Fork from here" and the answer's time, always laid out and shown on hover: hovering moves
// nothing. The row is 20 px tall, stands 12 px up in the answer's padding with 8 px under it. Copy takes every block of
// the answer, whatever the drawn list holds; Fork forks from before the next prompt (or the whole conversation under the
// last answer). The harness names each act in a toast.
test('the last answer before the owner’s next prompt offers Copy, Fork from here and its time on hover, moving nothing; Copy takes both blocks of the answer', async ({ harness }) => {
  const { page, app } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await loadAll(page, 'events/message-actions');
  const answer = (text: string) => page.locator('.transcript-row[data-kind="assistant_text"]').filter({ hasText: text });
  const firstBlock = answer('The north gauge reads 0.42 mm high');
  const secondBlock = answer('I logged the offset in the checklist');
  const last = answer('All twenty gauges read within their windows');
  const next = page.locator('.transcript-row[data-kind="user"]').filter({ hasText: 'Here are this week' });
  await mounted(page, secondBlock);
  await expect(firstBlock.locator('.transcript-answer-actions'), 'the answer’s first block carries none').toHaveCount(0);
  const actions = secondBlock.locator('.transcript-answer-actions');
  await expect(actions.locator(':scope > *')).toHaveText(['Copy', 'Fork from here', /\d/]);
  await expect(actions.getByRole('button', { name: 'Fork from here' })).toHaveAttribute('title', 'Starts a new session from this point. This one stays as it is.');
  await expect(actions.getByRole('button', { name: 'Fork from here' })).toBeEnabled();

  await page.mouse.move(0, 0);
  await expect(actions).toHaveCSS('opacity', '0');
  const before = [await boxOf(secondBlock), await boxOf(next), await boxOf(actions)];
  await secondBlock.hover();
  await expect(actions, 'shown on hover').toHaveCSS('opacity', '1');
  expect([await boxOf(secondBlock), await boxOf(next), await boxOf(actions)], 'hovering moves nothing').toEqual(before);
  const placed = await secondBlock.evaluate((frame) => {
    const row = frame.getBoundingClientRect();
    const text = frame.querySelector('.transcript-answer')!.getBoundingClientRect();
    const bar = frame.querySelector('.transcript-answer-actions')!.getBoundingClientRect();
    return { height: bar.height, up: text.bottom - bar.top, under: row.bottom - parseFloat(getComputedStyle(frame).paddingBottom) - bar.bottom };
  });
  expect(placed, 'R15: 20 px tall, 12 px up in the answer’s padding, 8 px under it: 16 px more than an answer without it').toEqual({ height: 20, up: 12, under: 8 });

  // Fork: from before the next prompt here, from the whole conversation under the last answer
  await actions.getByRole('button', { name: 'Fork from here' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'forkFrom u-msg-2' }), 'Fork from here forks from before the next prompt').toBeVisible();
  await mounted(page, last);
  await last.hover();
  await last.getByRole('button', { name: 'Fork from here' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'forkFrom the whole conversation' }), 'under the last answer, the whole conversation').toBeVisible();

  // Copy: both blocks of the answer, as markdown
  const both = ['The north gauge reads 0.42 mm high, and the bench rig agrees within 0.01 mm.', "I logged the offset in the checklist with the rig's serial number:\n\n- north: 0.42 mm, rig R7\n- south: 0.03 mm, rig R3"].join('\n\n');
  await withNativeClipboard(app, [both], async () => {
    await mounted(page, secondBlock);
    await secondBlock.hover();
    await actions.getByRole('button', { name: 'Copy' }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { message: 'Copy takes both blocks of the answer' }).toBe(both);
  });
  expect(harness.consoleErrors()).toEqual([]);
});

// The streaming caret sits after the last word of the answer, inside its paragraph, not on a line of its own below it.
test('the streaming caret follows the last word of a one-paragraph answer', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await load(page, 'events/streaming-block');
  // Up to the answer's first delta (s5): the text block is live.
  for (let i = 0; i < 6; i += 1) await page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness.step());
  const prose = page.locator('[data-kind="assistant_text"] .transcript-prose');
  await expect(prose).toHaveCount(1);
  await expect(prose).toHaveAttribute('style', /--streamdown-caret/);
  const caret = await prose.evaluate((element) => {
    const block = element.lastElementChild!; // the block's wrapper
    const paragraph = block.lastElementChild!;
    return { wrapper: getComputedStyle(block, '::after').content, tag: paragraph.tagName, paragraph: getComputedStyle(paragraph, '::after').content };
  });
  expect(caret).toEqual({ wrapper: 'none', tag: 'P', paragraph: '" ▋"' });
  // A live answer whose last block is a code block or a table, where Streamdown sets no caret, shows ours at its foot.
  const blockCaret = await prose.evaluate((element) =>
    ['code-block', 'table-wrapper'].map((kind) => {
      const wrapper = element.appendChild(document.createElement('div'));
      wrapper.dir = 'ltr';
      wrapper.style.display = 'contents';
      const block = wrapper.appendChild(document.createElement('div'));
      block.dataset.streamdown = kind;
      const content = getComputedStyle(block, '::after').content;
      wrapper.remove();
      return content;
    }),
  );
  expect(blockCaret).toEqual(['"▋"', '"▋"']);
  // Complete, the caret is gone.
  for (let i = 0; i < 4; i += 1) await page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness.step());
  await expect(prose).not.toHaveAttribute('style', /--streamdown-caret/);
  expect(await prose.evaluate((element) => getComputedStyle(element.querySelector('p')!, '::after').content)).toBe('none');
  expect(harness.consoleErrors()).toEqual([]);
});

// Acceptance item 9: the drill-in is this same Transcript with `variant: 'child'` over the child's own events (C8's
// panel does this through the public surface; the harness stands in for it).
test('child transcript renders the subagent\u2019s events only', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await loadAll(page, 'pass1/subagent');
  await page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness.expandAll({ cells: true }));
  await settle(page, 300);

  // The parent: one subagent row for both agents, none of the children's own rows (their Read calls and answers).
  const parent = page.locator('.transcript').first();
  const subagent = parent.locator('[data-kind="subagent"]');
  await expect(subagent).toHaveCount(1);
  const CHILD_READS = ['cell:toolu_01WHcNPsuUXRb5uAumPGpTyF', 'cell:toolu_01Vadxauaer5nCja9in7PkB8'];
  for (const id of CHILD_READS) await expect(parent.locator(`[data-cell-id="${id}"]`)).toHaveCount(0);

  // Opening the first agent is C8's call (a toast here); "Show child" mounts the child transcript beside the parent.
  await subagent.getByRole('button', { name: 'Open Read and report one.txt content' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'openSubagent ad286defbc77bc090' })).toBeVisible();
  await page.getByRole('button', { name: 'Show child · Read and report one.txt content' }).click();
  const child = page.locator('[data-harness-child]');
  await expect(child.locator('.transcript')).toHaveCount(1);
  await expect(child.locator('[data-kind="assistant_text"]')).toHaveText(['ONE']);
  // The parent reported the child finished, so the child's turn is closed: its divider has settled (not "Working for …")
  // and, like any closed turn, its work area opens from the divider.
  const childDivider = child.locator('[data-kind="divider"] button[aria-expanded]').first();
  await expect(childDivider).toHaveText(/^Worked for /);
  await expect(childDivider).toHaveAttribute('aria-expanded', 'false');
  await childDivider.click();
  await expect(child.locator(`[data-cell-id="${CHILD_READS[0]}"]`)).toHaveCount(1);
  await expect(child.locator(`[data-cell-id="${CHILD_READS[0]}"] button`).first()).toHaveText(/^Read /);
  // Only that agent's events: not the other agent's Read, not the parent's prompt, sentence or answers.
  await expect(child.locator(`[data-cell-id="${CHILD_READS[1]}"]`)).toHaveCount(0);
  await expect(child.locator('[data-kind="user"], [data-kind="subagent"]')).toHaveCount(0);
  // The parent is unchanged by the drill-in.
  await expect(subagent).toHaveCount(1);
  for (const id of CHILD_READS) await expect(parent.locator(`[data-cell-id="${id}"]`)).toHaveCount(0);
  expect(harness.consoleErrors()).toEqual([]);
});

// Expand-old-work over the fixtures: every turn, group and cell of every journal and event fixture opened, the list
// walked a viewport at a time so every row mounts, no row of those kinds left empty, no console error. A loaded machine
// (inside `pnpm verify`) slows the walk several times over, so the case has time per fixture rather than one budget for
// the whole walk, and every wait inside a fixture is on its settled state and bounded (a hang fails naming it).
const PER_FIXTURE_MS = 20_000;
test('every fixture renders its whole work area expanded', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  const fixtures = (await fixtureNames(page)).filter((name) => !name.startsWith('synthetic/'));
  expect(fixtures.length).toBeGreaterThan(40);
  test.setTimeout(60_000 + fixtures.length * PER_FIXTURE_MS);
  const WORK_KINDS = ['group', 'cell', 'subagent', 'agent_message', 'notice', 'bash', 'plan', 'question', 'boundary', 'error']; // UX wave U3: `notice` (pass3/stop-task draws one)
  const seen = new Map<string, number>();
  for (const fixture of fixtures) {
    await loadAll(page, fixture);
    await page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness.expandAll({ cells: true }));
    await settle(page, 200);
    const walked = await page.evaluate(async (workKinds) => {
      const scroller = document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
      const kinds: Record<string, number> = {};
      const empty: string[] = [];
      const rows = new Set<string>();
      // After a scroll, until the mounted rows are the same two frames running: a slow page mounts them late.
      const mounted = async () => {
        const deadline = performance.now() + 10_000;
        const ids = () => Array.from(scroller.querySelectorAll<HTMLElement>('[data-row-id]'), (row) => row.dataset.rowId).join(' ');
        let last = '';
        for (let now = ids(); now !== last || now === ''; now = ids()) {
          if (performance.now() > deadline) throw new Error(`rows still mounting 10 s after a scroll (at ${scroller.scrollTop} px)`);
          last = now;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }
      };
      scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); // a reader walks the virtual range
      scroller.scrollTop = 0;
      await mounted();
      for (let guard = 0; guard < 400; guard += 1) {
        for (const row of Array.from(scroller.querySelectorAll<HTMLElement>('[data-row-id]'))) {
          const id = row.dataset.rowId!;
          if (rows.has(id)) continue;
          rows.add(id);
          const kind = row.querySelector<HTMLElement>('[data-kind]')?.dataset.kind ?? '';
          kinds[kind] = (kinds[kind] ?? 0) + 1;
          if (workKinds.includes(kind) && (row.querySelector('[data-kind]')?.childElementCount ?? 0) === 0) empty.push(id);
        }
        if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1) break;
        scroller.scrollTop += scroller.clientHeight;
        await mounted();
      }
      return { kinds, empty, rows: rows.size };
    }, WORK_KINDS).catch((error: Error) => {
      throw new Error(`${fixture}: ${error.message}`, { cause: error });
    });
    expect(walked.empty, `${fixture}: every row renders its component`).toEqual([]);
    expect(walked.rows, `${fixture}: rows rendered`).toBeGreaterThan(0);
    for (const [kind, n] of Object.entries(walked.kinds)) seen.set(kind, (seen.get(kind) ?? 0) + n);
    expect(harness.consoleErrors(), `${fixture}: no console errors`).toEqual([]);
  }
  const report = { fixtures: fixtures.length, kinds: Object.fromEntries([...seen].sort()) };
  console.log(`expanded fixtures: ${JSON.stringify(report)}`);
  test.info().annotations.push({ type: 'expanded fixtures', description: JSON.stringify(report) });
  for (const kind of WORK_KINDS) expect(seen.get(kind) ?? 0, `some fixture renders a ${kind} row`).toBeGreaterThan(0);
  expect(seen.get('receipt') ?? 0, 'no fixture restores the removed files-changed card').toBe(0);
});

// R1 (charter D-9 as amended 2026-10-01): a mod's toast, log lines and status line, from the pushes R0 recorded on the
// installed 2.1.287 (a session.start log, status and toast before the initialize answer; a turn.complete log and status
// after the turn's result), replayed through the replay transport into the product app's session tab. A scratch config
// home holds one transcript for a scratch directory, so C4 indexes a record the sidebar shows; no engine runs.
test('a mod’s toast, log lines and status line show in the session (R1, pass3/mods-pushes)', async () => {
  test.setTimeout(120_000);
  const fixture = 'spikes/protocol-probe/fixtures/pass3/mods-pushes.jsonl';
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-r1-mods-')));
  const repo = join(root, 'repo');
  const config = join(root, 'claude-config');
  mkdirSync(repo);
  const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  const engineId = randomUUID();
  const first = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: 'a session with a mod' }, uuid: randomUUID(), timestamp: '2026-10-01T10:00:00.000Z', cwd: repo, sessionId: engineId, version: '2.1.287' };
  writeFileSync(join(project, `${engineId}.jsonl`), `${JSON.stringify(first)}\n`);
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: config } });
  try {
    const { page } = maws;
    // Every toast text the page shows, whenever it shows (the toast leaves after its 4 s)
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __toasts: string[] }).__toasts = seen;
      new MutationObserver(() => {
        for (const toast of Array.from(document.querySelectorAll('[role="region"][aria-label^="Notifications"] li'))) {
          const text = toast.textContent ?? '';
          if (!seen.includes(text)) seen.push(text);
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    let id = '';
    await expect.poll(async () => (id = value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === engineId)?.appId ?? '')).not.toBe('');
    await (await sidebarRow(page, { appSessionId: id })).click();
    const pane = page.locator('[data-region="main"] [data-pane="0"]');
    await expect(pane.locator(`[data-composer="${await addressed(page, id)}"]`)).toBeVisible();

    // The index seed may hydrate before launch. Make that history deterministic rather than letting a
    // lazy transcript's timing decide whether the startup log is the first row in the whole transcript.
    await expect(pane.locator('[data-kind="user"]').filter({ hasText: 'a session with a mod' })).toBeVisible();
    await launchReady(page, id, fixture, { cwd: repo }); // the fixture answers initialize after the session.start pushes (seq 4-7)
    await expect.poll(() => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts), { timeout: 20_000 }).toContainEqual(expect.stringContaining('mods-probe: MODS_PROBE_TOAST start'));
    value(await invoke(page, 'session.send', { appSessionId: id as never, content: 'Reply with exactly MODS_PROBE_OK' })); // as recorded (seq 9); the replay holds at it
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: id as never })).turn, { timeout: 20_000 }).toBeNull();

    // the log lines, dim notices under the plugin's name, at their arrival positions: before the turn and after it
    const notices = pane.locator('.transcript-error[data-scope="plugin"]');
    await expect(notices).toHaveText(['mods-probe: MODS_PROBE_LOG start surface=null interactive=false', 'mods-probe: MODS_PROBE_LOG turn']);
    const order = await pane.locator('[data-row-id]').evaluateAll((rows) => rows.map((row) => ({ kind: row.querySelector('[data-kind]')?.getAttribute('data-kind'), text: row.textContent ?? '' })).filter((row) => row.kind !== 'time'));
    const start = order.findIndex((row) => row.text.includes('mods-probe: MODS_PROBE_LOG start'));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(order.slice(start, start + 2).map((row) => row.kind)).toEqual(['error', 'user']);
    expect(order[start + 1].text).toContain('Reply with exactly MODS_PROBE_OK');
    expect(order.at(-1)?.text).toContain('mods-probe: MODS_PROBE_LOG turn');
    // The latest pinned plugin status line lives inside the floating Connectors card.
    const plugins = await unfoldSessionCard(page, 'Connectors');
    await expect(plugins).toContainText('mods-probe · MODS_PROBE_STATUS turn');
    await expect(plugins).not.toContainText('MODS_PROBE_STATUS start');
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

// R2 (charter D-9 as amended 2026-10-01; the waves plan's R2 rulings): MAWS attached as the engine's desktop surface,
// from the sites R2 recorded on the installed 2.1.287 (pass3/mods-surface-*) replayed through the replay transport into
// the product app's session tab. The replay answers the surface's renders from the fixture by site and instance; the
// person's presses are held and matched in order. A scratch config home holds one transcript for a scratch directory,
// so C4 indexes a record the sidebar shows; no engine runs. P2-C (2026-10-09): these record P1's drawing of the owner's
// mod, so the owner channel's lane is switched off first (with it on, MAWS draws the marks itself: the M5 case below).
type SurfaceSeed = (base: { repo: string; engineId: string }) => Record<string, unknown>[];
async function surfaceReplay(fixture: string | ((root: string) => string), body: (ctx: { page: Page; id: string; pane: ReturnType<Page['locator']>; userData: string }) => Promise<void>, seed?: SurfaceSeed, beforeLaunch?: (pane: ReturnType<Page['locator']>) => Promise<void>, attached = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-r2-surface-')));
  const repo = join(root, 'repo');
  const config = join(root, 'claude-config');
  mkdirSync(repo);
  const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  const replayPath = typeof fixture === 'function' ? fixture(root) : `spikes/protocol-probe/fixtures/pass3/${fixture}.jsonl`;
  // Reconnect to the same engine identity as both the seed and recording. A fresh launch would replace the selected
  // indexed session with an empty chat and leave this history attached to a different sidebar row.
  const engineId = seed ? recordedSurfaceSessionId(replayPath.startsWith('/') ? replayPath : join(REPO_ROOT, replayPath)) : randomUUID();
  const first = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: 'a session with a mod that draws' }, uuid: randomUUID(), timestamp: '2026-10-02T06:00:00.000Z', cwd: repo, sessionId: engineId, version: '2.1.287' };
  const seedRecords = seed?.({ repo, engineId }) ?? [first];
  writeFileSync(join(project, `${engineId}.jsonl`), seedRecords.map((record) => JSON.stringify(record)).join('\n') + '\n');
  if (seed) addSurfaceSeedEchoes(replayPath, seedRecords);
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: config } });
  try {
    const { page } = maws;
    value(await invoke(page, 'settings.set', { mods: { toHuman: { enabled: false } } })); // P2-C: P1's drawing
    let id = '';
    await expect.poll(async () => (id = value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === engineId)?.appId ?? '')).not.toBe('');
    await (await sidebarRow(page, { appSessionId: id })).click();
    // Do not leave the test pointer parked on the sidebar: its hover card can cover the work disclosure.
    await page.mouse.move(0, 0);
    await expect(page.getByTestId('hover-meta')).toBeHidden();
    const pane = page.locator('[data-region="main"] [data-pane="0"]');
    await expect(pane.locator(`[data-composer="${await addressed(page, id)}"]`)).toBeVisible();
    await beforeLaunch?.(pane);
    if (attached) {
      await launchReady(page, id, replayPath, { cwd: repo, ...(seed ? { resume: { sessionId: engineId as never, fork: false } } : {}) });
      await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: id as never })).uiSurface).toEqual({ clientId: 'maws-main' });
    }
    await body({ page, id, pane, userData: maws.userData });
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
}

test('a mod’s band, mode slot, hint and pane draw in the session (R2, pass3/mods-surface-render-sites)', async () => {
  test.setTimeout(120_000);
  await surfaceReplay('mods-surface-render-sites', async ({ page, id, pane }) => {
    // the band above the composer frame, its Button and Input drawn in MAWS's own controls
    const band = pane.getByRole('region', { name: 'From plugins' });
    await expect(band).toContainText('MODS_PROBE_BAND presses=0 typed= submitted= working=false', { timeout: 20_000 });
    await expect(band.getByRole('button', { name: 'Press' })).toBeVisible();
    await expect(band.getByRole('textbox', { name: 'Reply' })).toHaveAttribute('placeholder', 'Type here');
    const frame = pane.locator('[data-composer-frame]');
    expect(await band.evaluate((el, f) => !!f && (el.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, await frame.elementHandle())).toBe(true); // above the frame
    // the mode slot after the permission mode in the toolbar, and the hint under the frame
    const toolbar = pane.getByRole('toolbar', { name: 'Composer tools' });
    await expect(toolbar.getByLabel('Plugin modes')).toHaveText('MODS_PROBE_MODE modes=0');
    await expect(pane.getByLabel('Plugin hint')).toHaveText('MODS_PROBE_HINT draft=false working=false');
    // the turn as recorded: the mod opens its pane when the turn completes, and the panel shows it as a plugin pane tab
    value(await invoke(page, 'session.send', { appSessionId: id as never, content: 'Reply with exactly MODS_PROBE_OK' }));
    const panel = page.locator('[data-region="panel"]');
    await expect(panel.getByRole('tab', { name: /Plugin pane · Probe pane/ })).toBeVisible({ timeout: 20_000 });
    await expect(panel.locator('[data-plugin-pane="mods-probe-pane"]')).toContainText('MODS_PROBE_PANE picked=one');
    await expect(panel.getByRole('combobox', { name: 'Pick' })).toHaveValue('one');
    await expect(panel.getByRole('link', { name: 'Probe link' })).toHaveAttribute('href', 'https://example.com/mods-probe');
  });
});

test('a press on a mod’s button reaches the mod and its band redraws (R2, pass3/mods-surface-invalidate)', async () => {
  test.setTimeout(120_000);
  await surfaceReplay('mods-surface-invalidate', async ({ pane, id, userData }) => {
    const band = pane.getByRole('region', { name: 'From plugins' });
    await expect(band).toContainText('MODS_PROBE_BAND presses=0', { timeout: 20_000 });
    // the recorded press (seq 24): the replay holds at it until the app writes it; its answer, the mod's log line and the
    // engine's invalidate follow, and the app asks the band again
    await band.getByRole('button', { name: 'Press' }).click();
    await expect(band).toContainText('MODS_PROBE_BAND presses=1', { timeout: 20_000 });
    await expect(pane.locator('.transcript-error[data-scope="plugin"]')).toContainText(['mods-probe: MODS_PROBE_PRESS 1']);
    const dir = join(userData, 'engine-host/journal', id);
    const presses = () => readdirSync(dir).filter((name) => name.endsWith('.jsonl')).flatMap((name) => readFileSync(join(dir, name), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { direction: string; frame: { request?: { subtype: string } } })).filter((r) => r.direction === 'out' && r.frame.request?.subtype === 'ui_press').map((r) => r.frame.request);
    await expect.poll(presses).toEqual([{ subtype: 'ui_press', plugin: 'mods-probe', handle: 1, key: 'press', surface: 'desktop', client_id: 'maws-main' }]);
  });
});

// R3 recorded answers over explicit disk history; no engine process or model turn runs in these tests.
async function unfoldSeedWork(pane: ReturnType<Page['locator']>) {
  const divider = pane.locator('[data-kind="divider"] button[aria-expanded]').first();
  await expect(divider).toBeVisible();
  if (await divider.getAttribute('aria-expanded') === 'false') await divider.click();
}
const r3DomCases = [
  { site: 'user-message', component: 'UserMessage', outcome: 'replacement' },
  { site: 'assistant-message', component: 'AssistantMessage', outcome: 'engine-slot-rewrite' },
  { site: 'command-output', component: 'CommandOutput', outcome: 'rewrite-alone' },
  { site: 'tool-use', component: 'ToolUse', outcome: 'inkless' },
  { site: 'tool-result', component: 'ToolResult', outcome: 'rewrite-alone' },
  { site: 'tool-group', component: 'ToolGroup', outcome: 'engine-slot-rewrite' },
  { site: 'ask-user-question', component: 'AskUserQuestion', outcome: 'invalid-rewrite' },
] as const;
for (const { site, component, outcome } of r3DomCases) {
  test(`R3 recorded ${component} ${outcome} reaches the transcript DOM`, async () => {
    test.setTimeout(120_000);
    const instanceId = component === 'ToolUse' || component === 'ToolResult' ? 'tool-r3' : component === 'ToolGroup' ? 'group:tool-r3' : `r3:${component}:${outcome}`;
    const seed: SurfaceSeed = (base) => {
      const t = transcriptSeed(base);
      t.user(component === 'UserMessage' ? instanceId : 'seed-user', component === 'CommandOutput' ? '/help' : 'R3 user');
      if (component === 'AssistantMessage') t.text(instanceId, 'R3 assistant');
      if (component === 'CommandOutput') t.user(instanceId, '<local-command-stdout>R3 command</local-command-stdout>');
      if (component === 'ToolUse' || component === 'ToolGroup' || component === 'ToolResult') t.tool('tool-r3', 'Bash', { command: 'printf R3' }, r3Output);
      if (component === 'AskUserQuestion') t.tool(instanceId, 'AskUserQuestion', { questions: [r3Question] }, { questions: [r3Question], answers: { 'Which path?': 'One' } });
      return t.finish(component !== 'ToolUse' && component !== 'ToolGroup');
    };
    await surfaceReplay((root) => recordedSurfaceJournal(root, `mods-surface-transcript-${site}`, { component, outcome, instanceId }), async ({ pane }) => {
      if (component.startsWith('Tool')) await unfoldSeedWork(pane);
      if (component === 'UserMessage') {
        await expect(pane.getByText('R3 replacement UserMessage', { exact: true })).toBeVisible();
        await expect(pane.locator('[data-engine-native="UserMessage"]').getByText('R3 user', { exact: true })).not.toBeVisible();
      } else if (component === 'AssistantMessage') {
        await expect(pane.getByText('R3 slot', { exact: true })).toBeVisible();
        await expect(pane.locator('[data-engine-native="AssistantMessage"]').getByText('R3 rewritten text', { exact: true })).toBeVisible();
        await expect(pane.getByText('R3 assistant', { exact: true })).not.toBeVisible();
      } else if (component === 'CommandOutput') {
        await expect(pane.locator('[data-kind="local_command"]')).toContainText('R3 rewritten text');
        await expect(pane.getByText('R3 command', { exact: true })).not.toBeVisible();
      } else if (component === 'ToolUse') {
        const group = pane.locator('[data-kind="group"]').first();
        // UX wave U2 (O-29): a folded run mounts no call and asks no ToolUse site; opening it asks the call's
        await expect(group.locator('[data-surface-row="ToolUse"]')).toHaveCount(0);
        await group.locator('.transcript-run-line').click();
        await expect(group.locator('[data-surface-row="ToolUse"]')).toHaveCount(1);
        await expect(group.locator('.transcript-cell-line')).not.toBeVisible();
        await expect(group.locator('[data-cell-count]')).toHaveAttribute('data-cell-count', '1');
      } else if (component === 'ToolGroup') {
        const group = pane.locator('[data-kind="group"]').first();
        await expect(group.getByText('R3 slot', { exact: true })).toBeVisible();
        // the mod's rewrite says isExpanded, which opens the run (Rows.tsx, SurfaceGroupRow) onto its call's row
        await expect(group.locator('.transcript-run-line')).toHaveAttribute('aria-expanded', 'true');
        await expect(group.locator('.transcript-cell-line')).toBeVisible();
        // the call's row in MAWS's words, drawn beside the mod's drawing (whose engine slot a drawing-only site leaves
        // empty): UX wave U2 (M3) reads a shell call with no description by its short command, and `printf` is no
        // command that rule knows, so `Ran a command` where the tool's name stood
        await expect(group.locator('.transcript-cell-line')).toHaveText('Ran a command');
      } else if (component === 'ToolResult') {
        // X3 renders a completed one-tool run as a standalone cell, so opening it mounts ToolResult.
        const cell = pane.locator('[data-kind="cell"] .transcript-cell');
        await expect(cell.locator('.transcript-cell-line')).toBeVisible();
        await cell.locator('.transcript-cell-line').click();
        await expect(cell.locator('[data-surface-row="ToolResult"]')).toHaveCount(1);
        await expect(cell.locator('[data-engine-native="ToolResult"]')).toContainText('R3 rewritten output');
      } else {
        const receipt = pane.locator('[data-kind="question"] .transcript-question');
        await expect(receipt).toBeVisible();
        await expect(receipt.locator('[data-question]')).toHaveText('Path→One');
        await expect(receipt.locator('[data-question]')).toHaveAttribute('title', 'Which path?');
        await expect(receipt.getByRole('button')).toHaveCount(0);
      }
    }, seed);
  });
}

test('R3 recorded unhooked UserMessage leaves the original prompt visible', async () => {
  test.setTimeout(120_000);
  await surfaceReplay((root) => recordedSurfaceJournal(root, 'mods-surface-transcript-unhooked', { component: 'UserMessage', outcome: 'unhooked', instanceId: 'unhooked:UserMessage' }), async ({ pane }) => {
    await expect(pane.locator('[data-kind="user"]').getByText('R3 user', { exact: true })).toBeVisible();
    await expect(pane.locator('[data-plugin-drawn="UserMessage"]')).toHaveCount(0);
  }, (base) => { const t = transcriptSeed(base); t.user('unhooked:UserMessage', 'R3 user'); return t.finish(); });
});

// Opt-in replay evidence, like the earlier per-wave shot switches. The app and all session state remain scratch.
async function captureR3bEvidence(page: Page, name: string) {
  if (process.env.MAWS_R3B_SHOTS !== '1') return;
  const dir = '/tmp/maws-r3b-evidence';
  mkdirSync(dir, { recursive: true });
  try {
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(dir, `${name}-${theme}.png`), animations: 'disabled' });
    }
  } finally {
    await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  }
}

test('R3 owner to-human draws every span as Markdown, folds the working record, fills the composer and preserves the question receipt', async () => {
  test.setTimeout(120_000);
  await surfaceReplay((root) => recordedSurfaceJournal(root, 'mods-surface-transcript-to-human'), async ({ pane, id, page }) => {
    await unfoldSeedWork(pane);
    const report = pane.locator('[data-plugin-drawn="AssistantMessage"]').filter({ has: page.getByRole('button', { name: 'working record', exact: true }) });
    await expect(report.getByText('to human', { exact: false })).toBeVisible();
    const label = report.locator('[data-surface="text"]').filter({ hasText: 'to human' }).first();
    await expect(label).toHaveCSS('font-weight', '600');
    const cyan = await label.evaluate((el) => { const probe = document.createElement('span'); probe.style.color = 'var(--term-ansi-cyan)'; el.appendChild(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; });
    await expect(label).toHaveCSS('color', cyan);
    const bodies = report.locator('[data-surface="markdown"]');
    await expect(bodies).toHaveText(['First span.', 'Second span.', 'Which path?']);
    await expect(bodies.first().locator('[data-streamdown="strong"]')).toHaveText('span');
    await expect(report.locator('[data-surface="text"], [data-surface="markdown"]')).toHaveText([
      '● to human', 'First span.', 'essential', 'Second span.', 'need input', 'Which path?',
    ]);
    await expect(report.getByRole('button', { name: /^1: One/ })).toBeVisible();
    await expect(report.getByRole('button', { name: '2: Two', exact: true })).toBeVisible();
    // 7.135.0 draws each span itself: no engine slot in the mod drawing, unchanged native history kept concealed.
    await expect(report.locator('[data-engine-slot]')).toHaveCount(0);
    const native = report.locator('xpath=..').locator('[data-engine-native="AssistantMessage"]');
    await expect(native).toHaveAttribute('aria-hidden', 'true');
    await expect(native).toHaveAttribute('inert', '');
    await expect(native).not.toBeVisible();
    await expect(native).toContainText('Private working notes.');
    await expect(pane.getByText('Private follow-up record.', { exact: true })).not.toBeVisible();
    await expect(pane.getByRole('button', { name: 'working record', exact: true })).toHaveCount(1);
    const receipt = pane.locator('[data-kind="question"] .transcript-question');
    await expect(receipt.locator('[data-question]')).toHaveText('Path→One');
    await expect(receipt.getByRole('button')).toHaveCount(0);
    await captureR3bEvidence(page, 'to-human-folded');
    const usersBefore = await pane.locator('[data-kind="user"]').count();
    await report.getByRole('button', { name: /^1: One/ }).click();
    await expect(pane.locator(`[data-composer="${await addressed(page, id)}"] [contenteditable="true"]`)).toHaveText('Answering "Which path?": One');
    expect(value(await invoke(page, 'session.status', { appSessionId: id as never })).turn).toBeNull();
    expect(await pane.locator('[data-kind="user"]').count()).toBe(usersBefore);
    await report.getByRole('button', { name: 'working record', exact: true }).click();
    await expect(pane.getByText('Private follow-up record.', { exact: true })).toBeVisible();
    const unfolded = pane.locator('[data-engine-native="AssistantMessage"]').filter({ hasText: 'Private working notes.' });
    await expect(unfolded).toBeVisible();
    await expect(unfolded).toContainText('More working notes.');
    const unfoldedDrawing = unfolded.locator('xpath=ancestor::*[@data-plugin-drawn="AssistantMessage"][1]');
    await expect(unfoldedDrawing.locator('[data-engine-slot]')).toHaveCount(1);
    await expect(pane.locator('[data-plugin-drawn="AssistantMessage"] [data-surface="markdown"]')).toHaveCount(0);
    await expect(pane.getByRole('button', { name: 'working record', exact: true })).toHaveCount(0);
    await expect(receipt.locator('[data-question]')).toHaveText('Path→One');
    await expect(receipt.getByRole('button')).toHaveCount(0);
    await captureR3bEvidence(page, 'to-human-unfolded');
  }, (base) => {
    const t = transcriptSeed(base);
    t.user('owner-user', 'Show the report');
    t.text('owner-multi', ownerMarkedText);
    t.text('owner-record', 'Private follow-up record.');
    t.tool('owner-tool', 'Bash', { command: 'printf R3' }, r3Output);
    t.tool('owner-question', 'AskUserQuestion', { questions: [r3Question] }, { questions: [r3Question], answers: { 'Which path?': 'One' } });
    return t.finish();
  });
});


test('detached owner recording keeps one authored Markdown flow without cards or injected choices', async () => {
  await surfaceReplay((root) => recordedSurfaceJournal(root, 'mods-surface-transcript-to-human'), async ({ page, pane, id }) => {
    const report = pane.locator('[data-kind="assistant_text"]').filter({ hasText: 'First span.' });
    await expect(report).toBeVisible();
    await expect(report.locator('.transcript-prose')).toHaveCount(1);
    await expect(report).toContainText('Private working notes.');
    await expect(report).toContainText('First span.');
    await expect(report).toContainText('Second span.');
    await expect(report).toContainText('Which path?');
    await expect(report).toContainText('One');
    await expect(report).toContainText('Two');
    await expect(report).toContainText('More working notes.');
    await expect(report.locator('[data-streamdown="strong"]')).toHaveText('span');
    await expect(report.locator('[data-owner-card], [data-owner-report], button')).toHaveCount(0);
    await expect(report).not.toContainText('<to-human>');
    await expect(report).not.toContainText('<choice');
    await expect(report).not.toContainText('Resume this session to answer.');
    await expect(pane.getByText('Private follow-up record.', { exact: true })).not.toBeVisible();
    // This indexed session was never started: there is no engine host session, not a detached ready process.
    expect(await invoke(page, 'session.status', { appSessionId: id as never })).toEqual({
      ok: false, error: { code: 'internal', message: `unknown session ${id}` },
    });
    const dir = '/tmp/maws-r4-evidence'; mkdirSync(dir, { recursive: true });
    try {
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: join(dir, `to-human-detached-${theme}.png`), animations: 'disabled' });
      }
    } finally { await page.evaluate(() => (document.documentElement.dataset.theme = 'light')); }
    const divider = pane.locator('.transcript-divider button[aria-expanded]').first();
    await expect(divider).toHaveAttribute('aria-expanded', 'false');
    await divider.click();
    await expect(report).toContainText('Private working notes.');
    await expect(report).toContainText('More working notes.');
    await expect(pane.getByText('Private follow-up record.', { exact: true })).toBeVisible();
    await divider.click();
    await expect(report.getByText('First span.', { exact: false })).toBeVisible();
    await expect(report).toContainText('Private working notes.');
  }, (base) => {
    const t = transcriptSeed(base); t.user('owner-user', 'Show the report');
    t.text('owner-multi', ownerMarkedText); t.text('owner-record', 'Private follow-up record.');
    t.tool('owner-tool', 'Bash', { command: 'printf R3' }, r3Output);
    t.tool('owner-question', 'AskUserQuestion', { questions: [r3Question] }, { questions: [r3Question], answers: { 'Which path?': 'One' } });
    return t.finish();
  }, undefined, false);
});

test('M1 marked commentary is visible at full contrast before and after folding work', async () => {
  await surfaceReplay((root) => recordedSurfaceJournal(root, 'mods-surface-transcript-to-human'), async ({ pane }) => {
    const body = pane.locator('[data-plugin-drawn="AssistantMessage"] [data-surface="markdown"]').filter({ hasText: 'First span.' });
    await expect(body).toBeVisible();
    const foreground = await body.evaluate((el) => { const probe = document.createElement('span'); probe.style.color = 'var(--fg)'; el.appendChild(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; });
    await expect(body).toHaveCSS('color', foreground);
    await expect(body.locator('.transcript-commentary')).toHaveCount(0);
    const divider = pane.locator('.transcript-divider button[aria-expanded]').first();
    await expect(divider).toHaveAttribute('aria-expanded', 'false');
    await divider.click();
    await expect(divider).toHaveAttribute('aria-expanded', 'true');
    await divider.click();
    await expect(divider).toHaveAttribute('aria-expanded', 'false');
    await expect(body).toBeVisible();
  }, (base) => {
    const t = transcriptSeed(base); t.user('owner-user', 'Show the report');
    t.text('owner-multi', ownerMarkedText);
    t.tool('owner-tool', 'Bash', { command: 'printf R3' }, r3Output);
    return t.finish();
  });
});


// UX wave U2b (the architect's ruling of 2026-11-15, digest 4): the pane's rows when a count over them fails, attached to
// the test: as the DOM holds them (the list's mounted window, `OVERSCAN` past the viewport) and as the list holds them
// (read by stepping its scroller from the top to the end, then put back), each with its index, id, kind and turn, and
// whether it is mounted now. The recording's invented content only.
async function attachPaneRows(pane: Locator, name: string): Promise<void> {
  const rows = await pane.locator('[data-transcript-scroller]').first().evaluate(async (scroller) => {
    const read = () => Array.from(scroller.querySelectorAll('[data-index]')).map((item) => {
      const frame = item.querySelector('[data-kind]');
      return { index: Number(item.getAttribute('data-index')), id: item.getAttribute('data-row-id'), kind: frame?.getAttribute('data-kind') ?? null, turn: frame?.getAttribute('data-turn-id') ?? null };
    });
    const mounted = read();
    const back = scroller.scrollTop;
    const list = new Map<number, ReturnType<typeof read>[number]>();
    for (let top = 0, step = 0; step < 200; top += Math.max(40, scroller.clientHeight / 2), step += 1) {
      scroller.scrollTop = top;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      for (const row of read()) list.set(row.index, row);
      if (top >= scroller.scrollHeight - scroller.clientHeight) break;
    }
    scroller.scrollTop = back;
    const shown = new Set(mounted.map((row) => row.index));
    return { mounted, list: [...list.values()].sort((a, b) => a.index - b.index).map((row) => ({ ...row, mounted: shown.has(row.index) })) };
  });
  await test.info().attach(name, { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
}

/** An expectation over the pane's rows that, failing, attaches them first (`attachPaneRows`). */
async function withPaneRows(pane: Locator, name: string, expectation: () => Promise<void>): Promise<void> {
  try {
    await expectation();
  } catch (error) {
    await attachPaneRows(pane, name);
    throw error;
  }
}

// UX wave U2b (A12, A13, A14): the session's lane on and messages in it, the report is the to-human view where MAWS
// draws it. Each stretch of work between the rows the person reads is one `› working record` line (a mixed text's own
// words a stretch of their own, after its messages), a message is the mod's drawing (`● message` bold in the accent over
// the body), the switch is one line above the composer, and no bar stands above the transcript. A record opens onto the
// plain transcript's rows, its turn's line with no chevron and `‹ fold to report` under them, and folds again; the full
// transcript folds nothing. Text inside a message is never cardified or moved to a margin, and keeps its authored flow.
test('the to-human view folds work by stretch, draws each message as the mod does, and switches above the composer, while marked text retains its authored flow and geometry', async () => {
  test.setTimeout(120_000);
  const fixture = 'test/fixtures/engine/p2c-report-marks.jsonl';
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-p2c-report-')));
  const repo = join(root, 'repo');
  const config = join(root, 'claude-config');
  mkdirSync(repo);
  const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  const engineId = randomUUID();
  const first = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: 'a session that reports' }, uuid: randomUUID(), timestamp: '2026-10-09T07:00:00.000Z', cwd: repo, sessionId: engineId, version: '2.1.295' };
  writeFileSync(join(project, `${engineId}.jsonl`), `${JSON.stringify(first)}\n`);
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: config } });
  try {
    const { page } = maws;
    let id = '';
    await expect.poll(async () => (id = value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === engineId)?.appId ?? '')).not.toBe('');
    await (await sidebarRow(page, { appSessionId: id })).click();
    await page.mouse.move(0, 0);
    const pane = page.locator('[data-region="main"] [data-pane="0"]');
    await expect(pane.locator(`[data-composer="${await addressed(page, id)}"]`)).toBeVisible();
    await launchReady(page, id, fixture, { cwd: repo });
    const prompts = readFileSync(join(REPO_ROOT, fixture), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { direction: string; frame: { type?: string; message?: { content?: string } } }).filter((row) => row.direction === 'out' && row.frame.type === 'user').map((row) => row.frame.message!.content!);
    for (const content of prompts) {
      value(await invoke(page, 'session.send', { appSessionId: id as never, content }));
      await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: id as never })).turn, { timeout: 20_000 }).toBeNull();
    }
    // Every turn ended: the first turn's call and its text's own words, and the last turn's unmarked answer, each a
    // stretch behind its record line.
    const closedLines = pane.getByRole('button', { name: '› working record', exact: true });
    await expect(closedLines).toHaveCount(3);
    await expect(pane.getByText('Nothing else for now.', { exact: true })).toHaveCount(0);

    // No bar above the transcript; the switch is one line above the composer, in the band's frame.
    await expect(pane.getByRole('group', { name: 'Session view' })).toHaveCount(0);
    await expect(pane.locator('[data-owner-bar]')).toHaveCount(0);
    const viewSwitch = pane.locator('[data-view-switch]');
    await expect(viewSwitch).toHaveText('to-human view · full transcript ›');
    const frame = pane.locator('[data-composer-frame]');
    expect(await viewSwitch.evaluate((el, f) => !!f && (el.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, await frame.elementHandle())).toBe(true); // above the frame
    const switchBox = (await viewSwitch.boundingBox())!;
    const frameBox = (await frame.boundingBox())!;
    expect(switchBox.y + switchBox.height, 'the switch’s bottom at or above the frame’s top (a pixel for rounding)').toBeLessThanOrEqual(frameBox.y + 1);

    // A closed stretch's head is its messages alone, each under its label: the outer mark's words, the insight, the
    // must-read and the question, each a message as the mod reads them; its own words are the record's.
    const report = pane.locator('[data-kind="assistant_text"]').filter({ hasText: "I haven't opened any files" });
    await expect(report.locator('.owner-message-label')).toHaveText(['● message', 'message', 'message', 'message']);
    await expect(report).toContainText("I haven't opened any files");
    await expect(report).toContainText('The README above is unverified.');
    await expect(report).toContainText('Which tone should the README use?');
    await expect(report).toContainText('Concise reference style');
    await expect(report).toContainText('Friendly guide style');
    await expect(report).not.toContainText('Checked the tree first: it is clean.');
    await expect(report.locator('[data-owner-card], .owner-card-label, .owner-insights, button:not([data-kind="assistant_text"] > .transcript-answer-actions button)')).toHaveCount(0);
    // UX wave U3b, statement 13: the turn's answer is this closed stretch's head, an owner prompt after it: Copy under it
    await expect(report.locator(':scope > .transcript-answer-actions').getByRole('button', { name: 'Copy', exact: true })).toHaveCount(1);
    await expect(pane.getByText('To you', { exact: true })).toHaveCount(0);
    const label = report.locator('.owner-message-label').first();
    await expect(label).toHaveCSS('font-weight', '600');
    const accent = await label.evaluate((el) => { const probe = document.createElement('span'); probe.style.color = 'var(--accent)'; el.appendChild(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; });
    await expect(label).toHaveCSS('color', accent);
    const body = report.locator('.owner-message-ink p').first();
    const foreground = await body.evaluate((el) => { const probe = document.createElement('span'); probe.style.color = 'var(--fg)'; el.appendChild(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; });
    await expect(body).toHaveCSS('color', foreground);
    await expect(pane.locator('[data-kind="divider"]')).toHaveCount(0); // no turn's line while its records are closed
    const tool = pane.locator('[data-cell-id="cell:toolu_01P2cM5Bash01"]');
    await expect(tool).toHaveCount(0);
    await captureReportShot(page, 'report-level0');

    // The first stretch (the call) opens onto its rows, the turn's line with no chevron, `‹ fold to report` under them,
    // focused.
    const closed = pane.locator('[data-row-id="record-fold:closed:toolu_01P2cM5Bash01"]').getByRole('button');
    const opened = pane.locator('[data-row-id="record-fold:open:toolu_01P2cM5Bash01"]').getByRole('button');
    await expect(closed).toHaveAttribute('aria-expanded', 'false');
    await closed.click();
    await expect(opened).toHaveText('‹ fold to report');
    await expect(opened).toHaveAttribute('aria-expanded', 'true');
    await expect(opened).toBeFocused();
    // The list mounts a window of rows past the viewport and, following its end, keeps the end in view as the record's
    // rows go in, so its turn's line, above them, can fall outside the window: the record's rows are brought into view.
    await opened.scrollIntoViewIfNeeded();
    const turnLine = pane.locator('[data-kind="divider"]');
    await withPaneRows(pane, 'the pane’s rows with the first record open', () => expect(turnLine).toHaveCount(1));
    await expect(turnLine).toContainText('Worked for');
    await expect(turnLine).toContainText('Ran a command'); // UX wave U2 (O-15): the turn's line names what it did
    await expect(pane.locator('.transcript-divider .transcript-disclosure')).toHaveCount(0);
    // The tool summary appears immediately; the command remains on demand inside its own detail.
    const detailToggle = tool.getByRole('button', { name: 'Checked the tree', exact: true });
    await expect(detailToggle).toBeVisible();
    await expect(detailToggle).toHaveAttribute('aria-expanded', 'false');
    const command = tool.locator('.transcript-shell-command');
    await expect(command).not.toBeVisible();
    await detailToggle.click();
    await expect(detailToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(command).toBeVisible();
    await expect(command).toHaveText('$ git status --short');
    await captureReportShot(page, 'report-level2');
    await opened.click();
    await expect(closed).toHaveAttribute('aria-expanded', 'false');
    await expect(closed).toBeFocused();
    await expect(tool).toHaveCount(0);
    await expect(pane.locator('[data-kind="divider"]')).toHaveCount(0);
    await expect(report).not.toContainText('Checked the tree first: it is clean.');

    // The text's own words are a stretch of their own, after its messages: opened, the text is drawn whole.
    await closedLines.nth(1).click();
    await expect(report).toContainText('Checked the tree first: it is clean.');
    await expect(report.locator('.transcript-prose')).toHaveCount(1);
    await expect(report.locator('[data-owner-card], .owner-card-label, .owner-insights, button:not([data-kind="assistant_text"] > .transcript-answer-actions button)')).toHaveCount(0);
    // its stretch opened, the head is the turn's last drawn answer block: the same action row under it (statement 13)
    await expect(report.locator(':scope > .transcript-answer-actions').getByRole('button', { name: 'Copy', exact: true })).toHaveCount(1);
    await pane.getByRole('button', { name: '‹ fold to report', exact: true }).click();
    await expect(report).not.toContainText('Checked the tree first: it is clean.');
    await expect(closedLines).toHaveCount(3);

    // The full transcript, from the switch: no record line, every word, still no cards, a turn's line with no chevron.
    await viewSwitch.getByRole('button', { name: 'full transcript ›', exact: true }).click();
    await expect(viewSwitch).toHaveText('to-human view · report only ›');
    await expect(pane.locator('[data-kind="record_fold"]')).toHaveCount(0);
    await expect(pane.getByText('Checked the tree first: it is clean.', { exact: false })).toBeVisible();
    await expect(report.locator('[data-owner-card], .owner-card-label')).toHaveCount(0);
    await expect.poll(() => pane.locator('[data-kind="divider"]').count()).toBeGreaterThan(0);
    await expect(pane.locator('.transcript-divider .transcript-disclosure')).toHaveCount(0);
    await viewSwitch.getByRole('button', { name: 'report only ›', exact: true }).click();
    await expect(viewSwitch).toHaveText('to-human view · full transcript ›');
    await expect(closedLines).toHaveCount(3);

    // A long insight remains in the same document flow, including when the column narrows.
    await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 1000));
    const notes = pane.locator('[data-kind="assistant_text"]').filter({ hasText: 'Keep the README short.' });
    await notes.scrollIntoViewIfNeeded();
    await notes.evaluate((el) => {
      const scroller = el.closest('[data-transcript-scroller]') as HTMLElement;
      document.documentElement.style.setProperty('--measure', `${Math.max(240, scroller.clientWidth - 2 * 272)}px`);
    });
    await expect(notes.locator('.transcript-prose')).toHaveCount(1);
    await expect(notes.locator('.transcript-prose p')).toHaveCount(8);
    await expect(notes.locator('.owner-insights, aside')).toHaveCount(0);
    await expect.poll(() => notes.evaluate((el) => {
      const paragraphs = Array.from(el.querySelectorAll('.transcript-prose p')).map((node) => node.getBoundingClientRect());
      const own = el.closest('[data-index]')!.getBoundingClientRect();
      return paragraphs.every((box, index) => box.bottom <= own.bottom + 0.5 && (index === 0 || box.top >= paragraphs[index - 1].bottom - 0.5));
    })).toBe(true);
    await captureReportShot(page, 'report-authored-flow');
    await page.evaluate(() => document.documentElement.style.removeProperty('--measure'));
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

// Light and dark shots of the report for M5's review, outside the repository, only under MAWS_P2C_M5_SHOTS=1 (as the
// other `MAWS_*_SHOTS` evidence is), so an ordinary run neither overwrites a review's shots nor shares a fixed path
// with another worktree's run.
async function captureReportShot(page: Page, name: string) {
  if (process.env.MAWS_P2C_M5_SHOTS !== '1') return;
  const dir = '/tmp/maws-p2c-m5-evidence';
  mkdirSync(dir, { recursive: true });
  try {
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(dir, `${name}-${theme}.png`), animations: 'disabled' });
    }
  } finally {
    await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  }
}

const sittingReplays = [
  { fixture: 'mods-surface-sitting', headers: false },
  { fixture: 'mods-surface-sitting-2-1-287', headers: false },
  { fixture: 'mods-surface-sitting-headers', headers: true },
] as const;
for (const { fixture, headers } of sittingReplays) test(`M3 owner sitting preserves ${headers ? 'display headers' : 'tags'} on disk and over replay (${fixture})`, async () => {
  test.setTimeout(120_000);
  await surfaceReplay((root) => recordedSurfaceJournal(root, fixture), async ({ page, pane, id, userData }) => {
    // Scroll the actual session through the virtual range, so both turns mount and ask.
    const scroller = pane.locator('[data-transcript-scroller]');
    if (await scroller.count()) await scroller.evaluate((el) => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); el.scrollTop = 0; });
    const drawings = pane.locator('[data-plugin-drawn="AssistantMessage"]');
    const commentary = drawings.filter({ hasText: "I'm going through both spec branches" });
    await expect(commentary.locator('[data-surface="markdown"]')).toHaveText("I'm going through both spec branches to see where each one stands.");
    const greeting = drawings.filter({ hasText: "Hi. I'm in" });
    await expect(greeting.locator('[data-surface="markdown"]')).toHaveCount(1);
    await expect(greeting.locator('[data-surface="markdown"]')).toContainText('Executing that spec is one option.');
    const report = drawings.filter({ hasText: 'This repo has two infrastructure initiatives' });
    await expect(report.locator('[data-surface="markdown"]')).toHaveCount(2);
    await expect(report.locator('[data-surface="markdown"]').first()).toContainText("I haven't checked what it's working on.");
    await expect(report.locator('[data-surface="markdown"]').last()).toHaveText('What next?');
    await expect(report.locator('[data-surface="text"]')).toHaveText(['● to human', 'need input']);
    await expect(report.getByRole('button', { name: /^1: Resume E2/ })).toBeVisible();
    await expect(report.getByRole('button', { name: /^2: Pick up #163/ })).toBeVisible();
    await expect(report.getByRole('button', { name: /^3: Housekeeping/ })).toBeVisible();
    await expect(drawings.locator('[data-engine-slot]')).toHaveCount(0);
    const concealed = pane.locator('[data-engine-native="AssistantMessage"]');
    await expect(concealed).toHaveCount(3);
    for (const native of await concealed.all()) {
      await expect(native).toHaveAttribute('aria-hidden', 'true');
      await expect(native).toHaveAttribute('inert', '');
      await expect(native).not.toBeVisible();
    }
    const labels = pane.locator('[data-surface="text"]').filter({ hasText: 'to human' });
    await expect(labels.first()).toHaveCSS('font-weight', '600');
    await expect(labels.first()).toContainText('●');
    await expect(labels.first()).toHaveCSS('color', 'rgb(5, 152, 188)');
    const dir = join(userData, 'engine-host/journal', id);
    const asks = () => readdirSync(dir).filter((name) => name.endsWith('.jsonl')).flatMap((name) => readFileSync(join(dir, name), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { direction: string; frame: { request?: { subtype: string; component: string; instance_id: string; props: { text: string; isFirstOfReply: boolean } } } })).filter((r) => r.direction === 'out' && r.frame.request?.subtype === 'ui_render' && r.frame.request.component === 'AssistantMessage').map((r) => r.frame.request!);
    await expect.poll(() => new Set(asks().map((a) => a.instance_id)).size).toBe(3);
    const texts = asks();
    expect(new Set(texts.map((a) => a.props.text.length))).toEqual(new Set(headers ? [258, 89, 2864] : [256, 87, 2920]));
    const expectedTexts = new Map(sittingSeed({ repo: '/scratch', engineId: id }, false, headers).filter((r) => r.type === 'assistant').flatMap((r) => (r.message as { content: { type: string; text?: string }[] }).content.filter((b) => b.type === 'text').map((b) => [r.uuid, b.text] as const)));
    for (const ask of texts) expect(ask.props.text).toBe(expectedTexts.get(ask.instance_id));
    expect(texts.every((a) => a.props.isFirstOfReply)).toBe(true);
    expect(texts.map((a) => a.instance_id).filter((uuid) => uuid.startsWith('244de4a2') || uuid.startsWith('cd3271fb')).every((uuid) => !uuid.includes(':text:'))).toBe(true);
    await expect(pane.getByRole('button', { name: 'working record', exact: true })).toHaveCount(0);
    expect(value(await invoke(page, 'session.status', { appSessionId: id as never })).turn).toBeNull();
    await captureR3bEvidence(page, fixture);
  }, (base) => sittingSeed(base, true, headers), async (pane) => {
    await unfoldSeedWork(pane);
    // hi plus the two status messages, counted over the whole list: the rows are virtual, and the status turn's rows
    // (E7: its ListAgents call is a listing row of its own) can leave the first answer outside the mounted window
    await expect.poll(() => pane.locator('[data-transcript-scroller]').evaluate(async (scroller) => {
      const seen = new Set<string>();
      scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); // a reader walks the virtual range
      scroller.scrollTop = 0;
      for (let guard = 0; guard < 100; guard += 1) {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        for (const row of Array.from(scroller.querySelectorAll<HTMLElement>('[data-kind="assistant_text"]'))) seen.add(row.id);
        if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1) break;
        scroller.scrollTop += Math.max(1, scroller.clientHeight / 2);
      }
      return seen.size;
    })).toBe(3);
  });
});

// The owner's Code-mode comparison: the existing real-world mixed-tool fixture at the review viewport.
test('Code-mode transcript rows keep labels, counts and inline diffs without a files-changed card', async ({ harness }, testInfo) => {
  const { page } = harness;
  await page.setViewportSize({ width: 1280, height: 820 });
  await harnessReady(page);
  const frame = async (target: Locator) => {
    await page.evaluate(() => document.fonts.ready);
    await target.scrollIntoViewIfNeeded();
    await target.evaluate((el) => {
      const scroller = el.closest<HTMLElement>('[data-transcript-scroller]')!;
      scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); // stop following the answer
      scroller.scrollBy({ top: el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16, behavior: 'instant' });
    });
    await settle(page, 200);
    await expect(target).toBeInViewport({ ratio: 1 });
  };
  await loadAll(page, 'transcript/edit-and-receipt');
  await page.locator('[data-kind="divider"] button[aria-expanded]').first().click();
  await openEveryRun(page); // UX wave U2 (O-29): each run opened onto its calls' rows
  await expect(page.locator('[data-kind="receipt"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Read app.ts', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ran the unit tests', exact: true })).toBeVisible();
  const edit = page.getByRole('button', { name: /^Edited.*app.ts.*\+1.*−1/ });
  await expect(edit.locator('.transcript-file-target')).toHaveText('app.ts');
  await expect(edit).toHaveAttribute('title', '/tmp/maws-synth-edit-and-receipt/src/app.ts');
  await expect(edit.locator('.transcript-counts')).toHaveText(/^[+]1\s*−1$/);
  const colours = await page.evaluate(() => {
    const probe = document.createElement('span');
    document.body.append(probe);
    try {
      probe.style.color = 'var(--fg)';
      const primary = getComputedStyle(probe).color;
      probe.style.color = 'var(--fg-muted)';
      return { primary, muted: getComputedStyle(probe).color };
    } finally {
      probe.remove();
    }
  });
  expect(colours.primary).not.toBe(colours.muted);
  await expect(edit.locator('.transcript-file-target')).toHaveCSS('color', colours.primary);
  await expect(edit.locator('.transcript-file-verb')).toHaveCSS('color', colours.muted);
  const group = page.locator('[data-kind="group"]').filter({ has: edit });
  await frame(group);
  await expect(group.locator('.transcript-run-line')).toBeInViewport({ ratio: 1 });
  await expect(group.locator('.transcript-tool-block .transcript-cell-line')).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath('transcript-rows-1280x820.png'), animations: 'disabled' });
  await testInfo.attach('Transcript tool rows', { path: testInfo.outputPath('transcript-rows-1280x820.png'), contentType: 'image/png' });
  await edit.click();
  await expect(group.getByRole('button', { name: '/tmp/maws-synth-edit-and-receipt/src/app.ts', exact: true })).toHaveAttribute('title', '/tmp/maws-synth-edit-and-receipt/src/app.ts');
  await expect(group.locator('.transcript-diff-line[data-diff="add"]').first()).toBeVisible();
  await frame(group);
  await expect(group.locator('.transcript-run-line')).toBeInViewport({ ratio: 1 });
  await expect(group.locator('.transcript-diff-line').first()).toBeInViewport({ ratio: 1 });
  await expect(group.locator('.transcript-diff-line').last()).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath('transcript-inline-diff-1280x820.png'), animations: 'disabled' });
  await testInfo.attach('Inline edit diff', { path: testInfo.outputPath('transcript-inline-diff-1280x820.png'), contentType: 'image/png' });
  await loadAll(page, 'p4/p4-tool-summaries-thinking-edits');
  const divider = page.locator('[data-kind="divider"] button[aria-expanded]').first();
  if (await divider.getAttribute('aria-expanded') === 'false') await divider.click();
  await openEveryRun(page);
  const create = page.getByRole('button', { name: /^Created.*notes\.txt.*\+1$/ });
  await expect(create.locator('.transcript-file-target')).toHaveText('notes.txt');
  await expect(create.locator('.transcript-counts')).toHaveText('+1');
  await expect(create.locator('.transcript-del')).toHaveCount(0);
  await create.click();
  await expect(page.locator('.transcript-diff-line[data-diff="add"]')).toContainText('Ready for review.');
  const createdGroup = page.locator('[data-kind="group"]').filter({ has: create });
  await frame(divider); // keep the read, commentary and grouped changes together in their authored order
  await expect(createdGroup.locator('.transcript-run-line')).toBeInViewport({ ratio: 1 });
  await expect(createdGroup.locator('.transcript-diff-line[data-diff="add"]')).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath('transcript-create-diff-1280x820.png'), animations: 'disabled' });
  await testInfo.attach('Recorded create diff', { path: testInfo.outputPath('transcript-create-diff-1280x820.png'), contentType: 'image/png' });
});
