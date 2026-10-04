// C5's end-to-end smoke (C5 execution document, M6 and Acceptance items 1 to 9): the built app on the stub scenario
// `nine-sessions.json` with a manual clock, so every timed transition happens when the test says (`advanceTo`), never in
// a race with the wall clock. Menu-sink actions are clicked by menu item id in main (Playwright's keyboard never reaches
// a macOS menu accelerator); renderer-sink chords go through `page.keyboard`; events are captured through
// `window.maws.on`; themes are checked by computed token colours; persistence by relaunching over the same profile; the
// quit guard by its stderr line, whose count is the one the driven engine state implies. Never `setViewportSize`: the
// window's own bounds are what the test drives (it shifted hover coordinates in M3's live check). This spec is the
// template for C7's and C8's end-to-end tests.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page, type TestInfo } from '@playwright/test';
import { ACTIONS, type ActionId } from '../src/shared/keymap/actions';
import { formatChord } from '../src/shared/keymap/chord';
import { launchMaws, type MawsLaunch } from './support/launch';
import { closeProject, openProject, projectLine, projectRow, showProjectList, sidebarRow } from './support/sidebar';

const SHELL_ENV = {
  MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/nine-sessions.json',
  MAWS_SCENARIO_CLOCK: 'manual',
  MAWS_E2E_QUIT_ANSWER: 'quit',
};

// The scenario's sessions (test/fixtures/shell/nine-sessions.json).
const CHARTER = 'app-9a1d4262';
const FIX = 'Fix sidebar drag';
const SIP = 'Sidebar interaction pass';
const QUOTA = 'Quota reset recovery';
const NORTH = 'Workstation north star';
const USAGE_PROJECT = 'claude-usage-menubar';

interface Captured {
  notified: { appSessionId: string; attentionId: string; delivery: 'os' | 'fallback'; at: string; receivedAt: number }[];
  navigate: unknown[];
}
declare global {
  interface Window {
    __maws_e2e?: Captured;
  }
}

test('shell: sidebar, overview, hover approve, tabs and split, persistence, themes, notification, quit guard', async () => {
  test.setTimeout(180_000);
  const first = await launchMaws({ env: SHELL_ENV });
  try {
    const firstStderr = collectStderr(first.app);
    const saved = await firstInstance(first, test.info());
    await first.app.close();
    expect(quitLines(firstStderr()), 'the quit guard counts four mid-turn after the 8 s entry').toEqual(['quit-guard: 4 mid-turn, auto-answered quit']);

    const second = await launchMaws({ env: SHELL_ENV, userData: first.userData });
    try {
      const secondStderr = collectStderr(second.app);
      await relaunchedInstance(second, saved);
      await second.app.close();
      expect(quitLines(secondStderr()), 'the relaunched clock is back at 0: five mid-turn').toEqual(['quit-guard: 5 mid-turn, auto-answered quit']);
    } finally {
      await second.cleanup();
    }
  } finally {
    await first.cleanup(); // removes the profile both launches used
  }
});

