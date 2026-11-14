// C11's Settings end to end (C11 execution document, Acceptance item 2, `settings.spec.ts`; M5 refresh task, the
// powerline glyphs). UX wave U7b (O-40): Settings is a dialog over the window, no longer a tab, so every case reads it
// through `settingsDialog`. The cases run on any build: a C5 version-2 `settings.json` migrated to version 3 on launch, the
// dialog opened from the application menu's ⌘, item, a chord recorded, refused and unbound in the Keyboard section with
// the menu following, the keymap reset, the default route and the relay policy set, and all of it read back after a
// relaunch over the same profile. The monospace-font case needs the harness's `#probe` page (`pnpm e2e:settings` builds
// one; under a plain build it skips): a terminal of the product registry drawing Nerd Font private-use glyphs once
// `appearance.monoFont` names an installed Nerd Font, and boxes again when it is cleared.
import { mountedTab, mountedTabs, openAppDestination, pageRegion, pageTitle, settingsDialog } from './support/shell';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { scratchMarketplace, writePluginCliStub } from '../test/support/plugin-cli-stub';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { TESTED_ENGINE_VERSION } from '../src/engine-host/engine-compat';
import { launchMaws, REPO_ROOT } from './support/launch';
import { invoke, value } from './support/c7-replay'; // P5 O3-D M5b: the shape flip's raw reads
import { SETTINGS_DEFAULTS_V21, splitSettings } from '@shared/settings/defaults'; // P5 O15 M2: a client file saved on the embedded shape

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
const panel = settingsDialog; // UX wave U7b: Settings is read in its dialog, not the main pane's tab panel
const tabCount = (page: Page) => mountedTabs(page).count(); // under the dialog or a page the strip is hidden: its mounted tabs
const keyRow = (page: Page, title: string) => panel(page).getByRole('table', { name: 'Key bindings' }).getByRole('row', { name: title, exact: true });
// P5 O3-A (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §3): the client's file and the machine's, each its owner's fields
const readSettings = (userData: string) => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as Record<string, unknown> & { version: number; keymap: object };
const readMachineSettings = (userData: string) => JSON.parse(readFileSync(join(userData, 'machine-settings.json'), 'utf8')) as Record<string, unknown> & { version: number; engine: object; gateway: object; permissions: object };

