// Reader state and drafts per member over RL2 (P5 O8 M6a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// Interfaces §P; the architect's rulings on `session.reader.update`), through the real gate and the real index behind
// the machine's dispatch: the endpoint names each channel's reader from the machine's owners (the owners' for one of
// them, the caller's own member id for anyone else), never from the request, and every record it sends a member carries
// that member's own pinned, last seen and unread, or none where they have no row.
//
// The org: A owns the machine (a1); B is a member with two devices (b1, b2); D is another member (d1). Each case's lane
// B session is shared with B (and D) at the grade the case names; the machine's owners' reading is the session row's.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as z from 'zod';
import type { Listing, Signed } from 'org-protocol';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { REGISTRY } from '@shared/ipc/registry';
import { STALE_DRAFT_WORDS } from '@shared/ipc/schema/session';
import { WITHHELD_ATTACHMENTS } from '@shared/sessions/draft-fit';
import { OFFERS } from '../../src/endpoint/offers';
import { PlaneFeeds, type OwnersRead } from '../../src/endpoint/plane-feeds';
import type { Subscription } from '../../src/endpoint/subscriptions';
import { CheckoutBounds } from '../../src/endpoint/targets';
import { PromptHistory } from '../../src/services/history/prompt-history';
import { Index } from '../../src/services/index/index';
import { registerIndexHandlers } from '../../src/services/index/register';
import { startSessions } from '../../src/services/sessions';
import { ev } from '../support/events';
import { fakeBus } from '../support/fake-bus';
import { summary } from '../support/index-fixture';
import { endorsed, memberId, newDevice, successor, type TestDevice } from './org-fixtures';
import { act, done, evs, laneAMember, makeOrg, openRemote, ORG, sminos, snapshot, startEndpoint, stopAll, subscribe, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
let b2: TestDevice;
let d1: TestDevice;
let D: string;
const started: Fixture[] = [];
const indexes: Index[] = [];
const dirs: string[] = [];
const stops: Array<() => void> = [];

beforeAll(async () => {
  org = await makeOrg();
  b2 = await endorsed(ORG, org.B, await newDevice('b2'), org.b1);
  D = memberId();
  d1 = await newDevice('d1');
});
afterEach(async () => {
  await stopAll(started);
  for (const stop of stops.splice(0)) stop();
  for (const index of indexes.splice(0)) index.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(() => stopAll(started));

type Grade = 'list' | 'view' | 'converse';
const AT = '2026-11-07T10:00:00.000Z';
const LATER = '2026-11-07T11:00:00.000Z';
/** A reader with no row: unpinned, read, never seen. */
const NONE = { pinned: false, unread: false, lastSeen: { messageUuid: null, at: null } };
const readerFields = (record: Record<string, unknown>) => ({ pinned: record.pinned, unread: record.unread, lastSeen: record.lastSeen });
/** Every object in `value` that holds a reader field (`unread`, `lastSeen`), as its reading. */
function readingsIn(value: unknown, found: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(value)) for (const item of value) readingsIn(item, found);
  else if (typeof value === 'object' && value !== null) {
    const fields = value as Record<string, unknown>;
    if ('unread' in fields || 'lastSeen' in fields) found.push(readerFields(fields));
    for (const item of Object.values(fields)) readingsIn(item, found);
  }
  return found;
}

/** The machine, its index the real one behind `dispatch('machine', …)`, and one lane B session shared with B (and others). */
async function machine(grade: Grade = 'view', others: Array<{ member: string; grade: Grade }> = []): Promise<{ f: Fixture; index: Index; app: AppSessionId }> {
  const f = await startEndpoint(org, started, {
    limits: { perSource: { burst: 100, perMinute: 6_000 }, overall: { burst: 100, perMinute: 6_000 } }, // four devices at once, from loopback
    amend: (s) => {
      s.members.find((m) => m.id === org.B)!.devices.push(b2.device);
      s.members.push({ id: D, email: 'd@example.com', role: 'member', devices: [d1.device] });
    },
  });
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'reader-state-')));
  dirs.push(dir);
  const index = new Index(join(dir, 'index.sqlite'));
  indexes.push(index);
  registerIndexHandlers(index, f.spine.bus as never);
  f.spine.handle('git.worktree.list', () => {
    throw new Error('not a git repository'); // a checkout feed's bounds: the session's directory is in none
  });
  const record = index.sessions.upsertFromSummary(summary()).record;
  f.spine.set(record.appId, record.engineSessionId, { appId: record.appId });
  f.records.set({ lane: 'B', session: record.engineSessionId!, owners: ['@machine'], shares: [{ member: org.B, grade }, ...others] }, record.appId);
  return { f, index, app: record.appId };
}

/** The owners' reading, set on the session row: pinned, seen at `m1`, unread since. */
function ownersRead(index: Index, app: AppSessionId): Record<string, unknown> {
  index.sessions.setPinned(app, true);
  index.sessions.markSeen(app, { messageUuid: 'm1' as MessageUuid, at: AT });
  index.sessions.setUnread(app, true);
  return { pinned: true, unread: true, lastSeen: { messageUuid: 'm1', at: AT } };
}

