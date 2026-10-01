// C11's Accounts tab end to end (C11 execution document, Acceptance item 2, `accounts.spec.ts`): the built app on C5's
// stub scenario (`nine-sessions.json`, manual clock, `Settings idle probe` re-pinned to engine id 73171552…) with
// MAWS_CLAUDE_USAGE_DIR on this spec's own temporary copy of the committed ClaudeUsage fixture, every `recordedAt` and
// `resetsAt` moved by one offset so its newest reading is two minutes old (C7's recipe, e2e/statusline.spec.ts). The
// fixture: five accounts `1@` to `5@example.test`, drain target `2aca3c4b…` = 3@ (not manual), no account needing
// reauthentication, the one window at 100 % 4@'s five-hour one. The owner's ClaudeUsage directory is never read, and
// under MAWS_E2E main answers `/usr/bin/open` without running it, so nothing activates the owner's ClaudeUsage.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { launchMaws, REPO_ROOT } from './support/launch';
import { sidebarRow } from './support/sidebar';

const QUOTA = 'Quota reset recovery'; // routed, its engine id unpinned: the drain target's windows
const PROBE = 'Settings idle probe'; // routed, re-pinned below to account 477e393c… (1@example.test)
const PINNED_ENGINE_ID = '73171552-c2ff-47db-b361-ca541bdf560e';
const ORDER = ['3@example.test', '4@example.test', '1@example.test', '5@example.test', '2@example.test'];

let scratch: string;
let usageDir: string;
let scenario: string;

test.beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maws-c11-accounts-'));
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

const ENV = (dir = usageDir) => ({ MAWS_SESSION_SOURCE: `stub:${scenario}`, MAWS_SCENARIO_CLOCK: 'manual', MAWS_CLAUDE_USAGE_DIR: dir });

