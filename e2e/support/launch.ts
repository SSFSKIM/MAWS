// Launches MAWS for an end-to-end test: the built app (`out/main/index.js` under the repo's Electron) by default, or
// the executable named by MAWS_E2E_EXECUTABLE (the packaged `MAWS.app/Contents/MacOS/MAWS`). Every launch gets
// MAWS_E2E=1, a fresh `userData` under the OS temp directory, an empty engine store (`CLAUDE_CONFIG_DIR`) and a scratch
// shell home, so nothing depends on or touches a real profile or the owner's shell history.
// Later children's end-to-end tests start from here, through the `maws` fixture of `test`.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { _electron, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { writeReplayEngine } from '../../test/support/replay-engine';
import { writeScratchShellHome } from '../../test/support/shell-home';
import { writeDiscoverScratch, type DiscoverScratch, type DiscoverScratchOptions } from './discover-scratch'; // P4-AGG M1
import { shellsUnder, untilExited } from './processes';
import { realEngine, type RealEngine } from './real-engine'; // P4-AGG M1
import { assertEngineKeychainEnv, assertNoKeychainPrompt, killTree, loginShellEnvironment, watchKeychainPrompt } from './keychain-guard'; // fixB
import { launchEnvironment } from './scratch-env';
import { cornerOrigin, windowCorner } from './window-origin';

export const REPO_ROOT = resolve(__dirname, '../..');

// Every e2e launch runs the app in en-US, whatever the machine's languages (gate-offload §3.6: the Mac mini's are
// Korean). Chromium's application locale, which the renderer's Intl default and so the app's dates follow, is Cocoa's
// preferred language unless `--lang` names one (Electron 44 resolves it on macOS too). The specs' expectations come from
// the test process's Intl default, which playwright.config.ts pins to the same locale.
export const E2E_APP_ARGS = ['--lang=en-US'];

const applications = new WeakMap<Page, ElectronApplication>();
// Page-only navigation helpers still invoke the real native menu; CDP keyboard events never reach AppKit accelerators.
export function applicationOf(page: Page): ElectronApplication {
  const app = applications.get(page);
  if (!app) throw new Error('The page was not opened by launchMaws');
  return app;
}

export interface MawsLaunch {
  app: ElectronApplication;
  page: Page; // the first window
  consoleErrors(): string[]; // the first window's console errors and uncaught errors so far, from its first load on
  userData: string;
  shellHome: string; // the scratch shell home under `userData` (ZDOTDIR, and where the shells' history goes)
  packaged: boolean;
  launchedAt: number; // Date.now() just before the process was started
  // P4-AGG M1: under the `realEngine` option, the engine the app runs and the scratch written around it
  realEngine?: RealEngine & { scratch: DiscoverScratch };
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
  // P4-A1: the parity bench's arm of record runs on the owner's user scope like any MAWS session (P4 §4.2, X39), so its
  // launch names no CLAUDE_CONFIG_DIR at all: the engine and main then read `~/.claude` and `~/.claude.json` as the
  // owner's own MAWS does (a CLAUDE_CONFIG_DIR of `~/.claude` would move the global config file inside it).
  ownerConfigHome?: boolean;
  // P4-W2L: the app's Chromium locale for this launch instead of en-US (`ko-KR`, the owner's), for a spec showing that
  // every age, date and time stays English whatever the system's (P4 Decision Log 4).
  lang?: string;
  // P4-AGG M1 (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md): the real pinned engine (real-engine.ts:
  // MAWS_E2E_ENGINE_BIN, else the installed 2.1.309; missing or another version fails the launch), with the Discover
  // scratch around it (discover-scratch.ts): the engine's Anthropic Directory off, scratch projects, the test
  // marketplace and its test-source descriptor, the recorded catalog sources, and a scratch HOME unless `home: 'runner'`.
  // The engine store stays the launch's own `claude-config`.
  realEngine?: DiscoverScratchOptions;
  // The two-build check (e2e/cross-build.spec.ts): the root of another checkout, a build of its own (its out/ and its
  // node_modules), whose app runs in this one's place: its out/main/index.js under its own Electron, from its root, as
  // this checkout's runs from here. Its supervisor is then that build's, spawned from its own bundle.
  root?: string;
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
  // P4-AGG M1: verified before anything is created, so a missing engine leaves nothing behind; the scratch is written
  // into the launch's own engine store, which another one named by the test would bypass.
  if (opts.realEngine && (opts.env?.CLAUDE_CONFIG_DIR !== undefined || opts.ownerConfigHome)) throw new Error('realEngine writes its scratch into the launch’s own engine store: name no other');
  const engine = opts.realEngine ? realEngine() : null;
  const executable = process.env.MAWS_E2E_EXECUTABLE ? resolve(REPO_ROOT, process.env.MAWS_E2E_EXECUTABLE) : null;
  if (executable && !existsSync(executable)) throw new Error(`MAWS_E2E_EXECUTABLE does not exist: ${executable} (run pnpm build:app)`);
  if (executable && opts.root !== undefined) throw new Error('root names a built checkout, not MAWS_E2E_EXECUTABLE');
  const root = opts.root ?? REPO_ROOT; // the two-build check's other checkout, or this one
  const main = join(root, 'out/main/index.js');
  if (!executable && !existsSync(main)) throw new Error(`${main} does not exist (run pnpm build)`);
  if (executable && opts.requireFirst) throw new Error('requireFirst needs the built app, not MAWS_E2E_EXECUTABLE');
  // the other checkout's own Electron, as its `electron` package names it (the path its install wrote). Playwright requires
  // its loader only into the Electron it resolves itself, so it is required into this one by hand: the other build's app
  // then starts as this checkout's does, its `ready` held until Playwright has attached (so main's first lines are read)
  // and Playwright's Chromium switches on.
  const electron = opts.root === undefined ? undefined : (createRequire(join(root, 'package.json'))('electron') as string);
  const loader = electron === undefined ? [] : ['-r', join(dirname(createRequire(join(REPO_ROOT, 'package.json')).resolve('playwright-core/package.json')), 'lib/server/electron/loader.js')];