/**
 * The machine's app events and prompt history for `app`, as the spine answers them: `session.appEvents` by the sessions
 * service itself (its read model holding the record, an app-synthesised notice emitted on its bus), and
 * `session.history.list` by spine-root's handler over a real prompt history with two prompts appended.
 */
async function historyOf(f: Fixture, index: Index, app: AppSessionId): Promise<{ notice: unknown; prompts: string[] }> {
  const bus = fakeBus();
  const sessions = startSessions({ env: {}, packaged: false, appRoot: process.cwd(), bus, hosts: { dispatch: async () => ({ ok: true, value: null }) as never, onEvent: () => () => {}, onState: () => () => {}, setResync: () => {} } });
  stops.push(() => sessions.stop());
  stops.push(sessions.model.register({ start: (writer) => (writer.observeRecord(index.sessions.get(app)!), () => {}) }));
  const notice = ev('notice.posted', { id: `${app}:c10:relay-fallback:1`, seq: null, level: 'warning', key: 'relay:direct_fallback', text: 'Direct.' });
  expect(bus.emit('session.eventBatch', { appSessionId: app, events: [notice] })).toBe(true);
  f.spine.handle('session.appEvents', async (input) => {
    const answer = await bus.invoke('session.appEvents', input);
    if (!answer.ok) throw new Error(answer.error.message);
    return answer.value;
  });
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'reader-history-')));
  dirs.push(dir);
  const history = new PromptHistory({ file: join(dir, 'prompt-history.jsonl'), configDir: dir, session: (id) => (id === app ? index.sessions.get(app)! : null) });
  const prompts = ['the first prompt', 'the second prompt'];
  for (const display of prompts) await history.append(app, display, {});
  f.spine.handle('session.history.list', async (input) => {
    const { appSessionId, limit } = input as { appSessionId: AppSessionId; limit: number };
    return { entries: await history.list(appSessionId, limit) };
  });
  return { notice, prompts };
}

/** A successor head, delivered: the machine's owners become `owners` (A signs; every other member keeps their shares). */
async function giveMachine(f: Fixture, owners: string[]): Promise<void> {
  const next = await successor(f.chain.at(-1)!, [org.a1], (s) => void (s.machines.find((m) => m.ref === f.ref)!.owners = owners));
  const delivered = await f.endpoint.cli('revoke', ['-'], JSON.stringify(next));
  expect(delivered.code, delivered.out).toBe(0);
  f.chain.push(next);
}

async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}
const code = (m: Msg) => (m.ok === true ? 'ok' : (m.error as { code: string }).code);
const output = (m: Msg) => {
  expect(m).toMatchObject({ ok: true });
  return m.output as Record<string, unknown>;
};
/** A machine act from `r`, as its device seals it; its ack's word, and its outcome when accepted. */
async function machineAct(f: Fixture, r: Remote, name: string, args: Record<string, unknown>): Promise<{ ack: string; outcome?: unknown }> {
  const action = r.device.action({ machine: f.ref, action: name, args });
  const from = r.inbox.length;
  const ack = await act(r, action);
  return ack === 'ok' ? { ack, outcome: await done(r, action, from) } : { ack };
}
const draft = (text: string) => ({ doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, attachments: [], updatedAt: AT });

async function feed(r: Remote, sub: string, app: string): Promise<void> {
  const from = r.inbox.length;
  await r.channel.send({ t: 'sub', sub, feed: 'checkout', session: { lane: 'B', id: app }, cursor: null, credit: 4 * 1024 * 1024 });
  expect(await waitFor(r, (m) => m.sub === sub && (m.t === 'subbed' || m.t === 'ended'), `the answer to feed ${sub}`, from)).toMatchObject({ t: 'subbed' });
}
/** The `session.changed` payloads a feed carried. */
const changes = (r: Remote, sub: string) =>
  evs(r, sub)
    .map((e) => e.body as { name: string; payload: { record: Record<string, unknown>; cause: string; revision: number } })
    .filter((body) => body.name === 'session.changed')
    .map((body) => body.payload);

describe('whose row a reader’s update writes (the architect’s ruling 1)', () => {
  it('writes an owner’s on the session row and no member’s row, a member’s on their own row and nowhere else, each answered as ReaderState', async () => {
    const { f, index, app } = await machine('view', [{ member: D, grade: 'view' }]);
    const [a, b] = [await openRemote(f, org.a1, org.A), await openRemote(f, org.b1, org.B)];

    expect(output(await call(b, 'session.reader.update', { appSessionId: app, patch: { pinned: true, lastSeen: { messageUuid: 'm7', at: AT } } }))).toEqual({
      appSessionId: app,
      pinned: true,
      unread: false,
      lastSeen: { messageUuid: 'm7', at: AT },
    });
    expect(readerFields(index.sessions.get(app)!)).toEqual(NONE); // the owners' untouched
    expect(readerFields(index.sessions.get(app, D)!)).toEqual(NONE); // and another member's

    expect(output(await call(a, 'session.reader.update', { appSessionId: app, patch: { unread: true } }))).toEqual({ appSessionId: app, ...NONE, unread: true });
    expect(readerFields(index.sessions.get(app)!)).toEqual({ ...NONE, unread: true });
    expect(readerFields(index.sessions.get(app, org.B)!)).toEqual({ pinned: true, unread: false, lastSeen: { messageUuid: 'm7', at: AT } }); // B's as B left it
    expect(readerFields(index.sessions.get(app, org.A)!)).toEqual(NONE); // an owner's write is never a member row
    // The reader went with each dispatch, the request naming none.
    expect(f.host.calls.filter((c) => c.name === 'session.reader.update').map((c) => c.reader)).toEqual([org.B, 'owner']);
  });

  it('answers a list-only caller the four ReaderState fields and nothing else of the record', async () => {
    const { f, app } = await machine('list');
    const b = await openRemote(f, org.b1, org.B);
    const answer = output(await call(b, 'session.reader.update', { appSessionId: app, patch: { pinned: true } }));
    expect(Object.keys(answer).sort()).toEqual(['appSessionId', 'lastSeen', 'pinned', 'unread']);
    expect(code(await call(b, 'session.get', { appSessionId: app }))).toBe('grade'); // the record itself is `view`
  });
});

