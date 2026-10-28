// Remote reads (O10 M8; RL3, RL §6.2): a `call` forwards a `list`- or `view`-graded read through `dispatch`, or for
// lane A's `rows`, `diff`, `output` and `read` down RL10 on the caller's own upstream subscription (the answer coming in
// that subscription's stream, as DX2's do), and returns its result. `endpoint.listings` answers the signed listing of
// every session on the machine the member holds `list` or more on, private ones for their owners and shares. Anything
// graded higher is an act (`act-required`); what the table doesn't offer, remote terminals and documents among it, is
// `not-offered`.
import { NO_CERTIFICATES, verifyListing, type Listing, type Signed } from 'org-protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { evs, laneAMember, makeOrg, openRemote, plane, PROJECT, sminos, startEndpoint, stopAll, subscribe, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

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

describe('a call', () => {
  it('forwards a lane B read through dispatch and returns its result', async () => {
    const f = await startEndpoint(org, started);
    const s = f.host.add('app-1');
    f.records.set({ lane: 'B', session: s.engineSessionId!, owners: ['@machine'] }, 'app-1');
    const a = await openRemote(f, org.a1, org.A);
    expect(await call(a, 'session.status', { appSessionId: 'app-1' })).toMatchObject({ ok: true, output: { launchId: s.launchId } });
    expect(await call(a, 'session.pendingItems', { appSessionId: 'app-1' })).toMatchObject({ ok: true, output: { items: [] } });
    expect(await call(a, 'session.events', { appSessionId: 'app-1', afterSeq: null, limit: null })).toMatchObject({ ok: true, output: { events: [], complete: true } });
  });

  it('refuses a read of anything graded higher (`act-required`), and remote terminals, documents and what the table lacks (`not-offered`)', async () => {
    const f = await startEndpoint(org, started);
    f.host.add('app-1');
    const a = await openRemote(f, org.a1, org.A);
    expect(await call(a, 'session.send', { appSessionId: 'app-1', content: 'hi' })).toMatchObject({ ok: false, error: { code: 'act-required' } });
    expect(await call(a, 'pty.attach', { ptyId: 'p1' })).toMatchObject({ ok: false, error: { code: 'not-offered' } });
    expect(await call(a, 'documents.open', { channel: 1 })).toMatchObject({ ok: false, error: { code: 'not-offered' } });
    // O2 grades it and brings `remoteDaemonStatus`; until then it is ungraded here.
    expect(await call(a, 'daemon.status', null)).toMatchObject({ ok: false, error: { code: 'ungraded' } });
  });

  it('sends lane A’s rows, diff, output and read down RL10 on the caller’s own upstream subscription, the answer in its stream', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f);
    const a = await openRemote(f, org.a1, org.A);
    const ask = subscribe(a, 's1', { lane: 'A', id: 'la-1' });
    const up = await s.next((x) => x.t === 'subscribe', 'the upstream subscribe');
    s.send(plane('snapshot', { rows: [], more: true, subagents: [], presence: { record: null, bridge: true }, streaming: [] }, { sub: up.sub as string, n: 0 }));
    await ask;
    expect(await call(a, 'sminos.rows', { session: 'la-1', sub: 's1', before: 'r9', limit: 50 })).toMatchObject({ ok: true });
    expect(await s.next((x) => x.t === 'rows', 'rows down')).toEqual({ t: 'rows', project: PROJECT, session: 'la-1', agentId: null, sub: up.sub, before: 'r9', limit: 50 });
    expect(await call(a, 'sminos.diff', { session: 'la-1', sub: 's1' })).toMatchObject({ ok: true });
    expect(await s.next((x) => x.t === 'diff', 'diff down')).toEqual({ t: 'diff', project: PROJECT, session: 'la-1', sub: up.sub });
    expect(await call(a, 'sminos.output', { session: 'la-1', sub: 's1', taskId: 'bash_1', tail: 4096 })).toMatchObject({ ok: true });
    expect(await s.next((x) => x.t === 'output', 'output down')).toEqual({ t: 'output', project: PROJECT, session: 'la-1', agentId: null, sub: up.sub, taskId: 'bash_1', tail: 4096 });
    expect(await call(a, 'sminos.read', { session: 'la-1', sub: 's1', id: 'q1', what: 'usage' })).toMatchObject({ ok: true });
    expect(await s.next((x) => x.t === 'read', 'read down')).toEqual({ t: 'read', project: PROJECT, session: 'la-1', agentId: null, sub: up.sub, id: 'q1', what: 'usage' });
    s.send(plane('rows', { rows: [{ uuid: 'r8' }], before: 'r9', more: false }, { sub: up.sub as string, n: 1 }));
    await until(() => evs(a, 's1').some((e) => (e.body as { kind: string }).kind === 'rows'), 'the rows answer in the stream');
    // Not a subscription of this caller's, or one on another session: nothing goes down.
    expect(await call(a, 'sminos.rows', { session: 'la-1', sub: 'nope', before: 'r9', limit: 5 })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(await call(a, 'sminos.diff', { session: 'la-1', sub: 's1', extra: 1 })).toMatchObject({ ok: false, error: { code: 'malformed' } });
  });

  it('refuses `malformed` a lane A read sminos would pass by unanswered, by sminos_plane.py’s own limits, sending nothing down', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f);
    const a = await openRemote(f, org.a1, org.A);
    const ask = subscribe(a, 's1', { lane: 'A', id: 'la-1' });
    const up = await s.next((x) => x.t === 'subscribe', 'the upstream subscribe');
    s.send(plane('snapshot', { rows: [], more: true, subagents: [], presence: { record: null, bridge: true }, streaming: [] }, { sub: up.sub as string, n: 0 }));
    await ask;
    const at = { session: 'la-1', sub: 's1' };
    const refused = [
      ['sminos.output', { ...at, taskId: 'bash_1', tail: 0 }],
      ['sminos.output', { ...at, taskId: 'bash_1', tail: 524_289 }],
      ['sminos.output', { ...at, taskId: 'a/b', tail: 10 }],
      ['sminos.output', { ...at, taskId: 'x'.repeat(65), tail: 10 }],
      ['sminos.read', { ...at, id: 'q'.repeat(65), what: 'usage' }],
      ['sminos.read', { ...at, id: 'q1', what: 'Usage' }],
      ['sminos.read', { ...at, id: 'q1', what: 'u'.repeat(33) }],
      ['sminos.read', { ...at, id: 'q1', what: 'usage', args: { text: 'y'.repeat(4096) } }],
      ['sminos.rows', { ...at, before: 'r9', limit: 0 }],
      // Under 4096 as JavaScript writes them, over it as Python's json.dumps does: `1e-07`, and DEL escaped `\u007f`.
      ['sminos.read', { ...at, id: 'q1', what: 'usage', args: { n: Array.from({ length: 600 }, () => 1e-7) } }],
      ['sminos.read', { ...at, id: 'q1', what: 'usage', args: { text: '\u007f'.repeat(700) } }],
    ] as const;
    for (const [name, input] of refused) expect(await call(a, name, input), `${name} ${JSON.stringify(input).slice(0, 80)}`).toMatchObject({ ok: false, error: { code: 'malformed' } });
    // At the limits, each goes down.
    expect(await call(a, 'sminos.output', { ...at, taskId: 'x'.repeat(64), tail: 524_288 })).toMatchObject({ ok: true });
    expect(await call(a, 'sminos.read', { ...at, id: 'q'.repeat(64), what: 'u'.repeat(32), args: { text: 'y'.repeat(4070) } })).toMatchObject({ ok: true });
    await s.next((x) => x.t === 'read', 'the read at its limits');
    // Python writes 0.00001 shorter (`1e-05`): 550 of them fit under its count though not under JavaScript's.
    expect(await call(a, 'sminos.read', { ...at, id: 'q2', what: 'usage', args: { n: Array.from({ length: 550 }, () => 0.00001) } })).toMatchObject({ ok: true });
    await s.next((x) => x.t === 'read', 'the read Python measures under its limit');
    expect(s.received.filter((x) => x.t === 'output' || x.t === 'read' || x.t === 'rows')).toHaveLength(3);
  });
});

