// C7's status line end to end (C7 execution document, M5 and Acceptance item 2), and since W2 removed the line (§5.5 as
// amended 2026-10-01) what stayed of it: a session's windows as Session info read them, until the word cut (P176) left
// them to the usage displays; the windows are read here in the usage ring's popover, each account's limit rows, and
// Session info is checked to draw no windows row. M1 removes the near-limit banner without changing those readings. The built app on C5's stub scenario
// (`nine-sessions.json`, manual clock, one session re-pinned) with MAWS_CLAUDE_USAGE_DIR on a temporary copy of the
// committed ClaudeUsage fixture, every `recordedAt` and `resetsAt` moved by one offset so its newest reading is two
// minutes old (percentages untouched). The fixture's drain target is `2aca3c4b…` (5h 53 %, 7d 63 %); account
// `477e393c…` pins `73171552…` (5h 77 %, 7d 44 %); the one window at or over 90 % is `aa9db20d…`'s 5-hour window at
// 100 %. Runs on a plain build; the owner's ClaudeUsage directory is never read.
import { openSurface, surface, usageRing } from './support/shell';
import { appendFileSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchMaws, REPO_ROOT } from './support/launch';
import { sidebarRow } from './support/sidebar';

const QUOTA = 'Quota reset recovery'; // routed, its engine id unpinned: the drain target's windows
const PROBE = 'Settings idle probe'; // routed, re-pinned below to account 477e393c…
const CHARTER = 'Charter + research'; // direct: the engine's own windows, none from the stub
const PINNED_ENGINE_ID = '73171552-c2ff-47db-b361-ca541bdf560e';

let scratch: string;
let usageDir: string;
let scenario: string;

test.beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maws-c7-statusline-'));
  usageDir = join(scratch, 'claude-usage');
  cpSync(join(REPO_ROOT, 'test/fixtures/claude-usage'), usageDir, { recursive: true });
  const history = join(usageDir, 'history');
  const files = readdirSync(history).map((name) => join(history, name));
  const rows = (file: string) => readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  const newest = Math.max(...files.flatMap((file) => rows(file).map((row) => Date.parse(row.recordedAt as string))));
  const offset = Date.now() - 2 * 60_000 - newest;
  const shift = (at: unknown) => new Date(Date.parse(at as string) + offset).toISOString().replace('.000Z', 'Z');
  for (const file of files) writeFileSync(file, rows(file).map((row) => JSON.stringify({ ...row, recordedAt: shift(row.recordedAt), resetsAt: shift(row.resetsAt) })).join('\n') + '\n');

  const nine = JSON.parse(readFileSync(join(REPO_ROOT, 'test/fixtures/shell/nine-sessions.json'), 'utf8')) as { sessions: { title: { text: string }; engineSessionId: string }[] };
  nine.sessions.find((s) => s.title.text === PROBE)!.engineSessionId = PINNED_ENGINE_ID;
  scenario = join(scratch, 'scenario.json');
  writeFileSync(scenario, JSON.stringify(nine));
});
test.afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const ENV = () => ({ MAWS_SESSION_SOURCE: `stub:${scenario}`, MAWS_SCENARIO_CLOCK: 'manual', MAWS_CLAUDE_USAGE_DIR: usageDir });