describe('what a remote reader may send', () => {
  it('refuses a patch that mixes reader fields with the owners’ `malformed`, on its raw args, before the machine hears it', async () => {
    const { f, index, app } = await machine('converse');
    const [a, b] = [await openRemote(f, org.a1, org.A), await openRemote(f, org.b1, org.B)];
    const mixed = [{ pinned: true, archived: true }, { unread: false, title: null }, { lastSeen: { messageUuid: 'm2', at: AT }, title: 'mine' }, {}];
    for (const r of [a, b]) for (const patch of mixed) expect(code(await call(r, 'session.reader.update', { appSessionId: app, patch })), JSON.stringify(patch)).toBe('malformed');
    expect(f.host.calls.filter((c) => c.name === 'session.reader.update')).toEqual([]);
    expect(index.sessions.get(app)).toMatchObject({ ...NONE, archived: false });
    expect(readerFields(index.sessions.get(app, org.B)!)).toEqual(NONE);
    // `session.update` (the record, `title`, `archived`) is no call, to an owner or anyone else: the UX wave offers it as
    // an act, an unarchive alone (U9, M1; test/endpoint/session-acts.test.ts).
    for (const r of [a, b]) for (const patch of [{ pinned: true }, { title: null }, { archived: true }, { archived: false }]) expect(code(await call(r, 'session.update', { appSessionId: app, patch }))).toBe('act-required');
  });

  it('grades a reader’s update `list`, a draft’s read `view` and its write `converse`', async () => {
    const at = async (grade: Grade) => {
      const { f, app } = await machine(grade);
      const b = await openRemote(f, org.b1, org.B);
      return {
        update: code(await call(b, 'session.reader.update', { appSessionId: app, patch: { pinned: true } })),
        get: code(await call(b, 'session.drafts.get', { appSessionId: app })),
        set: (await machineAct(f, b, 'session.drafts.set', { appSessionId: app, draft: draft('hi') })).ack,
      };
    };
    expect(await at('list')).toEqual({ update: 'ok', get: 'grade', set: 'grade' });
    expect(await at('view')).toEqual({ update: 'ok', get: 'ok', set: 'grade' });
    expect(await at('converse')).toEqual({ update: 'ok', get: 'ok', set: 'ok' });
    // A draft's read is a call, its write an act (the offer table's kinds).
    expect([OFFERS.commands['session.drafts.get'], OFFERS.commands['session.drafts.set'], OFFERS.commands['session.reader.update']]).toMatchObject([{ kind: 'call' }, { kind: 'act' }, { kind: 'call' }]);
  });
});

describe('drafts per member', () => {
  it('keeps a member’s draft apart from the owners’, each read back by its own writer', async () => {
    const { f, index, app } = await machine('converse');
    const [a, b] = [await openRemote(f, org.a1, org.A), await openRemote(f, org.b1, org.B)];
    expect((await machineAct(f, b, 'session.drafts.set', { appSessionId: app, draft: draft('b’s words') })).outcome).toEqual({ state: 'done' });
    expect(index.drafts.get(app)).toBeNull(); // the owners' none
    expect(index.drafts.get(app, org.B)).toEqual(draft('b’s words'));
    expect((await machineAct(f, a, 'session.drafts.set', { appSessionId: app, draft: draft('a’s words') })).outcome).toEqual({ state: 'done' });
    expect(output(await call(a, 'session.drafts.get', { appSessionId: app }))).toEqual(draft('a’s words'));
    expect(output(await call(b, 'session.drafts.get', { appSessionId: app }))).toEqual(draft('b’s words'));
    // Its claimed run had the member as its reader.
    expect(f.host.calls.filter((c) => c.name === 'machine.op').map((c) => c.reader)).toEqual([org.B, 'owner']);
  });
});

