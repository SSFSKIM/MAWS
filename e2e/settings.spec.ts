// C11's Settings tab end to end (C11 execution document, Acceptance item 2, `settings.spec.ts`; M5 refresh task, the
// powerline glyphs). The tab cases run on any build: a C5 version-2 `settings.json` migrated to version 3 on launch, the
// tab opened from the application menu's ⌘, item, a chord recorded, refused and unbound in the Keyboard section with
// the menu following, the keymap reset, the default route and the relay policy set, and all of it read back after a
// relaunch over the same profile. The monospace-font case needs the harness's `#probe` page (`pnpm e2e:settings` builds
// one; under a plain build it skips): a terminal of the product registry drawing Nerd Font private-use glyphs once
// `appearance.monoFont` names an installed Nerd Font, and boxes again when it is cleared.
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { TESTED_ENGINE_VERSION } from '../src/engine-host/engine-compat';
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
const readSettings = (userData: string) => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as Record<string, unknown> & { version: number; keymap: object; gateway: object; permissions: object };

test('settings: a v2 file migrates; ⌘, opens the tab; a chord is recorded, refused, unbound and reset; the route and policy persist', async () => {
  test.setTimeout(120_000);
  const userData = mkdtempSync(join(tmpdir(), 'maws-c11-settings-'));
  writeFileSync(join(userData, 'settings.json'), readFileSync(join(REPO_ROOT, 'test/fixtures/settings/v2.json')));
  try {
    let maws = await launchMaws({ userData });
    try {
      const { app, page } = maws;
      // Main migrated C5's file to version 3 on load, keeping its theme, override and notification choices. C12: to
      // version 4, with the memory budget's defaults. W2: to version 5, with the transcript's default width. W3: to
      // version 6, with acceptEdits as the auto fallback. W7: to version 7, with the memory budget on. W13: to version 8,
      // with no engine pin. E9: to version 9, with the system locale for dictation. E10: to version 10, with the
      // supervisor's defaults. E4a: to version 11, with the browser's defaults. cua #90: to version 12, the bookmarks bar shown.
      // P2-C: to version 13, with the to-human lane and its two notification groups on. P3-D: to version 14, with the
      // house design system as the default and no Space defaults.
      expect(readSettings(userData)).toMatchObject({
        version: 14, // C12: 4; W2: 5; W3: 6; W7: 7; W13: 8; E9: 9; E10: 10; E4a: 11; cua #90: 12; P2-C: 13; P3-D: 14
        theme: 'system',
        keymap: { 'attention.next': 'Cmd+Alt+J' },
        notifications: { enabled: false, sound: true, kinds: { approvals: true, questions: true, planReviews: true, errors: true, heldPeerMessages: false, asyncInput: true, essential: true /* P2-C */ } },
        engine: { binaryPath: null, subagentModel: null, memoryBudgetMiB: null, statefulMcpServers: [] /* C12 */, memoryBudget: { enabled: true } /* W7 */ }, // W13: no pinnedVersion
        gateway: { defaultRoute: 'gateway', relayUnreachable: 'ask', offerDirect: true },
        usage: { nearLimitPercent: 90 },
        appearance: { monoFont: null, transcriptWidth: 768 /* W2 */ },
        permissions: { autoFallback: 'acceptEdits' }, // W3
        voice: { locale: null }, // E9
        supervisor: { idleExitMinutes: 10, keepRunningDefault: true }, // E10
        browser: { profile: null, searchUrl: 'https://www.google.com/search?q=%s', linkTarget: 'in-app', bookmarksBar: 'shown' }, // E4a; cua #90
        mods: { toHuman: { enabled: true } }, // P2-C
        artifacts: { defaultDesignSystem: null, spaceDesignSystems: {} }, // P3-D
      });
      expect(readSettings(userData).engine).not.toHaveProperty('pinnedVersion'); // W13

      // Settings… sits in the application menu at ⌘, and opens the singleton tab.
      expect(await accelerator(app, 'settings.open')).toBe('Cmd+,');
      await menu(app, 'settings.open');
      await expect(page.locator('[data-region="main"]').getByRole('tab', { name: /Settings/ })).toBeVisible();
      await expect(panel(page).getByRole('region', { name: 'Keyboard' })).toBeVisible();

      const fallback = panel(page).getByRole('combobox', { name: 'When auto mode is unavailable' });
      await expect(fallback.locator('option')).toHaveText(['Manual', 'Accept edits', 'Plan', 'Bypass permissions', "Don't ask"]);
      await expect(fallback).toHaveValue('acceptEdits');
      await fallback.selectOption({ label: 'Plan' });
      await expect.poll(() => readSettings(userData).permissions).toEqual({ autoFallback: 'plan' });

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
      expect(readSettings(userData).permissions).toEqual({ autoFallback: 'plan' });
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

// P2-C (M6; the P2-C document, G7): Settings › Notifications carries the to-human mod's app switch and the owner
// channel's two groups, each written alone to the settings file.
test('settings: the to-human switch and the two notification groups for an agent’s marks', async () => {
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'maws-p2c-settings-')));
  try {
    const maws = await launchMaws({ userData });
    try {
      const { app, page } = maws;
      await menu(app, 'settings.open');
      const notifications = panel(page).getByRole('region', { name: 'Notifications' });
      const toHuman = notifications.getByRole('group', { name: 'Messages to you' }).getByRole('switch', { name: 'To-human' });
      await expect(toHuman).toHaveAttribute('aria-checked', 'true');
      const kinds = notifications.getByRole('group', { name: 'For' });
      await expect(kinds.getByRole('checkbox', { name: 'questions an agent left for you' })).toBeChecked();
      await expect(kinds.getByRole('checkbox', { name: 'must-read messages' })).toBeChecked();
      await toHuman.click();
      await expect(toHuman).toHaveAttribute('aria-checked', 'false');
      await kinds.getByRole('checkbox', { name: 'must-read messages' }).uncheck();
      await expect(kinds.getByRole('checkbox', { name: 'must-read messages' })).not.toBeChecked();
      await expect
        .poll(() => {
          const file = readSettings(userData) as unknown as { mods: { toHuman: { enabled: boolean } }; notifications: { kinds: { asyncInput: boolean; essential: boolean } } };
          return [file.mods.toHuman.enabled, file.notifications.kinds.asyncInput, file.notifications.kinds.essential];
        })
        .toEqual([false, true, false]);
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

// W2: Claude Desktop's width setting moves the one column the transcript's rows and the composer frame share.
test('settings: the transcript width applies to the root --measure, and Narrow restores the token', async () => {
  const maws = await launchMaws();
  try {
    const { app, page } = maws;
    await menu(app, 'settings.open');
    const row = panel(page).getByRole('group', { name: 'Transcript width' });
    const measure = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--measure').trim());
    await expect(row.getByRole('radio', { name: 'Narrow' })).toBeChecked();
    expect(await measure()).toBe('768px');
    await row.getByText('Wide', { exact: true }).click();
    await expect.poll(measure).toBe('1280px');
    await row.getByText('Medium', { exact: true }).click();
    await expect.poll(measure).toBe('960px');
    await row.getByText('Narrow', { exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--measure'))).toBe('');
    expect(await measure()).toBe('768px');
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// W13 (charter D-1 as amended 2026-10-01): the Binary row is the binary this run resolves (MAWS_E2E_ENGINE_BIN here, a
// stand-in a version ahead of the fixtures), by its real path, with its probed version and the tested version as
// information, never a refusal; Update is offered and never clicked, since it would update this Mac's Claude Code.
test('settings: Engine shows the resolved binary, its version and the tested one, and offers the update', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maws-w13-engine-'));
  const stub = join(dir, 'claude');
  writeFileSync(stub, '#!/bin/sh\necho "2.1.290 (Claude Code)"\n');
  chmodSync(stub, 0o755);
  const maws = await launchMaws({ env: { MAWS_E2E_ENGINE_BIN: stub } });
  try {
    const { app, page } = maws;
    await menu(app, 'settings.open');
    const binary = panel(page).getByRole('group', { name: 'Binary' });
    await expect(binary).toContainText(realpathSync(stub));
    await expect(binary).toContainText('2.1.290');
    await expect(binary).toContainText(`MAWS was verified against Claude Code ${TESTED_ENGINE_VERSION}`); // E11 2.8: the verified release, not the fixtures' pin
    await expect(binary.locator('.text-warning')).toHaveCount(0);
    await expect(binary.getByRole('button', { name: 'Use installed' })).toHaveCount(0);
    const update = panel(page).getByRole('group', { name: 'Update' });
    await expect(update.getByRole('button', { name: 'Update Claude Code…' })).toBeVisible();
    await expect(update).toContainText('New sessions start on the new version; running sessions keep theirs.');
    await expect(panel(page).getByRole('group', { name: 'Plugins' })).toContainText('Plugin hooks run in MAWS sessions as in the terminal'); // R1
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

// W9 (H1, the comparative assessment's M-01): ⌘, then ⌘\ at the default window puts Settings in a pane of about 300px.
// Below 32rem the index is a top row and every row stacks, so the Engine section's controls sit inside the pane and
// nothing scrolls sideways; back in one pane the index and the label column are as they were.
test('settings: in a 50/50 split the view stacks inside its pane, and in one pane it keeps its columns', async () => {
  const maws = await launchMaws();
  try {
    const { app, page } = maws;
    const main = page.locator('[data-region="main"]');
    await menu(app, 'session.new'); // a second tab, so ⌘\ has one to leave behind
    await expect(main.getByRole('tab', { name: /New chat/ })).toBeVisible();
    await menu(app, 'settings.open');
    await menu(app, 'pane.split');
    const pane = main.locator('[data-pane="1"]');
    const settings = pane.getByRole('tabpanel');
    const engine = settings.getByRole('region', { name: 'Engine' });
    const change = engine.getByRole('group', { name: 'Binary' }).getByRole('button', { name: 'Change…' });
    const fallback = engine.getByRole('combobox', { name: 'When auto mode is unavailable' });
    await expect(change).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('settings-split.png') });

    const paneBox = (await settings.boundingBox())!; // the pane's section is `display: contents`; its tab panel has the box
    expect(paneBox.width, 'a 50/50 split at the default window').toBeLessThan(512);
    for (const control of [change, fallback]) {
      const box = (await control.boundingBox())!;
      expect(box.x, 'the control starts inside the pane').toBeGreaterThanOrEqual(paneBox.x);
      expect(box.x + box.width, 'the control ends inside the pane').toBeLessThanOrEqual(paneBox.x + paneBox.width);
    }
    const body = settings.locator('[data-settings-body]');
    expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth), 'nothing scrolls sideways').toBeLessThanOrEqual(0);
    // the index is a row above the body; a row's label sits over its control, its note under it
    const nav = (await settings.getByRole('navigation', { name: 'Settings sections' }).boundingBox())!;
    expect(nav.y + nav.height).toBeLessThanOrEqual((await body.boundingBox())!.y + 1);
    const binary = engine.getByRole('group', { name: 'Binary' });
    const label = (await binary.getByText('Binary', { exact: true }).boundingBox())!;
    const note = (await binary.getByText(/New sessions start on your installed Claude Code/).boundingBox())!; // W13's note
    const changeBox = (await change.boundingBox())!;
    expect(label.y + label.height).toBeLessThanOrEqual(changeBox.y + 1);
    expect(changeBox.y + changeBox.height).toBeLessThanOrEqual(note.y + 1);
    const keyRow = settings.getByRole('table', { name: 'Key bindings' }).getByRole('row', { name: 'Next Needs-you', exact: true });
    const title = (await keyRow.getByRole('cell').first().boundingBox())!;
    expect(title.y + title.height, 'a key binding stacks its title over its chord').toBeLessThanOrEqual((await keyRow.locator('kbd').boundingBox())!.y + 1);

    // ⌘\ again takes Settings back to the left pane, and the emptied right pane closes the split
    await menu(app, 'pane.split');
    await expect(main.locator('[data-pane="1"]')).toHaveCount(0);
    const whole = main.locator('[data-pane="0"]').getByRole('tabpanel');
    const wideBinary = whole.getByRole('region', { name: 'Engine' }).getByRole('group', { name: 'Binary' });
    await expect(wideBinary).toBeVisible();
    const wideLabel = (await wideBinary.getByText('Binary', { exact: true }).boundingBox())!;
    const wideChange = (await wideBinary.getByRole('button', { name: 'Change…' }).boundingBox())!;
    expect(wideLabel.x + wideLabel.width, 'wide: the label column sits left of the control').toBeLessThanOrEqual(wideChange.x);
    const wideNav = (await whole.getByRole('navigation', { name: 'Settings sections' }).boundingBox())!;
    expect(wideNav.x + wideNav.width, 'wide: the index is a column at the left').toBeLessThanOrEqual(wideChange.x);
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
