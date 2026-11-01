// `mawsd restart --engine-host` (P5 O16 M3b; docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3; D9, D40, D56):
// `daemon.restartEngineHost` over the daemon in this process, its engine host a stand-in on the real socket layer that
// answers `host.handover` as the engine host does. Detaching: the answer waits for the successor's welcome and its
// start's adoptions, and names its pid and how many it adopted. Deferred: answered at once; the caller may go, the park
// clock may fire, and the old host's exit after its drain still starts the successor with nothing held for it, never a
// park. A parked host, or one that does not hand over, is refused.
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { PTY_FRAMES_CAPABILITY, ATTACHMENT_CAPABILITY } from '@shared/host/socket-protocol';
import { DRAIN_REPLIES } from '@shared/host/host-supervisor'; // P5 O16 M3b fix wave 2
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
          scene.lastEngine().handOver(); // the exit order, after the answer
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
    old.handOver(); // its drain settled: it exits
    await until(() => scene.engines.length === 2 && daemon.hosts.snapshot('engine-host').state === 'ready');
    expect(daemon.hosts.snapshot('engine-host').pid).toBe(scene.lastEngine().pid);
    expect([daemon.hosts.snapshot('engine-host').restarts, daemon.hosts.facts('engine-host').lastExit]).toEqual([0, null]); // planned: no crash
    expect(daemon.hosts.parked('engine-host')).toBe(false);
    expect(scene.spawn).toHaveBeenCalledTimes(2); // the wake's, then the successor's
  });

  // fix wave 3 (the re-review's P2): a mawsd that restarted while its engine host, of another build, deferred a handover
  // meets that host with its drain armed and its rows frozen; at the host's first status (its client's ready line) it
  // takes it back into the handover: not ready (main's link closed, its hello held), told as draining, never the
  // unfrozen wait, and the host's exit once its drain settles starts the successor with no crash
  it('a mawsd that meets its engine host already draining takes it back into the handover: not ready, told as draining, the successor at its exit', { timeout: 30_000 }, async () => {
    const drain = { inFlight: 1 };
    const draining = { ...holder(1), holder: { ...holder(1).holder, handover: 'draining', inFlight: 1, tool: 'artifact_list' } };
    const old = await scene.engine({
      buildId: 'an-older-build', counts: { liveSessions: 1, rows: 1 },
      answers: { 'host.handover': () => (drain.inFlight > 0 ? { state: 'deferred', inFlight: drain.inFlight, tool: 'artifact_list' } : (old.handOver(), { state: 'detaching' })) },
    });
    const told: unknown[] = [];
    const daemon = await scene.start();
    daemon.hosts.onHandover('engine-host', (state) => void told.push(state));
    const main = scene.appHosts({}, { machine: true });
    void main.start();
    await until(() => main.snapshot('engine-host').state === 'ready' && main.streaming('engine-host'), 10_000, 'main served by the frozen host');
    await until(() => old.emitRaw('host.supervisorStatus', { ...draining, pid: old.pid }), 5_000, 'a client ready'); // the host's status at its client's ready line
    await until(() => old.named('host.handover').length >= 1, 5_000, 'asked again');
    expect(daemon.hosts.snapshot('engine-host').state).toBe('restarting');
    await until(() => main.snapshot('engine-host').state !== 'ready', 5_000, 'main’s link closed by mawsd');
    expect(daemon.hosts.handoverState('engine-host')).toEqual({ state: 'draining', inFlight: 1, tool: 'artifact_list' });
    expect(told.some((state) => (state as { state?: string } | null)?.state === 'waiting')).toBe(false);
    drain.inFlight = 0;
    await until(() => scene.engines.length === 2 && daemon.hosts.snapshot('engine-host').state === 'ready', 15_000, 'the successor, at the next ask');
    expect([daemon.hosts.snapshot('engine-host').restarts, daemon.hosts.facts('engine-host').lastExit]).toEqual([0, null]);
  });

  // fix wave 3b: with no app attached its link never says ready, so no status event ever reaches mawsd; the status it
  // asks at the welcome tells it the drain is armed, and the frozen host is never served as ready to anyone. The ask is
  // the transport's own, on a link just welcomed: no need, no wake
  it('a mawsd with no app attached that meets its engine host already draining never serves it as ready; the successor follows its exit', { timeout: 30_000 }, async () => {
    const drain = { inFlight: 1 };
    const draining = () => ({ ...holder(1), holder: { ...holder(1).holder, handover: 'draining', inFlight: drain.inFlight, tool: 'artifact_list' } });
    const old = await scene.engine({
      counts: { liveSessions: 1, rows: 1 },
      answers: {
        'host.supervisorStatus': () => (scene.engines.length > 1 ? holder(1) : draining()),
        'host.handover': () => (drain.inFlight > 0 ? { state: 'deferred', inFlight: drain.inFlight, tool: 'artifact_list' } : (old.handOver(), { state: 'detaching' })),
      },
    });
    const daemon = await scene.start();
    await until(() => old.named('host.handover').length >= 1, 5_000, 'taken back into the handover');
    expect(daemon.hosts.snapshot('engine-host').state).toBe('restarting');
    expect(daemon.hosts.handoverState('engine-host')).toEqual({ state: 'draining', inFlight: 1, tool: 'artifact_list' });
    const cli = await scene.app('machine', { capabilities: [] });
    const ping = cli.request('engine.ping', undefined, 20_000); // new work: held for the successor
    await sleep(300);
    drain.inFlight = 0;
    await until(() => scene.engines.length === 2 && daemon.hosts.snapshot('engine-host').state === 'ready', 15_000, 'the successor, at the next ask');
    expect(await ping).toMatchObject({ ok: true });
    expect(old.calls.map((call) => call.name).filter((name) => name !== 'host.handover'), 'nothing but its status reached the frozen host').toEqual(['host.supervisorStatus']);
    expect([daemon.hosts.snapshot('engine-host').restarts, daemon.hosts.facts('engine-host').lastExit]).toEqual([0, null]);
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
          scene.lastEngine().handOver();
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
    old.handOver(); // its drain settled: it exits
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
        scene.lastEngine().handOver(100);
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
          scene.lastEngine().handOver();
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
    expect([daemon.hosts.snapshot('engine-host').restarts, daemon.hosts.facts('engine-host').lastExit]).toEqual([0, null]); // the idle exit asked: no crash (fix wave 3)
  });
});