// W6: the relay's requests (synthetic, `gateway-requests.jsonl`) moved so the newest ended 30 s ago, at the start of the
// test that reads them: the popover counts the last ten minutes from the wall clock.
function freshRequests(): void {
  const file = join(usageDir, 'gateway-requests.jsonl');
  const rows = readFileSync(join(REPO_ROOT, 'test/fixtures/claude-usage/gateway-requests.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { startedAt: string; totalSeconds: number });
  const newest = Math.max(...rows.map((row) => Date.parse(row.startedAt) + row.totalSeconds * 1000));
  const offset = Date.now() - 30_000 - newest;
  writeFileSync(file, rows.map((row) => JSON.stringify({ ...row, startedAt: new Date(Date.parse(row.startedAt) + offset).toISOString() })).join('\n') + '\n');
}
// A token's computed colour, for comparing a rendered colour with it.
const tokenColor = (page: Page, token: string) =>
  page.evaluate((token) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${token})`;
    document.body.append(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  }, token);

// Clicks an application-menu item by id once the page has registered its handler (the menu enables it then).
async function menu(app: ElectronApplication, id: string): Promise<void> {
  const click = () =>
    app.evaluate(({ Menu }, id) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      if (!item?.enabled) return false;
      item.click();
      return true;
    }, id);
  await expect.poll(click, { message: `menu item ${id} exists and is enabled` }).toBe(true);
}
const panel = (page: Page) => page.locator('[data-region="main"]').getByRole('tabpanel');
const card = (page: Page, email: string) => panel(page).locator(`[data-account][aria-label="${email}"]`);
const meter = (scope: Locator, name: string) => scope.getByRole('meter', { name, exact: true });
// W2: the session's windows as Session info's Usage row reads them (the status line that showed them is gone).
async function sessionWindows(page: Page, title: string): Promise<[string, string]> {
  await (await sidebarRow(page, title)).click();
  const tools = page.locator('[data-region="panel"]');
  await tools.getByRole('button', { name: 'Add a tool' }).click();
  await page.getByRole('menuitem', { name: 'Session info' }).click();
  const usage = tools.locator('[data-session-info]').getByRole('term').filter({ hasText: /^Usage$/ }).locator('xpath=following-sibling::dd[1]');
  await expect(usage).toHaveText(/^5h \d+% .* · Weekly \d+% /);
  const text = (await usage.textContent()) ?? '';
  return [/5h (\d+)%/.exec(text)![1]!, /Weekly (\d+)%/.exec(text)![1]!];
}

test('accounts: ClaudeUsage’s accounts in its geometry, the routing one and why, a reauth account, and the hand-off', async () => {
  test.setTimeout(90_000);
  const maws = await launchMaws({ env: ENV() });
  const { app, page } = maws;
  try {
    // The windows Session info reads for the unpinned routed session (the drain target's) and the re-pinned one (1@'s).
    const [quota5h, quota7d] = await sessionWindows(page, QUOTA);
    const [probe5h, probe7d] = await sessionWindows(page, PROBE);
    expect([quota5h, quota7d, probe5h, probe7d]).toEqual(['53', '63', '77', '44']);

    await menu(app, 'accounts.open');
    await expect(page.locator('[data-region="main"]').getByRole('tab', { name: /Accounts/ })).toBeVisible();
    const cards = panel(page).locator('[data-account]');
    await expect(cards).toHaveCount(5);
    expect(await cards.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(ORDER);

    // ClaudeUsage's grid is two columns at three or more accounts, one again in a tab narrower than 620 px: beside the
    // right panel in the e2e window (1280 px) the tab is 600 px wide; with the panel closed, two columns.
    const boxes = () => Promise.all([0, 1, 2].map((i) => cards.nth(i).boundingBox()));
    let [a, b, c] = await boxes();
    expect(b!.y).toBeGreaterThan(a!.y + 10);
    await menu(app, 'panel.toggle');
    await expect.poll(async () => ((await boxes())[1]!.y === (await boxes())[0]!.y ? 'side by side' : 'stacked'), { timeout: 15_000 }).toBe('side by side'); // the panel's close and the grid's reflow can take a few frames under load
    [a, b, c] = await boxes();
    expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1);
    expect(c!.y).toBeGreaterThan(a!.y + 10);

    const routing = card(page, '3@example.test');
    await expect(routing).toContainText('Routing here · weekly resets soonest of the usable accounts');
    await expect(routing).toContainText('8 saved sessions');
    for (const email of ORDER.slice(1)) {
      await expect(card(page, email)).toContainText('1 saved session');
      await expect(card(page, email)).not.toContainText('Routing here');
    }
    for (const email of ORDER) {
      expect(await card(page, email).locator('[data-limit]').evaluateAll((els) => els.map((el) => el.firstElementChild!.textContent))).toEqual(['5h', 'Weekly', 'Fable']);
    }
    // The same percents as Session info: 3@ for the unpinned routed session, 1@ for the re-pinned one.
    await expect(meter(routing, 'Five-hour usage')).toHaveAttribute('aria-valuenow', quota5h);
    await expect(meter(routing, 'Weekly usage')).toHaveAttribute('aria-valuenow', quota7d);
    await expect(meter(card(page, '1@example.test'), 'Five-hour usage')).toHaveAttribute('aria-valuenow', probe5h);
    await expect(meter(card(page, '1@example.test'), 'Weekly usage')).toHaveAttribute('aria-valuenow', probe7d);
    // 4@'s five-hour window at 100 %, in --danger; 2@'s five-hour reset has passed: 0 % and no reading since.
    await expect(meter(card(page, '4@example.test'), 'Five-hour usage')).toHaveAttribute('aria-valuenow', '100');
    const danger = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--danger)';
      document.body.append(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      return rgb;
    });
    await expect(meter(card(page, '4@example.test'), 'Five-hour usage').locator('[data-full]')).toHaveCSS('background-color', danger);
    await expect(meter(card(page, '2@example.test'), 'Five-hour usage')).toHaveAttribute('aria-valuenow', '0');
    await expect(card(page, '2@example.test')).toContainText('5h · no reading since the window reset');
    await expect(panel(page).getByText(/^read from ClaudeUsage · updated \dm ago$/)).toBeVisible();

    // ClaudeUsage marks 5@ as needing reauthentication: the tab follows C7's watcher by itself.
    const accountsFile = join(usageDir, 'accounts.json');
    const accounts = JSON.parse(readFileSync(accountsFile, 'utf8')) as { email: string; needsReauthentication: boolean }[];
    writeFileSync(accountsFile, JSON.stringify(accounts.map((x) => (x.email === '5@example.test' ? { ...x, needsReauthentication: true } : x)), null, 2));
    await expect(card(page, '5@example.test')).toHaveAttribute('data-state', 'needs_reauth', { timeout: 10_000 });
    await expect(card(page, '5@example.test')).toContainText('Needs reauthentication · the relay skips it until it is reconnected; readings are last known');
    await expect(card(page, '5@example.test').getByRole('button', { name: 'Reconnect in ClaudeUsage ↗' })).toBeVisible();
    expect(await cards.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(['3@example.test', '4@example.test', '1@example.test', '2@example.test', '5@example.test']);
    await expect(routing).toContainText('Routing here · weekly resets soonest of the usable accounts');

    // The hand-off: settings.claudeUsage.open answers (main does not run `open` under MAWS_E2E), then its instruction.
    await panel(page).getByRole('button', { name: 'Open ClaudeUsage ↗' }).first().click();
    await expect(page.getByText('ClaudeUsage is in the menu bar · click its icon', { exact: true })).toBeVisible();
    await expect(panel(page).getByRole('status')).toHaveText('Waiting for ClaudeUsage…');
    await card(page, '5@example.test').getByRole('button', { name: 'Reconnect in ClaudeUsage ↗' }).click();
    await expect(page.getByText('ClaudeUsage is in the menu bar · click its icon, then Reconnect… beside 5@example.test', { exact: true })).toBeVisible();
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

test('accounts: without ClaudeUsage data the tab says so', async () => {
  const maws = await launchMaws({ env: ENV(join(scratch, 'absent')) });
  try {
    await menu(maws.app, 'accounts.open');
    await expect(panel(maws.page).getByText('ClaudeUsage is not installed or has no data')).toBeVisible();
    await expect(panel(maws.page).locator('[data-account]')).toHaveCount(0);
  } finally {
    await maws.cleanup();
  }
});

// W6 (E1): the top bar's usage pill and its popover, the copy of ClaudeUsage's panel, in both themes.
const HINT = "Routing controls arrive when ClaudeUsage exposes its control route; use ClaudeUsage's own panel for now";
test('usage: the top bar pill reads the routing account and opens the copy of ClaudeUsage’s panel', async () => {
  test.setTimeout(90_000);
  freshRequests();
  const maws = await launchMaws({ env: ENV() });
  const { app, page } = maws;
  try {
    const pill = page.locator('[data-top-bar] [data-usage-pill]');
    // 3@ routes; its most binding limit is the Fable week at 82 %, a warning
    await expect(pill).toHaveText('82');
    await expect(pill).toHaveAttribute('data-severity', 'warning');
    await expect(pill.locator('[data-dot]')).toHaveCSS('background-color', await tokenColor(page, '--warning'));

    await pill.click();
    const popover = page.getByRole('dialog', { name: 'Claude Usage' });
    await expect(popover).toBeVisible();
    await expect(popover.getByRole('heading', { name: 'Claude Usage' })).toBeVisible();
    await expect(popover.getByText('Usage includes all machines. Activity below is from this Mac.')).toBeVisible();
    const accounts = popover.locator('[data-account]:not([data-codex] [data-account])');
    await expect(accounts).toHaveCount(5);
    expect(await accounts.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(ORDER);
    const routing = popover.locator('[data-account][aria-label="3@example.test"]');
    await expect(routing.locator('[data-serving="latest"]')).toHaveText(/^5 requests · 97% cached · (just now|1m ago)$/);
    await expect(meter(routing, 'Fable weekly usage').locator('span')).toHaveCSS('background-color', await tokenColor(page, '--warning'));
    await expect(meter(routing, 'Five-hour usage').locator('span')).toHaveCSS('background-color', await tokenColor(page, '--success'));
    await expect(popover.locator('[data-codex] [data-account]')).toHaveCount(2);
    await expect(popover.getByRole('checkbox', { name: 'Route Claude Code through this app' })).toBeChecked();
    await expect(popover.getByRole('checkbox', { name: 'Route Claude Code through this app' })).toBeDisabled();
    await expect(popover.locator('[data-health]')).toHaveText('Last 10 min: 8 requests · response start median 1.0s, p95 3.2s · 1 stall, 1 connection error, 1 refused, 1 held');

    // the four actions, disabled under the one hint
    await expect(popover.getByText(HINT, { exact: true })).toBeVisible();
    for (const name of ['Route requests here', 'Remove account…', 'Add account…']) {
      const buttons = popover.getByRole('button', { name, exact: true });
      expect(await buttons.count()).toBeGreaterThan(0);
      for (const button of await buttons.all()) await expect(button).toBeDisabled();
    }
    await test.info().attach('usage-popover-light', { body: await page.screenshot(), contentType: 'image/png' });

    // the dark theme: the same reading in the dark tokens
    await menu(app, 'theme.dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(pill.locator('[data-dot]')).toHaveCSS('background-color', await tokenColor(page, '--warning'));
    await expect(popover).toBeVisible();
    await test.info().attach('usage-popover-dark', { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

test('usage: without ClaudeUsage data the pill is a muted dash', async () => {
  const maws = await launchMaws({ env: ENV(join(scratch, 'absent')) });
  try {
    const pill = maws.page.locator('[data-top-bar] [data-usage-pill]');
    await expect(pill).toHaveText('--');
    await expect(pill).toHaveAttribute('data-severity', 'none');
    await pill.click();
    await expect(maws.page.getByRole('dialog', { name: 'Claude Usage' }).getByText('ClaudeUsage is not installed or has no data')).toBeVisible();
  } finally {
    await maws.cleanup();
  }
});
