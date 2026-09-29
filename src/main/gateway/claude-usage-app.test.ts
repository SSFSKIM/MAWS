import { describe, expect, it, vi } from 'vitest';
import { commands } from '@shared/ipc/schema';
import { CLAUDE_USAGE_BUNDLE_ID, createClaudeUsageApp, execRunner, INSTALLED_TTL_MS, OPEN_TIMEOUT_MS, type ClaudeUsageAppDeps } from './claude-usage-app';

// `run` stands in for execFile (never the real /usr/bin/open against the owner's app): it answers mdfind with the app's
// path and open with nothing, unless a test scripts a failure.
const MDFIND_QUERY = `kMDItemCFBundleIdentifier == '${CLAUDE_USAGE_BUNDLE_ID}'`;
const APP_PATH = '/Applications/ClaudeUsage.app\n';
function harness(overrides: Partial<ClaudeUsageAppDeps> = {}) {
  let now = Date.parse('2026-09-29T08:00:00.000Z');
  const run = vi.fn<ClaudeUsageAppDeps['run']>(async (file) => ({ stdout: file === '/usr/bin/mdfind' ? APP_PATH : '' }));
  const deps: ClaudeUsageAppDeps = { run, relayRunning: async () => true, dataDirPresent: async () => true, now: () => now, ...overrides };
  return { app: createClaudeUsageApp(deps), run: (deps.run as typeof run), advance: (ms: number) => void (now += ms) };
}
const exitError = (code: number, stderr: string) => Object.assign(new Error(`Command failed: /usr/bin/open\n${stderr}`), { code, stderr });

describe('claude-usage launcher opens by bundle id and reports not_installed', () => {
  it('opens ClaudeUsage by bundle id through /usr/bin/open with a 5 s timeout, and hands back the instruction for the panel', async () => {
    const { app, run } = harness();
    expect(await app.open({ intent: 'panel' })).toEqual({ opened: true, reason: null, instruction: 'ClaudeUsage is in the menu bar · click its icon' });
    expect(run).toHaveBeenCalledExactlyOnceWith('/usr/bin/open', ['-b', 'com.haegi.ClaudeUsage'], OPEN_TIMEOUT_MS);
    expect(OPEN_TIMEOUT_MS).toBe(5_000);
  });

  it('names the control in its panel for each account intent, and the email for the two that carry one', async () => {
    const { app } = harness();
    expect((await app.open({ intent: 'addAccount' })).instruction).toBe('ClaudeUsage is in the menu bar · click its icon, then Add account…');
    expect((await app.open({ intent: 'reconnect', accountEmail: '1@example.test' })).instruction).toBe('ClaudeUsage is in the menu bar · click its icon, then Reconnect… beside 1@example.test');
    expect((await app.open({ intent: 'remove', accountEmail: '2@example.test' })).instruction).toBe('ClaudeUsage is in the menu bar · click its icon, then Remove account… beside 2@example.test');
  });

  it('answers not_installed when open exits 1 with Unable to find application, still naming the email for reconnect', async () => {
    const { app } = harness({ run: async () => Promise.reject(exitError(1, 'Unable to find application with bundle identifier com.haegi.ClaudeUsage\n')) });
    const result = await app.open({ intent: 'reconnect', accountEmail: '1@example.test' });
    expect(result).toEqual({ opened: false, reason: 'not_installed', instruction: expect.stringContaining('Reconnect… beside 1@example.test') });
    expect(result.instruction).toMatch(/^ClaudeUsage is not installed/);
  });

  it.each([
    ['current macOS', 'LSCopyApplicationURLsForBundleIdentifier() failed while trying to determine the application with bundle identifier com.haegi.ClaudeUsage.\n'],
    ['older macOS', 'Unable to find application with bundle identifier com.haegi.ClaudeUsage\n'],
  ])('reads the %s stderr of an unknown bundle id as not_installed', async (_, stderr) => {
    const { app } = harness({ run: async () => Promise.reject(exitError(1, stderr)) });
    expect(await app.open({ intent: 'panel' })).toMatchObject({ opened: false, reason: 'not_installed' });
  });

  it('answers launch_failed for any other failure: another exit, a timeout, a missing /usr/bin/open', async () => {
    for (const error of [exitError(1, 'LSOpenURLsWithRole() failed with error -10810'), Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }), Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })]) {
      const { app } = harness({ run: async () => Promise.reject(error) });
      expect(await app.open({ intent: 'panel' })).toEqual({ opened: false, reason: 'launch_failed', instruction: expect.stringMatching(/^ClaudeUsage did not open/) });
    }
  });
});

describe('settings.claudeUsage.status', () => {
  it('reports installed from Spotlight, running from the relay check and the data directory from the reader', async () => {
    const { app, run } = harness({ relayRunning: async () => false, dataDirPresent: async () => true });
    expect(await app.status()).toEqual({ installed: true, running: false, bundleId: 'com.haegi.ClaudeUsage', dataDirPresent: true, checkedAt: '2026-09-29T08:00:00.000Z' });
    expect(run).toHaveBeenCalledExactlyOnceWith('/usr/bin/mdfind', [MDFIND_QUERY], expect.any(Number));
    expect(commands['settings.claudeUsage.status'].output.safeParse(await app.status()).success).toBe(true);
  });

  it('reads installed as false from an empty or failed mdfind', async () => {
    expect((await harness({ run: async () => ({ stdout: '\n' }) }).app.status()).installed).toBe(false);
    expect((await harness({ run: async () => Promise.reject(new Error('mdfind: no index')) }).app.status()).installed).toBe(false);
  });

  it('caches installed for 60 s, and an open outcome refreshes it', async () => {
    const { app, run, advance } = harness();
    await app.status();
    advance(INSTALLED_TTL_MS - 1);
    await app.status();
    expect(run.mock.calls.filter(([file]) => file === '/usr/bin/mdfind')).toHaveLength(1);
    advance(1);
    await app.status();
    expect(run.mock.calls.filter(([file]) => file === '/usr/bin/mdfind')).toHaveLength(2);
    expect(INSTALLED_TTL_MS).toBe(60_000);

    run.mockImplementation(async (file) => (file === '/usr/bin/open' ? Promise.reject(exitError(1, 'Unable to find application')) : { stdout: APP_PATH }));
    await app.open({ intent: 'panel' });
    expect((await app.status()).installed).toBe(false); // the open's answer, not a stale Spotlight reading
    expect(run.mock.calls.filter(([file]) => file === '/usr/bin/mdfind')).toHaveLength(2);
  });
});

describe('execRunner', () => {
  it('answers stdout, and rejects with the exit code and stderr', async () => {
    expect(await execRunner('/bin/echo', ['hi'], 5_000)).toEqual({ stdout: 'hi\n' });
    await expect(execRunner('/bin/sh', ['-c', 'echo nope >&2; exit 3'], 5_000)).rejects.toMatchObject({ code: 3, stderr: 'nope\n' });
  });
});
