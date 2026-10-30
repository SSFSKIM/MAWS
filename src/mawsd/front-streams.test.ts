// A services front client's session streams and the client port (P5 O3-D M4; docs/doperpowers/plans/2026-10-29-p5-o3-d-
// cutover.md, Interfaces §C, §E; D41): `session.follow` and `clientPort.answer` over a machine.sock client's runtime,
// against a fake engine host's journal and link. The same over real sockets and two clients is
// test/mawsd/two-clients.test.ts's.
import type { SessionEvent } from '@shared/graph/events';
import type { ClientRef } from '@shared/ipc/client';
import type { MachineRef } from '@shared/machine/ref';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeEngineHost } from '../../test/mawsd/fake-engine-host';
import { OpLedger } from '@shared/host/op-ledger';
import { registerMachineOps } from '../services/machine-ops';
import { createServicesFront, type FrontOptions, type ServicesFront } from './front';
import { FrontStreams } from './front-streams';

const IDENTITY = { ref: 'TestMachineRef00000000' as MachineRef, name: 'test machine', project: { key: 'machine:TestMachineRef00000000', name: 'test machine', smnsId: null } };

type Line = Record<string, unknown> & { t: string };

// A machine.sock client's end of its connection, as the socket layer hands the runtime one
function connection() {
  const posted: Line[] = [];
  let listener: (event: { data: unknown }) => void = () => {};
  let open = true;
  const port = {
    start: () => {},
    on: (_event: 'message', l: (event: { data: unknown }) => void) => void (listener = l),
    postMessage: (message: unknown) => (open ? void posted.push(message as Line) : false),
  };
  let next = 0;
  const events = () => posted.filter((m) => m.t === 'evt') as Array<Line & { name: string; payload: Record<string, unknown> }>;
  return {
    port,
    posted,
    close: () => void (open = false),
    ready: () => listener({ data: { t: 'ready' } }),
    async request(name: string, input?: unknown, client?: string): Promise<Line> {
      const id = `r${++next}`;
      listener({ data: { t: 'req', id, name, input, ...(client && { client }) } });
      await vi.waitFor(() => expect(posted.find((m) => m.id === id)).toBeDefined());
      return posted.find((m) => m.id === id)!;
    },
    events,
    /** The events of `app`'s batches, in order. */
    batched: (app: string) => events().flatMap((m) => (m.name === 'session.eventBatch' && m.payload.appSessionId === app ? (m.payload.events as SessionEvent[]) : [])),
    names: (app: string) => events().filter((m) => m.payload.appSessionId === app || (m.payload.status as { appSessionId?: string } | undefined)?.appSessionId === app).map((m) => m.name),
  };
}

const fronts: ServicesFront[] = [];
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const front of fronts.splice(0)) front.close();
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});

function lab(over: Partial<FrontOptions> = {}) {
  const host = new FakeEngineHost();
  const front = createServicesFront({
    spine: { ensure: async () => ({}) as never },
    hosts: host.hosts,
    intercept: () => null,
    daemon: async () => undefined,
    identity: () => IDENTITY,
    isApp: (appPid) => appPid === 100,
    log: () => {},
    ...over,
  });
  fronts.push(front);
  const client = (appPid = 1) => {
    const end = connection();
    const runtime = front.runtimeFor({ appPid, capabilities: [] });
    runtime.serve(end.port);
    end.ready();
    // its connection closes, as the socket layer ends a client's runtime
    return Object.assign(end, { leave: () => (end.close(), runtime.detach()) });
  };
  return { host, front, client };
}

const ids = (events: SessionEvent[]) => events.map((e) => e.id);
const cursorOf = (event: SessionEvent) => {
  const [, launchId, seq, idx] = event.id.split(':');
  return { launchId, seq: Number(seq), idx: Number(idx) };
};

