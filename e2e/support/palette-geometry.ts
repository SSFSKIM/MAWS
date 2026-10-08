// E11 F2b (plan 2.1; the owner: "typed '/' -- the whole page goes down"): the `/` palette of the focused main pane's
// composer opens above the editor, inside the window, and opening it, walking its rows past the fold, filtering it and
// closing it move nothing else: the composer frame, the sidebar and its footer keep their boxes, and the window, the
// document, the body and #root never scroll. The list scrolls itself. The composer's editor must be empty.
import { expect, type Page } from '@playwright/test';

export async function slashPaletteMovesNothing(page: Page, where: string): Promise<void> {
  const editor = page.locator('[data-region="main"]').getByRole('textbox', { name: 'Message' });
  const commands = page.getByRole('listbox', { name: 'Commands' });
  const geometry = () =>
    page.evaluate(() => {
      const box = (el: Element | null | undefined) => {
        const r = el!.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height].map((n) => Math.round(n));
      };
      const sidebar = document.querySelector('[data-region="sidebar"]');
      return {
        composer: box(document.querySelector('[data-region="main"] [data-composer-frame]')),
        sidebar: box(sidebar),
        sidebarFooter: box(sidebar?.querySelector('footer')),
        scroll: [window.scrollY, document.scrollingElement!.scrollTop, document.body.scrollTop, document.getElementById('root')!.scrollTop],
      };
    });
  const placed = async () => {
    const list = (await commands.boundingBox())!;
    const field = (await editor.boundingBox())!;
    expect(list.y, `${where}: the list starts inside the window`).toBeGreaterThanOrEqual(0);
    expect(list.y + list.height, `${where}: the list ends above the editor`).toBeLessThanOrEqual(field.y + 1);
  };

  await editor.click();
  const before = await geometry();
  expect(before.scroll, where).toEqual([0, 0, 0, 0]);

  await page.keyboard.type('/');
  await expect(commands).toBeVisible();
  expect(await geometry(), `${where}: opening moves nothing`).toEqual(before);
  await placed();

  // walk to the last row, past the fold: the list scrolls, nothing else does
  const rows = await commands.getByRole('option').count();
  for (let i = 0; i < rows - 1; i++) await page.keyboard.press('ArrowDown');
  await expect.poll(() => commands.evaluate((el) => el.scrollTop), { message: `${where}: the list scrolled itself` }).toBeGreaterThan(0);
  await expect(commands.locator('[role="option"][aria-selected="true"]')).toBeInViewport();
  expect(await geometry(), `${where}: navigating moves nothing`).toEqual(before);

  // filter, then clear the filter: the list shrinks and grows against the caret, the page stays
  await page.keyboard.type('se');
  await expect(commands.getByRole('option').first()).toBeVisible();
  expect(await geometry(), `${where}: filtering moves nothing`).toEqual(before);
  await placed();
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(commands).toBeVisible();
  expect(await geometry(), `${where}: unfiltering moves nothing`).toEqual(before);
  await placed();

  await page.keyboard.press('Escape');
  await expect(commands).toBeHidden();
  expect(await geometry(), `${where}: closing moves nothing`).toEqual(before);
  await page.keyboard.press('Backspace'); // the "/" left in the editor
  await expect(editor).toHaveText('');
}
