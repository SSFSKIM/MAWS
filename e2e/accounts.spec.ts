// The top bar's usage pill and its popover end to end (W6, E1), which took over C11's Accounts tab and its spec (C11
// execution document, Acceptance item 2, `accounts.spec.ts`; the same assertions, now against the popover): the built
// app on C5's stub scenario (`nine-sessions.json`, manual clock, `Settings idle probe` re-pinned to engine id 73171552…)
// with MAWS_CLAUDE_USAGE_DIR on this spec's own temporary copy of the committed ClaudeUsage fixture, every `recordedAt`
// and `resetsAt` moved by one offset so its newest reading is two minutes old (C7's recipe, e2e/statusline.spec.ts). The
// fixture: five accounts `1@` to `5@example.test`, drain target `2aca3c4b…` = 3@ (not manual), no account needing
// reauthentication, the one window at 100 % 4@'s five-hour one; two Codex accounts; the relay's synthetic requests of
// the last ten minutes. The owner's ClaudeUsage directory is never read, and under MAWS_E2E main answers `/usr/bin/open`
// without running it, so nothing activates the owner's ClaudeUsage. W6 route executor: the fixture has no control token,
// so the first two tests run without ClaudeUsage's control route, as before it existed; the third adds a token and a
// stub of the route on a loopback port of this process (MAWS_CLAUDE_USAGE_CONTROL_URL). Under MAWS_E2E main reaches no
// other port, so the owner's relay is never called.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { launchMaws, REPO_ROOT } from './support/launch';
import { sidebarRow } from './support/sidebar';

const QUOTA = 'Quota reset recovery'; // routed, its engine id unpinned: the drain target's windows
const PROBE = 'Settings idle probe'; // routed, re-pinned below to account 477e393c… (1@example.test)
const PINNED_ENGINE_ID = '73171552-c2ff-47db-b361-ca541bdf560e';
const ORDER = ['3@example.test', '4@example.test', '1@example.test', '5@example.test', '2@example.test'];
const HINT = "Routing controls arrive when ClaudeUsage exposes its control route; use ClaudeUsage's own panel for now";

let scratch: string;
let usageDir: string;
let scenario: string;

test.beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maws-w6-usage-'));
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

// The relay's requests (synthetic, `gateway-requests.jsonl`) moved so the newest ended 30 s ago, at the start of the test
// that reads them: the popover counts the last ten minutes from the wall clock.
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
const pillOf = (page: Page) => page.locator('[data-top-bar] [data-usage-pill]');
const popoverOf = (page: Page) => page.getByRole('dialog', { name: 'Claude Usage' });
const card = (page: Page, email: string) => popoverOf(page).locator(`[data-account][aria-label="${email}"]`);
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

