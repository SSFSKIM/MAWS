// The session acts the UX wave offers another machine (U9, M1; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-
// machines.md, Interfaces §1; the section's UC-7.4): each row at the endpoint, through the real gate, for each refusal
// it can give, and the machine acts run once through the services' ledger (`machine.op`) by the services' own handlers
// over the real index (`registerIndexHandlers`, `registerSessionServiceHandlers` over a real SessionService on it, its
// engine host a stand-in: test/support/session-harness.ts).
//
// R9 (the session that keeps master's ruling, as amended): an unarchive is the one `session.update` a reader may make,
// and it and `session.rename` answer the record as `session.get` answers that reader. The ledger keeps an act's answer
// and returns it for a duplicate and a query, so each is read three times: the first answer, a duplicate under the same
// operation id, and a query, as an owner of the machine and as a member who owns the session without owning the machine.
//
// The org (sub-harness.ts): A owns the machine `mini`; B and C are members.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MESSAGE_MAX_BYTES, type Action } from 'org-protocol';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { registerIndexHandlers } from '../../src/services/index/register';
import { registerSessionServiceHandlers } from '../../src/services/sessions/service-register';
import { summary } from '../support/index-fixture';
import { SessionHarness } from '../support/session-harness';
import { act, done, makeOrg, openRemote, startEndpoint, stopAll, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];
const harnesses: SessionHarness[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  await stopAll(started);
  for (const h of harnesses.splice(0)) h.dispose();
});

type Share = { member: string; grade: 'list' | 'view' | 'converse' };
const AT = '2026-11-12T10:00:00.000Z';

/** The machine: its endpoint, and the services' real index and session service behind its spine. */
async function machine(): Promise<{ f: Fixture; h: SessionHarness }> {
  const f = await startEndpoint(org, started, { limits: { perSource: { burst: 100, perMinute: 6_000 }, overall: { burst: 100, perMinute: 6_000 } } });
  const h = await new SessionHarness().start();
  harnesses.push(h);
  registerIndexHandlers(h.index, f.spine.bus as never);
  registerSessionServiceHandlers(h.service, { register: f.spine.bus.register, intercept: () => () => {} } as never, 'index');
  return { f, h };
}

/** A lane B session in the index, `owners` its record's (the machine's by default), shared as `shares` say. */
function session(f: Fixture, h: SessionHarness, options: { owners?: string[]; shares?: Share[]; title?: string; archived?: boolean; live?: boolean } = {}): SessionRecord {
  let record = h.index.sessions.upsertFromSummary(summary({ directory: h.work, customTitle: options.title ?? 'Studio scratch' })).record;
  if (options.archived === true) record = h.index.sessions.update(record.appId, { archived: true });
  f.records.set({ lane: 'B', session: record.engineSessionId!, owners: options.owners ?? ['@machine'], shares: options.shares ?? [] }, record.appId);
  if (options.live === true) f.host.add(record.appId, record.engineSessionId); // a live launch on the engine host
  return record;
}

/** A `machine` act as the device's adapter builds it: no session, no context, placed by its args. */
const machineAction = (f: Fixture, r: Remote, name: string, args: Record<string, unknown>): Action => r.device.action({ machine: f.ref, action: name, args });
/** An engine-host act on the session's live launch. */
function hostAction(f: Fixture, r: Remote, name: string, app: AppSessionId, args: Record<string, unknown>): Action {
  const s = f.host.session(app);
  return r.device.action({ machine: f.ref, action: name, session: app, context: { lane: 'B', launchId: s.launchId, engineSessionId: s.engineSessionId! }, args: { appSessionId: app, ...args } });
}

/** The act's ack's word, and its outcome when accepted. */
async function run(r: Remote, action: Action): Promise<{ ack: string; outcome?: unknown }> {
  const from = r.inbox.length;
  const ack = await act(r, action);
  return ack === 'ok' ? { ack, outcome: await done(r, action, from) } : { ack };
}
const refusal = async (r: Remote, action: Action) => (await run(r, action)).ack;
const resultOf = async (r: Remote, action: Action) => {
  const ran = await run(r, action);
  expect(ran).toMatchObject({ ack: 'ok', outcome: { state: 'done' } });
  return (ran.outcome as { result: unknown }).result;
};

