// Main's mirror over mawsd's services front, in launch mode index (P5 O3-D M5b fix round 7; D19): a session already
// mid-turn on the engine host before main's machine transport streams reaches the mirror at that first streaming, by its
// stream alone (the front's `session.follow {live: true}` opens one per live session, its latest status first), and the
// quit guard's report counts it, as e2e/shell.spec.ts's quit line counts a scenario's on the daemon shape. The spine's
// own statuses (`session.engineStatuses`) are answered empty here, so nothing but the stream can tell the mirror.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { on: vi.fn() }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } }));

import type { HostState } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { MACHINE_SPINE_CAPABILITY } from '@shared/host/socket-protocol';
import { busyReport } from '../../src/main/lifecycle/quit-guard';
import { createMirrorSpineView, type MirrorHosts } from '../../src/main/sessions/spine-mirror';
import { createServicesFront, type ServicesFront } from '../../src/mawsd/front';
import { humanTurn, record, status } from '../support/builders';
import { FakeEngineHost } from './fake-engine-host';

const IDENTITY = { ref: 'TestMachineRef00000000' as MachineRef, name: 'test machine', project: { key: 'machine:TestMachineRef00000000', name: 'test machine', smnsId: null } };
const MID = 'app-mid-turn';
const IDLE = 'app-idle';
// the rest of a full status; the fake host's own launch, process and journal position stay its
const full = (appSessionId: string, turn: typeof humanTurn | null): Record<string, unknown> => {
  const rest: Record<string, unknown> = { ...status(appSessionId, { process: 'ready', turn }) };
  for (const own of ['launchId', 'lastEventSeq', 'process']) delete rest[own];
  return rest;
};

type Line = Record<string, unknown> & { t: string };

const fronts: ServicesFront[] = [];
afterEach(() => {
  for (const front of fronts.splice(0)) front.close();
});

// main's machine host as the mirror reads it: `session.follow` and `machine.client` go to the front over one client
// connection, whose events reach the mirror's listeners; the spine's snapshot reads are answered here (index mode, the
// two records, no statuses of the spine's own)
function mainOverFront(host: FakeEngineHost) {
  const front = createServicesFront({
    spine: { ensure: async () => ({}) as never },
    hosts: host.hosts,
    intercept: () => null,
    daemon: async () => undefined,
    identity: () => IDENTITY,
    isApp: (appPid) => appPid === 100,
    log: () => {},
  });
  fronts.push(front);
  const listeners = new Map<string, Set<(payload: never) => void>>();
  const answers = new Map<string, (line: Line) => void>();
  let deliver: (event: { data: unknown }) => void = () => {};
  const port = {
    start: () => {},
    on: (_event: 'message', listener: (event: { data: unknown }) => void) => void (deliver = listener),
    postMessage: (message: unknown) => {
      const line = message as Line;
      if (line.t === 'res') answers.get(line.id as string)?.(line);
      if (line.t === 'evt') for (const listener of listeners.get(line.name as string) ?? []) listener(line.payload as never);
    },
  };
  front.runtimeFor({ appPid: 100, capabilities: [MACHINE_SPINE_CAPABILITY] }).serve(port);
  let next = 0;
  const viaFront = (name: string, input: unknown) =>
    new Promise<Line>((resolve) => {
      const id = `m${++next}`;
      answers.set(id, resolve);
      deliver({ data: { t: 'req', id, name, input } });
    });
  const spine: Record<string, unknown> = {
    'session.list': { sessions: [record(MID), record(IDLE)], revision: 1 },
    'session.projects.list': { projects: [], revision: 1, rows: [] },
    'session.digests': { digests: [] },
    'attention.list': [],
    'session.intent.list': { intents: [] },
    'session.visible': { sessions: [] },
    'session.launchMode': { mode: 'index' },
    'session.engineStatuses': { statuses: [] },
  };
  let streaming = false;
  const onStreaming = new Set<() => void>();
  const ready: HostState = { state: 'ready', pid: 1, restarts: 0, revision: 1 };
  const hosts: MirrorHosts = {
    dispatch: (async (_owner: string, name: string, input: unknown) => {
      if (name === 'session.follow' || name === 'machine.client') {
        const line = await viaFront(name, input);
        return line.ok ? { ok: true, value: line.value } : { ok: false, error: line.error };
      }
      return name in spine ? { ok: true, value: spine[name] } : { ok: false, error: { code: 'internal', message: `no answer for ${name}` } };
    }) as MirrorHosts['dispatch'],
    onEvent: ((name: string, listener: (payload: never) => void) => {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(listener);
      return () => void set.delete(listener);
    }) as MirrorHosts['onEvent'],
    onStreaming: (_owner, listener) => (onStreaming.add(listener), () => void onStreaming.delete(listener)),
    streaming: () => streaming,
    onState: () => () => {},
    snapshot: () => ready,
  };
  return {
    stream() {
      deliver({ data: { t: 'ready' } }); // main's ready line, then the supervisor's streaming
      streaming = true;
      for (const listener of onStreaming) listener();
    },
    hosts,
  };
}

describe('main’s mirror over the services front, launch mode index', () => {
  it('holds a session mid-turn before main streamed from that first streaming, and the quit guard counts it', async () => {
    const host = new FakeEngineHost();
    host.add(MID, full(MID, humanTurn)); // mid-turn on the engine host, its status emitted to no client
    host.row(MID, 3);
    host.add(IDLE, full(IDLE, null));
    const main = mainOverFront(host);
    const mirror = createMirrorSpineView({ hosts: main.hosts, spineRefused: () => null, onDaemonStatus: () => () => {}, browserSocket: () => null, log: () => {} });
    expect(mirror.view.midTurnCount()).toBe(0);

    main.stream();
    await vi.waitFor(() => expect(mirror.view.unavailable()).toBeNull());
    await vi.waitFor(() => expect(mirror.view.midTurnCount()).toBe(1));
    expect(mirror.view.engineStatuses().map((s) => [s.appSessionId, s.turn !== null]).sort()).toEqual([[IDLE, false], [MID, true]]);
    const report = await busyReport(mirror.view, { list: async () => [], foreground: async () => ({ busy: false }), hostGone: () => false });
    expect(report.midTurn).toBe(1);
    mirror.stop();
  });
});
