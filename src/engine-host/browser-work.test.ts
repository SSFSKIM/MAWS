// P5 O17 M7 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M7 and Interfaces §E; D20): the engine host's half of
// the browser fence, through the real wiring: `host.browserWork` served by the real host runtime from `mawsd`'s declaring
// link alone, applied to real sessions in a real process table (the hold set on each session and published as its
// status), the link's loss heard through the runtime itself, rows created later given the link's verdict (a launch, and
// an adoption through the launcher's real `createAdopter`, in both arrival orders), and the idle release's ask turned
// into `host.browserIdle` and sent again after a fresh link's first snapshot.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import { createHostRuntime, type HostPort, type HostRuntime } from '@shared/host/runtime';
import { ATTACHMENT_CAPABILITY, PTY_FRAMES_CAPABILITY } from '@shared/host/socket-protocol';
import { registerBrowserWork } from './browser-work';
import { autoResponder, scriptedTransport, type ScriptedTransport } from './conformance/scripted-transport';
import { handshakeResponder, launchSpec, scriptedSession } from './conformance/session-harness';
import { JournalWriter } from './journal';
import { buildLaunch, RELAY_URL, spawnMeta } from './launch';
import { createAdopter, journalDir, type LauncherDeps } from './launcher';
import { ProcessTable } from './process-table';
import { MemorySessionStateStore } from './store/memory-session-state-store';
import { SESSION_HOST_PROTOCOL } from './holder/protocol';
import type { RosterEntry } from './holder/roster';

const DECLARING = { capabilities: [PTY_FRAMES_CAPABILITY, ATTACHMENT_CAPABILITY] }; // mawsd's permanent link
const MAIN = { capabilities: [PTY_FRAMES_CAPABILITY] }; // main's direct link, or a utility port
const id = (name: string) => name as AppSessionId;

// A port the runtime serves: requests through its own path (envelope, input, handler, answer), what it posted kept
function fakePort() {
  const listeners: ((event: { data: unknown }) => void)[] = [];
  const posted: Record<string, unknown>[] = [];
  const port: HostPort = { on: (_event, listener) => void listeners.push(listener), postMessage: (message) => void posted.push(message as Record<string, unknown>), start: () => {} };
  let next = 0;
  return {
    port,
    posted,
    events: (name: string) => posted.filter((message) => message.t === 'evt' && message.name === name).map((message) => message.payload),
    async request(name: string, input: unknown, client?: string): Promise<Record<string, unknown>> {
      const rid = `r${++next}`;
      for (const listener of listeners) listener({ data: { t: 'req', id: rid, name, input, ...(client !== undefined && { client }) } });
      await vi.waitFor(() => {
        if (!posted.some((message) => message.t === 'res' && message.id === rid)) throw new Error(`no answer to ${name}`);
      });
      return posted.find((message) => message.t === 'res' && message.id === rid)!;
    },
  };
}

// The engine host's composition: the table, and browser work registered over it in the real runtime
function host() {
  const table = new ProcessTable({ ps: async () => '', log: () => {} });
  const runtime: HostRuntime = createHostRuntime((on, emit, client) => registerBrowserWork(on, emit, client, table));
  const link = (peer = DECLARING) => {
    const fake = fakePort();
    runtime.serve(fake.port, peer);
    runtime.setReady();
    return fake;
  };
  return { table, runtime, link };
}

