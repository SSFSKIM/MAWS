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
import { scene, show } from './support/maws-tools'; // UX wave U6b-5a

const SHELL_ENV = { MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/nine-sessions.json', MAWS_SCENARIO_CLOCK: 'manual' };
const PROJECTS = ['codex_somersault', 'claude-usage-menubar', 'MAWS'];

let maws: MawsLaunch;
test.beforeAll(async () => {
  maws = await launchMaws({ env: SHELL_ENV });
  await expect(maws.page.locator('[data-region="sidebar"] [data-kind="project"]')).toHaveCount(4, { timeout: 15_000 }); // the machine's own row is one (P5 O6 M5)
});
test.afterAll(async () => maws.cleanup());

const focused = (page: Page) =>
  page.evaluate(() => ({ kind: document.activeElement?.getAttribute('data-kind') ?? null, row: document.activeElement?.getAttribute('aria-label') ?? null }));

// Focus a sidebar row (a focused element for the dialog to return to), then reveal the project from the palette with
// the keyboard: its name, the arrows down to the project's row, ⏎. UX wave U6b-5a (docs/doperpowers/plans/2026-11-17-
// ux-wave-U6b-5-rest-of-keyboard.md, §I; Decision Logs 15 and 19): End no longer lands on the project, since the last row
// is "Search the Library for …", and the selection follows the first row until a key moves it; the row is picked by its
// value (`project:<id>`, read from the drawn option) and reached by ArrowDown, each press waited on the selection moving.
// `beforeEnter` runs once the row is selected, just before ⏎ (the second case's frame patch, which must cover the close).
async function reveal(page: Page, app: ElectronApplication, project: string, beforeEnter?: () => Promise<void>): Promise<void> {
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await page.locator('[data-region="sidebar"] [role="treeitem"]').first().focus();
  await menu(app, 'palette.open');
  await expect(palette).toBeVisible();
  // Under load the first keystrokes can land before the input takes focus; type only once it holds it.
  await expect(palette.getByPlaceholder('Search sessions, projects and actions')).toBeFocused();
  await page.keyboard.type(project);
  const row = palette.getByRole('group', { name: 'Projects' }).getByRole('option', { name: project });
  await expect(row).toBeVisible();
  const value = await row.getAttribute('data-value');
  expect(value, `${project}'s row is a project's`).toMatch(/^project:/);
  const selected = palette.locator('[cmdk-item][aria-selected="true"]');
  for (let presses = 0; (await selected.getAttribute('data-value')) !== value; presses++) {
    if (presses > 50) throw new Error(`${project}'s row was not reached by ArrowDown`);
    const from = await selected.getAttribute('data-value');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => selected.getAttribute('data-value'), { message: 'ArrowDown moves the selection' }).not.toBe(from);
  }
  await expect(palette.locator(`[cmdk-item][data-value="${value}"]`)).toHaveAttribute('aria-selected', 'true');
  await beforeEnter?.();
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
}

// Every zero-delay timer queued before this call has run (the one queued here runs after them): the dialog's restore
// among them, queued as the palette closed.
const timersRun = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const framesRun = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

// The row takes focus, and still holds it once the close's timers and two frames after them have run. `afterTimers`
// runs between the two (the second case takes its frame order out there).
async function expectRowKeepsFocus(page: Page, project: string, afterTimers?: () => Promise<void>): Promise<void> {
  await expect.poll(() => focused(page)).toEqual({ kind: 'project', row: project });
  await timersRun(page);
  await afterTimers?.();
  await framesRun(page);
  expect(await focused(page), `${project}'s row still holds focus`).toEqual({ kind: 'project', row: project });
}

type ForcedWindow = { __forcedFrames?: { ran: number; original: typeof requestAnimationFrame } };

// The order the loss would need: every frame callback asked for runs at once (a microtask), ahead of any timer.
const forceFrames = (page: Page) =>
  page.evaluate(() => {
    const forced = { ran: 0, original: window.requestAnimationFrame };
    window.requestAnimationFrame = (callback) => {
      queueMicrotask(() => {
        forced.ran++;
        callback(performance.now());
      });
      return 0;
    };
    (window as unknown as ForcedWindow).__forcedFrames = forced;
  });

// The browser's frames back; answers how many callbacks ran in the forced order.
const unforceFrames = (page: Page) =>
  page.evaluate(() => {
    const win = window as unknown as ForcedWindow;
    const forced = win.__forcedFrames!;
    window.requestAnimationFrame = forced.original;
    delete win.__forcedFrames;
    return forced.ran;
  });

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
    // forced once the project's row is selected, so it covers the ⏎ and the dialog's close, and taken out once the
    // close's timers have run; a frame of the close ran in the forced order, or the case tested nothing
    await reveal(page, app, project, () => forceFrames(page));
    await expectRowKeepsFocus(page, project, async () => {
      expect(await unforceFrames(page), 'a frame of the close ran in the forced order').toBeGreaterThan(0);
    });
  }
});

// UX wave U6b-5a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md, §I; B6): an artifact found by its
// title in ⌘K opens beside the chat of the session on screen. The product over an indexed session (replay transport, its
// own launch), an HTML artifact made through the bridge with an invented title. The scene waits on the Artifacts group's
// option for the typed title, which is drawn only once this Mac's `library.list` has answered, and on it being the
// selected row (the selection follows the first row until a key moves it); then on the side column's Artifacts tab
// showing the artifact.
test('an artifact found by its title opens beside the chat', async () => {
  await scene({ titles: ['Harbour survey'], label: 'u6b5-palette' }, async (s) => {
    const [id] = s.ids;
    await show(s, id!);
    const made = await s.page.evaluate(
      ([title, html]) => window.maws.invoke('artifacts.create', { kind: 'html', title, content: { bytes: new TextEncoder().encode(html), name: 'index.html' } }),
      ['Quarterly lighthouse notes', '<!doctype html><title>Quarterly lighthouse notes</title><p>Invented notes on a lighthouse.</p>'] as const,
    );
    if (!made.ok) throw new Error(`artifacts.create: ${made.error.code} ${made.error.message}`);
    const artifactId = made.value.artifact.id;

    const palette = s.page.getByRole('dialog', { name: 'Command palette' });
    await menu(s.maws.app, 'palette.open');
    await expect(palette.getByPlaceholder('Search sessions, projects and actions')).toBeFocused();
    await s.page.keyboard.type('lighthouse');
    const row = palette.getByRole('group', { name: 'Artifacts' }).getByRole('option', { name: /Quarterly lighthouse notes/ });
    await expect(row, 'the artifact listed under Artifacts once this Mac answered').toBeVisible({ timeout: 15_000 });
    await expect(row, 'the first row, selected').toHaveAttribute('aria-selected', 'true');
    await s.page.keyboard.press('Enter');
    await expect(palette).toHaveCount(0);
    await expect(s.panel.locator(`[data-surface="artifacts"] [data-artifact-record="${artifactId}"]`), 'the artifact beside the chat').toBeVisible({ timeout: 15_000 });
  });
});
