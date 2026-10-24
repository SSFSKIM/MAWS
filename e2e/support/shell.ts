// Shell navigation only. Tests keep their assertions about the feature itself at the call site;
// chrome placement and the route to an optional surface belong here.
import { expect, type Locator, type Page } from '@playwright/test';
import { applicationOf } from './launch';
import { menu } from './menu';

export const surfaceRow = (page: Page): Locator => page.locator('[data-surface-row][role="toolbar"]');
export const surface = (page: Page, toolId: string): Locator => page.locator(`[data-surface="${toolId}"]`);
export const mainTabs = (page: Page): Locator => page.locator('[data-chrome-tabs]');
export const mainTab = (page: Page, name: string | RegExp): Locator => mainTabs(page).getByRole('tab', { name, exact: typeof name === 'string' });
export const mainTabById = (page: Page, id: string): Locator => mainTabs(page).locator(`[role="tab"][data-tab-id="${id}"]`);
export const activeMainTab = (page: Page): Locator => page.locator('[data-chrome-tabs]:has([data-focused="true"]) [data-focused="true"] [role="tab"][aria-selected="true"], [data-chrome-tabs]:not(:has([data-focused="true"])) [role="tab"][aria-selected="true"]').first();
export const sessionCards = (page: Page): Locator => page.getByRole('complementary', { name: 'Session cards', exact: true });
export const sidebarFooter = (page: Page): Locator => page.locator('[data-region="sidebar"] footer');
export const usagePill = (page: Page): Locator => sidebarFooter(page).locator('[data-usage-pill]');

// Destinations remain reachable when the narrow layout puts the sidebar in an overlay.
export async function openAppDestination(page: Page, name: 'Projects' | 'Artifacts' | 'Customize'): Promise<void> {
  const entry = page.getByRole('navigation', { name: 'App destinations' }).getByRole('button', { name, exact: true });
  if (await page.locator('[data-region="sidebar"]').evaluate((element) => element.hasAttribute('inert'))) await menu(applicationOf(page), 'sidebar.toggle');
  await entry.click();
  await expect(mainTab(page, new RegExp(name))).toHaveAttribute('aria-selected', 'true');
}

const namedSurface = (page: Page, name: string) => page.locator(`[data-region="panel"]:not([inert]) [data-surface][aria-label=${JSON.stringify(name)}]`);

async function chooseSurface(page: Page, name: string): Promise<void> {
  const button = surfaceRow(page).getByRole('button', { name, exact: true });
  if (await button.count()) await button.click();
  else {
    await surfaceRow(page).getByRole('button', { name: 'More surfaces', exact: true }).click();
    const normal = page.getByRole('menuitem', { name, exact: true });
    const entry = name === 'Artifacts' && !await normal.count() ? page.getByRole('menuitem', { name: 'Open saved artifact', exact: true }) : normal;
    await entry.click();
  }
}

// Idempotent even when narrow chrome folds active icons into More surfaces.
export async function openSurface(page: Page, name: string): Promise<void> {
  if (!await namedSurface(page, name).count()) await chooseSurface(page, name);
  await expect(namedSurface(page, name)).toBeVisible();
}

export async function closeSurface(page: Page, name: string): Promise<void> {
  const shown = namedSurface(page, name);
  if (await shown.count()) await shown.getByRole('button', { name: 'Close surface', exact: true }).click();
}

export async function hideSurfaces(page: Page): Promise<void> {
  // Hide the visible surfaces, retaining their tool instances. The isolated #panel page has its own real control, not the
  // product's surface controls: its visibility toggle directly collapses the harness region.
  const panel = page.locator('[data-region="panel"]:not([inert])');
  if (!await panel.count() && !await sessionCards(page).isVisible()) return;
  const harness = page.locator('[data-panel-harness]');
  if (await harness.count()) await harness.getByRole('button', { name: 'Hide panel', exact: true }).click();
  else {
    for (const name of await panel.locator('[data-surface]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')!))) await closeSurface(page, name);
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

export async function unfoldSessionCard(page: Page, name: 'Environment' | 'Context' | 'Connectors' | 'Artifacts'): Promise<Locator> {
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
    const normal = page.getByRole('menuitem', { name, exact: true });
    const entry = name === 'Artifacts' && !await normal.count() ? page.getByRole('menuitem', { name: 'Open saved artifact', exact: true }) : normal;
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
  if (prior && prior !== `artifact:${artifactId}` && await mainTabById(page, prior).count()) await mainTabById(page, prior).click();
  return record;
}

// The old Artifacts launcher is the project Library card now. Record editors still move into a surface through X38.
export async function moveMainArtifactToPanel(page: Page, artifactId: string): Promise<Locator> {
  await mainTabById(page, `artifact:${artifactId}`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to side surface', exact: true }).click();
  const record = surface(page, 'artifacts').locator(`[data-artifact-record="${artifactId}"]`);
  await expect(record).toBeVisible();
  return record;
}
