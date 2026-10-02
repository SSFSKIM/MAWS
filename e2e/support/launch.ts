// Launches MAWS for an end-to-end test: the built app (`out/main/index.js` under the repo's Electron) by default, or
// the executable named by MAWS_E2E_EXECUTABLE (the packaged `MAWS.app/Contents/MacOS/MAWS`). Every launch gets
// MAWS_E2E=1, a fresh `userData` under the OS temp directory, an empty engine store (`CLAUDE_CONFIG_DIR`) and a scratch
// shell home, so nothing depends on or touches a real profile or the owner's shell history.
// Later children's end-to-end tests start from here, through the `maws` fixture of `test`.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { ENGINE_BIN } from '../../test/support/engine-pin'; // W13
import { writeScratchShellHome } from '../../test/support/shell-home';

export const REPO_ROOT = resolve(__dirname, '../..');

export interface MawsLaunch {
  app: ElectronApplication;
  page: Page; // the first window
  consoleErrors(): string[]; // the first window's console errors and uncaught errors so far, from its first load on
  userData: string;
  shellHome: string; // the scratch shell home under `userData` (ZDOTDIR, and where the shells' history goes)
  packaged: boolean;
  launchedAt: number; // Date.now() just before the process was started
  cleanup(): Promise<void>; // closes the app if it is still open and removes the profile it created; throws if the app would not close
}

// C3 start: `env` adds variables to the launch's environment (MAWS_ENGINE_REPLAY=1 for C3's replay test; C5, C6 and
// C9 reuse it, through the `mawsEnv` option below, instead of editing this file).
export interface MawsLaunchOptions {
  env?: Record<string, string>;
}
// C3 end

// C5 start: relaunch over a profile. The shell smoke checks persistence by relaunching over the profile its first launch
// wrote. A launch given `userData` runs over that directory instead of a fresh one and leaves it in place at cleanup;
// whoever created it removes it.
export interface ShellLaunchOptions extends MawsLaunchOptions {
  userData?: string;
}
// C5 end

export async function launchMaws(opts: ShellLaunchOptions = {}): Promise<MawsLaunch> {
  const executable = process.env.MAWS_E2E_EXECUTABLE ? resolve(REPO_ROOT, process.env.MAWS_E2E_EXECUTABLE) : null;
  if (executable && !existsSync(executable)) throw new Error(`MAWS_E2E_EXECUTABLE does not exist: ${executable} (run pnpm build:app)`);
  const main = join(REPO_ROOT, 'out/main/index.js');
  if (!executable && !existsSync(main)) throw new Error(`${main} does not exist (run pnpm build)`);

  const ownsUserData = opts.userData === undefined; // C5
  const userData = opts.userData ?? mkdtempSync(join(tmpdir(), 'maws-e2e-')); // C5: an existing profile when given
  // C5: a relaunch over a given profile still starts from an empty engine store, which C4's block below creates anew.
  if (!ownsUserData) rmSync(join(userData, 'claude-config'), { recursive: true, force: true });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  // A shell inherited from `electron-vite dev` or an editor must not turn the app into a dev-server client or a Node.
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  env.MAWS_E2E = '1';
  env.MAWS_USER_DATA = userData;
  // W13: an e2e run's engine is named, never the user's installed Claude Code: the fixtures' pin unless the runner says
  // otherwise (a test's `env`, or the Engine setting, still names another)
  env.MAWS_E2E_ENGINE_BIN ??= ENGINE_BIN;
  // C4 start: an empty engine store (C4 reads the config home the engine would), so the run never reads the owner's
  // ~/.claude; a test's `env` may still name another.
  env.CLAUDE_CONFIG_DIR = join(userData, 'claude-config');
  mkdirSync(env.CLAUDE_CONFIG_DIR);
  // C4 end
  // C7 start: no ClaudeUsage data (a directory that does not exist), so the status line never reads the owner's
  // ~/Library/Application Support/ClaudeUsage; statusline.spec.ts names its own copy of the fixture.
  env.MAWS_CLAUDE_USAGE_DIR = join(userData, 'claude-usage');
  // C7 end
  // Every shell the app starts (a terminal, the echo test's, the hosts' login-shell captures) reads its zsh startup files
  // from the profile's scratch shell home and writes its history there (test/support/shell-home.ts): a shell left
  // running when the app quits saves its typed commands on the SIGHUP, which went to ~/.zsh_history. So the captured
  // environment is the runner's plus the system profiles, not the owner's zsh files. HOME stays the owner's, which main
  // and the engine read.
  const shellHome = writeScratchShellHome(join(userData, 'shell-home'));
  Object.assign(env, shellHome.env);
  Object.assign(env, opts.env); // C3

  let app: ElectronApplication | null = null;
  let closed = false;
  const cleanup = async () => {
    try {
      if (app && !closed) await closeOrKill(app);
    } finally {
      if (ownsUserData) rmSync(userData, { recursive: true, force: true }); // C5: a given profile is the caller's
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
    return { app, page, consoleErrors, userData, shellHome: shellHome.dir, packaged: executable !== null, launchedAt, cleanup };
  } catch (error) {
    await cleanup().catch((cleanupError) => console.error('[e2e] cleanup after a failed launch also failed', cleanupError));
    throw error;
  }
}

// One launch per test, closed and removed at teardown; a teardown failure is reported beside the test's own result.
// C3: `test.use({ mawsEnv: { … } })` sets extra environment variables for a file's launches.
export const test = base.extend<{ maws: MawsLaunch; mawsEnv: Record<string, string> }>({
  mawsEnv: [{}, { option: true }], // C3
  maws: async ({ mawsEnv }, use) => {
    const maws = await launchMaws({ env: mawsEnv }); // C3: the env option
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
