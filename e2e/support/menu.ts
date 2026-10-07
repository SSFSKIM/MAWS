// A menu item of the application menu clicked by its id in main (lifted from e2e/palette.spec.ts for E4a's browser spec):
// a menu accelerator such as ⌘K cannot be fired through Playwright's CDP keys, which reach the page and never the menu.
import { expect, type ElectronApplication } from '@playwright/test';

export async function menu(app: ElectronApplication, id: string): Promise<void> {
  const clicked = await app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item?.enabled) return false;
    item.click();
    return true;
  }, id);
  expect(clicked, `menu item ${id} exists and is enabled`).toBe(true);
}
