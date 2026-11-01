// `mawsd` as the engine host's permanent client (P5 O3-D M3; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, M3
// and Interfaces §D; D4, D8, D30), built behind the daemon option `permanentClient`, off in production until M5. With
// the option on and an engine host whose welcome lists `host.attachment`, mawsd keeps one connection for its life, ready
// by its own resync, and tells the host each app's attachment; with the option off, or to a host that lists it not,
// O2's recycle per attachment stays, as master's daemon.test.ts pins it. The endpoint seam's `onAttachment` says whether
// events are available. Over the daemon in this process and stand-in hosts on real sockets (test/support/mawsd-scene.ts).
// P5 O5 M4: the stand-in engine host is one of O3-D's build (its welcome lists no `host.render`), which mawsd tells only
// the attachment; a render-reading host's `render: true` and its tell at each streaming are daemon-render.test.ts's.
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { ATTACHMENT_CAPABILITY, HOST_RENDER_CAPABILITY, MACHINE_SPINE_CAPABILITY, PEER_CAPABILITIES, PTY_FRAMES_CAPABILITY, HOLDER_CAPABILITY } from '@shared/host/socket-protocol';
import type { HostResync } from '@shared/host/host-supervisor';
import { takeSpineLock } from '../services/settings/spine-lock';
import type { SpineDeps } from '../services/spine-root';
import type { DaemonServices, EndpointModule } from './endpoint-seam';
import type { SpineEntry } from './spine-seam';
import { MawsdScene, sleep, until } from '../../test/support/mawsd-scene';

let scene: MawsdScene;

const O3D_ENGINE = PEER_CAPABILITIES.engineHost.filter((name) => name !== HOST_RENDER_CAPABILITY); // P5 O5 M4 (above)

beforeEach(() => {
  scene = new MawsdScene('maws-mp-');
  scene.engineSpawn = { capabilities: O3D_ENGINE };
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${scene.logs.join('\n')}\n--- the hosts' logs\n${scene.supervisors.flatMap((s) => s.logs).join('\n')}\n`));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(async () => {
  await scene.dispose();
  vi.restoreAllMocks();
});

const INCAPABLE = [PTY_FRAMES_CAPABILITY]; // an engine host of a build before O3-D M3 (O2's update rule keeps one serving)

// What the endpoint module hears through the seam: availability and the engine host's events
function listening() {
  let services: DaemonServices | null = null;
  const availability: boolean[] = [];
  const events: unknown[] = [];
  const endpoint: EndpointModule = {
    start: async (s) => {
      services = s;
      s.onAttachment((available) => void availability.push(available));
      s.onEvent((owner, message) => {
        if (owner === 'engine-host' && message.name === 'probe.event') events.push(message.payload);
      });
    },
    stop: async () => {},
    status: () => null,
    enrollment: () => null,
    cli: async () => ({ code: 0, out: '' }),
  };
  return { endpoint, availability, events, services: () => services! };
}

const attachments = () => scene.lastEngine().named('host.attachment');