type Scripted = ReturnType<typeof scriptedSession>;
async function launch(table: ProcessTable, name: string, pid = 900): Promise<Scripted> {
  const s = scriptedSession({ spec: { appSessionId: id(name) }, transport: { pid }, responder: handshakeResponder({ end_session: () => null }) });
  table.reserve(id(name), () => s.session);
  await s.session.start();
  return s;
}
const browser = (s: Scripted) => s.session.status().work?.holds?.browser ?? null;

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('host.browserWork (P5 O17 M7)', () => {
  it('from a client whose hello did not list host.attachment: answers internal and changes nothing', async () => {
    const h = host();
    const a = await launch(h.table, 'a');
    const main = h.link(MAIN);
    expect(await main.request('host.browserWork', { held: ['a'] })).toMatchObject({ ok: false, error: { code: 'internal', message: expect.stringContaining('host.browserWork') } });
    expect(browser(a)).toBeNull();
  });

  it('forwarded for another client, even on the declaring link: answers internal and changes nothing', async () => {
    const h = host();
    const a = await launch(h.table, 'a');
    const mawsd = h.link();
    expect(await mawsd.request('host.browserWork', { held: ['a'] }, 'app-page-1')).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(browser(a)).toBeNull();
  });

  it('a snapshot holds every live row it names and clears every other, each published through its session before the answer', async () => {
    const h = host();
    const [a, b, c] = [await launch(h.table, 'a', 901), await launch(h.table, 'b', 902), await launch(h.table, 'c', 903)];
    c.session.setBrowserHold('unknown');
    const published: EngineSessionStatus[] = [];
    h.table.onChange((status) => void published.push(status));
    const mawsd = h.link();
    expect(await mawsd.request('host.browserWork', { held: ['a', 'gone'] })).toMatchObject({ ok: true });
    expect([browser(a), browser(b), browser(c)]).toEqual(['held', null, null]);
    expect(published.map((s) => [s.appSessionId, s.work?.holds?.browser ?? null])).toEqual([['a', 'held'], ['c', null]]);
    expect(a.session.status().keepAlive).toEqual(['background_tasks']);
    expect(await mawsd.request('host.browserWork', { held: [] })).toMatchObject({ ok: true }); // the snapshot is full
    expect(browser(a)).toBeNull();
  });

  it.each([
    ['its connection detached', (h: ReturnType<typeof host>) => h.runtime.detach()],
    ['another client served in its place', (h: ReturnType<typeof host>) => void h.link(MAIN)],
  ])('the permanent link\'s end (%s, heard through the runtime) turns held into unknown; the next link\'s snapshot settles it', async (_how, end) => {
    const h = host();
    const [a, b] = [await launch(h.table, 'a', 901), await launch(h.table, 'b', 902)];
    await h.link().request('host.browserWork', { held: ['a'] });
    end(h);
    expect([browser(a), browser(b)]).toEqual(['unknown', null]);
    await h.link().request('host.browserWork', { held: [] });
    expect([browser(a), browser(b)]).toEqual([null, null]);
  });

  it('a launch takes the current link\'s verdict at once; with no snapshot on the link, or after its end, it starts clear', async () => {
    const h = host();
    expect(browser(await launch(h.table, 'early', 900))).toBeNull(); // no link
    const mawsd = h.link();
    await mawsd.request('host.browserWork', { held: ['named'] });
    const named = scriptedSession({ spec: { appSessionId: id('named') }, transport: { pid: 901 } });
    h.table.reserve(id('named'), () => named.session);
    expect(browser(named)).toBe('held'); // at its reservation, before its start
    await named.session.start();
    expect(named.session.status().work?.holds).toEqual({ browser: 'held' });
    expect(browser(await launch(h.table, 'other', 902))).toBeNull();
    h.runtime.detach();
    expect(browser(await launch(h.table, 'after', 903))).toBeNull();
  });
});

