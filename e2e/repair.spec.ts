// P5 O15 M2 (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, acceptance 2, Interfaces §B, §C cases 1 to 4):
// the repair window end to end on the built app, a launch `mawsd` cannot start. The failure is the suite's fault file
// (MAWS_E2E_UNIT_FAULT, honoured only under MAWS_E2E=1 on an unpackaged build and a scratch profile), which replaces §A's
// answer with the kind it holds and `why` "e2e fault"; removed, the launch's own row answers again (a private `mawsd`).
// So these cases prove the window and what main does and does not compose around it; §A's own rows are
// src/main/hosts/daemon.test.ts's. Run by `pnpm e2e:supervisor-daemon` (MAWS_SUPERVISOR_E2E=1).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { RepairState } from '@shared/repair';
import { DAEMON_FILES } from '@shared/daemon/files';
import { invoke } from './support/c7-replay';
import { appWindow, launchMaws, type MawsLaunch } from './support/launch';

test.skip(process.env.MAWS_SUPERVISOR_E2E !== '1', 'the repair window e2e runs under pnpm e2e:supervisor-daemon (MAWS_SUPERVISOR_E2E=1)');

const LOGIN_ITEMS_URL = 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension';

let launch: MawsLaunch | null = null;
test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
});

// A launch whose first outcome is `kind`: the fault file, in the test's output directory, written before the app starts
async function launchFaulted(kind: RepairState['kind'], env: Record<string, string> = {}): Promise<{ maws: MawsLaunch; fault: string }> {
  const fault = test.info().outputPath('unit-fault');
  mkdirSync(dirname(fault), { recursive: true });
  writeFileSync(fault, kind);
  const maws = await launchMaws({ firstWindow: 'repair', env: { MAWS_E2E_UNIT_FAULT: fault, ...env } });
  return { maws, fault };
}

// Every attempt the window starts, as the page hears it: each state that says an attempt is running
async function recordAttempts(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const seen: boolean[] = [];
    (window as unknown as { attempts: boolean[] }).attempts = seen;
    (window as unknown as { repair: { onState(listener: (state: { attempting: boolean }) => void): () => void } }).repair.onState((state) => seen.push(state.attempting));
  });
  return () => page.evaluate(() => (window as unknown as { attempts: boolean[] }).attempts.filter(Boolean).length);
}

const windowCount = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed()).length);
const hasAppBridge = (page: Page) => page.evaluate(() => typeof (window as unknown as { maws?: unknown }).maws !== 'undefined');

test('the daemon cannot start: the repair window, and nothing else', async () => {
  const { maws } = await launchFaulted('not-started');
  launch = maws;
  const page = maws.page;
  await expect(page).toHaveTitle('MAWS');
  await expect(page.getByRole('heading', { name: "MAWS's machine daemon did not start" })).toBeVisible();
  await expect(page.getByText('e2e fault', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeFocused(); // a development build's label, the default
  expect(await hasAppBridge(page), 'the repair page has no app bridge').toBe(false);
  expect(await windowCount(maws.app), 'no app window').toBe(1);
  expect(existsSync(join(maws.userData, 'spine.lock')), 'spine.lock is held by no process').toBe(false);
  expect(existsSync(join(maws.userData, DAEMON_FILES.dir, DAEMON_FILES.lock)), 'no mawsd lock under the profile').toBe(false);
});

test('the daemon can start again: Reinstall and Start or Try Again opens the app', async () => {
  const { maws, fault } = await launchFaulted('not-started');
  launch = maws;
  await expect(maws.page.getByRole('heading', { name: "MAWS's machine daemon did not start" })).toBeVisible();
  rmSync(fault);
  const closed = maws.page.waitForEvent('close');
  await maws.page.getByRole('button', { name: 'Try Again' }).click();
  await closed;
  const app = await appWindow(maws.app);
  expect(await hasAppBridge(app), 'the app window').toBe(true);
  await expect.poll(async () => (await invoke(app, 'session.list', {})).ok, { timeout: 30_000, message: 'the session list loads' }).toBe(true);
  expect(await windowCount(maws.app), 'the repair window is gone').toBe(1);
});

test('Open Login Items, then the window’s focus, tries once', async () => {
  const openLog = `${test.info().outputPath('opens')}.log`;
  const { maws } = await launchFaulted('not-loaded', { MAWS_E2E_OPEN_LOG: openLog });
  launch = maws;
  const page = maws.page;
  await expect(page.getByRole('heading', { name: "MAWS's machine daemon is turned off" })).toBeVisible();
  const attempts = await recordAttempts(page);
  const focus = () => maws.app.evaluate(({ BrowserWindow }) => void BrowserWindow.getAllWindows()[0]!.emit('focus'));
  await focus();
  expect(await attempts(), 'a focus before Open Login Items tries nothing').toBe(0);
  await page.getByRole('button', { name: 'Open Login Items…' }).click();
  await expect.poll(() => (existsSync(openLog) ? readFileSync(openLog, 'utf8') : ''), { message: 'the settings URL asked for' }).toContain(`openExternal ${LOGIN_ITEMS_URL}`);
  await focus();
  await expect.poll(attempts, { message: 'the next focus starts one attempt' }).toBe(1);
  await expect(page.getByRole('heading', { name: "MAWS's machine daemon is turned off" })).toBeVisible(); // the fault still holds
  await expect(page.getByRole('button', { name: 'Open Login Items…' })).toBeEnabled();
  await focus();
  await page.waitForTimeout(500); // nothing is to happen: a second focus is no retry
  expect(await attempts(), 'exactly one attempt').toBe(1);
});

test('closing the repair window quits MAWS', async () => {
  const { maws } = await launchFaulted('no-unit');
  launch = maws;
  await expect(maws.page.getByRole('heading', { name: 'This development build has no machine daemon for your main profile' })).toBeVisible();
  const child = maws.app.process();
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close()).catch(() => {}); // the app may be gone before the answer
  expect(await exited).toBe(0);
});