describe('a front client’s session streams', () => {
  it('sends a stream’s replace-whole parts, its status first, before the first replayed event, then the events after the cursor', async () => {
    const { host, client } = lab();
    host.add('s1');
    const seen = [...host.row('s1', 2), ...host.row('s1', 1)];
    const missed = [...host.row('s1', 3), ...host.row('s1', 1)];
    const c = client();
    const answer = await c.request('session.follow', { sessions: [{ appSessionId: 's1', cursor: cursorOf(seen.at(-1)!) }], live: false });
    expect(answer).toMatchObject({ ok: true, value: { streams: [{ appSessionId: 's1', mode: 'replay', launchId: host.session('s1').launchId }] } });
    await vi.waitFor(() => expect(c.batched('s1')).toHaveLength(4));
    expect(c.names('s1')).toEqual(['session.status', 'session.queue', 'session.brokerItems', 'session.catalogChanged', 'session.eventBatch']);
    expect(ids(c.batched('s1'))).toEqual(ids(missed));
    const live = host.row('s1', 2);
    await vi.waitFor(() => expect(c.batched('s1')).toHaveLength(6));
    expect(ids(c.batched('s1'))).toEqual(ids([...missed, ...live]));
  });

  it('streams a session with no cursor live from its last journaled row (`from: now`), answered `live`', async () => {
    const { host, client } = lab();
    host.add('s1');
    host.row('s1', 2);
    const last = host.row('s1', 2, { live: false }); // journaled, its live batch still on its way
    const c = client();
    expect(await c.request('session.follow', { sessions: [{ appSessionId: 's1', cursor: null }], live: false })).toMatchObject({ value: { streams: [{ mode: 'live' }] } });
    host.emit('session.eventBatch', { appSessionId: 's1', events: last });
    const live = host.row('s1', 1);
    await vi.waitFor(() => expect(c.batched('s1')).toHaveLength(3));
    expect(ids(c.batched('s1'))).toEqual(ids([...last, ...live]));
  });

  it('answers `missing` when the cursor’s range is gone, and goes on live from now', async () => {
    const { host, client } = lab();
    const s = host.add('s1');
    const first = host.row('s1', 1);
    for (let i = 0; i < 5; i++) host.row('s1', 1);
    s.evicted = { seq: 3, idx: 0 };
    s.journal = false;
    const c = client();
    expect(await c.request('session.follow', { sessions: [{ appSessionId: 's1', cursor: cursorOf(first[0]) }], live: false })).toMatchObject({ value: { streams: [{ mode: 'missing' }] } });
    const live = host.row('s1', 1);
    await vi.waitFor(() => expect(c.batched('s1')).toHaveLength(1));
    expect(ids(c.batched('s1'))).toEqual(ids(live));
  });

  it('answers a new stream’s first opening even when it opened while a `live: true` follow was still listing the live sessions', async () => {
    const host = new FakeEngineHost();
    const s = host.add('s1');
    const first = host.row('s1', 1);
    host.row('s1', 1);
    host.row('s1', 1);
    s.evicted = { seq: 2, idx: 0 };
    s.journal = false;
    let list: (apps: string[]) => void = () => {};
    const streams = new FrontStreams({ read: async (name, input) => host.answer(name, input), liveSessions: () => new Promise((resolve) => (list = resolve)), log: () => {} });
    cleanups.push(() => streams.stop());
    let opened: () => void = () => {};
    const parts = new Promise<void>((resolve) => (opened = resolve));
    const follower = streams.follower((name) => void (name === 'session.status' && opened()));
    const answer = follower.follow({ sessions: [{ appSessionId: 's1', cursor: cursorOf(first[0]) }], live: true });
    await parts; // s1's opening is answered and its parts sent while the listing is still out
    list(['s1']);
    expect(await answer).toEqual({ streams: [{ appSessionId: 's1', mode: 'missing', launchId: s.launchId }] });
    // a later follow that keeps the stream answers how it goes on now
    expect(await follower.follow({ sessions: [{ appSessionId: 's1', cursor: null }], live: false })).toEqual({ streams: [{ appSessionId: 's1', mode: 'live', launchId: s.launchId }] });
  });

  it('answers the first opening of a stream an event opened while a `live: true` follow was still listing the live sessions', async () => {
    const host = new FakeEngineHost();
    const s = host.add('s1');
    host.row('s1', 1);
    host.row('s1', 1);
    host.row('s1', 1);
    s.evicted = { seq: 2, idx: 0 };
    s.journal = false;
    let list: (apps: string[]) => void = () => {};
    const streams = new FrontStreams({ read: async (name, input) => host.answer(name, input), liveSessions: () => new Promise((resolve) => (list = resolve)), log: () => {} });
    cleanups.push(() => streams.stop());
    let opened: () => void = () => {};
    const parts = new Promise<void>((resolve) => (opened = resolve));
    const follower = streams.follower((name) => void (name === 'session.status' && opened()));
    const answer = follower.follow({ sessions: [], live: true });
    streams.liveEvent('session.status', { appSessionId: 's1', status: host.status(s) }); // opens s1's stream from its launch's start
    await parts; // and its opening is answered while the listing is still out
    list(['s1']);
    expect(await answer).toEqual({ streams: [{ appSessionId: 's1', mode: 'missing', launchId: s.launchId }] });
  });

  it('carries a followed session’s other events, its archive’s `session.forgotten` among them', async () => {
    const { host, client } = lab();
    host.add('s1');
    host.add('s2');
    const c = client();
    await c.request('session.follow', { sessions: [{ appSessionId: 's1', cursor: null }], live: false });
    host.emit('session.forgotten', { appSessionId: 's1' });
    host.emit('session.forgotten', { appSessionId: 's2' }); // not followed, and c is no machine.spine client
    await vi.waitFor(() => expect(c.events().filter((m) => m.name === 'session.forgotten')).toHaveLength(1));
    expect(c.events().filter((m) => m.name === 'session.forgotten').map((m) => m.payload)).toEqual([{ appSessionId: 's1' }]);
  });

  it('replaces the client’s whole set: a dropped stream ends, a kept one goes on untouched', async () => {
    const { host, client } = lab();
    host.add('s1');
    host.add('s2');
    const c = client();
    await c.request('session.follow', { sessions: [{ appSessionId: 's1', cursor: null }, { appSessionId: 's2', cursor: null }], live: false });
    const a = host.row('s1', 1);
    host.row('s2', 1);
    await vi.waitFor(() => expect(c.batched('s2')).toHaveLength(1));
    const answer = await c.request('session.follow', { sessions: [{ appSessionId: 's1', cursor: null }], live: false });
    expect(answer).toMatchObject({ value: { streams: [{ appSessionId: 's1', mode: 'live', launchId: host.session('s1').launchId }] } });
    const statuses = c.names('s1').filter((n) => n === 'session.status').length;
    const b = host.row('s1', 1);
    host.row('s2', 2);
    await vi.waitFor(() => expect(c.batched('s1')).toHaveLength(2));
    expect(ids(c.batched('s1'))).toEqual(ids([...a, ...b])); // kept: nothing sent again
    expect(c.names('s1').filter((n) => n === 'session.status')).toHaveLength(statuses);
    expect(c.batched('s2')).toHaveLength(1); // dropped: nothing more
  });

  it('with `live: true` streams every other live session from now, and a session launched later from its first event', async () => {
    const { host, client } = lab();
    host.add('s1');
    host.row('s1', 2);
    const other = client();
    await other.request('session.follow', { sessions: [], live: false });
    const c = client();
    const answer = await c.request('session.follow', { sessions: [], live: true });
    expect(answer).toMatchObject({ value: { streams: [{ appSessionId: 's1', mode: 'live' }] } });
    const live = host.row('s1', 1);
    host.add('s2');
    const fresh = [...host.row('s2', 2), ...host.row('s2', 1)];
    await vi.waitFor(() => expect(c.batched('s2')).toHaveLength(3));
    expect(ids(c.batched('s2'))).toEqual(ids(fresh));
    expect(c.names('s2')[0]).toBe('session.status');
    await vi.waitFor(() => expect(c.batched('s1')).toHaveLength(1));
    expect(ids(c.batched('s1'))).toEqual(ids(live));
    expect(other.events()).toEqual([]); // a client that follows nothing hears none of it
  });

  it('restarts a stream at the new launch’s first event when the session is launched again', async () => {
    const { host, client } = lab();
    host.add('s1');
    host.row('s1', 3);
    const c = client();
    await c.request('session.follow', { sessions: [{ appSessionId: 's1', cursor: null }], live: false });
    host.relaunch('s1');
    const next = [...host.row('s1', 2), ...host.row('s1', 1)];
    await vi.waitFor(() => expect(c.batched('s1')).toHaveLength(3));
    expect(ids(c.batched('s1'))).toEqual(ids(next));
  });

  it('catches up from its cursor, exactly once, when the engine-host link drops and streams again mid-stream (D41)', async () => {
    const { host, client } = lab();
    host.add('s1');
    const c = client();
    await c.request('session.follow', { sessions: [{ appSessionId: 's1', cursor: null }], live: false });
    const before = host.row('s1', 3, { cut: [1] });
    await vi.waitFor(() => expect(c.batched('s1')).toHaveLength(3));
    host.drop();
    const during = [...host.row('s1', 2), ...host.row('s1', 1)];
    host.reconnect();
    await vi.waitFor(() => expect(c.batched('s1')).toHaveLength(6));
    const after = host.row('s1', 1);
    await vi.waitFor(() => expect(c.batched('s1')).toHaveLength(7));
    expect(ids(c.batched('s1'))).toEqual(ids([...before, ...during, ...after]));
  });

  it('does not wake a parked engine host: a stream of it waits, and opens from its launch’s first event at the link’s next streaming', async () => {
    const { host, client } = lab();
    host.add('s1');
    const first = host.row('s1', 1);
    host.parkedNow = true;
    const c = client();
    expect(await c.request('session.follow', { sessions: [{ appSessionId: 's1', cursor: null }], live: true })).toMatchObject({ value: { streams: [{ appSessionId: 's1', mode: 'live', launchId: null }] } });
    expect(host.calls).toEqual([]);
    host.parkedNow = false;
    host.drop();
    const rows = host.row('s1', 2);
    host.reconnect();
    await vi.waitFor(() => expect(c.batched('s1')).toHaveLength(3));
    expect(ids(c.batched('s1'))).toEqual(ids([...first, ...rows])); // answered with no launch: all of it is new to the client
  });

  it('a client’s departure ends its streams', async () => {
    const { host, client } = lab();
    host.add('s1');
    const c = client();
    await c.request('session.follow', { sessions: [{ appSessionId: 's1', cursor: null }], live: true });
    c.leave();
    const reads = host.calls.length;
    host.row('s1', 1);
    host.add('s2');
    expect(host.calls.length).toBe(reads); // no stream reads for it any more
  });

  it('is a machine.sock client’s own: the endpoint’s dispatch is refused', async () => {
    const { front } = lab();
    expect(await front.dispatch('session.follow', { sessions: [], live: false })).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(await front.dispatch('machine.identity', undefined)).toMatchObject({ ok: true, value: IDENTITY });
  });
});

