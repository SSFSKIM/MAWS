// The `checkout` target rule and the spawn guard (P5 O7 M4, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "The checkout rule and its boundary" and "`session.spawn`"), over the machine's real git, worktree and upload services
// behind the endpoint harness's spine. git's reads name a path, never their session: the call's `session` names it, and
// the path must lie in one of the session's roots or the repository a root belongs to, so the boundary a reader gets is
// the repository with its worktrees; what a worktree read names beyond that the service bounds itself. A spawn's args
// hold to the registry's schema (step 2), then to the machine's policy (step 6's guard, as `sminos.spawn`'s).
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { keyId, signRecord, SIGNING_DOMAINS, type Action, type Grant } from 'org-protocol';
import type { HandlerContext } from '@shared/ipc/client';
import { REMOTE_UPLOAD_PART_BYTES, type FilesUploadInput } from '@shared/ipc/schema/files';
import { createUpload } from '../../src/services/files/upload';
import { registerGitHandlers } from '../../src/services/git/register';
import { createGitRunner } from '../../src/services/git/runner';
import { GitService } from '../../src/services/git/service';
import { WorktreeService } from '../../src/services/git/worktrees';
import { registerWorktreeHandlers } from '../../src/services/git/worktrees-register';
import { record as sessionRecord } from '../support/builders';
import { fakeSpineView } from '../support/fake-spine-view';
import { GitFixture } from '../support/git-fixture';
import { iso } from './org-fixtures';
import { act, CHECKOUT, makeOrg, openRemote, ORG, sminos, startEndpoint, stopAll, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];
const repos: GitFixture[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  await stopAll(started);
  for (const repo of repos.splice(0)) repo.dispose();
});
afterAll(() => stopAll(started));

async function repo(): Promise<GitFixture> {
  const r = await GitFixture.create();
  repos.push(r);
  return r;
}

async function call(r: Remote, name: string, input: unknown, session?: { lane: 'A' | 'B'; id: string }): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input, ...(session === undefined ? {} : { session }) });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}

const code = (m: Msg) => (m.ok === true ? 'ok' : (m.error as { code: string }).code);
const B = (id: string) => ({ lane: 'B' as const, id });

/** The endpoint, with the machine's real git and worktree handlers behind its spine, git confined to `env`. */
async function machine(env: NodeJS.ProcessEnv): Promise<Fixture> {
  const f = await startEndpoint(org, started);
  registerGitHandlers(new GitService({ env }), f.spine.bus as never);
  registerWorktreeHandlers(new WorktreeService({ git: createGitRunner({ env }), holders: { dispatch: () => Promise.reject(new Error('no holders here')), sessions: { list: () => [] } } as never }), f.spine.bus as never);
  return f;
}

/** A lane B session the machine's owners own, its record's roots as given. */
function session(f: Fixture, appSessionId: string, roots: { directory: string; additionalDirectories?: string[]; worktree?: string }): void {
  f.spine.set(appSessionId, `eng-${appSessionId}`, { appId: appSessionId, directory: roots.directory, additionalDirectories: roots.additionalDirectories ?? [], worktree: roots.worktree === undefined ? null : { path: roots.worktree, branch: 'wt' } });
  f.records.set({ lane: 'B', session: `eng-${appSessionId}`, owners: ['@machine'] }, appSessionId);
}