// The word cut (P176): the session's tab, then Session info in its panel, which draws no windows row (the context and
// usage displays show those numbers); its Usage group keeps Cost.
async function noWindowsInSessionInfo(page: Page, title: string): Promise<void> {
  await (await sidebarRow(page, title)).click();
  await expect(page.locator('[data-region="main"]').getByRole('tabpanel').getByRole('group', { name: 'Session status' })).toHaveCount(0);
  await openSurface(page, 'Session info');
  const info = surface(page, 'session-info').locator('[data-session-info]');
  await expect(info.locator('dt', { hasText: /^Cost$/ })).toHaveCount(1);
  await expect(info.locator('dt', { hasText: /^Usage$/ })).toHaveCount(0);
}
// The usage ring's popover (UX wave U7b, O-47): each Claude account by its email, its limit rows a meter and a reset.
const popoverOf = (page: Page) => page.getByRole('dialog', { name: 'Usage', exact: true });
async function account(page: Page, email: string): Promise<Locator> {
  if (!(await popoverOf(page).count())) await usageRing(page).click();
  await expect(popoverOf(page)).toBeVisible();
  return popoverOf(page).locator(`[data-account][aria-label="${email}"]`);
}
const meter = (scope: Locator, name: string) => scope.getByRole('meter', { name, exact: true });
// The fixture's drain target `2aca3c4b…` is 3@example.test; `477e393c…` (which the probe session pins) is 1@example.test.
const DRAIN = '3@example.test';
const PINNED = '1@example.test';
const nearLimitBanners = (page: Page) => page.locator('[data-banner-host] [role="status"]').filter({ hasText: 'window at' });

