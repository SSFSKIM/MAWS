// C1's end-to-end smoke (acceptance items 1 to 3 and 5; item 6 is this file run against the packaged app through
// MAWS_E2E_EXECUTABLE). Processes are identified by pid, never by name: the host pids come from `window.maws`, the
// shell pid from the echo test, and `app.getAppMetrics()` (evaluated in main by Playwright) ties each host pid to the
// `serviceName` it was forked with.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { collectConsoleErrors, REPO_ROOT, test } from './support/launch';
import { SETTINGS_DEFAULTS_V8 } from '../src/shared/settings/defaults';

const LIGHT_BG = 'rgb(250, 249, 246)'; // #faf9f6, light `--bg`
const DARK_BG = 'rgb(19, 19, 19)'; // #131313, dark `--bg`

test('preload bundle has no external runtime imports', () => {
  // A sandboxed preload's `require` loads only a few Electron built-ins, so anything but `electron` would leave
  // `window.maws` undefined at page load (M3's bundled preload).
  const source = readFileSync(join(REPO_ROOT, 'out/preload/index.js'), 'utf8');
  const calls = [...source.matchAll(/\brequire\s*\(([^)]*)\)/g)].map((match) => match[1].trim());
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.filter((argument) => argument !== '"electron"' && argument !== "'electron'")).toEqual([]);
});