async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}
const codeOf = (m: Msg) => (m.ok === true ? 'ok' : (m.error as { code: string }).code);

/** The services' ledger's answer to a query of `action` from `r`. */
async function query(r: Remote, action: Action): Promise<Msg> {
  const from = r.inbox.length;
  await r.channel.send({ t: 'query', opId: action.opId, opCreated: action.opCreated, executor: 'machine' });
  return waitFor(r, (m) => m.t === 'queried' && m.opId === action.opId, `the answer to a query of ${action.action}`, from);
}

const claimed = (f: Fixture, name: string) => f.spine.claimed.filter((c) => c.name === name);
const readerFields = (record: Record<string, unknown>) => ({ pinned: record.pinned, unread: record.unread, lastSeen: record.lastSeen });

describe('archive, unarchive and rename (`manage`, machine acts)', () => {
  it('run for an owner of the session, each once through the services’ ledger, with no tab and no launch', async () => {
    const { f, h } = await machine();
    const app = session(f, h).appId;
    const a = await openRemote(f, org.a1, org.A);
    expect(await resultOf(a, machineAction(f, a, 'session.archive', { appSessionId: app }))).toEqual({ archived: true });
    expect(h.index.sessions.get(app)!.archived).toBe(true);
    expect((await resultOf(a, machineAction(f, a, 'session.update', { appSessionId: app, patch: { archived: false } })) as SessionRecord).archived).toBe(false);
    expect(h.index.sessions.get(app)!.archived).toBe(false);
    expect(await resultOf(a, machineAction(f, a, 'session.rename', { appSessionId: app, title: 'Loft notes' }))).toMatchObject({ record: { appId: app, title: { text: 'Loft notes', source: 'user' } }, via: 'override' });
    expect(['session.archive', 'session.update', 'session.rename'].map((name) => claimed(f, name).length)).toEqual([1, 1, 1]);
    expect(f.host.calls.filter((c) => c.name === 'session.acquire' || c.name === 'host.op')).toEqual([]); // nothing resumed
  });

  it('refuse a member below `manage` (`grade`), and run for a member who owns the session', async () => {
    const { f, h } = await machine();
    const shared = session(f, h, { shares: [{ member: org.B, grade: 'converse' }] }).appId;
    const own = session(f, h, { owners: [org.B] }).appId;
    const b = await openRemote(f, org.b1, org.B);
    expect(await refusal(b, machineAction(f, b, 'session.archive', { appSessionId: shared }))).toBe('grade');
    expect(await refusal(b, machineAction(f, b, 'session.rename', { appSessionId: shared, title: 'Not mine' }))).toBe('grade');
    expect(await refusal(b, machineAction(f, b, 'session.update', { appSessionId: shared, patch: { archived: false } }))).toBe('grade');
    expect(claimed(f, 'session.archive')).toEqual([]);
    expect(await resultOf(b, machineAction(f, b, 'session.archive', { appSessionId: own }))).toEqual({ archived: true });
  });

  it('are refused `read-only` on a machine in read-only mode', async () => {
    const { f, h } = await machine();
    const app = session(f, h).appId;
    f.endpoint.policy.set({ read_only: true });
    const a = await openRemote(f, org.a1, org.A);
    expect(await refusal(a, machineAction(f, a, 'session.archive', { appSessionId: app }))).toBe('read-only');
    expect(await refusal(a, machineAction(f, a, 'session.rename', { appSessionId: app, title: 'Loft notes' }))).toBe('read-only');
    expect(await refusal(a, machineAction(f, a, 'session.update', { appSessionId: app, patch: { archived: false } }))).toBe('read-only');
    expect(f.spine.claimed).toEqual([]);
  });

  it('take a `session.update` whose patch is exactly an unarchive, and refuse any other `malformed` before the machine hears it', async () => {
    const { f, h } = await machine();
    const app = session(f, h).appId;
    const a = await openRemote(f, org.a1, org.A);
    for (const patch of [{ archived: true }, { archived: false, pinned: true }, { title: { text: 'Loft notes', source: 'user' } }, { pinned: true }]) {
      expect(await refusal(a, machineAction(f, a, 'session.update', { appSessionId: app, patch })), JSON.stringify(patch)).toBe('malformed');
    }
    expect(f.spine.claimed).toEqual([]);
  });

  it('answer an archive of a session a terminal holds with the services’ `held` outcome, and end nothing', async () => {
    const { f, h } = await machine();
    const record = session(f, h);
    h.host.hold(record.engineSessionId!, { kind: 'terminal', pid: 9 }, h.work);
    const a = await openRemote(f, org.a1, org.A);
    expect(await resultOf(a, machineAction(f, a, 'session.archive', { appSessionId: record.appId }))).toEqual({ status: 'held', holder: { kind: 'terminal', pid: 9 } });
    expect(h.index.sessions.get(record.appId)!.archived).toBe(false);
  });
});

