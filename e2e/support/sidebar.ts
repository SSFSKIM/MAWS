// The sidebar's two levels for end-to-end tests (charter §5.1 as amended 2026-10-01, W5): a session's row lives on its
// project's page, so a test that reaches a row opens that page first, from wherever the sidebar stands. The project
// comes from the session's own record (`session.list`), so a test names only the session.
import { expect, type Locator, type Page } from '@playwright/test';

export const sidebarOf = (page: Page) => page.locator('[data-region="sidebar"]');
const levelsOf = (page: Page) => sidebarOf(page).getByTestId('sidebar-levels');

// The project list's row of a project, by name ("Other sessions" included).
export const projectRow = (page: Page, name: string) => sidebarOf(page).locator(`[data-level-pane="1"] [data-kind="project"][aria-label="${name}"]`);

// The levels slide (a 200ms transform): a row's box is where it will stay only once the slide has ended, so the slide is
// finished at once (a hidden window, which some specs use, may not run it at all).
async function settled(page: Page): Promise<void> {
  await levelsOf(page).evaluate((el) => el.getAnimations().forEach((animation) => animation.finish()));
}

// Back to the project list, when a page is open.
export async function showProjectList(page: Page): Promise<void> {
  if ((await levelsOf(page).getAttribute('data-level')) === '1') return;
  await sidebarOf(page).getByRole('button', { name: 'Back to projects' }).click();
  await expect(levelsOf(page)).toHaveAttribute('data-level', '1');
  await settled(page);
}

// Opens a project's page by its name on the list.
export async function openProject(page: Page, name: string): Promise<void> {
  await showProjectList(page);
  await projectRow(page, name).click();
  await expect(levelsOf(page)).toHaveAttribute('data-level', '2');
  await settled(page);
}

export type SessionMatch = string | { appSessionId: string };

// The row of a session on its project's page, the page opened first when another level shows.
export async function sidebarRow(page: Page, match: SessionMatch): Promise<Locator> {
  const key = await page.evaluate(async (match) => {
    const [sessions, projects] = await Promise.all([window.maws.invoke('session.list', { includeArchived: true }), window.maws.invoke('session.projects.list', undefined)]);
    if (!sessions.ok || !projects.ok) throw new Error('session.list or session.projects.list failed');
    const record = sessions.value.sessions.find((r) => (typeof match === 'string' ? r.title.text === match : r.appId === match.appSessionId));
    if (!record) throw new Error(`no session ${JSON.stringify(match)}`);
    return record.projectId !== null && projects.value.projects.some((p) => p.id === record.projectId) ? record.projectId : 'other';
  }, match);
  const levels = levelsOf(page);
  if ((await levels.getAttribute('data-level')) !== '2' || (await levels.getAttribute('data-open-project')) !== key) {
    await showProjectList(page);
    await sidebarOf(page).locator(`[data-level-pane="1"] [data-tree-id="p:${key}"]`).click();
    await expect(levels).toHaveAttribute('data-open-project', key);
    await settled(page);
  }
  const page2 = sidebarOf(page).locator('[data-level-pane="2"]');
  return typeof match === 'string'
    ? page2.getByRole('treeitem', { name: match, exact: true })
    : page2.locator(`[role="treeitem"][data-menu="session:${match.appSessionId}"]`);
}