test('MAWS opens light, hosts answer, pty echoes, survives reload and window close, theme switches, exits clean', async ({ maws }) => {
  const { app, page, launchedAt } = maws;
  expect(await app.evaluate(({ app }) => app.isPackaged), 'the app under test is the one MAWS_E2E_EXECUTABLE names').toBe(maws.packaged);

  // Item 1: one window titled MAWS, three regions side by side, light theme, clean console.
  const regions = ['sidebar', 'main', 'panel'].map((name) => page.locator(`[data-region="${name}"]`));
  for (const region of regions) await expect(region).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - launchedAt, 'the window shows its regions within ten seconds').toBeLessThan(10_000);
  const lefts = await Promise.all(regions.map(async (region) => (await region.boundingBox())!.x));
  expect(lefts, 'sidebar, main and panel sit left to right').toEqual([...lefts].sort((a, b) => a - b));
  expect(new Set(lefts).size).toBe(3);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((win) => win.getTitle()))).toEqual(['MAWS']);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(LIGHT_BG);

  await openDiagnostics(app, page); // C5: the strip is the Diagnostics tab

  // Item 2: both hosts ready with distinct pids, neither the main process, each a Utility process in the app's
  // metrics under the serviceName it was forked with; the strip reads what the snapshots say.
  const hostStates = (page: Page) =>
    page.evaluate(async () => ({ engine: await window.maws.invoke('engine.hostState', undefined), pty: await window.maws.invoke('pty.hostState', undefined) }));
  await expect(page.getByLabel('engine host')).toHaveText(/^engine host · ready · pid \d+$/);
  await expect(page.getByLabel('pty host')).toHaveText(/^pty host · ready · pid \d+$/);
  const before = await hostStates(page);
  if (!before.engine.ok || !before.pty.ok) throw new Error(`hostState failed: ${JSON.stringify(before)}`);
  const enginePid = before.engine.value.pid!;
  const ptyPid = before.pty.value.pid!;
  expect([before.engine.value.state, before.pty.value.state]).toEqual(['ready', 'ready']);
  await expect(page.getByLabel('engine host')).toHaveText(`engine host · ready · pid ${enginePid}`);
  await expect(page.getByLabel('pty host')).toHaveText(`pty host · ready · pid ${ptyPid}`);
  const mainPid = await app.evaluate(() => process.pid);
  expect(new Set([mainPid, enginePid, ptyPid]).size, 'main, engine host and pty host are three processes').toBe(3);

  const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map(({ pid, type, name }) => ({ pid, type, name })));
  expect(metrics.find((metric) => metric.pid === enginePid)).toEqual({ pid: enginePid, type: 'Utility', name: 'maws-engine-host' });
  expect(metrics.find((metric) => metric.pid === ptyPid)).toEqual({ pid: ptyPid, type: 'Utility', name: 'maws-pty-host' });

  // The utility entries resolve and answer (inside app.asar when packaged).
  const pings = await page.evaluate(async () => ({ engine: await window.maws.invoke('engine.ping', undefined), pty: await window.maws.invoke('pty.ping', undefined) }));
  expect(pings.engine).toMatchObject({ ok: true, value: { pid: enginePid } });
  expect(pings.pty).toMatchObject({ ok: true, value: { pid: ptyPid } });

  // Item 3: the echo test spawns /bin/sh through node-pty and shows the line the shell printed, with its pid.
  await page.getByRole('button', { name: 'Spawn echo test' }).click();
  const echo = page.getByLabel('echo test');
  await expect(
    echo,
    'the echo shell answers; in the packaged app, "posix_spawnp failed" here means node-pty\'s spawn-helper lost its ' +
      'execute bit on the way into app.asar.unpacked',
  ).toHaveText(/^MAWS_ECHO_OK · shell pid \d+$/, { timeout: 2_000 });
  const shellPid = Number((await echo.textContent())!.match(/shell pid (\d+)$/)![1]);
  expect(isAlive(shellPid), 'the echo shell is running').toBe(true);

  // Reload: hosts and the shell belong to the app, not to the page.
  await page.reload();
  await openDiagnostics(app, page); // C5
  await expect(page.getByLabel('engine host')).toHaveText(`engine host · ready · pid ${enginePid}`);
  await expect(page.getByLabel('pty host')).toHaveText(`pty host · ready · pid ${ptyPid}`);
  const after = await hostStates(page);
  expect(after).toMatchObject({ engine: { ok: true, value: { state: 'ready', pid: enginePid } }, pty: { ok: true, value: { state: 'ready', pid: ptyPid } } });
  expect(isAlive(shellPid), 'the echo shell survives the reload').toBe(true);

  // Window close (macOS, D-11): closing the only window leaves the app, both hosts and the shell running, and the
  // Dock's `activate` re-creates a window that finds the same hosts ready.
  const closed = page.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 'the app runs with no window').toBe(0);
  expect(app.process().exitCode, 'the app process is still running').toBeNull();
  expect([enginePid, ptyPid, shellPid].filter((pid) => !isAlive(pid)), 'hosts and shell outlive the window').toEqual([]);
  const opened = app.waitForEvent('window');
  await app.evaluate(({ app }) => app.emit('activate'));
  const reopened = await opened;
  const reopenedConsoleErrors = await collectConsoleErrors(reopened);
  await openDiagnostics(app, reopened); // C5
  await expect(reopened.getByLabel('engine host')).toHaveText(`engine host · ready · pid ${enginePid}`);
  await expect(reopened.getByLabel('pty host')).toHaveText(`pty host · ready · pid ${ptyPid}`);
  const reopenedStates = await hostStates(reopened);
  expect(reopenedStates).toMatchObject({
    engine: { ok: true, value: { state: 'ready', pid: enginePid } },
    pty: { ok: true, value: { state: 'ready', pid: ptyPid } },
  });
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 'activate opened one window').toBe(1);

  // Theme: settings.set flips the page to dark and persists into this run's own userData.
  const dark = await reopened.evaluate(() => window.maws.invoke('settings.set', { theme: 'dark' }));
  expect(dark).toMatchObject({ ok: true, value: { settings: { theme: 'dark' }, resolvedTheme: 'dark' } });
  await expect(reopened.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => reopened.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(DARK_BG);
  expect(JSON.parse(readFileSync(join(maws.userData, 'settings.json'), 'utf8'))).toEqual({ ...SETTINGS_DEFAULTS_V8, theme: 'dark' });

  expect(maws.consoleErrors(), 'the console stays free of errors, first load included').toEqual([]);
  expect(reopenedConsoleErrors(), 'the re-created window\'s console stays free of errors').toEqual([]);

  // Clean exit: within five seconds of close, both hosts and the shell are gone.
  await app.close();
  await expect
    .poll(() => [enginePid, ptyPid, shellPid].filter(isAlive), { timeout: 5_000, message: 'host and shell pids still alive after close' })
    .toEqual([]);
});

// ---- C5: the diagnostics strip is a tab ----------------------------------------------------------------------------------
// Since C5's main area the strip is the content of the Diagnostics tab, opened from Help › Diagnostics. The menu item is
// clicked in main (Playwright's keyboard never reaches a macOS menu), and again until the tab shows: a click that lands
// before the page listens for `layout.action` is lost, and a reloaded page may already restore the tab by itself.
async function openDiagnostics(app: ElectronApplication, page: Page): Promise<void> {
  const strip = page.getByRole('region', { name: 'Diagnostics' });
  await expect
    .poll(
      async () => {
        if (await strip.isVisible()) return true;
        await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('diagnostics.open')?.click());
        return strip.isVisible();
      },
      { timeout: 10_000, message: 'Help › Diagnostics opens the Diagnostics tab' },
    )
    .toBe(true);
}
// ---- end C5 ---------------------------------------------------------------------------------------------------------------

// `kill(pid, 0)` sends nothing; it throws ESRCH once the process is gone.
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}