describe('R9: what an unarchive and a rename answer a reader, first, again and when queried', () => {
  /** An unarchive and a rename by `r`, each answered three times: the act's own outcome, a duplicate's, a query's. */
  async function threeAnswers(f: Fixture, r: Remote, app: AppSessionId): Promise<unknown[]> {
    const answers: unknown[] = [];
    for (const action of [machineAction(f, r, 'session.update', { appSessionId: app, patch: { archived: false } }), machineAction(f, r, 'session.rename', { appSessionId: app, title: 'Loft notes' })]) {
      answers.push(await resultOf(r, action));
      const copy: Action = { ...action, nonce: Buffer.from(`copy-${action.opId}`.slice(0, 16).padEnd(16, '0')).toString('base64url'), created: new Date().toISOString() };
      answers.push(await resultOf(await openRemote(f, r.member === org.A ? org.a1 : org.b1, r.member, { capabilities: ['rl2.executor.machine'] }), copy));
      const queried = await query(r, action);
      expect(queried).toMatchObject({ state: 'done', outcome: { state: 'done' } });
      answers.push((queried.outcome as { result: unknown }).result);
    }
    return answers;
  }
  const recordsOf = (answers: unknown[]) => answers.map((answer, i) => (i % 6 < 3 ? answer : (answer as { record: unknown }).record) as Record<string, unknown>);

  it('answers an owner of the machine the owners’ reading, each time', async () => {
    const { f, h } = await machine();
    const app = session(f, h, { archived: true }).appId;
    h.index.sessions.setPinned(app, true);
    h.index.sessions.setPinned(app, false, org.B);
    const a = await openRemote(f, org.a1, org.A, { capabilities: ['rl2.executor.machine'] });
    const records = recordsOf(await threeAnswers(f, a, app));
    expect(records).toHaveLength(6);
    for (const record of records) expect(readerFields(record)).toEqual(readerFields(h.index.sessions.get(app)! as unknown as Record<string, unknown>));
    expect(records.every((record) => record.pinned === true)).toBe(true);
    expect(claimed(f, 'session.update')).toHaveLength(1); // the duplicate and the query ran nothing
  });

  it('answers a member who owns the session without owning the machine their own reading, never the owners’', async () => {
    const { f, h } = await machine();
    const app = session(f, h, { owners: [org.B], archived: true }).appId;
    h.index.sessions.setPinned(app, true); // the owners'
    h.index.sessions.markSeen(app, { messageUuid: 'm1' as MessageUuid, at: AT }); // the owners'
    h.index.sessions.setPinned(app, false, org.B);
    const b = await openRemote(f, org.b1, org.B, { capabilities: ['rl2.executor.machine'] });
    const records = recordsOf(await threeAnswers(f, b, app));
    expect(records).toHaveLength(6);
    const own = readerFields(h.index.sessions.get(app, org.B)! as unknown as Record<string, unknown>);
    expect(own.pinned).toBe(false);
    for (const record of records) {
      expect(readerFields(record)).toEqual(own);
      expect(record.lastSeen).not.toEqual({ messageUuid: 'm1', at: AT });
    }
    expect(h.index.sessions.get(app)!.archived).toBe(false);
    expect(h.index.sessions.get(app)!.title).toEqual({ text: 'Loft notes', source: 'user' });
  });
});

