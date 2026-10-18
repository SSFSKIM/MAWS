// P3-F1 (fix 1, docs/doperpowers/ledgers/2026-10-17-P3-F1.md; `pnpm e2e:document-app`, the product build,
// MAWS_HARNESS=0): B's document shell in a narrow artifact panel. In the panel's Artifacts tool at 600 px, a document with
// an image and a table: Insert's menu opens whole under its button from the toolbar's scrolling strip; with the comments
// rail open the rail is a drawer over the page's right side, under the toolbar, the page and its table keep their width,
// the toolbar stays one row with its controls uncovered, the thread in the rail takes its clicks and Escape closes the
// drawer. With the panel maximized the rail sits beside the page at its old width. Captures: `narrow-insert-menu`,
// `narrow-rail-drawer`, `maximized-rail-beside`. Every launch's userData is its own directory under /tmp; windows are
// never shown (the e2e quiet mode).
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchMaws, type MawsLaunch } from './support/launch';
import { sidebarRow } from './support/sidebar';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

let launch: MawsLaunch | null = null;
let userData: string | null = null;

test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  if (userData) rmSync(userData, { recursive: true, force: true });
  userData = null;
});

// The panel's harness scenario (C8a): two synthetic sessions main serves, so a session's panel can hold tools.
const SESSIONS = 'stub:test/fixtures/panel/harness-sessions.json';
const PANEL_PX = 600; // the dashboard proofs' panel
const RAIL_PX = 304; // the rail's width beside the page, before and after the fix (chrome.css: 76 × --space)
// A 2 × 2 PNG, red and blue, as a person would pick from disk.
const TWO_BY_TWO_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DwnwEIGBgYGBgYAAAy7QL+1Hdq+wAAAABJRU5ErkJggg==', 'base64');

async function start(): Promise<Page> {
  mkdirSync('/tmp/maws-harness/a', { recursive: true }); // session A's directory in the scenario
  userData = mkdtempSync('/tmp/maws-e2e-document-narrow-');
  launch = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: SESSIONS } });
  const { page } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  // wide enough for a 600 px panel beside the sidebar and the main column's floor (1280 holds 500)
  await launch.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())!.setContentSize(1440, 900));
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1440);
  return page;
}

// The panel's Artifacts tool, added in session A's panel and pinned; the main area shows Harness A, so a comment has a
// session to go to.
async function pinArtifactsTool(page: Page): Promise<void> {
  const panel = page.locator('[data-region="panel"]');
  await (await sidebarRow(page, 'Harness A')).click();
  await panel.getByRole('button', { name: 'Add a tool' }).click();
  await page.getByRole('menuitem', { name: 'Artifacts' }).click();
  await panel.getByRole('button', { name: 'Pin Artifacts' }).click();
}

async function openInPanel(page: Page, artifactId: string): Promise<Locator> {
  const panel = page.locator('[data-region="panel"]');
  await panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /^Artifacts/ }).click();
  await panel.getByRole('button', { name: 'All', exact: true }).click();
  await panel.locator(`[data-artifact-row][data-artifact-id="${artifactId}"]`).click({ timeout: 15_000 });
  const record = panel.locator(`[data-artifact-record="${artifactId}"]`);
  await expect(record.locator('.ds-doc .ProseMirror')).toBeVisible({ timeout: 15_000 });
  return record;
}

// The panel dragged to `width` by its divider (the panel grows as the divider moves left).
async function resizePanel(page: Page, width: number): Promise<void> {
  const divider = page.locator('[data-region="panel"]').getByRole('separator', { name: 'Resize right panel' });
  const now = Number(await divider.getAttribute('aria-valuenow'));
  const grip = (await divider.boundingBox())!;
  const [x, y] = [grip.x + grip.width / 2, grip.y + grip.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - (width - now), y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Number(await divider.getAttribute('aria-valuenow'))).toBe(width);
}

// Selects `quote` inside the editor's paragraph `index` (a DOM selection the editor reads, as a person's drag would set).
async function selectIn(text: Locator, index: number, quote: string): Promise<void> {
  await text.evaluate(
    (root, [at, q]) => {
      const p = root.querySelectorAll('p')[at as number]!;
      const node = Array.from(p.childNodes).find((n): n is Text => n instanceof Text && n.data.includes(q as string));
      if (!node) throw new Error(`no "${q}" in paragraph ${at}`);
      const start = node.data.indexOf(q as string);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + (q as string).length);
      (root as HTMLElement).focus();
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    },
    [index, quote] as const,
  );
  await expect.poll(() => text.evaluate(() => getSelection()?.toString() ?? '')).toBe(quote);
}

const box = async (locator: Locator) => (await locator.boundingBox())!;
// Whether the element is what a click at its centre reaches (nothing covers or clips it there).
const takesClicks = (locator: Locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && (hit === el || el.contains(hit));
  });
