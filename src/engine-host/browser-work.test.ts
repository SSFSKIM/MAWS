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
import { ATTACHMENT_CAPABILITY, HOST_BROWSER_WORK_CAPABILITY, PTY_FRAMES_CAPABILITY } from '@shared/host/socket-protocol';
import { e2eHoldFor, registerBrowserWork } from './browser-work';
import { autoResponder, scriptedTransport, type ScriptedTransport } from './conformance/scripted-transport';
import { handshakeResponder, launchSpec, scriptedSession } from './conformance/session-harness';
import { JournalWriter } from './journal';
import { buildLaunch, RELAY_URL, spawnMeta } from './launch';
import { createAdopter, journalDir, type LauncherDeps } from './launcher';
import { ProcessTable } from './process-table';
import { MemorySessionStateStore } from './store/memory-session-state-store';
import { SESSION_HOST_PROTOCOL } from './holder/protocol';
import type { RosterEntry } from './holder/roster';

const DECLARING = { capabilities: [PTY_FRAMES_CAPABILITY, ATTACHMENT_CAPABILITY, HOST_BROWSER_WORK_CAPABILITY] }; // mawsd's permanent link, which tells browser work
const OLDER_MAWSD = { capabilities: [PTY_FRAMES_CAPABILITY, ATTACHMENT_CAPABILITY] }; // a mawsd from before O17 (a rollback's): declaring, no browser work
const MAIN = { capabilities: [PTY_FRAMES_CAPABILITY] }; // main's direct link, or a utility port
const id = (name: string) => name as AppSessionId;

