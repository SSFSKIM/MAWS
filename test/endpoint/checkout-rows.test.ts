// The offer rows of a remote session's checkout and spawn (P5 O7 M4, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// §L's M4 rows; Constraints: "the offer table is the only door, and each row is tested"). Each name is admitted for a
// caller who holds its grade and reaches its row's executor by its own name; a caller who doesn't is refused before it
// reaches anything. The files and scm reads name their session; git's reads name a directory in the session the call
// names (`call.session`, the `checkout` rule); the writes are `machine` acts under the services' ledger, which keeps the
// sealed action beside each claim but an upload's; `session.spawn` is a step-up act graded `spawn`; the machine menu's
// `session.projects.list` is a `list` read any native device may make.
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Action } from 'org-protocol';
import type { CommandName } from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import { KEPT_WITHOUT_ACTION } from '../../src/endpoint/actions';
import { OFFERS } from '../../src/endpoint/offers';
import { act, CHECKOUT, makeOrg, openRemote, sminos, startEndpoint, stopAll, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];
const dirs: string[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  await stopAll(started);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(() => stopAll(started));

const APP = 'app-1';
const SESSION = { lane: 'B' as const, id: APP };
const at = (fields: Record<string, unknown> = {}) => ({ appSessionId: APP, ...fields });
/** A remote run's token (any UUID; minted here so no literal looks like a key). */
const TOKEN = randomUUID();
const HASH = '0'.repeat(64);

/** The checkout's reads that name their session (`appSessionId`). */
const SESSION_CALLS: Record<string, Record<string, unknown>> = {
  'files.list': at(),
  'files.read': at({ path: 'README.md' }),
  'files.watch': at({ path: '' }),
  'files.unwatch': at({ path: '' }),
  'scm.status': at(),
  'scm.push.plan': at(),
  'scm.pr.plan': at({ title: 'A change', body: '', base: 'main', draft: false }),
  'scm.remote.last': at(),
  'scm.pr.state': at({ refresh: false }),
  'fs.agentEvents': at({ agentId: 'agent-1' }),
};

/** git's reads, each naming a path in the session's checkout (filled in per test: its directory's realpath). */
const gitCalls = (dir: string): Record<string, Record<string, unknown>> => ({
  'git.status': { directory: join(dir, 'src') },
  'git.branches': { directory: dir },
  'git.diff': { directory: dir, scope: 'all' },
  'git.log': { directory: dir, limit: 5 },
  'git.watch': { directory: dir },
  'git.unwatch': { directory: dir },
  'git.lsFiles': { directory: dir, query: 'read', limit: 10 },
  'git.worktree.list': { repoRoot: dir },
  'git.worktree.status': { repoRoot: dir, path: dir },
  'git.worktree.branch': { repoRoot: dir, branch: 'main' },
});

/** The checkout's writes, `machine` acts placed by their session. */
const ACTS: Record<string, Record<string, unknown>> = {
  'files.write': at({ path: 'README.md', content: 'hello\n', expectedHash: HASH }),
  'files.upload': at({ files: [{ name: 'notes.txt', bytes: Buffer.from('notes\n').toString('base64') }] }),
  'scm.stage': at({ paths: ['README.md'] }),
  'scm.unstage': at({ paths: ['README.md'] }),
  'scm.discard': at({ entries: [{ path: 'README.md', group: 'unstaged' }] }),
  'scm.commit': at({ message: 'A change', noVerify: false }),
  'scm.push': at({ token: TOKEN }),
  'scm.pr.create': at({ token: TOKEN }),
  'scm.remote.cancel': at({ token: TOKEN }),
};

const SPAWN = { checkout: CHECKOUT, permission_mode: 'default' };

async function call(r: Remote, name: string, input: unknown, fields: Record<string, unknown> = {}): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input, ...fields });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}

const code = (m: Msg) => (m.ok === true ? 'ok' : (m.error as { code: string }).code);
/** Refusals that say a request never reached its executor. */
const AUTHORIZATION = ['grade', 'not-offered', 'act-required', 'ungraded', 'no-target', 'no-rule', 'malformed', 'class'];

/** A live lane B session the machine's owners own, its record rooted at a real directory, git answering for it there. */
async function setup(): Promise<{ f: Fixture; dir: string; a: Remote; b: Remote }> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'checkout-rows-')));
  dirs.push(dir);
  mkdirSync(join(dir, 'src'));
  const f = await startEndpoint(org, started);
  const s = f.host.add(APP);
  f.spine.set(APP, s.engineSessionId, { appId: APP, directory: dir, additionalDirectories: [], worktree: null });
  f.records.set({ lane: 'B', session: s.engineSessionId!, owners: ['@machine'] }, APP);
  // The services answer each name with what it was asked (git.status with the repository its directory is in).
  for (const name of [...Object.keys(SESSION_CALLS), ...Object.keys(gitCalls(dir)), ...Object.keys(ACTS), 'session.spawn', 'session.projects.list']) {
    f.spine.handle(name, (input) => (name === 'git.status' ? { repoRoot: dir } : name === 'session.spawn' ? { status: 'ok', appSessionId: 'app-new' } : { asked: name, input }));
  }
  return { f, dir, a: await openRemote(f, org.a1, org.A), b: await openRemote(f, org.b1, org.B) };
}

