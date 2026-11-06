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
import { successor } from './org-fixtures';
import { evs, laneAMember, makeOrg, of, openRemote, plane, PROJECT, sminos, snapshot, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

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

const OTHER = 'proj-other';
/** The org's hub projects: the channel's, and another. */
const PROJECTS = [
  { id: PROJECT, name: 'm8' },
  { id: OTHER, name: 'other' },
];
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** The `channel` feed of `project` opened (its `subbed`, or its `ended`). */
async function channelFeed(r: Remote, sub: string, project: string, credit = 4 * 1024 * 1024): Promise<Msg> {
  const from = r.inbox.length;
  await r.channel.send({ t: 'sub', sub, feed: 'channel', project, cursor: null, credit });
  return waitFor(r, (m) => m.sub === sub && (m.t === 'subbed' || m.t === 'ended'), `the answer to channel feed ${sub}`, from);
}
/** The texts of the entries each `changed` frame of the feed carried, in order. */
const changed = (r: Remote, sub: string) => evs(r, sub).map((e) => (e.body as { entry: HostEntry }).entry.text);
/** Waits until the journal holds `n` entries of `project`. */
const journaled = (channel: ReturnType<typeof journal>, n: number, project = PROJECT) => until(() => channel.index.channel.history({ project, limit: 200 }, Date.now()).entries.length >= n, `${n} entries of ${project}`);

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
    const f = await startEndpoint(org, started, { projects: PROJECTS });
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
    const f = await startEndpoint(org, started, { projects: PROJECTS });
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
  it('answers nothing for a project the org has none of, or one that left its head', async () => {
    const f = await startEndpoint(org, started, { projects: PROJECTS });
    const channel = journal(f);
    shared(f, 'app-1', 'view');
    channel.record(laneB('app-1', 1, 'B shared'));
    channel.record({ ...laneB('app-1', 2, 'B unknown'), project: 'proj-unknown', src: 'proj-unknown/lane-b/app-1/call/t2' });
    const b = await openRemote(f, org.b1, org.B);
    expect(await call(b, 'channel.history', { project: 'proj-unknown' })).toMatchObject({ ok: true, output: { entries: [], more: false } });
    expect(texts(await call(b, 'channel.history', { project: PROJECT }))).toEqual(['B shared']);
    const next = await successor(f.chain[f.chain.length - 1], [org.a1], (st) => void (st.projects = st.projects.filter((p) => p.id !== PROJECT)));
    const out = await f.endpoint.cli('revoke', ['-'], JSON.stringify(next));
    expect(out.code, out.out).toBe(0);
    f.chain.push(next);
    expect(await call(b, 'channel.history', { project: PROJECT })).toMatchObject({ ok: true, output: { entries: [], more: false } });
  });

  it('names each entry by an opaque cursor, the feed’s as history’s, and pages nothing from one it didn’t give the member, one placement read whatever it is', async () => {
    const f = await startEndpoint(org, started, { projects: PROJECTS });
    const channel = journal(f);
    shared(f, 'app-1', 'view');
    shared(f, 'app-2', null);
    channel.record(laneB('app-2', 1, 'hidden'));
    channel.record(laneB('app-1', 2, 'mine 1'));
    channel.record(laneB('app-1', 3, 'mine 2'));
    const [a, b] = [await openRemote(f, org.a1, org.A), await openRemote(f, org.b1, org.B)];

    const first = await call(b, 'channel.history', { project: PROJECT, limit: 1 });
    expect(first).toMatchObject({ ok: true, output: { more: true } });
    const [mine] = (first.output as { entries: HostEntry[] }).entries;
    expect(mine.text).toBe('mine 2');
    expect(mine.id).not.toMatch(/^[0-9]+$/);
    await channelFeed(b, 'ch', PROJECT);
    expect(((await snapshot(b, 'ch')).body.entries as HostEntry[]).map((e) => [e.text, e.id])[0]).toEqual(['mine 2', mine.id]);

    const hidden = (await call(a, 'channel.history', { project: PROJECT })).output as { entries: HostEntry[] };
    const theirs = hidden.entries.find((e) => e.text === 'hidden')!.id;
    const placements = () => f.host.calls.filter((c) => c.name === 'session.get').length;
    for (const before of [theirs, '1', '3', `${mine.id.slice(0, -2)}xx`]) {
      const from = placements();
      expect(await call(b, 'channel.history', { project: PROJECT, before }), before).toMatchObject({ ok: true, output: { entries: [], more: false } });
      expect(placements() - from, before).toBe(1);
    }
    const second = await call(b, 'channel.history', { project: PROJECT, before: mine.id });
    expect(second).toMatchObject({ ok: true, output: { more: false } });
    expect(texts(second)).toEqual(['mine 1']);
  });
});