// W12 (I2, I3; §5.2 as amended 2026-10-01): each project has its own tab set, which the strip shows under the project's
// name; a project click and an open of another project's session switch it; a click replaces the shown session and
// ⌘-click keeps a tab of its own; ⌘1–9 count in the set; the label reveals the project in the sidebar. W11's tree: a
// click on a project's row toggles it in place and shows its set, whether it was expanded or not.
test('tab sets per project: the strip switches with the project, ⌘1 counts in the set, the label names it', async () => {
  const maws = await launchMaws({ env: SHELL_ENV });
  try {
    const { app, page } = maws;
    const main = page.locator('[data-region="main"]');
    const label = main.locator('[data-strip-project]');
    const clickProject = async (name: string) => {
      await showProjectList(page);
      await projectLine(projectRow(page, name)).click();
    };
    await expect(page.locator('[data-region="sidebar"] [data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });

    await clickProject('MAWS');
    await expect(label).toHaveText('MAWS');
    await expect(main.getByRole('button', { name: 'Tabs of MAWS' })).toBeVisible();
    await (await sidebarRow(page, FIX)).click();
    await (await sidebarRow(page, SIP)).click({ modifiers: ['Meta'] });
    await expect.poll(() => tabLabels(page, 'Open tabs')).toEqual([`${FIX} · MAWS`, `${SIP} · MAWS`]);

    await clickProject('codex_somersault');
    await expect(label).toHaveText('codex_somersault');
    await expect(main.getByRole('button', { name: 'Tabs of codex_somersault' })).toBeVisible();
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: 'another project, another (empty) set' }).toEqual([]);
    await (await sidebarRow(page, QUOTA)).click();
    await (await sidebarRow(page, 'Trace stream reconnects')).click(); // a click replaces the shown session
    await expect.poll(() => tabLabels(page, 'Open tabs')).toEqual(['Trace stream reconnects · codex_somersault']);
    await menu(app, 'tab.reopen'); // the replaced one comes back
    await expect.poll(() => tabLabels(page, 'Open tabs')).toEqual(['Trace stream reconnects · codex_somersault', `${QUOTA} · codex_somersault`]);
    await menu(app, 'tab.select:1');
    await expect.poll(() => selectedTab(page, 'Open tabs')).toBe('Trace stream reconnects · codex_somersault');
    await menu(app, 'tab.select:3'); // no third tab in this set
    await expect.poll(() => selectedTab(page, 'Open tabs')).toBe('Trace stream reconnects · codex_somersault');

    await clickProject('MAWS'); // expanded already: the click folds it and still shows its set
    await expect(projectRow(page, 'MAWS')).toHaveAttribute('aria-expanded', 'false');
    await expect(label).toHaveText('MAWS');
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: 'MAWS’s set as it was left' }).toEqual([`${FIX} · MAWS`, `${SIP} · MAWS`]);
    await menu(app, 'tab.select:1');
    await expect.poll(() => selectedTab(page, 'Open tabs')).toBe(`${FIX} · MAWS`);

    // an open from elsewhere (the palette) of another project's session switches the strip to its set
    await menu(app, 'palette.open');
    await page.keyboard.type('quota');
    await page.keyboard.press('Enter');
    await expect(label).toHaveText('codex_somersault');
    await expect.poll(() => selectedTab(page, 'Open tabs')).toBe(`${QUOTA} · codex_somersault`);

    // the label reveals its project in the sidebar: its row expanded in place, and focused
    await closeProject(page, 'codex_somersault');
    await label.click();
    await expect(projectRow(page, 'codex_somersault')).toHaveAttribute('aria-expanded', 'true');
    await expect(projectRow(page, 'codex_somersault')).toBeFocused();

    // Other sessions is the no-project set: no label
    await clickProject('Other sessions');
    await expect(label).toHaveCount(0);
    await expect.poll(async () => {
      const value = (await layoutGet(page, 'main.tabs')) as { version: number; current: string; sets: Record<string, unknown> };
      return [value.version, value.current, Object.keys(value.sets).sort()];
    }, { message: 'version 2, one set per project with tabs' }).toEqual([2, 'none', ['none', 'proj-codex-somersault', 'proj-maws']]);
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// W11 at scale (many-sessions.json: three projects of 120 sessions, a third of MAWS's in a managed and a sibling
// worktree): Codex's flat tree, 36px project rows expanding in place to 30px session rows, five and then eight at most,
// one flat list with a worktree session marked by its branch; the hover card names the branch and folder; ArrowLeft
// steps out to the project.
test('sidebar at scale: the flat tree, 36px project rows, 30px session rows, five then eight', async () => {
  const maws = await launchMaws({ env: { MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/many-sessions.json', MAWS_SCENARIO_CLOCK: 'manual' } });
  try {
    const { app, page } = maws;
    const sidebar = page.locator('[data-region="sidebar"]');
    await expect(sidebar.locator('[data-kind="project"]')).toHaveCount(3, { timeout: 15_000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 72, y: 48, width: 1360, height: 860 }));
    const heights = (scope: Locator) => scope.evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().height)))]);
    expect(await heights(sidebar.locator('[data-project-line]')), 'project rows are 36px').toEqual([36]);

    await openProject(page, 'MAWS');
    const maWS = projectRow(page, 'MAWS');
    const rows = maWS.locator('[data-kind="session"]');
    await expect(rows, 'five sessions first').toHaveCount(5);
    expect(await heights(rows), 'session rows are 30px').toEqual([30]);
    await expect(maWS.getByRole('group'), 'one flat list: no Main or worktree groups').toHaveCount(1);
    await maWS.getByRole('treeitem', { name: 'Show more' }).click();
    await expect(rows, 'eight at most').toHaveCount(8);
    await expect(maWS.getByRole('treeitem', { name: 'Show more' })).toHaveCount(0);

    // A worktree session, found through the search (which lists the project open on its matches).
    await sidebar.getByRole('searchbox', { name: 'Search projects and sessions' }).fill('scale-alpha');
    const alpha = maWS.locator('[data-kind="session"]').first();
    await expect(alpha.getByTestId('row-branch')).toHaveText('⎇ worktree-scale-alpha');
    const title = (await alpha.getAttribute('aria-label'))!;
    const card = page.getByRole('dialog', { name: title });
    await expect(async () => {
      await page.mouse.move(700, 400);
      await alpha.hover();
      await expect(card).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 10_000 });
    await expect(card.getByTestId('hover-place')).toHaveText('⎇ worktree-scale-alpha · worktree scale-alpha');

    await alpha.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(maWS).toBeFocused();
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// The owner's title-bar correction: both controls fit the existing 44px chrome; the tab strip has no extra row above it.
async function assertToolbarPlacement(page: Page): Promise<void> {
  const toolbar = page.getByRole('banner');
  const overview = toolbar.getByRole('button', { name: /^Overview/ });
  const sidebar = toolbar.getByRole('button', { name: 'Toggle sidebar' });
  const usage = toolbar.locator('[data-usage-pill]');
  const actions = toolbar.getByRole('button', { name: 'Session actions' });
  const wordmark = page.locator('[data-sidebar-wordmark]');
  const newChat = page.locator('[data-region="sidebar"]').getByRole('button', { name: 'New chat', exact: true });
  const search = page.locator('[data-region="sidebar"]').getByRole('searchbox');
  await expect(toolbar.getByText('MAWS', { exact: true })).toHaveCount(0);
  await expect(wordmark).toBeVisible();
  const [markBox, newBox, searchBox] = await Promise.all([wordmark, newChat, search].map((el) => el.boundingBox()));
  expect(newBox!.y).toBe(markBox!.y + markBox!.height);
  expect(searchBox!.y).toBeGreaterThanOrEqual(newBox!.y + newBox!.height);
  await expect(newChat.locator('svg')).toHaveCSS('color', await newChat.evaluate((el) => getComputedStyle(el).color));
  await sidebar.click();
  await expect(page.locator('[data-region="sidebar"]')).toHaveAttribute('inert', '');
  await expect(overview).toBeVisible();
  await expect(sidebar).toBeVisible();
  const collapsedToggle = (await sidebar.boundingBox())!;
  expect(collapsedToggle.x).toBeGreaterThanOrEqual(78);
  await sidebar.click();
  await expect(toolbar).toHaveCSS('height', '44px');
  await expect(overview).toHaveCSS('width', '28px');
  await expect(overview).toHaveCSS('height', '28px');
  await expect(overview).toHaveCSS('-webkit-app-region', 'no-drag');
  await expect(usage).toHaveCSS('-webkit-app-region', 'no-drag');
  const [bar, toggle, board, pill, menu, strip] = await Promise.all([
    toolbar, sidebar, overview, usage, actions, page.locator('[data-pane-strip]').first(),
  ].map((el) => el.boundingBox()));
  expect(board!.x).toBe(toggle!.x + toggle!.width + 4);
  expect(pill!.x + pill!.width).toBeLessThanOrEqual(menu!.x);
  expect(strip!.y).toBe(bar!.y + bar!.height);
}

interface Saved {
  regions: unknown;
  main: unknown;
  panelPinned: unknown;
  bounds: { x: number; y: number; width: number; height: number };
  left: string[];
  right: string[];
}

async function firstInstance(maws: MawsLaunch, testInfo: TestInfo): Promise<Saved> {
  const { app, page } = maws;
  const sidebar = page.locator('[data-region="sidebar"]');
  const main = page.locator('[data-region="main"]');
  // W5: the Overview floats over the main area, opened from the toolbar's button (or ⌘0); it is no tab.
  const overview = main.getByRole('dialog', { name: 'Overview' });
  const overviewButton = page.getByRole('banner').getByRole('button', { name: /^Overview/ });
  const board = overview.getByRole('list', { name: 'Overview' });
  const usageCard = board.getByRole('article', { name: 'Usage reset countdown' });
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const badge = () => app.evaluate(({ app }) => app.dock?.getBadge());
  // W12: one project's sessions, since each project has its own tab set
  const three = [`${FIX} · MAWS`, `${SIP} · MAWS`, `${NORTH} · MAWS`];

  for (const name of ['sidebar', 'main', 'panel']) await expect(page.locator(`[data-region="${name}"]`)).toBeVisible({ timeout: 10_000 });
  const tokens = await themeTokens(page); // once the stylesheet is in
  // The window's own bounds, so the relaunch has something specific to restore.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 72, y: 48, width: 1360, height: 860 }));

  await test.step('Item 1: frame, light theme, sidebar', async () => {
    for (const name of ['sidebar', 'main', 'panel']) await expect(page.locator(`[data-region="${name}"]`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('banner').getByRole('button', { name: 'Toggle sidebar' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await regionBackground(page)).toBe(tokens.light['--bg-raised']);
    const separators = page.locator('[role="separator"][aria-orientation="vertical"]');
    await expect(separators).toHaveCount(2);
    expect(await separators.evaluateAll((els) => els.map((el) => [el.getAttribute('aria-label'), el.getAttribute('aria-valuenow')]))).toEqual([
      ['Resize sidebar', '300'],
      ['Resize right panel', '380'],
    ]);

    // W11: the project list, most recently active first, with each collapsed project's waiting and working counts; no
    // Pinned section. M2 restores cross-project Needs you above it, independent of expansions.
    await expect(sidebar.getByRole('heading', { name: 'Needs you · 3' })).toBeVisible();
    expect(await sidebar.getByRole('list', { name: 'Needs you' }).getByRole('button').allTextContents()).toEqual([
      `MAWS${FIX}Approval needed`, `MAWS${SIP}Question`, `codex_somersault${QUOTA}Plan review`,
    ]);
    const needsYou = sidebar.getByRole('list', { name: 'Needs you' }).getByRole('button');
    await sidebar.getByRole('searchbox').focus();
    await page.keyboard.press('Tab');
    await expect(needsYou.nth(0)).toBeFocused();
    await page.keyboard.press('End');
    await expect(needsYou.nth(2)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(needsYou.nth(0)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(sidebar.getByRole('button', { name: 'Sort sessions' })).toBeFocused();
    await sidebar.getByRole('searchbox').focus();
    await expect(page.locator('[data-hover-card]')).toHaveCount(0);
    expect(await projectRows(sidebar)).toEqual([USAGE_PROJECT, 'codex_somersault', 'MAWS', 'Other sessions']);
    expect(await rollups(sidebar)).toEqual({ [USAGE_PROJECT]: '●1', codex_somersault: '◐1', MAWS: '◐2●1', 'Other sessions': '' });
    const pages: Record<string, string[]> = {
      MAWS: ['Workstation north star', FIX, SIP, 'Charter + research'],
      codex_somersault: [QUOTA, 'Somersault terminal run', 'Trace stream reconnects'],
      [USAGE_PROJECT]: ['Usage reset countdown', 'Settings idle probe', 'SDK wire inventory'],
      'Other sessions': ['Terminal workflow notes'],
    };
    const glyphs: Record<string, string | null | undefined> = {};
    const unread: string[] = [];
    for (const [project, rows] of Object.entries(pages)) {
      await openProject(page, project);
      expect(await treeRows(projectRow(page, project)), `${project}'s sessions`).toEqual(rows);
      Object.assign(glyphs, await rowGlyphs(projectRow(page, project)));
      unread.push(...(await unreadRows(projectRow(page, project))).filter((title): title is string => title !== null));
      await closeProject(page, project);
    }
    expect(glyphs, 'every glyph as the glyph table labels it').toEqual({
      'Workstation north star': 'Done',
      [FIX]: 'Needs approval',
      [SIP]: 'Question',
      'Charter + research': 'Working',
      [QUOTA]: 'Plan review',
      'Somersault terminal run': 'Live in terminal',
      'Trace stream reconnects': 'Done',
      'Usage reset countdown': 'Working',
      'Settings idle probe': 'Idle',
      'SDK wire inventory': 'Done',
      'Terminal workflow notes': 'Idle, unread',
    });
    expect(unread.sort(), 'unread dots on exactly the unread records').toEqual([FIX, QUOTA, 'Terminal workflow notes'].sort());

    const foreignCard = await hoverRow(page, 'Somersault terminal run'); // W5: the row is one line; its holder is in the hover card
    await expect(foreignCard.getByTestId('hover-activity')).toHaveText('Terminal · pid 7135');
    await unhover(page, foreignCard);
    const foreign = await sidebarRow(page, 'Somersault terminal run');
    expect((await foreign.boundingBox())!.height, 'a 30px row').toBe(30);
    await foreign.click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    expect(await page.getByRole('menuitem').allTextContents(), 'a foreign-live session offers only the opens (I2)').toEqual(['Open', 'Open in new tab']);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(await noLeftovers(page, tokens.dark), 'no dark colour in the light theme').toEqual([]);
  });

  await test.step('Item 2: the Overview board, floating over the main area', async () => {
    expect(await tabLabels(page, 'Open tabs'), 'no tab: the Overview is not one').toEqual([]);
    await expect(main.getByText('No open tabs')).toBeVisible();
    await assertToolbarPlacement(page);
    await page.screenshot({ path: testInfo.outputPath('toolbar-light.png') });
    await expect(overviewButton).toHaveAccessibleName('Overview, 3 waiting');
    // The global toggle must restore main, not open an invisible dialog inside its zero-width/inert column.
    const panel = page.locator('[data-region="panel"]');
    await panel.getByRole('button', { name: 'Maximize right panel' }).click();
    await expect(main).toHaveJSProperty('inert', true);
    await expect(main).toHaveCSS('width', '0px');
    await expect(overviewButton).toBeEnabled();
    await overviewButton.click();
    await expect(main).toHaveJSProperty('inert', false);
    await expect.poll(async () => (await main.boundingBox())!.width).toBeGreaterThan(0);
    await expect(panel.getByRole('button', { name: 'Maximize right panel' })).toBeVisible();
    await expect(page.getByRole('separator', { name: 'Resize right panel' })).toHaveAttribute('aria-valuenow', '380');
    await expect(overview).toBeVisible();
    await expect(overviewButton).toHaveAttribute('aria-pressed', 'true');
    await expect(overview, 'focus moves onto the panel, not a card (Esc on a card declines its request)').toBeFocused();
    await overview.getByRole('button', { name: 'Close Overview' }).click(); // usable, not merely mounted
    await expect(overview).toHaveCount(0);
    await expect(overviewButton).toHaveAttribute('aria-pressed', 'false');
    await overviewButton.click();

    // Menu/chord opening is not a toggle: an already-open Overview hidden by maximize is restored and refocused.
    await panel.getByRole('button', { name: 'Maximize right panel' }).click();
    await expect(main).toHaveJSProperty('inert', true);
    await menu(app, 'tab.overview');
    await expect(main).toHaveJSProperty('inert', false);
    await expect(overview).toBeVisible();
    await expect(overview).toBeFocused();
    await expect(overviewButton).toHaveAttribute('aria-pressed', 'true');
    // Dragged by its header (a real pointer), it moves and its rect persists in `regions`.
    const header = overview.locator('[data-overview-header]');
    const before = (await overview.boundingBox())!;
    const grip = (await header.boundingBox())!;
    await page.mouse.move(grip.x + 200, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + 200, grip.y + grip.height / 2 + 30, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await overview.boundingBox())!.y - before.y), { message: 'the header drags the panel' }).toBe(30);
    await expect.poll(async () => ((await layoutGet(page, 'regions')) as { overview: unknown }).overview, { message: 'the rect persists' }).not.toBeNull();
    expect(await overviewGroups(board)).toEqual({
      'Needs you': [FIX, SIP, QUOTA],
      MAWS: ['Charter + research'],
      codex_somersault: ['Somersault terminal run'],
      [USAGE_PROJECT]: ['Usage reset countdown', 'Settings idle probe'],
      'Other sessions': ['Terminal workflow notes'],
    });
    const fixCard = board.getByRole('article', { name: FIX });
    await expect(fixCard.getByTestId('request-input')).toHaveText('git log --oneline');
    await expect(fixCard.getByRole('heading', { name: 'Bash' })).toBeVisible();
    const charterCard = board.getByRole('article', { name: 'Charter + research' });
    await expect(charterCard.getByTestId('card-activity')).toHaveText('Running bun test');
    await expect(charterCard).toContainText('ctx 41%');
    await expect(charterCard).toContainText('$0.00 since seen');
    await expect(charterCard).toContainText('2 agents');
    await expect(usageCard.getByTestId('card-activity')).toHaveText('Running curl -sI https://example.com | head -1');
    await expect(usageCard.getByTestId('card-answer')).toHaveText(/^The request succeeded/);
    const idleCard = board.getByRole('listitem', { name: USAGE_PROJECT }).getByRole('article', { name: 'Settings idle probe' });
    await expect(idleCard.getByTestId('card-activity')).toHaveText('Idle');
    await expect(idleCard.getByTestId('card-answer')).toHaveText(/^Settings loaded from user/);
    const foreignCard = board.getByRole('article', { name: 'Somersault terminal run' });
    await expect(foreignCard.getByTestId('card-activity')).toHaveText('Terminal · pid 7135');
    await expect(foreignCard.getByRole('button'), 'a foreign-live card holds no control').toHaveCount(0);
  });

  await test.step('Item 3: the hover card on a Bash request answers nothing', async () => {
    const fixHover = await hoverRow(page, FIX);
    await expect(fixHover.getByTestId('request-input')).toHaveText('git log --oneline');
    await expect(fixHover).toContainText('/private/tmp/maws-probe-qqboLh');
    await expect(fixHover.getByRole('button', { name: 'Open session' })).toBeVisible();
    await expect(fixHover.getByRole('button', { name: 'Approve' }), 'Bash is not read-only').toHaveCount(0);
    await unhover(page, fixHover);
  });

  await test.step('Item 7: dark switches the whole shell', async () => {
    await menu(app, 'theme.dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => regionBackground(page)).toBe(tokens.dark['--bg-raised']);
    await assertToolbarPlacement(page);
    await page.screenshot({ path: testInfo.outputPath('toolbar-dark.png') });
    expect(await noLeftovers(page, tokens.light), 'no light colour in the dark theme (regions, rows, cards)').toEqual([]);
  });

  await test.step('Item 4: the read-only request arrives while the window is unfocused', async () => {
    await captureEvents(page);
    expect(await badge()).toBe('3');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur());
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((win) => win.isFocused())), 'the blur took').toBe(false);
    const blurredAt = Date.now();
    expect((await captured(page)).notified, 'nothing is announced before the blur and the 3 s entry').toEqual([]);
    await advanceTo(app, 3000);
    await expect.poll(async () => (await captured(page)).notified.length, { timeout: 5_000, message: 'attention.notified within 5 s' }).toBe(1);
    const [notified] = (await captured(page)).notified;
    expect(notified).toMatchObject({ appSessionId: CHARTER });
    expect(notified.receivedAt).toBeGreaterThanOrEqual(blurredAt);
    // The unsigned packaged app cannot post; the dev build posts only where macOS lets Electron (not on the owner's Mac yet).
    if (maws.packaged) expect(notified.delivery, 'the unsigned build falls back').toBe('fallback');
    else expect(['os', 'fallback']).toContain(notified.delivery);
    test.info().annotations.push({ type: 'notification delivery', description: `${notified.delivery} (${maws.packaged ? 'packaged' : 'dev build'})` });
    console.log(`[shell] attention.notified delivery: ${notified.delivery} (${maws.packaged ? 'packaged' : 'dev build'})`);
    if (notified.delivery === 'fallback') {
      // The toast's text, not the live region's announcement of it (F12 moved ToastHost out of the main region).
      await expect(page.getByText('Charter + research needs you · Read: docs/charter.md', { exact: true })).toBeVisible();
    }
    expect(await badge()).toBe('4');
    await closeProject(page, 'MAWS'); // W11: a project's counts show while it is collapsed
    await expect(projectRow(page, 'MAWS').getByLabel('3 waiting'), 'the new request counts on its project').toBeVisible();
    expect(await noLeftovers(page, tokens.light), 'no light colour in the dark theme (toast)').toEqual([]);
  });

  await test.step('Item 3: approve the read-only request from its hover card, by pointer only', async () => {
    // Keyboard first: arrowing onto the session's row opens its hover card (W5: every session row has one), and Enter
    // on a focused Approve answers nothing (§5.1: approval from the hover card is an explicit click).
    const charterDialog = page.getByRole('dialog', { name: 'Charter + research' });
    await (await sidebarRow(page, SIP)).focus();
    await page.keyboard.press('ArrowDown');
    await expect(await sidebarRow(page, 'Charter + research')).toBeFocused();
    await expect(charterDialog.getByRole('button', { name: 'Approve' })).toBeVisible();
    await charterDialog.getByRole('button', { name: 'Approve' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    expect(await badge(), 'Enter answered nothing').toBe('4');
    await (await sidebarRow(page, SIP)).focus();
    await page.locator('[data-region="main"]').hover({ position: { x: 400, y: 300 } });
    await expect(charterDialog).toHaveCount(0);

    const charterHover = await hoverRow(page, 'Charter + research');
    await expect(charterHover.getByTestId('request-input')).toHaveText(/\/docs\/charter\.md$/);
    await expect(charterHover.getByRole('button', { name: 'Deny' })).toBeVisible();
    expect(await noLeftovers(page, tokens.light), 'no light colour in the dark theme (hover card)').toEqual([]);
    await charterHover.getByRole('button', { name: 'Approve' }).click();
    await expect(charterHover.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await closeProject(page, 'MAWS');
    await expect(projectRow(page, 'MAWS').getByLabel('2 waiting')).toBeVisible();
    await expect(board.getByRole('article', { name: 'Charter + research' }).getByTestId('card-activity')).toHaveText('Continuing');
    await expect.poll(badge).toBe('3');
  });

  await test.step('The 8 s entry: Usage reset countdown ends its turn while nobody looks at it', async () => {
    await advanceTo(app, 8000);
    const usageRow = await sidebarRow(page, 'Usage reset countdown');
    await expect(usageRow.getByRole('img', { name: 'Idle, unread' })).toBeVisible();
    await expect(usageRow.getByRole('img', { name: 'Unread', exact: true })).toBeVisible();
    await expect(usageCard.getByTestId('card-activity')).toHaveText('Idle');
    await expect(usageCard.getByRole('img', { name: 'Unread', exact: true })).toBeVisible();
    await overviewButton.click(); // the button closes it too
    await expect(overview).toHaveCount(0);
  });

  await test.step('Item 2: ⌘⇧J lands on the oldest Needs-you session', async () => {
    await menu(app, 'attention.next');
    await expect.poll(() => tabLabels(page, 'Open tabs')).toEqual([`${FIX} · MAWS`]);
    const fixTab = page.getByRole('tab', { name: `${FIX} · MAWS` });
    await expect(fixTab).toHaveAttribute('aria-selected', 'true');
    await expect(fixTab.getByRole('img', { name: 'Needs approval' })).toHaveText('◐');
    const panel = main.getByRole('tabpanel');
    // C6 registers the transcript slot: the session's transcript is mounted in place of C5's fallback.
    await expect(panel.locator('.transcript')).toHaveCount(1);
    await expect(panel.getByText('Transcript unavailable')).toHaveCount(0);
    await expect(panel.getByText('Approval needed')).toBeVisible();
    await expect(panel.getByTestId('request-input')).toHaveText('git log --oneline');
    await expect(panel.locator('[data-composer-frame]')).toBeAttached(); // C7: the composer fills its slot; its frame waits behind the docked card
    await expect(panel.getByRole('group', { name: 'Session status' })).toHaveCount(0); // W2: nothing sits under the composer

    await menu(app, 'theme.light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => regionBackground(page)).toBe(tokens.light['--bg-raised']);
  });

  await test.step('Item 5: tabs, the split, drags', async () => {
    // I2: a plain click replaces the focused pane's session; ⌘-click opens a tab of its own
    await (await sidebarRow(page, SIP)).click({ modifiers: ['Meta'] });
    await (await sidebarRow(page, NORTH)).click({ modifiers: ['Meta'] });
    expect(await tabLabels(page, 'Open tabs')).toEqual(three);
    for (const n of [1, 2, 3]) {
      await menu(app, `tab.select:${n}`);
      await expect.poll(() => selectedTab(page, 'Open tabs'), { message: `⌘${n}` }).toBe(three[n - 1]);
    }
    await page.getByRole('tab', { name: three[2] }).focus();
    await page.keyboard.press('Control+Tab');
    await expect.poll(() => selectedTab(page, 'Open tabs'), { message: '⌃Tab wraps' }).toBe(three[0]);
    await page.keyboard.press('Control+Shift+Tab');
    await expect.poll(() => selectedTab(page, 'Open tabs'), { message: '⌃⇧Tab' }).toBe(three[2]);

    await menu(app, 'tab.close');
    await expect.poll(() => tabLabels(page, 'Open tabs')).toEqual(three.slice(0, 2));
    await menu(app, 'tab.reopen');
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: '⌘⇧T restores the tab where it was' }).toEqual(three);
    expect(await selectedTab(page, 'Open tabs')).toBe(three[2]);

    await page.getByRole('tab', { name: three[1] }).click({ button: 'middle' });
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: 'middle-click closes' }).toEqual([three[0], three[2]]);

    // ⌘0 floats the Overview over the session, which stays mounted behind it; Esc closes it and gives focus back.
    const shown = main.getByRole('tabpanel');
    await menu(app, 'tab.overview');
    await expect(overview).toBeVisible();
    await expect(overview).toBeFocused();
    await expect(shown.locator('.transcript')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(overview).toHaveCount(0);
    expect(await tabLabels(page, 'Open tabs'), 'the Overview is no tab').toEqual([three[0], three[2]]);

    // Drag a session tab onto the main region's right edge: the second pane opens with it.
    const mainBox = (await main.boundingBox())!;
    await drag(page, page.getByRole('tab', { name: three[0] }), { x: mainBox.x + mainBox.width - 24, y: mainBox.y + mainBox.height / 2 });
    await expect.poll(() => tabLabels(page, 'Right pane tabs'), { message: 'the drop edge opens the split' }).toEqual([three[0]]);
    expect(await tabLabels(page, 'Left pane tabs')).toEqual([three[2]]);
    await expect(main.getByRole('separator', { name: 'Resize panes' })).toBeVisible();

    // ⌘\ moves the focused pane's active tab across; the pane it empties goes, and the split with it.
    await page.getByRole('tab', { name: three[2] }).click();
    await menu(app, 'pane.split');
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: '⌘\\ moves the active tab, and the emptied pane collapses the split' }).toEqual([three[0], three[2]]);
    await expect(page.getByRole('tablist', { name: 'Right pane tabs' })).toHaveCount(0);
    await expect(main.getByRole('separator', { name: 'Resize panes' })).toHaveCount(0);

    // Closing the last tab leaves the main area empty, offering the Overview and a new session.
    await menu(app, 'tab.close');
    await menu(app, 'tab.close');
    await expect.poll(() => tabLabels(page, 'Open tabs')).toEqual([]);
    await expect(main.getByText('No open tabs')).toBeVisible();
    await menu(app, 'tab.reopen');
    await menu(app, 'tab.reopen');
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: '⌘⇧T twice' }).toEqual([three[0], three[2]]);

    // A sidebar row dragged onto a tab strip opens its session there.
    const strip = page.getByRole('tablist', { name: 'Open tabs' });
    const stripBox = (await strip.boundingBox())!;
    await drag(page, await sidebarRow(page, 'Charter + research'), { x: stripBox.x + stripBox.width - 8, y: stripBox.y + stripBox.height / 2 });
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: 'the dropped row opens a tab' }).toEqual([three[0], three[2], 'Charter + research · MAWS']);
  });

  await test.step('Item 8: the ⌘K palette', async () => {
    await menu(app, 'palette.open');
    await expect(palette).toBeVisible();
    const actions = palette.getByRole('group', { name: 'Actions' }).getByRole('option');
    const ids = Object.keys(ACTIONS) as ActionId[];
    await expect(actions).toHaveCount(ids.length);
    const actionTexts = await actions.allTextContents();
    for (const [i, id] of ids.entries()) {
      const { title, chord } = ACTIONS[id] as { title: string; chord: string | null };
      expect(actionTexts[i], `${id} is listed with its chord`).toContain(title);
      if (chord) expect(actionTexts[i], `${id} is listed with its chord`).toContain(formatChord(chord));
    }
    await menu(app, 'theme.dark');
    await expect.poll(() => regionBackground(page)).toBe(tokens.dark['--bg-raised']);
    expect(await noLeftovers(page, tokens.light), 'no light colour in the dark theme (palette)').toEqual([]);
    await menu(app, 'theme.light');
    await expect.poll(() => regionBackground(page)).toBe(tokens.light['--bg-raised']);
    expect(await noLeftovers(page, tokens.dark), 'no dark colour after switching back to light').toEqual([]);

    await page.keyboard.type('north');
    await expect(palette.getByRole('group', { name: 'Sessions' }).getByRole('option')).toHaveCount(1);
    await expect(palette.getByRole('group', { name: 'Sessions' }).getByRole('option')).toContainText(NORTH);
    await page.keyboard.press('Enter');
    await expect(palette).toHaveCount(0);
    await expect.poll(() => selectedTab(page, 'Open tabs'), { message: '⏎ opens it' }).toBe(three[2]);

    await menu(app, 'palette.open');
    await page.keyboard.type('dark');
    await expect(palette.getByRole('group', { name: 'Actions' }).getByRole('option')).toHaveText([/^Appearance: Dark/]);
    await expect(palette.getByRole('group', { name: 'Sessions' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);

    await menu(app, 'palette.open');
    await page.keyboard.type('north');
    await expect(palette.getByRole('group', { name: 'Sessions' }).getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Meta+Enter');
    await expect.poll(() => tabLabels(page, 'Right pane tabs'), { message: '⌘⏎ opens it in the split' }).toEqual([three[2]]);
    expect(await tabLabels(page, 'Left pane tabs')).toEqual([three[0], 'Charter + research · MAWS']);
  });

  await test.step('Item 6: sizes, the expanded project, the collapsed panel', async () => {
    await dragBy(page, sidebar.getByRole('separator', { name: 'Resize sidebar' }), -60);
    await expect(sidebar.getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute('aria-valuenow', '240');
    const panelResizer = page.locator('[data-region="panel"]').getByRole('separator', { name: 'Resize right panel' });
    await dragBy(page, panelResizer, 60);
    await expect(panelResizer).toHaveAttribute('aria-valuenow', '320');
    await showProjectList(page);
    const usageProjectId = await projectRow(page, USAGE_PROJECT).getAttribute('data-menu').then((menuId) => menuId!.slice('project:'.length));
    await closeProject(page, USAGE_PROJECT); // the 8 s entry left it expanded: the click below is the one that opens it
    await openProject(page, USAGE_PROJECT);
    // W12: the strip shows that project's tab set (nothing open, under its name); opening a MAWS session from the
    // palette brings MAWS's set and its split back while the sidebar stays on the project.
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: 'the clicked project’s empty set' }).toEqual([]);
    await expect(main.getByRole('button', { name: `Tabs of ${USAGE_PROJECT}` })).toBeVisible();
    await menu(app, 'palette.open');
    await page.keyboard.type('charter');
    await page.keyboard.press('Enter');
    await expect.poll(() => tabLabels(page, 'Left pane tabs')).toEqual([three[0], 'Charter + research · MAWS']);
    await expect(main.getByRole('button', { name: 'Tabs of MAWS' })).toBeVisible();
    await menu(app, 'panel.toggle');
    await expect(panelResizer).toHaveCount(0);
    await expect.poll(async () => (await page.locator('[data-region="panel"]').boundingBox())?.width ?? 0).toBe(0);

    await expect
      .poll(async () => {
        const regions = (await layoutGet(page, 'regions')) as { sidebar: { width: number; expandedProjects: string[] }; panel: { width: number; collapsed: boolean } };
        const main = (await layoutGet(page, 'main.tabs')) as { version: number; current: string; sets: Record<string, { panes: unknown[] }> };
        return [regions.sidebar.width, regions.panel.width, regions.panel.collapsed, regions.sidebar.expandedProjects.includes(usageProjectId), main.version, main.current, main.sets[main.current]?.panes.length];
      }, { message: 'the layout is written back' })
      .toEqual([240, 320, true, true, 2, 'proj-maws', 2]);
    expect((await layoutList(page)).sort()).toEqual(['main.tabs', 'panel.pinned', 'regions', 'window.main']);
  });

  expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  return {
    regions: await layoutGet(page, 'regions'),
    main: await layoutGet(page, 'main.tabs'),
    panelPinned: await layoutGet(page, 'panel.pinned'),
    bounds: await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()),
    left: await tabLabels(page, 'Left pane tabs'),
    right: await tabLabels(page, 'Right pane tabs'),
  };
}