// Every control of the toolbar lies inside its one row.
const oneRow = (toolbar: Locator) =>
  toolbar.evaluate((bar) => {
    const row = bar.getBoundingClientRect();
    return Array.from(bar.querySelectorAll('button, select')).every((control) => {
      const r = control.getBoundingClientRect();
      return r.top >= row.top - 0.5 && r.bottom <= row.bottom + 0.5;
    });
  });

// The toolbar's buttons whose label is not one whole line inside the button, each named with what its text's line boxes
// read: the label's text runs (Range rects of its text nodes, which a fixed-height button's clipping does not hide)
// spanning more than one line's height, or reaching past the button's sides. None, when every control keeps its own
// width and its label on one line.
const wrappedLabels = (toolbar: Locator) =>
  toolbar.evaluate((bar) => {
    const wrapped: string[] = [];
    for (const button of Array.from(bar.querySelectorAll<HTMLElement>('button'))) {
      if (!button.closest('[role="toolbar"] > div') || button.closest('[role="menu"], form')) continue; // the row's own controls, not an open menu's
      const rects: DOMRect[] = [];
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...Array.from(range.getClientRects()).filter((r) => r.width > 0));
      }
      if (rects.length === 0) continue;
      const line = Math.max(...rects.map((r) => r.height));
      const [top, bottom] = [Math.min(...rects.map((r) => r.top)), Math.max(...rects.map((r) => r.bottom))];
      const [left, right] = [Math.min(...rects.map((r) => r.left)), Math.max(...rects.map((r) => r.right))];
      const box = button.getBoundingClientRect();
      const lines = Math.round((bottom - top) / line);
      if (lines > 1 || left < box.left - 0.5 || right > box.right + 0.5) wrapped.push(`${button.getAttribute('aria-label') ?? button.textContent}: ${lines} lines, text ${Math.round(left)}–${Math.round(right)} in ${Math.round(box.left)}–${Math.round(box.right)}`);
    }
    return wrapped;
  });