/** Each dispatch of `name` to `owner` with `input`, from `from` on. */
const reached = (f: Fixture, from: number, owner: string, name: string, input?: unknown) =>
  f.host.calls.slice(from).filter((c) => c.owner === owner && c.name === name && (input === undefined || JSON.stringify(c.input) === JSON.stringify(input)));
/** The `machine.op` dispatches of act `name`, from `from` on. */
const claims = (f: Fixture, from: number, name: string) => f.host.calls.slice(from).filter((c) => c.name === 'machine.op' && (c.input as { name?: string }).name === name);

async function admittedAct(f: Fixture, r: Remote, action: Action): Promise<unknown> {
  const from = r.inbox.length;
  expect([action.action, await act(r, action)]).toEqual([action.action, 'ok']);
  return (await waitFor(r, (m) => m.t === 'done' && m.opId === action.opId, `the done of ${action.action}`, from)).outcome;
}

describe('the checkout’s offer rows (M4)', () => {
  it('are offered, each as its kind, executor and target', () => {
    const dir = '/w';
    for (const name of Object.keys(SESSION_CALLS)) expect([name, OFFERS.commands[name]]).toEqual([name, { kind: 'call', executor: name === 'fs.agentEvents' ? 'engine-host' : 'machine', target: 'appSessionId' }]);
    for (const name of Object.keys(gitCalls(dir))) expect([name, OFFERS.commands[name]]).toEqual([name, { kind: 'call', executor: 'machine', target: 'checkout' }]);
    for (const name of Object.keys(ACTS)) expect([name, OFFERS.commands[name]]).toEqual([name, { kind: 'act', executor: 'machine', target: 'appSessionId' }]);
    expect(OFFERS.commands['session.spawn']).toEqual({ kind: 'act', executor: 'machine', target: 'machine' });
    expect(OFFERS.commands['session.projects.list']).toEqual({ kind: 'call', executor: 'machine', target: 'machine' });
    expect(OFFERS.feeds).toEqual(['checkout']);
  });

  it('leave unoffered what the spec keeps local or for later', () => {
    for (const name of ['git.worktree.add', 'git.worktree.remove', 'git.worktree.deleteBranch', 'fs.holders', 'fs.readSpill', 'files.reveal', 'files.openExternal', 'files.readResolved', 'session.create', 'session.launch']) {
      expect([name, Object.hasOwn(OFFERS.commands, name)]).toEqual([name, false]);
    }
  });

  it('take inputs the registry’s schemas hold (so what follows is about the grade and the target alone)', () => {
    for (const [name, input] of [...Object.entries(SESSION_CALLS), ...Object.entries(gitCalls('/w')), ...Object.entries(ACTS), ['session.spawn', SPAWN] as const]) {
      expect([name, validateCommandInput(name as CommandName, input).ok]).toEqual([name, true]);
    }
  });

  it('admit each session read for a caller who views the session, and refuse it, unread, for one who doesn’t', async () => {
    const { f, a, b } = await setup();
    for (const [name, input] of Object.entries(SESSION_CALLS)) {
      const owner = OFFERS.commands[name].executor;
      let from = f.host.calls.length;
      expect([name, code(await call(b, name, input))]).toEqual([name, 'grade']);
      expect([name, reached(f, from, owner, name)]).toEqual([name, []]);
      from = f.host.calls.length;
      const answered = await call(a, name, input);
      // The engine host's fake answers fs.agentEvents `unknown_command`, which passes through: it was reached.
      expect([name, answered.ok === true || !AUTHORIZATION.includes(code(answered))]).toEqual([name, true]);
      expect([name, reached(f, from, owner, name, input).length]).toEqual([name, 1]);
    }
  });

  it('admit each git read naming a path in the session’s checkout for its viewer, and refuse it, unread, for one who holds nothing', async () => {
    const { f, dir, a, b } = await setup();
    for (const [name, input] of Object.entries(gitCalls(dir))) {
      let from = f.host.calls.length;
      expect([name, code(await call(b, name, input, { session: SESSION }))]).toEqual([name, 'grade']);
      // Below its floor the caller learns nothing of the session: not its checkout, not its repository.
      expect([name, reached(f, from, 'machine', 'git.status'), reached(f, from, 'machine', name)]).toEqual([name, [], []]);
      from = f.host.calls.length;
      const answered = await call(a, name, input, { session: SESSION });
      expect([name, code(answered)]).toEqual([name, 'ok']);
      expect([name, reached(f, from, 'machine', name, input).length]).toEqual([name, 1]);
    }
  });

  it('admit each write for a caller who holds `manage` on the session, the sealed action kept with its claim but an upload’s, and refuse it, unrun, for one who doesn’t', async () => {
    const { f, a, b } = await setup();
    for (const [name, args] of Object.entries(ACTS)) {
      let from = f.host.calls.length;
      expect([name, await act(b, b.device.action({ machine: f.ref, action: name, args }))]).toEqual([name, 'grade']);
      expect([name, claims(f, from, name)]).toEqual([name, []]);
      from = f.host.calls.length;
      const admitted = a.device.action({ machine: f.ref, action: name, args });
      expect([name, await admittedAct(f, a, admitted)]).toEqual([name, { state: 'done', result: { asked: name, input: args } }]);
      const [claim] = claims(f, from, name);
      expect([name, (claim.input as { action?: unknown }).action]).toEqual([name, KEPT_WITHOUT_ACTION.has(name) ? undefined : admitted]);
      expect([name, code(await call(a, name, args))]).toEqual([name, 'act-required']);
    }
    expect([...KEPT_WITHOUT_ACTION]).toEqual(['files.upload']);
  });

  it('admit `session.spawn` for a member who may spawn, stepped up, its sealed action handed to the spawn with its claim; refuse it for one who may not, and unstepped', async () => {
    const { f, a, b } = await setup();
    await sminos(f); // the machine's presence names CHECKOUT, a checkout a spawn may run in
    let from = f.host.calls.length;
    expect(await act(b, await b.device.stepUp(b.device.action({ machine: f.ref, action: 'session.spawn', args: SPAWN })))).toBe('grade');
    expect(await act(a, a.device.action({ machine: f.ref, action: 'session.spawn', args: SPAWN }))).toBe('step-up');
    expect(claims(f, from, 'session.spawn')).toEqual([]);
    from = f.host.calls.length;
    const spawn = await a.device.stepUp(a.device.action({ machine: f.ref, action: 'session.spawn', args: SPAWN }));
    expect(await admittedAct(f, a, spawn)).toEqual({ state: 'done', result: { status: 'ok', appSessionId: 'app-new' } });
    expect(f.spine.claimed.at(-1)).toMatchObject({ name: 'session.spawn', op: { opId: spawn.opId, member: org.A, device: 'a1', action: spawn } });
    expect(claims(f, from, 'session.spawn')).toHaveLength(1);
    expect(code(await call(a, 'session.spawn', SPAWN))).toBe('act-required');
  });

  it('admit `session.projects.list` (`list`) for any native device, and refuse it a web-cards device', async () => {
    const { f, a, b } = await setup();
    const c = await openRemote(f, org.c1, org.C, { passkey: org.passkey });
    let from = f.host.calls.length;
    expect(code(await call(c, 'session.projects.list', null))).toBe('class');
    expect(reached(f, from, 'machine', 'session.projects.list')).toEqual([]);
    for (const r of [a, b]) {
      from = f.host.calls.length;
      expect(code(await call(r, 'session.projects.list', null))).toBe('ok');
      expect(reached(f, from, 'machine', 'session.projects.list')).toHaveLength(1);
    }
  });
});

// An older peer behind the endpoint. The services `machine.op` reaches are this build's own (`mawsd`'s process), so
// `action`, an upload's `part` and `session.spawn` always land where they are read; the engine host may be an older
// build `mawsd` serves while it has sessions live (its build policy), and one at wire minor 12 refuses `session.events`'
// byte budget as `invalid_input`, which passes through as its own code, so the device reads the page again unbudgeted.
describe('an older engine host behind the endpoint', () => {
  it('answers a budgeted history read `invalid_input`, its own code, and the unbudgeted read as before', async () => {
    const { f, a } = await setup();
    const answer = f.host.answer.bind(f.host);
    f.host.answer = (owner, name, input) =>
      name === 'session.events' && (input as { maxBytes?: number }).maxBytes !== undefined ? { t: 'res', id: '0', ok: false, error: { code: 'invalid_input', message: 'maxBytes: unrecognized key' } } : answer(owner, name, input);
    expect(await call(a, 'session.events', at({ afterSeq: null, limit: null, maxBytes: 1024 * 1024 }))).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await call(a, 'session.events', at({ afterSeq: null, limit: null }))).toMatchObject({ ok: true, output: { events: [] } });
  });
});
