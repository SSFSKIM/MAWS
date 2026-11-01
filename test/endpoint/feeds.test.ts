// Feeds (P5 O7 M4, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, §R, "Changes cross as a feed, and a
// reconnect invalidates"): a session's `checkout` feed carries the spine's `files.changed` and `scm.remote.output` naming
// the session and the `git.changed` of the repositories in its checkout bounds, each an `ev {name, payload}` at the next
// `seq` after a `subbed` snapshot with nothing to snap. It is authorized as a subscription of the session (`view`), lives
// with its channel, and a watch the channel's requests installed on the machine ends with the channel's ref, so the
// files service holds nothing for a device that is gone.
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AllowlistRecord } from '../../src/services/files/allowlist';
import { registerFilesHandlers } from '../../src/services/files/register';
import { evs, makeOrg, of, openRemote, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

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

  it('is refused to a caller who can’t view the session, for a lane A session, and as an attention feed (not offered until M6)', async () => {
    const repo = scratch();
    const f = await startEndpoint(org, started);
    session(f, 'app-1', repo);
    const [a, b] = [await openRemote(f, org.a1, org.A), await openRemote(f, org.b1, org.B)];
    expect(await feed(b, 'f1', { lane: 'B', id: 'app-1' })).toMatchObject({ t: 'ended', reason: 'grade' });
    expect(await feed(a, 'f2', { lane: 'A', id: 'la-1' })).toMatchObject({ t: 'ended', reason: 'no-target' });
    expect(await feed(a, 'f3', null, 'attention')).toMatchObject({ t: 'ended', reason: 'not-offered' });
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