describe('host.browserIdle through the real wiring (P5 O17 M7, D20)', () => {
  const IDLE_MS = 10 * 60_000;

  async function idleHost() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-02T10:00:00.000Z'));
    const h = host();
    const a = await launch(h.table, 'a');
    await vi.advanceTimersByTimeAsync(0);
    return { h, a };
  }

  it('a due row held by its tab alone is told to the declaring client once; after the link\'s end, the fresh link\'s first snapshot sends it again, a second snapshot not', async () => {
    const { h, a } = await idleHost();
    const first = h.link();
    await first.request('host.browserWork', { held: ['a'] });
    h.table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(first.events('host.browserIdle')).toEqual([{ appSessionId: 'a' }]);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(first.events('host.browserIdle')).toHaveLength(1);
    h.runtime.detach(); // mawsd's link lost before it closed the tabs
    expect(browser(a)).toBe('unknown');
    const second = h.link();
    await second.request('host.browserWork', { held: ['a'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(second.events('host.browserIdle')).toEqual([{ appSessionId: 'a' }]); // still due and held: asked again
    await second.request('host.browserWork', { held: ['a'] });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(second.events('host.browserIdle')).toHaveLength(1);
    expect(a.transport.requestsOf('end_session')).toEqual([]);
    await second.request('host.browserWork', { held: [] }); // the tabs closed: the drop's answer, at the next snapshot
    await vi.advanceTimersByTimeAsync(0);
    expect(a.transport.requestsOf('end_session')).toHaveLength(1); // released at once, its clock not restarted
  });

  it('no client that did not declare host.attachment is told', async () => {
    const { h, a } = await idleHost();
    const main = h.link(MAIN);
    a.session.setBrowserHold('unknown'); // as an adoption with no mawsd snapshot leaves it
    h.table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(main.events('host.browserIdle')).toEqual([]);
    expect(a.transport.requestsOf('end_session')).toEqual([]);
  });
});

// The launcher's adoption, against a scripted session host (as holder/adopter.test.ts drives it), with browser work
// registered over the same table. The kept snapshot is per engine-host process: before the first snapshot on the link,
// an adopted row reads `unknown` from its reservation, never empty in between; once one is applied, a later adoption
// takes its verdict.
describe('an adopted session and the link\'s snapshot, in both arrival orders (P5 O17 M7)', () => {
  const ID = id('app-adopted');
  const SPEC = launchSpec({ appSessionId: ID, cwd: '/tmp/maws-session' });
  let userData: string;
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'maws-browser-work-'));
  });
  afterEach(() => rmSync(userData, { recursive: true, force: true }));

  function launched(): RosterEntry {
    const plan = buildLaunch(SPEC, { PATH: '/opt/then/bin', HOME: '/Users/x' }, { relayUrl: RELAY_URL, bin: '/x/claude', engineVersion: '2.1.283', spawnerPid: 4100, holder: { gateSocket: '/x/gate.sock' } });
    const writer = new JournalWriter(journalDir(userData, ID), plan.launchId, { maxBytes: 1_000_000 });
    writer.row('meta', spawnMeta(plan, { appVersion: 'test', holder: { pid: 4100, holderId: plan.launchId, binary: '/x/maws-session-host' } }));
    void writer.close();
    return {
      protocol: SESSION_HOST_PROTOCOL, holderId: plan.launchId, pid: 4100, procStart: 'then', startedAt: '2026-11-02T10:00:00.000Z', socket: '/x/host.sock', binary: '/x/maws-session-host',
      appSessionId: ID, engineSessionId: plan.sessionId, state: 'running', child: { pid: 4101, procStart: 'then' }, fence: 1, exit: null,
    };
  }

  async function adopting(h: ReturnType<typeof host>) {
    const store = new MemorySessionStateStore();
    await store.saveLaunchSpec(ID, SPEC);
    const transports: ScriptedTransport[] = [];
    const deps: LauncherDeps = {
      userData, replayEnabled: false, cwd: userData, table: h.table, store, appVersion: 'test', log: () => {}, wire: () => {},
      binaryProbe: () => Promise.reject(new Error('an adoption probes nothing')),
      checkRelay: () => Promise.reject(new Error('an adoption checks no relay')),
      spawn: () => {
        throw new Error('an adoption spawns nothing');
      },
      captureEnv: async () => ({ PATH: '/opt/now/bin', HOME: '/Users/x' }),
      holder: {
        gateSocket: '/x/gate.sock',
        start: () => Promise.reject(new Error('an adoption starts no host')),
        adopt: async (entry) => {
          const transport = scriptedTransport({ holder: { pid: entry.pid, holderId: entry.holderId, fence: 2 }, pid: 4101, onWrite: autoResponder(handshakeResponder()) });
          transports.push(transport);
          return { transport, fence: 2 };
        },
        release: async () => {},
      },
    };
    // every status the adopted row publishes, from its reservation
    const published: (string | null)[] = [];
    h.table.onChange((status) => void (status.appSessionId === ID && published.push(status.work?.holds?.browser ?? null)));
    const adopted = createAdopter(deps)(launched());
    await vi.waitFor(() => {
      if (transports.length !== 1 || h.table.get(ID) === undefined) throw new Error('not reserved yet');
    });
    const reserved = h.table.get(ID)!.status().work?.holds?.browser ?? null; // at its reservation
    transports[0]!.pushProblem({ kind: 'host_caught_up', message: 'caught up', length: 0, typeGuess: null });
    expect(await adopted).toBe(ID);
    const session = h.table.get(ID)!;
    return { session, reserved, published, end: async () => { transports[0]!.exit(0); await session.exited; } };
  }

  it('adoption, then the snapshot: unknown from the reservation, never empty in between, until the first snapshot settles it', async () => {
    const h = host();
    const row = await adopting(h); // a successor before mawsd's first snapshot to it: no link at all yet
    expect(row.reserved).toBe('unknown');
    expect(row.published.length).toBeGreaterThan(0);
    expect(new Set(row.published)).toEqual(new Set(['unknown']));
    expect(row.session.status().keepAlive).toContain('background_tasks');
    const mawsd = h.link(); // the link comes up after the adoption finished: still unknown until its snapshot
    expect(row.session.status().work?.holds?.browser).toBe('unknown');
    await mawsd.request('host.browserWork', { held: [] });
    expect(row.session.status().work?.holds).toBeUndefined();
    expect(row.published.at(-1)).toBeNull();
    await row.end();
  });

  it('adoption on a link that has applied no snapshot yet reads unknown too', async () => {
    const h = host();
    const mawsd = h.link();
    const row = await adopting(h);
    expect(row.reserved).toBe('unknown');
    await mawsd.request('host.browserWork', { held: [ID] });
    expect(row.session.status().work?.holds).toEqual({ browser: 'held' });
    await row.end();
  });

  it.each([
    ['not named: it starts clear and is never unknown', [] as AppSessionId[], null],
    ['named: it starts held', [ID], 'held'],
  ] as const)('the snapshot, then an adoption finishing later, takes the kept set\'s verdict (%s)', async (_case, held, verdict) => {
    const h = host();
    await h.link().request('host.browserWork', { held });
    const row = await adopting(h);
    expect(row.reserved).toBe(verdict);
    expect(row.published.length).toBeGreaterThan(0);
    expect(new Set(row.published)).toEqual(new Set([verdict]));
    await row.end();
  });

  it('an adoption after the link that applied the snapshot ended reads unknown again', async () => {
    const h = host();
    await h.link().request('host.browserWork', { held: [] });
    h.runtime.detach();
    const row = await adopting(h);
    expect(row.reserved).toBe('unknown');
    await row.end();
  });
});
