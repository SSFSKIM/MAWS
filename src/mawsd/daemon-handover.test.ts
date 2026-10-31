// `mawsd restart --engine-host` (P5 O16 M3b; docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3; D9, D40, D56):
// `daemon.restartEngineHost` over the daemon in this process, its engine host a stand-in on the real socket layer that
// answers `host.handover` as the engine host does. Detaching: the answer waits for the successor's welcome and its
// start's adoptions, and names its pid and how many it adopted. Deferred: answered at once; the caller may go, the park
// clock may fire, and the old host's exit after its drain still starts the successor with nothing held for it, never a
// park. A parked host, or one that does not hand over, is refused.
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { PTY_FRAMES_CAPABILITY, ATTACHMENT_CAPABILITY } from '@shared/host/socket-protocol';
import { MawsdScene, until } from '../../test/support/mawsd-scene';

let scene: MawsdScene;

beforeEach(() => {
  scene = new MawsdScene('maws-ho-');
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${scene.logs.join('\n')}\n`));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(async () => {
  await scene.dispose();
  vi.restoreAllMocks();
});

const holder = (adopted: number, adopting = false) => ({ mode: 'detached', pid: 1, startedAt: 'T', buildId: 'b', protocol: 3, wire: 'w', liveSessions: adopted, rows: adopted, idleExitMs: null, idleExitAt: null, exitWhenIdle: false, socketPath: null, logPath: null, orphansKilled: 0, holder: { hosts: adopted, adopted, failed: 0, gate: null, handover: 'none', adopting } });

describe('daemon.restartEngineHost', () => {
  it('detaching: answered once the successor is welcomed and its adoptions have ended, with its pid and the sessions it adopted', async () => {
    let successorAsked = 0;
    scene.engineSpawn = {
      answers: {
        'host.handover': () => {
          const old = scene.lastEngine();
          setImmediate(() => void old.supervisor.die()); // the exit order, after the answer
          return { state: 'detaching' };
        },
        // the successor's start: adopting until its second status
        'host.supervisorStatus': () => (scene.engines.length > 1 ? holder(2, ++successorAsked < 2) : holder(0)),
      },
    };
    const daemon = await scene.start();
    daemon.hosts.wake('engine-host');
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready');
    const old = scene.lastEngine();
    const app = await scene.app('machine');
    const answer = await app.request('daemon.restartEngineHost', undefined, 20_000);
    expect(old.named('host.handover')).toEqual([{ graceMs: 10_000 }]);
    expect(scene.engines).toHaveLength(2);
    expect(answer).toEqual({ t: 'res', id: expect.any(String), ok: true, value: { state: 'detaching', inFlight: 0, pid: scene.lastEngine().pid, adopted: 2 } });
    expect(successorAsked).toBe(2);
    expect(scene.logs).toContainEqual(expect.stringContaining(`restart --engine-host: pid ${old.pid} → ${scene.lastEngine().pid}, 2 sessions adopted`));
  });

  it('deferred, its caller gone and the park clock fired: the old host’s exit after its drain starts the successor, never a park', async () => {
    const drain = { inFlight: 1 };
    scene.engineSpawn = { answers: { 'host.handover': () => (drain.inFlight > 0 ? { state: 'deferred', inFlight: drain.inFlight } : { state: 'detaching' }) } };
    const daemon = await scene.start();
    daemon.hosts.wake('engine-host');
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready');
    const old = scene.lastEngine();
    const app = await scene.app('machine');
    expect(await app.request('daemon.restartEngineHost')).toMatchObject({ ok: true, value: { state: 'deferred', inFlight: 1 } });
    app.destroy(); // the CLI's caller went
    expect(daemon.hosts.snapshot('engine-host').state).toBe('restarting'); // a draining host is not ready (D56)
    expect(daemon.hosts.exitSupervisor('idle')).toBe(true); // what the park clock asks
    await until(() => old.supervisor.exits.includes('idle'));
    await until(() => old.named('host.handover').length >= 2); // asked again while it defers
    drain.inFlight = 0;
    await old.supervisor.die(); // its drain settled: it exits
    await until(() => scene.engines.length === 2 && daemon.hosts.snapshot('engine-host').state === 'ready');
    expect(daemon.hosts.snapshot('engine-host').pid).toBe(scene.lastEngine().pid);
    expect(daemon.hosts.parked('engine-host')).toBe(false);
    expect(scene.spawn).toHaveBeenCalledTimes(2); // the wake's, then the successor's
  });

  it('refuses a parked engine host, and one that does not hand over, without touching it', async () => {
    scene.engineSpawn = { capabilities: [PTY_FRAMES_CAPABILITY, ATTACHMENT_CAPABILITY] }; // a build before the handover
    const daemon = await scene.start();
    const app = await scene.app('machine');
    expect(await app.request('daemon.restartEngineHost')).toMatchObject({ ok: false, error: { code: 'host_unavailable', message: expect.stringContaining('parked') } });
    daemon.hosts.wake('engine-host');
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready');
    expect(await app.request('daemon.restartEngineHost')).toMatchObject({ ok: false, error: { code: 'host_unavailable', message: expect.stringContaining('does not hand its sessions over') } });
    expect(daemon.hosts.snapshot('engine-host').state).toBe('ready');
    expect(scene.lastEngine().named('host.handover')).toEqual([]);
  });
});
