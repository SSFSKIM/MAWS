// Launches MAWS for an end-to-end test: the built app (`out/main/index.js` under the repo's Electron) by default, or
// the executable named by MAWS_E2E_EXECUTABLE (the packaged `MAWS.app/Contents/MacOS/MAWS`). Every launch gets
// MAWS_E2E=1 and a fresh `userData` under the OS temp directory, so nothing depends on or touches a real profile.
// Later children's end-to-end tests start from here, through the `maws` fixture of `test`.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, test as base, type ElectronApplication, type Page } from '@playwright/test';

export const REPO_ROOT = resolve(__dirname, '../..');

export interface MawsLaunch {
  app: ElectronApplication;
  page: Page; // the first window
  consoleErrors(): string[]; // the first window's console errors and uncaught errors so far, from its first load on
  userData: string;
  packaged: boolean;
  launchedAt: number; // Date.now() just before the process was started
  cleanup(): Promise<void>; // closes the app if it is still open and removes the profile; throws if the app would not close
}

export async function launchMaws(): Promise<MawsLaunch> {
  const executable = process.env.MAWS_E2E_EXECUTABLE ? resolve(REPO_ROOT, process.env.MAWS_E2E_EXECUTABLE) : null;
  if (executable && !existsSync(executable)) throw new Error(`MAWS_E2E_EXECUTABLE does not exist: ${executable} (run pnpm build:app)`);
  const main = join(REPO_ROOT, 'out/main/index.js');
  if (!executable && !existsSync(main)) throw new Error(`${main} does not exist (run pnpm build)`);

  const userData = mkdtempSync(join(tmpdir(), 'maws-e2e-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  // A shell inherited from `electron-vite dev` or an editor must not turn the app into a dev-server client or a Node.
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  env.MAWS_E2E = '1';
  env.MAWS_USER_DATA = userData;

  let app: ElectronApplication | null = null;
  let closed = false;
  const cleanup = async () => {
    try {
      if (app && !closed) await closeOrKill(app);
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  };

  try {
    const launchedAt = Date.now();
    app = executable
      ? await _electron.launch({ executablePath: executable, env, cwd: REPO_ROOT })
      : await _electron.launch({ args: [main], env, cwd: REPO_ROOT });
    app.on('close', () => (closed = true));
    const page = await app.firstWindow();
    const consoleErrors = await collectConsoleErrors(page);
    return { app, page, consoleErrors, userData, packaged: executable !== null, launchedAt, cleanup };
  } catch (error) {
    await cleanup().catch((cleanupError) => console.error('[e2e] cleanup after a failed launch also failed', cleanupError));
    throw error;
  }
}

// One launch per test, closed and removed at teardown; a teardown failure is reported beside the test's own result.
export const test = base.extend<{ maws: MawsLaunch }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
  maws: async ({}, use) => {
    const maws = await launchMaws();
    try {
      await use(maws);
    } finally {
      await maws.cleanup();
    }
  },
});

// Playwright keeps a page's console messages and page errors from before anyone listened (Electron is attached from
// launch), so the first load is covered by seeding from those buffers. Listeners go on first; whatever they received
// by the time a buffer read answers is already in that buffer (one ordered channel), so it is dropped from the live list.
export async function collectConsoleErrors(page: Page): Promise<() => string[]> {
  const liveConsole: string[] = [];
  const livePage: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') liveConsole.push(message.text());
  });
  page.on('pageerror', (error) => livePage.push(`uncaught: ${error.message}`));

  const seededConsole = (await page.consoleMessages({ filter: 'all' })).filter((m) => m.type() === 'error').map((m) => m.text());
  liveConsole.splice(0);
  const seededPage = (await page.pageErrors({ filter: 'all' })).map((error) => `uncaught: ${error.message}`);
  livePage.splice(0);
  return () => [...seededConsole, ...liveConsole, ...seededPage, ...livePage];
}

// `close()` waits for the app to exit; if it fails, the process is killed so no Electron outlives the test, and the
// failure is still thrown, since an app that will not close is itself a defect.
async function closeOrKill(app: ElectronApplication): Promise<void> {
  try {
    await app.close();
  } catch (error) {
    const child = app.process();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    throw new Error(`MAWS did not close cleanly (pid ${child.pid}; killed)`, { cause: error });
  }
}
