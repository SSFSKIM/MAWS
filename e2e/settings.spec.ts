// C11's Settings tab end to end (C11 execution document, Acceptance item 2, `settings.spec.ts`; M5 refresh task, the
// powerline glyphs). The tab cases run on any build: a C5 version-2 `settings.json` migrated to version 3 on launch, the
// tab opened from the application menu's ⌘, item, a chord recorded, refused and unbound in the Keyboard section with
// the menu following, the keymap reset, the default route and the relay policy set, and all of it read back after a
// relaunch over the same profile. The monospace-font case needs the harness's `#probe` page (`pnpm e2e:settings` builds
// one; under a plain build it skips): a terminal of the product registry drawing Nerd Font private-use glyphs once
// `appearance.monoFont` names an installed Nerd Font, and boxes again when it is cleared.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchMaws, REPO_ROOT } from './support/launch';

// A packaged app is built without the harness (`pnpm build:app`), whatever `out/` holds now.
const HARNESS_BUILT = !process.env.MAWS_E2E_EXECUTABLE && existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));
// An installed Nerd Font family on the owner's Mac (~/Library/Fonts/MesloLGMNerdFontMono-Regular.ttf).
const NERD_FONT = process.env.MAWS_E2E_NERD_FONT ?? 'MesloLGM Nerd Font Mono';

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
const accelerator = (app: ElectronApplication, id: string) => app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.accelerator ?? null, id);
const panel = (page: Page) => page.locator('[data-region="main"]').getByRole('tabpanel');
const keyRow = (page: Page, title: string) => panel(page).getByRole('table', { name: 'Key bindings' }).getByRole('row', { name: title, exact: true });
const readSettings = (userData: string) => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as Record<string, unknown> & { version: number; keymap: object; gateway: object };