describe('the channel feed: a project’s entries, live', () => {
  it('opens as a snapshot of the project’s newest entries the member views, then carries each of its new entries they view, and no other project’s', async () => {
    const f = await startEndpoint(org, started, { projects: PROJECTS });
    const channel = journal(f);
    const s = await sminos(f, laneAMembers());
    shared(f, 'app-1', 'view');
    shared(f, 'app-2', null);
    channel.record(laneB('app-1', 1, 'before B'));
    channel.record(laneB('app-2', 2, 'before hidden'));
    s.send(host('la-2', 3, { kind: 'message', to: 'host', text: 'before A' }));
    await journaled(channel, 3);
    const [b, idle] = [await openRemote(f, org.b1, org.B), await openRemote(f, org.a1, org.A)];

    expect(await channelFeed(b, 'ch', PROJECT)).toMatchObject({ t: 'subbed', mode: 'snapshot', seq: 0 });
    const snap = await snapshot(b, 'ch');
    expect(snap.body).toMatchObject({ more: false });
    expect((snap.body.entries as HostEntry[]).map((e) => e.text)).toEqual(['before A', 'before B']);

    s.send(host('la-1', 10, { kind: 'message', to: 'host', text: 'A listed' }));
    s.send(host('la-2', 11, { kind: 'question', to: 'host', text: ['A shared?'], choices: ['yes', 'no'] }));
    s.send(host('la-2', 12, { kind: 'message', to: 'host', text: 'A elsewhere' }, OTHER));
    await journaled(channel, 5);
    await journaled(channel, 1, OTHER);
    channel.record(laneB('app-2', 13, 'B listed'));
    channel.record(laneB('app-1', 14, 'B shared'));
    channel.record({ ...laneB('app-1', 15, 'B elsewhere'), project: OTHER, src: `${OTHER}/lane-b/app-1/call/t15` });
    await until(() => changed(b, 'ch').length >= 2, 'the two changes');
    await settle();
    expect(changed(b, 'ch')).toEqual(['A shared?', 'B shared']);
    expect(evs(b, 'ch').map((e) => e.seq)).toEqual([1, 2]);
    expect((evs(b, 'ch')[0].body as { entry: HostEntry }).entry).toMatchObject({ lane: 'A', kind: 'question', choices: ['yes', 'no'], engineSessionId: 'la-2', appSessionId: null, project: PROJECT });
    // An older device, or one that holds no feed, hears nothing pushed: it reads `channel.history`.
    expect(idle.inbox.filter((m) => (m as Msg).t === 'ev' || (m as Msg).t === 'snap')).toEqual([]);
  });

  it('takes back an entry queued while the device read nothing once its share goes, on either lane, and goes on', async () => {
    const f = await startEndpoint(org, started, { projects: PROJECTS });
    const channel = journal(f);
    const s = await sminos(f, laneAMembers());
    shared(f, 'app-1', 'view');
    const b = await openRemote(f, org.b1, org.B);
    await channelFeed(b, 'ch', PROJECT, 1);
    await snapshot(b, 'ch'); // the snapshot spends the credit: what follows is queued, not taken
    s.send(host('la-2', 1, { kind: 'message', to: 'host', text: 'queued A' }));
    await journaled(channel, 1);
    await settle();
    expect(changed(b, 'ch')).toEqual([]);
    s.send({ t: 'member', ...second(null) }); // la-2's share goes before the device takes its entry
    await until(() => f.endpoint.rl10.members.get('la-2')?.shares === undefined, 'la-2’s share withdrawn');
    await settle();
    channel.record(laneB('app-1', 2, 'B kept'));
    await b.channel.send({ t: 'credit', sub: 'ch', bytes: 1024 * 1024 });
    await until(() => changed(b, 'ch').length >= 1, 'the next change');
    await settle();
    expect(changed(b, 'ch')).toEqual(['B kept']);

    // Lane B's share goes: its next entry stops, and the feed lives on.
    shared(f, 'app-1', null);
    channel.record(laneB('app-1', 3, 'B after'));
    s.send({ t: 'member', ...second('view') });
    await until(() => f.endpoint.rl10.members.get('la-2')?.shares !== undefined, 'la-2 shared again');
    s.send(host('la-2', 4, { kind: 'message', to: 'host', text: 'A again' }));
    await until(() => changed(b, 'ch').length >= 2, 'lane A’s entry');
    await settle();
    expect(changed(b, 'ch')).toEqual(['B kept', 'A again']);
    expect(of(b, 'ch').filter((m) => m.t === 'ended')).toEqual([]);
  });

  it('ends `removed` once the project leaves the org’s head, and is refused for a project the org has none of', async () => {
    const f = await startEndpoint(org, started, { projects: PROJECTS });
    journal(f);
    const b = await openRemote(f, org.b1, org.B);
    expect(await channelFeed(b, 'none', 'proj-unknown')).toMatchObject({ t: 'ended', reason: 'no-target' });
    expect(await channelFeed(b, 'ch', PROJECT)).toMatchObject({ t: 'subbed' });
    await snapshot(b, 'ch');
    const next = await successor(f.chain[f.chain.length - 1], [org.a1], (st) => void (st.projects = st.projects.filter((p) => p.id !== PROJECT)));
    const out = await f.endpoint.cli('revoke', ['-'], JSON.stringify(next));
    expect(out.code, out.out).toBe(0);
    f.chain.push(next);
    expect(await waitFor(b, (m) => m.sub === 'ch' && m.t === 'ended', 'the feed’s end')).toMatchObject({ reason: 'removed' });
  });

  it('is offered behind `rl2.channel`, refused to a web-cards device, and a sub that names no project closes the channel `malformed`', async () => {
    const { ENDPOINT_CAPABILITIES } = await import('../../src/endpoint/capabilities');
    expect(ENDPOINT_CAPABILITIES).toContain('rl2.channel');
    expect(OFFERS.feeds).toContain('channel');
    const f = await startEndpoint(org, started, { projects: PROJECTS });
    journal(f);
    const c = await openRemote(f, org.c1, org.C, { passkey: org.passkey });
    expect(await channelFeed(c, 'ch', PROJECT)).toMatchObject({ t: 'ended', reason: 'class' });
    const b = await openRemote(f, org.b1, org.B);
    let closed: string | null = null;
    b.channel.onClose((reason) => void (closed = reason));
    await b.channel.send({ t: 'sub', sub: 'bare', feed: 'channel', cursor: null, credit: 1024 });
    await until(() => closed, 'the channel’s close');
    expect(closed).toBe('malformed');
  });
  it('takes back a queued lane B entry once its session’s record is removed, and the next entry takes its seq', async () => {
    const f = await startEndpoint(org, started, { projects: PROJECTS });
    const channel = journal(f);
    const s = await sminos(f, laneAMembers());
    shared(f, 'app-1', 'view');
    const b = await openRemote(f, org.b1, org.B);
    await channelFeed(b, 'ch', PROJECT, 1);
    await snapshot(b, 'ch'); // the snapshot spends the credit: what follows is queued, not taken
    channel.record(laneB('app-1', 1, 'queued B'));
    await settle();
    f.spine.records.delete('app-1');
    f.host.emitMachine('session.removed', { appSessionId: 'app-1', revision: 2 });
    await settle();
    s.send(host('la-2', 2, { kind: 'message', to: 'host', text: 'next A' }));
    await journaled(channel, 2);
    await b.channel.send({ t: 'credit', sub: 'ch', bytes: 1024 * 1024 });
    await until(() => changed(b, 'ch').length >= 1, 'the next change');
    await settle();
    expect(changed(b, 'ch')).toEqual(['next A']);
    expect(evs(b, 'ch').map((e) => e.seq)).toEqual([1]);
  });

  it('ranks a new lane B entry by its session’s record as it stands, not a placement it read before the record moved', async () => {
    const f = await startEndpoint(org, started, { projects: PROJECTS });
    const channel = journal(f);
    const s = await sminos(f, laneAMembers());
    shared(f, 'app-1', 'view');
    const b = await openRemote(f, org.b1, org.B);
    await channelFeed(b, 'ch', PROJECT);
    await snapshot(b, 'ch');
    channel.record(laneB('app-1', 1, 'B first'));
    await until(() => changed(b, 'ch').length >= 1, 'the first change');
    f.spine.set('app-1', 'eng-private', { appId: 'app-1' }); // moved to a private engine; its `session.changed` not yet heard
    channel.record(laneB('app-1', 2, 'after the move'));
    s.send(host('la-2', 3, { kind: 'message', to: 'host', text: 'next A' }));
    await until(() => changed(b, 'ch').length >= 2, 'the next change');
    await settle();
    expect(changed(b, 'ch')).toEqual(['B first', 'next A']);
  });
});
