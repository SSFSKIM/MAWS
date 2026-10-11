// C7's status line end to end (C7 execution document, M5 and Acceptance item 2), and since W2 removed the line (§5.5 as
// amended 2026-10-01) what stayed of it: a session's windows as Session info reads them. M1 removes the near-limit
// banner without changing those readings. The built app on C5's stub scenario
// (`nine-sessions.json`, manual clock, one session re-pinned) with MAWS_CLAUDE_USAGE_DIR on a temporary copy of the
// committed ClaudeUsage fixture, every `recordedAt` and `resetsAt` moved by one offset so its newest reading is two
// minutes old (percentages untouched). The fixture's drain target is `2aca3c4b…` (5h 53 %, 7d 63 %); account
// `477e393c…` pins `73171552…` (5h 77 %, 7d 44 %); the one window at or over 90 % is `aa9db20d…`'s 5-hour window at
// 100 %. Runs on a plain build; the owner's ClaudeUsage directory is never read.
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

// W2: the session's tab, then Session info in its panel: the Usage row (no status line carries the windows).
async function open(page: Page, title: string): Promise<Locator> {
  await (await sidebarRow(page, title)).click();
  await expect(page.locator('[data-region="main"]').getByRole('tabpanel').getByRole('group', { name: 'Session status' })).toHaveCount(0);
  const tools = page.locator('[data-region="panel"]');
  if (!(await tools.locator('[data-session-info]').isVisible())) {
    // the panel's layout persists: after a reload the session's Session info tab is already there
    await tools.getByRole('button', { name: 'Add a tool' }).click();
    await page.getByRole('menuitem', { name: 'Session info' }).click();
  }
  return tools.locator('[data-session-info]').getByRole('term').filter({ hasText: /^Usage$/ }).locator('xpath=following-sibling::dd[1]');
}
const nearLimitBanners = (page: Page) => page.locator('[data-banner-host] [role="status"]').filter({ hasText: 'window at' });

test('usage: Session info keeps reset times while near-limit windows never post a banner', async () => {
  test.setTimeout(90_000);
  const maws = await launchMaws({ env: ENV() });
  const { page } = maws;
  try {
    // An unpinned routed session reads the drain target's windows.
    const quota = await open(page, QUOTA);
    // the countdown's numbers and units are the system locale's (2h 37m; 2시간 37분: D2 widened, app/date-format.ts)
    await expect(quota).toHaveText(/^5h 53% · resets in \d+(h|시간) \d+(m|분) · Weekly 63% · resets in \d+(d|h|일|시간) \d+(h|m|시간|분) · from ClaudeUsage, shared by every session$/);

    // A session pinned to another account shows that account's windows.
    const probe = await open(page, PROBE);
    await expect(probe).toHaveText(/^5h 77% · resets in .* · Weekly 44% · resets in /);

    // A direct session reads the engine's get_usage instead, which the stub does not answer.
    const charter = await open(page, CHARTER);
    await expect(charter).toHaveText('—');

    // Even an exhausted window posts nothing; the legacy layout key stays readable but unwritten.
    await expect(nearLimitBanners(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.maws.invoke('layout.get', { key: 'usage.banners' }))).toMatchObject({ ok: true, value: { value: null } });

    await page.reload();
    const again = await open(page, QUOTA);
    await expect(again).toHaveText(/^5h 53% /);
    const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); // ClaudeUsage's form, compared as text
    const row = { limitKey: 'session', percent: 95, recordedAt: iso(Date.now()), resetsAt: iso(Date.now() + 2 * 3_600_000) };
    appendFileSync(join(usageDir, 'history', '477e393c-5c1a-4413-a3e6-7f5d1ed72cc3.jsonl'), `${JSON.stringify(row)}\n`);
    await expect(await open(page, PROBE)).toHaveText(/^5h 95% · resets in /, { timeout: 10_000 });
    await expect(nearLimitBanners(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.maws.invoke('layout.get', { key: 'usage.banners' }))).toMatchObject({ ok: true, value: { value: null } });
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

test('usage: without ClaudeUsage data the windows read —, and no banner posts', async () => {
  const maws = await launchMaws({ env: { ...ENV(), MAWS_CLAUDE_USAGE_DIR: join(scratch, 'absent') } });
  try {
    await expect(await open(maws.page, QUOTA)).toHaveText('—');
    await expect(nearLimitBanners(maws.page)).toHaveCount(0);
  } finally {
    await maws.cleanup();
  }
});
