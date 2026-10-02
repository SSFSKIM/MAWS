// C12's memory budget end to end over a replayed scenario (C12 execution document, M2 and Acceptance item 2): the
// built app on C5's stub source with `test/fixtures/shell/c12-budget.json` and a manual clock, which scripts the engine
// host's side exactly as it would reach main: the `engine.budget` states and the released session's exited status
// (reason `budget`). Main's read model folds the release onto the digest, so what the test observes is the product's
// own path from there: the released mark on the row and the card with no Needs-you item, Send offering to resume (the
// resume itself is C10's and needs launch mode index, so M3's live spec proves it),
// Session info's two lines, the banner once the host's flag is up, the blocked sessions sheet and the stop sheet with
// C10's disclosure; and the banner going when the flag clears. Each state is photographed in both themes, into the
// evidence pack under MAWS_C12_SHOTS=1 and into the test's output otherwise. Run by `pnpm e2e:c12`
// (MAWS_C12_E2E=1), part of `pnpm verify`.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page, type TestInfo } from '@playwright/test';
import { invoke, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT } from './support/launch';
import { projectRow, sidebarRow } from './support/sidebar';

test.skip(process.env.MAWS_C12_E2E !== '1', 'the budget replay runs under pnpm e2e:c12 (MAWS_C12_E2E=1)');

const EVIDENCE = join(REPO_ROOT, 'docs/doperpowers/evidence/c12');
const THEMES = ['light', 'dark'] as const;
const RELEASED = 'app-c12a0001';
const RELEASED_TITLE = 'Release candidate';
const SLEEPER_TITLE = 'Background sleeper';

// Plays the scenario's timeline up to `ms` (the manual clock).
async function advanceTo(app: ElectronApplication, ms: number): Promise<void> {
  await app.evaluate((_electron, ms) => {
    const scenario = (globalThis as { __maws_scenario?: { advanceTo(ms: number): void } }).__maws_scenario;
    if (!scenario) throw new Error('no scenario clock: the app is not in launch mode scenario with MAWS_SCENARIO_CLOCK=manual');
    scenario.advanceTo(ms);
  }, ms);
}

async function setTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  value(await invoke(page, 'settings.set', { theme }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

// The window in both themes, back in light after.
async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const dir = process.env.MAWS_C12_SHOTS === '1' ? EVIDENCE : testInfo.outputPath('shots');
  mkdirSync(dir, { recursive: true });
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await page.screenshot({ path: join(dir, `c12-${name}-${theme}.png`) });
  }
  await setTheme(page, 'light');
}