test('usage: the pill, and ClaudeUsage’s accounts in its geometry, the routing one and why, a reauth account, the disabled actions and the hand-off', async () => {
  test.setTimeout(120_000);
  freshRequests();
  const maws = await launchMaws({ env: ENV() });
  const { app, page } = maws;
  try {
    // The windows Session info reads for the unpinned routed session (the drain target's) and the re-pinned one (1@'s).
    const [quota5h, quota7d] = await sessionWindows(page, QUOTA);
    const [probe5h, probe7d] = await sessionWindows(page, PROBE);
    expect([quota5h, quota7d, probe5h, probe7d]).toEqual(['53', '63', '77', '44']);

    // The pill: 3@ routes, and its most binding limit is the Fable week at 82 %, a warning.
    const pill = pillOf(page);
    await expect(pill).toHaveText('82');
    await expect(pill).toHaveAttribute('data-severity', 'warning');
    await expect(pill.locator('[data-dot]')).toHaveCSS('background-color', await tokenColor(page, '--warning'));

    // View › Usage (the retired Accounts tab's menu id) opens the popover; no Accounts tab exists any more.
    await menu(app, 'accounts.open');
    const popover = popoverOf(page);
    await expect(popover).toBeVisible();
    await expect(page.locator('[data-region="main"]').getByRole('tab', { name: /Accounts/ })).toHaveCount(0);
    await expect(popover.getByRole('heading', { name: 'Claude Usage' })).toBeVisible();
    await expect(popover.getByText(/^updated \dm ago$/)).toBeVisible();
    await expect(popover.getByText('Usage includes all machines. Activity below is from this Mac.')).toBeVisible();
    const cards = popover.locator('[data-account]:not([data-codex] [data-account])');
    await expect(cards).toHaveCount(5);
    expect(await cards.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(ORDER);

    // ClaudeUsage's grid: two columns at three or more accounts, 680 px wide.
    const [a, b, c] = await Promise.all([0, 1, 2].map((i) => cards.nth(i).boundingBox()));
    expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1);
    expect(Math.abs(b!.y - a!.y)).toBeLessThan(2);
    expect(c!.y).toBeGreaterThan(a!.y + 10);
    expect(Math.round((await popover.locator('[data-usage-panel]').boundingBox())!.width)).toBe(680);

    const routing = card(page, '3@example.test');
    await expect(routing).toContainText('Routing here · weekly resets soonest of the usable accounts');
    await expect(routing).toContainText('8 saved sessions');
    await expect(routing.locator('[data-serving="latest"]')).toHaveText(/^5 requests · 97% cached · (just now|1m ago)$/);
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
    // Bars in their severity's colour: 3@'s Fable week a warning, its five hours normal; 4@'s five hours at 100 % in
    // --danger; 2@'s five-hour reset has passed: 0 % and no reading since.
    await expect(meter(routing, 'Fable weekly usage').locator('span')).toHaveCSS('background-color', await tokenColor(page, '--warning'));
    await expect(meter(routing, 'Five-hour usage').locator('span')).toHaveCSS('background-color', await tokenColor(page, '--success'));
    await expect(meter(card(page, '4@example.test'), 'Five-hour usage')).toHaveAttribute('aria-valuenow', '100');
    await expect(meter(card(page, '4@example.test'), 'Five-hour usage').locator('[data-full]')).toHaveCSS('background-color', await tokenColor(page, '--danger'));
    await expect(meter(card(page, '2@example.test'), 'Five-hour usage')).toHaveAttribute('aria-valuenow', '0');
    await expect(card(page, '2@example.test')).toContainText('5h · no reading since the window reset');

    // The Codex accounts, the routing toggle's state, and the relay's last ten minutes.
    await expect(popover.locator('[data-codex] [data-account]')).toHaveCount(2);
    await expect(popover.locator('[data-codex] [data-account][aria-label="6@example.test"]')).toContainText('Routing here · chosen by the relay');
    const toggle = popover.getByRole('checkbox', { name: 'Route Claude Code through this app' });
    await expect(toggle).toBeChecked();
    await expect(toggle).toBeDisabled();
    await expect(popover.locator('[data-health]')).toHaveText('Last 10 min: 8 requests · response start median 1.0s, p95 3.2s · 1 stall, 1 connection error, 1 refused, 1 held');

    // The four actions render disabled under the one hint.
    await expect(popover.getByText(HINT, { exact: true })).toBeVisible();
    for (const [name, count] of [['Route requests here', 4], ['Remove account…', 5], ['Add account…', 1]] as const) {
      const buttons = popover.getByRole('button', { name, exact: true });
      await expect(buttons).toHaveCount(count);
      for (const button of await buttons.all()) await expect(button).toBeDisabled();
    }
    await test.info().attach('usage-popover-light', { body: await page.screenshot(), contentType: 'image/png' });

    // ClaudeUsage marks 5@ as needing reauthentication: the popover follows C7's watcher by itself.
    const accountsFile = join(usageDir, 'accounts.json');
    const accounts = JSON.parse(readFileSync(accountsFile, 'utf8')) as { email: string; needsReauthentication: boolean }[];
    writeFileSync(accountsFile, JSON.stringify(accounts.map((x) => (x.email === '5@example.test' ? { ...x, needsReauthentication: true } : x)), null, 2));
    await expect(card(page, '5@example.test')).toHaveAttribute('data-state', 'needs_reauth', { timeout: 10_000 });
    await expect(card(page, '5@example.test')).toContainText('Needs reauthentication · the relay skips it until it is reconnected; readings are last known');
    await expect(card(page, '5@example.test').getByRole('button', { name: 'Reconnect…' })).toBeDisabled();
    await expect(card(page, '5@example.test').getByRole('button', { name: 'Route requests here' })).toHaveCount(0);
    expect(await cards.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(['3@example.test', '4@example.test', '1@example.test', '2@example.test', '5@example.test']);
    await expect(routing).toContainText('Routing here · weekly resets soonest of the usable accounts');

    // The dark theme: the same reading in the dark tokens.
    await menu(app, 'theme.dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(pill.locator('[data-dot]')).toHaveCSS('background-color', await tokenColor(page, '--warning'));
    await expect(meter(routing, 'Fable weekly usage').locator('span')).toHaveCSS('background-color', await tokenColor(page, '--warning'));
    await test.info().attach('usage-popover-dark', { body: await page.screenshot(), contentType: 'image/png' });

    // Esc closes it; the pill opens it again.
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await pill.click();
    await expect(popover).toBeVisible();

    // The hand-off to ClaudeUsage's own panel: settings.claudeUsage.open answers (main does not run `open` under
    // MAWS_E2E), then its instruction.
    await popover.getByRole('button', { name: 'Open ClaudeUsage ↗' }).click();
    await expect(page.getByText('ClaudeUsage is in the menu bar · click its icon', { exact: true })).toBeVisible();
    await expect(popover.getByRole('status')).toHaveText('Waiting for ClaudeUsage…');
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

test('usage: without ClaudeUsage data the pill is a muted dash and the popover says so', async () => {
  const maws = await launchMaws({ env: ENV(join(scratch, 'absent')) });
  try {
    const pill = pillOf(maws.page);
    await expect(pill).toHaveText('--');
    await expect(pill).toHaveAttribute('data-severity', 'none');
    await expect(pill.locator('[data-dot]')).toHaveCSS('background-color', await tokenColor(maws.page, '--fg-muted'));
    await pill.click();
    await expect(popoverOf(maws.page).getByText('ClaudeUsage is not installed or has no data')).toBeVisible();
    await expect(popoverOf(maws.page).locator('[data-account]')).toHaveCount(0);
    await maws.page.keyboard.press('Escape');
    await expect(popoverOf(maws.page)).toBeHidden();

    // The palette's Usage (the retired Accounts entry's id) opens it too, and it stays open past the palette's close.
    const palette = maws.page.getByRole('dialog', { name: 'Command palette' });
    await menu(maws.app, 'palette.open');
    await expect(palette.getByPlaceholder('Search sessions, projects and actions')).toBeFocused();
    await maws.page.keyboard.type('Usage');
    const actions = palette.getByRole('group', { name: 'Actions' });
    await expect(actions.getByRole('option', { name: /^Usage/ })).toBeVisible();
    await expect(palette.getByRole('option', { name: /Accounts/ })).toHaveCount(0);
    await actions.getByRole('option', { name: /^Usage/ }).click();
    await expect(palette).toHaveCount(0);
    await expect(popoverOf(maws.page)).toBeVisible();
    await maws.page.waitForTimeout(300); // past the palette's focus restore
    await expect(popoverOf(maws.page)).toBeVisible();
  } finally {
    await maws.cleanup();
  }
});

// W6 route executor: ClaudeUsage's control route, as a stub of its contract on a loopback port of this process, with a
// token in this test's own copy of the fixture. It answers the state with routing ready, accepts a route and answers its
// drain target (writing nothing, so what the popover shows at once comes from that answer), refuses a route to 4@ as at
// its limit, and toggles the panel; it records every request.
test('usage: with ClaudeUsage’s control route (a stub), the actions enable, Route asks and posts, and a refusal shows its message', async () => {
  test.setTimeout(120_000);
  freshRequests();
  const dir = join(scratch, 'claude-usage-route');
  cpSync(usageDir, dir, { recursive: true });
  cpSync(join(REPO_ROOT, 'test/fixtures/claude-usage/accounts.json'), join(dir, 'accounts.json')); // the first test marks 5@ for reauthentication
  writeFileSync(join(dir, 'control-token'), 'e2e-control-token\n');
  const accounts = JSON.parse(readFileSync(join(dir, 'accounts.json'), 'utf8')) as { uuid: string; email: string }[];
  const uuidOf = (email: string) => accounts.find((a) => a.email === email)!.uuid;
  const seen: { method: string; path: string; authorization: string | undefined; body: unknown }[] = [];
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (text += chunk));
    req.on('end', () => {
      const body = (text ? JSON.parse(text) : null) as { uuid?: string } | null;
      seen.push({ method: req.method ?? '', path: req.url ?? '', authorization: req.headers.authorization, body });
      if (req.headers.authorization !== 'Bearer e2e-control-token') return send(res, 401, { ok: false, reason: 'unauthorized', message: 'wrong token' });
      const key = `${req.method} ${req.url}`;
      if (key === 'GET /claudeusage/state') {
        return send(res, 200, {
          version: 1,
          updatedAt: new Date().toISOString(),
          routing: { enabled: true, ready: true, port: 8641, drainTarget: uuidOf('3@example.test'), drainTargetIsManual: false },
          accounts: accounts.map((a) => ({ uuid: a.uuid, email: a.email, status: 'ok', isRoutingHere: a.email === '3@example.test' })),
          codex: [],
        });
      }
      if (key === 'POST /claudeusage/route') {
        if (body?.uuid === uuidOf('4@example.test')) return send(res, 409, { ok: false, reason: 'unusable', message: '4@example.test is at its limit until its five-hour window resets' });
        return send(res, 200, { ok: true, drainTarget: body?.uuid });
      }
      if (key === 'POST /claudeusage/panel') return send(res, 200, { ok: true });
      send(res, 404, { type: 'error' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const maws = await launchMaws({ env: { ...ENV(dir), MAWS_CLAUDE_USAGE_CONTROL_URL: url } });
  const { page } = maws;
  try {
    await pillOf(page).click();
    const popover = popoverOf(page);
    await expect(popover).toBeVisible();

    // The actions enable once main has the state, under no hint.
    for (const [name, count] of [['Route requests here', 4], ['Remove account…', 5], ['Add account…', 1]] as const) {
      const buttons = popover.getByRole('button', { name, exact: true });
      await expect(buttons).toHaveCount(count);
      for (const button of await buttons.all()) await expect(button).toBeEnabled();
    }
    await expect(popover.locator('[data-controls-hint]')).toHaveCount(0);
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) expect([s.method, s.path, s.authorization]).toEqual(['GET', '/claudeusage/state', 'Bearer e2e-control-token']);

    // Route asks first, with the panel's warning; confirmed, it posts, and the popover is back with 1@ routing.
    await card(page, '1@example.test').getByRole('button', { name: 'Route requests here' }).click();
    const sheet = page.getByRole('dialog', { name: 'Route requests to 1@example.test?' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Existing sessions move at their next request, which rebuilds their prompt cache.');
    expect(seen.some((s) => s.method === 'POST')).toBe(false);
    await test.info().attach('usage-route-confirm', { body: await page.screenshot(), contentType: 'image/png' });
    await sheet.getByRole('button', { name: 'Route requests here' }).click();
    await expect(sheet).toBeHidden();
    await expect(popover).toBeVisible();
    await expect(card(page, '1@example.test')).toContainText('Routing here · chosen in ClaudeUsage');
    await expect(card(page, '3@example.test')).not.toContainText('Routing here');
    expect(seen.filter((s) => s.method === 'POST')).toEqual([{ method: 'POST', path: '/claudeusage/route', authorization: 'Bearer e2e-control-token', body: { uuid: uuidOf('1@example.test') } }]);
    await test.info().attach('usage-routed', { body: await page.screenshot(), contentType: 'image/png' });

    // ClaudeUsage writes its pins: C7's reader catches up with the same routing account.
    const pinsFile = join(dir, 'pins.json');
    const pins = JSON.parse(readFileSync(pinsFile, 'utf8')) as Record<string, unknown>;
    writeFileSync(pinsFile, JSON.stringify({ ...pins, drainTarget: uuidOf('1@example.test'), drainTargetIsManual: true }, null, 2));
    await page.waitForTimeout(1_500); // past the reader's debounce
    await expect(card(page, '1@example.test')).toContainText('Routing here · chosen in ClaudeUsage');

    // A refusal: the popover's notice is ClaudeUsage's message, and 1@ still routes.
    await card(page, '4@example.test').getByRole('button', { name: 'Route requests here' }).click();
    await page.getByRole('dialog', { name: 'Route requests to 4@example.test?' }).getByRole('button', { name: 'Route requests here' }).click();
    await expect(popover).toBeVisible();
    await expect(popover.locator('[data-controls-hint]')).toHaveText('4@example.test is at its limit until its five-hour window resets');
    await expect(card(page, '1@example.test')).toContainText('Routing here');
    await test.info().attach('usage-refused', { body: await page.screenshot(), contentType: 'image/png' });

    // Open ClaudeUsage opens ClaudeUsage's own panel through the route: no activation and no instruction.
    await popover.getByRole('button', { name: 'Open ClaudeUsage ↗' }).click();
    await expect.poll(() => seen.filter((s) => s.path === '/claudeusage/panel').length).toBe(1);
    await expect(popover.getByRole('status')).toHaveText('Waiting for ClaudeUsage…');
    await expect(page.getByText('ClaudeUsage is in the menu bar · click its icon', { exact: true })).toHaveCount(0);
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
