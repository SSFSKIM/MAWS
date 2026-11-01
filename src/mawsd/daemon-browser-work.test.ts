// Browser work over `mawsd`'s permanent engine-host link (P5 O17 M3; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md,
// M3 and Interfaces §E; R4): the snapshot is the first command on every fresh link, a successor's included, ahead of
// the interest; an engine host whose welcome lists no `host.browserWork` is sent none; and an app is refused the command
// on its relay as `host.attachment` is. Over the daemon in this process and stand-in hosts on real sockets.
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { HOST_BROWSER_WORK_CAPABILITY, PEER_CAPABILITIES } from '@shared/host/socket-protocol';
import type { RunningDaemon } from './daemon';
import { MawsdScene, sleep, until } from '../../test/support/mawsd-scene';

let scene: MawsdScene;

const BROWSER_WORK_HOST = [...PEER_CAPABILITIES.engineHost, HOST_BROWSER_WORK_CAPABILITY]; // an engine host of M7's build

beforeEach(() => {
  scene = new MawsdScene('maws-bw-');
  scene.engineSpawn = { capabilities: BROWSER_WORK_HOST };
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${scene.logs.join('\n')}\n`));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(async () => {
  await scene.dispose();
  vi.restoreAllMocks();
});

async function awake(daemon: RunningDaemon, count: number) {
  void daemon.hosts.wake('engine-host');
  await until(() => scene.engines.length === count && daemon.hosts.snapshot('engine-host').state === 'ready', 5_000, `engine host ${count}`);
  return scene.lastEngine();
}

describe('browser work on the engine-host link', () => {
  it('sends the snapshot first on each fresh link, ahead of the interest, the successor’s included', async () => {
    const daemon = await scene.start({ permanentClient: true });
    const first = await awake(daemon, 1);
    await until(() => first.named('host.interest').length > 0, 3_000, 'the interest');
    expect(first.calls[0]).toEqual({ name: 'host.browserWork', input: { held: [] } });
    expect(first.calls.findIndex((call) => call.name === 'host.interest')).toBeGreaterThan(0);

    await first.supervisor.die(); // an engine-host restart: the successor is a fresh link
    const successor = await awake(daemon, 2);
    await until(() => successor.calls.length > 0, 3_000, 'the successor’s first command');
    expect(successor.calls[0]).toEqual({ name: 'host.browserWork', input: { held: [] } });
  });

  it('sends nothing to an engine host whose welcome lists no host.browserWork (the old-host cell)', async () => {
    scene.engineSpawn = { capabilities: [...PEER_CAPABILITIES.engineHost] };
    const daemon = await scene.start({ permanentClient: true });
    const engine = await awake(daemon, 1);
    await until(() => engine.named('host.interest').length > 0, 3_000, 'the interest');
    await sleep(100);
    expect(engine.named('host.browserWork')).toEqual([]);
  });

  it('refuses host.browserWork from an app on its relay, forbidden_sender, and the engine host hears none of it', async () => {
    const daemon = await scene.start({ permanentClient: true });
    const engine = await awake(daemon, 1);
    const app = await scene.app();
    app.ready();
    const answer = await app.request('host.browserWork', { held: ['app-1'] });
    expect(answer).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    expect(engine.named('host.browserWork')).toEqual([{ held: [] }]); // mawsd's own, at the link's start
  });
});
