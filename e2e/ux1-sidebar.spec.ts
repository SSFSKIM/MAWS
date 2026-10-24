// Acceptance defects 5/9 and D7's compact row: physical geometry and portalled-menu hit targets need Electron.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type TestInfo } from '@playwright/test';
import { project, record } from '../test/support/builders';
import { ScenarioFileSchema } from '../test/support/scenario';
import { launchMaws, test, type MawsLaunch } from './support/launch';
import { openProject, projectRow, sidebarOf } from './support/sidebar';

const TITLE = 'Greet.py docstring UI test';
const SIZES = [{ width: 1280, height: 820 }, { width: 1512, height: 982 }, { width: 900, height: 820 }, { width: 620, height: 820 }] as const;

async function size(maws: MawsLaunch, width: number, height: number): Promise<void> {
  await maws.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setContentSize(w, h), [width, height] as const);
  await expect.poll(() => maws.page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
}

async function advance(maws: MawsLaunch, at: number): Promise<void> {
  await maws.app.evaluate((_electron, at) => {
    const scenario = (globalThis as { __maws_scenario?: { advanceTo(ms: number): void } }).__maws_scenario;
    if (!scenario) throw new Error('Missing manual scenario clock');
    scenario.advanceTo(at);
  }, at);
}

async function attachSidebarStates(maws: MawsLaunch, info: TestInfo, state: 'rows' | 'search'): Promise<void> {
  const { page } = maws;
  for (const { width, height } of SIZES) {
    await size(maws, width, height);
    if (await sidebarOf(page).evaluate((node) => node.hasAttribute('inert'))) {
      await page.getByRole('banner').getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
    }
    await expect(sidebarOf(page)).toHaveJSProperty('inert', false);
    await page.mouse.move(width - 8, height - 8);
    await expect(page.locator('[data-hover-card]')).toHaveCount(0);
    if (state === 'search') {
      await expect(sidebarOf(page).locator('[data-kind="session"]')).toHaveCount(785);
      await expect(sidebarOf(page).getByRole('button', { name: 'Search in conversations for ‘test’', exact: true })).toBeInViewport();
    }
    const name = `ux1-sidebar-${state}-${width}x${height}.png`;
    const path = info.outputPath(name);
    await page.screenshot({ path, animations: 'disabled' });
    await info.attach(name, { path, contentType: 'image/png' });
  }
  await size(maws, 1280, 820);
}

