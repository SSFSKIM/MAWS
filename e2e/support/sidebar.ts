// The sidebar's flat tree for end-to-end tests (charter §5.1 as amended 2026-10-01, W11): five project rows and then the
// list's own "Show more", each project expanding in place to at most eight sessions (five, then its "Show more"). A test
// that reaches a session's row expands its project first; the project comes from the session's own record
// (`session.list`), so a test names only the session.
import { expect, type Locator, type Page } from '@playwright/test';

export const sidebarOf = (page: Page) => page.locator('[data-region="sidebar"]');

// The row of a project, by name ("Other sessions" included). The row holds its sessions once expanded.
export const projectRow = (page: Page, name: string) => sidebarOf(page).locator(`[data-kind="project"][aria-label="${name}"]`);
// The project row's own line (the row itself also holds its expanded sessions): what a click toggles and a hover reveals.
export const projectLine = (row: Locator) => row.locator('[data-project-line]');

// An expanding or collapsing project moves what sits below it (300 ms): the motion is finished at once, so a row's box is
// where it stays (a hidden window, which some specs use, may not run it at all).
async function settled(page: Page): Promise<void> {
  await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
}

// Every project row on screen: the list's "Show more" (past the first five projects) is opened when it shows.
export async function showProjectList(page: Page): Promise<void> {
  const more = sidebarOf(page).locator('[data-tree-id="more-projects"]');
  if ((await more.count()) > 0) await more.click();
}

async function expandRow(page: Page, row: Locator): Promise<void> {
  if ((await row.getAttribute('aria-expanded')) !== 'true') await projectLine(row).click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await settled(page);
}

// Expands a project in place by its name on the list.
export async function openProject(page: Page, name: string): Promise<void> {
  await showProjectList(page);
  await expandRow(page, projectRow(page, name));
}

// Collapses a project by its name (its counts show only while collapsed).
export async function closeProject(page: Page, name: string): Promise<void> {
  await showProjectList(page);
  const row = projectRow(page, name);
  if ((await row.getAttribute('aria-expanded')) === 'true') await projectLine(row).click();
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await settled(page);
}

// The "+" on a project's row, revealed on hover: New chat in that project.
export async function newChatIn(page: Page, name: string): Promise<void> {
  await showProjectList(page);
  const row = projectRow(page, name);
  await projectLine(row).hover();
  await row.getByRole('button', { name: `New chat in ${name}`, exact: true }).click();
}

export type SessionMatch = string | { appSessionId: string };

// The row of a session, its project expanded first, and its project's "Show more" opened when the row is past the first
// five. A session past the eighth is the Resume… picker's, not the tree's.
export async function sidebarRow(page: Page, match: SessionMatch): Promise<Locator> {
  const key = await page.evaluate(async (match) => {
    const [sessions, projects] = await Promise.all([window.maws.invoke('session.list', { includeArchived: true }), window.maws.invoke('session.projects.list', undefined)]);
    if (!sessions.ok || !projects.ok) throw new Error('session.list or session.projects.list failed');
    const record = sessions.value.sessions.find((r) => (typeof match === 'string' ? r.title.text === match : r.appId === match.appSessionId));
    if (!record) throw new Error(`no session ${JSON.stringify(match)}`);
    return record.projectId !== null && projects.value.projects.some((p) => p.id === record.projectId) ? record.projectId : 'other';
  }, match);
  await showProjectList(page);
  const project = sidebarOf(page).locator(`[data-kind="project"][data-tree-id="p:${key}"]`);
  await expandRow(page, project);
  const row =
    typeof match === 'string'
      ? project.getByRole('treeitem', { name: match, exact: true })
      : project.locator(`[role="treeitem"][data-menu="session:${match.appSessionId}"]`);
  const more = project.locator(`[data-tree-id="more:${key}"]`);
  if ((await row.count()) === 0 && (await more.count()) > 0) {
    await more.click();
    await settled(page);
  }
  return row;
}
