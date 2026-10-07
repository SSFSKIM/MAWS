// The ⌘K palette's "reveal project" keeps the focus it gives the project's row in the sidebar (C11 M1 refresh task;
// closes the C5 row of the tech-debt tracker, 2026-09-28, as not reproducible; W11: the reveal expands the project in
// place and focuses its row). A closing Radix FocusScope would return focus to the element focused before it opened in
// a zero-delay timer, which could land after the reveal. It does not here: Radix's modal Dialog prevents the scope's restore and
// focuses its Trigger instead, and the palette has no Trigger (it opens from the action table), so nothing takes focus
// back. The first case leaves the timing to the browser; the second forces the order the loss would need (every frame
// at once, ahead of any timer). Both pin the row's focus, so a Trigger or a focus restore added later fails here.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchMaws, type MawsLaunch } from './support/launch';
import { menu } from './support/menu';

const SHELL_ENV = { MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/nine-sessions.json', MAWS_SCENARIO_CLOCK: 'manual' };
const PROJECTS = ['codex_somersault', 'claude-usage-menubar', 'MAWS'];

let maws: MawsLaunch;
test.beforeAll(async () => {
  maws = await launchMaws({ env: SHELL_ENV });
  await expect(maws.page.locator('[data-region="sidebar"] [data-kind="project"]')).toHaveCount(4, { timeout: 15_000 }); // Other sessions is a row
});
test.afterAll(async () => maws.cleanup());

const focused = (page: Page) =>
  page.evaluate(() => ({ kind: document.activeElement?.getAttribute('data-kind') ?? null, row: document.activeElement?.getAttribute('aria-label') ?? null }));

// Focus a sidebar row (a focused element for the dialog to return to), then reveal the project from the palette with
// the keyboard: its name, End (the last option: Projects follows Sessions, and no action title holds a project name), ⏎.
async function reveal(page: Page, app: ElectronApplication, project: string): Promise<void> {
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await page.locator('[data-region="sidebar"] [role="treeitem"]').first().focus();
  await menu(app, 'palette.open');
  await expect(palette).toBeVisible();
  // Under load the first keystrokes can land before the input takes focus; type only once it holds it.
  await expect(palette.getByPlaceholder('Search sessions, projects and actions')).toBeFocused();
  await page.keyboard.type(project);
  await expect(palette.getByRole('group', { name: 'Projects' }).getByRole('option', { name: project })).toBeVisible();
  await page.keyboard.press('End');
  await expect(palette.getByRole('group', { name: 'Projects' }).getByRole('option', { name: project })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
}

async function expectRowKeepsFocus(page: Page, project: string): Promise<void> {
  await expect.poll(() => focused(page)).toEqual({ kind: 'project', row: project });
  await page.waitForTimeout(250); // past the dialog's restore and a few frames
  expect(await focused(page), `${project}'s row still holds focus`).toEqual({ kind: 'project', row: project });
}

test('palette reveal project: the row keeps focus as the browser orders the frame and the dialog restore', async () => {
  const { page, app } = maws;
  for (let round = 0; round < 3; round++) {
    for (const project of PROJECTS) {
      await reveal(page, app, project);
      await expectRowKeepsFocus(page, project);
    }
  }
});

test('palette reveal project: the row keeps focus when a frame runs before the dialog restores focus', async () => {
  const { page, app } = maws;
  for (const project of PROJECTS) {
    // Every frame callback asked for in the next half second runs at once (a microtask), ahead of any timer.
    await page.evaluate(() => {
      const original = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => {
        queueMicrotask(() => callback(performance.now()));
        return 0;
      };
      setTimeout(() => (window.requestAnimationFrame = original), 500);
    });
    await reveal(page, app, project);
    await expectRowKeepsFocus(page, project);
    await page.waitForTimeout(300); // the frame patch expires before the next round
  }
});
