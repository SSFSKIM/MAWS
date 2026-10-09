// E11 F2b (plan 2.1; the owner: "typed '/' -- the whole page goes down"): the `/` palette of the focused main pane's
// composer opens above the editor, inside the window, and opening it, walking its rows past the fold, filtering it and
// closing it move nothing else: the composer frame, the sidebar and its footer keep their boxes, and the window, the
// document, the body, #root and every box holding the composer or the sidebar never scroll, not even for a moment (F2b
// review 3: the old palette's row reveal scrolled the page while the popup was still in the document's flow, and the
// page snapped back once it was placed, so offsets read after each step never saw it). The list scrolls itself. The
// composer's editor must be empty.
import { expect, type Page } from '@playwright/test';

type Watched = Window & { paletteScrolls?: string[] };

export async function slashPaletteMovesNothing(page: Page, where: string): Promise<void> {
  const editor = page.locator('[data-region="main"]').getByRole('textbox', { name: 'Message' });
  const commands = page.getByRole('listbox', { name: 'Commands' });
  // every scroll of the document or a box holding the composer or the sidebar, as it happens (scroll events do not
  // bubble, so the listener captures)
  const watchScrolls = () =>
    page.evaluate(() => {
      const held = new Set<EventTarget>([document]);
      for (const start of [document.querySelector('[data-region="main"] [data-composer-frame]'), document.querySelector('[data-region="sidebar"]')]) {
        for (let el = start; el; el = el.parentElement) held.add(el);
      }
      const scrolls: string[] = [];
      (window as Watched).paletteScrolls = scrolls;
      const name = (target: EventTarget) => (target instanceof Element ? `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}${target.getAttribute('data-region') ? `[${target.getAttribute('data-region')}]` : ''}` : 'document');
      document.addEventListener('scroll', (event) => event.target && held.has(event.target) && scrolls.push(name(event.target)), { capture: true });
    });
  const geometry = () =>
    page.evaluate(async () => {
      await new Promise((frame) => requestAnimationFrame(() => requestAnimationFrame(frame))); // scroll events fire at a frame
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
        scrolledSinceLastLook: (window as Watched).paletteScrolls!.splice(0),
      };
    });
  const placed = async () => {
    const list = (await commands.boundingBox())!;
    const field = (await editor.boundingBox())!;
    expect(list.y, `${where}: the list starts inside the window`).toBeGreaterThanOrEqual(0);
    expect(list.y + list.height, `${where}: the list ends above the editor`).toBeLessThanOrEqual(field.y + 1);
  };

  await editor.click();
  await watchScrolls();
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