async function relaunchedInstance(maws: MawsLaunch, saved: Saved): Promise<void> {
  const { app, page } = maws;
  const sidebar = page.locator('[data-region="sidebar"]');
  // W11: the sidebar opens with the projects expanded at quit.
  await expect(projectRow(page, USAGE_PROJECT)).toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 });
  // W5: the app opens to the last active tab; the Overview stays closed until asked for.
  await expect(page.locator('[data-region="main"]').getByRole('dialog', { name: 'Overview' })).toHaveCount(0);

  // The layout comes back as it was saved.
  await expect.poll(() => tabLabels(page, 'Left pane tabs'), { message: 'the tabs and the split are back' }).toEqual(saved.left);
  expect(await tabLabels(page, 'Right pane tabs')).toEqual(saved.right);
  await expect(sidebar.getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute('aria-valuenow', '240');
  expect(await treeRows(projectRow(page, USAGE_PROJECT))).toEqual(['Usage reset countdown', 'Settings idle probe', 'SDK wire inventory']);
  await expect(page.locator('[data-region="panel"]').getByRole('separator')).toHaveCount(0);
  expect((await page.locator('[data-region="panel"]').boundingBox())?.width ?? 0, 'the panel stays collapsed').toBe(0);
  await page.waitForTimeout(500); // past the 250 ms write-back: hydration must not have rewritten anything
  expect(await layoutGet(page, 'regions')).toEqual(saved.regions);
  expect(await layoutGet(page, 'main.tabs')).toEqual(saved.main);
  expect(await layoutGet(page, 'panel.pinned')).toEqual(saved.panelPinned);
  expect((await layoutList(page)).sort()).toEqual(['main.tabs', 'panel.pinned', 'regions', 'window.main']);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()), 'the window bounds are restored').toEqual(saved.bounds);
  const file = JSON.parse(readFileSync(join(maws.userData, 'layout.json'), 'utf8')) as Record<string, unknown>;
  expect(file['window.main']).toMatchObject({ bounds: saved.bounds });

  expect(maws.consoleErrors(), 'the relaunched console stays free of errors').toEqual([]);
}