  const ownsUserData = opts.userData === undefined; // C5
  const userData = opts.userData ?? mkdtempSync(join(tmpdir(), 'maws-e2e-')); // C5: an existing profile when given
  // C5: a relaunch over a given profile still starts from an empty engine store, which C4's block below creates anew.
  if (!ownsUserData && !opts.keepConfigHome /* E10 */) rmSync(join(userData, 'claude-config'), { recursive: true, force: true });
  // E11 W-E (Decision Log 22): the runner's environment without its CLAUDE* variables or the dev-server and Node
  // switches, with the e2e mark, the profile, the empty engine store (C4) and no ClaudeUsage data (C7):
  // scratch-env.ts's launchEnvironment, pinned by its unit test. A test's `env` may name a CLAUDE* variable on purpose.
  const env = launchEnvironment(process.env, userData);
  if (engine) env.MAWS_E2E_ENGINE_BIN = engine.bin; // P4-AGG M1: the real engine, never the replay stub
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
  const discover = opts.realEngine ? writeDiscoverScratch(userData, env.CLAUDE_CONFIG_DIR!, opts.realEngine) : null; // P4-AGG M1
  if (discover) Object.assign(env, discover.env);
  Object.assign(env, opts.env); // C3
  if (opts.ownerConfigHome) delete env.CLAUDE_CONFIG_DIR; // P4-A1
  // fixB keychain conditions (b)(c): a real engine on a Mac can reach the login keychain (under the runner's HOME it is
  // the owner's). No prompt may be pending before the app starts; under the runner's HOME, the login shell the engine
  // host builds every engine's environment from must name the scratch store and nothing that renames the engine's items
  // (keychain-guard.ts); while the app runs, a prompt stops it at once and fails the test at its cleanup.
  const keychainScene = Boolean(opts.realEngine) && process.platform === 'darwin';
  let keychainWatch: { stop(): Error | null } | null = null;