describe('dismiss, take back and a pane’s answer (`converse`)', () => {
  it('run for a member at `converse` and are refused `grade` below it', async () => {
    const { f, h } = await machine();
    const talk = session(f, h, { shares: [{ member: org.B, grade: 'converse' }], live: true }).appId;
    const look = session(f, h, { shares: [{ member: org.B, grade: 'view' }], live: true }).appId;
    const acknowledged: unknown[] = [];
    f.spine.handle('attention.acknowledge', (input) => void acknowledged.push(input));
    f.host.handlers.set('session.steer.cancel', () => ({ outcome: 'cancelled' }));
    f.host.handlers.set('maws.pane.answer', () => ({ outcome: 'delivered' }));
    const b = await openRemote(f, org.b1, org.B);
    const acknowledge = (app: AppSessionId) => machineAction(f, b, 'attention.acknowledge', { appSessionId: app, attentionId: `${app}:error:e1`, how: 'dismissed' });
    const cancel = (app: AppSessionId) => hostAction(f, b, 'session.steer.cancel', app, { messageUuid: 'm2' });
    const answer = (app: AppSessionId) => hostAction(f, b, 'maws.pane.answer', app, { requestId: 'req-1', result: { ok: false, error: 'closed' } });
    await resultOf(b, acknowledge(talk)); // `void`: no result to read
    expect(acknowledged).toEqual([{ appSessionId: talk, attentionId: `${talk}:error:e1`, how: 'dismissed' }]);
    expect(await resultOf(b, cancel(talk))).toEqual({ outcome: 'cancelled' });
    expect(await resultOf(b, answer(talk))).toEqual({ outcome: 'delivered' });
    for (const action of [acknowledge(look), cancel(look), answer(look)]) expect(await refusal(b, action), action.action).toBe('grade');
    expect(acknowledged).toHaveLength(1);
  });

  // A pane's answer completes a request the engine host raised (DRAIN_REPLIES): during a handover's drain only the host
  // that raised it can settle it, and a status read would wait for its successor (src/mawsd/daemon-handover.test.ts). So
  // the endpoint reads none for it: its context is checked by the ledger's claim, in the host that holds the request.
  it('a pane’s answer reads no status first: a stale launch is refused at the claim, another engine session at the endpoint', async () => {
    const { f, h } = await machine();
    const app = session(f, h, { shares: [{ member: org.B, grade: 'converse' }], live: true }).appId;
    f.host.handlers.set('session.steer.cancel', () => ({ outcome: 'cancelled' }));
    f.host.handlers.set('maws.pane.answer', () => ({ outcome: 'delivered' }));
    const b = await openRemote(f, org.b1, org.B);
    const statusReads = (from: number) => f.host.calls.slice(from).filter((c) => c.name === 'session.status').length;
    const ANSWER = { appSessionId: app, requestId: 'req-1', result: { ok: false, error: 'closed' } };
    let from = f.host.calls.length;
    expect(await resultOf(b, hostAction(f, b, 'maws.pane.answer', app, ANSWER))).toEqual({ outcome: 'delivered' });
    expect(statusReads(from)).toBe(0);
    from = f.host.calls.length;
    expect(await resultOf(b, hostAction(f, b, 'session.steer.cancel', app, { messageUuid: 'm2' }))).toEqual({ outcome: 'cancelled' }); // any other act reads it
    expect(statusReads(from)).toBe(2); // its placement's (targets.ts) and the act's own (actions.ts)
    const live = f.host.session(app);
    const sealed = (context: { launchId: string; engineSessionId: string }) => b.device.action({ machine: f.ref, action: 'maws.pane.answer', session: app, context: { lane: 'B', ...context }, args: ANSWER });
    expect(await run(b, sealed({ launchId: 'launch-stale', engineSessionId: live.engineSessionId! }))).toMatchObject({ ack: 'ok', outcome: { state: 'refused', reason: 'context' } });
    expect(await refusal(b, sealed({ launchId: live.launchId, engineSessionId: 'engine-other' }))).toBe('context');
  });

  it('are refused `read-only` on a machine in read-only mode', async () => {
    const { f, h } = await machine();
    const app = session(f, h, { live: true }).appId;
    f.endpoint.policy.set({ read_only: true });
    const a = await openRemote(f, org.a1, org.A);
    expect(await refusal(a, machineAction(f, a, 'attention.acknowledge', { appSessionId: app, attentionId: `${app}:error:e1`, how: 'dismissed' }))).toBe('read-only');
    expect(await refusal(a, hostAction(f, a, 'session.steer.cancel', app, { messageUuid: 'm2' }))).toBe('read-only');
  });
});