describe('the permanent client, on, to an engine host that lists host.attachment', () => {
  it('declares the capability, streams from its welcome with no app, and keeps one connection across attaches and departures, telling each', async () => {
    const seam = listening();
    await scene.start({ endpoint: seam.endpoint, permanentClient: true });
    expect(await seam.services().dispatch('engine-host', 'engine.ping', undefined)).toMatchObject({ ok: true }); // wakes it, no app
    const engine = scene.lastEngine();
    expect(engine.supervisor.peer()?.capabilities).toEqual([PTY_FRAMES_CAPABILITY, ATTACHMENT_CAPABILITY, HOLDER_CAPABILITY]); // P5 O16 M3b: host.holder whatever the option
    // ready by its own resync with the spine cold (nothing to pull): events flow with no app, and are available
    await until(() => engine.send({ n: 1 }), 3_000, 'the link’s ready line');
    await until(() => seam.events.length === 1, 3_000, 'the event through the seam');
    expect(seam.availability).toEqual([true]);
    expect(attachments()).toEqual([]);
    const links = engine.supervisor.connections.length;

    const app = await scene.app();
    expect(app.welcomed()).toBe(true);
    await until(() => attachments().length === 1, 3_000, 'the attachment');
    expect(attachments()).toEqual([{ attached: true }]);
    app.ready();
    await app.request('engine.ping'); // its ready line is behind it on its own socket
    expect(engine.send({ n: 2 })).toBe(true);
    await until(() => app.events().length === 1, 3_000, 'the app’s event');
    expect(app.events()).toEqual([{ n: 2 }]); // live from its ready: no burst, nothing replayed to it
    app.leave();
    await until(() => attachments().length === 2, 3_000, 'the departure');
    expect(attachments().at(-1)).toEqual({ attached: false });
    await until(() => app.closed, 3_000, 'the app’s side ended');

    const second = await scene.app();
    await until(() => attachments().length === 3, 3_000, 'the second attachment');
    expect(attachments().at(-1)).toEqual({ attached: true });
    second.leave();
    await until(() => attachments().length === 4, 3_000, 'the second departure');
    await sleep(100);
    expect(engine.supervisor.connections.length).toBe(links); // never recycled
    expect(scene.spawn).toHaveBeenCalledOnce();
    expect(seam.availability).toEqual([true]); // plane B's attachment(false) never fires
    expect(engine.send({ n: 3 })).toBe(true); // still streaming between attachments
    await until(() => seam.events.length === 3);
  });

  // M3's task review: a second app replacing a still-attached one is the first one's departure; the old app's route E,
  // direct operations, status cache and holds end, and the new one is the owner back, on the same connection
  // M5b fix round 4 (C's residue, D-ab): what reaches main on machine.sock beside the streams (a disk follow's batches
  // among it) crosses no restream at an app's attach, its replacement or its departure: the permanent link stays the one
  // ready connection, and every event the engine host emits around each reaches a machine.spine client that stays
  it('a machine.spine client that stays hears every engine-host event emitted around an attach, a replacement and a departure', async () => {
    await scene.start({ permanentClient: true });
    const pane = await scene.app('machine', { capabilities: [MACHINE_SPINE_CAPABILITY] });
    pane.ready();
    const first = await scene.app();
    first.ready();
    await first.request('engine.ping'); // wakes the engine host, attached
    await until(() => attachments().length === 1, 3_000, 'the attachment');
    const engine = scene.lastEngine();
    const links = engine.supervisor.connections.length;
    const emitted: number[] = [];
    const emit = (n: number) => {
      expect(engine.emitRaw('probe.event', { n }), `event ${n}: the link is ready`).toBe(true);
      emitted.push(n);
    };
    emit(1);
    const second = await scene.app(); // replaces the first: {attached: false} then true
    second.ready();
    await second.request('engine.ping');
    await until(() => attachments().length === 3, 3_000, 'the replacement');
    emit(2);
    second.leave();
    await until(() => attachments().length === 4, 3_000, 'the departure');
    emit(3);
    await until(() => pane.events().length === emitted.length, 3_000, 'every event at the pane');
    expect(pane.events()).toEqual(emitted.map((n) => ({ n })));
    expect(engine.supervisor.connections.length).toBe(links); // never restreamed
  });

  it('a replaced app departs before its replacement attaches: {attached: false} then true, ahead of the replacement’s requests, no recycle', async () => {
    await scene.start({ permanentClient: true });
    const first = await scene.app();
    first.ready();
    await first.request('engine.ping');
    await until(() => attachments().length === 1);
    const engine = scene.lastEngine();
    expect([engine.appGone, engine.shellRecaptured]).toEqual([0, 1]);
    const links = engine.supervisor.connections.length;
    const before = engine.calls.length;
    const second = await scene.app(); // first is still attached: the socket layer replaces it
    expect(second.welcomed()).toBe(true);
    await second.request('engine.ping');
    await until(() => first.closed, 3_000, 'the replaced app closed');
    expect(engine.calls.slice(before).map(({ name, input }) => (name === 'host.attachment' ? `attached ${(input as { attached: boolean }).attached}` : name))).toEqual(['attached false', 'attached true', 'engine.ping']);
    expect(engine.appGone).toBe(1); // the replaced app's resources ended
    expect(engine.shellRecaptured).toBe(2); // the owner back
    expect(engine.supervisor.connections.length).toBe(links);
    expect(scene.spawn).toHaveBeenCalledOnce();
  });

  it('the departure drains through {attached: false}: what the host wrote before it saw that reaches the departing app', async () => {
    scene.engineSpawn = {
      capabilities: O3D_ENGINE,
      answers: {
        'host.attachment': (input) => {
          if ((input as { attached: boolean }).attached === false) scene.lastEngine().send({ n: 'last' }); // written before the answer
          return null;
        },
      },
    };
    await scene.start({ permanentClient: true });
    const app = await scene.app();
    app.ready();
    await app.request('engine.ping'); // its ready line is behind it on its own socket: events reach it from here
    await until(() => attachments().length === 1);
    const engine = scene.lastEngine();
    expect(engine.send({ n: 'first' })).toBe(true);
    await until(() => app.events().length === 1);
    app.leave();
    await until(() => app.closed, 3_000, 'the app’s side ended');
    expect(app.events()).toEqual([{ n: 'first' }, { n: 'last' }]);
  });

  it('a parked engine host is not woken to hear a departure', async () => {
    const daemon = await scene.start({ permanentClient: true });
    const app = await scene.app();
    app.ready();
    await until(() => attachments().length === 1);
    app.exit('now');
    await until(() => daemon.hosts.parked('engine-host'), 3_000, 'the park');
    app.leave();
    await until(() => app.closed);
    await sleep(200);
    expect(scene.spawn).toHaveBeenCalledOnce();
    expect(daemon.hosts.parked('engine-host')).toBe(true);
  });

  // P5 O3-D fix wave (scalpel-4#1): a post-D app hears its app-bound events on machine.sock, where the front drops them
  // until that connection is ready; the host must not raise one for it before then, and a machine.sock-only departure
  // ends its presence (its pending app-bound requests settle noClient) as a relay departure does
  it('a post-D app is present only while its machine.sock connection is ready: attached at its ready line, gone at its departure', async () => {
    await scene.start({ permanentClient: true });
    const app = await scene.app('engine-host', { capabilities: [MACHINE_SPINE_CAPABILITY] });
    app.ready();
    await app.request('engine.ping'); // the host is up: an attachment would have been told by now
    const engine = scene.lastEngine();
    await sleep(100);
    expect(attachments(), 'no machine.sock connection yet').toEqual([]);
    const machine = await scene.app('machine', { capabilities: [MACHINE_SPINE_CAPABILITY] });
    await sleep(100);
    expect(attachments(), 'machine.sock not ready yet').toEqual([]);
    machine.ready();
    await until(() => attachments().length === 1, 3_000, 'the attachment at machine.sock’s ready line');
    expect(attachments()).toEqual([{ attached: true }]);
    machine.leave();
    await until(() => attachments().length === 2, 3_000, 'the machine.sock departure');
    expect(attachments().at(-1)).toEqual({ attached: false });
    expect(engine.appGone).toBe(1); // its app-bound requests settled, its holds released
    const again = await scene.app('machine', { capabilities: [MACHINE_SPINE_CAPABILITY] });
    again.ready();
    await until(() => attachments().length === 3, 3_000, 'the attachment again');
    expect(attachments().at(-1)).toEqual({ attached: true });
    app.leave();
    await until(() => attachments().length === 4, 3_000, 'the relay departure');
    expect(attachments().at(-1)).toEqual({ attached: false });
    again.destroy();
  });

  it('a post-D app whose machine.sock connection was ready before its relay attached is present at its welcome', async () => {
    await scene.start({ permanentClient: true });
    const machine = await scene.app('machine', { capabilities: [MACHINE_SPINE_CAPABILITY] });
    machine.ready();
    const app = await scene.app('engine-host', { capabilities: [MACHINE_SPINE_CAPABILITY] });
    await until(() => attachments().length === 1, 3_000, 'the attachment at the welcome');
    expect(attachments()).toEqual([{ attached: true }]);
    app.leave();
    await until(() => attachments().length === 2, 3_000, 'the relay departure');
    expect(attachments().at(-1)).toEqual({ attached: false });
    machine.destroy();
  });

  it('an app’s own host.attachment on engine-host.sock is refused and never reaches the host', async () => {
    await scene.start({ permanentClient: true });
    const app = await scene.app();
    await until(() => attachments().length === 1);
    expect(await app.request('host.attachment', { attached: false })).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    await sleep(50);
    expect(attachments()).toEqual([{ attached: true }]);
  });

  // D8: the link is ready by its own resync: nothing while the spine is cold (above), the loaded spine's once it is loaded,
  // which the seam's adapter runs at each streaming with what arrives meanwhile held (spine-hosts.ts)
  it('a loaded spine’s resync runs at the link’s streaming with no app; with the option off nothing streams without one', async () => {
    for (const permanentClient of [true, false]) {
      const resyncs: string[] = [];
      const load = async (): Promise<SpineEntry> => ({
        takeSpineLock,
        openSpineData: async (_profile, { lock }) => ({ lock: lock!, refused: lock!.refused, machineSettings: null as never, paths: { client: '', machine: '' } }),
        startSpine: (started: SpineDeps) => {
          const resync: HostResync = async () => void resyncs.push('engine-host');
          started.hosts.setResync('engine-host', resync);
          started.bus.register('session.launchMode', () => ({ mode: 'index' }));
          return { view: { engineStatuses: () => [], on: () => () => {} } as never, settled: async () => {}, busy: () => false, stop: () => {} };
        },
      });
      const seam = listening();
      const daemon = await scene.start({ endpoint: seam.endpoint, permanentClient, spine: { load } });
      const client = await scene.app('machine');
      expect(await client.request('session.launchMode')).toMatchObject({ ok: true }); // loaded while the engine host is parked
      expect(resyncs).toEqual([]);
      expect(await seam.services().dispatch('engine-host', 'engine.ping', undefined)).toMatchObject({ ok: true });
      if (permanentClient) await until(() => resyncs.length === 1, 3_000, 'the loaded spine’s resync at the streaming');
      else {
        await sleep(200);
        expect(resyncs, 'no app, no ready line').toEqual([]);
      }
      client.destroy();
      await daemon.stop('test');
      await scene.lastEngine().supervisor.die();
    }
  });
});

