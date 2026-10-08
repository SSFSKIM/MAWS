// The service's remote half over a fake read runner, a fake status and a fake spawn (E6 T2.3, T2.4): plans issued and
// run only through their token, revalidated against a fresh status before anything spawns; the run's cancel and latest
// run; the gh probe behind `scm.status` and its cache; PR state with its cache, its bypass and its drop when a run ends.
// No real gh or git process starts here: every child is a FakeChild and every kill a fake.
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { RemotePlan, ScmRemoteOutput } from '@shared/ipc/schema/scm';
import { TrustStoreFixture } from '../../../test/support/trust-store';
import type { GitRun } from '../git/runner';
import type { KillFn, RemoteSpawnOptions, SpawnFn } from './remote-runner';
import { ScmService, type ScmServiceDeps } from './service';

const ID = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const OTHER = 'b2222222-2222-4222-8222-222222222222' as AppSessionId;
const HEAD = '0123456789abcdef0123456789abcdef01234567';
const GIT = '/fake/bin/git';
const GH = '/fake/bin/gh';
const FIXTURES = join(__dirname, '../../../test/fixtures/scm');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const UPSTREAM_FORMAT = 'for-each-ref --format=%(HEAD)%00%(upstream:remotename)%00%(upstream:remoteref) refs/heads';
const MINUTE = 60_000;

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  constructor(readonly pid: number) {
    super();
  }
  out(text: string) {
    this.stdout.emit('data', Buffer.from(text));
  }
  err(text: string) {
    this.stderr.emit('data', Buffer.from(text));
  }
  close(code: number | null, signal: NodeJS.Signals | null = null) {
    this.emit('close', code, signal);
  }
}