// M6a's branch review, F1: a device's draft save names the draft it replaces, and one that lands after a newer save
// (main answered it `timeout`, and it went on) is refused through the real gate and index, the newer draft kept.
describe('a draft save that lands late', () => {
  it('is refused when the draft it replaces is no longer the kept one', async () => {
    const { f, index, app } = await machine('converse');
    const b = await openRemote(f, org.b1, org.B);
    const newer = { ...draft('newer'), updatedAt: LATER };
    expect((await machineAct(f, b, 'session.drafts.set', { appSessionId: app, draft: newer, replaces: null })).outcome).toEqual({ state: 'done' });
    expect((await machineAct(f, b, 'session.drafts.set', { appSessionId: app, draft: draft('older'), replaces: null })).outcome).toMatchObject({ state: 'failed', error: { message: STALE_DRAFT_WORDS } });
    expect(index.drafts.get(app, org.B)).toEqual(newer);
    expect((await machineAct(f, b, 'session.drafts.set', { appSessionId: app, draft: null, replaces: LATER })).outcome).toEqual({ state: 'done' });
    expect(index.drafts.get(app, org.B)).toBeNull();
  });
});

// M6a's branch review, F3: the owners' draft saved on the machine's own app may hold attachments past one answer's bound
// over the channel; a remote read of it is its text, the attachments that don't fit named as left out, not `too-large`.
describe('a draft past the channel’s bound', () => {
  it('reads remotely as its text, its oversized attachments named as left out', async () => {
    const { f, index, app } = await machine('converse');
    const pdf = { id: 'a1', kind: 'document', name: 'paper.pdf', mediaType: 'application/pdf', bytes: 3 * 1024 * 1024, data: 'A'.repeat(4 * 1024 * 1024), persisted: true };
    const whole = { ...draft('read this'), doc: { ...draft('read this').doc, attrs: { attachments: [pdf] } } };
    index.drafts.set(app, whole);
    const a = await openRemote(f, org.a1, org.A);
    const read = output(await call(a, 'session.drafts.get', { appSessionId: app })) as typeof whole;
    expect(read).toEqual({ ...whole, doc: { ...whole.doc, attrs: { attachments: [], [WITHHELD_ATTACHMENTS]: [{ id: 'a1', name: 'paper.pdf' }] } } });
    expect(index.drafts.get(app)).toEqual(whole); // kept whole on the machine
    // M6a's re-review, K2: the device's edit saved back names what its read left there, which the machine keeps
    const edited = { ...read, doc: { ...read.doc, content: draft('read this, please').doc.content }, updatedAt: '2026-11-07T10:01:00.000Z' };
    expect((await machineAct(f, a, 'session.drafts.set', { appSessionId: app, draft: edited, replaces: read.updatedAt })).outcome).toEqual({ state: 'done' });
    expect(index.drafts.get(app)).toEqual({ ...edited, doc: { ...edited.doc, attrs: { attachments: [pdf] } } });
  });
});

// Fix wave F1 (the desk track's P1): a reader is decided with its request, from the owners the decision read. When the
// machine's owners change after the decision and before the machine hears the request, the request is decided again (an
// ex-owner then reads and writes as the member they still are) or refused: never as the owners.
describe('a reader decided before the machine’s owners change', () => {
  /**
   * Each of the first `name`s A asks is decided, then the machine's owners become the next of `moves` (by default, once,
   * B alone: A stays a member) before the gate hands it on.
   */
  function ownersMoveAfter(f: Fixture, name: string, moves: string[][] = [[org.B]]): { moved(): boolean } {
    const authorizer = f.endpoint.authorizer;
    const decide = authorizer.authorize.bind(authorizer);
    let made = 0;
    authorizer.authorize = async (request, who, now) => {
      const decision = await decide(request, who, now);
      if (made < moves.length && request.name === name && who.member === org.A) await giveMachine(f, moves[made++]);
      return decision;
    };
    return { moved: () => made === moves.length };
  }

  it('writes an ex-owner’s `session.reader.update` to their own row, never the owners’', async () => {
    const { f, index, app } = await machine('view');
    const a = await openRemote(f, org.a1, org.A);
    const probe = ownersMoveAfter(f, 'session.reader.update');
    const answer = await call(a, 'session.reader.update', { appSessionId: app, patch: { pinned: true } });
    expect(probe.moved()).toBe(true);
    expect(readerFields(index.sessions.get(app)!)).toEqual(NONE); // the owners' row untouched
    expect(output(answer)).toEqual({ appSessionId: app, ...NONE, pinned: true });
    expect(readerFields(index.sessions.get(app, org.A)!)).toEqual({ ...NONE, pinned: true });
    expect(f.host.calls.filter((c) => c.name === 'session.reader.update').map((c) => c.reader)).toEqual([org.A]);
  });

  it('answers an ex-owner’s `session.get` and `session.drafts.get` with none of the owners’ reading or draft', async () => {
    for (const name of ['session.get', 'session.drafts.get']) {
      const { f, index, app } = await machine('view', [{ member: org.A, grade: 'view' }]);
      ownersRead(index, app);
      index.drafts.set(app, draft('the owners’ words'));
      const a = await openRemote(f, org.a1, org.A);
      const probe = ownersMoveAfter(f, name);
      const answer = output(await call(a, name, { appSessionId: app }));
      expect(probe.moved()).toBe(true);
      expect([name, name === 'session.get' ? readerFields(answer) : answer]).toEqual([name, name === 'session.get' ? NONE : null]);
      expect([name, f.host.calls.filter((c) => c.name === name && c.reader !== undefined).map((c) => c.reader)]).toEqual([name, [org.A]]);
    }
  });

  it('writes an ex-owner’s `session.drafts.set` to their own draft, never the owners’', async () => {
    const { f, index, app } = await machine('converse', [{ member: org.A, grade: 'converse' }]);
    index.drafts.set(app, draft('the owners’ words'));
    const a = await openRemote(f, org.a1, org.A);
    const probe = ownersMoveAfter(f, 'session.drafts.set');
    expect((await machineAct(f, a, 'session.drafts.set', { appSessionId: app, draft: draft('mine') })).outcome).toEqual({ state: 'done' });
    expect(probe.moved()).toBe(true);
    expect(index.drafts.get(app)).toEqual(draft('the owners’ words'));
    expect(index.drafts.get(app, org.A)).toEqual(draft('mine'));
  });

  // Re-review G3: the retry is spent once. A call whose second decision moved too goes nowhere and answers `unavailable`.
  it('answers `unavailable` when the owners move again under the call’s second decision, and the machine hears neither', async () => {
    const { f, index, app } = await machine('view', [{ member: org.A, grade: 'view' }]);
    const a = await openRemote(f, org.a1, org.A);
    // The first decision names A an owner, then B takes the machine; the second names A a member, then A has it back.
    const probe = ownersMoveAfter(f, 'session.reader.update', [[org.B], [org.A]]);
    const answer = await call(a, 'session.reader.update', { appSessionId: app, patch: { pinned: true } });
    expect(probe.moved()).toBe(true);
    expect(code(answer)).toBe('unavailable');
    expect(f.host.calls.filter((c) => c.name === 'session.reader.update')).toEqual([]);
    expect(readerFields(index.sessions.get(app)!)).toEqual(NONE);
    expect(readerFields(index.sessions.get(app, org.A)!)).toEqual(NONE);
  });
});

