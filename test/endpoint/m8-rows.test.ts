// M8's offer rows (P5 O7 M8, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §U; Constraints: "the
// offer table is the only door, and each row is tested"): the MAWS ask, the side panels and the side question, Reload
// plugins, the widget reads, the operation outcomes, and the session-scoped `view` reads the offer audit found
// unoffered. Each is admitted for a caller who holds its grade on the session (A, an owner of the machine, so of its
// sessions) and reaches its row's executor by its own name; a caller who holds nothing on it (B) is refused `grade` and
// reaches nothing past the session's placement. Each act row refuses a call (`act-required`).
//
// `fs.tasks` is on the `task-list` rule: the call names its session (`appSessionId`), placed as any lane B session, and
// once the caller is known to view it, the `listId` must be that session's own list (its status's `taskListId`, else
// its record's engine session id, each sanitised as the engine names a list directory), else `no-target`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CommandName } from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import { OFFERS } from '../../src/endpoint/offers';
import { act, makeOrg, openRemote, startEndpoint, stopAll, waitFor, type Fixture, type HostSession, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(() => stopAll(started));
afterAll(() => stopAll(started));

const APP = 'app-1';
const at = (fields: Record<string, unknown> = {}) => ({ appSessionId: APP, ...fields });

/** M8's reads, by their executor: the engine host's, and the machine's services' two (Session info's facts, the recent turns). */
const CALLS: Record<string, Record<string, unknown>> = {
  'maws.asks.list': at(),
  'side.question.list': at(),
  'fs.subagents': at(),
  'fs.workflows': at(),
  'session.operations': at({ opIds: ['op-1'] }),
  'session.getHooksListing': at(),
  'session.getMemoryDialog': at(),
  'session.getSkillsDialog': at(),
  'session.getSandboxDialog': at(),
  'session.exportConversation': at(),
  'session.getBinaryVersion': at(),
  'session.promptHistory': at({ since: '2026-11-04T00:00:00.000Z' }),
  'session.observedFacts': at(),
  'session.recentTurns': at({ limit: 5 }),
};
const MACHINE_CALLS = new Set(['session.observedFacts', 'session.recentTurns']);

/** M8's acts, through the engine host's ledger (`host.op`). */
const ACTS: Record<string, Record<string, unknown>> = {
  'maws.ask.answer': at({ askId: 'ask-1', answers: [{ id: 'q1', question: 'Which way?', status: 'answered', value: 'left' }] }),
  'side.question.clear': at(),
  'session.reloadPlugins': at(),
};

async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}

/** A live lane B session the machine's owners own, with its record in the spine and its member record. */
async function setup(engine = 'eng-app-1'): Promise<{ f: Fixture; s: HostSession; a: Remote; b: Remote }> {
  const f = await startEndpoint(org, started);
  const s = f.host.add(APP, engine);
  f.spine.set(APP, s.engineSessionId);
  f.records.set({ lane: 'B', session: s.engineSessionId!, owners: ['@machine'] }, APP);
  return { f, s, a: await openRemote(f, org.a1, org.A), b: await openRemote(f, org.b1, org.B) };
}

/** What the machine was asked about the session from `from` on, as `[owner, name]`. */
const asked = (f: Fixture, from: number) => f.host.calls.slice(from).filter((c) => (c.input as { appSessionId?: string } | undefined)?.appSessionId === APP).map((c) => [c.owner, c.name]);
/** A lane B request's placement: the spine's record, then the engine host's live row it is checked against. */
const PLACEMENT = [
  ['machine', 'session.get'],
  ['engine-host', 'session.status'],
];
const ran = (f: Fixture, name: string) => f.host.calls.some((c) => c.name === 'host.op' && (c.input as { name?: string }).name === name);
/** Refusals that say a request never reached its executor. */
const AUTHORIZATION = ['grade', 'not-offered', 'act-required', 'ungraded', 'no-target', 'no-rule', 'malformed', 'class'];
const codeOf = (m: Msg) => (m.error as { code?: string } | undefined)?.code;