describe('the archived sessions’ read (`session.list {includeArchived: true}`, cut at `manage`)', () => {
  const idsOf = (m: Msg) => ((m.output as { sessions: SessionRecord[] }).sessions ?? []).map((record) => record.appId).sort();

  it('answers each caller the archived records they hold `manage` on, and nothing else', async () => {
    const { f, h } = await machine();
    const machines = session(f, h, { archived: true, shares: [{ member: org.B, grade: 'converse' }] }).appId;
    const listed = session(f, h, { archived: true, shares: [{ member: org.B, grade: 'list' }] }).appId;
    session(f, h); // unarchived: no caller's to unarchive, so none is answered it
    const bobs = session(f, h, { owners: [org.B], archived: true }).appId;
    session(f, h, { owners: [org.B] }); // B's own, unarchived
    const [a, b, c] = [await openRemote(f, org.a1, org.A), await openRemote(f, org.b1, org.B), await openRemote(f, org.c1, org.C)];
    const asOwner = await call(a, 'session.list', { includeArchived: true });
    expect(codeOf(asOwner)).toBe('ok');
    expect(idsOf(asOwner)).toEqual([machines, listed].sort());
    // a session the member may converse in or only list is not theirs to unarchive: their own alone is answered
    const asMember = await call(b, 'session.list', { includeArchived: true });
    expect(codeOf(asMember)).toBe('ok');
    expect(idsOf(asMember)).toEqual([bobs]);
    // a web-cards device reads listings and answers, never this read (its class, step 3)
    expect(codeOf(await call(c, 'session.list', { includeArchived: true }))).toBe('class');
  });

  it('answers a member their own reading of each record', async () => {
    const { f, h } = await machine();
    const app = session(f, h, { owners: [org.B], archived: true }).appId;
    h.index.sessions.setPinned(app, true);
    const b = await openRemote(f, org.b1, org.B);
    const [record] = (((await call(b, 'session.list', { includeArchived: true })).output as { sessions: SessionRecord[] }).sessions);
    expect(record.pinned).toBe(false);
  });

  // The panel's fix: the read exists for Unarchive alone, so an unarchived record never leaves the machine through it, and
  // a machine whose unarchived records alone would pass the channel's ceiling still answers its archived ones
  it('leaves every unarchived record out, however many and large, so the archived ones still fit', async () => {
    const { f, h } = await machine();
    const LARGE = 'Loft notes '.repeat(10_000); // ~110 kB a record
    for (let i = 0; i < 40; i += 1) session(f, h, { title: `${LARGE}${i}` });
    expect(40 * LARGE.length).toBeGreaterThan(MESSAGE_MAX_BYTES - 1024); // uncut, the answer could not be sent
    const archived = session(f, h, { archived: true }).appId;
    const a = await openRemote(f, org.a1, org.A);
    const answer = await call(a, 'session.list', { includeArchived: true });
    expect(codeOf(answer)).toBe('ok');
    expect(idsOf(answer)).toEqual([archived]);
  });

  it('takes no other input (`malformed`)', async () => {
    const { f } = await machine();
    const a = await openRemote(f, org.a1, org.A);
    for (const input of [{}, { includeArchived: false }, null]) expect(codeOf(await call(a, 'session.list', input)), JSON.stringify(input)).toBe('malformed');
  });
});