// What the fake gh answers, by its first two arguments.
interface GhAnswer {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

describe('scm service runs confirmed plans, probes gh and caches PR state', () => {
  let root: string;
  let trust: TrustStoreFixture;
  let status: GitStatus;
  let remotes: string;
  let pushUrls: string[];
  let clock: number;
  let gh: Record<string, GhAnswer>;
  let held: Map<string, (() => void) | null>; // gh reads a test answers itself: key → the answer, once asked
  let spawned: Array<{ program: string; argv: readonly string[]; options: RemoteSpawnOptions; child: FakeChild }>;
  let spawn: ReturnType<typeof vi.fn<SpawnFn>>;
  let kill: ReturnType<typeof vi.fn<KillFn>>;
  let events: ScmRemoteOutput[];
  let readStatus: ReturnType<typeof vi.fn<ScmServiceDeps['status']>>;
  let mutate: ReturnType<typeof vi.fn<ScmServiceDeps['mutate']>>;
  let env: NodeJS.ProcessEnv;
  let captured: Record<string, string>;
  let pushReaders: Array<{ program: string; captured: Record<string, string> }>;
  let scm: ScmService;

  const ghCalls = (sub?: string) => spawned.filter((s) => s.program === GH && (sub === undefined || s.argv.slice(0, 2).join(' ') === sub));
  const pushes = () => spawned.filter((s) => s.program === GIT);
  const lastPush = () => pushes().at(-1)!.child;

  function service(): ScmService {
    const read: GitRun = async (directory, args) => {
      const command = args.join(' ');
      if (args[0] === 'rev-parse') return `${directory}\n${directory}/.git\n${directory}/.git\n`; // the trust key's read
      if (command === 'remote') return remotes;
      if (command === 'remote -v') return remotes.split('\n').filter(Boolean).map((name) => `${name}\thttps://github.com/o/r.git (fetch)\n${name}\thttps://github.com/o/r.git (push)\n`).join(''); // E11: status's one read
      if (command === UPSTREAM_FORMAT) return '*\0origin\0refs/heads/main\n';
      if (command === 'for-each-ref --format=%(HEAD)%00%(upstream:remotename) refs/heads') return '*\0origin\n';
      if (command === 'remote get-url --push --all origin') return pushUrls.map((url) => `${url}\n`).join('');
      if (command === 'remote get-url origin') return 'https://github.com/o/r.git\n';
      if (args[0] === 'check-ref-format') return `${args[2]}\n`;
      if (command === 'symbolic-ref -q refs/remotes/origin/HEAD') return 'refs/remotes/origin/main\n';
      if (args[0] === 'log') return `${'c'.repeat(40)}\0x\n`; // the new commit's sha and subject
      throw new Error(`unexpected read: git ${command}`);
    };
    return new ScmService({
      records: (id) => (id === ID || id === OTHER ? { directory: root, worktree: null } : null),
      read,
      // the plans' destination reads answer from the same fake, recording which git and capture they were made for
      pushRead: (program, given) => {
        pushReaders.push({ program, captured: given });
        return read;
      },
      status: readStatus,
      mutate,
      refresh: () => {},
      captured: async () => captured,
      env,
      emit: (event) => events.push(event),
      spawn,
      kill,
      now: () => clock,
    });
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-scm-remote-')));
    trust = new TrustStoreFixture();
    trust.write({ [root]: { hasTrustDialogAccepted: true } });
    captured = { HOME: root, CLAUDE_CONFIG_DIR: trust.configHome, PATH: '/nowhere' };
    pushReaders = [];
    env = { MAWS_GIT: GIT, MAWS_GH: GH };
    status = {
      repoRoot: root, gitDir: `${root}/.git`, commonDir: `${root}/.git`, isWorktree: false, branch: 'main', head: HEAD, upstream: 'origin/main',
      remoteUrl: 'https://github.com/o/r.git', ahead: 1, behind: 0, dirty: false, files: [], stashCount: 0, checkedAt: '2026-10-06T12:00:00.000Z',
    };
    remotes = 'origin\n';
    pushUrls = ['https://github.com/o/r.git'];
    clock = Date.parse('2026-10-06T12:00:00.000Z');
    gh = {
      '--version': { exitCode: 0, stdout: 'gh version 2.97.0 (2026-09-30)\n' },
      'auth status': { exitCode: 0, stdout: 'github.com\n  ✓ Logged in\n' },
      'repo view': { exitCode: 0, stdout: fixture('gh-repo-view.json') },
      'pr view': { exitCode: 0, stdout: fixture('gh-pr-view-open.json') },
      'pr checks': { exitCode: 8, stdout: fixture('gh-pr-checks-mixed.json') },
      'pr create': { exitCode: 0, stdout: 'https://github.com/o/r/pull/7\n' },
    };
    held = new Map();
    spawned = [];
    let pid = 9000;
    spawn = vi.fn<SpawnFn>((program, argv, options) => {
      const child = new FakeChild((pid += 1));
      spawned.push({ program, argv, options, child });
      if (program === GH) {
        const key = argv[0] === '--version' ? '--version' : argv.slice(0, 2).join(' ');
        const answer = gh[key] ?? { exitCode: 1, stderr: `fake gh: unexpected ${argv.join(' ')}\n` };
        // gh reads answer at once; a `pr create` run is driven like a push when a test holds it
        const respond = () => {
          if (answer.stdout) child.out(answer.stdout);
          if (answer.stderr) child.err(answer.stderr);
          child.close(answer.exitCode);
        };
        if (held.has(key)) held.set(key, respond);
        else if (key !== 'pr create') setImmediate(respond);
      }
      return child as unknown as ChildProcess;
    });
    kill = vi.fn<KillFn>();
    events = [];
    readStatus = vi.fn<ScmServiceDeps['status']>(async () => ({ ...status }));
    mutate = vi.fn<ScmServiceDeps['mutate']>(async () => ({ stdout: '', stderr: '' }));
    scm = service();
  });
  afterEach(() => {
    scm.dispose();
    trust.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  const planPush = async () => {
    const plan = await scm.planPush({ appSessionId: ID });
    expect(plan, JSON.stringify(plan)).toHaveProperty('token');
    return plan as RemotePlan;
  };
  const planPr = async () => {
    status = { ...status, ahead: 0 };
    const plan = await scm.planPr({ appSessionId: ID, title: 'Panel PR', body: '', base: 'main', draft: false });
    expect(plan, JSON.stringify(plan)).toHaveProperty('token');
    return plan as RemotePlan;
  };

  describe('push and pr runs', () => {
    it('plans a push with the exact argv and every destination, and runs nothing yet', async () => {
      pushUrls = ['https://user:secret@github.com/o/r.git', '/srv/mirror.git'];
      const plan = await planPush();
      expect(plan).toMatchObject({
        kind: 'push', cwd: root, program: GIT, argv: ['push', '--progress', '--recurse-submodules=no', 'origin', 'refs/heads/main:refs/heads/main'], remote: 'origin',
        remoteUrl: 'https://github.com/o/r.git', pushUrls: ['https://github.com/o/r.git', '/srv/mirror.git'], branch: 'main', head: HEAD,
        upstream: 'origin/main', expiresAt: '2026-10-06T12:05:00.000Z',
      });
      expect(pushes()).toEqual([]);
      // the remote and its URLs were read by the git the push runs, under the capture it runs with
      expect(pushReaders).toEqual([{ program: GIT, captured }]);
    });

    it('runs a valid token: revalidates on a fresh status, then spawns exactly the plan in its cwd, once', async () => {
      const plan = await planPush();
      const reads = readStatus.mock.calls.length;
      expect(await scm.run({ appSessionId: ID, token: plan.token }, 'push')).toEqual({ started: true, token: plan.token });
      expect(readStatus.mock.calls.length).toBe(reads + 1); // the revalidation's fresh status
      expect(spawned.map((s) => [s.program, s.argv, s.options.cwd])).toEqual([[GIT, plan.argv, root]]);
      expect(spawned[0].options).toMatchObject({ detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      expect(spawned[0].options.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' });
      // the token is spent
      lastPush().close(0);
      expect(await scm.run({ appSessionId: ID, token: plan.token }, 'push')).toMatchObject({ refused: 'plan_expired' });
      expect(pushes()).toHaveLength(1);
    });

    it('spawns nothing and answers changed when the head moved since the sheet opened, spending the token', async () => {
      const plan = await planPush();
      status = { ...status, head: 'f'.repeat(40), ahead: 2 };
      expect(await scm.run({ appSessionId: ID, token: plan.token }, 'push')).toEqual({
        refused: 'changed', detail: 'head changed since the sheet opened; review it again', output: '',
      });
      expect(spawned).toEqual([]);
      expect(await scm.run({ appSessionId: ID, token: plan.token }, 'push')).toMatchObject({ refused: 'plan_expired' });
    });

    it('spawns nothing when a push destination changed', async () => {
      const plan = await planPush();
      pushUrls = ['https://github.com/someone/else.git'];
      expect(await scm.run({ appSessionId: ID, token: plan.token }, 'push')).toMatchObject({ refused: 'changed', detail: 'destination changed since the sheet opened; review it again' });
      expect(spawned).toEqual([]);
    });

    it('refuses a push token presented to scm.pr.create, or by another session', async () => {
      const plan = await planPush();
      expect(await scm.run({ appSessionId: ID, token: plan.token }, 'pr')).toMatchObject({ refused: 'plan_expired' });
      const again = await planPush();
      expect(await scm.run({ appSessionId: OTHER, token: again.token }, 'push')).toMatchObject({ refused: 'plan_expired' });
      expect(spawned).toEqual([]);
    });

    it('answers untrusted when trust was withdrawn after the sheet opened, spawning nothing', async () => {
      const plan = await planPush();
      trust.write({});
      expect(await scm.run({ appSessionId: ID, token: plan.token }, 'push')).toMatchObject({ refused: 'untrusted' });
      expect(spawned).toEqual([]);
    });

    it('answers busy while the checkout runs, without spending the waiting token', async () => {
      const first = await planPush();
      await scm.run({ appSessionId: ID, token: first.token }, 'push');
      const second = await planPush();
      const reads = readStatus.mock.calls.length;
      expect(await scm.run({ appSessionId: ID, token: second.token }, 'push')).toMatchObject({ refused: 'busy' });
      expect(readStatus.mock.calls.length).toBe(reads); // decided before any read
      lastPush().close(0);
      expect(await scm.run({ appSessionId: ID, token: second.token }, 'push')).toEqual({ started: true, token: second.token });
      expect(pushes()).toHaveLength(2);
    });

    it('revalidates only after a mutation of the checkout already under way, so a panel commit is never pushed unshown', async () => {
      const plan = await planPush();
      let release!: () => void;
      mutate.mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => { release = resolve; });
        status = { ...status, head: 'c'.repeat(40), ahead: 2 }; // the commit lands
        return { stdout: '', stderr: '' };
      });
      status = { ...status, files: [{ path: 'a.txt', oldPath: null, index: 'M', worktree: '.', untracked: false }] };
      const commit = scm.commit({ appSessionId: ID, message: 'x', noVerify: false });
      await vi.waitFor(() => expect(mutate).toHaveBeenCalled(), { timeout: 5_000 });
      const run = scm.run({ appSessionId: ID, token: plan.token }, 'push');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(spawned).toEqual([]);
      release();
      expect(await commit).toMatchObject({ ok: true, commit: { sha: 'c'.repeat(40) } });
      expect(await run).toMatchObject({ refused: 'changed', detail: 'head changed since the sheet opened; review it again' });
      expect(spawned).toEqual([]);
    });

    it('plans a pull request against the repository gh resolves and runs gh with --repo', async () => {
      const plan = await planPr();
      expect(plan).toMatchObject({
        kind: 'pr', program: GH, repository: 'o/r',
        argv: ['pr', 'create', '--repo', 'o/r', '--head', 'main', '--base', 'main', '--title=Panel PR', '--body='],
      });
      expect(ghCalls('repo view').map((s) => s.options.cwd)).toEqual([root]);
      expect(await scm.run({ appSessionId: ID, token: plan.token }, 'pr')).toEqual({ started: true, token: plan.token });
      expect(ghCalls('pr create').map((s) => s.argv)).toEqual([plan.argv]);
    });

    it('probes gh again after a refused PR plan, so the re-plan after Sign in issues a token', async () => {
      gh['auth status'] = { exitCode: 1, stderr: fixture('gh-auth-status-signed-out.txt') };
      status = { ...status, ahead: 0 };
      const input = { appSessionId: ID, title: 'Panel PR', body: '', base: 'main', draft: false };
      expect(await scm.planPr(input)).toMatchObject({ refused: 'gh_unauthenticated' });
      gh['auth status'] = { exitCode: 0 }; // `gh auth login` in the terminal
      expect(await scm.planPr(input)).toHaveProperty('token');
      expect(ghCalls('auth status')).toHaveLength(2);
      // a ready answer is kept
      await scm.planPr(input);
      expect(ghCalls('auth status')).toHaveLength(2);
    });

    it('probes gh again after it was missing, so an install shows on the next ask', async () => {
      env = { MAWS_GIT: GIT };
      scm = service();
      expect((await scm.status(ID)).gh).toEqual({ state: 'missing' });
      env.MAWS_GH = GH; // the deps' env object: gh is now found
      expect((await scm.status(ID)).gh).toMatchObject({ state: 'ready' });
    });

    it('answers gh_missing for a PR plan when gh is not on the captured PATH', async () => {
      env = { MAWS_GIT: GIT };
      scm = service();
      status = { ...status, ahead: 0 };
      expect(await scm.planPr({ appSessionId: ID, title: 't', body: '', base: 'main', draft: false })).toMatchObject({ refused: 'gh_missing' });
    });
  });

  describe('scm.remote.last and cancel', () => {
    it('answers the latest run before, during and after it, with the seq the next event exceeds', async () => {
      expect(await scm.last(ID)).toBeNull();
      const plan = await planPush();
      await scm.run({ appSessionId: ID, token: plan.token }, 'push');
      lastPush().err('Enumerating objects: 3, done.\n');
      const during = await scm.last(ID);
      expect(during).toMatchObject({ token: plan.token, kind: 'push', plan, running: true, exitCode: null, output: 'Enumerating objects: 3, done.\n', seq: 1 });
      lastPush().err('To /srv/origin.git\n');
      expect(events.at(-1)).toMatchObject({ appSessionId: ID, token: plan.token, seq: 2, kind: 'stderr' });
      expect(events.at(-1)!.seq).toBeGreaterThan(during!.seq);
      lastPush().close(0);
      expect(await scm.last(ID)).toMatchObject({ running: false, exitCode: 0, signal: null, output: 'Enumerating objects: 3, done.\nTo /srv/origin.git\n', seq: 3 });
      // the same checkout through another session sees the same run
      expect(await scm.last(OTHER)).toMatchObject({ token: plan.token });
    });

    it('cancels the checkout run of that token on its process group, and nothing for another token', async () => {
      const plan = await planPush();
      await scm.run({ appSessionId: ID, token: plan.token }, 'push');
      await scm.cancel({ appSessionId: ID, token: '33333333-3333-4333-8333-333333333333' });
      expect(kill).not.toHaveBeenCalled();
      await scm.cancel({ appSessionId: ID, token: plan.token });
      expect(kill).toHaveBeenCalledWith(lastPush().pid, 'SIGTERM');
    });

    it('stops every run on dispose and answers nothing after', async () => {
      const plan = await planPush();
      await scm.run({ appSessionId: ID, token: plan.token }, 'push');
      scm.dispose();
      expect(kill).toHaveBeenCalledWith(lastPush().pid, 'SIGTERM');
      expect(await scm.last(ID)).toBeNull();
    });
  });

  describe('the gh state on scm.status', () => {
    it('is ready when gh answers its version and auth status exits 0, probed outside the checkout', async () => {
      expect((await scm.status(ID)).gh).toEqual({ state: 'ready', path: GH, version: 'gh version 2.97.0 (2026-09-30)' });
      expect(ghCalls().map((s) => [s.argv, s.options.cwd])).toEqual([[['--version'], '/'], [['auth', 'status', '--active'], '/']]);
    });

    it('is unauthenticated with gh\'s first line for exit 1 and exit 4', async () => {
      for (const exitCode of [1, 4]) {
        gh['auth status'] = { exitCode, stderr: fixture('gh-auth-status-signed-out.txt') };
        scm = service();
        expect((await scm.status(ID)).gh).toEqual({
          state: 'unauthenticated', path: GH, version: 'gh version 2.97.0 (2026-09-30)',
          detail: 'You are not logged into any GitHub hosts. To log in, run: gh auth login',
        });
      }
    });

    it('is missing when gh is on neither MAWS_GH nor the captured PATH, and resolves it on that PATH', async () => {
      env = { MAWS_GIT: GIT };
      scm = service();
      expect((await scm.status(ID)).gh).toEqual({ state: 'missing' });
      expect(ghCalls()).toEqual([]);
    });

    it('is cached for ten minutes and probed again after them or when asked to refresh', async () => {
      await scm.status(ID);
      await scm.status(ID);
      expect(ghCalls('auth status')).toHaveLength(1);
      clock += 10 * MINUTE + 1;
      await scm.status(ID);
      expect(ghCalls('auth status')).toHaveLength(2);
      await scm.status(ID, { refresh: true });
      expect(ghCalls('auth status')).toHaveLength(3);
    });

    it('reads the default base from the remote HEAD symbolic ref, without --short', async () => {
      expect(await scm.status(ID)).toMatchObject({ defaultRemote: 'origin', defaultBase: 'main' });
    });

    // E11 (tracker row E6 "PR-state answer naming another branch not re-asked"): the remote picker lists what a plan
    // reads, so a remote defined only where the remote environment's git looks (a non-default XDG_CONFIG_HOME) shows
    it('lists the remotes through the push’s own git under the remote environment, as plans read them', async () => {
      expect(await scm.status(ID)).toMatchObject({ remotes: [{ name: 'origin', url: 'https://github.com/o/r.git' }] });
      expect(pushReaders).toEqual([{ program: GIT, captured }]);
      pushReaders = [];
      remotes = '';
      expect(await scm.prState({ appSessionId: ID, refresh: false })).toMatchObject({ error: 'no_remote' }); // the PR state's check too
      expect(pushReaders).toEqual([{ program: GIT, captured }]);
    });
  });

  describe('PR state', () => {
    it('answers the PR and its checks for the current branch', async () => {
      expect(await scm.prState({ appSessionId: ID, refresh: false })).toEqual({
        checkedAt: '2026-10-06T12:00:00.000Z',
        branch: 'main',
        gh: { state: 'ready', path: GH, version: 'gh version 2.97.0 (2026-09-30)' },
        pr: expect.objectContaining({ number: 12, state: 'OPEN', checks: expect.objectContaining({ summary: 'pending' }) }),
        error: null,
      });
      expect(ghCalls('pr view').map((s) => [s.argv[2], s.options.cwd])).toEqual([['main', root]]);
      expect(ghCalls('pr checks').map((s) => s.argv[2])).toEqual(['main']);
    });

    it('answers no PR apart from a failure, and reads no checks when there is no PR', async () => {
      gh['pr view'] = { exitCode: 1, stderr: fixture('gh-pr-view-none.txt') };
      expect(await scm.prState({ appSessionId: ID, refresh: true })).toMatchObject({ pr: null, error: null });
      gh['pr view'] = { exitCode: 1, stderr: 'HTTP 502: Bad Gateway\n' };
      expect(await scm.prState({ appSessionId: ID, refresh: true })).toMatchObject({ pr: null, error: 'HTTP 502: Bad Gateway' });
      expect(ghCalls('pr checks')).toEqual([]);
    });

    it('is cached 60 s per checkout and branch, and refresh bypasses the cache', async () => {
      await scm.prState({ appSessionId: ID, refresh: false });
      await scm.prState({ appSessionId: OTHER, refresh: false }); // the same checkout
      expect(ghCalls('pr view')).toHaveLength(1);
      await scm.prState({ appSessionId: ID, refresh: true });
      expect(ghCalls('pr view')).toHaveLength(2);
      clock += MINUTE + 1;
      await scm.prState({ appSessionId: ID, refresh: false });
      expect(ghCalls('pr view')).toHaveLength(3);
      status = { ...status, branch: 'other' };
      await scm.prState({ appSessionId: ID, refresh: false });
      expect(ghCalls('pr view').map((s) => s.argv[2])).toEqual(['main', 'main', 'main', 'other']);
    });

    it('does not keep a failed answer, so the next poll asks again', async () => {
      gh['pr view'] = { exitCode: 1, stderr: 'HTTP 502: Bad Gateway\n' };
      await scm.prState({ appSessionId: ID, refresh: false });
      await scm.prState({ appSessionId: ID, refresh: false });
      expect(ghCalls('pr view')).toHaveLength(2);
    });

    it('drops the checkout cache when a push of it ends', async () => {
      await scm.prState({ appSessionId: ID, refresh: false });
      const plan = await planPush();
      await scm.run({ appSessionId: ID, token: plan.token }, 'push');
      await scm.prState({ appSessionId: ID, refresh: false });
      expect(ghCalls('pr view')).toHaveLength(1); // still running
      lastPush().close(0);
      await scm.prState({ appSessionId: ID, refresh: false });
      expect(ghCalls('pr view')).toHaveLength(2);
    });

    it('re-probes gh when asked to refresh, so signing in shows on the next refresh', async () => {
      gh['auth status'] = { exitCode: 1, stderr: fixture('gh-auth-status-signed-out.txt') };
      expect(await scm.prState({ appSessionId: ID, refresh: false })).toMatchObject({ gh: { state: 'unauthenticated' }, pr: null, error: 'gh_unauthenticated' });
      gh['auth status'] = { exitCode: 0 };
      expect(await scm.prState({ appSessionId: ID, refresh: true })).toMatchObject({ gh: { state: 'ready' }, pr: { number: 12 }, error: null });
    });

    it('keeps no pre-run answer that was in flight when a run of the checkout ended', async () => {
      held.set('pr view', null);
      const reading = scm.prState({ appSessionId: ID, refresh: false });
      await vi.waitFor(() => expect(held.get('pr view')).toBeTypeOf('function'), { timeout: 5_000 });
      const plan = await planPush();
      await scm.run({ appSessionId: ID, token: plan.token }, 'push');
      lastPush().close(0); // the run ends while the read is still out
      held.get('pr view')!();
      held.delete('pr view');
      expect(await reading).toMatchObject({ pr: { number: 12 } }); // answered, but not kept
      await scm.prState({ appSessionId: ID, refresh: false });
      expect(ghCalls('pr view')).toHaveLength(2);
      await scm.prState({ appSessionId: ID, refresh: false }); // the post-run answer is kept
      expect(ghCalls('pr view')).toHaveLength(2);
    });

    it('never hands gh a branch beginning with - as a positional', async () => {
      status = { ...status, branch: '-x' };
      expect(await scm.prState({ appSessionId: ID, refresh: false })).toMatchObject({
        branch: '-x', pr: null, error: 'MAWS does not ask gh about a branch named "-x"',
      });
      expect(ghCalls('pr view')).toEqual([]);
    });

    it('answers gh_missing without running gh', async () => {
      env = { MAWS_GIT: GIT };
      scm = service();
      expect(await scm.prState({ appSessionId: ID, refresh: false })).toEqual({
        checkedAt: '2026-10-06T12:00:00.000Z', branch: 'main', gh: { state: 'missing' }, pr: null, error: 'gh_missing',
      });
      expect(spawned).toEqual([]);
    });

    it('answers untrusted with no PR and runs no gh in the checkout', async () => {
      trust.write({});
      expect(await scm.prState({ appSessionId: ID, refresh: false })).toMatchObject({ branch: null, pr: null, error: 'untrusted' });
      expect(ghCalls().filter((s) => s.options.cwd === root)).toEqual([]);
      expect(readStatus).not.toHaveBeenCalled();
    });

    it('answers detached and no_remote as the reason there is no PR', async () => {
      status = { ...status, branch: null };
      expect(await scm.prState({ appSessionId: ID, refresh: false })).toMatchObject({ branch: null, pr: null, error: 'detached' });
      status = { ...status, branch: 'main' };
      remotes = '';
      expect(await scm.prState({ appSessionId: ID, refresh: false })).toMatchObject({ branch: 'main', pr: null, error: 'no_remote' });
      expect(ghCalls('pr view')).toEqual([]);
    });
  });
});
