// `mawsd restart --engine-host` (P5 O16 M3b; docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3; D9, D40, D56):
// `daemon.restartEngineHost` over the daemon in this process, its engine host a stand-in on the real socket layer that
// answers `host.handover` as the engine host does. Detaching: the answer waits for the successor's welcome and its
// start's adoptions, and names its pid and how many it adopted. Deferred: answered at once; the caller may go, the park
// clock may fire, and the old host's exit after its drain still starts the successor with nothing held for it, never a
// park. A parked host, or one that does not hand over, is refused.
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { PTY_FRAMES_CAPABILITY, ATTACHMENT_CAPABILITY } from '@shared/host/socket-protocol';
import { MawsdScene, sleep, until } from '../../test/support/mawsd-scene';

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

// The handover beside the park's guard on clients' engine-host requests (P5 O5 landing 1, engine-requests.ts; D40, D56):
// a handover is never a park ask, so nothing waits on the park's exit bound for it and no ask is taken back from it; a
// request the old host was sent is answered by it before it is asked to hand over; one sent once the handover began is
// held for the successor; a park ask and a handover, in either order, end in one successor or one park.
describe('the handover and the park', () => {
  const PING = { pid: 1, uptimeMs: 1, hostVersion: 'stand-in' };
  const ASKED_TO_PARK = 'no app and no interest for the idle time: asking the engine host to exit when idle';
  const TAKEN_BACK = 'taking back the engine host’s exit when idle';
  const WAITED = (name: string) => `[hosts] ${name} arrived after the engine host was asked to park: waiting for its exit`;
  const status = { 'host.supervisorStatus': () => holder(0) };

  // the park clock at 200 ms, set as an app sets it; the app gone
  async function parkClockAt200() {
    const daemon = await scene.start();
    const app = await scene.app();
    await app.request('host.configure', { idleExitMs: 200 });
    app.leave();
    return daemon;
  }

  it('a request the old host was sent before the handover is answered by it; the handover is asked once it is', async () => {
    scene.engineSpawn = {
      answers: {
        ...status,
        'engine.ping': () => sleep(300).then(() => ({ ...PING, hostVersion: `pid ${scene.lastEngine().supervisor.pid}` })),
        'host.handover': () => {
          const old = scene.lastEngine();
          setImmediate(() => void old.supervisor.die());
          return { state: 'detaching' };
        },
      },
    };
    const daemon = await scene.start();
    daemon.hosts.wake('engine-host');
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready');
    const old = scene.lastEngine();
    const cli = await scene.app('machine', { capabilities: [] });
    const ping = cli.request('engine.ping', undefined, 20_000);
    await until(() => old.named('engine.ping').length === 1);
    const restarted = await cli.request('daemon.restartEngineHost', undefined, 20_000);
    expect(await ping).toMatchObject({ ok: true, value: { hostVersion: `pid ${old.supervisor.pid}` } }); // the old host's answer
    expect(old.calls.map((call) => call.name).filter((name) => name === 'engine.ping' || name === 'host.handover')).toEqual(['engine.ping', 'host.handover']);
    expect(restarted).toMatchObject({ ok: true, value: { state: 'detaching', pid: scene.lastEngine().supervisor.pid } });
  });

  it('a deferred handover, the caller gone: the park clock asks nothing of the draining host, a request sent meanwhile reaches the successor at once, and the successor parks once', async () => {
    const drain = { inFlight: 1 };
    scene.engineSpawn = {
      onExitIdle: (host) => void host.die(),
      answers: { ...status, 'engine.ping': () => ({ ...PING, hostVersion: `pid ${scene.lastEngine().supervisor.pid}` }), 'host.handover': () => (drain.inFlight > 0 ? { state: 'deferred', inFlight: drain.inFlight } : { state: 'detaching' }) },
    };
    const daemon = await parkClockAt200();
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready');
    const old = scene.lastEngine();
    const cli = await scene.app('machine', { capabilities: [] });
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready'); // past the app's departure's recycle
    expect(await cli.request('daemon.restartEngineHost')).toMatchObject({ ok: true, value: { state: 'deferred', inFlight: 1 } });
    const ping = cli.request('engine.ping', undefined, 20_000); // held for the successor (D56: a draining host is not ready)
    await sleep(600); // three of the park clock's idle times
    expect(scene.logs).not.toContain(ASKED_TO_PARK);
    expect(old.supervisor.exits).toEqual([]);
    drain.inFlight = 0;
    const drained = Date.now();
    await old.supervisor.die(); // its drain settled: it exits
    expect(await ping).toMatchObject({ ok: true, value: { hostVersion: `pid ${scene.lastEngine().supervisor.pid}` } });
    expect(Date.now() - drained).toBeLessThan(2_000); // no exit bound waited (EXIT_SETTLE_MS, 5 s)
    expect(old.named('engine.ping')).toEqual([]);
    cli.destroy();
    await until(() => daemon.hosts.parked('engine-host'), 5_000, 'the successor’s park');
    await sleep(500);
    expect(scene.spawn).toHaveBeenCalledTimes(2); // the wake's and the successor's: no relaunch
    expect(scene.logs.filter((line) => line === ASKED_TO_PARK)).toHaveLength(1);
    expect(scene.logs.some((line) => line.startsWith('[hosts] engine.ping arrived after'))).toBe(false);
    expect(scene.logs).not.toContain(TAKEN_BACK);
  });

  it('a park asked of a host that stays (it holds rows), then the handover: one successor, no park, nothing taken back; a request waiting on the park goes to the successor', async () => {
    scene.engineSpawn = {
      answers: { ...status, 'engine.ping': () => ({ ...PING, hostVersion: `pid ${scene.lastEngine().supervisor.pid}` }), 'host.handover': () => {
        const old = scene.lastEngine();
        setTimeout(() => void old.supervisor.die(), 100);
        return { state: 'detaching' };
      } },
    };
    const daemon = await parkClockAt200();
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready');
    const old = scene.lastEngine();
    await until(() => old.supervisor.exits.includes('idle'), 3_000, 'the park clock’s ask'); // armed; it stays
    const cli = await scene.app('machine', { capabilities: [] });
    const ping = cli.request('engine.ping', undefined, 20_000);
    await until(() => scene.logs.includes(WAITED('engine.ping')));
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready');
    const asked = Date.now();
    const restarted = await cli.request('daemon.restartEngineHost', undefined, 20_000);
    expect(restarted).toMatchObject({ ok: true, value: { state: 'detaching', pid: scene.lastEngine().supervisor.pid } });
    expect(await ping).toMatchObject({ ok: true, value: { hostVersion: `pid ${scene.lastEngine().supervisor.pid}` } });
    expect(Date.now() - asked).toBeLessThan(3_000);
    expect(old.named('engine.ping')).toEqual([]);
    expect(scene.spawn).toHaveBeenCalledTimes(2);
    expect(daemon.hosts.parked('engine-host')).toBe(false);
    expect(scene.logs).not.toContain(TAKEN_BACK);
    expect(old.named('host.exitWhenIdle')).toEqual([]);
  });

  // fix wave 1: the drain waits for the old host's in-flight tools, whose completions (the render seam's, an app's pane
  // answer) arrive through the supervisor after the handover began; they reach the draining host before it detaches,
  // while any other request stays held for the successor
  it('a capture’s completion that arrives during the drain is delivered to the draining host before it detaches; other work waits for the successor', async () => {
    const drain = { inFlight: 1 };
    scene.engineSpawn = {
      answers: {
        ...status,
        'engine.ping': () => ({ ...PING, hostVersion: `pid ${scene.lastEngine().supervisor.pid}` }),
        'maws.artifact.captured': () => {
          drain.inFlight = 0; // the bridge's call settled: the drain can end
          return { outcome: 'delivered' };
        },
        'host.handover': () => {
          if (drain.inFlight > 0) return { state: 'deferred', inFlight: drain.inFlight };
          const old = scene.lastEngine();
          setImmediate(() => void old.supervisor.die());
          return { state: 'detaching' };
        },
      },
    };
    const daemon = await scene.start();
    daemon.hosts.wake('engine-host');
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready');
    const old = scene.lastEngine();
    const cli = await scene.app('machine', { capabilities: [] });
    expect(await cli.request('daemon.restartEngineHost')).toMatchObject({ ok: true, value: { state: 'deferred', inFlight: 1 } });
    const ping = cli.request('engine.ping', undefined, 20_000); // new work: held for the successor
    const captured = await daemon.hosts.forward('engine-host', { name: 'maws.artifact.captured', input: { appSessionId: 'app-1', requestId: 'r-1', result: { ok: false, error: 'no display' } } });
    expect(captured).toMatchObject({ ok: true, value: { outcome: 'delivered' } }); // the old host's answer, through its draining link
    expect(old.named('maws.artifact.captured')).toHaveLength(1);
    expect(old.supervisor.exits).toEqual([]);
    await until(() => scene.engines.length === 2 && daemon.hosts.snapshot('engine-host').state === 'ready'); // re-asked: detaching, then the successor
    expect(await ping).toMatchObject({ ok: true, value: { hostVersion: `pid ${scene.lastEngine().supervisor.pid}` } });
    expect(old.named('engine.ping')).toEqual([]);
    expect(scene.lastEngine().named('maws.artifact.captured')).toEqual([]);
  });

  it('a park asked of an idle host that exits under the handover’s ask: its successor follows, and the restart is answered', async () => {
    scene.engineSpawn = {
      answers: { ...status, 'host.handover': () => {
        void scene.lastEngine().supervisor.die(); // the idle exit, before any answer
        return new Promise(() => {});
      } },
    };
    const daemon = await scene.start();
    daemon.hosts.wake('engine-host');
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready');
    const old = scene.lastEngine();
    expect(daemon.hosts.exitSupervisor('idle')).toBe(true); // the park clock's ask, out before the restart
    const cli = await scene.app('machine', { capabilities: [] });
    const restarted = await cli.request('daemon.restartEngineHost', undefined, 20_000);
    expect(restarted).toMatchObject({ ok: true, value: { state: 'detaching', pid: scene.lastEngine().supervisor.pid } });
    expect(scene.lastEngine()).not.toBe(old);
    await sleep(300);
    expect(scene.spawn).toHaveBeenCalledTimes(2);
    expect(daemon.hosts.parked('engine-host')).toBe(false);
    expect(daemon.hosts.snapshot('engine-host').state).toBe('ready');
  });
});