// Fix wave F2 (the desk track's P2): a checkout feed's changes wait, in order, on each member's reading; while they wait
// they count in the feed's backlog, and none whose feed closed or ended asks the machine anything. F1's rule on a feed:
// a change goes to an owner as it is only while the head that made them one stands. The plane alone, over a machine
// whose member reads are held.
describe('a checkout feed’s changes waiting on a reading', () => {
  function plane(backlogBytes: number, owners: () => OwnersRead = () => ({ owners: Promise.resolve([]), stands: () => true }), member = org.B) {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const reads: unknown[] = [];
    const sent: Array<{ name: string; payload: { record: Record<string, unknown> } }> = [];
    const dispatch = async (_owner: string, _name: string, _input: unknown, _client?: unknown, reader?: unknown) => {
      if (reader === undefined) return { t: 'res', id: 'x', ok: false, error: { code: 'host_unavailable', message: 'away' } } as never; // the bounds' reads
      reads.push(reader);
      if (reads.length === 1) await held;
      return { t: 'res', id: 'x', ok: true, value: { appId: 'app-1', ...NONE, pinned: true } } as never;
    };
    const feeds = new PlaneFeeds({ dispatch, bounds: new CheckoutBounds(() => []), ranks: (() => new Map()) as never, artifacts: { onDropped: () => () => {} } as never, leases: {} as never, browser: () => null, cursors: { seal: (entry) => entry.id }, owners, backlogBytes, log: () => {} });
    const sub = {
      message: { feed: 'checkout' },
      session: { lane: 'B', id: 'app-1' },
      channel: { client: undefined, member },
      ended: false,
      endedWith: null as string | null,
      backlog: 0,
      subbed: () => {},
      ev: (_cursor: unknown, body: unknown) => void sent.push(body as never),
      end(reason: string) {
        this.ended = true;
        this.endedWith = reason;
      },
    };
    feeds.open(sub as unknown as Subscription);
    const change = (n: number) => feeds.event('machine', { name: 'session.changed', payload: { record: { appId: 'app-1', title: `t${n}`, ...NONE }, cause: 'update', revision: n } });
    return { feeds, sub, reads, sent, release, change };
  }
  const settled = () => new Promise((resolve) => setTimeout(resolve, 50));

  it('ends the feed `behind` once the changes waiting pass its backlog, and asks the machine nothing more', async () => {
    const p = plane(100);
    p.change(0);
    await settled(); // its read out, and held
    for (let n = 1; n < 1000; n++) p.change(n);
    expect(p.sub.endedWith).toBe('behind');
    p.release();
    await settled();
    expect(p.reads).toEqual([org.B]); // the one read held when the feed ended
    expect(p.sent).toEqual([]);
  });

  it('asks the machine nothing for the changes waiting once their feed closes', async () => {
    const p = plane(4 * 1024 * 1024);
    p.change(0);
    await settled();
    for (let n = 1; n < 1000; n++) p.change(n);
    expect(p.sub.ended).toBe(false);
    p.feeds.close(p.sub as unknown as Subscription);
    p.release();
    await settled();
    expect(p.reads).toEqual([org.B]);
    expect(p.sent).toEqual([]);
  });

  it('tells an owner the owners’ reading only while the head that made them one stands, else their own', async () => {
    let read = 0;
    // The first read finds A an owner under a head that has moved by the step it would send; read again, A is a member.
    const owners = (): OwnersRead => (++read === 1 ? { owners: Promise.resolve([org.A]), stands: () => false } : { owners: Promise.resolve([]), stands: () => true });
    const p = plane(4 * 1024 * 1024, owners, org.A);
    p.release();
    p.change(1);
    await settled();
    expect(p.reads).toEqual([org.A]);
    expect(p.sent.map((body) => readerFields(body.payload.record))).toEqual([{ ...NONE, pinned: true }]);
  });
});