test('settings: a v2 file migrates; ⌘, opens the dialog; a chord is recorded, refused, unbound and reset; the route and policy persist', async () => {
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
      // house design system as the default and no Space defaults. P4-B1: to version 15, with the comments view expanded.
      // P4-R8: to version 16, with no app MCP servers. P4-A2: to version 17, with the launch profile at the user scope.
      // UX1: to version 18. Then to version 19, the launch profile without an output style. P5 O2 M7: to version 20,
      // under the machine daemon (the harness still runs its hosts in the app). P5 O3-A: then split by owner, exactly:
      // settings.json the client's fields at version 21, machine-settings.json the machine's at its own version 1.
      expect(readSettings(userData)).toEqual({
        version: 21, // C12: 4; W2: 5; W3: 6; W7: 7; W13: 8; E9: 9; E10: 10; E4a: 11; cua #90: 12; P2-C: 13; P3-D: 14; P4-B1: 15; P4-R8: 16; P4-A2: 17; UX1: 18; the style removed: 19; P5 O2: 20; P5 O3-A: 21
        theme: 'system',
        keymap: { 'attention.next': 'Cmd+Alt+J' },
        notifications: { enabled: false, sound: true, kinds: { turnFinished: true, approvals: true, questions: true, planReviews: true, errors: true, heldPeerMessages: false, asyncInput: true, essential: true /* P2-C */ } },
        usage: { nearLimitPercent: 90 },
        appearance: { monoFont: null, transcriptWidth: 768 /* W2 */ },
        voice: { locale: null }, // E9
        supervisor: { keepRunningDefault: true, shape: 'daemon' }, // E10; P5 O2 M7: the machine daemon
        browser: { profile: null, searchUrl: 'https://www.google.com/search?q=%s', linkTarget: 'in-app', bookmarksBar: 'shown' }, // E4a; cua #90
        artifacts: { commentsView: 'expand' }, // P4-B1
      });
      expect(readMachineSettings(userData)).toEqual({
        version: 1, // P5 O3-A
        engine: { binaryPath: null, subagentModel: null, memoryBudgetMiB: null, statefulMcpServers: [] /* C12 */, memoryBudget: { enabled: true } /* W7 */, mcpServers: [] /* P4-R8 */, launchProfile: { plugins: { off: [] }, hooks: 'user' } /* P4-A2; version 19: exactly, no output style */ }, // W13: no pinnedVersion
        gateway: { defaultRoute: 'gateway', relayUnreachable: 'ask', offerDirect: true },
        permissions: { autoFallback: 'acceptEdits' }, // W3
        mods: { toHuman: { enabled: true } }, // P2-C
        supervisor: { idleExitMinutes: 10 }, // E10
        artifacts: { defaultDesignSystem: null, spaceDesignSystems: {} }, // P3-D
        sessions: { archiveInactiveDays: null }, // UX1
      });

      // Settings… sits in the application menu at ⌘, and opens the dialog over the window; the strip gains no tab.
      expect(await accelerator(app, 'settings.open')).toBe('Cmd+,');
      const tabs = await tabCount(page);
      await menu(app, 'settings.open');
      await expect(settingsDialog(page)).toBeVisible();
      await expect(panel(page).getByRole('region', { name: 'Keyboard' })).toBeVisible();
      expect(await tabCount(page), 'no tab is added').toBe(tabs);
      await expect(mountedTab(page, /Settings/)).toHaveCount(0);

      const fallback = panel(page).getByRole('combobox', { name: 'When auto mode is unavailable' });
      await expect(fallback.locator('option')).toHaveText(['Manual', 'Accept edits', 'Plan', 'Bypass permissions', "Don't ask"]);
      await expect(fallback).toHaveValue('acceptEdits');
      await fallback.selectOption({ label: 'Plan' });
      await expect.poll(() => readMachineSettings(userData).permissions).toEqual({ autoFallback: 'plan' });

      // Record ⌘⇧U for Next Needs-you: the row and the Go menu's item follow.
      const next = keyRow(page, 'Next Needs-you');
      await expect(next.locator('kbd')).toHaveText('⌘⌥J');
      await next.getByRole('button', { name: 'Change Next Needs-you' }).click();
      await expect(next.getByRole('button', { name: 'Was ⌘⌥J' })).toBeVisible();
      await page.keyboard.press('Meta+Shift+KeyU');
      await expect(next.locator('kbd')).toHaveText('⌘⇧U');
      await expect.poll(() => accelerator(app, 'attention.next')).toBe('Cmd+Shift+U');

      // The recorder keeps its own Esc (§H, row 3): Esc ends the recording, the chord stays, and the dialog stays open.
      await next.getByRole('button', { name: 'Change Next Needs-you' }).click();
      await expect(next.getByRole('button', { name: 'Was ⌘⇧U' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(next.getByRole('button', { name: 'Was ⌘⇧U' })).toHaveCount(0);
      await expect(next.locator('kbd')).toHaveText('⌘⇧U');
      await expect(settingsDialog(page)).toBeVisible();

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
      await expect.poll(() => readMachineSettings(userData).gateway).toEqual({ defaultRoute: 'direct', relayUnreachable: 'wait', offerDirect: true });
      expect(readMachineSettings(userData).permissions).toEqual({ autoFallback: 'plan' });
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
      await expect(panel(page).getByRole('region', { name: 'Notifications' }).getByRole('switch', { name: 'Notify when I am not looking at that session' })).toHaveAttribute('aria-checked', 'false');
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
          // P5 O3-A: the to-human switch is the machine's (the owner channel's launch decision), the kinds the client's
          const machine = readMachineSettings(userData) as unknown as { mods: { toHuman: { enabled: boolean } } };
          const file = readSettings(userData) as unknown as { notifications: { kinds: { asyncInput: boolean; essential: boolean } } };
          return [machine.mods.toHuman.enabled, file.notifications.kinds.asyncInput, file.notifications.kinds.essential];
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
    await binary.getByRole('button', { name: 'More' }).click(); // U11a M9: the tested version is information, behind More
    await expect(binary).toContainText(`MAWS was verified against Claude Code ${TESTED_ENGINE_VERSION}.`); // E11 2.8: the verified release, not the fixtures' pin
    await expect(binary.locator('.text-warning')).toHaveCount(0);
    await expect(binary.getByRole('button', { name: 'Use installed' })).toHaveCount(0);
    const update = panel(page).getByRole('group', { name: 'Update' });
    await expect(update.getByRole('button', { name: 'Update Claude Code…' })).toBeVisible();
    await update.getByRole('button', { name: 'More' }).click();
    await expect(update).toContainText('New sessions start on the new version; running sessions keep theirs.');
    await expect(panel(page).getByRole('group', { name: 'Plugins', exact: true })).toHaveCount(0); // U11a M9: R1's paragraph row is gone
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

// WR #57: the first click after the native popup of a select was chosen from or dismissed is not swallowed. UX wave
// U7b: the popup is inside the Settings dialog, and the click is one on a section link of its index, which moves the view.
test('WR #57: first click after choosing or dismissing the design-system popup navigates', async () => {
  const maws = await launchMaws();
  try {
    const { app, page } = maws;
    await menu(app, 'settings.open');
    const sections = panel(page).getByRole('navigation', { name: 'Settings sections' });
    const link = (name: string) => sections.getByRole('button', { name, exact: true });
    await link('Artifacts').click();
    await expect(link('Artifacts')).toHaveAttribute('aria-current', 'true');
    const select = panel(page).getByRole('combobox', { name: 'Default design system', exact: true });
    await expect(select.locator('option', { hasText: 'Classroom' })).toHaveCount(1);
    for (const [commit, target] of [[true, 'Keyboard'], [false, 'Appearance']] as const) {
      // A real popup, not selectOption: its native dismissal is what is under test.
      await select.click();
      if (commit) {
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
      } else {
        await page.keyboard.press('Escape');
      }
      await expect(settingsDialog(page), 'the popup took its own Esc').toBeVisible();
      // Exactly one click: no second click hides a swallowed one.
      await link(target).click();
      await expect(link(target)).toHaveAttribute('aria-current', 'true');
      await expect(panel(page).getByRole('heading', { name: target, exact: true })).toBeInViewport();
      await link('Artifacts').click();
      await expect(link('Artifacts')).toHaveAttribute('aria-current', 'true');
    }
  } finally {
    await maws.cleanup();
  }
});

// W9 (H1, the comparative assessment's M-01): the view never scrolls sideways and keeps its controls inside it. UX wave
// U7b: Settings is a dialog of `min(960px, 100vw - 48px)`, so its view is never under 512 px (the window's smallest is
// 600 px): at the default window the index and the label column are columns, and at the smallest window the dialog is
// 552 px wide, its index still a column, the measured controls inside it. The form under 32rem, which this scene reached
// through a split, cannot occur in the dialog; it stays proved by `SettingsView.test.tsx` ("stacks in a narrow body…").
test('settings: the dialog keeps its columns at the default window, and at the smallest window its index stays a column and its controls inside it', async () => {
  const maws = await launchMaws();
  try {
    const { app, page } = maws;
    const resize = async (width: number, height = 900) => {
      await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())!.setContentSize(width, height), [width, height] as const);
      await page.waitForFunction(([width, height]) => window.innerWidth === width && window.innerHeight === height, [width, height] as const);
    };
    await resize(1440);
    await menu(app, 'settings.open');
    const view = panel(page);
    const engine = view.getByRole('region', { name: 'Engine' });
    const binary = engine.getByRole('group', { name: 'Binary' });
    const change = binary.getByRole('button', { name: 'Change…' });
    const fallback = view.getByRole('region', { name: 'Sessions' }).getByRole('combobox', { name: 'When auto mode is unavailable' }); // U11a M9: Sessions' row
    const nav = view.getByRole('navigation', { name: 'Settings sections' });
    const body = view.locator('[data-settings-body]');
    await expect(change).toBeVisible();

    // the default window: the label column sits left of the control, the index a column at the left
    const wideLabel = (await binary.getByText('Binary', { exact: true }).boundingBox())!;
    const wideChange = (await change.boundingBox())!;
    expect(wideLabel.x + wideLabel.width, 'wide: the label column sits left of the control').toBeLessThanOrEqual(wideChange.x);
    const wideNav = (await nav.boundingBox())!;
    expect(wideNav.x + wideNav.width, 'wide: the index is a column at the left').toBeLessThanOrEqual(wideChange.x);

    // the smallest window: the dialog is 552 px wide; the index still a column; the two controls inside the view
    await resize(600);
    await expect.poll(async () => Math.round((await view.boundingBox())!.width), { message: 'the dialog at 100vw - 48px' }).toBe(552);
    await page.screenshot({ path: test.info().outputPath('settings-600.png') });
    const viewBox = (await view.boundingBox())!;
    const bodyBox = (await body.boundingBox())!;
    const narrowNav = (await nav.boundingBox())!;
    expect(narrowNav.x + narrowNav.width, 'the index is still a column at the left').toBeLessThanOrEqual(bodyBox.x + 1);
    expect(narrowNav.height, 'the index is a column, not a row above the body').toBeGreaterThan(bodyBox.height / 2);
    for (const control of [change, fallback]) {
      const box = (await control.boundingBox())!;
      expect(box.x, 'the control starts inside the view').toBeGreaterThanOrEqual(viewBox.x);
      expect(box.x + box.width, 'the control ends inside the view').toBeLessThanOrEqual(viewBox.x + viewBox.width);
    }
    expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth), 'nothing scrolls sideways').toBeLessThanOrEqual(0);
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// U11a M9 (l8-settings-06, A5 and A6; the execution document's Interfaces §G, "The measure"): the regrouped page, and
// each note at two widths. Where the body has its full 760 px every note is one line: 18 px, or 22 px where it ends in
// More or carries a button; a state line is not measured. A view about 550 px wide keeps its index a column and stacks
// every row. The index's list scrolls by itself and its footer stays. UX wave U7b: the view is the Settings dialog's
// (960 px wide at the default window: 148 for the index, 20, the body's 760, and the 30 px the dialog keeps clear of
// Close), and about 550 px wide at the window's smallest, 600 px. The index as a row of links, under 512 px, was reached
// through a split; no window reaches it in the dialog, and `SettingsView.test.tsx` keeps it. O-47: Usage after Gateway.
const SECTION_ORDER = ['Appearance', 'Notifications', 'Keyboard', 'Voice', 'Browser', 'Artifacts', 'Sessions', 'Gateway', 'Usage', 'Engine', 'Supervisor', 'Org'];
const NOTE_LINE = 18; // 12 px type at the normal leading
const NOTE_LINE_WITH_BUTTON = 22; // the box of More, or of a button on the line

// How far the body scrolls sideways, and each element that reaches past its content box unclipped (by tag, test id and
// class, with its width and how far it reaches, in px): what a failure names. No text and no other attribute is read, as a row may
// draw the machine's own values.
function sidewaysOverflow(body: Element): { overflow: number; content: number; past: string[] } {
  const style = getComputedStyle(body);
  const box = body.getBoundingClientRect();
  const left = box.left + body.clientLeft + parseFloat(style.paddingLeft);
  const right = box.left + body.clientLeft + body.clientWidth - parseFloat(style.paddingRight);
  const past: string[] = [];
  for (const el of Array.from(body.querySelectorAll('*'))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= right + 0.5) continue;
    let clipped = false; // inside a box that clips it (a truncated path), it scrolls nothing
    for (let up = el.parentElement; up !== null && up !== body && !clipped; up = up.parentElement) clipped = getComputedStyle(up).overflowX !== 'visible';
    if (clipped) continue;
    const testId = el.getAttribute('data-testid');
    past.push(`${el.tagName.toLowerCase()}${testId === null ? '' : ` [data-testid=${testId}]`} .${(el.getAttribute('class') ?? '').trim().split(/\s+/).join('.')} width ${r.width.toFixed(1)}, ${(r.right - right).toFixed(1)} past`);
  }
  return { overflow: body.scrollWidth - body.clientWidth, content: Math.round(right - left), past: past.slice(0, 12) };
}

type Stacking = { row: string; controlUnderLabel: boolean; noteUnderControl: boolean };
// Each drawn row of the table: whether its control starts under its label and its note under its control.
const stackingOf = (column: Locator): Promise<Stacking[]> =>
  column.locator('[data-settings-row][role="group"]').evaluateAll((rows) =>
    rows
      .filter((row) => row.getBoundingClientRect().height > 0)
      .map((row) => {
        const [label, control, note] = Array.from(row.children, (child) => child.getBoundingClientRect());
        return { row: row.getAttribute('data-settings-row')!, controlUnderLabel: control!.top >= label!.bottom - 1, noteUnderControl: note === undefined || note.top >= control!.bottom - 1 };
      }),
  );

test('settings: the regrouped page; each note one line where the body has its 760 px; rows stack in a 550 px view', async () => {
  test.setTimeout(150_000);
  const maws = await launchMaws();
  try {
    const { app, page } = maws;
    const resize = async (width: number, height = 900) => {
      await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())!.setContentSize(width, height), [width, height] as const);
      await page.waitForFunction(([width, height]) => window.innerWidth === width && window.innerHeight === height, [width, height] as const);
    };
    await resize(1440); // the default window
    await menu(app, 'settings.open');
    const view = panel(page);
    const nav = view.getByRole('navigation', { name: 'Settings sections' });
    const column = view.locator('[data-settings-column]');

    // the regrouped index: App, then Sessions & engine, then Org with no heading, and Customize; it opens at Appearance
    await expect(nav.getByRole('button')).toHaveText([...SECTION_ORDER, 'Customize ›']);
    await expect(nav.locator('[data-settings-group]')).toHaveText(['App', 'Sessions & engine']);
    await expect(nav.getByRole('button', { name: 'Appearance', exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(view.locator('section[aria-labelledby^="settings-"] > h3')).toHaveText(SECTION_ORDER.map((name) => new RegExp(`^${name}`)));
    await expect(view.getByRole('region', { name: 'Engine', exact: true }).locator('[data-settings-row]')).toHaveCount(3);

    // 1. the body at 760 px in the dialog at the default window (M5, decision 9): every note one line
    expect((await column.boundingBox())!.width, 'the body has its full 760 px').toBe(760);
    await page.screenshot({ path: test.info().outputPath('settings-760.png') });
    const notes = await column.locator('[data-settings-row] [data-settings-note="line"]').evaluateAll((nodes) =>
      nodes.map((node) => ({ row: node.closest('[data-settings-row]')!.getAttribute('data-settings-row')!, text: node.textContent ?? '', height: node.getBoundingClientRect().height, button: node.querySelector('button') !== null })),
    );
    expect(notes.length, 'the page draws its notes').toBeGreaterThan(20);
    for (const note of notes) expect(note.height, `${note.row}: ${note.text}`).toBeLessThanOrEqual((note.button ? NOTE_LINE_WITH_BUTTON : NOTE_LINE) + 0.5);
    // More opens the rest in place, under the line, and Less closes it
    const update = column.getByRole('group', { name: 'Update', exact: true });
    await update.getByRole('button', { name: 'More', exact: true }).click();
    await expect(update.getByRole('button', { name: 'Less', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(update.locator('[data-settings-note]')).toContainText('New sessions start on the new version; running sessions keep theirs.');
    await update.getByRole('button', { name: 'Less', exact: true }).click();
    await expect(update).not.toContainText('New sessions start on the new version');
    // a short window: the dialog's box is shorter (85 percent of the window), and the index's list scrolls by itself
    // inside it, its footer in place at the bottom
    await resize(1440, 600);
    const list = nav.locator('[data-settings-index]');
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight), 'the list scrolls by itself').toBe(true);
    const footer = nav.getByText("Stored in MAWS's own Application Support folder.", { exact: false });
    await expect(footer).toBeInViewport();
    expect((await footer.boundingBox())!.y, 'the footer under the list').toBeGreaterThanOrEqual((await list.boundingBox())!.y + (await list.boundingBox())!.height - 1);
    await resize(1440);

    // 2. the window at its smallest, 600 px: the view is about 550 px wide; the index is still a column; every row is stacked
    await resize(600);
    const wide = Math.round((await view.boundingBox())!.width);
    expect(wide, 'a view between 32rem and the body’s 760 px').toBeGreaterThanOrEqual(512);
    expect(wide).toBeLessThan(700);
    await page.screenshot({ path: test.info().outputPath('settings-550.png') });
    expect((await nav.boundingBox())!.x + (await nav.boundingBox())!.width, 'the index is a column at the left').toBeLessThanOrEqual((await column.boundingBox())!.x);
    await expect(nav.locator('[data-settings-group]').first()).toBeVisible();
    for (const row of await stackingOf(column)) {
      expect(row.controlUnderLabel, `${row.row}: its control under its label`).toBe(true);
      expect(row.noteUnderControl, `${row.row}: its note under its control`).toBe(true);
    }
    const keyRow = column.getByRole('table', { name: 'Key bindings' }).getByRole('row', { name: 'Next Needs-you', exact: true });
    expect((await keyRow.getByRole('cell').first().boundingBox())!.y + 1, 'a key binding stacks its title over its chord').toBeLessThanOrEqual((await keyRow.locator('kbd').boundingBox())!.y + 1);
    const sideways = await view.locator('[data-settings-body]').evaluate(sidewaysOverflow);
    expect(sideways.overflow, `nothing scrolls sideways; past the body's ${sideways.content} px: ${sideways.past.join('; ') || 'nothing'}`).toBeLessThanOrEqual(0);
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    await maws.cleanup();
  }
});

// U11a M10 (l8-settings-06, A7; the execution document's Interfaces §G, "Search"): "Search settings" at the index's top.
// ⌘F inside Settings focuses it; A7's four queries list their rows, each the row's name over its section; a row chosen
// far down a short section lands with its section's heading in view, holds the keyboard and is marked for a moment; a
// word behind a row's More opens it; the results scroll as the index's list does, the field and the footer staying; Esc
// clears the field. UX wave U7b: in the Settings dialog (§H, rows 4 to 6) Esc with text in the field clears it and the
// dialog stays, and the next Esc, in the empty field, closes the dialog (the wave architect's ruling on the first Mac run). "usage" finds Usage's row
// (O-47); it also finds Gateway's "Direct login", whose line holds the word, so the step asks that Usage's result is
// among the results. The narrow form (the field a first row, its results a list under it) was reached through a split;
// no window reaches it in the dialog, and `SettingsSearch.test.tsx` keeps it.
test('settings: Search settings finds rows by their words; a choice lands under its heading; the list scrolls with the index; Esc in the dialog', async () => {
  test.setTimeout(150_000);
  const maws = await launchMaws();
  try {
    const { app, page } = maws;
    const resize = async (width: number, height = 900) => {
      await app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())!.setContentSize(width, height), [width, height] as const);
      await page.waitForFunction(([width, height]) => window.innerWidth === width && window.innerHeight === height, [width, height] as const);
    };
    await resize(1440);
    await menu(app, 'settings.open');
    const view = panel(page);
    const nav = view.getByRole('navigation', { name: 'Settings sections' });
    const body = view.locator('[data-settings-body]');
    const field = nav.getByRole('combobox', { name: 'Search settings' });
    const options = nav.getByRole('listbox', { name: 'Search settings' }).getByRole('option');
    const option = (name: string, under: string) => options.filter({ has: page.getByText(name, { exact: true }) }).filter({ has: page.getByText(under, { exact: true }) });

    // ⌘F from a row of the page focuses the field
    await view.getByRole('group', { name: 'Theme', exact: true }).getByText('Theme', { exact: true }).click();
    await page.keyboard.press('Meta+F');
    await expect(field).toBeFocused();

    // A7's four queries and Usage's, each result the row's name with its section under it, among the results; "mcp" also
    // finds the Customize link
    for (const [query, name, under] of [['mcp', 'MCP servers', 'Sessions'], ['hook', 'Hooks in sessions', 'Sessions'], ['theme', 'Theme', 'Appearance'], ['shortcut', 'Shortcut', 'Voice'], ['usage', 'Claude accounts', 'Usage']] as const) {
      await field.fill(query);
      await expect(option(name, under), query).toHaveCount(1);
    }
    await field.fill('mcp');
    await expect(option('Customize', 'Plugins, skills and connectors')).toHaveCount(1);
    await expect(nav.getByRole('button', { name: 'Appearance', exact: true })).toHaveCount(0); // the results in the sections' place
    await field.fill('zebra crossing');
    await expect(nav.getByText('No matching settings')).toBeVisible();

    // a row far down a short section: Voice's last, Recognition, lands with Voice's heading at the body's top
    await field.fill('recognition');
    await option('Recognition', 'Voice').click();
    const recognition = view.getByRole('region', { name: 'Voice', exact: true }).getByRole('group', { name: 'Recognition', exact: true });
    await expect(recognition).toBeFocused();
    await expect(recognition).toHaveAttribute('data-settings-mark', 'on');
    const bodyBox = (await body.boundingBox())!;
    const heading = (await view.getByRole('heading', { name: 'Voice', exact: true }).boundingBox())!;
    const landed = (await recognition.boundingBox())!;
    expect(heading.y, 'the heading at the body’s top').toBeGreaterThanOrEqual(bodyBox.y - 1);
    expect(heading.y, 'the heading at the body’s top').toBeLessThanOrEqual(bodyBox.y + 24);
    expect(landed.y + landed.height, 'the row in view').toBeLessThanOrEqual(bodyBox.y + bodyBox.height);
    await expect(field).toHaveValue('recognition'); // the query stays
    await expect(recognition).not.toHaveAttribute('data-settings-mark', /./, { timeout: 4_000 }); // the mark goes after its moment
    await page.screenshot({ path: test.info().outputPath('settings-search-landed.png') });

    // a word behind the More a row shows now opens that More
    await field.fill('PATH');
    await option('Binary', 'Engine').click();
    const binary = view.getByRole('region', { name: 'Engine', exact: true }).getByRole('group', { name: 'Binary', exact: true });
    await expect(binary.getByRole('button', { name: 'Less', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(binary).toBeFocused();

    // a short window: the results scroll as the index's list does; the field and the footer stay
    await resize(1440, 600);
    await field.fill('session');
    const list = nav.locator('[data-settings-index]');
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight), 'the results scroll by themselves').toBe(true);
    await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(options.last()).toBeInViewport();
    await expect(field).toBeInViewport();
    await expect(nav.getByText("Stored in MAWS's own Application Support folder.", { exact: false })).toBeInViewport();

    // Esc with text in the field clears it and brings the sections back; the dialog stays (§H, row 4)
    await field.focus();
    await page.keyboard.press('Escape');
    await expect(field).toHaveValue('');
    await expect(nav.getByRole('button', { name: 'Appearance', exact: true })).toBeVisible();
    await expect(settingsDialog(page), 'clearing the field keeps the dialog').toBeVisible();
    // Esc in the empty field closes the dialog (row 6): ruled by the wave's architect on the first Mac run, an empty search
    // field passes Esc to its host
    await expect(field).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(settingsDialog(page)).toHaveCount(0);
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

// UX2-K: the app-level libraries with no session. Real disk inventory and the existing plugin CLI boundary; screenshots
// are attachments from the Mac gate, not the owner's running app. Narrow captures exercise these pages' own reflow.
// UX wave U7b (O-40): each opens as a page beside the sidebar, with Back and its name in the title bar, and adds no tab;
// the strip's chords, which moved between the two as tabs, have nothing of theirs to move. The page's name stands once:
// the level-1 heading is the title bar's.
// eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
test('Customize and Projects are reachable without a chat, at desktop and narrow widths', async ({}, testInfo) => {
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'maws-ux2k-')));
  const directory = join(userData, 'harbor-quarterly-review');
  mkdirSync(join(directory, '.claude', 'skills', 'review-quarterly'), { recursive: true });
  writeFileSync(join(directory, '.claude', 'skills', 'review-quarterly', 'SKILL.md'), '---\nname: review-quarterly\ndescription: Review the quarterly narrative against the financial source documents.\n---\n# Quarterly review\n');
  writeFileSync(join(directory, '.mcp.json'), JSON.stringify({ mcpServers: { documents: { type: 'http', url: 'https://example.invalid/mcp?token=must-not-reach-renderer' } } }));
  const plugins = [{ name: 'editorial-tools', version: '1.0.0', description: 'Review and refine the quarterly narrative.' }];
  const market = scratchMarketplace(join(userData, 'marketplace'), { name: 'harbor-tools', plugins });
  const cli = writePluginCliStub(userData, { marketplaces: [{ name: 'harbor-tools', source: 'directory', path: market, plugins }], installed: [{ id: 'editorial-tools@harbor-tools', version: '1.0.0', scope: 'user', enabled: true, projectPath: null }], fail: {} });
  try {
    const maws = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_E2E_ENGINE_BIN: cli.bin }, prepare: ({ claudeConfigDir }) => {
      // The cold inventory reads this registry, not the CLI stub's declared installations.
      mkdirSync(join(claudeConfigDir, 'plugins'), { recursive: true });
      writeFileSync(join(claudeConfigDir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
        'editorial-tools@harbor-tools': [{ scope: 'user', installPath: join(market, 'plugins', 'editorial-tools'), version: '1.0.0' }],
      } }));
      // UX2-L defaults to a 240px sidebar and no surface: do not hide a reserved panel by fixture.
      mkdirSync(join(claudeConfigDir, 'skills', 'proofread'), { recursive: true });
      writeFileSync(join(claudeConfigDir, 'skills', 'proofread', 'SKILL.md'), '---\nname: proofread\ndescription: Check wording, consistency and citations.\n---\n# Proofread\n');
      writeFileSync(join(claudeConfigDir, '.claude.json'), JSON.stringify({ mcpServers: { notion: { type: 'http', url: 'https://example.invalid/notion' } } }));
    } });
    try {
      const { page, app } = maws;
      const added = await page.evaluate(async (directory) => window.maws.invoke('session.projects.add', { directory }), directory);
      expect(added.ok).toBe(true);
      const tabs = await tabCount(page);
      const opened = async (name: 'Customize' | 'Projects') => {
        await openAppDestination(page, name);
        await expect(pageTitle(page).getByRole('button', { name: 'Back', exact: true })).toBeVisible();
        await expect(pageRegion(page).getByRole('heading', { level: 1 }), 'the page’s name stands once, in the title bar').toHaveCount(0);
        expect(await tabCount(page), 'no tab is added').toBe(tabs);
      };
      await opened('Customize');
      await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ label: 'harbor-quarterly-review' });
      await expect(page.locator('[data-plugins-section="my-items"]')).toBeVisible();
      const shot = async (name: string) => {
        const destination = pageRegion(page);
        await expect(page.locator('[data-region="panel"]')).toHaveJSProperty('inert', true);
        await expect.poll(async () => { const box = (await destination.boundingBox())!; return Math.round(box.x + box.width); }).toBe(await page.evaluate(() => innerWidth));
        expect(await destination.evaluate((el) => el.scrollWidth - el.clientWidth), 'destinations do not overflow the page').toBe(0);
        const path = testInfo.outputPath(`${name}.png`);
        await page.screenshot({ path });
        await testInfo.attach(name, { path, contentType: 'image/png' });
      };
      for (const [width, height] of [[1280, 820], [1512, 982], [900, 820], [620, 820]] as const) {
        await app.evaluate(({ BrowserWindow }, [width, height]) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(600, 600); win.setContentSize(width, height); }, [width, height]);
        await page.waitForFunction(([width, height]) => innerWidth === width && innerHeight === height, [width, height]);
        await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
        await expect(page.locator('[data-plugins-section="my-items"]')).toBeVisible();
        await shot(`ux2k-plugins-${width}x${height}`);
        await page.getByRole('tab', { name: 'Skills', exact: true }).click();
        await expect(page.getByRole('button', { name: 'View review-quarterly' })).toBeVisible();
        await expect(page.getByRole('tabpanel', { name: 'Skills' }).getByText('Inventory coverage', { exact: true })).toBeVisible(); // P4-AGG M4: Connectors stays mounted once visited, with its own
        await expect(page.getByText('Some configuration could not be read', { exact: true })).toHaveCount(0);
        await shot(`ux2k-skills-${width}x${height}`);
        await page.getByRole('tab', { name: 'Connectors', exact: true }).click(); // P4-AGG M4: the tab's new name
        await expect(page.getByText('documents', { exact: true })).toBeVisible();
        await expect(page.getByText(/Connection state and tools are unavailable/)).toBeVisible();
        await expect(page.locator('body')).not.toContainText('must-not-reach-renderer');
        await shot(`ux2k-mcp-${width}x${height}`);
        await opened('Projects');
        await expect(pageTitle(page).getByRole('heading', { name: 'Projects', exact: true, level: 1 })).toBeVisible();
        await shot(`ux2k-projects-${width}x${height}`);
        // one page at a time: Customize replaces Projects, and neither is a tab
        await opened('Customize');
        await expect(pageRegion(page)).toHaveAttribute('data-destination', 'customize');
        await expect(mountedTab(page, /Projects|Customize/)).toHaveCount(0);
        await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ label: 'harbor-quarterly-review' });
      }
      expect(await page.evaluate(async () => { const snapshot = await window.maws.invoke('session.list', {}); return snapshot.ok ? snapshot.value.sessions.length : -1; })).toBe(0);
    } finally { await maws.cleanup(); }
  } finally { rmSync(userData, { recursive: true, force: true }); }
});