test('UX1: titles keep their width on hover and conversation search stays reachable above 785 uncapped results', async ({ mawsEnv }, info) => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'maws-sidebar-acceptance-'));
  const directory = join(root, 'chosen');
  mkdirSync(directory);
  const chosen = project('chosen', 0, { directory });
  const sessions = Array.from({ length: 785 }, (_, index) => record(`sidebar-${index}`, {
    projectId: chosen.id, directory,
    title: { text: index === 0 ? TITLE : `test conversation ${index}`, source: 'user' },
    updatedAt: index === 0 ? '2026-10-24T10:00:00Z' : '2026-10-24T09:00:00Z',
    unread: index === 0,
    worktree: index === 0 ? { path: join(root, 'worktree'), branch: 'acceptance' } : null,
  }));
  const otherDirectory = join(root, 'other');
  mkdirSync(otherDirectory);
  const other = project('other', 1, { directory: otherDirectory });
  const elsewhere = record('elsewhere', { projectId: other.id, directory: otherDirectory, updatedAt: '2026-10-24T08:00:00Z' });
  const fixture = join(root, 'scenario.json');
  writeFileSync(fixture, JSON.stringify(ScenarioFileSchema.parse({
    version: 1, projects: [chosen, other], sessions: [...sessions, elsewhere], digests: [], engine: [], attention: [],
    timeline: [{ at: 1000, op: 'session', record: { ...elsewhere, updatedAt: new Date(Date.now() + 86_400_000).toISOString() } }],
  })));
  const maws = await launchMaws({ env: { ...mawsEnv, MAWS_HARNESS: '0', MAWS_E2E_FOREGROUND: '0', MAWS_SESSION_SOURCE: `stub:${fixture}`, MAWS_SCENARIO_CLOCK: 'manual' } });
  try {
    const { page } = maws;
    await size(maws, 1280, 820);
    await openProject(page, 'chosen');
    const row = sidebarOf(page).getByRole('treeitem', { name: TITLE, exact: true });
    await page.mouse.move(700, 400);
    const title = row.locator('[data-session-title]');
    const rest = await title.boundingBox();
    const rowBox = await row.boundingBox();
    const worktreeBox = await row.getByRole('img', { name: 'Worktree', exact: true }).boundingBox();
    expect(rest).not.toBeNull();
    expect(rowBox).not.toBeNull();
    expect(worktreeBox).not.toBeNull();
    // The title gets the remaining row, not an arbitrary fraction of the outer sidebar. The worktree
    // character's width depends on the font; reserve only two 7px insets, four 5px gaps, the 12px status,
    // the shared 26px age/menu slot and the separate 16px unread target. Extra chrome must not steal space.
    const fixedChromeBudget = 2 * 7 + 4 * 5 + 12 + 26 + 16;
    const titleBudget = rowBox!.width - worktreeBox!.width - fixedChromeBudget;
    expect(rest!.width, 'the title uses the remaining width after its required marks and action slots').toBeGreaterThanOrEqual(titleBudget);
    await row.hover();
    const actions = row.getByRole('button', { name: `Actions for ${TITLE}`, exact: true });
    await expect(actions).toBeVisible();
    const hovered = await title.boundingBox();
    expect(hovered!.width, 'age and overflow share one slot; hover must not squeeze the title').toBe(rest!.width);
    const actionBox = await actions.boundingBox();
    const unread = row.getByRole('button', { name: 'Mark read', exact: true });
    const unreadBox = await unread.boundingBox();
    expect(actionBox!.x + actionBox!.width, 'unread and overflow remain separate hit targets').toBeLessThanOrEqual(unreadBox!.x);
    await attachSidebarStates(maws, info, 'rows');
    await unread.click();
    await expect(row.getByRole('img', { name: 'Unread', exact: true })).toHaveCount(0);
    await expect(row).toHaveAttribute('aria-selected', 'false');

    // A portal may be outside the sidebar's DOM box, but it is still the person's current sidebar action.
    await row.click({ button: 'right' });
    const contextMenu = page.getByRole('menu');
    await expect(contextMenu).toBeVisible();
    const menuBox = await contextMenu.boundingBox();
    await page.mouse.move(menuBox!.x + menuBox!.width - 4, menuBox!.y + 8);
    await advance(maws, 1000);
    const projects = sidebarOf(page).locator('[data-kind="project"]');
    await expect(projects.first()).toHaveAttribute('aria-label', 'chosen');
    await page.keyboard.press('Escape');
    await expect(contextMenu).toHaveCount(0);
    await page.mouse.move(700, 400);
    await page.locator('[data-region="main"]').getByRole('button', { name: /Overview/ }).focus();
    await expect(projects.first()).toHaveAttribute('aria-label', 'other');

    const input = sidebarOf(page).getByRole('searchbox', { name: 'Search projects and sessions' });
    await input.fill('test');
    await expect(sidebarOf(page).locator('[data-kind="session"]')).toHaveCount(785);
    await expect(projectRow(page, 'chosen').getByLabel('785 matching sessions')).toBeVisible();
    await attachSidebarStates(maws, info, 'search');
    const search = sidebarOf(page).getByRole('button', { name: 'Search in conversations for ‘test’', exact: true });
    await expect(search).toBeInViewport();
    const before = await search.boundingBox();
    await sidebarOf(page).getByTestId('sidebar-tree').evaluate((node) => { node.scrollTop = node.scrollHeight; });
    expect(await search.boundingBox(), 'the search action is outside the long results scroller').toEqual(before);
    await input.focus();
    await page.keyboard.press('Tab');
    await expect(search).toBeFocused();
    await page.keyboard.press('Enter');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('combobox')).toHaveValue('test');
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