// Re-review G1: an owner's record waits in its subscription for the device's credit, so the owners' reading may leave
// only while the head that made its member an owner stands. Through a real subscription: a first change spends the
// device's one byte of credit, a second waits for more, the machine is given to another while the former owner keeps
// their view by a share, then credit comes.
describe('a checkout feed’s change queued for an owner', () => {
  it('never sends a former owner the owners’ reading queued while they were one', async () => {
    const { f, index, app } = await machine('view', [{ member: org.A, grade: 'view' }]);
    const owners = ownersRead(index, app);
    const a = await openRemote(f, org.a1, org.A);
    await a.channel.send({ t: 'sub', sub: 'f1', feed: 'checkout', session: { lane: 'B', id: app }, cursor: null, credit: 1 });
    expect(await waitFor(a, (m) => m.sub === 'f1' && (m.t === 'subbed' || m.t === 'ended'), 'the answer to feed f1')).toMatchObject({ t: 'subbed' });
    const record = index.sessions.get(app)!;
    f.host.emitMachine('session.changed', { record, cause: 'update', revision: 7 });
    await until(() => changes(a, 'f1').length === 1, 'the first change, sent while A is an owner');
    f.host.emitMachine('session.changed', { record: { ...record, title: 'queued' }, cause: 'update', revision: 8 });
    await new Promise((resolve) => setTimeout(resolve, 100)); // told to the owner: queued, for want of credit
    expect(changes(a, 'f1').map((c) => c.revision)).toEqual([7]);
    await giveMachine(f, [org.B]);
    await new Promise((resolve) => setTimeout(resolve, 100)); // A's access checked again: granted by the share
    const from = a.inbox.length;
    await a.channel.send({ t: 'credit', sub: 'f1', bytes: 4 * 1024 * 1024 });
    const next = await waitFor(a, (m) => m.sub === 'f1' && (m.t === 'ended' || m.t === 'ev'), 'the feed’s next message', from);
    expect(changes(a, 'f1').slice(1).map((c) => readerFields(c.record))).not.toContainEqual(owners);
    expect(next).toMatchObject({ t: 'ended', reason: 'behind' });
  });
});

