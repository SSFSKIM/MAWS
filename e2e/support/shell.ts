// Shell navigation only. Tests keep their assertions about the feature itself at the call site;
// chrome placement and the route to an optional surface belong here.
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { localRef } from './address';
import { applicationOf } from './launch';
import { menu } from './menu';

export const surfaceRow = (page: Page): Locator => page.locator('[data-surface-row][role="toolbar"]');
export const surface = (page: Page, toolId: string): Locator => page.locator(`[data-surface="${toolId}"]`);
export const mainTabs = (page: Page): Locator => page.locator('[data-chrome-tabs]');
export const mainTab = (page: Page, name: string | RegExp): Locator => mainTabs(page).getByRole('tab', { name, exact: typeof name === 'string' });
export const mainTabById = (page: Page, id: string): Locator => mainTabs(page).locator(`[role="tab"][data-tab-id="${id}"]`);
// The strip's tabs as mounted, drawn or not. Under a page the strip is invisible, and under the Settings dialog everything
// outside the dialog is hidden from accessibility, so a role query of the strip finds nothing there; an inventory of what
// the strip holds counts hidden tabs too (UX wave U7b). A tab a person clicks is found by `mainTab`.
export const mountedTabs = (page: Page): Locator => mainTabs(page).locator('[role="tab"]');
export const mountedTab = (page: Page, name: string | RegExp): Locator => mainTabs(page).getByRole('tab', { name, exact: typeof name === 'string', includeHidden: true });
export const activeMainTab = (page: Page): Locator => page.locator('[data-chrome-tabs]:has([data-focused="true"]) [data-focused="true"] [role="tab"][aria-selected="true"], [data-chrome-tabs]:not(:has([data-focused="true"])) [role="tab"][aria-selected="true"]').first();
export const sessionCards = (page: Page): Locator => page.getByRole('complementary', { name: 'Session cards', exact: true });
export const sidebarFooter = (page: Page): Locator => page.locator('[data-region="sidebar"] footer');
// UX wave U7b (O-47): usage is a ring at the title bar's own right end; a click opens the compact popover "Usage".
export const usageRing = (page: Page): Locator => page.locator('[data-toolbar] [data-usage-ring]');

// UX wave U7b (O-40; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, M8 decision 1):
// Settings is a modal dialog over the window, named "Settings"; Customize, Projects and the Artifacts library are a page
// right of the sidebar (`[data-region="page"]`), with Back and the page's name in the title bar where the strip was.
export const settingsDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Settings', exact: true });
export async function openSettings(app: ElectronApplication, page: Page): Promise<Locator> {
  await menu(app, 'settings.open');
  await expect(settingsDialog(page)).toBeVisible();
  return settingsDialog(page);
}
export const pageRegion = (page: Page): Locator => page.locator('[data-region="page"]');
export const pageTitle = (page: Page): Locator => page.locator('[data-toolbar] [data-page-title]');
export async function backToTabs(page: Page): Promise<void> {
  await pageTitle(page).getByRole('button', { name: 'Back', exact: true }).click();
  await expect(pageRegion(page)).toHaveCount(0);
}

// Destinations remain reachable when the narrow layout puts the sidebar in an overlay. Each opens a page, not a tab.
export async function openAppDestination(page: Page, name: 'Projects' | 'Artifacts' | 'Customize'): Promise<void> {
  const entry = page.getByRole('navigation', { name: 'App destinations' }).getByRole('button', { name, exact: true });
  if (await page.locator('[data-region="sidebar"]').evaluate((element) => element.hasAttribute('inert'))) await menu(applicationOf(page), 'sidebar.toggle');
  await entry.click();
  await expect(entry).toHaveAttribute('aria-current', 'page');
  await expect(pageTitle(page).getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  await expect(pageRegion(page)).toBeVisible();
  await expect(mountedTab(page, name), 'no tab of the page is mounted in the strip').toHaveCount(0);
}

const namedSurface = (page: Page, name: string) => page.locator(`[data-region="panel"]:not([inert]) [data-surface][aria-label=${JSON.stringify(name)}]`);

async function chooseSurface(page: Page, name: string): Promise<void> {
  const button = surfaceRow(page).getByRole('button', { name, exact: true });
  if (await button.count()) await button.click();
  else {
    await surfaceRow(page).getByRole('button', { name: 'More surfaces', exact: true }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  }
}

// Idempotent even when narrow chrome folds active icons into More surfaces.
export async function openSurface(page: Page, name: string): Promise<void> {
  if (!await namedSurface(page, name).count()) await chooseSurface(page, name);
  await expect(namedSurface(page, name)).toBeVisible();
}

// UX wave U8b: hiding a tool in view hides the side column and closes nothing (its tab stays in the strip, its instance
// kept), as its icon and its "Hide surface" do. A tool not in view is left as it is.
export async function hideSurface(page: Page, name: string): Promise<void> {
  if (!await namedSurface(page, name).count()) return;
  await sideColumn(page).getByRole('button', { name: 'Hide side column', exact: true }).click();
  await expect(namedSurface(page, name)).toHaveCount(0);
}

// The side column (UX wave U8b, Interfaces §C.3): one or two groups, the upper and the lower, each a strip of tabs over
// the body of its one tab in view (`[data-surface]`, named by its tool's title).
export const sideColumn = (page: Page): Locator => page.locator('[data-region="panel"]:not([inert]) [data-surface-stack]');
export const sideGroup = (page: Page, group: 'upper' | 'lower'): Locator => sideColumn(page).locator(`section[data-side-group="${group}"]`);
export const sideTab = (scope: Page | Locator, name: string | RegExp): Locator => scope.locator('[data-side-strip]').getByRole('tab', { name, exact: typeof name === 'string' });
// A group's tabs by their names as the strip draws them, in strip order.
export const sideTabNames = async (page: Page, group: 'upper' | 'lower'): Promise<string[]> =>
  sideGroup(page, group).locator('[data-side-strip] [role="tab"]').evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label') ?? tab.textContent ?? ''));

// A tab's menu (a right click on it): "Move below" from the upper group, "Move above" from the lower one.
export async function moveSideTab(page: Page, name: string, to: 'below' | 'above'): Promise<void> {
  await sideTab(sideColumn(page), name).click({ button: 'right' });
  await page.getByRole('menuitem', { name: to === 'below' ? 'Move below' : 'Move above', exact: true }).click();
}

// A tab's own close (its tool's guard runs): the tab leaves the strip and its instance goes.
export async function closeSideTab(page: Page, name: string): Promise<void> {
  const tab = sideTab(sideColumn(page), name).locator('xpath=ancestor::*[@data-tab-id][1]');
  await tab.hover();
  await tab.getByRole('button', { name: `Close ${name}`, exact: true }).click();
  await expect(tab).toHaveCount(0);
}

export async function hideSurfaces(page: Page): Promise<void> {
  // Hide the visible surfaces, retaining their tool instances. The isolated #panel page has its own real control, not the
  // product's surface controls: its visibility toggle directly collapses the harness region.
  const panel = page.locator('[data-region="panel"]:not([inert])');
  if (!await panel.count() && !await sessionCards(page).isVisible()) return;
  const harness = page.locator('[data-panel-harness]');
  if (await harness.count()) await harness.getByRole('button', { name: 'Hide panel', exact: true }).click();
  else {
    for (const name of await panel.locator('[data-surface]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')!))) await hideSurface(page, name);
    if (await sessionCards(page).isVisible()) await menu(applicationOf(page), 'panel.toggle');
  }
  await expect(panel).toHaveCount(0);
  await expect(sessionCards(page)).toBeHidden();
}