test('in a 600 px panel the comments rail is a drawer over the page, the toolbar one row whose menus open whole; maximized, the rail sits beside the page as before', async () => {
  test.setTimeout(150_000);
  const page = await start();
  await pinArtifactsTool(page);
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'document', title: 'Narrow review' });
  const record = await openInPanel(page, artifact.id);
  await resizePanel(page, PANEL_PX);
  const text = record.locator('.ds-doc .ProseMirror');
  const toolbar = record.getByRole('toolbar', { name: 'Formatting' });
  const body = record.locator('.doc-editor-body');
  const frame = record.locator('.doc-page-frame');
  const table = text.locator('table');
  expect((await box(body)).width).toBeLessThan(720);
  expect((await box(body)).width).toBeGreaterThan(PANEL_PX - 40);

  await test.step('an image and a table on the page, the table from Insert’s menu, which opens whole from the strip', async () => {
    await text.click();
    await page.keyboard.type('The owner reviews the launch plan today.');
    await record.getByLabel('Image file').setInputFiles({ name: 'two.png', mimeType: 'image/png', buffer: TWO_BY_TWO_PNG });
    const img = text.getByRole('img', { name: 'two.png' });
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : -1)), { timeout: 15_000, message: 'the image loaded' }).toBe(2);
    expect(await oneRow(toolbar)).toBe(true);
    expect((await box(toolbar)).height).toBeLessThan(44);
    expect(await wrappedLabels(toolbar), 'every label one line inside its button at 600 px').toEqual([]);

    const insert = toolbar.getByRole('button', { name: 'Insert', exact: true });
    await insert.click();
    const menu = toolbar.getByRole('menu');
    await expect(menu).toBeVisible();
    const [menuBox, insertBox, barBox] = [await box(menu), await box(insert), await box(toolbar)];
    expect(menuBox.y, 'the menu below the toolbar').toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);
    expect(menuBox.x, 'the menu inside the toolbar').toBeGreaterThanOrEqual(barBox.x - 1);
    expect(menuBox.x + menuBox.width, 'the menu inside the toolbar').toBeLessThanOrEqual(barBox.x + barBox.width + 1);
    expect(Math.abs(menuBox.x - insertBox.x), 'the menu under its button').toBeLessThan(2);
    expect(menuBox.height, 'the menu whole, not clipped to the strip').toBeGreaterThan(insertBox.height * 4);
    for (const item of await menu.getByRole('menuitem').all()) expect(await takesClicks(item), `${await item.textContent()} takes clicks`).toBe(true);
    await test.info().attach('narrow-insert-menu', { body: await page.screenshot(), contentType: 'image/png' });
    await menu.getByRole('menuitem', { name: 'Table', exact: true }).click();
    await expect(table).toBeVisible();
    await page.keyboard.type('Owner');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Due date');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Status of the review');
    expect(await oneRow(toolbar), 'one row with the table’s controls in the strip').toBe(true);
    expect(await wrappedLabels(toolbar), 'every label one line with the table’s controls').toEqual([]);
  });

  await test.step('a comment on the passage, kept', async () => {
    await selectIn(text, 0, 'launch plan');
    await toolbar.getByRole('button', { name: 'Comment', exact: true }).click();
    const card = page.locator('[data-comment-card]');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Resolve' }).click();
    await expect(card).toHaveCount(0);
  });

  await test.step('the rail open: a drawer over the page’s right side, the page, its table and the toolbar as they were', async () => {
    const [frameBefore, tableBefore] = [await box(frame), await box(table)];
    await toolbar.getByRole('button', { name: /^Comments/ }).click();
    const rail = record.getByRole('complementary', { name: 'Comments' });
    await expect(rail).toBeVisible();
    await expect(body).toHaveAttribute('data-rail-layout', 'drawer');
    expect(await rail.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
    const [frameNow, tableNow, railBox, bodyBox, barBox] = [await box(frame), await box(table), await box(rail), await box(body), await box(toolbar)];
    expect(Math.abs(frameNow.width - frameBefore.width), 'the page keeps its width').toBeLessThan(1);
    expect(Math.abs(tableNow.width - tableBefore.width), 'the table keeps its width').toBeLessThan(1);
    expect(tableNow.x, 'the table whole in the page').toBeGreaterThanOrEqual(frameNow.x);
    expect(tableNow.x + tableNow.width, 'the table whole in the page').toBeLessThanOrEqual(frameNow.x + frameNow.width);
    expect(frameNow.width, 'a usable page').toBeGreaterThan(PANEL_PX - 40);
    expect(Math.abs(railBox.x + railBox.width - (bodyBox.x + bodyBox.width)), 'the drawer at the right edge').toBeLessThan(1);
    expect(railBox.width).toBeLessThan(bodyBox.width / 2 + 40);
    expect(railBox.y, 'the drawer under the toolbar').toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);
    expect(await oneRow(toolbar)).toBe(true);
    expect(await wrappedLabels(toolbar), 'every label one line with the drawer open').toEqual([]);
    for (const name of ['Comment', 'Find']) expect(await takesClicks(toolbar.getByRole('button', { name, exact: true })), `${name} uncovered`).toBe(true);
    expect(await takesClicks(toolbar.getByRole('button', { name: /^Comments/ })), 'the rail’s toggle uncovered').toBe(true);

    // the thread in the drawer takes its clicks: reopened from it
    const thread = rail.locator('article.doc-thread').first();
    await expect(thread).toHaveAttribute('data-status', 'resolved');
    const reopen = thread.getByRole('button', { name: 'Reopen' });
    expect(await takesClicks(reopen)).toBe(true);
    await reopen.click();
    await expect(thread).toHaveAttribute('data-status', 'open');
    await test.info().attach('narrow-rail-drawer', { body: await page.screenshot(), contentType: 'image/png' });

    // Escape in the drawer closes it, the keyboard back on the page
    await rail.getByRole('button', { name: 'Close comments' }).focus();
    await page.keyboard.press('Escape');
    await expect(rail).toHaveCount(0);
    await expect(body).not.toHaveAttribute('data-rail-layout');
    expect(await text.evaluate((el) => el === document.activeElement)).toBe(true);
  });

  await test.step('maximized: the rail beside the page at its old width', async () => {
    await page.locator('[data-region="panel"]').getByRole('button', { name: 'Maximize right panel' }).click();
    await expect.poll(async () => (await box(body)).width).toBeGreaterThan(1000);
    await toolbar.getByRole('button', { name: /^Comments/ }).click();
    const rail = record.getByRole('complementary', { name: 'Comments' });
    await expect(rail).toBeVisible();
    await expect(body).toHaveAttribute('data-rail-layout', 'beside');
    expect(await rail.evaluate((el) => getComputedStyle(el).position)).toBe('static');
    const [railBox, bodyBox, frameBox] = [await box(rail), await box(body), await box(frame)];
    expect(Math.abs(railBox.width - RAIL_PX), 'the rail at its old width').toBeLessThan(1);
    expect(Math.abs(frameBox.width - (bodyBox.width - RAIL_PX)), 'the page beside it').toBeLessThan(1);
    expect(await oneRow(toolbar)).toBe(true);
    expect(await wrappedLabels(toolbar), 'every label one line maximized').toEqual([]);
    await text.locator('td p').first().click(); // the caret in the table: its controls in the row too
    await expect(toolbar.getByRole('button', { name: 'Add row below', exact: true })).toBeVisible();
    expect(await oneRow(toolbar)).toBe(true);
    expect(await wrappedLabels(toolbar), 'every label one line maximized, with the table’s controls').toEqual([]);
    await test.info().attach('maximized-rail-beside', { body: await page.screenshot(), contentType: 'image/png' });
  });
});
