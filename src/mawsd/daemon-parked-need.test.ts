// A parked engine host's need on the daemon shape (P5; spine-seam.ts, `wanted`, and daemon.ts's `needEngine`): `mawsd`
// with the spine cold, the engine host parked and no app. The session service's boot waits for the host's first
// streaming in its load, and its commands wait for the boot (src/services/sessions/service.ts), so a machine.sock
// client's command (the maws CLI, a sminos bridge) or the endpoint's (another machine's app on a relayed channel) that
// waits on it is the need that wakes the host. Each answers within the host's launch and the boot; the woken host is not
// asked to park the moment it is ready (the park clock starts again from the need); and the idle cycle still ends with
// the host parked and the spine cold. The daemon runs in this process with the product's options (src/mawsd/index.ts),
// its spine the services entry, its engine host a stand-in on the real socket layer that exits once asked to exit when
// idle (test/support/mawsd-scene.ts). The stand-in answers none of the spine's own reads, which leaves the boot's
// recovery deferred and every command answered.
import { mkdtempSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import type { HostResponse } from '@shared/ipc/host-protocol';
import { MawsdScene, sleep, until } from '../../test/support/mawsd-scene';
import { DISCOVERY_WAKE_BOUND_MS } from './discovery-wake';
import type { DaemonServices, EndpointModule } from './endpoint-seam';

const IDLE_MS = 1_500; // the park clock's idle time, as the spine's host.configure sets it under the e2e (MAWS_E2E_SUPERVISOR_IDLE_MS)
const QUIET_MS = 300; // the spine's quiet period (MAWS_SPINE_QUIET_MS)
// The bound a discovery read keeps for the same callers (discovery-wake.ts): the tightest caller deadline, 10 s, less the
// answer's way back; a cold host's launch and the boot fit well within it
const BOUND_MS = DISCOVERY_WAKE_BOUND_MS;

let scene: MawsdScene;
let sminos: string;

beforeEach(() => {
  scene = new MawsdScene('maws-pn-');
  // it holds no row: asked to exit when idle, it exits; it answers the wake's ping as the engine host does
  scene.engineSpawn = { onExitIdle: (host) => void host.die(), answers: { 'engine.ping': () => ({ pid: 1, uptimeMs: 1, hostVersion: 'stand-in' }) } };
  sminos = mkdtempSync('/tmp/o3d-s-');
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${scene.logs.join('\n')}\n`));
  for (const method of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => {}); // the spine's own lines
});

afterEach(async () => {
  await scene.dispose();
  rmSync(sminos, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// The endpoint module, keeping the seam it is started with
function endpointSeam() {
  let services: DaemonServices | null = null;
  const endpoint: EndpointModule = {
    start: async (seam) => void (services = seam),
    stop: async () => {},
    status: () => null,
    enrollment: () => null,
    cli: async () => ({ code: 0, out: '' }),
  };
  return { endpoint, services: () => services! };
}

async function start(endpoint: EndpointModule) {
  return scene.start({
    endpoint,
    permanentClient: true,
    claimSpine: true,
    spine: { load: () => import('../services/entry'), wakeOnEvents: true },
    env: { MAWS_USER_DATA: scene.root, HOME: scene.root, SMINOS_HOME: sminos, MAWS_E2E: '1', MAWS_E2E_SUPERVISOR_IDLE_MS: String(IDLE_MS), MAWS_SPINE_QUIET_MS: String(QUIET_MS) },
  });
}

const ASKED_TO_PARK = 'no app and no interest for the idle time: asking the engine host to exit when idle';

describe('a command that waits on the engine host, on the daemon shape with the spine cold and the host parked', () => {
  it('a machine.sock client’s and the endpoint’s wake the host and answer within the bound; each idle cycle still ends parked and cold', async () => {
    const seam = endpointSeam();
    const daemon = await start(seam.endpoint); // (no daemon.status here: its read of the host's count wakes it)
    expect(daemon.hosts.parked('engine-host')).toBe(true);
    expect(scene.logs).not.toContainEqual(expect.stringMatching(/^\[spine\] loading/));

    // Each command waits on the boot; the host it wakes is not asked to park the moment it is ready. The second cycle
    // starts past the idle time the first set (the spine's host.configure), where the park clock's ask would be overdue
    // at once but for the need. The clients leave once answered, as the CLI does.
    const cycle = async (n: number, commands: () => Promise<unknown[]>) => {
      const started = Date.now();
      const answers = await commands();
      expect(Date.now() - started).toBeLessThan(BOUND_MS);
      for (const app of scene.apps) app.leave(false);
      expect(scene.spawn).toHaveBeenCalledTimes(n);
      expect(scene.logs.filter((line) => line === '[spine] a command waits on the engine host, which is parked: waking it').length).toBeGreaterThanOrEqual(1);
      await sleep(IDLE_MS / 3);
      expect(scene.logs.filter((line) => line === ASKED_TO_PARK)).toHaveLength(n - 1);
      expect(scene.lastEngine().supervisor.exits).toEqual([]);
      // the idle cycle: asked to park after the idle time, the host exits and parks, and the spine releases cold
      await until(() => scene.logs.filter((line) => line === ASKED_TO_PARK).length === n, IDLE_MS + 5_000, 'the park clock’s ask');
      await until(() => daemon.hosts.parked('engine-host'), 5_000, 'the park');
      await until(() => scene.logs.filter((line) => line === '[spine] released').length === n, 5_000, 'the spine’s release');
      return answers;
    };

    const client = await scene.app('machine', { capabilities: [] });
    const [listed, created, acquired] = await cycle(1, () =>
      Promise.all([
        client.request('session.intent.list', undefined, BOUND_MS),
        seam.services().dispatch('machine', 'session.create', { projectId: null, location: null }),
        seam.services().dispatch('machine', 'session.acquire', { appSessionId: 'app-unknown', reason: 'read' }),
      ]),
    );
    expect(listed).toMatchObject({ ok: true, value: { intents: expect.any(Array) } }); // answered beside the create, before or after it
    expect(created).toMatchObject({ ok: true, value: { appSessionId: expect.any(String) } });
    expect(acquired).toMatchObject({ ok: true, value: { status: 'refused', reason: 'unknown_session' } });

    const cli = await scene.app('machine', { capabilities: [] });
    const [again] = await cycle(2, () => Promise.all([cli.request('session.intent.list', undefined, BOUND_MS)]));
    expect(again).toMatchObject({ ok: true, value: { intents: [expect.objectContaining({ appSessionId: (created as { value: { appSessionId: string } }).value.appSessionId })] } });
    await sleep(300);
    expect(scene.logs.filter((line) => line.startsWith('[spine] loading'))).toEqual(['[spine] loading (command)', '[spine] loading (command)']);
    expect(daemon.hosts.parked('engine-host')).toBe(true);
    expect(scene.spawn).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('a command that never waits on the boot loads the spine and wakes nothing', async () => {
    const seam = endpointSeam();
    const daemon = await start(seam.endpoint);
    const answer: HostResponse = await seam.services().dispatch('machine', 'attention.list', undefined);
    expect(answer).toMatchObject({ ok: true });
    await sleep(500);
    expect(scene.logs).toContain('[spine] loading (command)');
    expect(scene.spawn).not.toHaveBeenCalled();
    expect(daemon.hosts.parked('engine-host')).toBe(true);
  }, 30_000);
});
