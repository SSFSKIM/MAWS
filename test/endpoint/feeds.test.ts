// Feeds (P5 O7 M4, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, §R, "Changes cross as a feed, and a
// reconnect invalidates"): a session's `checkout` feed carries the spine's `files.changed` and `scm.remote.output` naming
// the session and the `git.changed` of the repositories in its checkout bounds, each an `ev {name, payload}` at the next
// `seq` after a `subbed` snapshot with nothing to snap. It is authorized as a subscription of the session (`view`), lives
// with its channel, and a watch the channel's requests installed on the machine ends with the channel's ref, so the
// files service holds nothing for a device that is gone.
//
// P5 O7 M6 (§R, "The feed", "The each-session rule"): the machine's `attention` feed, admitted at `list` for any member,
// opens as a snapshot of `attention.list` cut to the sessions the member views and follows that set across every record
// change: a session that leaves it is emptied, one that joins shows its items at once, and nothing of a session the
// member can't view goes, however a change of rights and a change of items interleave. `attention.list` and
// `session.search` are answered the same cut.
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { gradeOf } from '@shared/ipc/grades';
import { OFFERS } from '../../src/endpoint/offers';
import type { AllowlistRecord } from '../../src/services/files/allowlist';
import { registerFilesHandlers } from '../../src/services/files/register';
import { iso } from './org-fixtures';
import { evs, makeOrg, of, openRemote, snapshot, snapshots, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

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

function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'feeds-')));
  dirs.push(dir);
  return dir;
}

/** A lane B session the machine's owners own, rooted at `directory`. */
function session(f: Fixture, appSessionId: string, directory: string, additionalDirectories: string[] = []): Record<string, unknown> {
  const record = f.spine.set(appSessionId, `eng-${appSessionId}`, { appId: appSessionId, directory, additionalDirectories, worktree: null });
  f.records.set({ lane: 'B', session: `eng-${appSessionId}`, owners: ['@machine'] }, appSessionId);
  return record;
}

async function feed(r: Remote, sub: string, session: { lane: 'A' | 'B'; id: string } | null, kind: 'checkout' | 'attention' = 'checkout'): Promise<Msg> {
  const from = r.inbox.length;
  await r.channel.send({ t: 'sub', sub, feed: kind, ...(session === null ? {} : { session }), cursor: null, credit: 4 * 1024 * 1024 });
  return waitFor(r, (m) => m.sub === sub && (m.t === 'subbed' || m.t === 'ended'), `the answer to feed ${sub}`, from);
}

async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}

const status = (repoRoot: string) => ({ repoRoot, branch: 'main', files: [] });
const names = (r: Remote, sub: string): Array<[string, Record<string, unknown>]> => evs(r, sub).map((e) => [(e.body as { name: string }).name, (e.body as { payload: Record<string, unknown> }).payload]);
/** The feed's `git.changed`s alone (a change of roots is a `session.changed`, which the feed carries too). */
const gits = (r: Remote, sub: string) => names(r, sub).filter(([name]) => name === 'git.changed');