// P5 O16 M3b fix wave 2 (#1): `mawsd` closes main's engine-host.sock link the moment its engine host leaves ready, so the
// app's completions of the old host's in-flight calls go by main's machine.sock link (host-supervisor's `viaMachine`),
// whose front forwards them to the host that raised each request: the draining host while it drains, a successor for its
// own; one whose raising host is gone is answered host_unavailable at once and is no need (nothing woken, held or
// launched). The front admits these names from main's local link; the remote endpoint's offers do not gain them
// (test/endpoint/drain-replies.test.ts).
describe('the completions of the old host’s calls', () => {
  const PANE = (requestId: string) => ({ appSessionId: 'app-1', requestId, pane: 'terminal', target: null, line: null });
  const ANSWER = (requestId: string) => ({ appSessionId: 'app-1', requestId, result: { ok: false, error: 'closed' } });

  async function mainOnMawsd(daemonExtra = {}) {
    const daemon = await scene.start(daemonExtra);
    const shown: string[] = [];
    const main = scene.appHosts({ emit: (name, payload) => (name === 'maws.pane.show' && void shown.push((payload as { requestId: string }).requestId), true) }, { machine: true });
    void main.start();
    await until(() => main.snapshot('engine-host').state === 'ready' && main.snapshot('machine').state === 'ready' && main.streaming('engine-host') && daemon.hosts.snapshot('engine-host').state === 'ready', 10_000, 'main’s two links, past the attach’s recycle');
    return { daemon, main, shown };
  }

  it('the app’s pane answer during a deferred drain reaches the old host before it detaches; the successor’s own request is answered by the successor; a late answer for the gone host is refused at once', { timeout: 30_000 }, async () => {
    const drain = { inFlight: 1 };
    scene.engineSpawn = {
      answers: {
        ...{ 'host.supervisorStatus': () => holder(0) },
        'maws.pane.answer': () => {
          drain.inFlight = 0; // the old host's show_pane settled
          return { outcome: 'delivered' };
        },
        'host.handover': () => {
          if (drain.inFlight > 0) return { state: 'deferred', inFlight: drain.inFlight };
          scene.lastEngine().handOver();
          return { state: 'detaching' };
        },
      },
    };
    const { daemon, main, shown } = await mainOnMawsd();
    const old = scene.lastEngine();
    await until(() => old.emitRaw('maws.pane.show', PANE('req-old')), 5_000, 'a ready link to the old host'); // written once its link is ready
    await until(() => shown.includes('req-old'), 5_000, 'the old host’s pane request at the app');
    const cli = await scene.app('machine', { capabilities: [] });
    expect(await cli.request('daemon.restartEngineHost')).toMatchObject({ ok: true, value: { state: 'deferred', inFlight: 1 } });
    await until(() => main.snapshot('engine-host').state !== 'ready', 5_000, 'main’s engine-host link closed by mawsd');

    const answered = await main.dispatch('engine-host', 'maws.pane.answer', ANSWER('req-old'));
    expect(answered).toEqual({ ok: true, value: { outcome: 'delivered' } }); // the old host's answer
    expect(old.named('maws.pane.answer')).toEqual([ANSWER('req-old')]);
    expect(old.supervisor.exits).toEqual([]); // delivered before the detach
    await until(() => scene.engines.length === 2 && daemon.hosts.snapshot('engine-host').state === 'ready', 10_000, 'the successor');
    const successor = scene.lastEngine();
    await until(() => successor.emitRaw('maws.pane.show', PANE('req-new')), 5_000, 'a ready link to the successor');
    await sleep(50); // through mawsd's supervisor, which records its raiser
    expect(await cli.request('maws.pane.answer', ANSWER('req-new'))).toMatchObject({ ok: true, value: { outcome: 'delivered' } });
    expect(successor.named('maws.pane.answer')).toEqual([ANSWER('req-new')]);
    const late = await cli.request('maws.pane.answer', ANSWER('req-old'));
    expect(late).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(successor.named('maws.pane.answer')).toEqual([ANSWER('req-new')]); // never the successor's
    expect(old.named('maws.pane.answer')).toHaveLength(1);
  });

  it('the front admits each completion from the machine’s own client and forwards it to the engine host', { timeout: 20_000 }, async () => {
    const UUID = '00000000-0000-4000-8000-000000000002';
    const inputs: Record<string, unknown> = {
      'maws.pane.answer': ANSWER('req-1'),
      'maws.artifact.captured': { appSessionId: 'app-1', requestId: 'req-2', result: { ok: false, error: 'no display' } },
      'maws.artifact.exported': { appSessionId: 'app-1', requestId: 'req-3', answer: { ok: false, error: 'closed' } },
      'maws.artifact.datasetRefreshed': { requestId: UUID, outcome: { ok: true } },
      'artifacts.datasetRefreshRequest': { requestId: UUID },
    };
    expect(Object.keys(inputs).sort()).toEqual([...DRAIN_REPLIES].sort());
    scene.engineSpawn = { answers: { 'host.supervisorStatus': () => holder(0) } };
    const daemon = await scene.start();
    daemon.hosts.wake('engine-host');
    await until(() => daemon.hosts.snapshot('engine-host').state === 'ready');
    const cli = await scene.app('machine', { capabilities: [] });
    for (const [name, input] of Object.entries(inputs)) {
      expect(await cli.request(name, input), name).toMatchObject({ ok: true });
      expect(scene.lastEngine().named(name), name).toEqual([input]);
    }
  });

  it('to a parked engine host: answered host_unavailable at once, nothing launched and the park left as it was', async () => {
    const daemon = await scene.start();
    const cli = await scene.app('machine', { capabilities: [] });
    expect(daemon.hosts.parked('engine-host')).toBe(true);
    const asked = Date.now();
    expect(await cli.request('maws.pane.answer', ANSWER('req-stale'))).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(await cli.request('maws.artifact.datasetRefreshed', { requestId: '00000000-0000-4000-8000-000000000001', outcome: { ok: true } })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(Date.now() - asked).toBeLessThan(1_000);
    await sleep(200);
    expect(scene.spawn).not.toHaveBeenCalled();
    expect(daemon.hosts.parked('engine-host')).toBe(true);
  });
});

// P5 O16 M3b fix wave 2 (#2): a deliberate stop reaches the host that still owns the drain, by main's machine.sock link
// while its engine-host link is down; that link keeps its `replace`, so whether the stop or the drain ends the old host,
// its close starts the successor: never a park with detached rows.
describe('a deliberate stop during the drain', () => {
  async function deferred(stopAll: () => unknown) {
    scene.engineSpawn = { answers: { 'host.supervisorStatus': () => holder(0), 'host.handover': () => ({ state: 'deferred', inFlight: 1 }), 'host.stopAll': stopAll } };
    const daemon = await scene.start();
    const main = scene.appHosts({}, { machine: true });
    void main.start();
    await until(() => main.snapshot('engine-host').state === 'ready' && main.snapshot('machine').state === 'ready' && main.streaming('engine-host') && daemon.hosts.snapshot('engine-host').state === 'ready', 10_000, 'main’s two links, past the attach’s recycle');
    const old = scene.lastEngine();
    const cli = await scene.app('machine', { capabilities: [] });
    expect(await cli.request('daemon.restartEngineHost')).toMatchObject({ ok: true, value: { state: 'deferred' } });
    await until(() => main.snapshot('engine-host').state !== 'ready', 5_000, 'main’s engine-host link closed by mawsd');
    return { daemon, main, old };
  }
  const exitsAfterAnswer = () => {
    const old = scene.lastEngine();
    setImmediate(() => void old.supervisor.die()); // a stop-all's exit, after its answer
    return { stopped: 2, forced: 0 };
  };

  it('Settings’ stop-all (restartSupervisor {stopSessions: true}) reaches the old host; its close starts the successor', async () => {
    const { daemon, main, old } = await deferred(exitsAfterAnswer);
    expect(await main.restartSupervisor({ stopSessions: true })).toEqual({ ok: true, value: undefined });
    expect(old.named('host.stopAll')).toEqual([{ graceMs: 5_000 }]);
    await until(() => scene.engines.length === 2 && daemon.hosts.snapshot('engine-host').state === 'ready', 10_000, 'the successor');
    expect(daemon.hosts.parked('engine-host')).toBe(false);
    expect(scene.spawn).toHaveBeenCalledTimes(2);
    expect([daemon.hosts.snapshot('engine-host').restarts, daemon.hosts.facts('engine-host').lastExit]).toEqual([0, null]); // the stop ended it: no crash (fix wave 3)
  });

  it('the quit’s stop-all reaches the old host; its close starts the successor', async () => {
    const { daemon, main, old } = await deferred(exitsAfterAnswer);
    await main.stopAllForQuit(4_000);
    expect(old.named('host.stopAll')).toEqual([{ graceMs: 4_000 }]);
    await until(() => scene.engines.length === 2 && daemon.hosts.snapshot('engine-host').state === 'ready', 10_000, 'the successor');
    expect(daemon.hosts.parked('engine-host')).toBe(false);
  });

  it('a stop-all the old host never answers, its drain outlasting the request deadline: the close still starts the successor, no park', { timeout: 40_000 }, async () => {
    const { daemon, main, old } = await deferred(() => new Promise(() => {}));
    const stopped = main.restartSupervisor({ stopSessions: true });
    await until(() => old.named('host.stopAll').length === 1, 5_000, 'the stop at the old host');
    expect(await stopped).toMatchObject({ ok: false, error: { code: 'timeout' } });
    await old.supervisor.die(); // the drain settled past the deadline: its rows detached, it exits
    await until(() => scene.engines.length === 2 && daemon.hosts.snapshot('engine-host').state === 'ready', 10_000, 'the successor');
    expect(daemon.hosts.parked('engine-host')).toBe(false);
    expect(scene.spawn).toHaveBeenCalledTimes(2);
  });
});