describe('the checkout rule', () => {
  it('admits a git read of a directory under the session’s worktree, and of the repository holding a subdirectory root', async () => {
    const one = await repo();
    const worktree = await one.addWorktree('wt');
    mkdirSync(join(worktree, 'src'));
    const two = await repo();
    mkdirSync(join(two.root, 'pkg'));
    const f = await machine(one.serviceEnv());
    session(f, 'app-wt', { directory: worktree, worktree });
    session(f, 'app-sub', { directory: join(two.root, 'pkg') });
    const a = await openRemote(f, org.a1, org.A);

    const inWorktree = await call(a, 'git.status', { directory: join(worktree, 'src') }, B('app-wt'));
    expect(inWorktree).toMatchObject({ ok: true, output: { repoRoot: worktree, isWorktree: true } });
    // A subfolder project's session reads its whole repository: status, worktrees, log.
    expect(await call(a, 'git.status', { directory: two.root }, B('app-sub'))).toMatchObject({ ok: true, output: { repoRoot: two.root } });
    expect(await call(a, 'git.worktree.list', { repoRoot: two.root }, B('app-sub'))).toMatchObject({ ok: true, output: { worktrees: [{ path: two.root }] } });
    expect(code(await call(a, 'git.log', { directory: two.root, limit: 5 }, B('app-sub')))).toBe('ok');
  });

  it('refuses `no-target` a path outside the session’s roots and repositories, a path that doesn’t resolve or isn’t absolute, and a call that names no lane B session', async () => {
    const one = await repo();
    const other = await repo();
    const f = await machine(one.serviceEnv());
    session(f, 'app-1', { directory: one.root });
    const a = await openRemote(f, org.a1, org.A);
    const asked = f.host.calls.length;
    expect(code(await call(a, 'git.status', { directory: other.root }, B('app-1')))).toBe('no-target');
    // A sibling whose name extends the root's is not under it.
    mkdirSync(`${one.root}-sibling`);
    expect(code(await call(a, 'git.status', { directory: `${one.root}-sibling` }, B('app-1')))).toBe('no-target');
    expect(code(await call(a, 'git.status', { directory: join(one.root, 'missing') }, B('app-1')))).toBe('no-target');
    expect(code(await call(a, 'git.status', { directory: '.' }, B('app-1')))).toBe('no-target');
    expect(code(await call(a, 'git.diff', { directory: other.root, scope: 'all' }, B('app-1')))).toBe('no-target');
    expect(code(await call(a, 'git.worktree.list', { repoRoot: other.root }, B('app-1')))).toBe('no-target');
    // No session, or a lane A one: nothing places the read.
    expect(code(await call(a, 'git.status', { directory: one.root }))).toBe('no-target');
    expect(code(await call(a, 'git.status', { directory: one.root }, { lane: 'A', id: 'la-1' }))).toBe('no-target');
    // None of them reached git for the path asked.
    expect(f.host.calls.slice(asked).filter((c) => c.name === 'git.status' && (c.input as { directory: string }).directory !== one.root)).toEqual([]);
    expect(f.host.calls.slice(asked).filter((c) => c.name === 'git.diff' || c.name === 'git.worktree.list')).toEqual([]);
  });

  it('places the session before the path: one the caller can’t view is `grade`, whatever the path names', async () => {
    const one = await repo();
    const f = await machine(one.serviceEnv());
    session(f, 'app-1', { directory: one.root });
    const b = await openRemote(f, org.b1, org.B);
    expect(code(await call(b, 'git.status', { directory: one.root }, B('app-1')))).toBe('grade');
    expect(code(await call(b, 'git.status', { directory: '/elsewhere' }, B('app-1')))).toBe('grade');
    expect(code(await call(b, 'git.status', { directory: one.root }, B('app-nowhere')))).toBe('grade');
  });

  it('leaves a worktree read’s second argument to the service: a worktree of another repository answers null', async () => {
    const one = await repo();
    const worktree = await one.addWorktree('wt');
    const other = await repo();
    const elsewhere = await other.addWorktree('elsewhere');
    const f = await machine(one.serviceEnv());
    session(f, 'app-wt', { directory: worktree, worktree });
    const a = await openRemote(f, org.a1, org.A);
    expect(await call(a, 'git.worktree.status', { repoRoot: worktree, path: elsewhere }, B('app-wt'))).toMatchObject({ ok: true, output: null });
    expect(await call(a, 'git.worktree.branch', { repoRoot: worktree, branch: 'no-such-branch' }, B('app-wt'))).toMatchObject({ ok: true, output: null });
    // The repository's own worktrees are its own to list, its main checkout among them.
    expect(await call(a, 'git.worktree.list', { repoRoot: worktree }, B('app-wt'))).toMatchObject({ ok: true, output: { worktrees: expect.arrayContaining([expect.objectContaining({ path: one.root }), expect.objectContaining({ path: worktree })]) } });
  });

  it('reads the bounds again when the session’s roots change', async () => {
    const one = await repo();
    const two = await repo();
    const f = await machine(one.serviceEnv());
    session(f, 'app-1', { directory: one.root });
    const a = await openRemote(f, org.a1, org.A);
    expect(code(await call(a, 'git.status', { directory: two.root }, B('app-1')))).toBe('no-target');
    session(f, 'app-1', { directory: one.root, additionalDirectories: [two.root] });
    expect(code(await call(a, 'git.status', { directory: two.root }, B('app-1')))).toBe('ok');
  });

  // Fix wave 1: the bounds follow the roots as they resolve now, not as they resolved when first read.
  it('follows a root that is a symlink retargeted since its bounds were kept', async () => {
    const one = await repo();
    const two = await repo();
    const current = `${one.root}-current`;
    symlinkSync(one.root, current);
    const f = await machine(one.serviceEnv());
    session(f, 'app-1', { directory: current });
    const a = await openRemote(f, org.a1, org.A);
    const boundsReads = () => f.host.calls.filter((c) => c.name === 'git.status' && (c.input as { directory: string }).directory === one.root).length;
    try {
      // Warm: every root resolves and its repository answers, so the bounds are kept; the second read asks git nothing more.
      expect(code(await call(a, 'git.worktree.list', { repoRoot: one.root }, B('app-1')))).toBe('ok');
      const warmed = boundsReads();
      expect(code(await call(a, 'git.worktree.list', { repoRoot: one.root }, B('app-1')))).toBe('ok');
      expect(boundsReads()).toBe(warmed);
      // `current` now points at another repository: the kept bounds are the old target's, and no longer the session's.
      rmSync(current);
      symlinkSync(two.root, current);
      expect(code(await call(a, 'git.worktree.list', { repoRoot: one.root }, B('app-1')))).toBe('no-target');
      expect(code(await call(a, 'git.worktree.list', { repoRoot: two.root }, B('app-1')))).toBe('ok');
    } finally {
      rmSync(current, { force: true });
    }
  });

  it('admits a root that didn’t resolve until later', async () => {
    const one = await repo();
    const three = await repo();
    const later = `${three.root}-later`; // not there yet
    const f = await machine(one.serviceEnv());
    session(f, 'app-1', { directory: one.root, additionalDirectories: [later] });
    const a = await openRemote(f, org.a1, org.A);
    try {
      expect(code(await call(a, 'git.status', { directory: one.root }, B('app-1')))).toBe('ok');
      expect(code(await call(a, 'git.status', { directory: three.root }, B('app-1')))).toBe('no-target');
      symlinkSync(three.root, later);
      expect(code(await call(a, 'git.status', { directory: three.root }, B('app-1')))).toBe('ok');
    } finally {
      rmSync(later, { force: true });
    }
  });

  // Fix wave 1: the index lags the engine session the host runs (a `/clear`). A caller is placed on the recorded engine
  // session and ranked there; only one who stands on it hears that the session can't be read now.
  it('answers a caller below view `grade` on a session whose live engine session isn’t its recorded one, reading nothing of its checkout', async () => {
    const one = await repo();
    const f = await machine(one.serviceEnv());
    session(f, 'app-1', { directory: one.root });
    f.host.add('app-1', 'eng-live');
    f.records.set({ lane: 'B', session: 'eng-live', owners: [org.B] }, 'app-1');
    const [a, b] = [await openRemote(f, org.a1, org.A), await openRemote(f, org.b1, org.B)];
    const asked = f.host.calls.length;
    // B owns the live engine session, not the recorded one: below view on the session as placed.
    expect(code(await call(b, 'git.status', { directory: one.root }, B('app-1')))).toBe('grade');
    expect(code(await call(b, 'session.status', { appSessionId: 'app-1' }))).toBe('grade');
    const from = b.inbox.length;
    await b.channel.send({ t: 'sub', sub: 'f1', feed: 'checkout', session: B('app-1'), cursor: null, credit: 1024 });
    expect(await waitFor(b, (m) => m.sub === 'f1' && m.t === 'ended', 'the feed refused', from)).toMatchObject({ reason: 'grade' });
    // Placement read the record and the live row, once each per request; nothing of the checkout was read.
    expect(f.host.calls.slice(asked).map((c) => c.name).filter((name) => name !== 'session.get' && name !== 'session.status')).toEqual([]);
    expect(f.host.calls.slice(asked).filter((c) => c.name === 'session.get')).toHaveLength(3);
    // A, who owns the recorded engine session, hears that it can't be read now.
    expect(code(await call(a, 'git.status', { directory: one.root }, B('app-1')))).toBe('unavailable');
    expect(code(await call(a, 'session.status', { appSessionId: 'app-1' }))).toBe('unavailable');
    expect(f.host.calls.slice(asked).filter((c) => c.name === 'git.status')).toEqual([]);
  });
});

