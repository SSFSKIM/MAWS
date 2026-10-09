// The resume chooser end to end (the P2 spec docs/doperpowers/plans/2026-10-08-p2-daily-driver.md, child P2-D, G1 to
// G5; charter §5.1 as amended 2026-10-01, W11, I7): on the stub scenario, the search icon on an expanded project's row
// and `/resume` in a session's composer open the same chooser in X19's library box, scoped to the project. A search
// narrows it; the preview shows the cached facts at once and the recent turns read from the scenario's engine transcript
// (`session.recentTurns`), starting no engine and leaving the session unread; Enter opens in the current tab, ⌘Enter in a
// new one.
import { expect, test, type Page } from '@playwright/test';
import { clickRevealed } from './support/hover';
import { launchMaws } from './support/launch';
import { openProject, projectLine, projectRow, sidebarOf } from './support/sidebar';

const SHELL_ENV = { MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/nine-sessions.json', MAWS_SCENARIO_CLOCK: 'manual' };
const FIX = 'Fix sidebar drag'; // unread, its transcript test/fixtures/transcripts/w1-steer-next-disk.jsonl
const CHARTER = 'Charter + research'; // its transcript subagent-parent.jsonl
const NORTH = 'Workstation north star'; // no process: an exited session
const HELD = 'Somersault terminal run'; // held by a terminal

// P2-A's `SessionDigest.availability` for a session, from main's read model (the renderer's own client)
const availabilityOf = (page: Page, title: string) =>
  page.evaluate(async (t) => {
    const records = await window.maws.invoke('session.list', {});
    const digests = await window.maws.invoke('session.digests', undefined);
    if (!records.ok || !digests.ok) return null;
    const id = records.value.sessions.find((r) => r.title.text === t)?.appId;
    return digests.value.digests.find((d) => d.appSessionId === id)?.availability ?? null;
  }, title);

const chooser = (page: Page) => page.getByRole('dialog', { name: 'Resume session' });
const options = (page: Page) => chooser(page).getByRole('option');
const sessionRow = (page: Page, title: string) => sidebarOf(page).getByRole('treeitem', { name: title });

async function openFromSidebar(page: Page): Promise<void> {
  await openProject(page, 'MAWS');
  const row = projectRow(page, 'MAWS');
  await clickRevealed(projectLine(row), row.getByRole('button', { name: 'Resume a session in MAWS' }));
  await expect(chooser(page)).toBeVisible();
}

test('resume chooser from the sidebar: library box, search, the lazy preview, Enter in the current tab', async () => {
  const maws = await launchMaws({ env: SHELL_ENV });
  try {
    const { page } = maws;
    await expect(page.locator('[data-region="sidebar"] [data-kind="project"]')).toHaveCount(4, { timeout: 15_000 });
    await openFromSidebar(page);
    const dialog = chooser(page);
    await expect(dialog).toHaveAttribute('data-widget-size', 'library');
    const box = (await dialog.boundingBox())!;
    expect(box.width, 'wider than the 560 px utility box').toBeGreaterThan(600);
    await expect(dialog.getByTestId('resume-scope')).toHaveText('MAWS');
    await expect(options(page)).toHaveCount(4);
    await expect(dialog.getByRole('combobox', { name: 'Search by title, folder, or branch' })).toBeFocused();

    await page.keyboard.type('drag');
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).first()).toContainText(FIX);
    const preview = dialog.getByTestId('resume-preview');
    await expect(preview).toContainText('Folder/private/tmp/maws-probe-qqboLh'); // the record's own directory
    await expect(preview).toContainText('Last active');
    const turns = preview.getByTestId('resume-turns');
    await expect(turns).toContainText('Count to 8 with separate Bash sleep 1 calls');
    await expect(turns).toContainText('8 tool calls');
    await expect(turns).toContainText('COUNTED');
    // previewing an unread session leaves it unread
    // (the modal dialog hides the window behind it from the accessibility tree, so the row is read with hidden ones)
    await expect(sidebarOf(page).getByRole('treeitem', { name: FIX, includeHidden: true }).getByRole('img', { name: 'Unread', includeHidden: true })).toHaveCount(1);

    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('tab', { name: `${FIX} · MAWS` })).toHaveAttribute('aria-selected', 'true');
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// The architect's check (2026-10-09): the chooser has no Resume button of its own, so an exited session it opens still
// offers today's Resume action in its pane's session actions, and nothing the owner could do before is lost until P2-A's
// first Send continues it.
test('resume chooser: an exited session opens to its transcript with the session actions’ Resume still offered', async () => {
  const maws = await launchMaws({ env: SHELL_ENV });
  try {
    const { page } = maws;
    await expect(page.locator('[data-region="sidebar"] [data-kind="project"]')).toHaveCount(4, { timeout: 15_000 });
    // the row's own menu first: what the owner had before the chooser (enabled where C10 registers its handler, the
    // product's index mode; the stub scenario registers none, so it renders disabled there, before and after alike)
    await openProject(page, 'MAWS');
    await sessionRow(page, NORTH).click({ button: 'right' });
    const before = page.getByRole('menuitem', { name: 'Resume', exact: true });
    await expect(before).toBeVisible();
    const enabled = await before.isEnabled();
    await page.keyboard.press('Escape');

    await openFromSidebar(page);
    await page.keyboard.type('north star');
    await expect(options(page)).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(chooser(page)).toHaveCount(0);
    await expect(page.getByRole('tab', { name: `${NORTH} · MAWS` })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('banner').getByRole('button', { name: 'Session actions' }).click();
    const after = page.getByRole('menuitem', { name: 'Resume', exact: true });
    await expect(after, 'the opened session offers Resume as its row did').toBeVisible();
    expect(await after.isEnabled()).toBe(enabled);
    await page.keyboard.press('Escape');
    // P2-A (X16): opening and selecting started nothing; the session stays resumable, for the first Send to acquire
    expect(await availabilityOf(page, NORTH)).toBe('resumable');
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// P2-A's availability, read only: a session no gesture continues from here says why in the preview (a terminal holds it).
test('resume chooser: a terminal-held session previews with the reason it cannot be continued here', async () => {
  const maws = await launchMaws({ env: SHELL_ENV });
  try {
    const { page } = maws;
    await expect(page.locator('[data-region="sidebar"] [data-kind="project"]')).toHaveCount(4, { timeout: 15_000 });
    await openFromSidebar(page);
    await page.keyboard.press('Control+a'); // All projects
    await page.keyboard.type('somersault terminal');
    await expect(options(page)).toHaveCount(1);
    expect(await availabilityOf(page, HELD)).toBe('foreign_held');
    await expect(chooser(page).getByTestId('resume-refusal')).toHaveText(/^Held by terminal · \d+$/);
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

test('resume chooser from /resume: the same chooser over the session’s project, ⌘Enter in a new tab, Esc back to the composer', async () => {
  const maws = await launchMaws({ env: SHELL_ENV });
  try {
    const { page } = maws;
    await expect(page.locator('[data-region="sidebar"] [data-kind="project"]')).toHaveCount(4, { timeout: 15_000 });
    await openProject(page, 'MAWS');
    await sessionRow(page, CHARTER).click();
    await expect(page.getByRole('tab', { name: `${CHARTER} · MAWS` })).toHaveAttribute('aria-selected', 'true');
    const message = page.getByRole('textbox', { name: 'Message' });
    await message.click();
    await page.keyboard.type('/resume ');
    await expect(page.getByRole('listbox', { name: 'Commands' })).toBeHidden();
    await page.keyboard.press('Enter');

    const dialog = chooser(page);
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-widget-dialog="resume"]')).toHaveAttribute('data-widget-size', 'library');
    await expect(dialog.getByTestId('resume-scope')).toHaveText('MAWS');
    await expect(options(page)).toHaveCount(3); // the project's other sessions
    await expect(options(page).filter({ hasText: CHARTER })).toHaveCount(0);

    // Esc closes and hands the keyboard back to the composer
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(message).toBeFocused();

    await page.keyboard.type('/resume ');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.type('drag');
    await expect(options(page)).toHaveCount(1);
    await page.keyboard.press('Meta+Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('tab', { name: `${FIX} · MAWS` })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: `${CHARTER} · MAWS` }), 'a new tab beside the one it was opened from').toHaveCount(1);
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws.cleanup();
  }
});
