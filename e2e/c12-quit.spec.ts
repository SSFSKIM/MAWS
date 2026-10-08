// C12's quit question end to end (C12 execution document, M4, Acceptance item 8 and Concrete Steps "M4 quit"): the built
// app over C3's replay transport and C9's real PTY host, answered through MAWS_E2E_QUIT_ANSWER (no native dialog). The
// busy work is a replayed session with background tasks and no turn (pass3/engine-turn-release.jsonl, held after its
// first turn at the fixture's next `user` write with two background `sleep`s running) and a terminal running
// `sleep 3600`:
//   - a quit asks with both parts named, and `cancel` keeps the app;
//   - `when_idle` shows the banner and quits once the replayed tasks settle (the fixture's next turn, then the engine's
//     own follow-up turn after `background_tasks_changed []`) and the terminal's command ends (^C);
//   - a quit with nothing busy asks nothing and exits within the probe bound.
// Run by `pnpm e2e:c12` (MAWS_C12_E2E=1), part of `pnpm verify`.
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import { invoke, launchReady, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';

test.skip(process.env.MAWS_C12_E2E !== '1', 'the quit e2e runs under pnpm e2e:c12 (MAWS_C12_E2E=1)');

const FIXTURE = 'spikes/protocol-probe/fixtures/pass3/engine-turn-release.jsonl';
const PROBE_BOUND_MS = 2_000;

function firstPrompt(): string {
  for (const line of readFileSync(join(REPO_ROOT, FIXTURE), 'utf8').split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line) as { direction: string; frame: { type: string; message?: { content: string } } };
    if (row.direction === 'out' && row.frame.type === 'user') return row.frame.message!.content;
  }
  throw new Error(`${FIXTURE} records no prompt`);
}

function stderrOf(app: ElectronApplication): () => string[] {
  let text = '';
  app.process().stderr?.on('data', (chunk) => (text += String(chunk)));
  return () => text.split('\n').filter((line) => line.startsWith('quit-guard:') || line.startsWith('quit-report:'));
}

const exited = (app: ElectronApplication) => new Promise<number>((resolve) => app.process().once('exit', () => resolve(Date.now())));
// The app's exit, bounded so a quit that never comes fails here with the guard's own lines instead of the test timeout.
async function exitWithin(gone: Promise<number>, ms: number, lines: () => string[]): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`MAWS did not quit within ${ms} ms; the guard said: ${JSON.stringify(lines())}`)), ms)));
  try {
    return await Promise.race([gone, late]);
  } finally {
    clearTimeout(timer);
  }
}
const quit = (app: ElectronApplication) => app.evaluate(({ app: electronApp }) => electronApp.quit());
const answerWith = (app: ElectronApplication, answer: 'cancel' | 'when_idle' | 'quit') =>
  app.evaluate((_electron, a) => {
    process.env.MAWS_E2E_QUIT_ANSWER = a;
  }, answer);

// A session C4 files from a transcript in the scratch config home, so the replayed launch's statuses reach main's read
// model under a record (the quit report reads the read model).
function seedRecord(config: string, repo: string): string {
  const sessionId = randomUUID();
  const project = join(config, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  const row = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: 'quit e2e session' }, uuid: randomUUID(), timestamp: '2026-09-29T10:00:00.000Z', cwd: repo, sessionId, version: '2.1.283' };
  writeFileSync(join(project, `${sessionId}.jsonl`), `${JSON.stringify(row)}\n`);
  return sessionId;
}

const statusOf = async (page: Page, id: string) => value(await invoke(page, 'session.status', { appSessionId: id as AppSessionId }));

// eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
test('quit names a replayed session’s background work and a busy terminal; cancel keeps the app; quit when idle waits for both', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-c12-quit-')));
  const repo = join(root, 'repo');
  const config = join(root, 'claude-config');
  let maws: MawsLaunch | undefined;
  let child: ReturnType<ElectronApplication['process']> | undefined;
  try {
    mkdirSync(repo);
    const engineId = seedRecord(config, repo);
    maws = await launchMaws({ env: { MAWS_HARNESS: '0', MAWS_ENGINE_REPLAY: '1', CLAUDE_CONFIG_DIR: config, MAWS_E2E_QUIT_ANSWER: 'cancel' } });
    child = maws.app.process(); // Playwright drops app.process() when the app closes; teardown still needs the handle.
    const lines = stderrOf(maws.app);
    const { app, page } = maws;
    let id = '';
    await expect.poll(async () => (id = value(await invoke(page, 'session.list', {})).sessions.find((s) => s.engineSessionId === engineId)?.appId ?? '')).not.toBe('');

    // the replayed session: its first turn ends with two background sleeps running; the replay holds at its next write
    await launchReady(page, id, FIXTURE, { cwd: repo });
    value(await invoke(page, 'session.send', { appSessionId: id as AppSessionId, content: firstPrompt() }));
    await expect.poll(async () => {
      const s = await statusOf(page, id);
      return s.turn === null && s.backgroundTasks.length;
    }).toBe(2);

    // Keep the terminal busy beyond this test's 120 s timeout; only the explicit Ctrl-C below releases it.
    const { ptyId } = value(await invoke(page, 'pty.spawn', { appSessionId: id as AppSessionId, label: 'c12-quit', cwd: repo, cols: 80, rows: 24, shell: '/bin/sh', args: [], command: 'sleep 3600' }));
    // A cold pty can report spawn-helper or the startup wrapper as busy before the shell reaches its prompt.
    // Wait for our command, not that transient busy reading, before comparing the renderer and quit probes.
    await expect.poll(async () => value(await invoke(page, 'pty.foreground', { ptyId }))).toEqual({ process: 'sleep', busy: true });

    // a quit asks with both parts named; cancel keeps the app
    await quit(app);
    await expect.poll(lines).toContain('quit-guard: 1 background work, 1 busy terminal, auto-answered cancel');
    expect(value(await invoke(page, 'session.status', { appSessionId: id as AppSessionId })).process).toBe('ready'); // still running
    const busyReport = lines().find((l) => l.startsWith('quit-report:'))!;
    expect(busyReport).toMatch(/^quit-report: \d+ ms · 1 background work, 1 busy terminal$/);
    console.log(`[c12-quit] busy ${busyReport}`); // the report's latency with one terminal probed
    const banner = page.locator('[data-banner-host]').getByRole('status').filter({ hasText: 'MAWS will quit when' });
    await expect(banner).toHaveCount(0);

    // quit when idle: the banner, then the quit once both finish
    await answerWith(app, 'when_idle');
    const gone = exited(app);
    await quit(app);
    await expect.poll(lines).toContain('quit-guard: 1 background work, 1 busy terminal, auto-answered when_idle');
    await expect(banner).toHaveText(/MAWS will quit when 2 things finish/);
    await expect(banner.getByRole('button', { name: 'Quit now' })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('quit-when-idle.png') });

    // the replayed tasks settle: the fixture's next turn, then the engine's own turn after background_tasks_changed []
    value(await invoke(page, 'session.send', { appSessionId: id as AppSessionId, content: 'continue' }));
    await expect.poll(async () => {
      const s = await statusOf(page, id);
      return s.turn === null && s.backgroundTasks.length === 0 && s.engineState !== 'running';
    }, { timeout: 30_000 }).toBe(true);
    await expect(banner).toHaveText(/MAWS will quit when 1 thing finishes/); // the terminal still runs
    expect(app.process().exitCode).toBeNull();

    // the terminal's command ends; within the 2 s re-read the app quits
    const ended = Date.now();
    value(await invoke(page, 'pty.write', { ptyId, data: '\x03' }));
    const exitAt = await exitWithin(gone, 20_000, lines);
    testInfo.annotations.push({ type: 'quit after the last busy thing ended', description: `${exitAt - ended} ms` });
    expect(exitAt - ended).toBeLessThan(10_000);
  } finally {
    try {
      if (maws) {
        // Assertion failures can leave either cancel or when_idle armed while sleep is still running.
        // Let the ordinary close path stop both hosts instead of waiting for that hour-long command.
        const process = child;
        if (process && process.exitCode === null && process.signalCode === null) {
          await answerWith(maws.app, 'quit').catch(() => {
            if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL');
          });
        }
        await maws.cleanup();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

// eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
test('a quit with nothing busy asks nothing and exits within the probe bound', async ({}, testInfo) => {
  const maws = await launchMaws({ env: { MAWS_HARNESS: '0' } });
  const lines = stderrOf(maws.app);
  try {
    const { app, page } = maws;
    await expect(page.locator('[data-region="main"]')).toBeVisible();
    // E11 (tracker row E10 "14 will-quit listeners"; scale review E scalpel-1#1): main's will-quit steps run behind one
    // listener (src/main/lifecycle/shutdown.ts). Counted in main: a warning on stderr cannot be caught, since every
    // registration runs inside whenReady, before `_electron.launch` resolves and any listener on stderr attaches.
    expect(await app.evaluate(({ app: electron }) => electron.listenerCount('will-quit')), 'one will-quit listener').toBe(1);
    const started = Date.now();
    const gone = exited(app);
    await quit(app);
    const exitAt = await exitWithin(gone, 20_000, lines);
    const report = lines().find((l) => l.startsWith('quit-report:'));
    expect(report).toMatch(/^quit-report: \d+ ms · nothing busy$/);
    const reportMs = Number(/(\d+) ms/.exec(report!)![1]);
    expect(reportMs).toBeLessThan(PROBE_BOUND_MS);
    expect(lines().filter((l) => l.startsWith('quit-guard:')), 'no question').toEqual([]);
    testInfo.annotations.push({ type: 'quit latency', description: `report ${reportMs} ms; quit to exit ${exitAt - started} ms` });
    console.log(`[c12-quit] report ${reportMs} ms; quit to exit ${exitAt - started} ms`);
    expect(exitAt - started).toBeLessThan(PROBE_BOUND_MS + 8_000); // the report, then the existing quit path (the hosts stop)
  } finally {
    await maws.cleanup();
  }
});