describe('O2’s recycle per attachment stays', () => {
  it('with the option on, to an engine host that lists it not: no signal, a fresh link at each attach and departure, availability per app', async () => {
    scene.engineSpawn = { capabilities: INCAPABLE };
    const seam = listening();
    await scene.start({ endpoint: seam.endpoint, permanentClient: true });
    const app = await scene.app();
    const engine = scene.lastEngine();
    expect(engine.supervisor.peer()?.capabilities).toContain(ATTACHMENT_CAPABILITY); // declared; an older host ignores it
    const linksAtWelcome = engine.supervisor.connections.length;
    await until(() => engine.supervisor.connections.length > linksAtWelcome, 3_000, 'the recycle at attach');
    await sleep(100);
    expect(engine.send({ n: 1 })).toBe(false); // the recycled link waits for the app's ready
    app.ready();
    await until(() => app.events().length === 1, 3_000, 'the burst');
    const linksBefore = engine.supervisor.connections.length;
    app.leave();
    await until(() => engine.supervisor.connections.length > linksBefore, 3_000, 'the recycle at departure');
    await sleep(100);
    expect(engine.send({ n: 2 })).toBe(false); // between attachments: nothing streams
    expect(engine.named('host.attachment')).toEqual([]);
    expect(seam.availability).toEqual([true, false]);
  });

  // P5 O3-D M6 (acceptance 9): an older host kept across the update exits at idle and parks, its app dropped with it; the
  // app's transport attaches again, which starts a host of this build. The relay holds that hello until the new host has
  // welcomed (relay.ts's admission), so the link's policy is already the new host's when the app attaches: the host is
  // told the attachment (its connection's presence starts false, and app-bound requests would settle noClient), and the
  // link is permanent from there
  it('a host of this build that replaces an older one at idle hears the reattaching app’s attachment and keeps one connection', async () => {
    scene.engineSpawn = { capabilities: INCAPABLE };
    const daemon = await scene.start({ permanentClient: true });
    const first = await scene.app();
    first.ready();
    await first.request('engine.ping');
    expect(scene.lastEngine().named('host.attachment')).toEqual([]);
    scene.engineSpawn = { capabilities: O3D_ENGINE }; // the next engine host is O3-D's build: it lists host.attachment
    first.exit('now'); // the older host exits and parks, as at its idle exit
    await until(() => daemon.hosts.parked('engine-host'), 3_000, 'the park');
    await until(() => first.closed, 3_000, 'the app dropped with its host');
    const second = await scene.app(); // its transport attaches again; the attach starts the new host
    second.ready();
    await second.request('engine.ping');
    const engine = scene.lastEngine();
    expect(engine.supervisor.peer()?.capabilities).toContain(ATTACHMENT_CAPABILITY);
    await until(() => engine.named('host.attachment').length > 0, 3_000, 'the attachment told to the new host');
    expect(engine.named('host.attachment')).toEqual([{ attached: true }]);
    expect(engine.shellRecaptured).toBe(1); // the owner back, once
    const links = engine.supervisor.connections.length;
    second.leave();
    await until(() => engine.named('host.attachment').length === 2, 3_000, 'the departure');
    expect(engine.named('host.attachment').at(-1)).toEqual({ attached: false });
    await sleep(100);
    expect(engine.supervisor.connections.length).toBe(links); // permanent from here: never recycled
  });

  it('with the option off, to an engine host that lists it: no capability in its hello, no signal, the recycle as master', async () => {
    const seam = listening();
    await scene.start({ endpoint: seam.endpoint });
    const app = await scene.app();
    const engine = scene.lastEngine();
    await until(() => engine.supervisor.peer() !== null);
    // P5 O16 M3b: host.holder is listed whatever the option (mawsd adopts through its successor either way); the
    // attachment capability, the option's own, is not
    expect(engine.supervisor.peer()?.capabilities).toEqual([PTY_FRAMES_CAPABILITY, HOLDER_CAPABILITY]);
    const linksAtWelcome = engine.supervisor.connections.length;
    await until(() => engine.supervisor.connections.length > linksAtWelcome, 3_000, 'the recycle at attach');
    app.ready();
    app.leave();
    await until(() => seam.availability.length === 2, 3_000, 'the departure');
    await sleep(100);
    expect(engine.send({ n: 1 })).toBe(false);
    expect(engine.named('host.attachment')).toEqual([]);
    expect(seam.availability).toEqual([true, false]);
  });
  it('with the option off, a replaced app is O2’s: a recycle for the replacement, no signal', async () => {
    await scene.start();
    const first = await scene.app();
    first.ready();
    await first.request('engine.ping');
    const engine = scene.lastEngine();
    const links = engine.supervisor.connections.length;
    const second = await scene.app();
    await second.request('engine.ping');
    await until(() => engine.supervisor.connections.length > links, 3_000, 'the recycle at the replacement');
    expect(engine.named('host.attachment')).toEqual([]);
  });
});
