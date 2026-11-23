// The empty main area after the word cut (W22, W23): no sentence is drawn; the pane's tabpanel is named "No open tabs"
// for a screen reader, and the area draws its two ways in, Overview (its chord in its tooltip and description) and New
// chat. A check that read the words as text now reads the named tabpanel, and that the words left the screen.
import { expect, type Locator, type Page } from '@playwright/test';

export const emptyPane = (scope: Page | Locator): Locator => scope.getByRole('tabpanel', { name: 'No open tabs', exact: true });

/** The empty main area is the one shown in `scope`: the named tabpanel, its ways in drawn, its words not. */
export async function expectEmptyPane(scope: Page | Locator, options?: { timeout?: number; message?: string }): Promise<void> {
  const panel = emptyPane(scope);
  await expect(panel, options?.message).toBeVisible({ timeout: options?.timeout });
  const drawn = panel.locator('[data-empty-pane]');
  await expect(drawn, options?.message).toBeVisible();
  await expect(drawn, 'W22: the words are the tabpanel’s name, not drawn').not.toContainText('No open tabs');
  const overview = drawn.getByRole('button', { name: 'Overview', exact: true });
  await expect(overview, 'W23: the button reads its word alone').toHaveText('Overview');
  await expect(drawn.getByRole('button', { name: 'New chat', exact: true })).toBeVisible();
}

/** W23: the empty area's Overview carries its chord as its description (and as the tooltip focus opens). */
export const emptyPaneOverview = (scope: Page | Locator): Locator => emptyPane(scope).locator('[data-empty-pane]').getByRole('button', { name: 'Overview', exact: true });
