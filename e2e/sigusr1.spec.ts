// MAWS's main process opens no Node inspector on a same-user SIGUSR1 (cua docs/doperpowers/specs/
// 2026-10-09-maws-socket-peer-auth-design.md, Decision Log 2026-10-10; the tracker's E13 row): without the no-op listener
// at main's entry (src/main/index.ts) the signal opened one on 127.0.0.1:9229, a route around the cua socket's peer
// check. Playwright's own launch passes `--inspect=0`, so its app already has an inspector and cannot show this; the case
// starts the app itself (the built `out/main/index.js` under the repository's Electron, or the executable
// MAWS_E2E_EXECUTABLE names, so `pnpm e2e:packaged` checks the packaged app) over a scratch profile, signals only that
// process, and takes it down with everything naming its profile. That every other suite still drives the app through
// `--inspect=0` is the other half of the decision.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { writeReplayEngine } from '../test/support/replay-engine';
import { writeScratchShellHome } from '../test/support/shell-home';
import { REPO_ROOT } from './support/launch';
import { INSPECTOR_LINE, inspectorPortHolders, isAlive, killScratchProcesses, tcpListeners } from './support/processes';
import { launchEnvironment } from './support/scratch-env';

test('a same-user SIGUSR1 opens no inspector in MAWS main', async () => {
  test.setTimeout(90_000);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-sigusr1-')));
  const userData = join(root, 'ud');
  mkdirSync(userData);
  const env: Record<string, string> = { ...launchEnvironment(process.env, userData), MAWS_HARNESS: '0', MAWS_E2E_QUIET: '1' };
  env.MAWS_E2E_ENGINE_BIN = writeReplayEngine(userData);
  mkdirSync(env.CLAUDE_CONFIG_DIR!, { recursive: true });
  Object.assign(env, writeScratchShellHome(join(userData, 'shell-home')).env);
  const executable = process.env.MAWS_E2E_EXECUTABLE ? resolve(REPO_ROOT, process.env.MAWS_E2E_EXECUTABLE) : null;
  const child = executable
    ? spawn(executable, [], { env, cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'pipe'] })
    : spawn(createRequire(__filename)('electron') as string, [join(REPO_ROOT, 'out/main/index.js')], { env, cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr!.on('data', (chunk) => (stderr += String(chunk)));
  const exited = new Promise<void>((done) => child.once('exit', () => done()));
  const pid = child.pid!;
  try {
    // main is past its entry once the browser has made the cua socket directory
    await expect.poll(() => existsSync(join(userData, 'browser', 'cua')), { timeout: 30_000, message: 'main started its browser' }).toBe(true);
    expect(inspectorPortHolders(), 'something already listens on 127.0.0.1:9229: free it, or an inspector could not bind and this check would pass falsely').toEqual([]);
    const before = tcpListeners(pid);
    process.kill(pid, 'SIGUSR1');
    await new Promise((settle) => setTimeout(settle, 1_500));
    expect(isAlive(pid), 'main survives SIGUSR1').toBe(true);
    expect(tcpListeners(pid), 'no inspector opened in main').toEqual(before);
    expect(stderr, 'no inspector started or tried to start').not.toMatch(INSPECTOR_LINE);
  } finally {
    // main lingers on SIGTERM (no handler of its own), so it is killed; its helpers name the profile and are swept
    child.kill('SIGKILL');
    await Promise.race([exited, new Promise((settle) => setTimeout(settle, 10_000))]);
    await killScratchProcesses(root, []).catch((error: unknown) => console.error(error));
    rmSync(root, { recursive: true, force: true });
  }
});