// The architect's ruling 3: every record the endpoint sends a member, owner or not, carries that member's own reader
// fields, or none where they have no row.
describe('every record a member is sent carries their own reading', () => {
  it('answers: `session.get` reads the owners’ for an owner, a member’s own for a member, none for one with no row', async () => {
    const { f, index, app } = await machine('view', [{ member: D, grade: 'view' }]);
    const owners = ownersRead(index, app);
    index.sessions.setPinned(app, true, org.B);
    const [a, b, d] = [await openRemote(f, org.a1, org.A), await openRemote(f, org.b1, org.B), await openRemote(f, d1, D)];
    const record = index.sessions.get(app)!;
    expect(output(await call(a, 'session.get', { appSessionId: app }))).toEqual(record);
    expect(output(await call(b, 'session.get', { appSessionId: app }))).toEqual({ ...record, ...NONE, pinned: true });
    expect(output(await call(d, 'session.get', { appSessionId: app }))).toEqual({ ...record, ...NONE });
    expect(readerFields(index.sessions.get(app)!)).toEqual(owners);
  });

  it('events: a `session.changed` on a checkout feed carries the owners’ to an owner, a member’s own to a member, none to one with no row', async () => {
    const { f, index, app } = await machine('view', [{ member: D, grade: 'view' }]);
    ownersRead(index, app);
    index.sessions.markSeen(app, { messageUuid: 'm4' as MessageUuid, at: LATER }, org.B);
    const [a, b, d] = [await openRemote(f, org.a1, org.A), await openRemote(f, org.b1, org.B), await openRemote(f, d1, D)];
    for (const r of [a, b, d]) await feed(r, 'f1', app);
    const changed = { record: index.sessions.get(app)!, cause: 'update', revision: 7 };
    f.host.emitMachine('session.changed', changed);
    await until(() => [a, b, d].every((r) => changes(r, 'f1').length === 1), 'each feed’s change');
    expect(changes(a, 'f1')).toEqual([changed]);
    expect(changes(b, 'f1')).toEqual([{ ...changed, record: { ...changed.record, ...NONE, lastSeen: { messageUuid: 'm4', at: LATER } } }]);
    expect(changes(d, 'f1')).toEqual([{ ...changed, record: { ...changed.record, ...NONE } }]);
  });

  it('keeps a feed’s changes in their order while a member’s reading is read for each', async () => {
    const { f, index, app } = await machine('view');
    const b = await openRemote(f, org.b1, org.B);
    await feed(b, 'f1', app);
    const record = index.sessions.get(app)!;
    for (let revision = 1; revision <= 5; revision++) f.host.emitMachine('session.changed', { record: { ...record, title: `t${revision}` }, cause: 'update', revision });
    await until(() => changes(b, 'f1').length === 5, 'the five changes');
    expect(changes(b, 'f1').map((c) => [c.revision, c.record.title])).toEqual([1, 2, 3, 4, 5].map((n) => [n, `t${n}`]));
  });

  // Fix wave F3: what each member is actually sent, surface by surface, through real channels: a lane B subscription's
  // opening snapshot and its events, the checkout and attention feeds' openings, the history pages (`session.events`,
  // `session.appEvents`, `session.history.list`) and the record's own answers. The owners', B's and D's readings and
  // drafts are each distinct, so a value in the wrong member's inbox is found wherever it sits.
  it('snapshots and history pages: each member receives their own reading and draft, and nobody else’s, on every surface', async () => {
    const { f, index, app } = await machine('converse', [{ member: D, grade: 'view' }]);
    const OWNERS = { seen: 'owners-seen-7f3a', at: '2031-02-03T04:05:06.000Z', draft: 'OWNERS-ONLY-DRAFT' };
    const B_ = { seen: 'b-seen-1c2d', at: '2030-01-02T03:04:05.000Z', draft: 'B-ONLY-DRAFT' };
    index.sessions.setPinned(app, true);
    index.sessions.markSeen(app, { messageUuid: OWNERS.seen as MessageUuid, at: OWNERS.at });
    index.sessions.setUnread(app, true);
    index.drafts.set(app, draft(OWNERS.draft));
    index.sessions.markSeen(app, { messageUuid: B_.seen as MessageUuid, at: B_.at }, org.B);
    index.drafts.set(app, draft(B_.draft), org.B);
    const theirs = { [org.A]: { pinned: true, unread: true, lastSeen: { messageUuid: OWNERS.seen, at: OWNERS.at } }, [org.B]: { ...NONE, lastSeen: { messageUuid: B_.seen, at: B_.at } }, [D]: NONE };
    // The session live on the engine host with a turn in its journal; its attention item, app events and prompt history.
    f.host.add(app, index.sessions.get(app)!.engineSessionId);
    f.host.row(app, 2);
    f.host.attach(true);
    const at = AT;
    f.spine.handle('attention.list', () => [{ id: 'att-r1', appSessionId: app, sessionId: index.sessions.get(app)!.engineSessionId, kind: 'permission', request: { requestId: 'r1', toolUseId: 'tu-r1', taskId: null, agentId: null }, summary: 'permission', createdAt: at, state: 'pending', stateChangedAt: at, expiresAt: null }]);
    const { notice, prompts } = await historyOf(f, index, app);

    const inboxes = new Map<string, Remote>();
    for (const [member, device] of [[org.A, org.a1], [org.B, org.b1], [D, d1]] as const) {
      const r = await openRemote(f, device, member);
      inboxes.set(member, r);
      await subscribe(r, 's1', { lane: 'B', id: app });
      await snapshot(r, 's1');
      await feed(r, 'f1', app);
      const from = r.inbox.length;
      await r.channel.send({ t: 'sub', sub: 'att', feed: 'attention', cursor: null, credit: 4 * 1024 * 1024 });
      await waitFor(r, (m) => m.sub === 'att' && m.t === 'snap', 'the attention feed’s snapshot', from);
      for (const [name, input] of [
        ['session.events', { appSessionId: app, afterSeq: null, limit: 100 }],
        ['session.appEvents', { appSessionId: app }],
        ['session.history.list', { appSessionId: app, limit: 10 }],
        ['session.get', { appSessionId: app }],
        ['session.drafts.get', { appSessionId: app }],
      ] as const) {
        const answer = await call(r, name, input);
        expect([member, name, code(answer)]).toEqual([member, name, 'ok']);
        // The history pages carry what the machine holds: its app event, and the prompts in their order.
        if (name === 'session.appEvents') expect([member, output(answer).events]).toEqual([member, [notice]]);
        if (name === 'session.history.list') expect([member, (output(answer).entries as Array<{ display: string }>).map((entry) => entry.display)]).toEqual([member, prompts]);
      }
    }
    f.host.emitMachine('session.changed', { record: index.sessions.get(app)!, cause: 'update', revision: 9 });
    await until(() => [...inboxes.values()].every((r) => changes(r, 'f1').length === 1), 'each feed’s change');

    for (const [member, r] of inboxes) {
      const sent = JSON.stringify(r.inbox);
      // Every reader-shaped object a member was sent reads as theirs (the record's answer, its change on the feed), …
      const readings = readingsIn(r.inbox);
      expect([member, readings.length]).toEqual([member, 2]);
      for (const reading of readings) expect([member, reading]).toEqual([member, theirs[member]]);
      // … and nobody else's reading or draft is anywhere in what they were sent.
      const others = member === org.A ? [B_.seen, B_.draft] : member === org.B ? [OWNERS.seen, OWNERS.at, OWNERS.draft] : [OWNERS.seen, OWNERS.at, OWNERS.draft, B_.seen, B_.draft];
      for (const token of others) expect([member, token, sent.includes(token)]).toEqual([member, token, false]);
    }
    // Each draft reached its own writer (the scan above saw real payloads).
    expect(JSON.stringify(inboxes.get(org.A)!.inbox)).toContain(OWNERS.draft);
    expect(JSON.stringify(inboxes.get(org.B)!.inbox)).toContain(B_.draft);
  });

  // A supplementary guard: what the offered commands answer and the events carry, by their schemas. Only the record's
  // carry reader fields (`unread`, `lastSeen`): `session.get`'s and `session.reader.update`'s answers, the record acts' since
  // UX wave U9 (`session.update`, `session.rename`, each answering the caller's reading, and the archived read
  // `session.list`, cut per record), and `session.changed`;
  // `ownerChannel.changed` is the owner channel's own, which no feed carries. `pinned` beside them is also an artifact
  // version's pin. A schema the scan can't read (beyond `void`) is named, so a new one is looked at rather than passed.
  it('the schemas: only the record’s answers and `session.changed` carry reader fields', () => {
    const unreadable: string[] = [];
    const json = (name: string, schema: z.ZodType) => {
      try {
        return JSON.stringify(z.toJSONSchema(schema, { unrepresentable: 'throw', io: 'output', cycles: 'ref' }));
      } catch {
        if (!(schema instanceof z.ZodVoid)) unreadable.push(name);
        return JSON.stringify(z.toJSONSchema(schema, { unrepresentable: 'any', io: 'output', cycles: 'ref' }));
      }
    };
    const offered = Object.keys(OFFERS.commands).filter((name) => Object.hasOwn(REGISTRY.commands, name)) as Array<keyof typeof REGISTRY.commands>;
    const outputs = new Map(offered.map((name) => [name, json(name, REGISTRY.commands[name].output)]));
    const events = new Map((Object.keys(REGISTRY.events) as Array<keyof typeof REGISTRY.events>).map((name) => [name, json(name, REGISTRY.events[name])]));
    const reading = (text: string) => text.includes('"unread"') || text.includes('"lastSeen"');
    expect([...outputs].filter(([, text]) => reading(text)).map(([name]) => name)).toEqual(['session.get', 'session.reader.update', 'session.update', 'session.rename', 'session.list']);
    expect([...events].filter(([, text]) => reading(text)).map(([name]) => name).sort()).toEqual(['ownerChannel.changed', 'session.changed']);
    const ARTIFACT_PINS = ['artifacts.create', 'artifacts.duplicate', 'artifacts.get', 'artifacts.list', 'artifacts.update', 'library.get', 'library.list'];
    expect([...outputs].filter(([, text]) => text.includes('"pinned"')).map(([name]) => name).sort()).toEqual(['session.get', 'session.reader.update', 'session.update', 'session.rename', 'session.list', ...ARTIFACT_PINS].sort());
    // Bytes (`pty.attach`'s, an artifact's state and attributions, a terminal's and a browser's frames): no reading in them.
    expect(unreadable.sort()).toEqual(['artifacts.attributions', 'artifacts.versionState', 'browser.remote.frame', 'pty.attach', 'pty.data']);
  });

  it('remote rows: a listing carries RL6’s five fields and no reading', async () => {
    const f = await startEndpoint(org, started);
    await sminos(f, [laneAMember()]);
    const b = await openRemote(f, org.b1, org.B);
    const listings = (output(await call(b, 'endpoint.listings', null)).listings as Signed<Listing>[]).map((record) => record.body.fields);
    expect(listings).toHaveLength(1);
    for (const fields of listings) expect(Object.keys(fields).sort()).toEqual(['lane', 'owners', 'project', 'state', 'title']);
  });
});

