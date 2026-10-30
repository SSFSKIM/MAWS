// What the yield writes (P5 O3-D M6 fix round 1, item 5; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces
// §L, D32; the architect's ruling on the no-write window): the built `mawsd` (out/main/mawsd.js under plain Node, its spine
// the real services chunk over a profile an O2-era build left, loaded and migrated by a machine.sock client's first spine
// command) refuses an app from before O3-A at engine-host.sock and yields its spine to it. From the refusal to `[spine]
// released` its only spine writes are its stores closing: the index's WAL checkpointed into index.sqlite and the -wal and
// -shm files removed, every other spine file (SPINE_PATHS) byte-identical and none new; once released it holds no spine
// file open. e2e/cross-build.spec.ts's `(pre-O3 app, daemon)` scene rests its window from the refusal on this, and checks
// the open files (lsof) and the idle there. Skipped without a build, as the bundle guard is; class 1a builds first.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daemonPaths } from '@shared/daemon/files';
import { tempDir } from '../../test/support/index-fixture';
import { RawApp, until } from '../../test/support/mawsd-scene';
import { writeO2Profile } from '../../test/support/o2-profile';
import { spineFiles, spineFilesOpen } from '../../test/support/spine-files';

const MAWSD = resolve(__dirname, '../../out/main/mawsd.js');
vi.setConfig({ testTimeout: 90_000 });

let dir: ReturnType<typeof tempDir>;
const children: ChildProcess[] = [];
const opened: { destroy(): void }[] = [];

beforeEach(() => {
  dir = tempDir('maws-yield-files-');
});

afterEach(async () => {
  for (const client of opened.splice(0)) client.destroy();
  for (const child of children.splice(0).reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill('SIGTERM');
    await Promise.race([new Promise((done) => child.once('exit', done)), new Promise((done) => setTimeout(done, 10_000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  rmSync(dir.path, { recursive: true, force: true });
});

const daemonLog = (profile: string) => (existsSync(join(profile, 'mawsd', 'mawsd.log')) ? readFileSync(join(profile, 'mawsd', 'mawsd.log'), 'utf8') : '');

describe.skipIf(!existsSync(MAWSD))('the yield’s writes: the spine released through its stores’ close and nothing else', () => {
  it('from the refusal to [spine] released: index.sqlite checkpointed, its -wal and -shm removed, every other spine file unchanged; then none held open', async () => {
    const profile = dir.path;
    await writeO2Profile(profile);
    mkdirSync(join(profile, 'home'));
    mkdirSync(join(profile, 'claude-config'));
    let output = '';
    const mawsd = spawn(process.execPath, ['--disable-sigusr1', MAWSD, 'run', '--private', '--dir', join(profile, 'mawsd')], {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: join(profile, 'home'), TMPDIR: process.env.TMPDIR ?? '/tmp', MAWS_USER_DATA: profile, CLAUDE_CONFIG_DIR: join(profile, 'claude-config'), MAWS_ENGINE_REPLAY: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(mawsd);
    mawsd.stdout!.on('data', (chunk: Buffer) => void (output += chunk.toString()));
    mawsd.stderr!.on('data', (chunk: Buffer) => void (output += chunk.toString()));
    await until(() => daemonLog(profile).includes(' serving; ') || mawsd.exitCode !== null, 20_000, 'mawsd to serve');
    const token = readFileSync(join(profile, 'mawsd', 'mawsd.token'), 'utf8').trim();
    const paths = daemonPaths(profile);

    // the spine loaded (and the index migrated) by a bare machine.sock client, as the CLI's
    const client = await RawApp.connect(paths.sockets.machine, token);
    opened.push(client);
    expect(await client.request('session.list', { includeArchived: true }, 60_000), `${output}\n${daemonLog(profile)}`).toMatchObject({ ok: true });
    expect(existsSync(join(profile, 'index.sqlite-wal')), 'the loaded index runs on its WAL').toBe(true);
    expect(spineFilesOpen(mawsd.pid!, profile), 'the loaded spine holds its index open').toContain(join(profile, 'index.sqlite'));

    // an app from before O3-A (a live pid that holds no spine.lock; its hello lists no machine.spine) at the relay
    const oldApp = spawn('/bin/sleep', ['600'], { stdio: 'ignore' });
    children.push(oldApp);
    await new Promise((started) => oldApp.once('spawn', started));
    const atRefusal = spineFiles(profile);
    const refused = await RawApp.connect(paths.sockets['engine-host'], token, { appPid: oldApp.pid! });
    opened.push(refused);
    expect(refused.first, daemonLog(profile)).toMatchObject({ t: 'refuse', reason: 'wire' });
    await until(() => daemonLog(profile).includes('[spine] released'), 30_000, 'the yielded spine released');
    expect(daemonLog(profile)).toContain(`[spine] yielding to pid ${oldApp.pid}, an app that runs its own spine`);

    const released = spineFiles(profile);
    const changed = [...new Set([...atRefusal.keys(), ...released.keys()])].filter((path) => atRefusal.get(path) !== released.get(path)).sort();
    const closing = ['index.sqlite', 'index.sqlite-shm', 'index.sqlite-wal'];
    expect(changed.filter((path) => !closing.includes(path)), 'no spine file but the index’s changed from the refusal to the release').toEqual([]);
    expect(released.has('index.sqlite-wal') || released.has('index.sqlite-shm'), 'the close checkpointed the WAL and removed -wal and -shm').toBe(false);
    expect(released.has('index.sqlite'), 'the index itself stays').toBe(true);
    expect(spineFilesOpen(mawsd.pid!, profile), 'released: mawsd holds no spine file open').toEqual([]);
    expect(mawsd.exitCode, 'mawsd runs on, its spine yielded').toBeNull();
  });
});
