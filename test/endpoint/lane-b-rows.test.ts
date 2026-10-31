// The offer rows of lane B's conversation (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, §L's M2
// rows; Constraints: "the offer table is the only door, and each row is tested"). Each name a remote pane reads or acts
// with is admitted for a caller who holds its grade on the session (A, an owner of the machine, so of its sessions) and
// reaches its row's executor by its own name; a caller who holds nothing on it (B) is refused `grade` and reaches
// nothing past the session's placement. Reads cross as calls,
// effects as acts: each act row refuses a call (`act-required`).
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

/** M2's reads: O10's kept, the pane's, and the spine's three. */
const CALLS: Record<string, Record<string, unknown>> = {
  'session.events': at({ afterSeq: null, limit: null }),
  'session.status': at(),
  'session.pendingRequest': at({ requestId: 'r1' }),
  'session.pendingItems': at(),
  'session.queue.list': at(),
  'session.catalog': at(),
  'session.getContextUsage': at({ detail: 'summary' }),
  'session.getUsage': at(),
  'session.getWorkspaceDiff': at(),
  'session.getSettings': at(),
  'session.listModels': at(),
  'session.listPermissionRules': at(),
  'session.getStatus': at(),
  'session.mcpStatus': at(),
  'session.getSessionCost': at(),
  'session.get': at(),
  'session.appEvents': at(),
  'session.history.list': at({ limit: 20 }),
};

/** M2's acts: the conversation, the queue and the chips through the engine host's ledger, and the resume through the services'. */
const ACTS: Record<string, Record<string, unknown>> = {
  'session.send': at({ content: 'hi' }),
  'session.steer': at({ content: 'and then' }),
  'session.interrupt': at({ cancelEngineQueued: false }),
  'session.answer': at({ requestId: 'r1', answer: { kind: 'question', answers: { 'Which way?': 'left' } } }),
  'session.queue.edit': at({ queueId: 'q1', content: 'edited' }),
  'session.queue.promote': at({ queueId: 'q1' }),
  'session.queue.setPaused': at({ paused: true }),
  'session.queue.hold': at({ messageUuid: 'm1' }),
  'session.queue.remove': at({ queueId: 'q1' }),
  'session.setModel': at({ model: 'opus' }),
  'session.setEffort': at({ effort: null }),
  'session.setThinking': at({ maxThinkingTokens: null, display: null }),
  'session.setPermissionMode': at({ mode: 'default' }),
  'session.stopTask': at({ taskId: 't1' }),
  'session.sideQuestion': at({ question: 'why?' }),
  'session.mcpToggle': at({ serverName: 'files', enabled: false }),
  'session.mcpReconnect': at({ serverName: 'files' }),
  'session.rewind': at({ targetMessageUuid: 'm1', lastSeenMessageUuid: 'm2', files: false }),
  'session.rewindFiles': at({ userMessageUuid: 'm1', dryRun: true }),
  'session.forget': at(),
  'session.setKeep': at({ keep: true }),
  'session.generateTitle': at({ description: 'a title', persist: false }),
  'session.acquire': at({ reason: 'send' }),
};

async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}

/** A live lane B session the machine's owners own, with its record in the spine and its member record. */
async function setup(): Promise<{ f: Fixture; s: HostSession; a: Remote; b: Remote }> {
  const f = await startEndpoint(org, started);
  const s = f.host.add(APP);
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

/** Whether an act named `name` was handed to its executor's ledger (`host.op`, `machine.op`). */
const ran = (f: Fixture, name: string) => f.host.calls.some((c) => (c.name === 'host.op' || c.name === 'machine.op') && (c.input as { name?: string }).name === name);
/** Refusals that say a request never reached its executor. */
const AUTHORIZATION = ['grade', 'not-offered', 'act-required', 'ungraded', 'no-target', 'no-rule', 'malformed', 'class'];

describe('lane B’s offer rows (M2)', () => {
  it('are offered, each as its kind, executor and target', () => {
    for (const name of Object.keys(CALLS)) expect([name, OFFERS.commands[name]]).toEqual([name, { kind: 'call', executor: name === 'session.get' || name === 'session.appEvents' || name === 'session.history.list' ? 'machine' : 'engine-host', target: 'appSessionId' }]);
    for (const name of Object.keys(ACTS)) expect([name, OFFERS.commands[name]]).toEqual([name, { kind: 'act', executor: name === 'session.acquire' ? 'machine' : 'engine-host', target: 'appSessionId' }]);
  });

  it('take inputs the registry’s schemas hold (so what follows is about the grade alone)', () => {
    for (const [name, input] of [...Object.entries(CALLS), ...Object.entries(ACTS)]) expect([name, validateCommandInput(name as CommandName, input).ok]).toEqual([name, true]);
  });

  it('admit each read for a caller who views the session, and refuse it for one who doesn’t', async () => {
    const { f, a, b } = await setup();
    for (const [name, input] of Object.entries(CALLS)) {
      let from = f.host.calls.length;
      const refused = await call(b, name, input);
      expect([name, refused.ok, (refused.error as { code?: string } | undefined)?.code]).toEqual([name, false, 'grade']);
      expect([name, asked(f, from)]).toEqual([name, PLACEMENT]);
      // Admitted: placed, then run by its row's executor under its own name, once (the fakes answer some reads
      // `unknown_command`, which passes through).
      from = f.host.calls.length;
      const answered = await call(a, name, input);
      expect([name, answered.ok === true || !AUTHORIZATION.includes((answered.error as { code: string }).code)]).toEqual([name, true]);
      expect([name, asked(f, from)]).toEqual([name, [...PLACEMENT, [OFFERS.commands[name].executor, name]]]);
    }
  });

  it('admit each act for a caller who holds its grade, handed to its executor, and refuse it, unrun, for one who doesn’t', async () => {
    const { f, s, a, b } = await setup();
    const context = { lane: 'B' as const, launchId: s.launchId, engineSessionId: s.engineSessionId! };
    for (const [name, args] of Object.entries(ACTS)) {
      const machine = name === 'session.acquire';
      const fields = { machine: f.ref, action: name, args, ...(machine ? {} : { session: APP, context }) };
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
