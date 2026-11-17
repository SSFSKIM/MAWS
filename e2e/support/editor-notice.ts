// UX wave U1c: the editor's notice check that code-editor.spec.ts and sessions.spec.ts share.
import { expect, type Locator, type Page } from '@playwright/test';
import { resizePanel } from './toolbar-controls';

// The editor's notice drawn whole (the architect's hands-on check: the bar can shrink its span to nothing): visible, and
// its text not cut, the notice's needed and given widths and its bar's width in the failure message
export async function expectDrawnWhole(notice: Locator, where: string): Promise<void> {
  await expect(notice, where).toBeVisible();
  const widths = await notice.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, bar: el.closest('[data-editor-controls]')?.parentElement?.clientWidth ?? null }));
  expect(widths.scrollWidth, `${where}: the notice needs ${widths.scrollWidth} px, has ${widths.clientWidth}, in a bar of ${widths.bar}`).toBeLessThanOrEqual(widths.clientWidth);
}
// The same at the width the scene has, then with the right panel holding the file at its narrowest (its divider's
// minimum, through `resizePanel`), the panel's width restored after
export async function expectDrawnWholeAtBothWidths(page: Page, notice: Locator): Promise<void> {
  await expectDrawnWhole(notice, 'at the width the scene has');
  const divider = page.locator('[data-region="panel"]').getByRole('separator', { name: 'Resize right panel' });
  const [before, narrowest] = [Number(await divider.getAttribute('aria-valuenow')), Number(await divider.getAttribute('aria-valuemin'))];
  await resizePanel(page, narrowest);
  await expectDrawnWhole(notice, `with the panel at its narrowest, ${narrowest} px`);
  await resizePanel(page, before);
}
