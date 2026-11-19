// The four acts on a file outside a session's folders, as another machine's endpoint offers them (UX wave U6f,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, condition (a), decisions 1 and 2, §C;
// M2's "The rows", "The run", "No rank on the session", "The capability"; R1). Each of `files.readOutside`,
// `files.listOutside`, `files.chooseOutside` and `files.writeOutside` takes `pty.spawn`'s own row and grade, by two
// functions run over them (`outsideRows`, `outsideGrades`), and is decided by the grading function as it stands.
//
// - The differential: for every caller of the table (outside-world.ts) and every kind of request, the decision on each of
//   the four is the decision on `pty.spawn` from the same caller, word for word, across every refusal the function gives.
// - The follow: the two production functions over a changed `pty.spawn` (its grade moved; apart, its row marked the
//   owners'), handed to the authorizer through its seams and asked through its ordinary lookup: a caller who passed is
//   refused on all five alike.
// - No copy: the four rows, the four grade lines and the shared module hold the word for the terminal's grade nowhere.
// - Through a started endpoint (sub-harness.ts): the act reaches the services' ledger as a claimed act; a member with the
//   right and no rank on the session is admitted, and their query refused (point 8); a decision that no longer stands is
//   taken again (R1); the capability is listed, and withheld under the e2e's seam.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keyId, signRecord, SIGNING_DOMAINS, type Action, type Grant } from 'org-protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OUTSIDE_ACTS, OUTSIDE_FILES_CAPABILITY, TERMINAL_ACT } from '@shared/files/outside';
import { gradeOf, type GradeSpec } from '@shared/ipc/grades';
import { outsideGrades } from '@shared/ipc/grades/files';
import { ENDPOINT_CAPABILITIES } from '../../src/endpoint/capabilities';
import { OFFERS, READ_OPENS, outsideRows, type OfferRow, type Offers } from '../../src/endpoint/offers';
import { STREAM_ACTS } from '../../src/endpoint/streams';
import { INPUTS, outsideWorld, type Caller, type World } from './outside-world';
import { iso } from './org-fixtures';
import { act, done, makeOrg, openRemote, ORG, startEndpoint, stopAll, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

const FIVE = [TERMINAL_ACT, ...OUTSIDE_ACTS];

describe('the four rows', () => {
  it('are each pty.spawn’s row as the table holds it, with the machine’s services as its executor', () => {
    const terminal = OFFERS.commands[TERMINAL_ACT];
    expect(terminal).toBeDefined();
    for (const name of OUTSIDE_ACTS) expect([name, OFFERS.commands[name]]).toEqual([name, { ...terminal, executor: 'machine' }]);
    // condition (b): the grant stays main's own; a choice from another machine is its own act, which the daemon records
    expect(Object.hasOwn(OFFERS.commands, 'files.grant')).toBe(false);
  });

  it('are made by outsideRows from the row it is handed, whatever that row holds', () => {
    const changed: OfferRow = { kind: 'act', executor: 'pty-host', target: 'machine', grade: 'machine-admin', owners: true };
    expect(outsideRows(changed)).toEqual(Object.fromEntries(OUTSIDE_ACTS.map((name) => [name, { ...changed, executor: 'machine' }])));
  });

  it('are graded by the value pty.spawn’s declaration holds', () => {
    for (const name of OUTSIDE_ACTS) expect([name, gradeOf(name)]).toEqual([name, gradeOf(TERMINAL_ACT)]);
    expect(outsideGrades('machine-admin')).toEqual(Object.fromEntries(OUTSIDE_ACTS.map((name) => [name, 'machine-admin'])));
  });

  it('open no stream: no stream kind names one of the four as its act, and no read open is one of them', () => {
    const streamed = new Set([...Object.values(STREAM_ACTS).flat(), ...Object.values(READ_OPENS)]);
    expect(OUTSIDE_ACTS.filter((name) => streamed.has(name))).toEqual([]);
    expect(streamed.has(TERMINAL_ACT)).toBe(true); // the terminal's bytes ride a stream opened under its spawn
  });
});

// condition (a): the same function, the same answers
describe('the differential: each of the four is decided as pty.spawn from the same caller', () => {
  const answers = async (world: World, caller: Caller, kind: 'act' | 'call' | 'stream') => {
    const binding = { member: caller.member, device: caller.device.device.id };
    return Promise.all(FIVE.map(async (name) => [name, await world.decide(name, caller, kind === 'stream' ? binding : INPUTS[name], kind)] as const));
  };

  /** Each of the four answered pty.spawn's decision; that decision, for the table of what was asked. */
  async function same(world: World, caller: Caller, kind: 'act' | 'call' | 'stream' = 'act'): Promise<unknown> {
    const [[, terminal], ...outside] = await answers(world, caller, kind);
    for (const [name, decision] of outside) expect([caller.name, kind, name, decision]).toEqual([caller.name, kind, name, terminal]);
    return terminal;
  }
  const word = (decision: unknown) => ((decision as { ok: boolean; reason?: string }).ok ? 'ok' : (decision as { reason: string }).reason);

  it('for every caller of the table, as an act, across every refusal the function gives', async () => {
    const world = await outsideWorld();
    const { owner, shell, shellSteppedUp, spawnOnly, viewOnly, webCards, removed } = world.callers;
    const words: Record<string, string> = {};
    for (const caller of [owner, shell, shellSteppedUp, spawnOnly, viewOnly, webCards, removed]) words[caller.name] = word(await same(world, caller));
    // what pty.spawn answered, so the table is known to span admission and each refusal
    expect(words).toEqual({
      [owner.name]: 'ok',
      [shell.name]: 'step-up',
      [shellSteppedUp.name]: 'ok',
      [spawnOnly.name]: 'grade',
      [viewOnly.name]: 'grade',
      [webCards.name]: 'class',
      [removed.name]: 'removed',
    });
  });

  it('on a machine in read-only mode, and under a head too old for actions', async () => {
    const readOnly = await outsideWorld({ readOnly: true });
    expect(word(await same(readOnly, readOnly.callers.owner))).toBe('read-only');
    expect(word(await same(readOnly, readOnly.callers.shellSteppedUp))).toBe('read-only');
    const tooOld = await outsideWorld({ tooOld: true });
    expect(word(await same(tooOld, tooOld.callers.owner))).toBe('state-too-old');
    // the control: the same callers on an ordinary machine are admitted
    const ordinary = await outsideWorld();
    expect(word(await same(ordinary, ordinary.callers.owner))).toBe('ok');
  });

  it('as a call (act-required) and as a stream’s binding, for each caller', async () => {
    const world = await outsideWorld();
    for (const caller of Object.values(world.callers)) {
      expect([caller.name, word(await same(world, caller, 'call'))]).toEqual([caller.name, 'act-required']);
      await same(world, caller, 'stream');
    }
  });

  it('refuses an input its own schema refuses `malformed`, beside the same act without the key', async () => {
    const world = await outsideWorld();
    for (const name of OUTSIDE_ACTS) {
      expect([name, word(await world.decide(name, world.callers.owner, { ...INPUTS[name], extra: true }))]).toEqual([name, 'malformed']);
      expect([name, word(await world.decide(name, world.callers.owner))]).toEqual([name, 'ok']);
    }
    // `files.readOutside` takes neither of `files.read`'s keys that ask: it always asks, and no raw read crosses a link
    expect(word(await world.decide('files.readOutside', world.callers.owner, { ...INPUTS['files.readOutside'], named: true }))).toBe('malformed');
    expect(word(await world.decide('files.readOutside', world.callers.owner, { ...INPUTS['files.readOutside'], raw: true }))).toBe('malformed');
  });
});

// condition (a)'s follow, the review's finding 6: the derivation moves with pty.spawn, read through the ordinary lookup
describe('the follow: a change of pty.spawn’s row or grade moves the four with it', () => {
  /** The table and the grades the two production functions make of a changed pty.spawn; nothing written for the four. */
  function changedTables(row: OfferRow, grade: GradeSpec): { offers: Offers; gradeOf(name: string): GradeSpec | undefined } {
    const offers: Offers = { ...OFFERS, commands: { ...OFFERS.commands, [TERMINAL_ACT]: row, ...outsideRows(row) } };
    const moved: Record<string, GradeSpec> = { [TERMINAL_ACT]: grade, ...outsideGrades(grade) };
    return { offers, gradeOf: (name) => (Object.hasOwn(moved, name) ? moved[name] : gradeOf(name)) };
  }
  const words = async (world: World, caller: Caller) =>
    Promise.all(
      FIVE.map(async (name) => {
        const decision = await world.decide(name, caller);
        return [name, decision.ok ? 'ok' : decision.reason];
      }),
    );

  it('refuses on all five alike a caller who passed, once the terminal’s grade moves to machine-admin', async () => {
    const before = await outsideWorld();
    expect(await words(before, before.callers.shellSteppedUp)).toEqual(FIVE.map((name) => [name, 'ok']));
    const after = await outsideWorld(changedTables(OFFERS.commands[TERMINAL_ACT]!, 'machine-admin'));
    expect(await words(after, after.callers.shellSteppedUp)).toEqual(FIVE.map((name) => [name, 'grade']));
  });

  it('refuses on all five alike a caller who passed, once the terminal’s row is the owners’; an owner still passes', async () => {
    const after = await outsideWorld(changedTables({ ...OFFERS.commands[TERMINAL_ACT]!, owners: true }, gradeOf(TERMINAL_ACT)!));
    expect(await words(after, after.callers.shellSteppedUp)).toEqual(FIVE.map((name) => [name, 'owners-only']));
    expect(await words(after, after.callers.owner)).toEqual(FIVE.map((name) => [name, 'ok']));
  });
});

// condition (a)'s "no copy": nothing of this landing compares a right with the terminal's word
describe('no copy of the terminal’s grade', () => {
  const read = (path: string) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8');
  const SHELL = /\bshell\b/;

  it('in the shared module of the four names', () => {
    expect(read('src/shared/files/outside.ts')).not.toMatch(SHELL);
  });

  // M3 (Decision Log 25): main's adapter for the four, which decides when a request becomes one of them
  it('in main’s adapter for the four', () => {
    const adapter = read('src/main/lane-b/remote-outside-files.ts');
    expect(adapter).toContain('outsideOffer');
    expect(adapter).not.toMatch(SHELL);
  });

  // M4 (Decision Log 25): the window's module that says which sessions take the remote route and words what is offered there
  it('in the window’s module for a session on another machine', () => {
    const window = read('src/renderer/src/tools/code/files/elsewhere.ts');
    expect(window).toContain('disabledWords');
    expect(window).not.toMatch(SHELL);
  });

  it('in the four rows and the four grade lines', () => {
    const offers = read('src/endpoint/offers.ts');
    const rows = offers.slice(offers.indexOf('export const outsideRows'), offers.indexOf(';', offers.indexOf('export const outsideRows')) + 1);
    expect(rows).toContain('OUTSIDE_ACTS');
    expect(rows).not.toMatch(SHELL);
    expect(offers.split('\n').filter((line) => line.includes('outsideRows(') && !line.includes('export const'))).toEqual([expect.not.stringMatching(SHELL)]);
    const files = read('src/shared/ipc/grades/files.ts');
    const grades = files.split('\n').filter((line) => line.includes('outsideGrades'));
    expect(grades.length).toBeGreaterThanOrEqual(2); // the function and its one use
    for (const line of grades) expect(line).not.toMatch(SHELL);
  });
});

// ---- Through a started endpoint ---------------------------------------------------------------------------------------

let org: Org;
const started: Fixture[] = [];
beforeAll(async () => {
  org = await makeOrg();
});
afterEach(() => stopAll(started));
afterAll(() => stopAll(started));

const APP = 'app-elsewhere';
const ANSWERS: Record<string, unknown> = {
  'files.readOutside': { encoding: 'utf8', content: 'an invented line\n', bytes: 17, offset: 0, length: 17, truncated: false, mime: 'text/plain', hash: null, utf8: null, named: true, outside: { real: '/srv/elsewhere/notes.txt', writable: true } },
  'files.listOutside': { status: 'listed', path: '/srv/elsewhere', parent: '/srv', home: '/home/someone', entries: [], cursor: null },
  'files.chooseOutside': { status: 'granted', path: '/srv/elsewhere/notes.txt' },
  'files.writeOutside': { status: 'ok', hash: 'b'.repeat(64) },
};

/** An endpoint whose services answer the four with stand-ins; B holds a `shell` grant; the session has a record A owns. */
async function setup() {
  const f = await startEndpoint(org, started);
  f.spine.set(APP, `eng-${APP}`, { appId: APP });
  f.records.set({ lane: 'B', session: `eng-${APP}`, owners: [org.A], access: 'private' }, APP);
  for (const name of OUTSIDE_ACTS) f.spine.handle(name, () => ANSWERS[name]);
  return f;
}

async function grant(f: Fixture, member: string, rights: Grant['rights'], version = 1): Promise<void> {
  const body: Grant = { org: f.org ?? ORG, machine: f.ref, machineKey: await keyId(f.key.pub), member, rights, version, issued: iso(Date.now()) };
  const out = await f.endpoint.cli('grant', ['-'], JSON.stringify(await signRecord(SIGNING_DOMAINS.grant, body, org.a1.stepUp.privateKey, org.a1.stepUp.pub)));
  expect(out.code, out.out).toBe(0);
}

const outside = (f: Fixture, r: Remote, name: string): Action => r.device.action({ machine: f.ref, action: name, args: { ...INPUTS[name], appSessionId: APP } });
const claimed = (f: Fixture) => f.spine.claimed.filter((c) => (OUTSIDE_ACTS as readonly string[]).includes(c.name));

async function query(r: Remote, action: Action): Promise<Msg> {
  const from = r.inbox.length;
  await r.channel.send({ t: 'query', opId: action.opId, opCreated: action.opCreated, executor: 'machine' });
  return waitFor(r, (m) => m.t === 'queried' && m.opId === action.opId, `the answer to a query of ${action.action}`, from);
}

describe('the run, through the endpoint’s act path', () => {
  it('hands each admitted act to machine.op with the channel’s member and device, the sealed action beside the read, the listing and the choice, none beside the save', async () => {
    const f = await setup();
    const a = await openRemote(f, org.a1, org.A);
    for (const name of OUTSIDE_ACTS) {
      const action = outside(f, a, name);
      const from = a.inbox.length;
      expect([name, await act(a, action)]).toEqual([name, 'ok']);
      expect([name, await done(a, action, from)]).toEqual([name, { state: 'done', result: ANSWERS[name] }]);
    }
    expect(claimed(f).map((c) => [c.name, c.op?.member, c.op?.device, c.op?.action === undefined ? 'no action' : 'action'])).toEqual([
      ['files.readOutside', org.A, 'a1', 'action'],
      ['files.listOutside', org.A, 'a1', 'action'],
      ['files.chooseOutside', org.A, 'a1', 'action'],
      ['files.writeOutside', org.A, 'a1', 'no action'],
    ]);
  });
});

// point 8: no rank on the session is asked beyond the terminal's row; a lost answer's query takes `view` on the session
describe('no rank on the session', () => {
  it('admits a member with the right and no rank on the session as pty.spawn admits them, and refuses their query `grade`', async () => {
    const f = await setup();
    await grant(f, org.B, ['shell']);
    const b = await openRemote(f, org.b1, org.B);
    const a = await openRemote(f, org.a1, org.A);
    expect(await act(b, await b.device.stepUp(b.device.action({ machine: f.ref, action: TERMINAL_ACT, args: INPUTS[TERMINAL_ACT] })))).toBe('ok');
    for (const name of OUTSIDE_ACTS) {
      const action = await b.device.stepUp(outside(f, b, name));
      const from = b.inbox.length;
      expect([name, await act(b, action)]).toEqual([name, 'ok']);
      await done(b, action, from);
      // such a member's lost answer stays unconfirmed (the next press settles it): the query asks `view` on the session
      expect([name, await query(b, action)]).toEqual([name, expect.objectContaining({ state: 'refused', reason: 'grade' })]);
    }
    expect(claimed(f).map((c) => c.op?.member)).toEqual(OUTSIDE_ACTS.map(() => org.B));
    // the control: the owner's own operation is answered
    const own = outside(f, a, 'files.chooseOutside');
    const from = a.inbox.length;
    expect(await act(a, own)).toBe('ok');
    await done(a, own, from);
    expect(await query(a, own)).toMatchObject({ state: 'done' });
  });
});

// R1: the endpoint admitted an outside act; before the services take it, the member's grant is withdrawn
describe('a decision that no longer stands', () => {
  it('is taken again, once, and refused, running nothing; the act left standing runs', async () => {
    const f = await setup();
    let version = 0;
    await grant(f, org.B, ['shell'], ++version);
    const b = await openRemote(f, org.b1, org.B);
    const authorize = f.endpoint.authorizer.authorize.bind(f.endpoint.authorizer);
    let withdraw: string | null = null;
    f.endpoint.authorizer.authorize = (request, who, now) =>
      authorize(request, who, now).then(async (decision) => {
        if (request.kind === 'act' && request.name === withdraw) {
          withdraw = null;
          await grant(f, org.B, ['spawn'], ++version); // the shell right withdrawn between the decision and the hand-off
        }
        return decision;
      });
    for (const name of OUTSIDE_ACTS) {
      withdraw = name;
      expect([name, await act(b, await b.device.stepUp(outside(f, b, name)))]).toEqual([name, 'grade']);
      expect(withdraw).toBeNull();
      await grant(f, org.B, ['shell'], ++version);
    }
    expect(claimed(f)).toEqual([]);
    // the control: with nothing withdrawn, the same member's act runs
    const standing = await b.device.stepUp(outside(f, b, 'files.readOutside'));
    const from = b.inbox.length;
    expect(await act(b, standing)).toBe('ok');
    expect(await done(b, standing, from)).toMatchObject({ state: 'done' });
    expect(claimed(f).map((c) => c.name)).toEqual(['files.readOutside']);
  });
});

describe('the capability', () => {
  it('is listed by this build, in its handshake', async () => {
    expect(ENDPOINT_CAPABILITIES).toContain(OUTSIDE_FILES_CAPABILITY);
    const f = await setup();
    expect((await openRemote(f, org.a1, org.A)).channel.peer.capabilities).toContain(OUTSIDE_FILES_CAPABILITY);
  });

  it('is withheld by the e2e’s old-endpoint seam, under MAWS_E2E alone, as every capability is', async () => {
    const old = await startEndpoint(org, started, { env: { MAWS_E2E: '1', MAWS_E2E_ENDPOINT_WITHOUT: OUTSIDE_FILES_CAPABILITY } });
    const caps = (await openRemote(old, org.a1, org.A)).channel.peer.capabilities;
    expect(caps).not.toContain(OUTSIDE_FILES_CAPABILITY);
    expect(caps).toContain('rl2.git-reads');
    const unset = await startEndpoint(org, started, { env: { MAWS_E2E_ENDPOINT_WITHOUT: OUTSIDE_FILES_CAPABILITY } });
    expect((await openRemote(unset, org.a1, org.A)).channel.peer.capabilities).toContain(OUTSIDE_FILES_CAPABILITY);
  });
});