test('usage: the popover keeps each account’s windows and reset times, Session info repeats none, and near-limit windows never post a banner', async () => {
  test.setTimeout(90_000);
  const maws = await launchMaws({ env: ENV() });
  const { page } = maws;
  try {
    // Session info draws no windows row, for a routed session, a pinned one, and a direct one alike (P176).
    for (const title of [QUOTA, PROBE, CHARTER]) await noWindowsInSessionInfo(page, title);

    // The drain target's windows, which an unpinned routed session reads: each a meter and its reset countdown, in the
    // display locale's numbers and units (2h 37m; English throughout, @shared/app/date-format).
    const drain = await account(page, DRAIN);
    await expect(meter(drain, 'Five-hour usage')).toHaveAttribute('aria-valuenow', '53');
    await expect(meter(drain, 'Weekly usage')).toHaveAttribute('aria-valuenow', '63');
    expect(await drain.locator('[data-limit]').evaluateAll((rows) => rows.slice(0, 2).map((row) => row.lastElementChild?.textContent ?? ''))).toEqual([expect.stringMatching(/^\d+h \d+m$/), expect.stringMatching(/^\d+(d|h) \d+(h|m)$/)]);

    // The account a pinned session reads: its own windows.
    const pinned = await account(page, PINNED);
    await expect(meter(pinned, 'Five-hour usage')).toHaveAttribute('aria-valuenow', '77');
    await expect(meter(pinned, 'Weekly usage')).toHaveAttribute('aria-valuenow', '44');
    await page.keyboard.press('Escape');
    await expect(popoverOf(page)).toHaveCount(0);

    // Even an exhausted window posts nothing; the legacy layout key stays readable but unwritten.
    await expect(nearLimitBanners(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.maws.invoke('layout.get', { key: 'usage.banners' }))).toMatchObject({ ok: true, value: { value: null } });

    await page.reload();
    await expect(meter(await account(page, DRAIN), 'Five-hour usage')).toHaveAttribute('aria-valuenow', '53');
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// The per-session half (the word cut, P176): Session info no longer resolves a session's windows, and the popover is per
// account, so which account a session reads is proved on the surface that still resolves it per session, the `/usage`
// widget (widgets/UsageWidget.tsx, `AccountWindows`), answered by the fixture widget backend over this spec's scenario
// (its get_usage is reads.jsonl's, which reports no plan limits). Each session is opened by its sidebar row first, so its
// tab is open and main is asked for its account pin.
async function usageWidget(page: Page, title: string): Promise<Locator> {
  if (await page.locator('[data-widget="usage"]').count()) await page.keyboard.press('Escape');
  await expect(page.locator('[data-widget="usage"]')).toHaveCount(0);
  await (await sidebarRow(page, title)).click();
  await page.locator('[data-region="main"]').getByRole('textbox', { name: 'Message' }).click();
  await page.keyboard.type('/usage');
  const chosen = page.getByRole('listbox', { name: 'Commands' }).locator('[role="option"][aria-selected="true"]');
  await expect(chosen).toContainText('/usage');
  await page.keyboard.press('Enter');
  const widget = page.locator('[data-widget="usage"]');
  await expect(widget).toBeVisible();
  return widget;
}
const windowValue = (group: Locator, label: '5h' | 'Weekly') => group.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');

test('usage: each session reads its own windows in /usage: the routed one the drain target’s, the pinned one its account’s, the direct one the engine’s', async () => {
  test.setTimeout(90_000);
  const maws = await launchMaws({ env: { ...ENV(), MAWS_WIDGET_BACKEND: 'fixtures' } });
  const { page } = maws;
  try {
    // an unpinned routed session: the drain target's windows
    const routed = (await usageWidget(page, QUOTA)).getByRole('region', { name: 'Routing account', exact: true });
    await expect(routed).toContainText(DRAIN);
    await expect(windowValue(routed, '5h')).toHaveText(/^53% · resets in /);
    await expect(windowValue(routed, 'Weekly')).toHaveText(/^63% · resets in /);

    // a session pinned to another account: that account's windows, not the drain target's
    const pinned = (await usageWidget(page, PROBE)).getByRole('region', { name: 'Pinned account', exact: true });
    await expect(pinned).toContainText(PINNED);
    await expect(pinned).not.toContainText(DRAIN);
    await expect(windowValue(pinned, '5h')).toHaveText(/^77% · resets in /);
    await expect(windowValue(pinned, 'Weekly')).toHaveText(/^44% · resets in /);
    // a newer sample of that account's five-hour window, written while the widget is open: the pinned session's widget
    // reads it (ClaudeUsage's history is this spec's one copy, so the sample is appended here, after the 77% above), and
    // even an exhausted window posts no banner, the legacy layout key readable but unwritten
    const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); // ClaudeUsage's form, compared as text
    const row = { limitKey: 'session', percent: 95, recordedAt: iso(Date.now()), resetsAt: iso(Date.now() + 2 * 3_600_000) };
    appendFileSync(join(usageDir, 'history', '477e393c-5c1a-4413-a3e6-7f5d1ed72cc3.jsonl'), `${JSON.stringify(row)}\n`);
    await expect(windowValue(pinned, '5h')).toHaveText(/^95% · resets in /, { timeout: 10_000 });
    await expect(windowValue(pinned, 'Weekly')).toHaveText(/^44% · resets in /);
    await expect(nearLimitBanners(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.maws.invoke('layout.get', { key: 'usage.banners' }))).toMatchObject({ ok: true, value: { value: null } });

    // a direct session: the engine's own reading, never an account's
    const widget = await usageWidget(page, CHARTER);
    const direct = widget.getByRole('region', { name: 'Direct', exact: true }); // the word cut (P592)
    await expect(direct).toHaveText(/The engine reported no plan limits$/);
    await expect(widget.getByRole('region', { name: /^(Routing|Pinned) account$/ })).toHaveCount(0);
    await expect(widget).not.toContainText(DRAIN);
    await expect(widget).not.toContainText(PINNED);
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

test('usage: without ClaudeUsage data the popover says so, and no banner posts', async () => {
  const maws = await launchMaws({ env: { ...ENV(), MAWS_CLAUDE_USAGE_DIR: join(scratch, 'absent') } });
  try {
    await noWindowsInSessionInfo(maws.page, QUOTA);
    await account(maws.page, DRAIN);
    await expect(popoverOf(maws.page).locator('[data-usage-none]')).toHaveText('ClaudeUsage is not installed or has no data');
    await expect(popoverOf(maws.page).locator('[data-account]')).toHaveCount(0);
    await expect(nearLimitBanners(maws.page)).toHaveCount(0);
  } finally {
    await maws.cleanup();
  }
});