describe('a session’s checkout feed', () => {
  it('opens as a snapshot with nothing to snap, then carries its session’s files and scm changes and its repositories’ git changes, each at the next seq', async () => {
    const repo = scratch();
    const other = scratch();
    mkdirSync(join(repo, 'pkg'));
    const f = await startEndpoint(org, started);
    session(f, 'app-1', join(repo, 'pkg'));
    f.spine.handle('git.status', () => status(repo)); // the root's repository: the directory above it
    const a = await openRemote(f, org.a1, org.A);

    const subbed = await feed(a, 'f1', { lane: 'B', id: 'app-1' });
    expect(subbed).toMatchObject({ t: 'subbed', mode: 'snapshot', seq: 0 });
    expect(subbed.epoch).toMatch(/^checkout:/);
    await until(() => f.host.calls.some((c) => c.name === 'git.status'), 'the bounds read');

    const files = { appSessionId: 'app-1', path: join(repo, 'pkg', 'a.ts'), kind: 'created' };
    const scm = { appSessionId: 'app-1', token: randomUUID(), seq: 1, kind: 'stdout', text: 'pushed' };
    f.host.emitMachine('files.changed', { ...files, appSessionId: 'app-2' });
    f.host.emitMachine('files.changed', files);
    f.host.emitMachine('scm.remote.output', scm);
    f.host.emitMachine('scm.remote.output', { ...scm, appSessionId: 'app-2' });
    f.host.emitMachine('git.changed', { repoRoot: other, status: status(other), reason: 'fs' });
    f.host.emitMachine('git.changed', { repoRoot: repo, status: status(repo), reason: 'fs' });
    f.host.emitMachine('git.changed', { repoRoot: join(repo, '.claude', 'worktrees', 'wt'), status: status(join(repo, '.claude', 'worktrees', 'wt')), reason: 'fs' });
    f.host.emitMachine('git.changed', { repoRoot: `${repo}-sibling`, status: status(`${repo}-sibling`), reason: 'fs' });
    // An engine host event is lane B's stream's, never a feed's.
    f.host.attach(true);
    f.host.emit('session.eventBatch', { appSessionId: 'app-1', events: [] });

    await until(() => evs(a, 'f1').length >= 4, 'the feed’s events');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(evs(a, 'f1').map((e) => [e.epoch, e.seq])).toEqual([1, 2, 3, 4].map((seq) => [subbed.epoch, seq]));
    expect(names(a, 'f1')).toEqual([
      ['files.changed', files],
      ['scm.remote.output', scm],
      ['git.changed', { repoRoot: repo, status: status(repo), reason: 'fs' }],
      ['git.changed', { repoRoot: join(repo, '.claude', 'worktrees', 'wt'), status: status(join(repo, '.claude', 'worktrees', 'wt')), reason: 'fs' }],
    ]);
    expect(of(a, 'f1').filter((m) => m.t === 'snap')).toEqual([]);
    // A feed is no interest in the session's stream.
    expect(f.interest.filter(([kind, , sessions]) => kind === 'report' && (sessions ?? []).includes('app-1'))).toEqual([]);
  });

  it('holds a git change that comes before its bounds are read, and follows the session’s roots as its record changes', async () => {
    const repo = scratch();
    const added = scratch();
    const f = await startEndpoint(org, started);
    const record = session(f, 'app-1', repo);
    let answer: () => void = () => {};
    const answered = new Promise<void>((resolve) => (answer = resolve));
    f.spine.handle('git.status', async (input) => {
      await answered;
      return status((input as { directory: string }).directory);
    });
    const a = await openRemote(f, org.a1, org.A);
    await feed(a, 'f1', { lane: 'B', id: 'app-1' });
    await until(() => f.host.calls.some((c) => c.name === 'git.status'), 'the bounds read begun');
    f.host.emitMachine('git.changed', { repoRoot: repo, status: status(repo), reason: 'first' });
    f.host.emitMachine('git.changed', { repoRoot: repo, status: status(repo), reason: 'fs' });
    f.host.emitMachine('git.changed', { repoRoot: added, status: status(added), reason: 'fs' });
    expect(evs(a, 'f1')).toEqual([]);
    answer();
    // The latest per repository, once its bounds are known; the other repository isn't the session's.
    await until(() => evs(a, 'f1').length === 1, 'the held change');
    expect(names(a, 'f1')).toEqual([['git.changed', { repoRoot: repo, status: status(repo), reason: 'fs' }]]);

    f.host.emitMachine('session.changed', { record: { ...record, additionalDirectories: [added] }, cause: 'updated', revision: 2 });
    await until(() => f.host.calls.some((c) => c.name === 'git.status' && (c.input as { directory: string }).directory === added), 'the new root’s repository read');
    await new Promise((resolve) => setTimeout(resolve, 20));
    f.host.emitMachine('git.changed', { repoRoot: added, status: status(added), reason: 'fs' });
    await until(() => gits(a, 'f1').length === 2, 'the added repository’s change');
    expect(gits(a, 'f1')[1]).toEqual(['git.changed', { repoRoot: added, status: status(added), reason: 'fs' }]);
  });

  // Fix wave 1: while a change of roots is read, the old bounds no longer stand and the new ones don't yet.
  it('across a change of roots, delivers neither the old repository’s changes nor drops the new one’s, and takes only the latest read', async () => {
    const [repoA, repoB, repoC, repoD] = [scratch(), scratch(), scratch(), scratch()];
    const f = await startEndpoint(org, started);
    const record = session(f, 'app-1', repoA);
    const gates = new Map<string, Promise<void>>();
    const open = new Map<string, () => void>();
    const gate = (dir: string) => gates.set(dir, new Promise<void>((resolve) => open.set(dir, resolve)));
    f.spine.handle('git.status', async (input) => {
      const { directory } = input as { directory: string };
      await gates.get(directory);
      return status(directory);
    });
    const a = await openRemote(f, org.a1, org.A);
    await feed(a, 'f1', { lane: 'B', id: 'app-1' });
    const changed = (repoRoot: string, reason: string) => f.host.emitMachine('git.changed', { repoRoot, status: status(repoRoot), reason });
    changed(repoA, 'before');
    await until(() => evs(a, 'f1').length === 1, 'A’s change under the first bounds');

    // A is removed and B added; B's repository read is held.
    gate(repoB);
    f.host.emitMachine('session.changed', { record: { ...record, directory: repoB }, cause: 'updated', revision: 2 });
    changed(repoA, 'during');
    changed(repoB, 'during');
    await until(() => f.host.calls.some((c) => c.name === 'git.status' && (c.input as { directory: string }).directory === repoB), 'B’s read begun');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(gits(a, 'f1')).toHaveLength(1);
    open.get(repoB)!();
    await until(() => gits(a, 'f1').length === 2, 'B’s held change');
    expect(gits(a, 'f1')[1]).toEqual(['git.changed', { repoRoot: repoB, status: status(repoB), reason: 'during' }]);

    // Two changes in a row: the older read (to D, held) lands after the newer (to C): the bounds are C's.
    gate(repoD);
    f.host.emitMachine('session.changed', { record: { ...record, directory: repoD }, cause: 'updated', revision: 3 });
    f.host.emitMachine('session.changed', { record: { ...record, directory: repoC }, cause: 'updated', revision: 4 });
    await until(() => f.host.calls.some((c) => c.name === 'git.status' && (c.input as { directory: string }).directory === repoC), 'C’s read');
    await new Promise((resolve) => setTimeout(resolve, 20));
    open.get(repoD)!();
    await until(() => f.host.calls.filter((c) => c.name === 'git.status' && (c.input as { directory: string }).directory === repoD).length === 1, 'D’s read');
    await new Promise((resolve) => setTimeout(resolve, 20));
    changed(repoD, 'after');
    changed(repoA, 'after');
    changed(repoB, 'after');
    changed(repoC, 'after');
    await until(() => gits(a, 'f1').length === 3, 'C’s change');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(gits(a, 'f1').slice(2)).toEqual([['git.changed', { repoRoot: repoC, status: status(repoC), reason: 'after' }]]);
  });

  // P5 O7 M4 (O5's landing audit): the record is how a device learns that a session it holds no live stream of runs again
  // (its holder `self`, a new engine session), without placing it on the engine host or reporting interest.
  it('carries its session’s record changes, and no other session’s, without reading the engine host or reporting interest', async () => {
    const repo = scratch();
    const f = await startEndpoint(org, started);
    const record = session(f, 'app-1', repo);
    session(f, 'app-2', repo);
    f.spine.handle('git.status', () => status(repo));
    const a = await openRemote(f, org.a1, org.A);
    await feed(a, 'f1', { lane: 'B', id: 'app-1' });
    await until(() => f.host.calls.some((c) => c.name === 'git.status'), 'the bounds read');
    const engineReads = f.host.calls.filter((c) => c.name === 'session.status').length;
    const live = { record: { ...record, holder: { kind: 'self' } }, cause: 'live', revision: 2 };
    f.host.emitMachine('session.changed', { record: { ...record, appId: 'app-2', holder: { kind: 'self' } }, cause: 'live', revision: 2 });
    f.host.emitMachine('session.changed', live);
    await until(() => evs(a, 'f1').length >= 1, 'the record’s change');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(names(a, 'f1')).toEqual([['session.changed', live]]);
    expect(f.host.calls.filter((c) => c.name === 'session.status')).toHaveLength(engineReads);
    expect(f.interest.filter(([kind, , sessions]) => kind === 'report' && (sessions ?? []).includes('app-1'))).toEqual([]);
  });

  it('is refused to a caller who can’t view the session, and for a lane A session', async () => {
    const repo = scratch();
    const f = await startEndpoint(org, started);
    session(f, 'app-1', repo);
    const [a, b] = [await openRemote(f, org.a1, org.A), await openRemote(f, org.b1, org.B)];
    expect(await feed(b, 'f1', { lane: 'B', id: 'app-1' })).toMatchObject({ t: 'ended', reason: 'grade' });
    expect(await feed(a, 'f2', { lane: 'A', id: 'la-1' })).toMatchObject({ t: 'ended', reason: 'no-target' });
    // B's events reach no one who was refused.
    f.host.emitMachine('files.changed', { appSessionId: 'app-1', path: join(repo, 'x'), kind: 'created' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(evs(b, 'f1')).toEqual([]);
  });

  it('ends `behind` when the device leaves more than its backlog unread, as a lane B stream does', async () => {
    const repo = scratch();
    const f = await startEndpoint(org, started, { subscriptions: { backlogBytes: 2048 } });
    session(f, 'app-1', repo);
    const a = await openRemote(f, org.a1, org.A);
    const from = a.inbox.length;
    await a.channel.send({ t: 'sub', sub: 'f1', feed: 'checkout', session: { lane: 'B', id: 'app-1' }, cursor: null, credit: 1 });
    await waitFor(a, (m) => m.sub === 'f1' && m.t === 'subbed', 'the feed opened', from);
    for (let i = 0; i < 40; i++) f.host.emitMachine('files.changed', { appSessionId: 'app-1', path: join(repo, `f${i}.ts`), kind: 'created' });
    expect(await waitFor(a, (m) => m.sub === 'f1' && m.t === 'ended', 'the feed’s end', from)).toMatchObject({ reason: 'behind' });
  });

  it('ends `removed` when the caller no longer views the session', async () => {
    const repo = scratch();
    const f = await startEndpoint(org, started);
    session(f, 'app-1', repo);
    const a = await openRemote(f, org.a1, org.A);
    await feed(a, 'f1', { lane: 'B', id: 'app-1' });
    f.records.set({ lane: 'B', session: 'eng-app-1', owners: [org.B], access: 'private' }, 'app-1');
    await waitFor(a, (m) => m.sub === 'f1' && m.t === 'ended', 'the feed’s end');
    expect(of(a, 'f1').at(-1)).toMatchObject({ t: 'ended', reason: 'removed' });
  });
});

// ---- P5 O7 M6: attention and search ----------------------------------------------------------------------------------

type Item = Record<string, unknown>;

const AT = iso(Date.UTC(2026, 10, 1));

/** An attention item of `appSessionId`, a request waiting. */
function att(appSessionId: string, requestId: string): Item {
  const at = AT;
  return { id: `att-${requestId}`, appSessionId, sessionId: `eng-${appSessionId}`, kind: 'permission', request: { requestId, toolUseId: `tu-${requestId}`, taskId: null, agentId: null }, summary: 'permission', createdAt: at, state: 'pending', stateChangedAt: at, expiresAt: null };
}

/**
 * The machine's attention service, as the spine answers `attention.list` and emits `attention.changed` (owner `machine`).
 * `hold` keeps the next `attention.list` answer (computed when asked) until its release, as a read in flight.
 */
function machineAttention(f: Fixture) {
  const items = new Map<string, Item[]>();
  let held: Promise<void> | null = null;
  f.spine.handle('attention.list', async () => {
    const answer = [...items.values()].flat();
    if (held !== null) await held;
    return answer;
  });
  return {
    /** The session's items now, with no event (as before the endpoint heard of them). */
    seed(appSessionId: string, list: Item[]): void {
      items.set(appSessionId, list);
    },
    /** The session's items change: `attention.changed`. */
    set(appSessionId: string, list: Item[]): void {
      if (list.length === 0) items.delete(appSessionId);
      else items.set(appSessionId, list);
      f.host.emitMachine('attention.changed', { appSessionId, items: list, silent: [] });
    },
    hold(): () => void {
      let release: () => void = () => {};
      held = new Promise<void>((resolve) => (release = resolve));
      return () => {
        held = null;
        release();
      };
    },
  };
}

/** A lane B session in the machine's index and its record: the machine's owners own it, and `B` holds `share` (none: `listed`, so `list`). */
function shared(f: Fixture, appSessionId: string, share: 'view' | 'converse' | null, member: string = org.B): void {
  if (!f.spine.records.has(appSessionId)) f.spine.set(appSessionId, `eng-${appSessionId}`, { appId: appSessionId });
  f.records.set({ lane: 'B', session: `eng-${appSessionId}`, owners: ['@machine'], ...(share === null ? {} : { shares: [{ member, grade: share }] }) }, appSessionId);
}

/** The feed opened, and the snapshot this opening sent (its pages may follow its `subbed`). */
async function attentionFeed(r: Remote, sub: string): Promise<{ subbed: Msg; snap: Item[] }> {
  const from = r.inbox.length;
  const subbed = await feed(r, sub, null, 'attention');
  if (subbed.t !== 'subbed') return { subbed, snap: [] };
  const snap = await snapshot(r, sub, from);
  return { subbed, snap: snap.body as unknown as Item[] };
}

const bodies = (r: Remote, sub: string, from = 0) => evs(r, sub, from).map((e) => e.body as { appSessionId: string; items: Item[] });
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const engineReads = (f: Fixture) => f.host.calls.filter((c) => c.owner === 'engine-host').length;

describe('the machine’s attention feed', () => {
  it('opens as a snapshot of the items of the sessions the member views, then carries each change of such a session at the next seq, and nothing of another', async () => {
    const f = await startEndpoint(org, started);
    const machine = machineAttention(f);
    shared(f, 'app-1', 'view');
    shared(f, 'app-2', null); // listed: B holds `list`, below `view`
    machine.seed('app-1', [att('app-1', 'r1')]);
    machine.seed('app-2', [att('app-2', 'r2')]);
    const engine = engineReads(f);
    const [a, b] = [await openRemote(f, org.a1, org.A), await openRemote(f, org.b1, org.B)];

    const opened = await attentionFeed(b, 'att');
    expect(opened.subbed).toMatchObject({ t: 'subbed', mode: 'snapshot', seq: 0 });
    expect(opened.subbed.epoch).toMatch(/^attention:/);
    expect(opened.snap).toEqual([att('app-1', 'r1')]);
    expect(of(b, 'att').filter((m) => m.t === 'snap').every((m) => m.epoch === opened.subbed.epoch && m.seq === 0)).toBe(true);
    // The owner views both.
    expect((await attentionFeed(a, 'att')).snap).toEqual([att('app-1', 'r1'), att('app-2', 'r2')]);

    machine.set('app-2', [att('app-2', 'r2'), att('app-2', 'r3')]);
    machine.set('app-1', []);
    machine.set('app-1', [att('app-1', 'r4')]);
    await until(() => evs(b, 'att').length >= 2 && evs(a, 'att').length >= 3, 'the changes');
    await settle();
    expect(evs(b, 'att').map((e) => [e.epoch, e.seq])).toEqual([1, 2].map((seq) => [opened.subbed.epoch, seq]));
    expect(bodies(b, 'att')).toEqual([
      { appSessionId: 'app-1', items: [] },
      { appSessionId: 'app-1', items: [att('app-1', 'r4')] },
    ]);
    expect(bodies(a, 'att').map((body) => body.appSessionId)).toEqual(['app-2', 'app-1', 'app-1']);
    // Neither the feed nor its rule reads the engine host (which would wake a parked one), nor reports interest.
    expect(engineReads(f)).toBe(engine);
    expect(f.interest.filter(([kind, , sessions]) => kind === 'report' && (sessions ?? []).length > 0)).toEqual([]);
  });

  it('answers a resubscribe, and a new channel, with the snapshot again, as things stand then', async () => {
    const f = await startEndpoint(org, started);
    const machine = machineAttention(f);
    shared(f, 'app-1', 'view');
    machine.seed('app-1', [att('app-1', 'r1')]);
    const b = await openRemote(f, org.b1, org.B);
    const first = await attentionFeed(b, 'att');
    machine.set('app-1', [att('app-1', 'r1'), att('app-1', 'r2')]);
    await until(() => evs(b, 'att').length === 1, 'the change');

    const from = b.inbox.length;
    const again = await attentionFeed(b, 'att');
    expect(again.subbed).toMatchObject({ t: 'subbed', mode: 'snapshot', seq: 0, epoch: first.subbed.epoch });
    expect(snapshots(b, 'att')).toHaveLength(2);
    expect(again.snap).toEqual([att('app-1', 'r1'), att('app-1', 'r2')]);
    expect(of(b, 'att', from).filter((m) => m.t === 'ended')).toEqual([]);

    b.channel.close('closed');
    const b2 = await openRemote(f, org.b1, org.B);
    expect((await attentionFeed(b2, 'att')).snap).toEqual([att('app-1', 'r1'), att('app-1', 'r2')]);
  });

  it('empties a session whose share is withdrawn, and keeps the feed and the other session', async () => {
    const f = await startEndpoint(org, started);
    const machine = machineAttention(f);
    shared(f, 'app-1', 'view');
    shared(f, 'app-3', 'converse');
    machine.seed('app-1', [att('app-1', 'r1')]);
    machine.seed('app-3', [att('app-3', 'r3')]);
    const b = await openRemote(f, org.b1, org.B);
    expect((await attentionFeed(b, 'att')).snap).toEqual([att('app-1', 'r1'), att('app-3', 'r3')]);

    shared(f, 'app-1', null);
    await until(() => evs(b, 'att').length === 1, 'the withdrawn session emptied');
    expect(bodies(b, 'att')).toEqual([{ appSessionId: 'app-1', items: [] }]);
    machine.set('app-1', [att('app-1', 'r1'), att('app-1', 'r5')]);
    machine.set('app-3', [att('app-3', 'r3'), att('app-3', 'r6')]);
    await until(() => evs(b, 'att').length === 2, 'the other session’s change');
    await settle();
    expect(bodies(b, 'att')[1]).toEqual({ appSessionId: 'app-3', items: [att('app-3', 'r3'), att('app-3', 'r6')] });
    expect(evs(b, 'att')).toHaveLength(2);
    expect(of(b, 'att').filter((m) => m.t === 'ended')).toEqual([]);
  });

  it('shows a session’s waiting permission at once when it is shared, with no reconnect', async () => {
    const f = await startEndpoint(org, started);
    const machine = machineAttention(f);
    shared(f, 'app-1', 'view');
    shared(f, 'app-2', null);
    machine.seed('app-1', [att('app-1', 'r1')]);
    const b = await openRemote(f, org.b1, org.B);
    expect((await attentionFeed(b, 'att')).snap).toEqual([att('app-1', 'r1')]);
    // A permission raised on a session B can't view yet: not delivered.
    machine.set('app-2', [att('app-2', 'r2')]);
    await settle();
    expect(evs(b, 'att')).toEqual([]);

    shared(f, 'app-2', 'view');
    await until(() => evs(b, 'att').length === 1, 'the shared session’s items');
    expect(bodies(b, 'att')).toEqual([{ appSessionId: 'app-2', items: [att('app-2', 'r2')] }]);
    expect(snapshots(b, 'att')).toHaveLength(1);
  });

  it('is an open, empty feed for a member who views nothing, which fills at the first share', async () => {
    const f = await startEndpoint(org, started);
    const machine = machineAttention(f);
    shared(f, 'app-1', null);
    machine.seed('app-1', [att('app-1', 'r1')]);
    const b = await openRemote(f, org.b1, org.B);
    const opened = await attentionFeed(b, 'att');
    expect(opened.subbed).toMatchObject({ t: 'subbed', mode: 'snapshot' });
    expect(opened.snap).toEqual([]);
    machine.set('app-1', [att('app-1', 'r1'), att('app-1', 'r2')]);
    await settle();
    expect(of(b, 'att').filter((m) => m.t === 'ev' || m.t === 'ended')).toEqual([]);

    shared(f, 'app-1', 'view');
    await until(() => evs(b, 'att').length === 1, 'the first share’s items');
    expect(bodies(b, 'att')).toEqual([{ appSessionId: 'app-1', items: [att('app-1', 'r1'), att('app-1', 'r2')] }]);
  });

  it('loses no item and leaks none when record changes and attention changes interleave', async () => {
    const f = await startEndpoint(org, started);
    const machine = machineAttention(f);
    shared(f, 'app-1', 'view');
    machine.seed('app-1', [att('app-1', 'r1')]);
    const b = await openRemote(f, org.b1, org.B);
    await attentionFeed(b, 'att');

    machine.set('app-1', [att('app-1', 'r1'), att('app-1', 'r2')]);
    shared(f, 'app-1', null);
    machine.set('app-1', [att('app-1', 'r1'), att('app-1', 'r2'), att('app-1', 'r3')]); // B can't view it now
    shared(f, 'app-1', 'view');
    machine.set('app-1', [att('app-1', 'r3')]);
    await until(() => evs(b, 'att').length >= 4, 'the interleaved changes');
    await settle();
    expect(bodies(b, 'att')).toEqual([
      { appSessionId: 'app-1', items: [att('app-1', 'r1'), att('app-1', 'r2')] },
      { appSessionId: 'app-1', items: [] },
      { appSessionId: 'app-1', items: [att('app-1', 'r1'), att('app-1', 'r2'), att('app-1', 'r3')] },
      { appSessionId: 'app-1', items: [att('app-1', 'r3')] },
    ]);
  });

  it('delivers nothing of a session first heard while its placement is read, once the share is withdrawn before the read lands', async () => {
    const f = await startEndpoint(org, started);
    const machine = machineAttention(f);
    shared(f, 'app-1', 'view');
    shared(f, 'app-4', 'view');
    const b = await openRemote(f, org.b1, org.B);
    await attentionFeed(b, 'att');
    // The spine's `session.get` of app-4 held.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const dispatch = f.spine.dispatch.bind(f.spine);
    f.spine.dispatch = async (name, input, client) => {
      if (name === 'session.get' && (input as { appSessionId?: string }).appSessionId === 'app-4') await held;
      return dispatch(name, input, client);
    };
    machine.set('app-4', [att('app-4', 'r4')]);
    await until(() => f.host.calls.some((c) => c.name === 'session.get' && (c.input as { appSessionId: string }).appSessionId === 'app-4'), 'app-4 placed');
    shared(f, 'app-4', null);
    release();
    await settle();
    expect(evs(b, 'att')).toEqual([]);
    shared(f, 'app-4', 'view');
    await until(() => evs(b, 'att').length === 1, 'app-4 shared again');
    expect(bodies(b, 'att')).toEqual([{ appSessionId: 'app-4', items: [att('app-4', 'r4')] }]);
  });

  it('cuts its snapshot to the rights that stand when it goes, not those when its read began', async () => {
    const f = await startEndpoint(org, started);
    const machine = machineAttention(f);
    shared(f, 'app-1', 'view');
    shared(f, 'app-2', null);
    machine.seed('app-1', [att('app-1', 'r1')]);
    machine.seed('app-2', [att('app-2', 'r2')]);
    const b = await openRemote(f, org.b1, org.B);
    const release = machine.hold();
    const from = b.inbox.length;
    await b.channel.send({ t: 'sub', sub: 'att', feed: 'attention', cursor: null, credit: 4 * 1024 * 1024 });
    await until(() => f.host.calls.some((c) => c.name === 'attention.list'), 'the snapshot’s read');
    shared(f, 'app-1', null); // withdrawn while the read is out
    shared(f, 'app-2', 'view'); // granted while the read is out
    release();
    const snap = await until(() => snapshots(b, 'att').at(-1), 'the snapshot');
    expect(snap).toEqual([att('app-2', 'r2')]);
    await settle();
    expect(of(b, 'att', from).filter((m) => m.t === 'ev')).toEqual([]);
  });

  it('is refused to a web-cards device, and ends `behind` past its backlog', async () => {
    const f = await startEndpoint(org, started, { subscriptions: { backlogBytes: 2048 } });
    const machine = machineAttention(f);
    shared(f, 'app-1', 'view');
    machine.seed('app-1', [att('app-1', 'r0')]); // placed at the opening, so each change goes as it comes
    const c = await openRemote(f, org.c1, org.C, { passkey: org.passkey });
    expect(await feed(c, 'att', null, 'attention')).toMatchObject({ t: 'ended', reason: 'class' });
    const b = await openRemote(f, org.b1, org.B);
    const from = b.inbox.length;
    await b.channel.send({ t: 'sub', sub: 'att', feed: 'attention', cursor: null, credit: 1 });
    await waitFor(b, (m) => m.sub === 'att' && m.t === 'snap', 'the snapshot', from);
    for (let i = 0; i < 40; i++) machine.set('app-1', [att('app-1', `r${i}`)]);
    expect(await waitFor(b, (m) => m.sub === 'att' && m.t === 'ended', 'the feed’s end', from)).toMatchObject({ reason: 'behind' });
  });
});

describe('the each-session calls', () => {
  it('are offered as machine calls under the `each-session` rule, admitted at `list`', () => {
    for (const name of ['attention.list', 'session.search']) expect([name, OFFERS.commands[name]]).toEqual([name, { kind: 'call', executor: 'machine', target: 'each-session', grade: 'list' }]);
    expect(gradeOf('attention.list')).toBe('view');
    expect(gradeOf('session.search')).toBe('view');
  });

  it('answer `attention.list` and `session.search` cut to the sessions the caller views, and hold their input to the registry’s schema', async () => {
    const f = await startEndpoint(org, started);
    const machine = machineAttention(f);
    shared(f, 'app-1', 'view');
    shared(f, 'app-2', null);
    f.spine.set('app-5', null, { appId: 'app-5' }); // no engine session recorded: nobody's to rank
    machine.seed('app-1', [att('app-1', 'r1')]);
    machine.seed('app-2', [att('app-2', 'r2')]);
    machine.seed('app-5', [att('app-5', 'r5')]);
    machine.seed('app-9', [att('app-9', 'r9')]); // no record at all
    const hits = [
      { appSessionId: 'app-1', snippet: 'one' },
      { appSessionId: 'app-2', snippet: 'two' },
      { appSessionId: 'app-9', snippet: 'nine' },
    ];
    const searched: unknown[] = [];
    f.spine.handle('session.search', (input) => (searched.push(input), { hits, indexing: false, incomplete: true }));
    const engine = engineReads(f);
    const [a, b, c] = [await openRemote(f, org.a1, org.A), await openRemote(f, org.b1, org.B), await openRemote(f, org.c1, org.C, { passkey: org.passkey })];

    expect(await call(b, 'attention.list', null)).toMatchObject({ ok: true, output: [att('app-1', 'r1')] });
    expect(await call(a, 'attention.list', null)).toMatchObject({ ok: true, output: [att('app-1', 'r1'), att('app-2', 'r2')] });
    expect(await call(b, 'session.search', { query: 'word' })).toMatchObject({ ok: true, output: { hits: [hits[0]], indexing: false, incomplete: true } });
    expect(await call(a, 'session.search', { query: 'word' })).toMatchObject({ ok: true, output: { hits: [hits[0], hits[1]], indexing: false, incomplete: true } });
    expect(searched).toEqual([{ query: 'word' }, { query: 'word' }]);

    // A share withdrawn: the next answer leaves the session out.
    shared(f, 'app-1', null);
    expect(await call(b, 'attention.list', null)).toMatchObject({ ok: true, output: [] });
    expect(await call(b, 'session.search', { query: 'word' })).toMatchObject({ ok: true, output: { hits: [] } });

    // The registry's schema, though the row carries its own grade; a web-cards device is refused by its class.
    expect(await call(b, 'session.search', { query: 5 })).toMatchObject({ ok: false, error: { code: 'malformed' } });
    expect(await call(b, 'session.search', { query: 'word', extra: 1 })).toMatchObject({ ok: false, error: { code: 'malformed' } });
    expect(await call(b, 'attention.list', { appSessionId: 'app-1' })).toMatchObject({ ok: false, error: { code: 'malformed' } });
    expect(searched).toHaveLength(3);
    expect(await call(c, 'attention.list', null)).toMatchObject({ ok: false, error: { code: 'class' } });
    expect(engineReads(f)).toBe(engine);
  });
});

describe('a watch the channel installed', () => {
  it('reports its changes on the feed, and is released when the channel closes (its ref ended), leaving nothing in the files service', async () => {
    const repo = scratch();
    mkdirSync(join(repo, 'src'));
    const f = await startEndpoint(org, started);
    session(f, 'app-1', repo);
    f.spine.handle('git.status', () => status(repo));
    const roots = new Map<string, AllowlistRecord>([['app-1', { directory: repo, additionalDirectories: [], worktree: null }]]);
    const files = registerFilesHandlers((id) => roots.get(id) ?? null, {
      bus: f.spine.bus as never,
      emit: (payload) => f.host.emitMachine('files.changed', payload),
      port: { openExternal: async () => ({ opened: false, message: null }), reveal: async () => ({ revealed: false }) } as never,
      env: {},
    });
    try {
      const a = await openRemote(f, org.a1, org.A);
      await feed(a, 'f1', { lane: 'B', id: 'app-1' });
      expect(await call(a, 'files.watch', { appSessionId: 'app-1', path: join(repo, 'src') })).toMatchObject({ ok: true });
      expect(files.watching()).toEqual([join(repo, 'src')]);
      expect(files.followed.size).toBe(1);

      writeFileSync(join(repo, 'src', 'new.ts'), 'export {};\n');
      await until(() => names(a, 'f1').some(([name, payload]) => name === 'files.changed' && payload.path === join(repo, 'src', 'new.ts')), 'the watched directory’s change on the feed', 5000);

      a.channel.close('closed');
      await until(() => files.followed.size === 0 && files.watching().length === 0, 'the closed channel’s watch released');
    } finally {
      files.dispose();
    }
  });
});