describe('the rest of the checkout’s reads and writes', () => {
  it('reads a child agent’s events by its session (`fs.agentEvents`, the engine host’s)', async () => {
    const f = await startEndpoint(org, started);
    f.host.add('app-1');
    session(f, 'app-1', { directory: CHECKOUT });
    const [a, b] = [await openRemote(f, org.a1, org.A), await openRemote(f, org.b1, org.B)];
    const input = { appSessionId: 'app-1', agentId: 'agent-1' };
    expect(code(await call(b, 'fs.agentEvents', input))).toBe('grade');
    expect(f.host.calls.filter((c) => c.owner === 'engine-host' && c.name === 'fs.agentEvents')).toEqual([]);
    await call(a, 'fs.agentEvents', input);
    expect(f.host.calls.filter((c) => c.owner === 'engine-host' && c.name === 'fs.agentEvents').map((c) => c.input)).toEqual([input]);
  });

  it('refuses an upload’s part out of order, writing nothing, and stages the first', async () => {
    const one = await repo();
    const f = await startEndpoint(org, started);
    session(f, 'app-1', { directory: one.root });
    const upload = createUpload({
      sessions: fakeSpineView({ records: [sessionRecord('app-1', { directory: one.root })] }),
      roots: { record: () => {}, sweep: () => 0 },
      git: createGitRunner({ env: one.serviceEnv() }),
      log: () => {},
    });
    f.spine.handle('files.upload', (input) => upload(input as FilesUploadInput));
    const a = await openRemote(f, org.a1, org.A);
    const part = (index: number): Action =>
      a.device.action({ machine: f.ref, action: 'files.upload', args: { appSessionId: 'app-1', part: { upload: 'upload-0000000001', index, last: false }, files: [{ name: 'big.bin', bytes: Buffer.alloc(REMOTE_UPLOAD_PART_BYTES, index).toString('base64') }] } });
    const outcome = async (action: Action) => {
      const from = a.inbox.length;
      expect(await act(a, action)).toBe('ok');
      return (await waitFor(a, (m) => m.t === 'done' && m.opId === action.opId, 'the upload’s done', from)).outcome;
    };
    expect(await outcome(part(1))).toEqual({ state: 'done', result: { status: 'refused', reason: 'part out of order' } });
    expect(await outcome(part(0))).toEqual({ state: 'done', result: { status: 'ok', paths: [] } });
  });
});

