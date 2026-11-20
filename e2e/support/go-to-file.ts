// UX wave U6b-3b (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, M3 decision 4): Go ▸ Go to file as the
// scenes reach it. `goToFileRow` reads the application menu's row by id (its enabled state and its accelerator, null with
// no such row); `goToFile` waits on the row being enabled with ⌘P, then clicks it by `menu`'s own click, which is what
// its accelerator does (a menu accelerator cannot be fired through Playwright's keys, which reach the page).
import { expect, type ElectronApplication } from '@playwright/test';
import { menu } from './menu';

export const goToFileRow = (app: ElectronApplication): Promise<{ enabled: boolean; accelerator: string | null } | null> =>
  app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('files.goToFile');
    return item ? { enabled: item.enabled, accelerator: item.accelerator ?? null } : null;
  });

export async function goToFile(app: ElectronApplication): Promise<void> {
  await expect.poll(() => goToFileRow(app), { message: 'Go ▸ Go to file, enabled, with ⌘P' }).toEqual({ enabled: true, accelerator: 'Cmd+P' });
  await menu(app, 'files.goToFile');
}