// Chromium removes hovered/focused elements without necessarily emitting pointerleave or blur.
// Exercise those native lifecycle edges, not synthetic replacement events that would hide a stuck hold.
test('UX1: ordering resumes after Escape removes a hovered portal and after the focused row disappears', async ({ mawsEnv }) => {
  const root = mkdtempSync(join(tmpdir(), 'maws-sidebar-lifecycle-'));
  const alphaDirectory = join(root, 'alpha');
  const betaDirectory = join(root, 'beta');
  mkdirSync(alphaDirectory);
  mkdirSync(betaDirectory);
  const alpha = project('alpha', 0, { directory: alphaDirectory });
  const beta = project('beta', 1, { directory: betaDirectory });
  const first = record('first', { projectId: alpha.id, directory: alphaDirectory, updatedAt: '2026-10-24T10:00:00Z' });
  const second = record('second', { projectId: alpha.id, directory: alphaDirectory, updatedAt: '2026-10-24T09:00:00Z' });
  const elsewhere = record('elsewhere', { projectId: beta.id, directory: betaDirectory, updatedAt: '2026-10-24T08:00:00Z' });
  const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const fixture = join(root, 'scenario.json');
  writeFileSync(fixture, JSON.stringify(ScenarioFileSchema.parse({
    version: 1, projects: [alpha, beta], sessions: [first, second, elsewhere], digests: [], engine: [], attention: [],
    timeline: [
      { at: 1000, op: 'session', record: { ...elsewhere, title: { text: 'Elsewhere after hover', source: 'user' }, updatedAt: future(1) } },
      { at: 2000, op: 'session', record: { ...first, title: { text: 'First after pointer', source: 'user' }, updatedAt: future(2) } },
      { at: 3000, op: 'removeSession', appSessionId: first.appId },
      { at: 4000, op: 'session', record: { ...second, title: { text: 'Second after removal', source: 'user' }, updatedAt: future(3) } },
    ],
  })));
  const maws = await launchMaws({ env: { ...mawsEnv, MAWS_HARNESS: '0', MAWS_E2E_FOREGROUND: '0', MAWS_SESSION_SOURCE: `stub:${fixture}`, MAWS_SCENARIO_CLOCK: 'manual' } });
  try {
    const { page } = maws;
    await size(maws, 1280, 820);
    await openProject(page, 'beta');
    await openProject(page, 'alpha');
    const sidebar = sidebarOf(page);
    const projects = sidebar.locator('[data-kind="project"]');
    await page.locator('[data-region="main"]').getByRole('button', { name: /Overview/ }).focus();
    await sidebar.getByRole('treeitem', { name: 'first', exact: true }).hover();
    const card = page.getByRole('dialog', { name: 'first', exact: true });
    await expect(card).toBeVisible();
    await card.hover();
    await advance(maws, 1000);
    await expect(sidebar.getByRole('treeitem', { name: 'Elsewhere after hover', exact: true })).toBeVisible();
    await expect(projects.first()).toHaveAttribute('aria-label', 'alpha');
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(projects.first()).toHaveAttribute('aria-label', 'beta');

    await page.mouse.move(1100, 700);
    await advance(maws, 2000);
    const focused = sidebar.getByRole('treeitem', { name: 'First after pointer', exact: true });
    await expect(focused).toBeVisible();
    await expect(projects.first()).toHaveAttribute('aria-label', 'alpha');
    await focused.focus();
    await expect(focused).toBeFocused();
    await advance(maws, 3000);
    await expect(focused).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await expect(projects.first()).toHaveAttribute('aria-label', 'beta');

    await advance(maws, 4000);
    await expect(sidebar.getByRole('treeitem', { name: 'Second after removal', exact: true })).toBeVisible();
    await expect(projects.first()).toHaveAttribute('aria-label', 'alpha');
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});
