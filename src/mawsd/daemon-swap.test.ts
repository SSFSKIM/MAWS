// The bundle swap under a running `mawsd` (P5 O2; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md): a macOS upgrade
// replaces the bundle while the daemon runs on, so its module paths name the new bundle's files. Before each host spawn,
// and each deferred chunk's load that reads the files as they are now, the daemon reads its entry again: another build
// there spawns nothing and counts no crash; a unit daemon exits 75 (its unit starts the new bundle's mawsd), a private
// one keeps serving what runs and refuses the rest with the reason. Here the entry is the scene's stand-in file, rewritten
// in place as a rebuild of a checkout's out/main does; supervisor-files.test.ts reads one inside an app.asar.
import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { CRASH_LIMIT } from '@shared/host/host-supervisor';
import { EXIT_RESTART } from './daemon';
import { MawsdScene, until } from '../../test/support/mawsd-scene';

let scene: MawsdScene;

beforeEach(() => {
  scene = new MawsdScene('maws-sw-');
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${scene.logs.join('\n')}\n`));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await scene.dispose();
  vi.restoreAllMocks();
});

const replaceBundle = () => writeFileSync(scene.self, `// another build's mawsd ${Date.now()}`);
const REPLACED = /^engine-host is not launched \(mawsd's bundle was replaced: \/.+\/mawsd\.js is build [0-9a-f]{16}, this mawsd runs build [0-9a-f]{16}; the next app to attach restarts mawsd\); cannot answer engine\.ping$/;

describe('a private mawsd whose bundle was replaced', () => {
  it('spawns no host and counts no crash, however often asked; what runs is served; its own build back, it spawns again', async () => {
    const original = readFileSync(scene.self, 'utf8');
    await scene.pty({ answers: { 'pty.list': () => ({ ptys: [{ ptyId: 'p1', alive: true, offset: 0 }] }) } }); // a live pty host (a shell keeps it up), adopted at the start
    const daemon = await scene.start();
    replaceBundle();

    for (let i = 0; i <= CRASH_LIMIT; i++) {
      const answer = await daemon.services.dispatch('engine-host', 'engine.ping', undefined);
      expect(answer).toMatchObject({ ok: false, error: { code: 'host_unavailable', message: expect.stringMatching(REPLACED) } });
    }
    expect(scene.spawn).not.toHaveBeenCalled();
    expect(daemon.hosts.facts('engine-host').lastExit).toBeNull();
    expect(daemon.hosts.parked('engine-host')).toBe(true); // asked again at the next request, not crashed for good
    expect((await daemon.status()).hosts['engine-host'].state).toBe('parked');

    expect(await daemon.services.dispatch('pty-host', 'pty.ping', undefined)).toMatchObject({ ok: true });
    expect(scene.exits).toEqual([]);

    writeFileSync(scene.self, original); // the bundle put back
    expect(await daemon.services.dispatch('engine-host', 'engine.ping', undefined)).toMatchObject({ ok: true });
    expect(scene.spawn).toHaveBeenCalledTimes(1);
  });

  it('waiting for an incompatible engine host when its bundle is replaced: once that host is gone, parked with no refusal, not crashed', async () => {
    const old = await scene.engine({ protocol: 99, counts: { liveSessions: 3, rows: 3 } });
    const daemon = await scene.start();
    expect(await daemon.services.dispatch('engine-host', 'engine.ping', undefined)).toMatchObject({ ok: false, error: { message: expect.stringContaining('is crashed') } });
    expect(daemon.hosts.refusal('engine-host')).toMatchObject({ reason: 'protocol', liveSessions: 3 }); // waiting for it
    replaceBundle();
    await old.supervisor.die(); // the transport's own retry finds nothing, and would spawn
    await until(() => daemon.hosts.parked('engine-host'), 5_000, 'the park');
    expect(daemon.hosts.snapshot('engine-host').state).not.toBe('crashed');
    expect(daemon.hosts.refusal('engine-host')).toBeNull();
    expect(await daemon.services.dispatch('engine-host', 'engine.ping', undefined)).toMatchObject({ ok: false, error: { message: expect.stringMatching(REPLACED) } });
    expect(scene.spawn).not.toHaveBeenCalled();
    expect(daemon.hosts.facts('engine-host').lastExit).toBeNull();
  });

  it('loads no deferred chunk from the files now on disk: the spine’s load fails with the reason', async () => {
    const load = vi.fn(async () => {
      throw new Error('the services chunk was loaded');
    });
    await scene.start({ spine: { load } });
    replaceBundle();
    const client = await scene.app('machine');
    expect(await client.request('session.launchMode')).toMatchObject({ ok: false, error: { message: expect.stringContaining("mawsd's bundle was replaced") } });
    expect(load).not.toHaveBeenCalled();
    expect(scene.exits).toEqual([]);
  });
});

describe('a unit mawsd whose bundle was replaced', () => {
  it('spawns no host, counts no crash and exits 75, so its unit starts the new bundle’s mawsd', async () => {
    const daemon = await scene.start({ kind: 'unit' });
    replaceBundle();
    const answer = await daemon.services.dispatch('pty-host', 'pty.ping', undefined);
    expect(answer).toMatchObject({ ok: false, error: { message: expect.stringContaining('mawsd restarts into the new bundle') } });
    await until(() => scene.exits.length > 0, 5_000, 'the exit');
    expect(scene.exits).toEqual([EXIT_RESTART]);
    expect(scene.spawn).not.toHaveBeenCalled();
    expect(daemon.hosts.facts('pty-host').lastExit).toBeNull();
    expect(scene.logs).toContain('exiting (bundle replaced)');
  });
});
