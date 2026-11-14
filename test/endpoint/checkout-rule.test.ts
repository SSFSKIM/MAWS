// The `checkout` target rule and the spawn guard (P5 O7 M4, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "The checkout rule and its boundary" and "`session.spawn`"), over the machine's real git, worktree and upload services
// behind the endpoint harness's spine. git's reads name a path, never their session: the call's `session` names it, and
// the path must lie in one of the session's roots or the repository a root belongs to, so the boundary a reader gets is
// the repository with its worktrees; what a worktree read names beyond that the service bounds itself. A spawn's args
// hold to the registry's schema (step 2), then to the machine's policy (step 6's guard, as `sminos.spawn`'s).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { keyId, signRecord, SIGNING_DOMAINS, type Action, type Grant } from 'org-protocol';
import { HostCommandError } from '@shared/host/runtime';
import type { HandlerContext } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import { REMOTE_UPLOAD_PART_BYTES, type FilesUploadInput } from '@shared/ipc/schema/files';
import { HOME_CHECKOUT } from '@shared/ipc/schema/session';
import { machineHome } from '@shared/machine/machine-home';
import { CheckoutBounds, withinBounds } from '../../src/endpoint/targets';
import { createUpload } from '../../src/services/files/upload';
import { registerGitHandlers } from '../../src/services/git/register';
import { createGitRunner } from '../../src/services/git/runner';
import { GitService } from '../../src/services/git/service';
import { WorktreeService } from '../../src/services/git/worktrees';
import { registerWorktreeHandlers } from '../../src/services/git/worktrees-register';
import { ADMISSION_CASES, admissionRepos, type AdmissionPaths, type AdmissionRecord } from '../support/admission-cases';
import { record as sessionRecord } from '../support/builders';
import { fakeSpineView } from '../support/fake-spine-view';
import { GitFixture, runGit } from '../support/git-fixture';
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

