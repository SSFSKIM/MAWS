// The transcript harness end to end (C6), over the real model and row components. `anchoring` is G1, the anchoring
// spike (acceptance item 1): a five-hundred-turn synthetic transcript streams its last turn at sixty delta batches a
// second while the reader, scrolled far up, expands old work; the reader must not be moved, frames must hold, and
// "Jump to latest" must resume follow mode. The others pin follow mode, the divider collapse, the theme switch, the
// denial jump (acceptance item 4), the child transcript (acceptance item 9) and expanded old work over every fixture.
// Runs only under `pnpm e2e:transcript`, which builds with MAWS_HARNESS=1 first (playwright.config.ts).
import { join } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import type { HarnessApi, HarnessMetrics } from '../src/renderer/src/harness/api';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';

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

// W8 (T3): a group opens and closes as Codex's disclosures do, its height running through the values between closed and
// open (300 ms opening, 150 ms closing) rather than jumping, the row below following it frame by frame and flush with it
// at the end, and its cells unmounted once it has closed.
test('a group’s height moves through its disclosure rather than jumping, and the row below follows it', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await load(page, 'synthetic/500');
  const turnId = await openTurn(page);
  const groupRowId = await page.evaluate((id) => {
    const groups = Array.from(document.querySelectorAll(`[data-kind="group"][data-turn-id="${id}"]`));
    const group = groups.find((element) => Number(element.querySelector('[data-cell-count]')?.getAttribute('data-cell-count')) >= 2);
    return group?.closest('[data-row-id]')?.getAttribute('data-row-id') ?? null;
  }, turnId);
  expect(groupRowId, `turn ${TURN} shows a group of at least two cells`).not.toBeNull();
  // Clicks the group's header and samples, every frame for 600 ms, the row's height and the next row's top.
  const sample = () =>
    page.evaluate(async (id) => {
      const row = document.querySelector<HTMLElement>(`[data-row-id="${id}"]`)!;
      const next = () => document.querySelector<HTMLElement>(`[data-index="${Number(row.dataset.index) + 1}"]`)!;
      const before = row.getBoundingClientRect().height;
      const heights: number[] = [];
      const gaps: number[] = [];
      const started = performance.now();
      row.querySelector<HTMLElement>('button[aria-expanded]')!.click();
      while (performance.now() - started < 600) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const box = row.getBoundingClientRect();
        heights.push(box.height);
        gaps.push(next().getBoundingClientRect().top - box.bottom);
      }
      return { before, heights, gaps, cells: row.querySelectorAll('[data-group-cells]').length };
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

// W8 (T1): a streaming thinking block's label in the CLI's words (tier, effort, time) and colour (the warning colour
// from 20 s), under Codex's shimmer, static under reduced motion. With MAWS_W8_SHOTS=1 it also writes the screenshots
// the wave hands back (docs/doperpowers/plans/shots/w8-thinking-*.png), in both themes.
test('a streaming thinking block reads the CLI’s tier, effort and time under the shimmer, warm from 20 s', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await blockHumanInput(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness.setEffort('xhigh'));
  const cases = [
    { fixture: 'events/thinking-live', shot: 'deep', text: /^Deep in thought with xhigh effort · (5\ds|1m \d\ds)$/, warm: true }, // 50 s in at load
    { fixture: 'events/thinking-live-group', shot: 'still', text: /^(Still thinking|Thinking more) with xhigh effort · [12]\ds$/, warm: false }, // 12 s in
  ];
  for (const { fixture, shot, text, warm } of cases) {
    await loadAll(page, fixture);
    const label = page.locator('[data-kind="thinking"] [data-shimmer]');
    await expect(label).toHaveText(text);
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
        const turn = page.locator('[data-kind="user"], [data-kind="divider"], [data-kind="cell"], [data-kind="thinking"]');
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
  }
  // Reduced motion: the same words and colour, no sweep.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = await page.locator('[data-kind="thinking"] [data-shimmer]').evaluate((element) => [getComputedStyle(element).animationName, getComputedStyle(element).backgroundImage]);
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
  await expect(toggle).toHaveText(/^Worked for .+ · 1 tool call$/);
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

// W2: in a completed answer a table or code block wider than the text breaks out to --measure-wide less its two pads
// (896 − 32 = 864 px), centred on the column; a narrow table keeps the text's width and left edge. A completed answer
// renders in Streamdown's static mode, whose blocks sit directly under the prose with no per-block [dir] wrapper.
test('a completed answer\u2019s wide table and code break out to the wide measure, centred, and a narrow table keeps the text', async ({ harness }) => {
  const { page } = harness;
  await harnessReady(page);
  await loadAll(page, 'events/wide-blocks');
  const prose = page.locator('[data-kind="assistant_text"] .transcript-prose');
  await expect(prose).toHaveCount(1);
  await expect(prose.locator('[data-streamdown="code-block"]')).toHaveCount(1);
  const measured = await prose.evaluate((element) => {
    const row = element.closest<HTMLElement>('.transcript-row')!;
    const style = getComputedStyle(row);
    const box = row.getBoundingClientRect();
    const round = (value: number) => Math.round(value * 10) / 10;
    const text = { left: round(box.left + parseFloat(style.paddingLeft)), width: round(box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) };
    const blocks = [...Array.from(element.querySelectorAll<HTMLElement>('[data-streamdown="table-wrapper"]')), element.querySelector<HTMLElement>('[data-streamdown="code-block"]')!];
    const [narrow, wide, code] = blocks.map((block) => {
      const rect = block.getBoundingClientRect();
      return { left: round(rect.left), width: round(rect.width), inProse: block.parentElement === element };
    });
    return { pads: [style.paddingLeft, style.paddingRight], text, narrow, wide, code };
  });
  console.log(`wide blocks: ${JSON.stringify(measured)}`);
  expect(measured.pads, 'the row pads its text by --measure-pad').toEqual(['16px', '16px']);
  expect(measured.text.width, 'the default column holds 736 px of text in a 1280 px or wider window').toBe(736);
  for (const block of [measured.narrow, measured.wide, measured.code]) expect(block.inProse, 'static mode: the block is a direct child of the prose').toBe(true);
  expect(measured.narrow, 'the narrow table is the text\u2019s width at its left edge').toEqual({ left: measured.text.left, width: measured.text.width, inProse: true });
  for (const block of [measured.wide, measured.code]) {
    expect(block.width, 'a wide block is --measure-wide less the pads').toBe(864);
    expect(block.left, 'centred on the column: 64 px left of the text').toBe(measured.text.left - 64);
  }
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
  const WORK_KINDS = ['group', 'cell', 'receipt', 'subagent', 'agent_message', 'bash', 'plan', 'question', 'boundary', 'error'];
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
});