// ---- helpers ---------------------------------------------------------------------------------------------------------------

// Clicks an application-menu item in main, by the id `buildMenu` gives it (`tab.select:<n>` for the numbered tabs).
async function menu(app: ElectronApplication, id: string): Promise<void> {
  const clicked = await app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item?.enabled) return false;
    item.click();
    return true;
  }, id);
  expect(clicked, `menu item ${id} exists and is enabled`).toBe(true);
}

// Plays the scenario's timeline up to `ms` (the manual clock, MAWS_SCENARIO_CLOCK=manual).
async function advanceTo(app: ElectronApplication, ms: number): Promise<void> {
  await app.evaluate((_electron, ms) => {
    const scenario = (globalThis as { __maws_scenario?: { advanceTo(ms: number): void } }).__maws_scenario;
    if (!scenario) throw new Error('no scenario clock: the app is not in launch mode scenario with MAWS_SCENARIO_CLOCK=manual');
    scenario.advanceTo(ms);
  }, ms);
}

function collectStderr(app: ElectronApplication): () => string {
  let text = '';
  app.process().stderr?.on('data', (chunk) => (text += String(chunk)));
  return () => text;
}

const quitLines = (stderr: string) => stderr.split('\n').filter((line) => line.startsWith('quit-guard:'));

