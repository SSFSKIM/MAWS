// `mawsd`'s side of the connectors' transition (P5 O4 M2; docs/doperpowers/plans/2026-10-31-p5-o4-services.md,
// Interfaces §C, §D; D10, D11): its hello to the engine host lists `host.connectors` beside `host.attachment`, and it
// refuses an app's hello that lists no `machine.connectors`, on engine-host.sock and on machine.sock alike, with O3-D's
// refusal encoding (`refuse` with reason `wire`, its log line naming the capability). An app's hello is one that lists
// `machine.spine` (main's own list since O3-D M5b); the CLI's lists nothing and the link's `socket.ptyFrames` alone, and
// both are admitted as before. P5 O4 M4 (D45): the refusal says at least one live session, so an old app waits on it and
// shows its banner rather than replacing in a loop; pty-host.sock refuses it too, so a refused app holds nothing on
// mawsd's idle clock; and the refusal's line is logged once a minute per app and socket. Over the daemon in this process and stand-in hosts on real sockets
// (test/support/mawsd-scene.ts), under the production switches.
import { spawn, type ChildProcess } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { CONNECTORS_CLIENT_CAPABILITY, MACHINE_SPINE_CAPABILITY, PEER_CAPABILITIES, PTY_FRAMES_CAPABILITY, SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';
import { buildIdOf } from '../engine-host/supervisor-files';
import { takeSpineLock } from '../services/settings/spine-lock';
import type { SpineEntry } from './spine-seam';
import { MawsdScene, sleep, until } from '../../test/support/mawsd-scene';

let scene: MawsdScene;
let children: ChildProcess[];

beforeEach(() => {
  scene = new MawsdScene('maws-mc-');
  children = [];
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${scene.logs.join('\n')}\n`));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(async () => {
  for (const child of children) child.kill('SIGKILL');
  await scene.dispose();
  vi.restoreAllMocks();
});

const PRODUCTION = { claimSpine: true, permanentClient: true } as const; // src/mawsd/index.ts's switches
const POST_O4 = [...PEER_CAPABILITIES.app]; // this build's app
const PRE_O4 = [PTY_FRAMES_CAPABILITY, MACHINE_SPINE_CAPABILITY]; // an app from O3-D M5b to before O4 M2
const CLI: string[] = []; // src/mawsd/machine-client.ts's hello
const LINK = [...PEER_CAPABILITIES.link]; // O6's link to another profile's machine.sock

// D45: with nothing live the refusal says one session, so an old app's transport waits on it (its banner) and asks again
// every 5 s, rather than replacing mawsd every 200 ms (it reads 0 as "replace", and mawsd ignores that exit)
const refusal = () => ({ t: 'refuse', reason: 'wire', protocol: SOCKET_PROTOCOL, buildId: buildIdOf(scene.self), wire: wireFingerprint(), liveSessions: 1 });
const refusedLine = (socket: string) => new RegExp(`^${socket.replace('.', '\\.')}: refuse wire to appPid \\d+ \\(build raw-app\\): its hello lists no machine\\.connectors`);

// The services chunk as the seam loads it: the real lock, and a root that registers one command
function standInChunk(): () => Promise<SpineEntry> {
  return async () => ({
    takeSpineLock,
    openSpineData: async (_profile, { lock }) => ({ lock: lock!, refused: lock!.refused, machineSettings: null as never, paths: { client: '', machine: '' } }),
    startSpine: (started) => {
      started.bus.register('session.launchMode', () => ({ mode: 'index' }));
      return { view: { engineStatuses: () => [], on: () => () => {} } as never, settled: async () => {}, busy: () => false, stop: () => {} };
    },
  });
}

describe('mawsd’s hello to the engine host (Interfaces §D)', () => {
  it('lists host.connectors beside host.attachment under the permanent client', async () => {
    await scene.start(PRODUCTION);
    const app = await scene.app('engine-host', { capabilities: POST_O4 });
    expect(app.welcomed()).toBe(true);
    await until(() => scene.lastEngine().supervisor.peer() !== null, 3_000, 'mawsd’s hello');
    expect(scene.lastEngine().supervisor.peer()?.capabilities).toEqual(['socket.ptyFrames', 'host.attachment', 'host.connectors']);
  });
});

describe('the refusal of an app that lists no machine.connectors (D11)', () => {
  it('on engine-host.sock: refused with mawsd’s own refuse wire line naming the capability, no engine host woken for it', async () => {
    await scene.start(PRODUCTION);
    const app = await scene.app('engine-host', { capabilities: PRE_O4 });
    expect(app.first).toEqual(refusal());
    expect(scene.logs).toContainEqual(expect.stringMatching(refusedLine('engine-host.sock')));
    app.exit('now');
    await until(() => scene.logs.includes('engine-host.sock: exit now on a connection the relay refused itself: nothing asked of the engine-host'), 3_000, 'the exit');
    await sleep(100);
    expect(scene.spawn).not.toHaveBeenCalled();
  });

  it('on machine.sock: refused with the same line, and its exit restarts nothing', async () => {
    const daemon = await scene.start(PRODUCTION);
    const app = await scene.app('machine', { capabilities: PRE_O4 });
    expect(app.first).toEqual(refusal());
    expect(scene.logs).toContainEqual(expect.stringMatching(refusedLine('machine.sock')));
    app.exit('now');
    await until(() => scene.logs.some((line) => line.startsWith('machine.sock: exit now on a connection mawsd refused')), 3_000, 'the exit');
    expect(scene.logs.some((line) => line.includes('exit now on machine.sock: restarting'))).toBe(false);
    expect((await daemon.status()).pid).toBe(process.pid); // still serving
  });

  it('on pty-host.sock: refused with the same line, no pty host woken for it (D45: a refused app holds no socket of mawsd’s)', async () => {
    await scene.start(PRODUCTION);
    const app = await scene.app('pty-host', { capabilities: PRE_O4 });
    expect(app.first).toEqual(refusal());
    expect(scene.logs).toContainEqual(expect.stringMatching(refusedLine('pty-host.sock')));
    app.exit('now');
    await until(() => scene.logs.some((line) => line.startsWith('pty-host.sock: exit now on a connection the relay refused itself')), 3_000, 'the exit');
    await sleep(100);
    expect(scene.spawn).not.toHaveBeenCalled();
  });

  it('logs one refusal line a minute per app and socket however often the app asks (D45)', async () => {
    await scene.start(PRODUCTION);
    for (let i = 0; i < 3; i++) for (const socket of ['engine-host', 'machine', 'pty-host'] as const) expect((await scene.app(socket, { capabilities: PRE_O4 })).first).toEqual(refusal());
    for (const socket of ['engine-host.sock', 'machine.sock', 'pty-host.sock']) expect(scene.logs.filter((line) => refusedLine(socket).test(line)), socket).toHaveLength(1);
  });

  it('a private daemon whose only client is a refused app exits once idle (D45: the banner’s promise)', async () => {
    scene.engineSpawn = { onExitIdle: (self) => void self.die() }; // nothing live: it exits once asked
    await scene.start({ ...PRODUCTION, spine: { load: standInChunk() } });
    const current = await scene.app('engine-host', { capabilities: POST_O4 });
    await current.request('host.configure', { idleExitMs: 300 });
    current.leave();
    // the refused app asks again on each socket, as its transport does every few seconds, until the daemon has gone (a
    // hello its stop overtook is no answer)
    const ask = async (socket: 'engine-host' | 'machine' | 'pty-host') => {
      const refused = await scene.app(socket, { capabilities: PRE_O4 }).catch(() => null);
      if (refused?.first) expect(refused.first).toEqual(refusal());
    };
    for (const deadline = Date.now() + 5_000; scene.exits.length === 0 && Date.now() < deadline; await sleep(100)) await Promise.all([ask('engine-host'), ask('machine'), ask('pty-host')]);
    expect(scene.exits).toEqual([0]);
    expect(scene.logs).toContain('no client, both hosts parked and no hold for the idle time');
    expect(scene.spawn.mock.calls.filter(([, args]) => (args as string[]).includes(scene.ptyProfile.modulePath))).toEqual([]); // no pty host woken
  });

  it('this build’s app is welcomed on both; the CLI’s hello and the link’s, which carry no app’s list, are welcomed on machine.sock', async () => {
    await scene.start(PRODUCTION);
    expect((await scene.app('engine-host', { capabilities: POST_O4 })).welcomed()).toBe(true);
    for (const capabilities of [POST_O4, CLI, LINK]) {
      const client = await scene.app('machine', { capabilities });
      expect(client.first, JSON.stringify(capabilities)).toMatchObject({ t: 'welcome' });
      expect(await client.request('daemon.status')).toMatchObject({ ok: true });
    }
    expect(scene.logs.some((line) => line.includes('refuse wire'))).toBe(false);
  });

  it('a refused app still reads the machine’s spine: no yield to it when the SingletonLock names it', async () => {
    const child = spawn('/bin/sleep', ['600'], { stdio: 'ignore' });
    children.push(child);
    await new Promise((resolve) => child.once('spawn', resolve));
    symlinkSync(`${hostname()}-${child.pid}`, join(scene.root, 'SingletonLock'));
    await scene.start({ ...PRODUCTION, spine: { load: standInChunk() } });
    expect((await scene.app('machine', { appPid: child.pid, capabilities: PRE_O4 })).first).toEqual(refusal());
    const client = await scene.app('machine', { capabilities: CLI });
    expect(await client.request('session.launchMode')).toMatchObject({ ok: true, value: { mode: 'index' } });
    expect(scene.logs.some((line) => line.includes('SingletonLock names pid'))).toBe(false);
  });

  it('an app that lists machine.connectors but no machine.spine is O3-D’s refusal, not this one', async () => {
    await scene.start(PRODUCTION);
    const app = await scene.app('engine-host', { capabilities: [PTY_FRAMES_CAPABILITY, CONNECTORS_CLIENT_CAPABILITY] });
    expect(app.first).toEqual(refusal());
    expect(scene.logs).toContainEqual(expect.stringMatching(/^engine-host\.sock: refuse wire to appPid \d+ \(build raw-app\): its hello lists no machine\.spine/));
    expect(scene.logs.some((line) => refusedLine('engine-host.sock').test(line))).toBe(false);
  });
});
