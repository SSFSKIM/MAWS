// C7's status line end to end (C7 execution document, M5 and Acceptance item 2): the built app on C5's stub scenario
// (`nine-sessions.json`, manual clock, one session re-pinned) with MAWS_CLAUDE_USAGE_DIR on a temporary copy of the
// committed ClaudeUsage fixture, every `recordedAt` and `resetsAt` moved by one offset so its newest reading is two
// minutes old (percentages untouched). The fixture's drain target is `2aca3c4b…` (5h 53 %, 7d 63 %); account
// `477e393c…` pins `73171552…` (5h 77 %, 7d 44 %); the one window at or over 90 % is `aa9db20d…`'s 5-hour window at
// 100 %. Runs on a plain build; the owner's ClaudeUsage directory is never read.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchMaws, REPO_ROOT } from './support/launch';

const QUOTA = 'Quota reset recovery'; // routed, its engine id unpinned: the drain target's windows
const PROBE = 'Settings idle probe'; // routed, re-pinned below to account 477e393c…
const CHARTER = 'Charter + research'; // direct: the engine's own windows, none from the stub
const PINNED_ENGINE_ID = '73171552-c2ff-47db-b361-ca541bdf560e';
const NEAR_LIMIT = /^5-hour window at 100% for 4@example\.test · resets in \d+m$/;

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

async function open(page: Page, title: string): Promise<Locator> {
  await page.locator('[data-region="sidebar"]').getByRole('treeitem', { name: title }).click();
  return page.locator('[data-region="main"]').getByRole('tabpanel').getByRole('group', { name: 'Session status' });
}
const field = (line: Locator, prefix: string) => line.getByRole('button', { name: new RegExp(`^${prefix}`) });
const nearLimitBanners = (page: Page) => page.locator('[data-banner-host] [role="status"]').filter({ hasText: 'window at' });

test('status line: the session’s account windows, the usage popover, and one near-limit banner that stays dismissed', async () => {
  test.setTimeout(90_000);
  const maws = await launchMaws({ env: ENV() });
  const { page } = maws;
  try {
    // An unpinned routed session reads the drain target's windows.
    const quota = await open(page, QUOTA);
    await expect(field(quota, '5h')).toHaveText(/^5h 53% ↻\d+h\d+m$/);
    await expect(field(quota, '7d')).toHaveText(/^7d 63% ↻\d+[dh]\d+[hm]$/);

    // Its 5h popover: the drain target, marked routing, and the four other accounts.
    await field(quota, '5h').click();
    const popover = page.getByRole('dialog', { name: 'Account usage' });
    await expect(popover.getByText('3@example.test · Max · routing')).toBeVisible();
    await expect(popover.getByRole('meter', { name: 'Five-hour usage' })).toHaveAttribute('aria-valuenow', '53');
    await popover.getByText('Other accounts').click();
    await expect(popover.getByRole('list', { name: 'Other accounts' }).getByRole('listitem')).toHaveCount(4);
    await expect(popover.getByText(/^Updated \dm ago$/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);

    // A session pinned to another account shows that account's windows.
    const probe = await open(page, PROBE);
    await expect(field(probe, '5h')).toHaveText(/^5h 77% ↻/);
    await expect(field(probe, '7d')).toHaveText(/^7d 44% ↻/);

    // A direct session reads the engine's get_usage instead, which the stub does not answer.
    const charter = await open(page, CHARTER);
    await expect(field(charter, '5h')).toHaveText('5h —');

    // One near-limit banner in the banner host, for the one window at 100 %; dismissed, it is kept in usage.banners.
    await expect(nearLimitBanners(page)).toHaveCount(1);
    await expect(nearLimitBanners(page).locator('span').first()).toHaveText(NEAR_LIMIT);
    await nearLimitBanners(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(nearLimitBanners(page)).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.maws.invoke('layout.get', { key: 'usage.banners' })))
      .toMatchObject({ ok: true, value: { value: [expect.stringMatching(/^usage:aa9db20d-af2c-4718-ba6f-5cea946b4974:session:.+Z$/)] } });

    // After a reload the windows come back and the dismissed banner does not.
    await page.reload();
    const again = await open(page, QUOTA);
    await expect(field(again, '5h')).toHaveText(/^5h 53% /);
    await page.waitForTimeout(1500); // the banner rule has run over the snapshot and the dismissed keys by now
    await expect(nearLimitBanners(page)).toHaveCount(0);
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

test('status line: without ClaudeUsage data both windows read — with the reason', async () => {
  const maws = await launchMaws({ env: { ...ENV(), MAWS_CLAUDE_USAGE_DIR: join(scratch, 'absent') } });
  try {
    const line = await open(maws.page, QUOTA);
    for (const prefix of ['5h', '7d']) {
      await expect(field(line, prefix)).toHaveText(`${prefix} —`);
      await expect(field(line, prefix)).toHaveAttribute('title', 'ClaudeUsage is not installed or has no data');
    }
    await expect(nearLimitBanners(maws.page)).toHaveCount(0);
  } finally {
    await maws.cleanup();
  }
});
