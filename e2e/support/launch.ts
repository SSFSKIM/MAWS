// Launches MAWS for an end-to-end test: the built app (`out/main/index.js` under the repo's Electron) by default, or
// the executable named by MAWS_E2E_EXECUTABLE (the packaged `MAWS.app/Contents/MacOS/MAWS`). Every launch gets
// MAWS_E2E=1, a fresh `userData` under the OS temp directory, an empty engine store (`CLAUDE_CONFIG_DIR`) and a scratch
// shell home, so nothing depends on or touches a real profile or the owner's shell history.
// Later children's end-to-end tests start from here, through the `maws` fixture of `test`.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { writeReplayEngine } from '../../test/support/replay-engine';
import { writeScratchShellHome } from '../../test/support/shell-home';
import { launchEnvironment } from './scratch-env';

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
  // E6 start: writes into the launch's scratch homes before the app starts (E6 execution document, Interfaces *Harness and
  // e2e*): the scratch shell home's startup files (so the captured login-shell PATH is the test's) and the engine store's
  // trust file. Called after the shell home is written and `claude-config` created, with the config home the app reads.
  prepare?: (paths: { userData: string; shellHome: string; claudeConfigDir: string }) => void;
  // E6 end
  // E10 start: a relaunch over a given profile whose supervisor may still be running keeps the engine store
  // (`claude-config`) and the replay stub as they are instead of recreating them under it (E10 execution document,
  // Interfaces "Files and environment").
  keepConfigHome?: boolean;
  // E10 end
  // P2-F F-E: a CommonJS module main loads before its own entry and before `ready` (`-r`, as Playwright loads its own
  // loader), so a spec can observe what main does from its first moment (P2-C's restart check records notifications
  // from there). The built app only: the packaged one's fuses refuse Node switches.
  requireFirst?: string;
}
// C5 end

// E4b start: a hook run on the app the moment `_electron.launch` resolves, before anything waits for a window, so a
// scene can read main's stdout and stderr from launch to close (E4b Design §16). The scenes between a spec and
// launchMaws pass no launch options through, so a scene sets the hook around its launch, as it sets its environment.
let launchedHook: ((app: ElectronApplication) => void) | null = null;
export async function onLaunched<T>(hook: (app: ElectronApplication) => void, launch: () => Promise<T>): Promise<T> {
  launchedHook = hook;
  try {
    return await launch();
  } finally {
    launchedHook = null;
  }
}
// E4b end

export async function launchMaws(opts: ShellLaunchOptions = {}): Promise<MawsLaunch> {
  const executable = process.env.MAWS_E2E_EXECUTABLE ? resolve(REPO_ROOT, process.env.MAWS_E2E_EXECUTABLE) : null;
  if (executable && !existsSync(executable)) throw new Error(`MAWS_E2E_EXECUTABLE does not exist: ${executable} (run pnpm build:app)`);
  const main = join(REPO_ROOT, 'out/main/index.js');
  if (!executable && !existsSync(main)) throw new Error(`${main} does not exist (run pnpm build)`);
  if (executable && opts.requireFirst) throw new Error('requireFirst needs the built app, not MAWS_E2E_EXECUTABLE');

  const ownsUserData = opts.userData === undefined; // C5
  const userData = opts.userData ?? mkdtempSync(join(tmpdir(), 'maws-e2e-')); // C5: an existing profile when given
  // C5: a relaunch over a given profile still starts from an empty engine store, which C4's block below creates anew.
  if (!ownsUserData && !opts.keepConfigHome /* E10 */) rmSync(join(userData, 'claude-config'), { recursive: true, force: true });
  // E11 W-E (Decision Log 22): the runner's environment without its CLAUDE* variables or the dev-server and Node
  // switches, with the e2e mark, the profile, the empty engine store (C4) and no ClaudeUsage data (C7):
  // scratch-env.ts's launchEnvironment, pinned by its unit test. A test's `env` may name a CLAUDE* variable on purpose.
  const env = launchEnvironment(process.env, userData);
  // FX4: replay launch gates need a version, not an installed engine. Live specs explicitly pass ENGINE_BIN;
  // an environment override or the Engine setting can still name another binary. The scratch owns this stub.
  const keptStub = opts.keepConfigHome && existsSync(join(userData, 'replay-engine')) ? join(userData, 'replay-engine') : null; // E10
  env.MAWS_E2E_ENGINE_BIN ??= opts.env?.MAWS_E2E_ENGINE_BIN ?? keptStub ?? writeReplayEngine(userData);
  // C4 start: an empty engine store (C4 reads the config home the engine would), so the run never reads the owner's
  // ~/.claude; a test's `env` may still name another.
  mkdirSync(env.CLAUDE_CONFIG_DIR!, { recursive: opts.keepConfigHome === true }); // E10: kept, it may exist
  // C4 end
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
    opts.prepare?.({ userData, shellHome: shellHome.dir, claudeConfigDir: env.CLAUDE_CONFIG_DIR }); // E6: inside, so a throw still cleans up
    const launchedAt = Date.now();
    app = executable
      ? await _electron.launch({ executablePath: executable, env, cwd: REPO_ROOT })
      : await _electron.launch({ args: [...(opts.requireFirst ? ['-r', opts.requireFirst] : []), main], env, cwd: REPO_ROOT });
    launchedHook?.(app); // E4b
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

// P2-F F-E: a run's last cleanup that must not cut its bookkeeping short (the owner-file readings, the spend): the
// failure's words, or null once the app closed (or nothing was launched). The run fails on them after the bookkeeping.
export async function cleanupFailure(launch: MawsLaunch | null | undefined): Promise<string | null> {
  try {
    await launch?.cleanup();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