describe('M8’s offer rows', () => {
  it('are offered, each as its kind, executor and target', () => {
    for (const name of Object.keys(CALLS)) expect([name, OFFERS.commands[name]]).toEqual([name, { kind: 'call', executor: MACHINE_CALLS.has(name) ? 'machine' : 'engine-host', target: 'appSessionId' }]);
    for (const name of Object.keys(ACTS)) expect([name, OFFERS.commands[name]]).toEqual([name, { kind: 'act', executor: 'engine-host', target: 'appSessionId' }]);
    expect(OFFERS.commands['fs.tasks']).toEqual({ kind: 'call', executor: 'engine-host', target: 'task-list' });
  });

  it('take inputs the registry’s schemas hold (so what follows is about the grade alone)', () => {
    for (const [name, input] of [...Object.entries(CALLS), ...Object.entries(ACTS), ['fs.tasks', at({ listId: 'eng-app-1' })] as const]) {
      expect([name, validateCommandInput(name as CommandName, input).ok]).toEqual([name, true]);
    }
  });

  it('admit each read for a caller who views the session, and refuse it for one who doesn’t', async () => {
    const { f, a, b } = await setup();
    for (const [name, input] of Object.entries(CALLS)) {
      let from = f.host.calls.length;
      const refused = await call(b, name, input);
      expect([name, refused.ok, codeOf(refused)]).toEqual([name, false, 'grade']);
      expect([name, asked(f, from)]).toEqual([name, PLACEMENT]);
      from = f.host.calls.length;
      const answered = await call(a, name, input);
      expect([name, answered.ok === true || !AUTHORIZATION.includes(codeOf(answered)!)]).toEqual([name, true]);
      expect([name, asked(f, from)]).toEqual([name, [...PLACEMENT, [OFFERS.commands[name].executor, name]]]);
    }
  });

  it('answer `session.operations` as the engine host keeps each outcome: completed, still in flight, or unknown', async () => {
    const { f, a } = await setup();
    const event = { appSessionId: APP, opId: 'op-1', command: 'session.reloadPlugins', late: false, outcome: { ok: true, value: null } };
    f.host.reads.set('session.operations', () => ({ outcomes: [{ opId: 'op-1', event }, { opId: 'op-2', pending: true }, { opId: 'op-3', unknown: true }] }));
    const answered = await call(a, 'session.operations', at({ opIds: ['op-1', 'op-2', 'op-3'] }));
    expect(answered).toMatchObject({ ok: true, output: { outcomes: [{ opId: 'op-1', event }, { opId: 'op-2', pending: true }, { opId: 'op-3', unknown: true }] } });
  });

  it('admit each act for a caller who holds its grade, handed to the engine host’s ledger, and refuse it, unrun, for one who doesn’t', async () => {
    const { f, s, a, b } = await setup();
    const context = { lane: 'B' as const, launchId: s.launchId, engineSessionId: s.engineSessionId! };
    for (const [name, args] of Object.entries(ACTS)) {
      const fields = { machine: f.ref, action: name, args, session: APP, context };
      expect([name, await act(b, b.device.action(fields))]).toEqual([name, 'grade']);
      expect([name, ran(f, name)]).toEqual([name, false]);
      const admitted = a.device.action(fields);
      const from = a.inbox.length;
      expect([name, await act(a, admitted)]).toEqual([name, 'ok']);
      await waitFor(a, (m) => m.t === 'done' && m.opId === admitted.opId, `the done of ${name}`, from);
      expect([name, ran(f, name)]).toEqual([name, true]);
      expect([name, (await call(a, name, args)).error]).toEqual([name, { code: 'act-required' }]);
    }
  });
});

describe('`fs.tasks` on the `task-list` rule', () => {
  const tasks = (listId: string, fields: Record<string, unknown> = {}) => at({ listId, ...fields });

  it('admits the session’s own list, its status’s `taskListId` as the engine names its directory', async () => {
    const { f, s, a } = await setup();
    s.taskListId = 'team list/1';
    const from = f.host.calls.length;
    const answered = await call(a, 'fs.tasks', tasks('team-list-1'));
    expect(answered.ok === true || !AUTHORIZATION.includes(codeOf(answered)!)).toBe(true);
    expect(asked(f, from)).toEqual([...PLACEMENT, ['engine-host', 'session.status'], ['engine-host', 'fs.tasks']]);
  });

  it('refuses another list `no-target`, and reads none', async () => {
    const { f, s, a } = await setup();
    s.taskListId = 'eng-app-1';
    for (const listId of ['eng-app-2', 'team-list-1', '']) {
      const refused = await call(a, 'fs.tasks', tasks(listId));
      expect([listId, codeOf(refused)]).toEqual([listId, 'no-target']);
    }
    expect(f.host.calls.some((c) => c.name === 'fs.tasks')).toBe(false);
  });

  it('refuses a call naming no session `no-target`', async () => {
    const { f, a } = await setup();
    expect(codeOf(await call(a, 'fs.tasks', { listId: 'eng-app-1' }))).toBe('no-target');
    expect(f.host.calls.some((c) => c.name === 'fs.tasks')).toBe(false);
  });

  it('refuses every list before a status names one (the engine has not said its id) `no-target`', async () => {
    const { f, s, a } = await setup();
    s.taskListId = null;
    expect(codeOf(await call(a, 'fs.tasks', tasks('eng-app-1')))).toBe('no-target');
    expect(f.host.calls.some((c) => c.name === 'fs.tasks')).toBe(false);
  });

  it('reads the list of a session the engine host holds no row for from its record’s engine session', async () => {
    const f = await startEndpoint(org, started);
    f.spine.set(APP, 'eng.app:1');
    f.records.set({ lane: 'B', session: 'eng.app:1', owners: ['@machine'] }, APP);
    const a = await openRemote(f, org.a1, org.A);
    const answered = await call(a, 'fs.tasks', tasks('eng-app-1'));
    expect(answered.ok === true || !AUTHORIZATION.includes(codeOf(answered)!)).toBe(true);
    expect(f.host.calls.some((c) => c.name === 'fs.tasks')).toBe(true);
    expect(codeOf(await call(a, 'fs.tasks', tasks('eng.app:1')))).toBe('no-target');
  });

  it('refuses a caller who holds nothing on the session `grade`, whatever list it names, before any list is read', async () => {
    const { f, s, b } = await setup();
    s.taskListId = 'eng-app-1';
    for (const listId of ['eng-app-1', 'another']) {
      const from = f.host.calls.length;
      expect([listId, codeOf(await call(b, 'fs.tasks', tasks(listId)))]).toEqual([listId, 'grade']);
      expect([listId, asked(f, from)]).toEqual([listId, PLACEMENT]);
    }
  });
});