async function captureEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const captured: Captured = { notified: [], navigate: [] };
    window.__maws_e2e = captured;
    window.maws.on('attention.notified', (payload) => captured.notified.push({ ...payload, receivedAt: Date.now() }));
    window.maws.on('attention.navigate', (payload) => captured.navigate.push(payload));
  });
}

const captured = (page: Page) => page.evaluate(() => window.__maws_e2e!);

const layoutGet = async (page: Page, key: 'regions' | 'main.tabs' | 'panel.pinned') => {
  const result = await page.evaluate((key) => window.maws.invoke('layout.get', { key }), key);
  if (!result.ok) throw new Error(`layout.get ${key}: ${JSON.stringify(result.error)}`);
  return result.value.value;
};

const layoutList = async (page: Page) => {
  const result = await page.evaluate(() => window.maws.invoke('layout.list', undefined));
  if (!result.ok) throw new Error(`layout.list: ${JSON.stringify(result.error)}`);
  return result.value.keys;
};


const treeRows = (scope: Locator) => scope.locator('[data-kind="session"]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));

// W11: the project rows, and each collapsed project's counts as they read on its line (◐ waiting, ● working).
const projectRows = (sidebar: Locator) => sidebar.locator('[data-kind="project"]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
const rollups = (sidebar: Locator) =>
  sidebar
    .locator('[data-kind="project"]')
    .evaluateAll((els) =>
      Object.fromEntries(els.map((el) => [el.getAttribute('aria-label'), Array.from(el.querySelectorAll('[data-project-line] [aria-label$=" waiting"], [data-project-line] [aria-label$=" working"]')).map((n) => n.textContent).join('')])),
    );

const rowGlyphs = (sidebar: Locator) =>
  sidebar
    .locator('[data-kind="session"]')
    .evaluateAll((els) => Object.fromEntries(els.map((el) => [el.getAttribute('aria-label'), el.querySelector('[role="img"]')?.getAttribute('aria-label')])));

const unreadRows = (sidebar: Locator) =>
  sidebar
    .locator('[data-kind="session"]')
    .evaluateAll((els) => els.filter((el) => el.querySelector('[aria-label="Unread"]')).map((el) => el.getAttribute('aria-label')));

const overviewGroups = (board: Locator) =>
  board.evaluate((el) =>
    Object.fromEntries(
      Array.from(el.querySelectorAll(':scope > [role="listitem"]')).map((group) => [
        group.getAttribute('aria-label'),
        Array.from(group.querySelectorAll('article')).map((card) => card.getAttribute('aria-label')),
      ]),
    ),
  );

const tabLabels = (page: Page, strip: string) =>
  page
    .getByRole('tablist', { name: strip })
    .locator('[role="tab"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));

const selectedTab = (page: Page, strip: string) => page.getByRole('tablist', { name: strip }).locator('[role="tab"][aria-selected="true"]').getAttribute('aria-label');

// Hovers a session's row (its project expanded, W11) with the pointer and returns its open hover card. The hover is
// retried from a neutral point: now and then, right after a Radix menu has closed, Chromium keeps the synthetic pointer's
// hover state stale and the row sees no pointerenter although it is the hit target (a fresh move in fixes it).
async function hoverRow(page: Page, title: string): Promise<Locator> {
  const card = page.getByRole('dialog', { name: title });
  const row = await sidebarRow(page, title);
  await expect(async () => {
    await page.mouse.move(700, 400);
    await row.hover();
    await expect(card).toBeVisible({ timeout: 2_000 });
  }, `the hover card of ${title} opens`).toPass({ timeout: 10_000 });
  return card;
}

async function unhover(page: Page, card: Locator): Promise<void> {
  await page.locator('[data-region="main"]').hover({ position: { x: 400, y: 300 } });
  await expect(card).toHaveCount(0);
}

// A native HTML drag with the real pointer: press on the source, move in steps to the point, release.
async function drag(page: Page, source: Locator, to: { x: number; y: number }): Promise<void> {
  const box = (await source.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

// A resizer drag along x by `dx` pixels.
async function dragBy(page: Page, resizer: Locator, dx: number): Promise<void> {
  const box = (await resizer.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 10 });
  await page.mouse.up();
}

// ---- themes ----------------------------------------------------------------------------------------------------------------

const COLOUR_TOKENS = [
  '--bg', '--bg-raised', '--bg-overlay', '--bg-hover', '--bg-active', '--border', '--border-strong', '--fg', '--fg-muted', '--fg-faint',
  '--accent', '--accent-soft', '--success', '--warning', '--danger', '--info', '--diff-add-bg', '--diff-del-bg',
] as const;
type Palette = Record<(typeof COLOUR_TOKENS)[number], string>;

// Every colour token resolved to its computed colour under each theme, by probing inside a `[data-theme]` element.
async function themeTokens(page: Page): Promise<{ light: Palette; dark: Palette }> {
  return page.evaluate((names) => {
    const resolve = (theme: string) => {
      const host = document.createElement('div');
      host.setAttribute('data-theme', theme);
      const probe = document.createElement('span');
      host.append(probe);
      document.body.append(host);
      const out: Record<string, string> = {};
      for (const name of names) {
        probe.style.color = `var(${name})`;
        out[name] = getComputedStyle(probe).color;
      }
      host.remove();
      return out;
    };
    return { light: resolve('light'), dark: resolve('dark') } as { light: Palette; dark: Palette };
  }, COLOUR_TOKENS);
}

const regionBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.querySelector('[data-region="sidebar"]')!).backgroundColor);

// Elements (portals included: menus, the hover card, the palette, toasts) whose background, text or border colour is a
// colour only the other theme's tokens produce: a remnant of it. Returns the first few offenders, described.
async function noLeftovers(page: Page, other: Palette): Promise<string[]> {
  const themed = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const own = themed === 'dark' ? (await themeTokens(page)).dark : (await themeTokens(page)).light;
  const forbidden = [...new Set(Object.values(other))].filter((colour) => !Object.values(own).includes(colour));
  return page.evaluate((forbidden) => {
    const props = ['background-color', 'color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'];
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const style = getComputedStyle(el);
      for (const prop of props) {
        const value = style.getPropertyValue(prop);
        if (forbidden.includes(value)) {
          offenders.push(`${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}.${el.className} ${prop} ${value}`);
          break;
        }
      }
      if (offenders.length >= 8) break;
    }
    return offenders;
  }, forbidden);
}
