// Acceptance defects 5/9 and D7's compact row: physical geometry and portalled-menu hit targets need Electron.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { project, record } from '../test/support/builders';
import { ScenarioFileSchema } from '../test/support/scenario';
import { launchMaws, test } from './support/launch';
import { openProject, projectRow, sidebarOf } from './support/sidebar';

const TITLE = 'Greet.py docstring UI test';

test('UX1: titles keep their width on hover and conversation search stays reachable above 785 uncapped results', async () => {
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
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_E2E_FOREGROUND: '0', MAWS_SESSION_SOURCE: `stub:${fixture}`, MAWS_SCENARIO_CLOCK: 'manual' } });
  try {
    const { page } = maws;
    await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1280, 820));
    await openProject(page, 'chosen');
    const row = sidebarOf(page).getByRole('treeitem', { name: TITLE, exact: true });
    await page.mouse.move(700, 400);
    const title = row.locator('[data-session-title]');
    const rest = await title.boundingBox();
    expect(rest).not.toBeNull();
    expect(rest!.width, 'the worktree title owns at least half of a compact 240px sidebar').toBeGreaterThanOrEqual(120);
    await row.hover();
    const actions = row.getByRole('button', { name: `Actions for ${TITLE}`, exact: true });
    await expect(actions).toBeVisible();
    const hovered = await title.boundingBox();
    expect(hovered!.width, 'age and overflow share one slot; hover must not squeeze the title').toBe(rest!.width);
    const actionBox = await actions.boundingBox();
    const unread = row.getByRole('button', { name: 'Mark read', exact: true });
    const unreadBox = await unread.boundingBox();
    expect(actionBox!.x + actionBox!.width, 'unread and overflow remain separate hit targets').toBeLessThanOrEqual(unreadBox!.x);
    await unread.click();
    await expect(row.getByRole('img', { name: 'Unread', exact: true })).toHaveCount(0);
    await expect(row).toHaveAttribute('aria-selected', 'false');

    // A portal may be outside the sidebar's DOM box, but it is still the person's current sidebar action.
    await row.click({ button: 'right' });
    const contextMenu = page.getByRole('menu');
    await expect(contextMenu).toBeVisible();
    const menuBox = await contextMenu.boundingBox();
    await page.mouse.move(menuBox!.x + menuBox!.width - 4, menuBox!.y + 8);
    await maws.app.evaluate(() => {
      const scenario = (globalThis as { __maws_scenario?: { advanceTo(ms: number): void } }).__maws_scenario;
      if (!scenario) throw new Error('Missing manual scenario clock');
      scenario.advanceTo(1000);
    });
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
