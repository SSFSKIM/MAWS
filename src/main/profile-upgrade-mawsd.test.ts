// P5 O3-D acceptance 11, its first half (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, M6): a profile last run by
// an O2-era build (a unified settings.json at 20, an index at 13 holding the browser's rows; test/support/o2-profile.ts)
// upgraded straight to this build on the daemon shape, in two processes: the migrator is the built `mawsd`'s spine
// (out/main/mawsd.js under plain Node, its spine loaded at a machine.sock client's first spine command, which takes
// spine.lock, splits the settings and opens the index, migration 14 staging the browser's rows), and the browser is
// main's (BrowserData in this process, which reads the index's version and promotes staging once it reads 14). O3-A's
// profile-upgrade.test.ts pattern, with the migrator in its own process: the browser starts before the copy, and during
// it (the copy held at the browser database's write lock, which this process takes first, while `mawsd`'s migration
// holds the index's). Either way the browser stays inert until it reads 14, and then holds every row O2 left, ids and
// times kept. Skipped without a build, as the bundle guard is; class 1a builds first.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daemonPaths } from '@shared/daemon/files';
import { splitSettings } from '@shared/settings/defaults';
import { settingsPaths } from '@shared/settings/paths';
import { browserDataFile } from '../../test/support/browser-data';
import { tempDir } from '../../test/support/index-fixture';
import { RawApp, until } from '../../test/support/mawsd-scene';
import { O2_BROWSER_TABLES, O2_CHOSEN_SETTINGS, writeO2Profile, type O2Profile } from '../../test/support/o2-profile';
import { BrowserData } from './browser/data';

const MAWSD = resolve(__dirname, '../../out/main/mawsd.js');
vi.setConfig({ testTimeout: 90_000 });

interface Mawsd {
  child: ChildProcess;
  exited: Promise<number | null>;
  output(): string;
}

let dir: ReturnType<typeof tempDir>;
let mawsd: Mawsd | null = null;
const opened: { close(): void }[] = [];

beforeEach(() => {
  dir = tempDir('maws-upgrade-mawsd-');
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const item of opened.splice(0).reverse()) item.close();
  if (mawsd && mawsd.child.exitCode === null) {
    mawsd.child.kill('SIGTERM');
    await Promise.race([mawsd.exited, new Promise((done) => setTimeout(done, 10_000))]);
    if (mawsd.child.exitCode === null) mawsd.child.kill('SIGKILL');
  }
  mawsd = null;
  // the engine host a spine's start may have woken outlives mawsd by design; it names the profile in its command line
  rmSync(dir.path, { recursive: true, force: true });
});

const daemonLog = (profile: string) => (existsSync(join(profile, 'mawsd', 'mawsd.log')) ? readFileSync(join(profile, 'mawsd', 'mawsd.log'), 'utf8') : '');

// The built mawsd over the profile, a private daemon under plain Node with a scratch HOME and engine store, its engine
// host (should the spine's start wake one) the replay's, which runs no engine
async function startMawsd(profile: string): Promise<Mawsd> {
  let output = '';
  mkdirSync(join(profile, 'home'));
  mkdirSync(join(profile, 'claude-config'));
  const child = spawn(process.execPath, ['--disable-sigusr1', MAWSD, 'run', '--private', '--dir', join(profile, 'mawsd')], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: join(profile, 'home'), TMPDIR: process.env.TMPDIR ?? '/tmp', MAWS_USER_DATA: profile, CLAUDE_CONFIG_DIR: join(profile, 'claude-config'), MAWS_ENGINE_REPLAY: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', (chunk: Buffer) => void (output += chunk.toString()));
  child.stderr!.on('data', (chunk: Buffer) => void (output += chunk.toString()));
  const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));
  const started: Mawsd = { child, exited, output: () => output };
  await until(() => daemonLog(profile).includes(' serving; ') || child.exitCode !== null, 20_000, 'mawsd to serve');
  expect(child.exitCode, `${output}\n${daemonLog(profile)}`).toBeNull();
  return started;
}

// A bare machine.sock client, as the CLI's: a spine command through it loads the spine
async function machineClient(profile: string): Promise<RawApp> {
  const token = readFileSync(join(profile, 'mawsd', 'mawsd.token'), 'utf8').trim();
  const client = await RawApp.connect(daemonPaths(profile).sockets.machine, token); // the fallback directory's, for a long path
  expect(client.welcomed(), JSON.stringify(client.first)).toBe(true);
  opened.push({ close: () => client.destroy() });
  return client;
}

const indexVersion = (path: string) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  } finally {
    db.close();
  }
};

// Whether another connection holds the index's write lock (a migration's BEGIN IMMEDIATE), asked without waiting
function indexWriteLocked(path: string): boolean {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout = 0');
    db.exec('BEGIN IMMEDIATE');
    db.exec('ROLLBACK');
    return false;
  } catch (error) {
    if (/locked|busy/i.test(String(error))) return true;
    throw error;
  } finally {
    db.close();
  }
}

