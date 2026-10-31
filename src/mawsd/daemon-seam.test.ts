// `mawsd`'s endpoint seam (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, "The endpoint seam"), through a
// fake EndpointModule over the daemon in this process and stand-in hosts on real sockets (test/support/mawsd-scene.ts):
// when it starts and stops, what its dispatch does, its holds against a private daemon's idle exit, its document channels
// beside the app's, and a remote viewer's interest against the park clock.
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { MawsdScene, sleep, until } from '../../test/support/mawsd-scene';
import type { AppSessionId } from '@shared/graph/ids';
import type { DaemonServices, EndpointModule } from './endpoint-seam';

let scene: MawsdScene;

beforeEach(() => {
  scene = new MawsdScene('maws-ms-');
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${scene.logs.join('\n')}\n--- the hosts' logs\n${scene.supervisors.flatMap((s) => s.logs).join('\n')}\n`));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(async () => {
  await scene.dispose();
  vi.restoreAllMocks();
});

const BASE = 2 ** 31;
const ACTOR = { kind: 'session' as const, appSessionId: 'app-1' as AppSessionId };
const ARTIFACT = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';

class FakeEndpoint implements EndpointModule {
  services: DaemonServices | null = null;
  atStart: { spawns: number; logs: string[] } | null = null;
  stopped = 0;
  stopImpl: () => Promise<void> = async () => {};
  readonly cliCalls: unknown[][] = [];

  async start(services: DaemonServices): Promise<void> {
    this.services = services;
    this.atStart = { spawns: scene.spawn.mock.calls.length, logs: [...scene.logs] };
  }
  stop(): Promise<void> {
    this.stopped += 1;
    return this.stopImpl();
  }
  status(): unknown {
    return { enrolled: false };
  }
  enrollment(): null {
    return null;
  }
  async cli(command: string, args: readonly string[], secret?: string): Promise<{ code: number; out: string }> {
    this.cliCalls.push([command, args, secret]);
    return { code: 0, out: `${command} ${args.join(' ')}` };
  }
  get s(): DaemonServices {
    if (!this.services) throw new Error('not started');
    return this.services;
  }
}

async function started(extra: Parameters<MawsdScene['start']>[0] = {}) {
  const endpoint = new FakeEndpoint();
  const daemon = await scene.start({ endpoint, ...extra });
  return { endpoint, daemon };
}

