// One writer for the machine's data (P5 O3-A; docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §2, binding; O3-A
// acceptance 5), end to end on a scratch profile. A launch beside a live holder of `<profile>/spine.lock` (a process of
// the test's, its pid and start time in the lock as takeLock writes them) runs with the spine refused: every file §1's
// table gives the spine stays byte-identical and no new one appears under those paths, whatever service a later change
// adds, and a split the holder left in progress (its machine file written, settings.json still unified) is not finished
// by the refused run; host.status names the holder. Once the holder is gone, the next launch breaks the stale lock, takes
// it, finishes the split, and releases the lock when it quits.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { expect, test } from '@playwright/test';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { invoke, value } from './support/c7-replay';
import { launchMaws } from './support/launch';

const HOLDER_BUILD = '9.9.9+e2e-holder';

// Every file at or under the spine's paths (§1's table; P5 O9: and lane A's driver files), with its bytes.
const SPINE_PATHS = ['index.sqlite', 'index.sqlite-wal', 'index.sqlite-shm', 'machine-settings.json', 'sessions', 'prompt-history.jsonl', 'attention.json', 'lane-a'];
function spineFiles(userData: string): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (path: string) => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      files.set(`${relative(userData, path)}/`, '');
      for (const name of readdirSync(path)) visit(join(path, name));
    } else files.set(relative(userData, path), readFileSync(path).toString('base64'));
  };
  for (const name of SPINE_PATHS) visit(join(userData, name));
  return files;
}

const procStartOf = (pid: number) => execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { env: { LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8' }).trim();
const hostStatus = async (page: Parameters<typeof invoke>[0]) => value(await invoke(page, 'host.status', undefined));

test('beside a live holder of spine.lock a launch writes no spine file and finishes no split; once the holder is gone the next launch takes the lock', async () => {
  test.setTimeout(240_000);
  const userData = mkdtempSync(join(tmpdir(), 'maws-e2e-spine-lock-'));
  let holder: ChildProcess | null = null;
  try {
    // A profile a lock-holding run made: the index and both settings files (the theme a client field, the gateway a machine one)
    let maws = await launchMaws({ userData });
    try {
      value(await invoke(maws.page, 'settings.set', { theme: 'dark', gateway: { defaultRoute: 'direct' } }));
      expect(JSON.parse(readFileSync(join(userData, 'machine-settings.json'), 'utf8'))).toMatchObject({ version: 1, gateway: { defaultRoute: 'direct' } });
    } finally {
      await maws.cleanup();
    }
    expect(existsSync(join(userData, 'spine.lock')), 'the lock is released when its holder quits').toBe(false);
    // the machine's other files, as a holder's services would have left them
    for (const dir of ['intents', 'bootstraps', 'deletions']) mkdirSync(join(userData, 'sessions', dir), { recursive: true });
    writeFileSync(join(userData, 'sessions', 'intents', 'intent-of-the-holder.json'), '{"held":true}');
    writeFileSync(join(userData, 'sessions', 'bootstraps', 'bootstrap-of-the-holder.json'), '{"held":true}');
    writeFileSync(join(userData, 'sessions', 'deletions', 'deletion-of-the-holder.json'), '{"held":true}');
    writeFileSync(join(userData, 'prompt-history.jsonl'), '{"display":"a prompt the holder kept"}\n');
    writeFileSync(join(userData, 'attention.json'), '{"items":[]}');
    // P5 O9: lane A's upload records, with a day-old root that is gone, which a lock-holding start's sweep drops
    mkdirSync(join(userData, 'lane-a'));
    writeFileSync(join(userData, 'lane-a', 'uploads.json'), JSON.stringify({ version: 1, roots: [{ path: join(userData, 'upload-of-the-holder'), session: 'engine-session-of-the-holder', at: '2026-01-01T00:00:00.000Z' }] }));
    // the holder's split in progress: its machine file written, settings.json not yet rewritten as the client file
    const unified = JSON.stringify({ ...SETTINGS_DEFAULTS_V21, version: 20, theme: 'dark', gateway: { ...SETTINGS_DEFAULTS_V21.gateway, defaultRoute: 'direct' } });
    writeFileSync(join(userData, 'settings.json'), unified);

    // the live holder, its lock as takeLock writes one
    holder = spawn('/bin/sleep', ['600'], { stdio: 'ignore' });
    const pid = holder.pid!;
    writeFileSync(join(userData, 'spine.lock'), JSON.stringify({ pid, procStart: procStartOf(pid), protocol: 2, buildId: HOLDER_BUILD, socketPath: '', startedAt: new Date().toISOString() }));
    const lock = readFileSync(join(userData, 'spine.lock'), 'utf8');
    const before = spineFiles(userData);

    maws = await launchMaws({ userData });
    try {
      const { page } = maws;
      await expect.poll(async () => (await hostStatus(page)).spineRefused ?? null, { timeout: 30_000, message: 'host.status names the holder' }).toContain(`pid ${pid} (build ${HOLDER_BUILD})`);
      // the client half runs on the person's settings, both halves read; neither half is written
      expect(value(await invoke(page, 'settings.get', undefined)).settings).toMatchObject({ version: 21, theme: 'dark', gateway: { defaultRoute: 'direct' } });
      expect(await invoke(page, 'settings.set', { theme: 'light' })).toMatchObject({ ok: false });
      expect(await invoke(page, 'settings.set', { gateway: { offerDirect: false } })).toMatchObject({ ok: false });
      // the window where a lock-holding start writes (the session service's start, the attention service, the sweep)
      await page.waitForTimeout(5_000);
    } finally {
      await maws.cleanup();
    }
    expect(spineFiles(userData), 'every spine file byte-identical, and none new').toEqual(before);
    expect(readFileSync(join(userData, 'settings.json'), 'utf8'), 'the split is not finished by a refused run').toBe(unified);
    expect(readFileSync(join(userData, 'spine.lock'), 'utf8'), 'the holder’s lock untouched').toBe(lock);

    // the holder gone: its lock is stale, broken and taken; the split finished; the lock released at quit
    holder.kill('SIGKILL');
    await new Promise((resolve) => holder!.once('exit', resolve));
    holder = null;
    maws = await launchMaws({ userData });
    try {
      expect((await hostStatus(maws.page)).spineRefused ?? null).toBeNull();
      expect(JSON.parse(readFileSync(join(userData, 'spine.lock'), 'utf8'))).toMatchObject({ pid: maws.app.process().pid });
      expect(value(await invoke(maws.page, 'settings.get', undefined)).settings).toMatchObject({ theme: 'dark', gateway: { defaultRoute: 'direct' } });
    } finally {
      await maws.cleanup();
    }
    expect(JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))).toMatchObject({ version: 21, theme: 'dark' });
    expect(JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))).not.toHaveProperty('gateway');
    expect(existsSync(join(userData, 'spine.lock'))).toBe(false);
  } finally {
    holder?.kill('SIGKILL');
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