describe('endpoint.listings', () => {
  it('answers each member the signed listing of every session they hold list or more on, private ones only to their owners and shares', async () => {
    const f = await startEndpoint(org, started);
    await sminos(f, [
      laneAMember(),
      laneAMember({ session: 'la-private', owners: [org.A], access: 'private', title: 'secret' }),
      laneAMember({ session: 'la-shared', owners: [org.A], access: 'private', shares: [{ member: org.B, grade: 'view' }], title: 'shared' }),
    ]);
    const sessionsOf = async (r: Remote) => {
      const result = await call(r, 'endpoint.listings', null);
      expect(result).toMatchObject({ ok: true });
      const records = (result.output as { listings: Signed<Listing>[] }).listings;
      for (const record of records) expect(await verifyListing(f.chain.at(-1)!.state, record, NO_CERTIFICATES, new Date())).toMatchObject({ ok: true });
      return records.map((r) => r.body.session).sort();
    };
    expect(await sessionsOf(await openRemote(f, org.a1, org.A))).toEqual(['la-1', 'la-private', 'la-shared']);
    expect(await sessionsOf(await openRemote(f, org.b1, org.B))).toEqual(['la-1', 'la-shared']);
    const owned = (await call(await openRemote(f, org.a1, org.A), 'endpoint.listings', null)).output as { listings: Signed<Listing>[] };
    expect(owned.listings.find((r) => r.body.session === 'la-private')!.body.fields).toMatchObject({ owners: [org.A], title: 'secret', lane: 'A' });
  });
});
