// C11's mockup checklist (C11 execution document, M6 and Acceptance item 4): screenshots of C11's surfaces in the light
// and dark themes, saved under docs/doperpowers/plans/shots/c11-*.png, and the mockups they answer to rendered in the
// same Electron beside them (mockup 06 vignettes 01, 03, 04 and 05, mockup 04 vignette 4) into a scratch directory for
// the comparison, not the repository. The widgets and Session info are taken on the `#widgets` harness page over the
// fixture-backed widget backend (the scenario's routed Sonnet session in auto mode); the Accounts and Settings tabs in
// the product shell over C5's scenario and the committed ClaudeUsage fixture moved to now (accounts.spec.ts's recipe).
// Nothing here asserts a look: it drives each state to where the mockup shows it and photographs it. Run on purpose only:
//   MAWS_HARNESS=1 pnpm exec electron-vite build && MAWS_C11_SHOTS=1 pnpm exec playwright test e2e/c11-shots.spec.ts
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { WidgetsHarnessApi } from '../src/renderer/src/harness/widgets/api';
import { invoke, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT } from './support/launch';

test.skip(process.env.MAWS_C11_SHOTS !== '1', 'the mockup screenshots run only under MAWS_C11_SHOTS=1');
test.skip(!existsSync(join(REPO_ROOT, 'out/renderer/harness.html')), 'the screenshots need a harness build');

const SHOTS = join(REPO_ROOT, 'docs/doperpowers/plans/shots');
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
const READY = 'app-7412a115'; // the scenario's routed Sonnet session, effective auto

let scratch: string;
let usage: string;

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
  scratch = realpathSync(mkdtempSync('/tmp/maws-c11-shots-'));
  usage = join(scratch, 'claude-usage');
  cpSync(join(REPO_ROOT, 'test/fixtures/claude-usage'), usage, { recursive: true });
  const history = join(usage, 'history');
  const files = readdirSync(history).map((name) => join(history, name));
  const rows = (file: string) => readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  const newest = Math.max(...files.flatMap((file) => rows(file).map((row) => Date.parse(row.recordedAt as string))));
  const offset = Date.now() - 2 * 60_000 - newest;
  const shift = (at: unknown) => new Date(Date.parse(at as string) + offset).toISOString().replace('.000Z', 'Z');
  for (const file of files) writeFileSync(file, rows(file).map((row) => JSON.stringify({ ...row, recordedAt: shift(row.recordedAt), resetsAt: shift(row.resetsAt) })).join('\n') + '\n');
});
test.afterAll(() => {
  if (process.env.MAWS_C11_SHOTS_KEEP !== '1') rmSync(scratch, { recursive: true, force: true });
});

