// Lane B placement and the asker's ref (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Lane B
// placement goes through the spine's record" and "A `ClientRef` per channel"). A request naming an `appSessionId` is
// placed by the spine's record first (`session.get`, whose `engineSessionId` keys the session's member record), so a
// session the engine host holds no row for (released as idle, or the host parked) is still placed; the engine host's
// `session.status` answers only when the spine gives no record with an engine session. And each channel is one asker on
// the machine: a `ClientRef` minted at its admission, carried by every `dispatch` its requests make, ended at its close.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ClientRef } from '@shared/ipc/client';
import { act, done, makeOrg, openRemote, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(() => stopAll(started));
afterAll(() => stopAll(started));

async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}

/** A lane B session the machine's owners own, its member record under `engine`. */
function owned(f: Fixture, appSessionId: string, engine: string): void {
  f.records.set({ lane: 'B', session: engine, owners: ['@machine'] }, appSessionId);
}

const statusReads = (f: Fixture, appSessionId: string) => f.host.calls.filter((c) => c.name === 'session.status' && (c.input as { appSessionId?: string }).appSessionId === appSessionId);

describe('lane B placement', () => {
  it('places a session by the spine’s record when the engine host holds no row for it (released, or the host parked)', async () => {
    const f = await startEndpoint(org, started);
    const record = f.spine.set('app-r', 'eng-r', { title: 'released' });
    owned(f, 'app-r', 'eng-r');
    const a = await openRemote(f, org.a1, org.A);
    expect(await call(a, 'session.get', { appSessionId: 'app-r' })).toMatchObject({ ok: true, output: record });
    expect(statusReads(f, 'app-r')).toEqual([]);
    // A member with no rank on it is refused as for any session, saying nothing of whether it exists.
    const b = await openRemote(f, org.b1, org.B);
    expect(await call(b, 'session.get', { appSessionId: 'app-r' })).toMatchObject({ ok: false, error: { code: 'grade' } });
  });

  it('answers a session neither the spine nor the engine host knows as unknown (`grade`)', async () => {
    const f = await startEndpoint(org, started);
    const a = await openRemote(f, org.a1, org.A);
    expect(await call(a, 'session.get', { appSessionId: 'app-nowhere' })).toMatchObject({ ok: false, error: { code: 'grade' } });
  });

  it('falls back to the engine host for a session the spine has no record of, or one whose record has no engine session yet', async () => {
    const f = await startEndpoint(org, started);
    f.host.add('app-1');
    owned(f, 'app-1', 'eng-app-1');
    f.host.add('app-fresh', 'eng-fresh');
    f.spine.set('app-fresh', null); // launched; the index hasn't heard its engine's id yet
    owned(f, 'app-fresh', 'eng-fresh');
    f.spine.set('app-never', null); // never launched
    const a = await openRemote(f, org.a1, org.A);
    expect(await call(a, 'session.status', { appSessionId: 'app-1' })).toMatchObject({ ok: true, output: { engineSessionId: 'eng-app-1' } });
    expect(await call(a, 'session.status', { appSessionId: 'app-fresh' })).toMatchObject({ ok: true, output: { engineSessionId: 'eng-fresh' } });
    expect(await call(a, 'session.get', { appSessionId: 'app-never' })).toMatchObject({ ok: false, error: { code: 'grade' } });
  });

  it('falls back to the engine host while the spine can’t answer, and is `unavailable` while neither can', async () => {
    const f = await startEndpoint(org, started);
    f.host.add('app-1');
    owned(f, 'app-1', 'eng-app-1');
    const a = await openRemote(f, org.a1, org.A);
    f.host.fail('session.get');
    expect(await call(a, 'session.status', { appSessionId: 'app-1' })).toMatchObject({ ok: true });
    f.host.fail('session.status');
    expect(await call(a, 'session.queue.list', { appSessionId: 'app-1' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });

  it('places a `machine` act on a released session, and the query of it, by the record', async () => {
    const f = await startEndpoint(org, started);
    f.spine.set('app-r', 'eng-r');
    owned(f, 'app-r', 'eng-r');
    const a = await openRemote(f, org.a1, org.A);
    const acquire = a.device.action({ machine: f.ref, action: 'session.acquire', args: { appSessionId: 'app-r', reason: 'send' } });
    const from = a.inbox.length;
    expect(await act(a, acquire)).toBe('ok');
    expect(await done(a, acquire, from)).toEqual({ state: 'done', result: { status: 'ready', appSessionId: 'app-r', launched: true, joined: false } });
    expect(f.spine.acquired).toEqual(['app-r']);
    await a.channel.send({ t: 'query', opId: acquire.opId, opCreated: acquire.opCreated, executor: 'machine' });
    expect(await waitFor(a, (m) => m.t === 'queried' && m.opId === acquire.opId, 'the query’s answer')).toMatchObject({ state: 'done', outcome: { state: 'done' } });
  });
});

describe('a ClientRef per channel', () => {
  const clientsOf = (f: Fixture, name: string) => f.host.calls.filter((c) => c.name === name).map((c) => c.client);
  const gone = (client: ClientRef | undefined) => {
    let ended = false;
    client?.onGone(() => (ended = true))();
    return ended;
  };

  it('reaches every dispatch a channel’s requests make, one ref per channel, ended at its close', async () => {
    const f = await startEndpoint(org, started);
    const s = f.host.add('app-1');
    owned(f, 'app-1', s.engineSessionId!);
    f.spine.set('app-1', s.engineSessionId);
    const a = await openRemote(f, org.a1, org.A);
    const again = await openRemote(f, org.a1, org.A);
    // Its placement's read and its executor's both carry the channel's ref.
    await call(a, 'session.get', { appSessionId: 'app-1' });
    const first = clientsOf(f, 'session.get').at(-1);
    expect(first?.id).toMatch(/^a1\//);
    expect(clientsOf(f, 'session.get').slice(-2)).toEqual([first, first]);
    await call(again, 'session.get', { appSessionId: 'app-1' });
    const second = clientsOf(f, 'session.get').at(-1);
    expect(second?.id).toMatch(/^a1\//);
    expect(second!.id).not.toBe(first!.id);
    await call(a, 'session.status', { appSessionId: 'app-1' });
    expect(clientsOf(f, 'session.status').at(-1)).toBe(first);
    // An act's executor hears the same asker: the engine host's ledger and the services'.
    const send = a.device.action({ machine: f.ref, action: 'session.send', session: 'app-1', context: { lane: 'B', launchId: s.launchId, engineSessionId: s.engineSessionId! }, args: { appSessionId: 'app-1', content: 'hi' } });
    expect(await act(a, send)).toBe('ok');
    await until(() => clientsOf(f, 'host.op').length > 0, 'the act handed on');
    expect(clientsOf(f, 'host.op').at(-1)).toBe(first);
    const acquire = a.device.action({ machine: f.ref, action: 'session.acquire', args: { appSessionId: 'app-1', reason: 'send' } });
    expect(await act(a, acquire)).toBe('ok');
    await until(() => clientsOf(f, 'machine.op').length > 0, 'the machine act handed on');
    expect(clientsOf(f, 'machine.op').at(-1)).toBe(first);

    expect(gone(first)).toBe(false);
    a.channel.close('closed');
    await until(() => gone(first), 'the closed channel’s ref ended');
    expect(gone(second)).toBe(false);
  });
});
