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
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { ACTIONS, type ActionId } from '../src/shared/keymap/actions';
import { formatChord } from '../src/shared/keymap/chord';
import { launchMaws, type MawsLaunch } from './support/launch';

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
    const saved = await firstInstance(first);
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

interface Saved {
  regions: unknown;
  main: unknown;
  panelPinned: unknown;
  bounds: { x: number; y: number; width: number; height: number };
  left: string[];
  right: string[];
}

async function firstInstance(maws: MawsLaunch): Promise<Saved> {
  const { app, page } = maws;
  const sidebar = page.locator('[data-region="sidebar"]');
  const main = page.locator('[data-region="main"]');
  const board = main.getByRole('list', { name: 'Overview' });
  const usageCard = board.getByRole('article', { name: 'Usage reset countdown' });
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const badge = () => app.evaluate(({ app }) => app.dock?.getBadge());
  const four = ['Overview', `${FIX} · MAWS`, `${SIP} · MAWS`, `${QUOTA} · codex_somersault`];

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

    await expect(sidebar.getByRole('heading', { name: 'Needs you · 3' })).toBeVisible();
    expect(await needsYouRows(page), 'Needs you, longest wait first').toEqual([FIX, SIP, QUOTA]);
    expect(await needsYouGlyphs(page)).toEqual(['Needs approval', 'Question', 'Plan review']);

    expect(await treeRows(sidebar.getByRole('tree', { name: 'Pinned' }))).toEqual(['Workstation north star']);
    expect(await sidebar.getByRole('tree', { name: 'Projects' }).locator('[data-kind="project"]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(
      ['MAWS', 'codex_somersault', USAGE_PROJECT],
    );
    expect(await treeRows(sidebar.getByRole('group', { name: 'MAWS' })), 'the pinned session is not repeated').toEqual([FIX, SIP, 'Charter + research']);
    expect(await treeRows(sidebar.getByRole('group', { name: 'codex_somersault' }))).toEqual([QUOTA, 'Somersault terminal run', 'Trace stream reconnects']);
    expect(await treeRows(sidebar.getByRole('group', { name: USAGE_PROJECT }))).toEqual(['Usage reset countdown', 'Settings idle probe', 'SDK wire inventory']);
    expect(await treeRows(sidebar.getByRole('tree', { name: 'Other sessions' }))).toEqual(['Terminal workflow notes']);

    expect(await rowGlyphs(sidebar), 'every glyph as the glyph table labels it').toEqual({
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
    expect(await unreadRows(sidebar), 'unread dots on exactly the unread records').toEqual([FIX, QUOTA, 'Terminal workflow notes']);

    const foreign = sidebar.getByRole('treeitem', { name: 'Somersault terminal run' });
    await expect(foreign).toContainText('Terminal · pid 7135');
    await foreign.click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    expect(await page.getByRole('menuitem').allTextContents(), 'a foreign-live session offers Open only').toEqual(['Open']);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(await noLeftovers(page, tokens.dark), 'no dark colour in the light theme').toEqual([]);
  });

  await test.step('Item 2: the Overview board', async () => {
    expect(await tabLabels(page, 'Open tabs')).toEqual(['Overview']);
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
      await expect(main.getByText('Charter + research needs you · Read: docs/charter.md')).toBeVisible();
    }
    expect(await badge()).toBe('4');
    await expect(sidebar.getByRole('heading', { name: 'Needs you · 4' })).toBeVisible();
    expect(await needsYouRows(page), 'the newest request is last').toEqual([FIX, SIP, QUOTA, 'Charter + research']);
    expect(await noLeftovers(page, tokens.light), 'no light colour in the dark theme (toast)').toEqual([]);
  });

  await test.step('Item 3: approve the read-only request from its hover card, by pointer only', async () => {
    // Keyboard first: focus opens the hover card, and neither Enter on the focused row nor Enter on a focused Approve
    // answers (§5.1: approval from the hover card is an explicit click).
    const charterRow = page.locator('[aria-label="Needs you"] > li[data-title="Charter + research"] > button');
    const charterDialog = page.getByRole('dialog', { name: 'Charter + research' });
    await charterRow.focus();
    await expect(charterDialog.getByRole('button', { name: 'Approve' })).toBeVisible();
    await charterDialog.getByRole('button', { name: 'Approve' }).focus();
    await page.keyboard.press('Enter');
    await charterRow.focus();
    await page.keyboard.press('Enter'); // the row deep-links to the Overview card
    await page.waitForTimeout(300);
    expect(await needsYouRows(page), 'Enter answered nothing').toEqual([FIX, SIP, QUOTA, 'Charter + research']);
    await expect(board.getByRole('article', { name: 'Charter + research' })).toBeFocused();
    await page.locator('[data-region="main"]').hover({ position: { x: 400, y: 300 } });
    await expect(charterDialog).toHaveCount(0);

    const charterHover = await hoverRow(page, 'Charter + research');
    await expect(charterHover.getByTestId('request-input')).toHaveText(/\/docs\/charter\.md$/);
    await expect(charterHover.getByRole('button', { name: 'Deny' })).toBeVisible();
    expect(await noLeftovers(page, tokens.light), 'no light colour in the dark theme (hover card)').toEqual([]);
    await charterHover.getByRole('button', { name: 'Approve' }).click();
    await expect(sidebar.getByRole('heading', { name: 'Needs you · 3' })).toBeVisible();
    expect(await needsYouRows(page)).toEqual([FIX, SIP, QUOTA]);
    await expect(board.getByRole('article', { name: 'Charter + research' }).getByTestId('card-activity')).toHaveText('Continuing');
    await expect.poll(badge).toBe('3');
  });

  await test.step('The 8 s entry: Usage reset countdown ends its turn while nobody looks at it', async () => {
    await advanceTo(app, 8000);
    const usageRow = sidebar.getByRole('treeitem', { name: 'Usage reset countdown' });
    await expect(usageRow.getByRole('img', { name: 'Idle, unread' })).toBeVisible();
    await expect(usageRow.getByRole('img', { name: 'Unread', exact: true })).toBeVisible();
    await expect(usageCard.getByTestId('card-activity')).toHaveText('Idle');
    await expect(usageCard.getByRole('img', { name: 'Unread', exact: true })).toBeVisible();
  });

  await test.step('Item 2: ⌘⇧J lands on the oldest Needs-you session', async () => {
    await menu(app, 'attention.next');
    await expect.poll(() => tabLabels(page, 'Open tabs')).toEqual(['Overview', `${FIX} · MAWS`]);
    const fixTab = page.getByRole('tab', { name: `${FIX} · MAWS` });
    await expect(fixTab).toHaveAttribute('aria-selected', 'true');
    await expect(fixTab.getByRole('img', { name: 'Needs approval' })).toHaveText('◐');
    const panel = main.getByRole('tabpanel');
    // C6 registers the transcript slot: the session's transcript is mounted in place of C5's fallback.
    await expect(panel.locator('.transcript')).toHaveCount(1);
    await expect(panel.getByText('Transcript arrives with C6')).toHaveCount(0);
    await expect(panel.getByText('Approval needed')).toBeVisible();
    await expect(panel.getByTestId('request-input')).toHaveText('git log --oneline');
    await expect(panel.locator('[data-composer-frame]')).toBeAttached(); // C7: the composer fills its slot; its frame waits behind the docked card
    await expect(panel.getByRole('group', { name: 'Session status' })).toHaveCount(0); // W2: nothing sits under the composer

    await menu(app, 'theme.light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => regionBackground(page)).toBe(tokens.light['--bg-raised']);
  });

  await test.step('Item 5: tabs, the split, drags', async () => {
    await sidebar.getByRole('treeitem', { name: SIP }).click();
    await sidebar.getByRole('treeitem', { name: QUOTA }).click();
    expect(await tabLabels(page, 'Open tabs')).toEqual(four);
    for (const n of [1, 2, 3, 4]) {
      await menu(app, `tab.select:${n}`);
      await expect.poll(() => selectedTab(page, 'Open tabs'), { message: `⌘${n}` }).toBe(four[n - 1]);
    }
    await page.getByRole('tab', { name: four[3] }).focus();
    await page.keyboard.press('Control+Tab');
    await expect.poll(() => selectedTab(page, 'Open tabs'), { message: '⌃Tab wraps' }).toBe('Overview');
    await page.keyboard.press('Control+Shift+Tab');
    await expect.poll(() => selectedTab(page, 'Open tabs'), { message: '⌃⇧Tab' }).toBe(four[3]);

    await menu(app, 'tab.close');
    await expect.poll(() => tabLabels(page, 'Open tabs')).toEqual(four.slice(0, 3));
    await menu(app, 'tab.reopen');
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: '⌘⇧T restores the tab where it was' }).toEqual(four);
    expect(await selectedTab(page, 'Open tabs')).toBe(four[3]);

    await page.getByRole('tab', { name: four[2] }).click({ button: 'middle' });
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: 'middle-click closes' }).toEqual([four[0], four[1], four[3]]);

    await expect(page.getByRole('tab', { name: 'Overview' }).getByRole('button'), 'the Overview has no close control').toHaveCount(0);
    await menu(app, 'tab.select:1');
    await expect.poll(() => selectedTab(page, 'Open tabs')).toBe('Overview');
    await menu(app, 'tab.close');
    await page.waitForTimeout(300);
    expect(await tabLabels(page, 'Open tabs'), '⌘W on the Overview does nothing').toEqual([four[0], four[1], four[3]]);

    // Drag a session tab onto the main region's right edge: the second pane opens with it.
    const mainBox = (await main.boundingBox())!;
    await drag(page, page.getByRole('tab', { name: four[1] }), { x: mainBox.x + mainBox.width - 24, y: mainBox.y + mainBox.height / 2 });
    await expect.poll(() => tabLabels(page, 'Right pane tabs'), { message: 'the drop edge opens the split' }).toEqual([four[1]]);
    expect(await tabLabels(page, 'Left pane tabs')).toEqual([four[0], four[3]]);
    await expect(main.getByRole('separator', { name: 'Resize panes' })).toBeVisible();

    // ⌘\ moves the focused pane's active tab across.
    await page.getByRole('tab', { name: four[3] }).click();
    await menu(app, 'pane.split');
    await expect.poll(() => tabLabels(page, 'Left pane tabs'), { message: '⌘\\ moves the active tab' }).toEqual(['Overview']);
    expect(await tabLabels(page, 'Right pane tabs')).toContain(four[3]);
    expect((await tabLabels(page, 'Right pane tabs')).sort()).toEqual([four[1], four[3]].sort());

    // Closing the right pane's last tab collapses the split.
    await menu(app, 'tab.close');
    await expect.poll(() => tabLabels(page, 'Right pane tabs').then((tabs) => tabs.length)).toBe(1);
    await menu(app, 'tab.close');
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: 'the split collapses on its last close' }).toEqual(['Overview']);
    await expect(page.getByRole('tablist', { name: 'Right pane tabs' })).toHaveCount(0);
    await expect(main.getByRole('separator', { name: 'Resize panes' })).toHaveCount(0);

    // A sidebar row dragged onto a tab strip opens its session there.
    const strip = page.getByRole('tablist', { name: 'Open tabs' });
    const stripBox = (await strip.boundingBox())!;
    await drag(page, sidebar.getByRole('treeitem', { name: 'Charter + research' }), { x: stripBox.x + stripBox.width - 8, y: stripBox.y + stripBox.height / 2 });
    await expect.poll(() => tabLabels(page, 'Open tabs'), { message: 'the dropped row opens a tab' }).toEqual(['Overview', 'Charter + research · MAWS']);
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

    await page.keyboard.type('quota');
    await expect(palette.getByRole('group', { name: 'Sessions' }).getByRole('option')).toHaveCount(1);
    await expect(palette.getByRole('group', { name: 'Sessions' }).getByRole('option')).toContainText(QUOTA);
    await page.keyboard.press('Enter');
    await expect(palette).toHaveCount(0);
    await expect.poll(() => selectedTab(page, 'Open tabs'), { message: '⏎ opens it' }).toBe(four[3]);

    await menu(app, 'palette.open');
    await page.keyboard.type('dark');
    await expect(palette.getByRole('group', { name: 'Actions' }).getByRole('option')).toHaveText([/^Appearance: Dark/]);
    await expect(palette.getByRole('group', { name: 'Sessions' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);

    await menu(app, 'palette.open');
    await page.keyboard.type('quota');
    await expect(palette.getByRole('group', { name: 'Sessions' }).getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Meta+Enter');
    await expect.poll(() => tabLabels(page, 'Right pane tabs'), { message: '⌘⏎ opens it in the split' }).toEqual([four[3]]);
    expect(await tabLabels(page, 'Left pane tabs')).toEqual(['Overview', 'Charter + research · MAWS']);
  });

  await test.step('Item 6: sizes, a collapsed project, the collapsed panel', async () => {
    await dragBy(page, sidebar.getByRole('separator', { name: 'Resize sidebar' }), -60);
    await expect(sidebar.getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute('aria-valuenow', '240');
    const panelResizer = page.locator('[data-region="panel"]').getByRole('separator', { name: 'Resize right panel' });
    await dragBy(page, panelResizer, 60);
    await expect(panelResizer).toHaveAttribute('aria-valuenow', '320');
    const usageProject = sidebar.getByRole('treeitem', { name: USAGE_PROJECT });
    await usageProject.click({ position: { x: 60, y: 12 } });
    await expect(usageProject).toHaveAttribute('aria-expanded', 'false');
    await menu(app, 'panel.toggle');
    await expect(panelResizer).toHaveCount(0);
    await expect.poll(async () => (await page.locator('[data-region="panel"]').boundingBox())?.width ?? 0).toBe(0);

    const usageProjectId = await usageProject.getAttribute('data-menu').then((menuId) => menuId!.slice('project:'.length));
    await expect
      .poll(async () => {
        const regions = (await layoutGet(page, 'regions')) as { sidebar: { width: number; collapsedProjects: string[] }; panel: { width: number; collapsed: boolean } };
        const main = (await layoutGet(page, 'main.tabs')) as { panes: unknown[] };
        return [regions.sidebar.width, regions.panel.width, regions.panel.collapsed, regions.sidebar.collapsedProjects.includes(usageProjectId), main.panes.length];
      }, { message: 'the layout is written back' })
      .toEqual([240, 320, true, true, 2]);
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
  await expect(sidebar.getByRole('heading', { name: 'Needs you · 3' })).toBeVisible({ timeout: 10_000 });

  // The layout comes back as it was saved.
  await expect.poll(() => tabLabels(page, 'Left pane tabs'), { message: 'the tabs and the split are back' }).toEqual(saved.left);
  expect(await tabLabels(page, 'Right pane tabs')).toEqual(saved.right);
  await expect(sidebar.getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute('aria-valuenow', '240');
  await expect(sidebar.getByRole('treeitem', { name: USAGE_PROJECT })).toHaveAttribute('aria-expanded', 'false');
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

const needsYouRows = (page: Page) => page.locator('[aria-label="Needs you"] > li').evaluateAll((els) => els.map((el) => el.getAttribute('data-title')));
const needsYouGlyphs = (page: Page) =>
  page.locator('[aria-label="Needs you"] > li').evaluateAll((els) => els.map((el) => el.querySelector('[role="img"]')?.getAttribute('aria-label')));

const treeRows = (scope: Locator) => scope.locator('[data-kind="session"]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));

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

// Hovers a Needs-you row with the pointer and returns its open hover card. The hover is retried from a neutral point:
// now and then, right after a Radix menu has closed, Chromium keeps the synthetic pointer's hover state stale and the
// row sees no pointerenter although it is the hit target (the card then never opens; a fresh move in fixes it).
async function hoverRow(page: Page, title: string): Promise<Locator> {
  const card = page.getByRole('dialog', { name: title });
  await expect(async () => {
    await page.mouse.move(700, 400);
    await page.locator(`[aria-label="Needs you"] > li[data-title="${title}"] > button`).hover();
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