async function setTheme(page: Page, theme: Theme, harness: boolean) {
  if (harness) await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
  else value(await invoke(page, 'settings.set', { theme }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.waitForTimeout(150);
}
async function shoot(page: Page, name: string, harness: boolean) {
  const toasts = page.getByRole('region', { name: /^Notifications/ }).getByRole('button', { name: 'Dismiss' });
  while ((await toasts.count()) > 0) await toasts.first().click();
  for (const theme of THEMES) {
    await setTheme(page, theme, harness);
    await page.screenshot({ path: join(SHOTS, `c11-${name}-${theme}.png`) });
  }
  await setTheme(page, 'light', harness);
}

async function menu(app: ElectronApplication, id: string): Promise<void> {
  const click = () =>
    app.evaluate(({ Menu }, id) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      if (!item?.enabled) return false;
      item.click();
      return true;
    }, id);
  await expect.poll(click, { message: `menu item ${id} exists and is enabled` }).toBe(true);
}

test('the widgets and Session info on the #widgets harness page', async () => {
  test.setTimeout(180_000);
  const maws = await launchMaws({ env: { MAWS_HARNESS: '1', MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/nine-sessions.json', MAWS_SCENARIO_CLOCK: 'manual', MAWS_WIDGET_BACKEND: 'fixtures' } });
  const { page } = maws;
  try {
    await page.setViewportSize({ width: 1400, height: 900 }).catch(() => undefined);
    await page.evaluate(() => (location.hash = 'widgets'));
    await page.waitForFunction(() => (window as unknown as { __maws_widgets?: WidgetsHarnessApi }).__maws_widgets !== undefined);
    await page.evaluate((id) => (window as unknown as { __maws_widgets: WidgetsHarnessApi }).__maws_widgets.show({ appSessionId: id, mode: 'interactive' }), READY);
    const message = page.getByRole('textbox', { name: 'Message' });
    await expect(message).toBeVisible();
    await expect(page.locator(`[data-session-info="${READY}"]`)).toBeVisible();

    // mockup 06 vignette 05: the palette, then the permissions widget it opens
    await message.click();
    await page.keyboard.type('/per');
    await expect(page.getByRole('listbox', { name: 'Commands' })).toBeVisible();
    await shoot(page, 'palette', true);
    await page.keyboard.press('Enter');
    const permissions = page.locator('[data-widget="permissions"]');
    await expect(permissions).toBeVisible();
    await expect(permissions).not.toContainText('Reading');
    await shoot(page, 'permissions-widget', true);
    await page.keyboard.press('Escape');

    // mockup 04 vignette 4 and mockup 06 vignette 03: the model widget with a gateway model chosen, its note, and
    // Session info beside it with the lane the session would take on it
    await message.click();
    await page.keyboard.type('/model');
    await page.keyboard.press('Enter');
    const model = page.locator('[data-widget="model"]');
    await expect(model).toBeVisible();
    await model.getByRole('radio', { name: /^astra/ }).click();
    const note = model.getByText('Auto-mode reviews for this model run locally', { exact: false });
    await note.scrollIntoViewIfNeeded(); // the body scrolls inside its 420 px cap; the mockup shows the note
    await shoot(page, 'model-widget', true);
    await page.keyboard.press('Escape');
    await page.evaluate((id) => (window as unknown as { __maws_widgets: WidgetsHarnessApi }).__maws_widgets.control('setModel', { appSessionId: id, model: 'claude/astra' }), READY);
    await expect(page.locator(`[data-session-info="${READY}"]`)).toContainText('Local (expected)');
    // the tool scrolls inside its panel: its top, then its bottom
    const info = page.locator(`[data-session-info="${READY}"]`);
    for (const theme of THEMES) {
      await setTheme(page, theme, true);
      await info.evaluate((el) => (el.scrollTop = 0));
      await info.screenshot({ path: join(SHOTS, `c11-session-info-${theme}.png`) });
      await info.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await info.screenshot({ path: join(SHOTS, `c11-session-info-lower-${theme}.png`) });
    }
  } finally {
    await maws.cleanup();
  }
});

test('the Accounts and Settings tabs in the product shell', async () => {
  test.setTimeout(180_000);
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/nine-sessions.json', MAWS_SCENARIO_CLOCK: 'manual', MAWS_CLAUDE_USAGE_DIR: usage } });
  const { app, page } = maws;
  try {
    await expect(page.locator('[data-region="main"]')).toBeVisible();
    await page.getByRole('button', { name: 'Hide right panel' }).click(); // the tabs at the mockup's width: the right panel closed
    await menu(app, 'accounts.open');
    const panel = page.locator('[data-region="main"]').getByRole('tabpanel');
    await expect(panel.locator('[data-account]')).toHaveCount(5);
    await shoot(page, 'accounts', false);
    await menu(app, 'settings.open');
    await expect(page.locator('[data-region="main"]').getByRole('tab', { name: /Settings/ })).toBeVisible();
    const hide = page.getByRole('button', { name: 'Hide right panel' });
    if (await hide.isVisible()) await hide.click(); // a new tab opens with the panel; the mockup has none
    await shoot(page, 'settings', false);
    for (const section of ['Keyboard', 'Notifications']) {
      await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section, exact: true }).click();
      await page.waitForTimeout(300);
      await shoot(page, `settings-${section.toLowerCase()}`, false);
    }
  } finally {
    await maws.cleanup();
  }
});

// The mockups, in a window of the same Electron, one crop per vignette and theme, for the side-by-side comparison.
test('the mockups the screenshots answer to', async () => {
  test.setTimeout(120_000);
  const out = join(scratch, 'mockups');
  mkdirSync(out, { recursive: true });
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0' } });
  const { app } = maws;
  try {
    const vignettes: [string, string][] = [['06-accounts.html', 'accounts'], ['06-accounts.html', 'session-info'], ['06-accounts.html', 'settings'], ['06-accounts.html', 'permissions-widget'], ['04-attention.html', 'slash-palette']];
    for (const [file, vignette] of vignettes) {
      for (const theme of THEMES) {
        const opened = app.waitForEvent('window');
        await app.evaluate(({ BrowserWindow }, [path, t]) => {
          const win = new BrowserWindow({ width: 1500, height: 1000, show: false });
          void win.loadFile(path, { query: t === 'dark' ? { theme: 'dark' } : {} });
        }, [join(REPO_ROOT, 'mockups', file), theme] as const);
        const mock = await opened;
        await mock.waitForLoadState('load');
        await mock.locator(`#${vignette}`).screenshot({ path: join(out, `${file.slice(0, 2)}-${vignette}-${theme}.png`) });
        await mock.close();
      }
    }
    writeFileSync(join(out, 'README.txt'), 'Mockup crops for the C11 M6 comparison; not committed.\n');
    console.log(`[c11-shots] mockup crops in ${out}`);
  } finally {
    await maws.cleanup();
  }
});