// Decision Log, "A member's reader change reaches that member's other devices, and no one else's".
describe('a member’s reader change', () => {
  it('reaches the member’s other device as their own record, and neither another member nor an owner', async () => {
    const { f, index, app } = await machine('view', [{ member: D, grade: 'view' }]);
    ownersRead(index, app);
    const [a, one, two, d] = [await openRemote(f, org.a1, org.A), await openRemote(f, org.b1, org.B), await openRemote(f, b2, org.B), await openRemote(f, d1, D)];
    for (const r of [a, one, two, d]) await feed(r, 'f1', app);
    expect(code(await call(one, 'session.reader.update', { appSessionId: app, patch: { pinned: true } }))).toBe('ok');
    await until(() => changes(two, 'f1').length === 1, 'the change on B’s other device');
    const [told] = changes(two, 'f1');
    expect(told.record).toEqual(output(await call(two, 'session.get', { appSessionId: app })));
    expect(readerFields(told.record)).toEqual({ ...NONE, pinned: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(changes(a, 'f1')).toEqual([]);
    expect(changes(d, 'f1')).toEqual([]);
    // An owner's change is the spine's own `session.changed`: the endpoint adds none.
    expect(code(await call(a, 'session.reader.update', { appSessionId: app, patch: { pinned: false } }))).toBe('ok');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect([a, one, two, d].map((r) => changes(r, 'f1').length)).toEqual([0, 1, 1, 0]);
  });
});
