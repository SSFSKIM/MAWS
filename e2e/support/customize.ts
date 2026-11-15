// The Customize page as a scene reaches it (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §D):
// the view, My items | Discover (the radio group "Library"), and the kind, "Show: All · Plugins · Skills · Connectors"
// (the radio group "Show"), both in the page's head; what a kind draws and the head's tools are found in the page itself,
// which stands in the page's region. The sidebar's Customize row and Settings' "Customize ›" open My items, All.
import { expect, type Locator, type Page } from '@playwright/test';
import { pageRegion } from './shell';

export type CustomizeView = 'My items' | 'Discover';
export type CustomizeShow = 'All' | 'Plugins' | 'Skills' | 'Connectors';

const VIEW_KEY: Record<CustomizeView, string> = { 'My items': 'mine', Discover: 'discover' };
const SHOW_KEY: Record<CustomizeShow, string> = { All: 'all', Plugins: 'plugins', Skills: 'skills', Connectors: 'connectors' };

export const customizePage = (page: Page): Locator => pageRegion(page).locator('[data-customize-page]');
export const customizeHead = (page: Page): Locator => customizePage(page).locator('[data-customize-header]');
export const viewChoice = (page: Page, view: CustomizeView): Locator => customizeHead(page).getByRole('radiogroup', { name: 'Library', exact: true }).getByRole('radio', { name: view, exact: true });
export const showChoice = (page: Page, show: CustomizeShow): Locator => customizeHead(page).getByRole('radiogroup', { name: 'Show', exact: true }).getByRole('radio', { name: show, exact: true });

/** Press the view, then the Show value, and wait until the page is there. Pressing the one shown returns a detail to its list. */
export async function chooseCustomize(page: Page, where: { view?: CustomizeView; show?: CustomizeShow }): Promise<void> {
  if (where.view) await viewChoice(page, where.view).click();
  if (where.show) await showChoice(page, where.show).click();
  if (where.view) await expect(customizePage(page)).toHaveAttribute('data-customize-view', VIEW_KEY[where.view]);
  if (where.show) await expect(customizePage(page)).toHaveAttribute('data-customize-show', SHOW_KEY[where.show]);
}