export async function showSessionCards(page: Page): Promise<Locator> {
  if (!await sessionCards(page).isVisible()) await chooseSurface(page, 'Session cards');
  await expect(sessionCards(page)).toBeVisible();
  return sessionCards(page);
}

// UX wave U8b (Interfaces §D): a card of the column by its title; Environment, Context and Connectors fold, the two cards
// for running work (Subagents, Background tasks) are drawn only while something runs and do not fold.
export const sessionCard = (page: Page, name: 'Environment' | 'Context' | 'Connectors' | 'Subagents' | 'Background tasks'): Locator => sessionCards(page).getByRole('region', { name, exact: true });

export async function unfoldSessionCard(page: Page, name: 'Environment' | 'Context' | 'Connectors'): Promise<Locator> {
  const cards = await showSessionCards(page);
  const button = cards.getByRole('button', { name: new RegExp(`^${name}(?:\\s|$)`) }).first();
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  return button.locator('xpath=ancestor::section[1]');
}

export async function pinSurfaceForSessions(page: Page, name: string, pinned = true): Promise<void> {
  await openSurface(page, name);
  const icon = surfaceRow(page).getByRole('button', { name, exact: true });
  if (await icon.count()) await icon.click({ button: 'right' });
  else {
    await surfaceRow(page).getByRole('button', { name: 'More surfaces', exact: true }).click();
    const entry = page.getByRole('menuitem', { name, exact: true });
    await entry.focus();
    await entry.press('Shift+F10');
  }
  const action = page.getByRole('menuitem', { name: pinned ? 'Keep open for every session' : 'Keep with this session only', exact: true });
  if (await action.count()) await action.click();
  else {
    await expect(page.getByRole('menuitem', { name: pinned ? 'Keep with this session only' : 'Keep open for every session', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  }
}

export async function openArtifactInPanel(page: Page, artifactId: string): Promise<Locator> {
  const library = page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true });
  if (!await library.isVisible()) await menu(applicationOf(page), 'sidebar.toggle');
  await library.click();
  await page.locator(`[data-library] article[data-artifact-row="${artifactId}"]`).click();
  return moveMainArtifactToPanel(page, artifactId);
}

// Replica tests deliberately keep a main editor while opening an independent panel editor through the retained list.
export async function openArtifactReplicaInPanel(page: Page, artifactId: string): Promise<Locator> {
  const selected = activeMainTab(page);
  const prior = await selected.count() ? await selected.getAttribute('data-tab-id') : null;
  const record = await openArtifactInPanel(page, artifactId);
  await pinSurfaceForSessions(page, 'Artifacts');
  await record.getByRole('button', { name: 'Move to tab', exact: true }).click();
  await openSurface(page, 'Artifacts');
  const list = surface(page, 'artifacts').locator('[data-artifacts-list]');
  await list.getByRole('button', { name: 'All', exact: true }).click();
  await list.locator(`[data-artifact-row][data-artifact-id="${artifactId}"]`).click();
  await expect(record).toBeVisible();
  if (prior && prior !== `artifact:${await localRef(page)}:${artifactId}` && await mainTabById(page, prior).count()) await mainTabById(page, prior).click();
  return record;
}

// The old Artifacts launcher is the project Library card now. Record editors still move into a surface through X38.
export async function moveMainArtifactToPanel(page: Page, artifactId: string): Promise<Locator> {
  await mainTabById(page, `artifact:${await localRef(page)}:${artifactId}`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to side surface', exact: true }).click();
  const record = surface(page, 'artifacts').locator(`[data-artifact-record="${artifactId}"]`);
  await expect(record).toBeVisible();
  return record;
}