describe('the client port over the front', () => {
  // The ref a client's request minted, as a handler the spine registered sees it
  async function refOf(front: ServicesFront, c: ReturnType<typeof connection>, page?: string): Promise<ClientRef> {
    let ref: ClientRef | null = null;
    if (!front.commands().includes('session.launchMode')) front.bus.register('session.launchMode', (_input, context) => ((ref = context.client), { mode: 'index' }) as never);
    await c.request('session.launchMode', undefined, page);
    return ref!;
  }
  const requests = (c: ReturnType<typeof connection>) => c.events().filter((m) => m.name === 'clientPort.request').map((m) => m.payload);

  it('asks the client whose request minted the ref, with its own id, and takes its answer', async () => {
    const { front, client } = lab();
    const [a, b] = [client(), client()];
    const ref = await refOf(front, b, 'page:7');
    const asked = front.port.reveal(ref, '/tmp/x');
    await vi.waitFor(() => expect(requests(b)).toHaveLength(1));
    expect(requests(a)).toEqual([]);
    const request = requests(b)[0];
    expect(request).toMatchObject({ client: 'page:7', kind: 'reveal', request: { path: '/tmp/x' } });
    expect(await a.request('clientPort.answer', { id: request.id, answer: { revealed: true } })).toMatchObject({ ok: false, error: { code: 'invalid_input' } }); // another client's id
    expect(await b.request('clientPort.answer', { id: 'cp-unknown', answer: {} })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await b.request('clientPort.answer', { id: request.id, answer: { revealed: true } })).toMatchObject({ ok: true });
    expect(await asked).toEqual({ revealed: true });
    expect(await b.request('clientPort.answer', { id: request.id, answer: { revealed: true } })).toMatchObject({ ok: false }); // settled
  });

  it('asks the app for `null`, and answers noClient at once with no app', async () => {
    const { front, client } = lab();
    const other = client(1);
    expect(front.port.badge(null, 3)).toEqual({ noClient: true });
    expect(await front.port.confirm(null, { kind: 'info', message: 'm', confirm: 'OK', cancel: 'No' })).toEqual({ noClient: true });
    const app = client(100);
    expect(requests(app)).toMatchObject([{ client: null, kind: 'badge', request: { count: 3 } }]); // M5b fix round 2: the badge is a level, told to the app as it arrives
    expect(front.port.badge(null, 4)).toBeUndefined(); // returns at once
    expect(requests(app)).toMatchObject([{ client: null, kind: 'badge', request: { count: 3 } }, { client: null, kind: 'badge', request: { count: 4 } }]);
    expect(requests(other)).toEqual([]);
  });

  it('keeps a dialog waiting past the deadline while its client lives, settles it noClient when the client leaves; reveal settles at the deadline', async () => {
    const { front, client } = lab({ portDeadlineMs: 10_000 });
    const c = client();
    const ref = await refOf(front, c);
    vi.useFakeTimers();
    const pick = front.port.pick(ref, { kind: 'file', multiple: false });
    const save = front.port.save(ref, { defaultPath: '/tmp/y' });
    const reveal = front.port.reveal(ref, '/tmp/x');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await reveal).toEqual({ noClient: true });
    vi.useRealTimers();
    const id = requests(c).find((r) => r.kind === 'pick')!.id;
    expect(await c.request('clientPort.answer', { id, answer: { paths: ['/tmp/a'] } })).toMatchObject({ ok: true });
    expect(await pick).toEqual({ paths: ['/tmp/a'] });
    const confirm = front.port.confirm(ref, { kind: 'warning', message: 'm', confirm: 'OK', cancel: 'No' });
    c.leave();
    expect(await save).toEqual({ noClient: true });
    expect(await confirm).toEqual({ noClient: true });
    expect(front.port.badge(ref, 1)).toEqual({ noClient: true });
  });

  it('holds nothing serialized while a dialog is open: another machine.op, a spine command and a second dialog go on (D44(1))', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'front-port-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const { front, client } = lab();
    const [a, b] = [client(), client()];
    // an act that asks its client to confirm before it acts, as a spine service's would
    front.bus.register('session.drafts.set', async (input, context) => {
      if (input.appSessionId === 'app-asks') await front.port.confirm(context.client, { kind: 'warning', message: 'sure?', confirm: 'OK', cancel: 'No' });
    });
    front.bus.register('session.list', () => ({ sessions: [], revision: 1 }));
    registerMachineOps(front.bus, OpLedger.open(dir, 'spine-ops.jsonl'));
    const op = (opId: string, appSessionId: string, c: ReturnType<typeof client>) =>
      c.request('machine.op', { opId, opCreated: new Date().toISOString(), claim: { member: 'mem-a', device: 'dev-1', fingerprint: 'fp' }, name: 'session.drafts.set', input: { appSessionId, draft: null } });
    const asking = op('op-asks-0000000001', 'app-asks', a);
    await vi.waitFor(() => expect(requests(a)).toHaveLength(1)); // the dialog is open on a
    expect(await op('op-other-000000001', 'app-other', b)).toMatchObject({ ok: true, value: { state: 'done', result: { ok: true } } });
    expect(await b.request('session.list', { includeArchived: false })).toMatchObject({ ok: true, value: { sessions: [] } });
    const refB = await refOf(front, b);
    const second = front.port.confirm(refB, { kind: 'info', message: 'too?', confirm: 'OK', cancel: 'No' });
    await vi.waitFor(() => expect(requests(b)).toHaveLength(1));
    await b.request('clientPort.answer', { id: requests(b)[0].id, answer: { confirmed: true } });
    expect(await second).toEqual({ confirmed: true });
    await a.request('clientPort.answer', { id: requests(a)[0].id, answer: { confirmed: true } });
    expect(await asking).toMatchObject({ ok: true, value: { state: 'done', result: { ok: true } } });
  });

  it('delivers a notification’s events as further answers until it closes', async () => {
    const { front, client } = lab();
    const c = client();
    const ref = await refOf(front, c);
    const events: unknown[] = [];
    const handle = front.port.notify(ref, { title: 't', body: 'b', silent: false }, (event) => void events.push(event));
    expect(handle).toHaveProperty('close');
    const id = requests(c)[0].id;
    await c.request('clientPort.answer', { id, answer: { kind: 'shown' } });
    await c.request('clientPort.answer', { id, answer: { kind: 'clicked' } });
    await c.request('clientPort.answer', { id, answer: { kind: 'closed' } });
    expect(events).toEqual([{ kind: 'shown' }, { kind: 'clicked' }, { kind: 'closed' }]);
    expect(await c.request('clientPort.answer', { id, answer: { kind: 'clicked' } })).toMatchObject({ ok: false });
  });

  it('answers a ref the endpoint minted noClient (a remote device, until O7 M5)', async () => {
    const { front, client } = lab();
    client(100);
    const remote = { id: 'endpoint/device', onGone: () => () => {} } as unknown as ClientRef;
    expect(await front.port.reveal(remote, '/tmp/z')).toEqual({ noClient: true });
  });
});