describe('the seam’s life', () => {
  it('starts once mawsd’s sockets are up, before any adoption and any app, with both hosts parked', async () => {
    const { endpoint, daemon } = await started();
    expect(endpoint.atStart!.spawns).toBe(0);
    expect(endpoint.atStart!.logs.filter((line) => line.startsWith('listening on'))).toHaveLength(4); // P5 O5 M2: artifacts.sock the fourth
    expect(endpoint.atStart!.logs.some((line) => line.startsWith('serving'))).toBe(false);
    expect(endpoint.s.machine).toEqual({ ref: daemon.ref, profileDir: scene.root, stateDir: scene.paths.endpoint, kind: 'private' });
    expect(daemon.hosts.parked('engine-host')).toBe(true);
    expect(daemon.hosts.parked('pty-host')).toBe(true);
  });

  it('its dispatch wakes a parked host and answers raw; machine requests are the daemon namespace, daemon.endpoint its cli', async () => {
    scene.engineSpawn = { answers: { 'engine.ping': () => ({ pid: 1, extra: 'raw' }) } };
    const { endpoint, daemon } = await started();
    await expect(endpoint.s.dispatch('engine-host', 'engine.ping', undefined)).resolves.toMatchObject({ ok: true, value: { pid: 1, extra: 'raw' } });
    expect(scene.spawn).toHaveBeenCalledOnce();
    expect(daemon.hosts.parked('pty-host')).toBe(true);
    const status = await endpoint.s.dispatch('machine', 'daemon.status', undefined);
    expect(status).toMatchObject({ ok: true, value: { pid: process.pid, kind: 'private', machine: daemon.ref, endpoint: { present: true, detail: { enrolled: false } } } });
    await expect(endpoint.s.dispatch('machine', 'daemon.endpoint', { command: 'enroll', args: ['--hub', 'h'], secret: 's3cret' })).resolves.toMatchObject({ ok: true, value: { code: 0, out: 'enroll --hub h' } });
    expect(endpoint.cliCalls).toEqual([['enroll', ['--hub', 'h'], 's3cret']]);
    expect(scene.logs.join('\n')).not.toContain('s3cret');
  });

  it('stop is first in the exit order, awaited, and at most 2.5 s', async () => {
    const { endpoint, daemon } = await started();
    const app = await scene.app();
    let appClosedAtStop: boolean | null = null;
    endpoint.stopImpl = () => {
      appClosedAtStop = app.closed;
      return new Promise(() => {}); // never settles
    };
    const began = Date.now();
    await daemon.stop('test');
    const took = Date.now() - began;
    expect(endpoint.stopped).toBe(1);
    expect(appClosedAtStop).toBe(false);
    expect(took).toBeGreaterThanOrEqual(2_400);
    expect(took).toBeLessThan(4_500);
    expect(scene.exits).toEqual([0]);
    await until(() => app.closed);
  });

  it('onAttachment fires at each attach and departure on engine-host.sock', async () => {
    const { endpoint } = await started();
    const seen: boolean[] = [];
    endpoint.s.onAttachment((attached) => void seen.push(attached));
    const first = await scene.app();
    await until(() => seen.length === 1);
    first.leave();
    await until(() => seen.length === 2);
    const second = await scene.app();
    expect(second.welcomed()).toBe(true);
    await until(() => seen.length === 3);
    expect(seen).toEqual([true, false, true]);
  });

  // P5 O10 M10: an unenrolled daemon starts its endpoint at its first command (lever (a)), maybe with an app attached and
  // the engine-host link up; a listener that comes then hears the state as it stands, as one at start would have heard it
  // arrive. At start step 7 neither is on yet, so a listener then hears nothing at once.
  it('onAttachment and onUpstream tell a listener that comes later the state as it stands', async () => {
    const { endpoint } = await started();
    const early: string[] = [];
    endpoint.s.onAttachment((attached) => void early.push(`attached ${attached}`));
    endpoint.s.onUpstream((link) => void early.push(`link ${link.connected}`));
    expect(early).toEqual([]);
    await scene.app();
    await until(() => early.includes('attached true') && early.at(-1) === 'link true', 3_000, 'the attach and its link');
    const late: unknown[] = [];
    endpoint.s.onAttachment((attached) => void late.push(attached));
    endpoint.s.onUpstream((link) => void late.push(link));
    const generation = (late[1] as { generation?: number } | undefined)?.generation;
    expect(late).toEqual([true, { connected: true, generation }]);
    expect(generation).toBeGreaterThan(0);
  });
});

describe('a private daemon’s holds', () => {
  it('with its idle time run out and both hosts parked it stays up while a hold is out, and exits 0 once it is released', async () => {
    scene.engineSpawn = { onExitIdle: (self) => void self.die() }; // nothing live: it exits once asked
    const { endpoint, daemon } = await started();
    const release = endpoint.s.hold('a remote channel');
    const app = await scene.app();
    await app.request('host.configure', { idleExitMs: 200 });
    app.leave();
    await until(() => daemon.hosts.parked('engine-host'), 4_000, 'the engine host’s park');
    await sleep(600);
    expect(scene.exits).toEqual([]);
    release();
    release(); // a second release is nothing
    await until(() => scene.exits.length > 0, 3_000, 'the idle exit');
    expect(scene.exits).toEqual([0]);
  });
});