describe('the spawn guard over `session.spawn`', () => {
  const SPAWN = { checkout: CHECKOUT, permission_mode: 'default' };

  async function grant(f: Fixture, member: string): Promise<string> {
    const body: Grant = { org: ORG, machine: f.ref, machineKey: await keyId(f.key.pub), member, rights: ['spawn'], version: 1, issued: iso(Date.now()) };
    return (await f.endpoint.cli('grant', ['-'], JSON.stringify(await signRecord(SIGNING_DOMAINS.grant, body, org.a1.stepUp.privateKey, org.a1.stepUp.pub)))).out;
  }

  async function spawnMachine(): Promise<{ f: Fixture; a: Remote; b: Remote; spawned: unknown[] }> {
    const f = await startEndpoint(org, started);
    await sminos(f); // the machine's presence names CHECKOUT
    const spawned: unknown[] = [];
    f.spine.handle('session.spawn', (input, context: HandlerContext) => {
      spawned.push({ input, member: context.op?.member });
      return { status: 'ok', appSessionId: `app-${spawned.length}` };
    });
    return { f, spawned, a: await openRemote(f, org.a1, org.A), b: await openRemote(f, org.b1, org.B) };
  }

  const spawn = async (r: Remote, f: Fixture, args: Record<string, unknown>) => act(r, await r.device.stepUp(r.device.action({ machine: f.ref, action: 'session.spawn', args })));

  it('holds its args to the registry’s schema first: a field outside the spawn fields, or no permission mode, is `malformed`', async () => {
    const { f, a, spawned } = await spawnMachine();
    expect(await spawn(a, f, { ...SPAWN, env: { PATH: '/tmp' } })).toBe('malformed');
    expect(await spawn(a, f, { checkout: CHECKOUT })).toBe('malformed');
    expect(spawned).toEqual([]);
  });

  it('holds its mode to the ceiling (one stricter than the machine’s default) and its checkout to the known ones', async () => {
    const { f, a, spawned } = await spawnMachine();
    expect((await f.endpoint.cli('policy', ['--ceiling', 'plan'])).code).toBe(0);
    expect(await spawn(a, f, SPAWN)).toBe('ceiling');
    expect(await spawn(a, f, { ...SPAWN, permission_mode: 'plan' })).toBe('ok');
    expect(await spawn(a, f, { ...SPAWN, permission_mode: 'plan', checkout: '/not/a/checkout' })).toBe('unknown-checkout');
    await waitFor(a, (m) => m.t === 'done', 'the admitted spawn’s done');
    expect(spawned).toEqual([{ input: { ...SPAWN, permission_mode: 'plan' }, member: org.A }]);
  });

  it('admits a member who isn’t the machine’s owner once a grant gives them `spawn`, and reads nothing of the checkouts for one without it', async () => {
    const { f, b, spawned } = await spawnMachine();
    expect(await spawn(b, f, SPAWN)).toBe('grade');
    expect(await spawn(b, f, { ...SPAWN, checkout: '/not/a/checkout' })).toBe('grade');
    expect(await grant(f, org.B)).toBe(`kept: version 1 for member ${org.B}, spawn`);
    expect(await spawn(b, f, SPAWN)).toBe('ok');
    await waitFor(b, (m) => m.t === 'done', 'the spawn’s done');
    expect(spawned).toEqual([{ input: SPAWN, member: org.B }]);
  });
});