// What `mawsd`'s migration left, and the browser's tables as the browser now holds them
function expectMigrated(profile: string, o2: O2Profile, browser: BrowserData): void {
  const paths = settingsPaths(profile);
  expect(JSON.parse(readFileSync(paths.client, 'utf8')), 'the client file, split by mawsd').toEqual(splitSettings(O2_CHOSEN_SETTINGS).client);
  expect(JSON.parse(readFileSync(paths.machine, 'utf8')), 'the machine file').toEqual(splitSettings(O2_CHOSEN_SETTINGS).machine);
  expect(indexVersion(o2.indexPath), 'the index at 15').toBe(15);
  const index = new DatabaseSync(o2.indexPath, { readOnly: true });
  try {
    expect(index.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'browser_%'").all(), 'no browser table left in the index').toEqual([]);
    const ids = (index.prepare('SELECT app_id FROM sessions ORDER BY app_id').all() as { app_id: string }[]).map((row) => row.app_id);
    expect(ids, 'the sessions O2 indexed').toEqual(expect.arrayContaining([o2.one.appId, o2.two.appId]));
  } finally {
    index.close();
  }
  browser.reattach([o2.one.appId, o2.two.appId]); // the snapshot main's mirror hands it at the machine host's streaming
  expect(browser.ready, 'the browser promoted staging once it read 14').toBe(true);
  const live = new DatabaseSync(browserDataFile(profile), { readOnly: true });
  try {
    for (const table of O2_BROWSER_TABLES) expect(live.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), table).toEqual(o2.browserRows[table]);
    expect(live.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'staging_%'").all(), 'staging dropped').toEqual([]);
  } finally {
    live.close();
  }
}

describe.skipIf(!existsSync(MAWSD))('a profile an O2-era build left, upgraded straight to this build on the daemon shape: mawsd migrates, the browser promotes', () => {
  it('the browser started before the copy waits inert, and promotes at the first reattach that reads 14', async () => {
    const profile = dir.path;
    const o2 = await writeO2Profile(profile);
    // main's browser, started first: the index at 13, so it writes nothing and makes no file of its own
    const browser = new BrowserData({ file: browserDataFile(profile), index: o2.indexPath });
    opened.push(browser);
    expect(browser.ready).toBe(false);
    expect(existsSync(join(profile, 'browser'))).toBe(false);

    mawsd = await startMawsd(profile);
    expect(indexVersion(o2.indexPath), 'mawsd starts cold: nothing opened yet').toBe(13);
    const client = await machineClient(profile);
    const listed = await client.request('session.list', { includeArchived: true }, 60_000);
    expect(listed, daemonLog(profile)).toMatchObject({ ok: true });
    expect(daemonLog(profile)).toMatch(/\[spine\] loaded in \d+ ms/);
    expect(browser.ready, 'the browser reads the index again only at a snapshot').toBe(false);
    expectMigrated(profile, o2, browser);
  });

  it('the browser started during the copy (the copy waiting on the browser database, the index held by the migration) reads 13 and waits inert, then promotes', async () => {
    const profile = dir.path;
    const o2 = await writeO2Profile(profile);
    mawsd = await startMawsd(profile);
    // the browser database, made and write-locked here first, so the migration's copy into its staging waits on it
    // (its busy timeout, 2 s) inside the index's migration transaction
    mkdirSync(join(profile, 'browser'));
    const blocker = new DatabaseSync(browserDataFile(profile));
    blocker.exec('PRAGMA journal_mode = WAL');
    blocker.exec('BEGIN IMMEDIATE');
    let blocking = true;
    const unblock = () => {
      if (!blocking) return;
      blocking = false;
      blocker.exec('ROLLBACK');
    };
    opened.push({ close: () => (unblock(), blocker.close()) });

    const client = await machineClient(profile);
    const listing = client.request('session.list', { includeArchived: true }, 60_000);
    // mawsd's migration holds the index's write lock from its BEGIN IMMEDIATE to its commit, the copy inside it
    await until(() => indexWriteLocked(o2.indexPath), 20_000, 'mawsd’s migration to hold the index');
    const said = vi.spyOn(console, 'error');
    const browser = new BrowserData({ file: browserDataFile(profile), index: o2.indexPath });
    opened.push(browser);
    expect(browser.ready, 'the index reads 13 while the migration is uncommitted').toBe(false);
    expect(said.mock.calls.flat().filter((line) => String(line).startsWith('[browser]')), 'it waits, not tries its file and fails').toEqual([]);
    expect(indexVersion(o2.indexPath)).toBe(13);
    unblock(); // the copy goes on, within its busy timeout

    expect(await listing, daemonLog(profile)).toMatchObject({ ok: true });
    expect(daemonLog(profile)).toMatch(/\[spine\] loaded in \d+ ms/);
    expect(browser.ready, 'still inert until a snapshot reads 14').toBe(false);
    expectMigrated(profile, o2, browser);
  });
});