describe('the pty host through the seam', () => {
  it('pty.attach goes with credit: false whatever it asked; pty.ack and pty.checkpoint are refused', async () => {
    const { endpoint } = await started();
    await expect(endpoint.s.dispatch('pty-host', 'pty.attach', { ptyId: 'p-1', credit: true })).resolves.toMatchObject({ ok: true });
    const pty = scene.ptys.at(-1)!;
    expect(pty.named('pty.attach')).toEqual([{ ptyId: 'p-1', credit: false }]);
    for (const name of ['pty.ack', 'pty.checkpoint']) {
      const refused = await endpoint.s.dispatch('pty-host', name, { ptyId: 'p-1', offset: 10, state: '' });
      expect(refused).toMatchObject({ ok: false, error: { code: 'internal', message: expect.stringContaining("the credit is the app's or the daemon's") } });
    }
    expect(pty.named('pty.ack')).toEqual([]);
    expect(pty.named('pty.checkpoint')).toEqual([]);
  });

  it('a host.interest through the seam is refused: a remote viewer’s interest arrives through interest.report', async () => {
    const { endpoint } = await started();
    await expect(endpoint.s.dispatch('engine-host', 'host.interest', { sessions: ['s'] })).resolves.toMatchObject({ ok: false, error: { code: 'internal' } });
  });
});