/** The endpoint, with the machine's real git and worktree handlers behind its spine, git confined to `env`; `home`, the machine's home as the home-root rule reads it. */
async function machine(env: NodeJS.ProcessEnv, home?: string): Promise<Fixture> {
  const f = await startEndpoint(org, started, home === undefined ? {} : { home });
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
    expect(f.host.calls.slice(asked).filter((c) => c.name === 'git.diff' || (c.name === 'git.worktree.list' && (c.input as { repoRoot: string }).repoRoot !== one.root))).toEqual([]); // the bounds' own probe of the root aside
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

  // 2026-11-06 (the home-root rule): a root at the machine's home, or above it, bounds nothing for a remote reader, whoever
  // they are (the owner here); a repository there neither, while a root inside it still bounds itself.
  it('bounds nothing by a root that is the machine’s home or above it: a chat in the home reads no repository under it', async () => {
    const one = await repo();
    const home = dirname(one.root); // the fake home holds every fixture repository
    const f = await machine(one.serviceEnv(), home);
    session(f, 'app-home', { directory: home });
    session(f, 'app-root', { directory: '/' });
    const a = await openRemote(f, org.a1, org.A);
    const asked = f.host.calls.length;
    expect(code(await call(a, 'git.status', { directory: one.root }, B('app-home')))).toBe('no-target');
    expect(code(await call(a, 'git.status', { directory: home }, B('app-home')))).toBe('no-target');
    expect(code(await call(a, 'git.log', { directory: one.root, limit: 5 }, B('app-home')))).toBe('no-target');
    expect(code(await call(a, 'git.lsFiles', { directory: one.root, query: '', limit: 10 }, B('app-home')))).toBe('no-target');
    expect(code(await call(a, 'git.status', { directory: one.root }, B('app-root')))).toBe('no-target');
    expect(f.host.calls.slice(asked).filter((c) => c.name === 'git.status' && (c.input as { directory: string }).directory === one.root)).toEqual([]);
  });

  it('reads the home by default as a home spawn starts in it (machineHome), so a chat in the home is always the root it drops', async () => {
    const dispatch = () => Promise.reject(new Error('no repository read for a dropped root'));
    expect(await new CheckoutBounds().of({ directory: machineHome(), additionalDirectories: [], worktree: null }, dispatch)).toEqual({ within: [], roots: [], dropped: [machineHome()], checkoutCovers: true });
  });

  it('keeps a project root while the home added beside it bounds nothing', async () => {
    const one = await repo();
    const two = await repo();
    const home = dirname(one.root);
    const f = await machine(one.serviceEnv(), home);
    session(f, 'app-1', { directory: one.root, additionalDirectories: [home] });
    const a = await openRemote(f, org.a1, org.A);
    expect(await call(a, 'git.status', { directory: one.root }, B('app-1'))).toMatchObject({ ok: true, output: { repoRoot: one.root } });
    expect(code(await call(a, 'git.status', { directory: two.root }, B('app-1')))).toBe('no-target');
  });

  // The desk track's review (P1): git answers for the repository a path is in, so a root inside a home kept in git would
  // read the whole home repository (its status's every file, an untracked file's contents through the diff).
  it('bounds nothing of git’s by a root whose repository is a home (a home kept in git), nor that repository', async () => {
    const one = await repo();
    mkdirSync(join(one.root, 'proj'));
    await one.write('proj/notes.md', 'notes\n');
    await one.write('secret.txt', 'the home’s own\n'); // untracked in the home repository
    const two = await repo();
    const f = await machine(one.serviceEnv(), one.root); // the home is the repository's root
    session(f, 'app-1', { directory: join(one.root, 'proj') });
    session(f, 'app-2', { directory: join(one.root, 'proj'), additionalDirectories: [two.root] });
    const a = await openRemote(f, org.a1, org.A);
    const asked = f.host.calls.length;
    expect(code(await call(a, 'git.status', { directory: join(one.root, 'proj') }, B('app-1')))).toBe('no-target');
    expect(code(await call(a, 'git.diff', { directory: join(one.root, 'proj'), scope: 'untracked', path: 'secret.txt' }, B('app-1')))).toBe('no-target');
    expect(code(await call(a, 'git.log', { directory: join(one.root, 'proj'), limit: 5 }, B('app-1')))).toBe('no-target');
    expect(code(await call(a, 'git.status', { directory: one.root }, B('app-1')))).toBe('no-target');
    expect(code(await call(a, 'git.worktree.list', { repoRoot: one.root }, B('app-1')))).toBe('no-target');
    expect(f.host.calls.slice(asked).filter((c) => c.name === 'git.diff' || c.name === 'git.log' || (c.name === 'git.worktree.list' && (c.input as { repoRoot: string }).repoRoot !== join(one.root, 'proj')))).toEqual([]); // the bounds' own probe of the root aside
    // a root of its own repository beside it keeps serving
    expect(await call(a, 'git.status', { directory: two.root }, B('app-2'))).toMatchObject({ ok: true, output: { repoRoot: two.root } });
  });

  // The desk track's review, round 2 (P1): the repository is learned by rev-parse and the worktree list (no work-tree
  // scan, which a home kept in git times out), and only a definite answer (the repository, or none) lets a root bound
  // git: any other leaves it a file root alone, and is never kept.
  it('bounds nothing of git’s by a root whose repository it couldn’t learn (a timeout, a failure, the spine away), and keeps none of it', async () => {
    const one = await repo();
    const failures: Array<[string, () => never]> = [
      ['timeout', () => { throw new HostCommandError(ipcError('timeout', 'git worktree list timed out')); }],
      ['internal', () => { throw new Error('git rev-parse answered nothing'); }],
      ['host_unavailable', () => { throw new HostCommandError(ipcError('host_unavailable', 'the spine is away')); }],
    ];
    for (const [what, fail] of failures) {
      const f = await machine(one.serviceEnv());
      f.spine.handle('git.worktree.list', fail);
      session(f, 'app-1', { directory: one.root });
      const a = await openRemote(f, org.a1, org.A);
      const asked = f.host.calls.length;
      expect([what, code(await call(a, 'git.log', { directory: one.root, limit: 5 }, B('app-1')))]).toEqual([what, 'no-target']);
      expect([what, code(await call(a, 'git.diff', { directory: one.root, scope: 'all' }, B('app-1')))]).toEqual([what, 'no-target']);
      expect([what, code(await call(a, 'git.diff', { directory: one.root, scope: 'staged' }, B('app-1')))]).toEqual([what, 'no-target']);
      expect([what, f.host.calls.slice(asked).filter((c) => c.name === 'git.worktree.list').length]).toEqual([what, 3]); // asked again each time
      expect([what, f.host.calls.slice(asked).filter((c) => c.name === 'git.log' || c.name === 'git.diff')]).toEqual([what, []]);
    }
  });

  it('lets a root in no repository bound itself (git’s own answer), and learns a repository with no status read', async () => {
    const one = await repo();
    const plain = realpathSync(mkdtempSync(join(tmpdir(), 'checkout-plain-')));
    try {
      const f = await machine(one.serviceEnv());
      session(f, 'app-plain', { directory: plain });
      session(f, 'app-1', { directory: one.root });
      const a = await openRemote(f, org.a1, org.A);
      const asked = f.host.calls.length;
      expect(code(await call(a, 'git.lsFiles', { directory: plain, query: '', limit: 10 }, B('app-plain')))).not.toBe('no-target'); // admitted (this suite's spine runs no lsFiles)
      expect(await f.endpoint.checkoutBounds.of({ directory: plain, additionalDirectories: [], worktree: null }, (owner, name, input) => f.services.dispatch(owner, name, input))).toEqual({ within: [plain], roots: [plain], dropped: [], checkoutCovers: false });
      expect(code(await call(a, 'git.log', { directory: one.root, limit: 5 }, B('app-1')))).toBe('ok');
      expect(f.host.calls.slice(asked).filter((c) => c.name === 'git.status')).toEqual([]); // the bounds read no status
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  // UX wave U8a (decision 7 of its execution document): an answer that is no record, here a worktree with no path, names
  // no checkout the endpoint can vouch for (a remote reader's feed then withholds its source-control output); its other
  // bounds are as for no worktree.
  it('names no checkout for an answer whose worktree has no path, and bounds the rest as for no worktree', async () => {
    const one = await repo();
    const plain = realpathSync(mkdtempSync(join(tmpdir(), 'checkout-plain-')));
    try {
      const f = await machine(one.serviceEnv());
      const none = await f.endpoint.checkoutBounds.of({ directory: plain, additionalDirectories: [], worktree: null }, (owner, name, input) => f.services.dispatch(owner, name, input));
      const pathless = await f.endpoint.checkoutBounds.of({ directory: plain, additionalDirectories: [], worktree: {} }, (owner, name, input) => f.services.dispatch(owner, name, input));
      expect(none).toEqual({ within: [plain], roots: [plain], dropped: [], checkoutCovers: false });
      expect(pathless).toEqual({ ...none, checkoutCovers: true });
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  // Round 2 (P2): a linked worktree of a home kept in git is the home's repository to git's worktree reads (which resolve
  // to the main checkout) and to scm (its trust key, the main checkout): it bounds nothing of git's either.
  it('bounds nothing of git’s by a linked worktree of a home kept in git', async () => {
    const one = await repo();
    const worktree = await one.addWorktree('wt');
    const f = await machine(one.serviceEnv(), one.root); // the home is the main checkout
    session(f, 'app-wt', { directory: worktree, worktree });
    const a = await openRemote(f, org.a1, org.A);
    expect(code(await call(a, 'git.worktree.status', { repoRoot: worktree, path: one.root }, B('app-wt')))).toBe('no-target');
    expect(code(await call(a, 'git.status', { directory: worktree }, B('app-wt')))).toBe('no-target');
    expect(code(await call(a, 'git.log', { directory: worktree, limit: 5 }, B('app-wt')))).toBe('no-target');
    const bounds = await f.endpoint.checkoutBounds.of({ directory: worktree, additionalDirectories: [], worktree: { path: worktree, branch: 'wt' } }, (owner, name, input) => f.services.dispatch(owner, name, input));
    expect(bounds).toMatchObject({ within: [], roots: [worktree], checkoutCovers: true });
  });

  // Round 3 (P2): a project root of its own repository can hold, below it, a linked worktree of a home kept in git; the
  // root's repository says nothing of it, so each remote git read's own path is asked at its request.
  it('refuses a git read at a home’s linked worktree checked out below a project root of its own repository', async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'checkout-nested-home-')));
    try {
      await runGit(home, ['init', '-q', '-b', 'main']);
      writeFileSync(join(home, 'dotfile'), 'the home’s own\n');
      await runGit(home, ['add', 'dotfile']);
      await runGit(home, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'home']);
      const proj = join(home, 'proj');
      mkdirSync(proj);
      await runGit(proj, ['init', '-q', '-b', 'main']);
      await runGit(proj, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'proj']);
      await runGit(home, ['worktree', 'add', '-q', join(proj, 'hw'), '-b', 'hw']); // the home's linked worktree, inside the project
      const f = await machine({ PATH: process.env.PATH, HOME: home }, home);
      session(f, 'app-1', { directory: proj });
      const a = await openRemote(f, org.a1, org.A);
      const asked = f.host.calls.length;
      expect(code(await call(a, 'git.worktree.status', { repoRoot: join(proj, 'hw'), path: home }, B('app-1')))).toBe('no-target');
      expect(code(await call(a, 'git.log', { directory: join(proj, 'hw'), limit: 5 }, B('app-1')))).toBe('no-target');
      expect(code(await call(a, 'git.worktree.list', { repoRoot: join(proj, 'hw') }, B('app-1')))).toBe('no-target');
      expect(f.host.calls.slice(asked).filter((c) => c.name === 'git.log' || c.name === 'git.worktree.status')).toEqual([]);
      expect(code(await call(a, 'git.log', { directory: proj, limit: 5 }, B('app-1')))).toBe('ok'); // the project's own
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  // Round 3 (P2): a filesystem that tells Unicode forms apart (ext4) holds `café` composed and decomposed as two
  // directories; the bounds compare and dispatch on the realpath as named, so a root at one is never its sibling.
  it('keeps a root and its sibling differing only in Unicode form apart', async (ctx) => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'checkout-nfc-')));
    try {
      const [decomposed, composed] = [join(parent, 'cafe\u0301'), join(parent, 'caf\u00e9')];
      mkdirSync(decomposed);
      try {
        mkdirSync(composed);
      } catch {
        ctx.skip(); // a filesystem that folds the forms (APFS): one directory, nothing to keep apart
      }
      for (const dir of [decomposed, composed]) await runGit(dir, ['init', '-q', '-b', 'main']);
      const f = await machine({ PATH: process.env.PATH, HOME: parent });
      session(f, 'app-1', { directory: decomposed });
      const a = await openRemote(f, org.a1, org.A);
      expect(code(await call(a, 'git.status', { directory: composed }, B('app-1')))).toBe('no-target');
      // the root's own read is refused too (round 4): the worktree service runs git at the composed spelling, here the
      // sibling, so no repository answer is the root's, and a root git can't place bounds nothing of git's
      expect(code(await call(a, 'git.status', { directory: decomposed }, B('app-1')))).toBe('no-target');
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  // Round 4 (b): a worktree status's `path` names the worktree whose state it reads; when the home is a linked worktree of a
  // project's repository, the project's own repoRoot is no guard of it, so that path is held to the homes itself
  it('refuses a worktree status whose path is a home, or doesn’t resolve, and serves one of the project’s own worktrees', async () => {
    const one = await repo();
    const other = await one.addWorktree('other');
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'checkout-wt-home-')));
    try {
      const home = join(parent, 'home');
      await one.git('worktree', 'add', '-q', home, '-b', 'home'); // the home: a linked worktree of the project's repository
      const f = await machine(one.serviceEnv(), home);
      session(f, 'app-1', { directory: one.root });
      const a = await openRemote(f, org.a1, org.A);
      const asked = f.host.calls.length;
      expect(code(await call(a, 'git.worktree.status', { repoRoot: one.root, path: home }, B('app-1')))).toBe('no-target');
      expect(code(await call(a, 'git.worktree.status', { repoRoot: one.root, path: parent }, B('app-1')))).toBe('no-target'); // above the home
      expect(code(await call(a, 'git.worktree.status', { repoRoot: one.root, path: join(parent, 'missing') }, B('app-1')))).toBe('no-target');
      expect(code(await call(a, 'git.worktree.status', { repoRoot: one.root, path: 'home' }, B('app-1')))).toBe('no-target'); // a place is absolute
      expect(f.host.calls.slice(asked).filter((c) => c.name === 'git.worktree.status')).toEqual([]);
      // admitted to the service (this suite's worktree service has no holders to read occupancy from, so it answers a failure)
      expect(code(await call(a, 'git.worktree.status', { repoRoot: one.root, path: other }, B('app-1')))).not.toBe('no-target');
      expect(f.host.calls.slice(asked).filter((c) => c.name === 'git.worktree.status')).toHaveLength(1);
      // git.diff's and git.log's `path` is a pathspec in the repository, not a place: it still serves
      await one.write('notes.md', 'a\n');
      expect(code(await call(a, 'git.log', { directory: one.root, limit: 5, path: 'README.md' }, B('app-1')))).toBe('ok');
      expect(code(await call(a, 'git.diff', { directory: one.root, scope: 'untracked', path: 'notes.md' }, B('app-1')))).toBe('ok');
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  // Round 4 (a): the worktree service folds a path to NFC before git runs, so for a root named in decomposed form its
  // answer is the composed spelling's, which is the root only where the filesystem folds the forms (APFS: one inode)
  it('takes no repository answer for a decomposed root that its composed spelling isn’t (a sibling, or nothing there)', async (ctx) => {
    const outer = await repo(); // an outer repository holding both spellings
    const decomposed = join(outer.root, 'cafe\u0301');
    const composed = join(outer.root, 'caf\u00e9');
    mkdirSync(decomposed);
    await runGit(decomposed, ['init', '-q', '-b', 'main']); // an independent repository, its own toplevel
    await runGit(decomposed, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'own']);
    const folds = await stat(composed).then((s) => s.ino === statSync(decomposed).ino, () => false);
    const f = await machine(outer.serviceEnv());
    session(f, 'app-1', { directory: decomposed });
    const a = await openRemote(f, org.a1, org.A);
    expect(code(await call(a, 'git.status', { directory: outer.root }, B('app-1')))).toBe('no-target'); // never widened to the outer repository
    // folded (APFS), the service's answer is the root's own; otherwise there is none to take, and git reaches nothing there
    expect(code(await call(a, 'git.log', { directory: realpathSync(decomposed), limit: 5 }, B('app-1')))).toBe(folds ? 'ok' : 'no-target');
    if (folds) ctx.skip(); // no composed sibling can be made beside it here
    mkdirSync(composed); // a plain sibling in the outer repository
    const g = await machine(outer.serviceEnv());
    session(g, 'app-2', { directory: decomposed });
    const b = await openRemote(g, org.a1, org.A);
    expect(code(await call(b, 'git.status', { directory: outer.root }, B('app-2')))).toBe('no-target');
    expect(code(await call(b, 'git.log', { directory: decomposed, limit: 5 }, B('app-2')))).toBe('no-target');
  });

  // The final review (P1): git's top level is git's own reading at the path (`core.worktree` sends a repository's work tree
  // elsewhere), never a worktree list's entry: a project whose work tree is the home reads the home, and one whose work
  // tree is anywhere but the project or above it is no repository the bounds can place.
  it('refuses a git read of a repository whose work tree (core.worktree) is the home, or anywhere but the root or above it', async () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'checkout-core-worktree-')));
    try {
      const home = join(parent, 'home');
      mkdirSync(home);
      writeFileSync(join(home, 'secret.txt'), 'the home’s own\n');
      const inside = join(home, 'proj');
      const beside = join(parent, 'proj');
      for (const dir of [inside, beside]) {
        mkdirSync(dir);
        await runGit(dir, ['init', '-q', '-b', 'main']);
        await runGit(dir, ['config', 'core.worktree', home]);
      }
      const f = await machine({ PATH: process.env.PATH, HOME: home }, home);
      session(f, 'app-in', { directory: inside });
      session(f, 'app-beside', { directory: beside });
      const a = await openRemote(f, org.a1, org.A);
      const asked = f.host.calls.length;
      for (const [app, dir] of [['app-in', inside], ['app-beside', beside]] as const) {
        expect([app, code(await call(a, 'git.diff', { directory: dir, scope: 'untracked', path: 'secret.txt' }, B(app)))]).toEqual([app, 'no-target']);
        expect([app, code(await call(a, 'git.status', { directory: dir }, B(app)))]).toEqual([app, 'no-target']);
      }
      expect(f.host.calls.slice(asked).filter((c) => c.name === 'git.diff' || c.name === 'git.status')).toEqual([]);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
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
    // the bounds' probe of the root, the request's own probe of its path (round 3) and the call: each a worktree list
    const lists = () => f.host.calls.filter((c) => c.name === 'git.worktree.list' && (c.input as { repoRoot: string }).repoRoot === one.root).length;
    try {
      // Warm: every root resolves and its repository answers, so the bounds are kept; the second read probes the root no more.
      expect(code(await call(a, 'git.worktree.list', { repoRoot: one.root }, B('app-1')))).toBe('ok');
      expect(lists()).toBe(3);
      const warmed = lists();
      expect(code(await call(a, 'git.worktree.list', { repoRoot: one.root }, B('app-1')))).toBe('ok');
      expect(lists() - warmed).toBe(2); // the request's probe and the call alone
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

// UX wave U8c-2, M3 (docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md, decision 5 and §G): the launch
// folder and the working folder, where a fact names them, join the record's roots only when the machine's
// `git.worktree.list`, asked for the request, says the work tree git finds for the folder is one of the work trees of the
// repository the record's directory is in. The table of cases is the files service's too (src/services/files/allowlist.test.ts).
describe('the checkout bounds and the folders a record’s facts name', () => {
  let repos: Awaited<ReturnType<typeof admissionRepos>>;
  let p: AdmissionPaths;
  beforeAll(async () => {
    repos = await admissionRepos();
    p = repos.paths;
  });
  afterAll(() => repos.dispose());
  const env = () => ({ PATH: process.env.PATH, HOME: p.plain });
  const real = (path: string) => (existsSync(path) ? realpathSync(path) : path);
  const moved = (f: Fixture, appSessionId: string, record: AdmissionRecord) => {
    f.spine.set(appSessionId, `eng-${appSessionId}`, { appId: appSessionId, ...record });
    f.records.set({ lane: 'B', session: `eng-${appSessionId}`, owners: ['@machine'] }, appSessionId);
  };

  it('admits a fact’s folder by every row of the table, as the machine answers it', async () => {
    const f = await machine(env());
    const dispatch: Parameters<CheckoutBounds['of']>[1] = (owner, name, input) => f.services.dispatch(owner, name, input);
    for (const [name, make] of ADMISSION_CASES) {
      const { record, which, folder, admitted } = make(p);
      const bounds = await f.endpoint.checkoutBounds.of(record, dispatch);
      // soft: every row is judged and reported, as each is a case of its own in the files service's suite
      if (admitted !== null) {
        expect.soft(bounds.roots, name).toContain(admitted);
        expect.soft(withinBounds(bounds.within, admitted), name).toBe(true);
      } else {
        expect.soft(bounds.roots, name).not.toContain(real(folder));
        expect.soft(bounds.roots, name).toEqual([record.directory]); // the record's own root alone
      }
      if (which === 'path') expect.soft(bounds.checkoutCovers, `${name}: the working folder is Source control’s checkout`).toBe(admitted === null);
    }
  });

  it('asks the machine again at each request, and keeps nothing of the answer', async () => {
    const f = await machine(env());
    const dispatch: Parameters<CheckoutBounds['of']>[1] = (owner, name, input) => f.services.dispatch(owner, name, input);
    const record = { directory: p.main, additionalDirectories: [], worktree: null, agentFolder: { checkout: p.beside, cwd: p.beside, branch: null, linked: true } };
    const asked = () => f.host.calls.filter((c) => c.name === 'git.worktree.list' && (c.input as { repoRoot: string }).repoRoot === p.beside).length;
    expect((await f.endpoint.checkoutBounds.of(record, dispatch)).roots).toEqual([p.main, p.beside]);
    expect(asked()).toBe(1);
    const away = join(p.base, 'beside-registration');
    renameSync(join(p.main, '.git/worktrees/beside'), away);
    try {
      expect(await f.endpoint.checkoutBounds.of(record, dispatch)).toMatchObject({ roots: [p.main], checkoutCovers: true });
      expect(asked()).toBe(2);
    } finally {
      renameSync(away, join(p.main, '.git/worktrees/beside'));
    }
    expect(await f.endpoint.checkoutBounds.of(record, dispatch)).toMatchObject({ roots: [p.main, p.beside], checkoutCovers: false });
    expect(asked()).toBe(3);
  });

  it('passes a remote git read at a worktree beside the repository while a fact names it and it is registered, and refuses it once deregistered', async () => {
    const f = await machine(env());
    moved(f, 'app-moved', { directory: p.main, additionalDirectories: [], worktree: null, agentFolder: { checkout: p.beside, cwd: p.beside, branch: 'beside', linked: true } });
    moved(f, 'app-forged', { directory: p.main, additionalDirectories: [], worktree: null, agentFolder: { checkout: p.copy, cwd: p.copy, branch: null, linked: true } });
    const a = await openRemote(f, org.a1, org.A);
    expect(await call(a, 'git.status', { directory: p.beside }, B('app-moved'))).toMatchObject({ ok: true, output: { repoRoot: p.beside } });
    expect(code(await call(a, 'git.status', { directory: p.copy }, B('app-forged')))).toBe('no-target');
    const away = join(p.base, 'beside-registration');
    renameSync(join(p.main, '.git/worktrees/beside'), away);
    try {
      expect(code(await call(a, 'git.status', { directory: p.beside }, B('app-moved')))).toBe('no-target');
    } finally {
      renameSync(away, join(p.main, '.git/worktrees/beside'));
    }
  });

  // The branch review (P1): where the filesystem keeps `café` composed and decomposed apart (ext4, the Linux lane), a folder
  // beside a registered worktree, spelled in the other form and holding a copy of its `.git` pointer, is another directory,
  // which git nonetheless takes as that worktree. Membership is the registered directory's identity, never its folded
  // spelling, as the files reader's realpath equality has it; the folded spelling only finds the candidate. Where the forms
  // fold (APFS) the two names are one folder, and there is nothing to tell apart.
  it('does not take a sibling spelled in the other Unicode form for the registered worktree whose pointer it copies', async (ctx) => {
    const one = await repo();
    const beside = realpathSync(mkdtempSync(join(tmpdir(), 'checkout-nfc-wt-'))); // outside the checkout, as `beside` is
    try {
      const decomposed = join(beside, 'cafe\u0301');
      const composed = join(beside, 'caf\u00e9');
      await one.git('worktree', 'add', '-q', '-b', 'cafe', decomposed);
      try {
        mkdirSync(composed);
      } catch {
        ctx.skip(); // the forms fold (APFS): one directory
      }
      copyFileSync(join(decomposed, '.git'), join(composed, '.git'));
      const f = await machine(one.serviceEnv());
      const dispatch: Parameters<CheckoutBounds['of']>[1] = (owner, name, input) => f.services.dispatch(owner, name, input);
      const listedPaths = async () => {
        const listed = await dispatch('machine', 'git.worktree.list', { repoRoot: one.root });
        return listed.ok ? (listed.value as { worktrees: { path: string }[] }).worktrees.map((entry) => entry.path) : listed.error;
      };
      const forged = { directory: one.root, additionalDirectories: [], worktree: null, agentFolder: { checkout: composed, cwd: composed, branch: null, linked: true } };
      expect.soft(await listedPaths(), 'the machine lists the worktree as git spells it').toEqual([one.root, decomposed]);
      expect.soft(await f.endpoint.checkoutBounds.of(forged, dispatch)).toMatchObject({ roots: [one.root], checkoutCovers: true });
      moved(f, 'app-forged', forged);
      const a = await openRemote(f, org.a1, org.A);
      expect.soft(code(await call(a, 'git.status', { directory: composed }, B('app-forged')))).toBe('no-target');
      // and once the registered folder is gone, its registration kept: the sibling is still not it
      rmSync(decomposed, { recursive: true, force: true });
      expect.soft(await listedPaths()).toEqual([one.root, decomposed]);
      expect(await f.endpoint.checkoutBounds.of(forged, dispatch)).toMatchObject({ roots: [one.root], checkoutCovers: true });
    } finally {
      rmSync(beside, { recursive: true, force: true });
    }
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

  // 2026-11-06 (the New chat's machine first): `checkout: '~'`, a chat in the machine's home with no project, is a current
  // owner's alone, as their `trust` is; a member a grant lets spawn, and anyone's `sminos.spawn`, find it no checkout.
  it('admits the home (`~`) as a checkout for the machine’s owner alone: a grant-holder and `sminos.spawn` are `unknown-checkout`', async () => {
    const { f, a, b, spawned } = await spawnMachine();
    const home = { checkout: HOME_CHECKOUT, permission_mode: 'default' };
    expect(await spawn(a, f, home)).toBe('ok');
    await waitFor(a, (m) => m.t === 'done', 'the home spawn’s done');
    expect(spawned).toEqual([{ input: home, member: org.A }]);
    expect(await grant(f, org.B)).toBe(`kept: version 1 for member ${org.B}, spawn`);
    expect(await spawn(b, f, home)).toBe('unknown-checkout');
    expect(await spawn(b, f, { ...home, trust: 'accepted' })).toBe('spec-field');
    expect(await act(a, await a.device.stepUp(a.device.action({ machine: f.ref, action: 'sminos.spawn', args: home })))).toBe('unknown-checkout');
    expect(spawned).toHaveLength(1);
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
