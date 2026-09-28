// Launches MAWS for an end-to-end test: the built app (`out/main/index.js` under the repo's Electron) by default, or
// the executable named by MAWS_E2E_EXECUTABLE (the packaged `MAWS.app/Contents/MacOS/MAWS`). Every launch gets
// MAWS_E2E=1 and a fresh `userData` under the OS temp directory, so nothing depends on or touches a real profile.
// Later children's end-to-end tests start from here.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, type ElectronApplication, type Page } from '@playwright/test';

export const REPO_ROOT = resolve(__dirname, '../..');

export interface MawsLaunch {
  app: ElectronApplication;
  page: Page; // the first window
  consoleErrors: string[]; // the first window's console errors and uncaught errors since it was found
  userData: string;
  packaged: boolean;
  cleanup(): Promise<void>; // closes the app if it is still open and removes the temporary profile
}

export async function launchMaws(): Promise<MawsLaunch> {
  const userData = mkdtempSync(join(tmpdir(), 'maws-e2e-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  // A shell inherited from `electron-vite dev` or an editor must not turn the app into a dev-server client or a Node.
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  env.MAWS_E2E = '1';
  env.MAWS_USER_DATA = userData;

  const executable = process.env.MAWS_E2E_EXECUTABLE ? resolve(REPO_ROOT, process.env.MAWS_E2E_EXECUTABLE) : null;
  if (executable && !existsSync(executable)) throw new Error(`MAWS_E2E_EXECUTABLE does not exist: ${executable} (run pnpm build:app)`);
  const main = join(REPO_ROOT, 'out/main/index.js');
  if (!executable && !existsSync(main)) throw new Error(`${main} does not exist (run pnpm build)`);

  const app = executable
    ? await _electron.launch({ executablePath: executable, env, cwd: REPO_ROOT })
    : await _electron.launch({ args: [main], env, cwd: REPO_ROOT });
  let closed = false;
  app.on('close', () => (closed = true));
  const page = await app.firstWindow();
  // From here on (a reload included) every console error and uncaught page error is kept for the test to assert on.
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`uncaught: ${error.message}`));

  return {
    app,
    page,
    consoleErrors,
    userData,
    packaged: executable !== null,
    async cleanup() {
      if (!closed) await app.close().catch(() => {});
      rmSync(userData, { recursive: true, force: true });
    },
  };
}
