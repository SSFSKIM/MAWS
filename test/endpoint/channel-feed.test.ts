// The project channel's to-human entries across machines at the endpoint (P5 O8 M7b,
// docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7b, Interfaces §O). Lane A's entries are sminos's sub-less
// RL10 host messages, handed to the spine's journal beside notify and before the durable host mark (rl10/link.ts), and a
// resend records nothing new. A remote member reads a project's entries through `channel.history` (an `each-session` row,
// admitted at `list`) only for the sessions they may `view`, ranked lane by lane: a lane A entry by its engine session
// through sminos's member record, a lane B entry by its app session's placement in the spine's record.
//
// A real journal (the spine's `startChannel` over a real index in a temporary directory) behind a real endpoint, a fake
// sminos on its RL10 socket, and devices on real channels.
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { gradeOf } from '@shared/ipc/grades';
import type { HostEntry, NewHostEntry } from '@shared/ipc/schema/channel';
import { OFFERS } from '../../src/endpoint/offers';
import { EndpointState } from '../../src/endpoint/state/store';
import { startChannel, type ProjectChannel } from '../../src/services/channel/register';
import { Index } from '../../src/services/index/index';
import { tempDir } from '../support/index-fixture';
import { fakeServices } from './fake-services';
import { laneAMember, makeOrg, openRemote, plane, PROJECT, sminos, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];
const disposals: Array<() => void> = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  await stopAll(started);
  for (const dispose of disposals.splice(0)) dispose();
});
afterAll(() => stopAll(started));

/** The spine's project channel over a real index, as `mawsd` hands it to the endpoint: its journal, `channel.history`, `channel.changed`. */
function journal(f: Fixture): ProjectChannel & { index: Index } {
  const dir = tempDir('channel-feed-');
  const index = new Index(join(dir.path, 'index.sqlite'));
  const channel = startChannel({
    index,
    onEvent: (() => () => {}) as never,
    onEmitted: (() => () => {}) as never,
    register: ((name: string, handler: (input: unknown) => unknown) => f.spine.handle(name, (input) => handler(input))) as never,
    emit: ((name: string, payload: unknown) => (f.host.emitMachine(name, payload), true)) as never,
    log: () => {},
  });
  f.services.channel = channel;
  disposals.push(() => {
    channel.stop();
    index.close();
    dir.dispose();
  });
  return Object.assign(channel, { index });
}

const AT = Date.parse('2026-11-06T10:00:00.000Z');
const at = (minute: number) => new Date(AT + minute * 60_000).toISOString();

/** A sminos host event of session `session`, as RL10 carries it (body `{id, event}`). */
function host(session: string, seq: number, event: Record<string, unknown>, project = PROJECT): Record<string, unknown> {
  const writer = `mini/${session}`;
  const message = plane('host', { id: { writer, seq }, event: { ts: at(seq), writer, seq, from: 'main', ...event } }, { session });
  return { ...message, message: { ...(message.message as Record<string, unknown>), project } };
}

/** A lane B entry, as the spine's lane B source records one. */
function laneB(appSessionId: string, minute: number, text: string): NewHostEntry {
  return { project: PROJECT, appSessionId: appSessionId as never, engineSessionId: `eng-${appSessionId}` as never, lane: 'B', kind: 'message', text, at: at(minute), src: `${PROJECT}/lane-b/${appSessionId}/call/t${minute}` };
}

/** A lane B session in the spine's record, the machine's owners', shared with B at `share` (null: listed, below `view`). */
function shared(f: Fixture, appSessionId: string, share: 'view' | null): void {
  if (!f.spine.records.has(appSessionId)) f.spine.set(appSessionId, `eng-${appSessionId}`, { appId: appSessionId });
  f.records.set({ lane: 'B', session: `eng-${appSessionId}`, owners: ['@machine'], ...(share === null ? {} : { shares: [{ member: org.B, grade: share }] }) }, appSessionId);
}

/** Lane A's second session, `la-2`, listed unless shared with B at `share`. */
const second = (share: 'view' | null) => laneAMember({ session: 'la-2', alias: 'second', title: 'second', launch: 'L2', ...(share === null ? {} : { shares: [{ member: org.B, grade: share }] }) });
/** Lane A's sessions: `la-1` listed (B holds `list`, below `view`), `la-2` shared with B at `view`. */
const laneAMembers = () => [laneAMember(), second('view')];

async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}

const texts = (answer: Msg) => ((answer.output as { entries: HostEntry[] }).entries ?? []).map((entry) => entry.text);