// A port the runtime serves: requests through its own path (envelope, input, handler, answer), what it posted kept
function fakePort(refuses: (message: Record<string, unknown>) => boolean = () => false) {
  const listeners: ((event: { data: unknown }) => void)[] = [];
  const posted: Record<string, unknown>[] = [];
  // a write `refuses` names writes nothing (`false`), as a port that is closing does; the runtime then ends its client
  const port: HostPort = { on: (_event, listener) => void listeners.push(listener), postMessage: (message) => (refuses(message as Record<string, unknown>) ? false : void posted.push(message as Record<string, unknown>)), start: () => {} };
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
// `statuses`: each row's status emitted to the client as ipc.ts's session stream emits it, so a publication can find the
// client gone
function host(opts: Parameters<typeof registerBrowserWork>[4] = {}, statuses = false) {
  const table = new ProcessTable({ ps: async () => '', log: () => {} });
  const runtime: HostRuntime = createHostRuntime((on, emit, client) => {
    registerBrowserWork(on, emit, client, table, opts);
    if (statuses) table.onChange((status) => void emit('session.status', { appSessionId: status.appSessionId, status }));
  });
  const served = (peer: { capabilities: readonly string[]; pid?: number } = DECLARING, refuses?: (message: Record<string, unknown>) => boolean) => {
    const fake = fakePort(refuses);
    runtime.serve(fake.port, peer);
    return fake;
  };
  const link = (peer: { capabilities: readonly string[]; pid?: number } = DECLARING, refuses?: (message: Record<string, unknown>) => boolean) => {
    const fake = served(peer, refuses);
    runtime.setReady();
    return fake;
  };
  return { table, runtime, link, served };
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
    c.session.setBrowserHold('unknown:lost');
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

  it('an exited row holds nothing: the next snapshot clears its entry, whether or not it still names it', async () => {
    const h = host();
    const a = await launch(h.table, 'a');
    const mawsd = h.link();
    await mawsd.request('host.browserWork', { held: ['a'] });
    a.transport.exit(0); // the engine exits holding a tab
    await a.session.exited;
    expect(browser(a)).toBe('held'); // until mawsd's next snapshot
    await mawsd.request('host.browserWork', { held: [] });
    expect(browser(a)).toBeNull();
    const b = await launch(h.table, 'b', 902);
    b.transport.exit(0);
    await b.session.exited;
    await mawsd.request('host.browserWork', { held: ['b'] });
    expect(browser(b)).toBeNull();
  });

  it.each([
    ['its connection detached', (h: ReturnType<typeof host>) => h.runtime.detach(), 'unknown'],
    ['another mawsd served in its place', (h: ReturnType<typeof host>) => void h.runtime.serve(fakePort().port, DECLARING), 'unknown'],
    // fix 3: main's own link, ready in its place, clears no lost link's unknown (mawsd may still hold the tab); fix 2
    // cleared it here
    ['main served and ready in its place', (h: ReturnType<typeof host>) => void h.link(MAIN), 'unknown'],
  ])('the permanent link\'s end (%s, heard through the runtime) turns held into unknown; the next link\'s snapshot settles it', async (_how, end, after) => {
    const h = host();
    const [a, b] = [await launch(h.table, 'a', 901), await launch(h.table, 'b', 902)];
    await h.link().request('host.browserWork', { held: ['a'] });
    end(h);
    expect([browser(a), browser(b)]).toEqual([after, null]);
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

// P5 O17 M7 fix 1: the link's end while a snapshot is applied, the verdict before a link's first snapshot, one transition
// for an end heard twice, and the empty set's paths
describe('host.browserWork: the link lost while a snapshot applies, and what a link has not yet told (P5 O17 M7 fix 1)', () => {
  const holdOf = (message: Record<string, unknown>) => ((message.payload as { status?: EngineSessionStatus } | undefined)?.status?.work?.holds?.browser ?? null);
  const statusOf = (name: string) => (message: Record<string, unknown>) => message.t === 'evt' && message.name === 'session.status' && (message.payload as { appSessionId?: string }).appSessionId === name;

  it('a publication that finds the client gone ends the link: every row the snapshot would hold reads unknown or stays as the end left it, none held on the dead link', async () => {
    const h = host({}, true);
    const [a, b, c] = [await launch(h.table, 'a', 901), await launch(h.table, 'b', 902), await launch(h.table, 'c', 903)];
    b.session.setBrowserHold('unknown:lost'); // as an earlier link's end left it
    const mawsd = h.link(DECLARING, (message) => statusOf('a')(message) && holdOf(message) === 'held'); // a's held status writes nothing
    const answer = await mawsd.request('host.browserWork', { held: ['a', 'b', 'c'] });
    expect(answer).toMatchObject({ ok: true });
    expect([browser(a), browser(b), browser(c)]).toEqual(['unknown', 'unknown', null]);
    const fresh = h.link();
    await fresh.request('host.browserWork', { held: ['b'] });
    expect([browser(a), browser(b), browser(c)]).toEqual([null, 'held', null]);
  });

  it('a row reserved while a declaring link is up and has applied no snapshot reads unknown, launched or adopted; with no such link a launch starts clear', async () => {
    const h = host();
    expect(browser(await launch(h.table, 'none', 900))).toBeNull(); // no link: main's own shape, nothing to wait for
    h.link(MAIN);
    expect(browser(await launch(h.table, 'main', 901))).toBeNull(); // a client that never tells browser work
    const mawsd = h.link();
    const early = await launch(h.table, 'early', 902);
    expect(browser(early)).toBe('unknown');
    await mawsd.request('host.browserWork', { held: [] });
    expect(browser(early)).toBeNull();
    expect(browser(await launch(h.table, 'later', 903))).toBeNull(); // the kept set's verdict
  });

  it('the link\'s end heard twice (the runtime\'s gone hook and the connection\'s own end) is one held-to-unknown transition', async () => {
    const h = host();
    const a = await launch(h.table, 'a');
    await h.link().request('host.browserWork', { held: ['a'] });
    const published: (string | null)[] = [];
    h.table.onChange((status) => void published.push(status.work?.holds?.browser ?? null));
    h.runtime.detach(); // a ready client: both are told
    expect(published).toEqual(['unknown']);
    expect(browser(a)).toBe('unknown');
    await h.link().request('host.browserWork', { held: ['a'] });
    expect(published).toEqual(['unknown', 'held']);
  });

  it('always empty: nothing is published, a launch and an adoption on the link start clear, and the link\'s end changes no row', async () => {
    const h = host();
    const a = await launch(h.table, 'a');
    const published: string[] = [];
    h.table.onChange((status) => void published.push(status.appSessionId));
    const mawsd = h.link();
    for (let n = 0; n < 3; n++) expect(await mawsd.request('host.browserWork', { held: [] })).toMatchObject({ ok: true });
    expect(browser(await launch(h.table, 'b', 902))).toBeNull();
    expect(published.filter((name) => name === 'a')).toEqual([]);
    h.runtime.detach();
    expect(browser(a)).toBeNull();
    expect(published.filter((name) => name === 'a')).toEqual([]);
  });

  it('held, then empty: the row clears, a later launch of it starts clear, and the link\'s end turns nothing unknown', async () => {
    const h = host();
    const a = await launch(h.table, 'a');
    const mawsd = h.link();
    await mawsd.request('host.browserWork', { held: ['a'] });
    expect(browser(a)).toBe('held');
    await mawsd.request('host.browserWork', { held: [] });
    expect(browser(a)).toBeNull();
    a.transport.exit(0);
    await a.session.exited;
    expect(browser(await launch(h.table, 'a', 902))).toBeNull();
    h.runtime.detach();
    expect(h.table.list().map((session) => session.status().work?.holds?.browser ?? null)).toEqual([null]);
  });
});

// M8's scene 6 at e2e (adoption, then the snapshot): the e2e's hold on the snapshot's application, and the line a scene
// reads to know the link's first snapshot applied (the other order)
describe('the link\'s first snapshot, logged, and the e2e\'s hold on it (P5 O17 M8 scene 6)', () => {
  it('logs the first snapshot on each link with how many sessions it holds, not a later one', async () => {
    const lines: string[] = [];
    const h = host({ log: (line) => void lines.push(line) });
    await launch(h.table, 'a');
    const first = h.link();
    await first.request('host.browserWork', { held: ['a'] });
    await first.request('host.browserWork', { held: [] });
    h.runtime.detach();
    await h.link().request('host.browserWork', { held: [] });
    expect(lines).toEqual(['browser work: the first snapshot on this link holds 1 session(s)', 'browser work: the first snapshot on this link holds 0 session(s)']);
  });

  it('a snapshot waits for the hold before it is applied and answered', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const h = host({ hold: () => held });
    const a = await launch(h.table, 'a');
    const answer = h.link().request('host.browserWork', { held: ['a'] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(browser(a)).toBeNull();
    release();
    expect(await answer).toMatchObject({ ok: true });
    expect(browser(a)).toBe('held');
  });

  it('unarmed, the holds are nothing: undefined, their dependencies never touched, the snapshot applied as without them', async () => {
    const untouched = { exists: () => { throw new Error('read'); }, sleep: () => { throw new Error('slept'); }, now: () => { throw new Error('timed'); } }; // prettier-ignore
    for (const env of [{}, { MAWS_E2E: '1' }, { MAWS_E2E: '0', MAWS_E2E_ADOPTION_HOLD: '/x' }, { MAWS_E2E: '1', MAWS_E2E_ADOPTION_HOLD: '' }]) expect(e2eHoldFor(env, 'MAWS_E2E_ADOPTION_HOLD', untouched)).toBeUndefined();
    const h = host({ hold: e2eHoldFor({}, 'MAWS_E2E_BROWSER_WORK_HOLD') });
    const a = await launch(h.table, 'a');
    await h.link().request('host.browserWork', { held: ['a'] });
    expect(browser(a)).toBe('held');
  });

  it('the hold is the e2e\'s alone: a file named under MAWS_E2E=1, waited on while it exists', async () => {
    expect(e2eHoldFor({ MAWS_E2E_BROWSER_WORK_HOLD: '/x' }, 'MAWS_E2E_BROWSER_WORK_HOLD')).toBeUndefined();
    expect(e2eHoldFor({ MAWS_E2E: '1' }, 'MAWS_E2E_ADOPTION_HOLD')).toBeUndefined();
    let exists = true;
    let slept = 0;
    const wait = e2eHoldFor({ MAWS_E2E: '1', MAWS_E2E_ADOPTION_HOLD: '/x/hold' }, 'MAWS_E2E_ADOPTION_HOLD', { exists: () => exists, sleep: async () => void (++slept === 3 && (exists = false)), now: () => 0 })!;
    await wait();
    expect(slept).toBe(3);
  });

  it('waits under one hold end in the order they began, so snapshots held together apply in the order they came', async () => {
    let exists = true;
    const sleeping: (() => void)[] = [];
    const wait = e2eHoldFor({ MAWS_E2E: '1', MAWS_E2E_BROWSER_WORK_HOLD: '/x/hold' }, 'MAWS_E2E_BROWSER_WORK_HOLD', { exists: () => exists, sleep: () => new Promise<void>((resolve) => sleeping.push(resolve)), now: () => 0 })!;
    const ended: string[] = [];
    const first = wait().then(() => ended.push('first'));
    const second = wait().then(() => ended.push('second'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    exists = false;
    while (sleeping.length > 0) sleeping.pop()!(); // the later wait's sleep ends first
    await Promise.all([first, second]);
    expect(ended).toEqual(['first', 'second']);
  });
});

// P5 O17 M7 fix 3 (the architect's option (B)): `unknown` tagged by its cause. A lost link's (a held row whose capable
// link ended) is cleared only by a declaring client that tells no browser work (another mawsd, a rolled-back one);
// main's direct link leaves it, so the row is not released while mawsd may still hold its tab. An adoption's (a row
// reserved while this host has had no capable client) is cleared by any ready client that tells none, main's included:
// the embedded shape releases as before. A capable client's first snapshot settles both.
describe('host.browserWork: unknown by its cause (P5 O17 M7 fix 3)', () => {
  const IDLE_MS = 10 * 60_000;
  async function idleHost() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-02T10:00:00.000Z'));
    const h = host();
    const a = await launch(h.table, 'a');
    await vi.advanceTimersByTimeAsync(0);
    return { h, a };
  }

  it('a lost link\'s unknown: main\'s direct link, ready in its place, clears nothing, and the row is not released past its idle time', async () => {
    const { h, a } = await idleHost();
    await h.link().request('host.browserWork', { held: ['a'] });
    h.runtime.detach(); // mawsd's link lost, mawsd and its render host's tab still alive
    expect(a.session.browserEntry()).toBe('unknown:lost');
    const main = h.link(MAIN); // main reaches the engine host directly before mawsd reconnects
    expect(browser(a)).toBe('unknown');
    h.table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(2 * IDLE_MS);
    expect(a.transport.requestsOf('end_session')).toEqual([]);
    expect(main.events('host.browserIdle')).toEqual([]);
  });

  it('the rollback: a declaring client that tells no browser work clears a lost link\'s unknown, and the row is released when idle', async () => {
    const { h, a } = await idleHost();
    await h.link().request('host.browserWork', { held: ['a'] });
    h.runtime.detach();
    h.link(MAIN);
    expect(browser(a)).toBe('unknown');
    h.link(OLDER_MAWSD);
    expect(browser(a)).toBeNull();
    expect(a.session.browserEntry()).toBeNull();
    h.table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(a.transport.requestsOf('end_session')).toHaveLength(1);
  });

  it('a row reserved on a capable link before its first snapshot is the link\'s: after the link\'s end main\'s link clears nothing', async () => {
    const h = host();
    h.link();
    const a = await launch(h.table, 'a');
    expect(a.session.browserEntry()).toBe('unknown:lost');
    h.runtime.detach();
    h.link(MAIN);
    expect(browser(a)).toBe('unknown');
  });

  it('a capable client\'s first snapshot settles both causes', async () => {
    const h = host();
    const [a, b, c] = [await launch(h.table, 'a', 901), await launch(h.table, 'b', 902), await launch(h.table, 'c', 903)];
    a.session.setBrowserHold('unknown:adopted');
    b.session.setBrowserHold('unknown:lost');
    c.session.setBrowserHold('unknown:lost');
    await h.link().request('host.browserWork', { held: ['b'] });
    expect([a.session.browserEntry(), b.session.browserEntry(), c.session.browserEntry()]).toEqual([null, 'held', null]);
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

  it('a declaring client that does not list host.browserWork (a rolled-back mawsd) gets today\'s release: no entry, no ask, released when idle', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-02T10:00:00.000Z'));
    const h = host();
    const older = h.link(OLDER_MAWSD);
    const a = await launch(h.table, 'a');
    await vi.advanceTimersByTimeAsync(0);
    expect(browser(a)).toBeNull();
    expect(await older.request('host.browserWork', { held: ['a'] })).toMatchObject({ ok: false, error: { code: 'internal' } }); // not one it tells
    expect(browser(a)).toBeNull();
    h.table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(older.events('host.browserIdle')).toEqual([]);
    expect(a.transport.requestsOf('end_session')).toHaveLength(1);
  });

  it('no client that did not declare host.attachment is told', async () => {
    const { h, a } = await idleHost();
    const main = h.link(MAIN);
    a.session.setBrowserHold('unknown:adopted'); // as an adoption with no mawsd snapshot leaves it
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
  const IDLE_MS = 10 * 60_000;
  const STOP = { type: 'control_request', request_id: 'stop-1', request: { subtype: 'hook_callback', callback_id: 'maws_Stop_1', input: { hook_event_name: 'Stop', session_id: 's', stop_hook_active: false, last_assistant_message: 'Done.', background_tasks: [], session_crons: [] } } };
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
    return { session, transport: transports[0]!, reserved, published, end: async () => { transports[0]!.exit(0); await session.exited; } };
  }

  it('adoption with no link reads unknown; a client that will tell no browser work (a rolled-back mawsd, main\'s own link) clears it at its connection, and an adoption under it starts clear', async () => {
    const h = host();
    const row = await adopting(h);
    expect(row.reserved).toBe('unknown');
    h.link(OLDER_MAWSD);
    expect(row.session.status().work?.holds).toBeUndefined();
    expect(row.published.at(-1)).toBeNull();
    await row.end();
    const again = await adopting(h);
    expect(again.reserved).toBeNull();
    expect(again.session.status().work?.holds).toBeUndefined();
  });

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

  it('an adoption after the link that applied the snapshot ended reads unknown again, the lost link\'s: main\'s link clears nothing (fix 3)', async () => {
    const h = host();
    await h.link().request('host.browserWork', { held: [] });
    h.runtime.detach();
    const row = await adopting(h);
    expect(row.reserved).toBe('unknown');
    expect(row.session.browserEntry()).toBe('unknown:lost');
    h.link(MAIN);
    expect(row.session.status().work?.holds).toEqual({ browser: 'unknown' });
    await row.end();
  });

  // P5 O17 M7 fix 4: the reversed order, main ready before the adoption reserves
  it('an adoption reserved while main\'s link serves, after a capable link this process had, is the lost link\'s: not released past its idle time; a declaring client that tells none still clears', async () => {
    const h = host();
    const mawsd = h.link();
    await mawsd.request('host.browserWork', { held: [ID] }); // names the session before its adoption reserves
    h.runtime.detach(); // mawsd's link lost, its tab still alive
    h.link(MAIN);
    const row = await adopting(h);
    expect(row.reserved).toBe('unknown');
    expect(row.session.browserEntry()).toBe('unknown:lost');
    row.transport.push(STOP);
    await vi.waitFor(() => expect(row.session.status().work?.unknown).toBeNull());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    h.table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(2 * IDLE_MS);
    expect(row.transport.requestsOf('end_session')).toEqual([]);
    h.link(OLDER_MAWSD); // the rollback: cleared, then released
    expect(row.session.status().work?.holds).toBeUndefined();
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(row.transport.requestsOf('end_session')).toHaveLength(1);
    vi.useRealTimers();
    await row.end();
  });

  it('an adoption reserved under a declaring client that tells none, after a capable link, starts clear (the rollback)', async () => {
    const h = host();
    await h.link().request('host.browserWork', { held: [ID] });
    h.runtime.detach();
    h.link(OLDER_MAWSD);
    const row = await adopting(h);
    expect(row.reserved).toBeNull();
    await row.end();
  });

  // P5 O17 M7 fix 4: the handover corner, closed by the host's own launch (mawsd's spawn names itself)
  it('in a host mawsd spawned, an adoption is the lost link\'s from its reservation: main\'s direct link arriving first clears nothing and nothing is released past the idle time; a declaring client that tells none still clears', async () => {
    const h = host({ spawnedByMawsd: true });
    const row = await adopting(h); // a successor mawsd started, before mawsd reconnects
    expect(row.reserved).toBe('unknown');
    expect(row.session.browserEntry()).toBe('unknown:lost');
    h.link(MAIN);
    expect(row.session.status().work?.holds).toEqual({ browser: 'unknown' });
    row.transport.push(STOP);
    await vi.waitFor(() => expect(row.session.status().work?.unknown).toBeNull());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    h.table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(2 * IDLE_MS);
    expect(row.transport.requestsOf('end_session')).toEqual([]);
    h.link(OLDER_MAWSD);
    expect(row.session.status().work?.holds).toBeUndefined();
    vi.useRealTimers();
    await row.end();
  });

  // The landing fix wave: in a host mawsd spawned, the spawner read at start (pid and start) is the producer until a
  // declaring hello replaces it, so a mawsd that dies before its first hello settles the adoptions it left lost
  it('in a host mawsd spawned, mawsd dies before its first hello and main falls back: the adopted lost row settles at its due time and is released', async () => {
    const alive = new Set([4242]);
    const h = host({ spawnedByMawsd: true, spawner: { pid: 4242, procStart: 'Mon Nov  2 09:00:00 2026' }, processes: { isAlive: (pid) => alive.has(pid), procStartOf: (pid) => (alive.has(pid) ? 'Mon Nov  2 09:00:00 2026' : null) } });
    const row = await adopting(h);
    expect(row.session.browserEntry()).toBe('unknown:lost');
    h.link(MAIN); // main's fallback, ready while mawsd still lives: nothing settles
    expect(row.session.browserEntry()).toBe('unknown:lost');
    row.transport.push(STOP);
    await vi.waitFor(() => expect(row.session.status().work?.unknown).toBeNull());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    h.table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    alive.delete(4242); // mawsd gone before it ever said hello to this host
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(row.session.browserEntry()).toBeNull();
    expect(row.transport.requestsOf('end_session')).toHaveLength(1);
    vi.useRealTimers();
    await row.end();
  });

  it('in a host mawsd spawned, an adoption reserved while main\'s link already serves is the lost link\'s too', async () => {
    const h = host({ spawnedByMawsd: true });
    h.link(MAIN);
    const row = await adopting(h);
    expect(row.reserved).toBe('unknown');
    expect(row.session.browserEntry()).toBe('unknown:lost');
    await row.end();
  });

  // P5 O17 M7 fix 3: the adoption's cause
  it('the embedded shape: an adoption before any capable client is the adoption\'s unknown; main\'s link clears it, and the row is released when idle', async () => {
    const h = host();
    const row = await adopting(h);
    expect(row.session.browserEntry()).toBe('unknown:adopted');
    h.link(MAIN);
    expect(row.session.status().work?.holds).toBeUndefined();
    expect(row.published.at(-1)).toBeNull();
    row.transport.push(STOP); // the adopted row's work known again at its next Stop
    await vi.waitFor(() => expect(row.session.status().work?.unknown).toBeNull());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    h.table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(row.transport.requestsOf('end_session')).toHaveLength(1);
    vi.useRealTimers();
    await row.end();
  });

  it('a capable link that came and went before its first snapshot makes the adoption\'s unknown the lost link\'s: main\'s link clears nothing', async () => {
    const h = host();
    const row = await adopting(h);
    h.link(); // mawsd, ended before it told its snapshot
    expect(row.session.browserEntry()).toBe('unknown:lost');
    h.runtime.detach();
    h.link(MAIN);
    expect(row.session.status().work?.holds).toEqual({ browser: 'unknown' });
    h.link(OLDER_MAWSD); // a declaring client that tells none still clears it
    expect(row.session.status().work?.holds).toBeUndefined();
    await row.end();
  });
});

// The landing fix wave, finding 1: a lost link's `unknown` settled by its producer's death. The engine host keeps the last
// declaring client's process (its hello's pid, its start read then); a check at a non-declaring client's ready, at the
// idle release's due handling and at the budget's evaluation clears every lost link's `unknown` once that process is dead
// or its pid runs another start (the render host exits with its `mawsd`'s machine.sock, and the profile's lock makes that
// `mawsd` the only producer). A start that cannot be read counts as alive.
describe('a lost link\'s unknown settled by its producer\'s death (P5 O17 M7 landing fix 1)', () => {
  const IDLE_MS = 10 * 60_000;
  const MAWSD_PID = 4242;
  const MAWSD = { ...DECLARING, pid: MAWSD_PID };
  const START = 'Mon Nov  2 09:00:00 2026';

  // mawsd's permanent link holds `a` by its snapshot; `alive` and `starts` are the machine's processes as the check reads them
  async function held() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-02T10:00:00.000Z'));
    const alive = new Set([MAWSD_PID]);
    const starts = new Map<number, string | null>([[MAWSD_PID, START]]);
    const h = host({ processes: { isAlive: (pid) => alive.has(pid), procStartOf: (pid) => (alive.has(pid) ? (starts.get(pid) ?? null) : null) } });
    const a = await launch(h.table, 'a');
    await vi.advanceTimersByTimeAsync(0);
    await h.link(MAWSD).request('host.browserWork', { held: ['a'] });
    expect(a.session.browserEntry()).toBe('held');
    return { h, a, alive, starts };
  }

  it('the reviewer\'s order: main\'s fallback replaces mawsd\'s link, mawsd ends for good, then main is ready: the row settles there and is released when idle', async () => {
    const { h, a, alive } = await held();
    const main = h.served(MAIN); // main's direct link replaces mawsd's
    expect(a.session.browserEntry()).toBe('unknown:lost');
    alive.delete(MAWSD_PID); // mawsd's onReplaced: stop('replaced', 0), its render host gone with machine.sock
    h.runtime.setReady();
    expect(a.session.browserEntry()).toBeNull();
    h.table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(a.transport.requestsOf('end_session')).toHaveLength(1);
    expect(main.events('host.browserIdle')).toEqual([]);
  });

  it('main falls back while mawsd lives, then mawsd exits: at the due time the row settles and is released', async () => {
    const { h, a, alive } = await held();
    h.link(MAIN); // ready: the check finds mawsd alive
    expect(a.session.browserEntry()).toBe('unknown:lost');
    h.table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS / 2);
    alive.delete(MAWSD_PID);
    expect(a.session.browserEntry()).toBe('unknown:lost'); // no timer of its own
    await vi.advanceTimersByTimeAsync(IDLE_MS / 2);
    expect(a.session.browserEntry()).toBeNull();
    expect(a.transport.requestsOf('end_session')).toHaveLength(1);
  });

  it('mawsd alive behind main\'s direct link keeps its hold: nothing settles at the ready, the due time or the budget, nothing is released', async () => {
    const { h, a } = await held();
    h.link(MAIN);
    h.table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(2 * IDLE_MS);
    h.table.configure({ enabled: true, limitKiB: 1, statefulMcpServers: [] });
    expect(a.session.browserEntry()).toBe('unknown:lost');
    expect(a.transport.requestsOf('end_session')).toEqual([]);
  });

  it('the same pid with another start is another process: mawsd read as dead, the row settled', async () => {
    const { h, a, starts } = await held();
    h.runtime.detach();
    starts.set(MAWSD_PID, 'Mon Nov  2 11:30:00 2026'); // mawsd gone, its pid reused
    h.link(MAIN);
    expect(a.session.browserEntry()).toBeNull();
  });

  it('a start unreadable now, or at the hello, counts as alive', async () => {
    const { h, a, starts } = await held();
    h.runtime.detach();
    starts.set(MAWSD_PID, null);
    h.link(MAIN);
    expect(a.session.browserEntry()).toBe('unknown:lost');
    const b = await launch(h.table, 'b', 902);
    starts.set(MAWSD_PID, null);
    await h.link(MAWSD).request('host.browserWork', { held: ['a', 'b'] }); // mawsd's start unreadable at its hello
    starts.set(MAWSD_PID, 'Mon Nov  2 11:30:00 2026');
    h.link(MAIN);
    expect([a.session.browserEntry(), b.session.browserEntry()]).toEqual(['unknown:lost', 'unknown:lost']);
  });

  it('mawsd\'s link dropped first and was never replaced: once mawsd is dead the due time settles the row and releases it', async () => {
    const { h, a, alive } = await held();
    h.runtime.detach();
    alive.delete(MAWSD_PID);
    h.table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(a.transport.requestsOf('end_session')).toHaveLength(1);
  });

  it('the budget\'s evaluation settles it too', async () => {
    const { h, a, alive } = await held();
    h.link(MAIN);
    alive.delete(MAWSD_PID);
    h.table.configure({ enabled: false, limitKiB: 1, statefulMcpServers: [] });
    expect(a.session.browserEntry()).toBeNull();
  });

  it('a newer declaring hello is the producer: a dead earlier mawsd settles nothing while the newer one lives', async () => {
    const { h, a, alive, starts } = await held();
    h.runtime.detach();
    alive.delete(MAWSD_PID);
    alive.add(4343);
    starts.set(4343, START);
    h.served({ ...DECLARING, pid: 4343 }); // the lock's next holder, its link lost before its first snapshot
    h.runtime.detach();
    h.link(MAIN);
    expect(a.session.browserEntry()).toBe('unknown:lost');
    alive.delete(4343);
    h.runtime.detach();
    h.link(MAIN);
    expect(a.session.browserEntry()).toBeNull();
  });
});

// The landing fix wave, finding 2: a fresh link sends its first snapshot before its `ready` line, so a due row's notice
// can come while the link is served and not ready. It is kept for that link's ready and sent once there; a link that ends
// before its ready drops it, and the next link's first snapshot asks again.
describe('host.browserIdle between a fresh link\'s first snapshot and its ready (P5 O17 M7 landing fix 2)', () => {
  const IDLE_MS = 10 * 60_000;

  // `a` due and waiting, told once on a first link that has since ended
  async function waiting() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-02T10:00:00.000Z'));
    const h = host();
    const a = await launch(h.table, 'a');
    await vi.advanceTimersByTimeAsync(0);
    const first = h.link();
    await first.request('host.browserWork', { held: ['a'] });
    h.table.setIdleRelease({ idleMs: IDLE_MS, active: true });
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(first.events('host.browserIdle')).toEqual([{ appSessionId: 'a' }]);
    h.runtime.detach();
    return { h, a };
  }

  it('a zero-delay due timer firing between the first snapshot and ready: the notice is kept and sent at the ready, once', async () => {
    const { h } = await waiting();
    const second = h.served(); // mawsd reconnected: its first snapshot comes before its ready line
    await second.request('host.browserWork', { held: ['a'] });
    await vi.advanceTimersByTimeAsync(0); // the waiting row asks again, in the gap
    expect(second.events('host.browserIdle')).toEqual([]);
    h.runtime.setReady();
    expect(second.events('host.browserIdle')).toEqual([{ appSessionId: 'a' }]);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(second.events('host.browserIdle')).toHaveLength(1);
  });

  it('a link that ends before its ready drops the kept notice; the next link\'s first snapshot asks again', async () => {
    const { h } = await waiting();
    const second = h.served();
    await second.request('host.browserWork', { held: ['a'] });
    await vi.advanceTimersByTimeAsync(0);
    h.runtime.detach(); // before its ready
    const third = h.link(); // ready before its first snapshot: nothing kept reaches it
    expect(third.events('host.browserIdle')).toEqual([]);
    await third.request('host.browserWork', { held: ['a'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(second.events('host.browserIdle')).toEqual([]);
    expect(third.events('host.browserIdle')).toEqual([{ appSessionId: 'a' }]);
  });

  it('a kept notice whose wait ended before the ready is not sent', async () => {
    const { h, a } = await waiting();
    const second = h.served();
    await second.request('host.browserWork', { held: ['a'] });
    await vi.advanceTimersByTimeAsync(0);
    await second.request('host.browserWork', { held: [] }); // the tabs closed: the wait ends and the row is released
    await vi.advanceTimersByTimeAsync(0);
    expect(a.transport.requestsOf('end_session')).toHaveLength(1);
    h.runtime.setReady();
    expect(second.events('host.browserIdle')).toEqual([]);
  });
});