  let app: ElectronApplication | null = null;
  let child: ReturnType<ElectronApplication['process']> | null = null;
  let closed = false;
  const cleanup = async () => {
    const prompted = keychainWatch?.stop() ?? null;
    keychainWatch = null;
    // P3-F (the terminal e2e's ENOTEMPTY, tracker 2026-10-17): a shell the app started saves its history into the shell
    // home as it exits on its terminal's hang-up, which can come after the app has closed, so the removal waits for the
    // shells it found before the close (never signalling one) and retries a directory that filled meanwhile.
    const shells = child && !closed ? shellsUnder(child.pid!) : [];
    try {
      if (app && child && !closed) await closeOrKill(app, child);
    } finally {
      const left = await untilExited(shells, SHELL_EXIT_MS);
      if (left.length > 0) console.error(`[e2e] shells still running ${SHELL_EXIT_MS} ms after the app closed: ${left.map((p) => p.pid).join(', ')}`);
      if (ownsUserData) rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); // C5: a given profile is the caller's
    }
    if (prompted) throw prompted;
    if (keychainScene) assertNoKeychainPrompt('after the app closed');
  };

  try {
    if (keychainScene) {
      assertNoKeychainPrompt('before the app launches');
      if (opts.realEngine?.home === 'runner') assertEngineKeychainEnv(loginShellEnvironment(env), env.CLAUDE_CONFIG_DIR!, 'the login shell the engine host captures');
    }
    opts.prepare?.({ userData, shellHome: shellHome.dir, claudeConfigDir: env.CLAUDE_CONFIG_DIR }); // E6: inside, so a throw still cleans up
    const launchedAt = Date.now();
    const appArgs = opts.lang ? [`--lang=${opts.lang}`] : E2E_APP_ARGS; // P4-W2L
    app = executable
      ? await _electron.launch({ executablePath: executable, args: appArgs, env, cwd: REPO_ROOT })
      : await _electron.launch({ ...(electron !== undefined && { executablePath: electron }), args: [...loader, ...(opts.requireFirst ? ['-r', opts.requireFirst] : []), ...appArgs, main], env, cwd: root });
    // Playwright's process() reads its live application channel, which may already be disposed before 'close' arrives.
    // Keep the actual ChildProcess while available, including for cleanup's failed-close fallback.
    child = app.process();
    if (keychainScene) keychainWatch = watchKeychainPrompt(() => child?.pid !== undefined && killTree(child.pid)); // the app, its hosts, their engines and their `security` children
    launchedHook?.(app); // E4b
    app.on('close', () => (closed = true));
    const page = await app.firstWindow();
    applications.set(page, app);
    const consoleErrors = await collectConsoleErrors(page);
    await sizeForGroup(app, page); // P3-F1
    await placeForInstance(app); // ci-kit's mac-lane concurrency spec, M2
    await reportForeground(app);
    return { app, page, consoleErrors, userData, shellHome: shellHome.dir, packaged: executable !== null, launchedAt, ...(engine && discover && { realEngine: { ...engine, scratch: discover } }), cleanup };
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

// P3-F1 (docs/doperpowers/ledgers/2026-10-17-P3-F1.md): a group whose fixture needs a bigger first window than the
// default 1280 × 820 names it in its package script as `MAWS_E2E_WINDOW_SIZE=<width>x<height>` (the test process's
// environment, so the app runs as it always does): `e2e:document`'s two replicas side by side need 720 px each to keep the
// document editor's rail beside the page. The window's content is set to that size before the launch returns.
async function sizeForGroup(app: ElectronApplication, page: Page): Promise<void> {
  const value = process.env.MAWS_E2E_WINDOW_SIZE;
  if (!value) return;
  const size = /^(\d+)x(\d+)$/.exec(value);
  if (!size) throw new Error(`MAWS_E2E_WINDOW_SIZE is <width>x<height>, not ${value}`);
  const [width, height] = [Number(size[1]), Number(size[2])];
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())!.setContentSize(w, h), [width, height] as const);
  await page.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [width, height] as const);
}

// ci-kit's mac-lane concurrency spec, M2 (its audit's H6): on a shared runner instance the first window moves to the
// corner of the primary display's work area its instance takes (window-origin.ts), after sizeForGroup so the corner
// holds the window's own size; anywhere else it stays where the app put it.
async function placeForInstance(app: ElectronApplication): Promise<void> {
  const corner = windowCorner(process.env);
  if (corner === null) return;
  const { area, size } = await app.evaluate(({ BrowserWindow, screen }) => {
    const [width, height] = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())!.getSize();
    return { area: screen.getPrimaryDisplay().workArea, size: { width: width!, height: height! } };
  });
  const { x, y } = cornerOrigin(corner, area, size);
  await app.evaluate(({ BrowserWindow }, [x, y]) => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())!.setPosition(x, y), [x, y] as const);
}

// Under MAWS_E2E_FOREGROUND=1 (src/main/window-show.ts) the app activates and its window
// becomes key. Whether macOS granted that is said once per worker in the run's output, so a run on a desktop where
// another app holds focus shows it.
let foregroundReported = false;
async function reportForeground(app: ElectronApplication): Promise<void> {
  if (process.env.MAWS_E2E_FOREGROUND !== '1' || foregroundReported) return;
  foregroundReported = true;
  const keyed = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((win) => win.isFocused())).catch(() => false);
  const until = Date.now() + 3_000;
  let key = await keyed();
  while (!key && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    key = await keyed();
  }
  console.log(`[e2e] MAWS_E2E_FOREGROUND: the first window ${key ? 'is key' : 'is not key after 3 s (another app holds focus)'}`);
}

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

// How long a launch's cleanup waits for the app's shells to exit after the app closed: a hung-up shell saves its history
// and exits within milliseconds; one still running then is named and the removal goes ahead.
const SHELL_EXIT_MS = 5_000;

// `close()` waits for the app to exit; if it fails, the process is killed so no Electron outlives the test, and the
// failure is still thrown, since an app that will not close is itself a defect.
async function closeOrKill(app: ElectronApplication, child: ReturnType<ElectronApplication['process']>): Promise<void> {
  try {
    await app.close();
  } catch (error) {
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