const dd = (scope: Locator, term: string) => scope.getByRole('term').filter({ hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]');

// eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
test('a release reads idle and marked, offers resume on Send; over budget with no candidate raises one banner, the sheets and the disclosure', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const maws = await launchMaws({ env: { MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/c12-budget.json', MAWS_SCENARIO_CLOCK: 'manual' } });
  try {
    const { app, page } = maws;
    const main = page.locator('[data-region="main"]');
    const banner = page.locator('[data-banner-host]').getByRole('status').filter({ hasText: 'Memory budget exceeded' });
    value(await invoke(page, 'settings.set', { engine: { statefulMcpServers: ['c12-kernel'] } }));
    await expect(projectRow(page, 'MAWS')).toBeVisible(); // the stub's records are in
    const row = await sidebarRow(page, RELEASED_TITLE); // W5: on its project's page, opened here
    await expect(row).toBeVisible();

    // The release: at 1000 the host releases the least recently used idle session, at 2000 its process has exited.
    await advanceTo(app, 2000);
    const mark = row.getByText('released', { exact: true });
    await expect(mark).toBeVisible();
    await expect(mark).toHaveAttribute('title', /^Released at \d\d:\d\d to stay under the 2 GB memory budget · Send resumes it$/);
    await expect(row.getByRole('img', { name: 'Idle' })).toBeVisible(); // the idle glyph: no failed or exited glyph
    await expect(row.getByLabel('Unread')).toHaveCount(0);
    // W5: the Overview floats over the main area from the toolbar's button rather than showing as the first tab.
    const overview = main.getByRole('dialog', { name: 'Overview' });
    const overviewButton = page.getByRole('banner').getByRole('button', { name: /^Overview/ });
    await overviewButton.click();
    const card = overview.getByRole('article', { name: RELEASED_TITLE });
    await expect(card.getByText('released', { exact: true })).toBeVisible(); // still on the Overview, idle
    await expect(card.getByTestId('card-activity')).toHaveText('Idle');
    // No Needs-you item. W5 has no Needs-you list: what waits is counted on the project's row (◐N) and the Overview
    // button, and both count nothing.
    await expect(projectRow(page, 'MAWS').locator('[aria-label$=" waiting"]')).toHaveCount(0);
    await expect(overviewButton).toHaveAccessibleName('Overview');
    expect(value(await invoke(page, 'attention.list', undefined))).toEqual([]);
    await shoot(page, testInfo, 'released');

    // Its tab, the Overview closed first (it floats over the composer): Send is enabled and says it resumes the session;
    // Session info reads the budget and the release.
    await overview.getByRole('button', { name: 'Close Overview' }).click();
    await expect(overview).toHaveCount(0);
    await row.click();
    const message = main.getByRole('textbox', { name: 'Message' });
    await message.click();
    await page.keyboard.type('Carry on');
    const send = main.locator('[data-submit-state]');
    await expect(send).toBeEnabled();
    await expect(send).toHaveAttribute('aria-description', 'Resumes this session');
    const panel = page.locator('[data-region="panel"]');
    await panel.getByRole('button', { name: 'Add a tool' }).click();
    await page.getByRole('menuitem', { name: 'Session info' }).click();
    const info = page.locator(`[data-session-info="${RELEASED}"]`);
    await expect(dd(info, 'Memory budget')).toHaveText('2.6 GB of 2 GB · 3 sessions');
    await expect(dd(info, 'Process')).toHaveText(/^Released at \d\d:\d\d to stay under 2 GB$/);
    await shoot(page, testInfo, 'session-info');

    // The host's second sample over budget with no candidate: one banner.
    await expect(banner).toHaveCount(0);
    await advanceTo(app, 3000);
    await expect(banner).toHaveCount(1);
    await expect(banner.locator('span').first()).toHaveText('Memory budget exceeded · 3 sessions hold work MAWS will not stop');
    await shoot(page, testInfo, 'banner');

    // Review… lists each session holding work, with why.
    await banner.getByRole('button', { name: 'Review…' }).click();
    const blocked = page.getByRole('dialog', { name: 'Sessions holding work' });
    await expect(blocked.getByRole('listitem')).toHaveText([/^Refactor mid-turnmid-turn/, /^Background sleeper1 background task/, /^Kernel notebook1 queued message · stateful server c12-kernel/]);
    await shoot(page, testInfo, 'blocked-sheet');

    // Stop… shows C10's disclosure first; Cancel goes back to the list with nothing stopped.
    await blocked.getByRole('listitem', { name: SLEEPER_TITLE }).getByRole('button', { name: 'Stop…' }).click();
    const stop = page.getByRole('dialog', { name: `Stop “${SLEEPER_TITLE}”?` });
    await expect(stop.getByRole('note')).toHaveText('1 background task is still running and will be stopped:sleep 900');
    await expect(stop.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await shoot(page, testInfo, 'stop-sheet');
    await stop.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'Sessions holding work' }).getByRole('listitem')).toHaveCount(3);
    await page.getByRole('dialog', { name: 'Sessions holding work' }).getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The flag clears (the budget back at its default): the banner goes; the mark stays until a launch.
    await advanceTo(app, 4000);
    await expect(banner).toHaveCount(0);
    await expect(mark).toBeVisible();
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
  }
});