test('settings: a v2 file migrates; ⌘, opens the tab; a chord is recorded, refused, unbound and reset; the route and policy persist', async () => {
  test.setTimeout(120_000);
  const userData = mkdtempSync(join(tmpdir(), 'maws-c11-settings-'));
  writeFileSync(join(userData, 'settings.json'), readFileSync(join(REPO_ROOT, 'test/fixtures/settings/v2.json')));
  try {
    let maws = await launchMaws({ userData });
    try {
      const { app, page } = maws;
      // Main migrated C5's file to version 3 on load, keeping its theme, override and notification choices. C12: to
      // version 4, with the memory budget's defaults.
      expect(readSettings(userData)).toMatchObject({
        version: 4, // C12
        theme: 'system',
        keymap: { 'attention.next': 'Cmd+Alt+J' },
        notifications: { enabled: false, sound: true, kinds: { approvals: true, questions: true, planReviews: true, errors: true, heldPeerMessages: false } },
        engine: { binaryPath: null, pinnedVersion: '2.1.283', subagentModel: null, memoryBudgetMiB: null, statefulMcpServers: [] /* C12 */ },
        gateway: { defaultRoute: 'gateway', relayUnreachable: 'ask', offerDirect: true },
        usage: { nearLimitPercent: 90 },
        appearance: { monoFont: null },
      });

      // Settings… sits in the application menu at ⌘, and opens the singleton tab.
      expect(await accelerator(app, 'settings.open')).toBe('Cmd+,');
      await menu(app, 'settings.open');
      await expect(page.locator('[data-region="main"]').getByRole('tab', { name: /Settings/ })).toBeVisible();
      await expect(panel(page).getByRole('region', { name: 'Keyboard' })).toBeVisible();

      // Record ⌘⇧U for Next Needs-you: the row and the Go menu's item follow.
      const next = keyRow(page, 'Next Needs-you');
      await expect(next.locator('kbd')).toHaveText('⌘⌥J');
      await next.getByRole('button', { name: 'Change Next Needs-you' }).click();
      await expect(next.getByRole('button', { name: 'Was ⌘⌥J' })).toBeVisible();
      await page.keyboard.press('Meta+Shift+KeyU');
      await expect(next.locator('kbd')).toHaveText('⌘⇧U');
      await expect.poll(() => accelerator(app, 'attention.next')).toBe('Cmd+Shift+U');

      // ⌘K belongs to the command palette: refused in words, still recording; Backspace unbinds.
      await next.getByRole('button', { name: 'Change Next Needs-you' }).click();
      await page.keyboard.press('Meta+KeyK');
      await expect(next.getByRole('alert')).toHaveText('Already bound to Command palette · unbind it first');
      await page.keyboard.press('Backspace');
      await expect(next.locator('kbd')).toHaveText('Unbound');
      await expect.poll(() => accelerator(app, 'attention.next')).toBe(null);
      expect(readSettings(userData).keymap).toEqual({ 'attention.next': null });

      // Reset to defaults, after its confirm.
      await panel(page).getByRole('button', { name: 'Reset to defaults' }).click();
      await page.getByRole('dialog', { name: 'Reset every key binding?' }).getByRole('button', { name: 'Reset', exact: true }).click();
      await expect(next.locator('kbd')).toHaveText('⌘⇧J');
      await expect.poll(() => accelerator(app, 'attention.next')).toBe('Cmd+Shift+J');

      // The default route and the relay-unreachable policy, one field each.
      const gateway = panel(page).getByRole('region', { name: 'Gateway' });
      await gateway.getByRole('radio', { name: 'Direct' }).check();
      await gateway.getByRole('combobox', { name: 'Relay unreachable at launch' }).selectOption('wait');
      await expect.poll(() => readSettings(userData).gateway).toEqual({ defaultRoute: 'direct', relayUnreachable: 'wait', offerDirect: true });
      expect(readSettings(userData).keymap).toEqual({});
      expect(maws.consoleErrors()).toEqual([]);
    } finally {
      await maws.cleanup();
    }

    // Relaunched over the same profile, every choice is where it was left.
    maws = await launchMaws({ userData });
    try {
      const { app, page } = maws;
      await menu(app, 'settings.open');
      const gateway = panel(page).getByRole('region', { name: 'Gateway' });
      await expect(gateway.getByRole('radio', { name: 'Direct' })).toBeChecked();
      await expect(gateway.getByRole('combobox', { name: 'Relay unreachable at launch' })).toHaveValue('wait');
      await expect(keyRow(page, 'Next Needs-you').locator('kbd')).toHaveText('⌘⇧J');
      await expect(panel(page).getByRole('region', { name: 'Appearance' }).getByRole('radio', { name: 'System' })).toBeChecked();
      await expect(panel(page).getByRole('region', { name: 'Notifications' }).getByRole('switch', { name: 'Notify while MAWS is not focused' })).toHaveAttribute('aria-checked', 'false');
      expect(await accelerator(app, 'attention.next')).toBe('Cmd+Shift+J');
      expect(maws.consoleErrors()).toEqual([]);
    } finally {
      await maws.cleanup();
    }
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});

test('settings: the monospace font applies to the root --font-mono and to the Appearance preview', async () => {
  const maws = await launchMaws();
  try {
    const { app, page } = maws;
    await menu(app, 'settings.open');
    const row = panel(page).getByRole('group', { name: 'Monospace font' });
    await row.getByRole('textbox', { name: 'Monospace font' }).fill(NERD_FONT);
    await row.getByRole('textbox', { name: 'Monospace font' }).press('Enter');
    const stack = `"${NERD_FONT}", "SF Mono", "JetBrains Mono", Menlo, monospace`;
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim())).toBe(stack);
    await expect(row.getByTestId('mono-preview')).toHaveCSS('font-family', stack);
    // Code blocks draw in the token too (Tailwind's font-mono is var(--font-mono)).
    expect(await page.evaluate(() => {
      const code = document.createElement('code');
      code.className = 'font-mono';
      document.body.append(code);
      const family = getComputedStyle(code).fontFamily;
      code.remove();
      return family;
    })).toBe(stack);
    await row.getByRole('textbox', { name: 'Monospace font' }).fill('');
    await row.getByRole('textbox', { name: 'Monospace font' }).press('Enter');
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--font-mono'))).toBe('');
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// ---- the powerline glyphs, on the harness's #probe page ------------------------------------------------------------

type Harness = { terminals: { ready(): Promise<string[]>; list(): { id: string; status: string }[]; type(id: string, data: string): Promise<void>; probe(id: string): { cols: number; rows: number; line(row: number): string; lineCount(): number } | null } };
type HarnessWindow = Window & { __maws_harness?: Harness };

// The glyph under test sits in column 2 of the line printf writes: U+F07C, a Nerd Font icon xterm.js does not draw itself
// (its WebGL renderer custom-draws U+E0A0–E0A2 and U+E0B0–E0BF, the powerline separators, whatever the font; the test
// prints U+E0B0 beside it for the eye). `M` marks the line.
const LINE = 'MM';
const PRINTF = "printf 'M\\356\\202\\260\\357\\201\\274M\\n'\r";

async function glyphCell(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect.poll(() => page.evaluate(([id, line]) => {
    const probe = (window as HarnessWindow).__maws_harness!.terminals.probe(id)!;
    return Array.from({ length: probe.lineCount() }, (_, i) => probe.line(i).trimEnd()).includes(line);
  }, [id, LINE] as const)).toBe(true);
  return page.evaluate(([id, line]) => {
    const probe = (window as HarnessWindow).__maws_harness!.terminals.probe(id)!;
    const base = Math.max(0, probe.lineCount() - probe.rows);
    let row = -1;
    for (let i = 0; i < probe.rows; i++) if (probe.line(base + i).trimEnd() === line) row = i;
    const screen = document.querySelector('[data-pane="registry"] .xterm-screen')!.getBoundingClientRect();
    const w = screen.width / probe.cols;
    const h = screen.height / probe.rows;
    return { x: screen.left + 2 * w, y: screen.top + row * h, width: w, height: h };
  }, [id, LINE] as const);
}

// The share of pixels that differ between two same-sized PNG screenshots, decoded in the page.
function difference(page: Page, a: Buffer, b: Buffer): Promise<{ differing: number; inkA: number }> {
  return page.evaluate(
    async ([a, b]) => {
      const pixels = async (base64: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, image.width, image.height).data;
      };
      const [pa, pb] = [await pixels(a), await pixels(b)];
      let differing = 0;
      let ink = 0;
      const n = Math.min(pa.length, pb.length) / 4;
      // the background is the cell's corner pixel; ink is anything well away from it
      const bg = [pa[0]!, pa[1]!, pa[2]!];
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (Math.max(Math.abs(pa[o]! - pb[o]!), Math.abs(pa[o + 1]! - pb[o + 1]!), Math.abs(pa[o + 2]! - pb[o + 2]!)) > 48) differing++;
        if (Math.max(Math.abs(pa[o]! - bg[0]), Math.abs(pa[o + 1]! - bg[1]), Math.abs(pa[o + 2]! - bg[2])) > 48) ink++;
      }
      return { differing: differing / n, inkA: ink / n };
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

// Whether the page can draw U+F07C in `family`: the glyph painted in that family (then a family no Mac has) against the
// same glyph in the missing family alone. `document.fonts.check` cannot answer it: it reads true for a family that is
// not installed (Electron 44, observed in the M5 fix wave), since no web font of that name is pending.
function nerdFontDraws(page: Page, family: string): Promise<boolean> {
  return page.evaluate((family) => {
    const paint = (font: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 48;
      const ctx = canvas.getContext('2d')!;
      ctx.font = font;
      ctx.fillText('\uF07C', 4, 36);
      return ctx.getImageData(0, 0, 48, 48).data.join(',');
    };
    const missing = '"MAWS no such font"';
    return paint(`32px "${family}", ${missing}`) !== paint(`32px ${missing}`);
  }, family);
}

// eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
test('settings: a Nerd Font in appearance.monoFont draws private-use prompt glyphs in the terminal, and follows a change', async ({}, testInfo) => {
  testInfo.skip(!HARNESS_BUILT, 'the #probe page needs a harness build (pnpm e2e:settings)');
  test.setTimeout(90_000);
  const maws = await launchMaws({ env: { MAWS_HARNESS: '1' } });
  try {
    const { page } = maws;
    testInfo.skip(!(await nerdFontDraws(page, NERD_FONT)), `the Nerd Font "${NERD_FONT}" is not installed on this Mac (name another in MAWS_E2E_NERD_FONT)`);
    const setFont = (monoFont: string | null) => page.evaluate((monoFont) => window.maws.invoke('settings.set', { appearance: { monoFont } }), monoFont);
    const rootFont = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim());
    await setFont(NERD_FONT);
    await page.evaluate(() => (location.hash = 'probe'));
    await page.waitForFunction(() => (window as HarnessWindow).__maws_harness?.terminals !== undefined);
    const [id] = await page.evaluate(async () => {
      const terminals = (window as HarnessWindow).__maws_harness!.terminals;
      await terminals.ready();
      return terminals.list().map((t) => t.id);
    });
    await expect.poll(rootFont).toBe(`"${NERD_FONT}", "SF Mono", "JetBrains Mono", Menlo, monospace`);
    await expect
      .poll(() => page.evaluate((id) => (window as HarnessWindow).__maws_harness!.terminals.list().find((t) => t.id === id)?.status, id!), { timeout: 20_000 })
      .toBe('running');
    await page.evaluate(([id, data]) => (window as HarnessWindow).__maws_harness!.terminals.type(id, data), [id!, PRINTF] as const);

    const shoot = async () => {
      await page.waitForTimeout(300); // two frames of the renderer after the font or the text changed
      return page.screenshot({ clip: await glyphCell(page, id!) });
    };
    const nerd = await shoot();
    await setFont(null);
    await expect.poll(rootFont).toBe('"SF Mono", "JetBrains Mono", Menlo, monospace');
    const token = await shoot();
    await setFont(NERD_FONT);
    await expect.poll(rootFont).toMatch(new RegExp(`^"${NERD_FONT}"`));
    const again = await shoot();

    const changed = await difference(page, nerd, token);
    const same = await difference(page, nerd, again);
    testInfo.annotations.push({ type: 'glyph cell', description: `ink ${changed.inkA.toFixed(2)}; Nerd Font vs token stack ${changed.differing.toFixed(2)}; Nerd Font again ${same.differing.toFixed(2)}` });
    expect(changed.inkA, 'the Nerd Font draws the icon').toBeGreaterThan(0.05);
    expect(changed.differing, 'the token stack draws something else there (the box)').toBeGreaterThan(0.1);
    expect(same.differing, 'naming the Nerd Font again draws the icon again').toBeLessThan(0.02);
  } finally {
    await maws.cleanup();
  }
});
