// Browser work over `mawsd`'s permanent engine-host link (P5 O17 M3; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md,
// M3 and Interfaces §E; R4): the snapshot is the first command on every fresh link, a successor's included, ahead of
// the interest; an engine host whose welcome lists no `host.browserWork` is sent none; and an app is refused the command
// on its relay as `host.attachment` is. Over the daemon in this process and stand-in hosts on real sockets.
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { HOST_BROWSER_WORK_CAPABILITY, PEER_CAPABILITIES } from '@shared/host/socket-protocol';
import type { RunningDaemon } from './daemon';
import { MawsdScene, sleep, until } from '../../test/support/mawsd-scene';

let scene: MawsdScene;

const BROWSER_WORK_HOST = [...PEER_CAPABILITIES.engineHost]; // an engine host of M7's build: its welcome lists host.browserWork
const OLD_ENGINE_HOST = PEER_CAPABILITIES.engineHost.filter((name) => name !== HOST_BROWSER_WORK_CAPABILITY); // one that predates it

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

// P5 O16's transport asks a fresh port's `host.supervisorStatus` before it reports the link (detached-transport.ts,
// probeStatus: a drain armed or not), so mawsd's own commands on the link are the rest, the snapshot first among them
const mawsdCalls = (engine: { calls: { name: string; input: unknown }[] }) => engine.calls.filter((call) => call.name !== 'host.supervisorStatus');

describe('browser work on the engine-host link', () => {
  it('sends the snapshot first on each fresh link, ahead of the interest, the successor’s included', async () => {
    const daemon = await scene.start({ permanentClient: true });
    const first = await awake(daemon, 1);
    await until(() => first.named('host.interest').length > 0, 3_000, 'the interest');
    expect(mawsdCalls(first)[0]).toEqual({ name: 'host.browserWork', input: { held: [] } });
    expect(mawsdCalls(first).findIndex((call) => call.name === 'host.interest')).toBeGreaterThan(0);

    await first.supervisor.die(); // an engine-host restart: the successor is a fresh link
    const successor = await awake(daemon, 2);
    await until(() => mawsdCalls(successor).length > 0, 3_000, 'the successor’s first command');
    expect(mawsdCalls(successor)[0]).toEqual({ name: 'host.browserWork', input: { held: [] } });
  });

  it('sends nothing to an engine host whose welcome lists no host.browserWork (the old-host cell)', async () => {
    scene.engineSpawn = { capabilities: OLD_ENGINE_HOST };
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