describe('the endpoint’s document channels', () => {
  async function linked(extra: Parameters<typeof started>[0] = {}) {
    const ctx = await started(extra);
    const links: { connected: boolean; generation: number }[] = [];
    ctx.endpoint.s.onUpstream((link) => void links.push(link));
    const frames: { channel: number; bytes: Uint8Array }[] = [];
    ctx.endpoint.s.onFrame((frame) => {
      if (frame.owner === 'engine-host') frames.push({ channel: frame.channel, bytes: frame.bytes });
    });
    const closed: [number, string][] = [];
    ctx.endpoint.s.documents.onClosed((channel, reason) => void closed.push([channel, reason]));
    return { ...ctx, links, frames, closed };
  }

  it('the endpoint’s channel at 2^31 and the app’s at 1 carry their own frames; a channel below 2^31 is not the endpoint’s', async () => {
    const { endpoint, links, frames } = await linked();
    const app = await scene.app();
    await until(() => links.at(-1)?.connected === true && links.length >= 3, 3_000, 'the attach’s fresh link'); // wake, recycle
    expect(endpoint.s.documents.open({ t: 'documents.open', channel: 7, artifactId: ARTIFACT, actor: ACTOR })).toBe(false);
    expect(endpoint.s.documents.open({ t: 'documents.open', channel: BASE, artifactId: ARTIFACT, actor: ACTOR })).toBe(true);
    app.post({ t: 'documents.open', channel: 1, artifactId: ARTIFACT, actor: ACTOR });
    const engine = scene.lastEngine();
    await until(() => engine.docs.length === 2, 3_000, 'both channels upstream');
    expect(endpoint.s.documents.frame(BASE, Uint8Array.of(9))).toBe(true);
    app.port!.postDoc(1, Uint8Array.of(1));
    await until(() => frames.length === 1 && app.frames.length === 1, 3_000, 'the echoes');
    expect(frames).toEqual([{ channel: BASE, bytes: Uint8Array.of(9, 0xff) }]);
    expect(app.frames).toEqual([{ channel: 1, bytes: Uint8Array.of(1, 0xff) }]);
    endpoint.s.documents.close(BASE);
    expect(endpoint.s.documents.frame(BASE, Uint8Array.of(9))).toBe(false);
    await until(() => engine.docs.filter((doc) => doc.closed).length === 1, 3_000, 'the endpoint’s close upstream');
  });

  it('the host’s reset of the endpoint’s channel reaches onClosed with reset, the app’s attachment unchanged', async () => {
    scene.engineSpawn = { docHighWater: 1024 };
    const { endpoint, links, closed } = await linked();
    const attachments: boolean[] = [];
    endpoint.s.onAttachment((attached) => void attachments.push(attached));
    const app = await scene.app();
    await until(() => links.at(-1)?.connected === true && links.length >= 3, 3_000, 'the attach’s fresh link');
    expect(endpoint.s.documents.open({ t: 'documents.open', channel: BASE, artifactId: ARTIFACT, actor: ACTOR })).toBe(true);
    const engine = scene.lastEngine();
    await until(() => engine.docs.length === 1, 3_000, 'the channel upstream');
    engine.supervisor.connections.at(-1)!.cork(); // the host's writes queue past the high-water mark
    for (let i = 0; i < 4; i++) endpoint.s.documents.frame(BASE, new Uint8Array(4096));
    await until(() => engine.supervisor.logs.some((line) => line.includes(`channel ${BASE} reset`)), 3_000, 'the host’s reset');
    engine.supervisor.connections.at(-1)!.uncork(); // its documents.closed was queued behind the frames
    await until(() => closed.length === 1, 3_000, 'the reset');
    expect(closed).toEqual([[BASE, 'reset']]);
    expect(attachments).toEqual([true]);
    expect(app.closed).toBe(false);
  });

  it('an upstream reconnect with no app: each open channel closes upstream, then disconnected, then connected with the next generation; open is false between', async () => {
    const { endpoint, links, closed } = await linked();
    await endpoint.s.dispatch('engine-host', 'engine.ping', undefined);
    await until(() => links.length === 1);
    expect(links).toEqual([{ connected: true, generation: 1 }]);
    expect(endpoint.s.documents.open({ t: 'documents.open', channel: BASE, artifactId: ARTIFACT, actor: ACTOR })).toBe(true);
    expect(endpoint.s.documents.open({ t: 'documents.open', channel: BASE + 1, artifactId: ARTIFACT, actor: ACTOR })).toBe(true);
    const order: string[] = [];
    let openBetween: boolean | null = null;
    endpoint.s.documents.onClosed((channel, reason) => void order.push(`closed ${channel - BASE} ${reason}`));
    endpoint.s.onUpstream((link) => {
      order.push(`upstream ${link.connected} ${link.generation}`);
      if (!link.connected) openBetween = endpoint.s.documents.open({ t: 'documents.open', channel: BASE + 2, artifactId: ARTIFACT, actor: ACTOR });
    });
    scene.lastEngine().supervisor.dropClient(); // a quiet loss: the host lives on
    await until(() => links.length === 3, 3_000, 'the reconnect');
    // the listener came while the link was up, and heard that first (O10 M10)
    expect(order).toEqual(['upstream true 1', 'closed 0 upstream', 'closed 1 upstream', 'upstream false 1', 'upstream true 2']);
    expect(closed).toEqual([
      [BASE, 'upstream'],
      [BASE + 1, 'upstream'],
    ]);
    expect(openBetween).toBe(false);
    expect(endpoint.s.documents.open({ t: 'documents.open', channel: BASE + 2, artifactId: ARTIFACT, actor: ACTOR })).toBe(true);
    expect(scene.spawn).toHaveBeenCalledOnce();
  });
});

describe('a remote viewer’s interest and the park clock', () => {
  it('a reported session keeps the engine host from being armed past the idle time, and joins the union upstream; once dropped, the clock arms', async () => {
    const { endpoint } = await started();
    const app = await scene.app();
    await app.request('host.configure', { idleExitMs: 200 });
    endpoint.s.interest.report('viewer-1', ['s-remote' as never]);
    const engine = scene.lastEngine();
    await until(() => JSON.stringify(engine.named('host.interest').at(-1)) === JSON.stringify({ sessions: ['s-remote'] }), 3_000, 'the union upstream');
    app.leave();
    await sleep(800); // past the idle time several times over
    expect(engine.supervisor.exits).toEqual([]);
    expect(engine.named('host.interest').at(-1)).toEqual({ sessions: ['s-remote'] }); // still held through the departure's recycle
    endpoint.s.interest.drop('viewer-1');
    await until(() => engine.supervisor.exits.includes('idle'), 3_000, 'the park clock');
    expect(engine.named('host.interest').at(-1)).toEqual({ sessions: [] });
  });
});