// P5 O15 M2 (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, acceptance 3, Interfaces §C case 5): a profile
// saved on the embedded shape, its client `settings.json` holding `supervisor.shape: embedded` beside three settings off
// their defaults, opens on `mawsd`, whose pid holds spine.lock; the three read as written; the first settings write
// stores `shape` as `daemon`, the version still 21. (It replaces O3-D's shape flip: no setting selects a shape now.)
test('a profile saved on the embedded shape opens on mawsd with everything present', async () => {
  test.setTimeout(120_000);
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'maws-e2e-shape-')));
  const lockPid = () => {
    try {
      return (JSON.parse(readFileSync(join(userData, 'spine.lock'), 'utf8')) as { pid: number }).pid;
    } catch {
      return null;
    }
  };
  const saved = splitSettings({ ...SETTINGS_DEFAULTS_V21, theme: 'dark', usage: { nearLimitPercent: 75 }, voice: { locale: 'ko-KR' }, supervisor: { ...SETTINGS_DEFAULTS_V21.supervisor, shape: 'embedded' } }).client;
  writeFileSync(join(userData, 'settings.json'), JSON.stringify(saved));
  let maws: Awaited<ReturnType<typeof launchMaws>> | null = null;
  try {
    maws = await launchMaws({ userData });
    const status = value(await invoke(maws.page, 'host.status', undefined));
    expect(status.transport).toBe('daemon');
    await expect.poll(lockPid, { timeout: 30_000, message: 'mawsd holds spine.lock' }).toBe(status.daemon!.pid);
    expect(lockPid(), 'main holds no spine.lock').not.toBe(maws.app.process().pid);
    const shown = value(await invoke(maws.page, 'settings.get', undefined)).settings;
    expect(shown).toMatchObject({ theme: 'dark', usage: { nearLimitPercent: 75 }, voice: { locale: 'ko-KR' }, supervisor: { shape: 'daemon' } });
    expect(readSettings(userData), 'a read writes nothing').toEqual(saved);
    value(await invoke(maws.page, 'settings.set', { usage: { nearLimitPercent: 80 } }));
    expect(readSettings(userData)).toEqual({ ...saved, usage: { nearLimitPercent: 80 }, supervisor: { ...saved.supervisor, shape: 'daemon' } });
    expect(readSettings(userData).version).toBe(21);
  } finally {
    await maws?.cleanup().catch((error: unknown) => console.error(error));
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