describe('lane A’s host messages, handed to the journal', () => {
  it('journals each of sminos’s host kinds as it arrives, beside notify, with its project, its session and its src', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f);
    s.send(host('la-1', 1, { kind: 'message', to: 'host', text: 'the build is green', src: 'u#0' }));
    s.send(host('la-1', 2, { kind: 'question', to: 'host', text: ['Which?', 'And why?'], choices: ['A', 'B'], src: 'toolu_q' }));
    s.send(host('la-1', 3, { kind: 'answered', text: 'A', src: 'toolu_q' }));
    s.send(host('la-1', 4, { kind: 'lifecycle', text: 'not a host kind' }));
    await until(() => f.services.recorded.length >= 3, 'three entries');
    const src = (seq: number) => `${PROJECT}/mini%2Fla-1/${seq}`;
    expect(f.services.recorded).toEqual([
      { project: PROJECT, appSessionId: null, engineSessionId: 'la-1', lane: 'A', kind: 'message', text: 'the build is green', at: at(1), src: src(1) },
      { project: PROJECT, appSessionId: null, engineSessionId: 'la-1', lane: 'A', kind: 'question', text: 'Which?\n\nAnd why?', choices: ['A', 'B'], at: at(2), src: src(2) },
      { project: PROJECT, appSessionId: null, engineSessionId: 'la-1', lane: 'A', kind: 'answered', text: 'A', at: at(3), src: src(3) },
    ]);
  });

  it('journals a message the durable host mark already holds, and the journal keeps a resend once', async () => {
    // The hub was told of la-1's first five host events before a restart (the mark moved): sminos's resend of the last 50
    // notifies nothing, and is journaled all the same.
    const services = fakeServices();
    EndpointState.open(services.machine.stateDir).setHosts({ [PROJECT]: { 'mini/la-1': 5 } });
    const f = await startEndpoint(org, started, { services });
    const channel = journal(f);
    const s = await sminos(f);
    const entries = () => channel.index.channel.history({ project: PROJECT, limit: 10 }, Date.now()).entries.map((e) => [e.text, e.src]);
    const done = host('la-1', 1, { kind: 'message', to: 'host', text: 'done', src: 'u#0' });
    s.send(done);
    s.send(done);
    s.send(host('la-1', 6, { kind: 'message', to: 'host', text: 'next', src: 'u#1' }));
    await until(() => entries().length === 2, 'the two entries');
    s.send(done);
    s.send(host('la-1', 7, { kind: 'message', to: 'host', text: 'last', src: 'u#2' }));
    await until(() => entries().length === 3, 'the last entry');
    expect(entries()).toEqual([
      ['last', `${PROJECT}/mini%2Fla-1/7`],
      ['next', `${PROJECT}/mini%2Fla-1/6`],
      ['done', `${PROJECT}/mini%2Fla-1/1`],
    ]);
  });
});

describe('channel.history, view-filtered lane by lane', () => {
  it('is offered as a machine call under the `each-session` rule, admitted at `list` and cut at `view`', () => {
    expect(OFFERS.commands['channel.history']).toEqual({ kind: 'call', executor: 'machine', target: 'each-session', grade: 'list' });
    expect(gradeOf('channel.history')).toBe('view');
  });

  it('answers a member the entries of the sessions they view, a lane A one by sminos’s record and a lane B one by the spine’s, and the machine’s owner every one', async () => {
    const f = await startEndpoint(org, started);
    const channel = journal(f);
    const s = await sminos(f, laneAMembers());
    shared(f, 'app-1', 'view');
    shared(f, 'app-2', null);
    s.send(host('la-1', 1, { kind: 'message', to: 'host', text: 'A listed' }));
    s.send(host('la-2', 2, { kind: 'question', to: 'host', text: ['A shared?'], choices: ['yes'] }));
    await until(() => channel.index.channel.history({ project: PROJECT, limit: 10 }, Date.now()).entries.length === 2, 'lane A’s entries');
    channel.record(laneB('app-1', 3, 'B shared'));
    channel.record(laneB('app-2', 4, 'B listed'));
    channel.record(laneB('app-9', 5, 'B unrecorded'));
    const [a, b] = [await openRemote(f, org.a1, org.A), await openRemote(f, org.b1, org.B)];

    expect(texts(await call(b, 'channel.history', { project: PROJECT }))).toEqual(['B shared', 'A shared?']);
    expect(texts(await call(a, 'channel.history', { project: PROJECT }))).toEqual(['B listed', 'B shared', 'A shared?', 'A listed']);
    expect(await call(b, 'channel.history', { project: PROJECT })).toMatchObject({ ok: true, output: { more: false } });

    // A share withdrawn on each lane: the next answer leaves its entries out.
    s.send({ t: 'member', ...second(null) });
    shared(f, 'app-1', null);
    await until(() => f.endpoint.rl10.members.get('la-2')?.shares === undefined, 'la-2’s share withdrawn');
    expect(texts(await call(b, 'channel.history', { project: PROJECT }))).toEqual([]);

    // The registry's schema, though the row carries its own grade.
    expect(await call(b, 'channel.history', { project: PROJECT, limit: 201 })).toMatchObject({ ok: false, error: { code: 'malformed' } });
    expect(await call(b, 'channel.history', { project: PROJECT, extra: 1 })).toMatchObject({ ok: false, error: { code: 'malformed' } });
  });

  it('fills a page with the entries the member views, past a full page of others’, and pages on from its last', async () => {
    const f = await startEndpoint(org, started);
    const channel = journal(f);
    shared(f, 'app-1', 'view');
    shared(f, 'app-2', null);
    channel.record(laneB('app-1', 1, 'mine 1'));
    channel.record(laneB('app-1', 2, 'mine 2'));
    channel.record(laneB('app-1', 3, 'mine 3'));
    for (let i = 0; i < 250; i++) channel.record({ ...laneB('app-2', 10 + i, `other ${i}`) });
    const b = await openRemote(f, org.b1, org.B);

    const first = await call(b, 'channel.history', { project: PROJECT, limit: 2 });
    expect(first).toMatchObject({ ok: true, output: { more: true } });
    expect(texts(first)).toEqual(['mine 3', 'mine 2']);
    const last = (first.output as { entries: HostEntry[] }).entries[1].id;
    const second = await call(b, 'channel.history', { project: PROJECT, limit: 2, before: last });
    expect(second).toMatchObject({ ok: true, output: { more: false } });
    expect(texts(second)).toEqual(['mine 1']);
  });
});
