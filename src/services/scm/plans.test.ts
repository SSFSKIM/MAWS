// Plans over fake sources (a read runner answering by argv, a status, the trust answer, gh's state and its `repo view`):
// the exact argv, each refusal in its order, the token table, and the revalidation rule. One case plans against a real
// temporary repository with a local bare remote, so the git reads plans.ts parses are git's own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { RemotePlan, ScmGhState } from '@shared/ipc/schema/scm';
import { GitFixture, runGit } from '../../../test/support/git-fixture';
import { createGitRunner, GitCommandError, NotARepositoryError } from '../git/runner';
import { GitService } from '../git/service';
import {
  PLAN_TTL_MS,
  PlanTable,
  planPr,
  planPush,
  prArgv,
  prUrlOf,
  pushArgv,
  repositoryOf,
  revalidate,
  revalidatePlan,
  type IssuedPlan,
  type PlanDraft,
  type PlanSources,
} from './plans';
import type { CollectedRun } from './remote-runner';

const ID = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const OTHER = 'b2222222-2222-4222-8222-222222222222' as AppSessionId;
const HEAD = '0123456789abcdef0123456789abcdef01234567';
const GH: ScmGhState = { state: 'ready', path: '/opt/homebrew/bin/gh', version: 'gh version 2.97.0 (2026-09-30)' };
const UPSTREAM_FORMAT = 'for-each-ref --format=%(HEAD)%00%(upstream:remotename)%00%(upstream:remoteref) refs/heads';
const REPO_VIEW: CollectedRun = { exitCode: 0, signal: null, stdout: '{"nameWithOwner":"o/r","url":"https://github.com/o/r"}\n', stderr: '', failure: null };

const gitError = (stderr: string, code = 128) => new GitCommandError(`git failed: ${stderr.replace(/^fatal: /, '')}`, `${stderr}\n`, code, '');

interface World {
  trusted: boolean;
  status: GitStatus | Error;
  remotes: string[];
  upstream: { remote: string; ref: string } | null; // the current branch's, as for-each-ref answers it
  pushUrls: Record<string, string[]>;
  fetchUrls: Record<string, string>;
  invalidNames: string[]; // what check-ref-format --branch refuses
  expands: Record<string, string>; // what check-ref-format --branch answers otherwise (`@{-1}`)
  gh: ScmGhState;
  repoView: CollectedRun;
}

function makeSources(world: World) {
  const read = vi.fn(async (_directory: string, args: string[]): Promise<string> => {
    const command = args.join(' ');
    if (command === 'remote') return world.remotes.map((name) => `${name}\n`).join('');
    if (command === UPSTREAM_FORMAT) {
      const current = world.upstream === null ? '*\0\0' : `*\0${world.upstream.remote}\0${world.upstream.ref}`;
      return ` \0origin\0refs/heads/other\n${current}\n`;
    }
    if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === '--push') {
      const urls = world.pushUrls[args[4]];
      if (urls === undefined) throw gitError(`error: No such remote '${args[4]}'`, 2);
      return urls.map((url) => `${url}\n`).join('');
    }
    if (args[0] === 'remote' && args[1] === 'get-url') {
      const url = world.fetchUrls[args[2]];
      if (url === undefined) throw gitError(`error: No such remote '${args[2]}'`, 2);
      return `${url}\n`;
    }
    if (args[0] === 'check-ref-format' && args[1] === '--branch') {
      if (world.invalidNames.includes(args[2])) throw gitError(`fatal: '${args[2]}' is not a valid branch name`);
      return `${world.expands[args[2]] ?? args[2]}\n`;
    }
    throw new Error(`unexpected read: git ${command}`);
  });
  const status = vi.fn(async () => {
    if (world.status instanceof Error) throw world.status;
    return world.status;
  });
  const trusted = vi.fn(async () => world.trusted);
  const runGh = vi.fn<PlanSources['runGh']>(async () => world.repoView);
  const sources: PlanSources = { cwd: '/repo', trusted, status, read, pushRead: read, git: async () => '/opt/homebrew/bin/git', gh: async () => world.gh, runGh };
  return { sources, read, status, trusted, runGh };
}

const statusOf = (over: Partial<GitStatus> = {}): GitStatus => ({
  repoRoot: '/repo', gitDir: '/repo/.git', commonDir: '/repo/.git', isWorktree: false, branch: 'main', head: HEAD, upstream: 'origin/main',
  remoteUrl: 'https://github.com/o/r', ahead: 2, behind: 0, dirty: false, files: [], stashCount: 0, checkedAt: '2026-10-06T12:00:00.000Z', ...over,
});

let world: World;
beforeEach(() => {
  world = {
    trusted: true,
    status: statusOf(),
    remotes: ['origin'],
    upstream: { remote: 'origin', ref: 'refs/heads/main' },
    pushUrls: { origin: ['https://x-token:secret@github.com/o/r.git', '/srv/mirror.git'] },
    fetchUrls: { origin: 'https://x-token:secret@github.com/o/r.git' },
    invalidNames: [],
    expands: {},
    gh: GH,
    repoView: REPO_VIEW,
  };
});

describe('scm plans build the exact argv, bind the destination and expire tokens', () => {
  describe('argv', () => {
    it('push: the explicit refspec after the remote, --progress and --recurse-submodules=no always, --set-upstream only without an upstream', () => {
      expect(pushArgv({ remote: 'origin', branch: 'main', setUpstream: false })).toEqual(['push', '--progress', '--recurse-submodules=no', 'origin', 'refs/heads/main:refs/heads/main']);
      expect(pushArgv({ remote: 'fork', branch: 'feat/x', setUpstream: true })).toEqual(['push', '--progress', '--recurse-submodules=no', '--set-upstream', 'fork', 'refs/heads/feat/x:refs/heads/feat/x']);
    });

    it('pr: --repo, --head, --base, then --title= and --body= so a leading dash is a value; --draft only when asked', () => {
      expect(prArgv({ repository: 'o/r', head: 'main', base: 'main', title: 'Panel PR', body: '', draft: false })).toEqual([
        'pr', 'create', '--repo', 'o/r', '--head', 'main', '--base', 'main', '--title=Panel PR', '--body=',
      ]);
      expect(prArgv({ repository: 'ghe.example.com/o/r', head: 'feat', base: 'dev', title: '--help', body: '-x\nline two', draft: true })).toEqual([
        'pr', 'create', '--repo', 'ghe.example.com/o/r', '--head', 'feat', '--base', 'dev', '--title=--help', '--body=-x\nline two', '--draft',
      ]);
    });

    it('reads the repository gh resolves, prefixed with a host that is not github.com', () => {
      expect(repositoryOf('{"nameWithOwner":"o/r","url":"https://github.com/o/r"}')).toBe('o/r');
      expect(repositoryOf('{"nameWithOwner":"o/r","url":"https://GitHub.com/o/r"}')).toBe('o/r');
      expect(repositoryOf('{"nameWithOwner":"team/app","url":"https://ghe.example.com/team/app"}')).toBe('ghe.example.com/team/app');
      for (const bad of ['', 'not json', '{}', '{"nameWithOwner":"o/r"}', '{"nameWithOwner":"-o/r","url":"https://github.com/-o/r"}', '{"nameWithOwner":"o","url":"https://github.com/o"}', '{"nameWithOwner":"o/r","url":"not a url"}']) {
        expect(repositoryOf(bad)).toBeNull();
      }
    });

    it('reads the PR URL as the first https URL ending in /pull/<n>', () => {
      expect(prUrlOf('Creating pull request for main into main in o/r\n\nhttps://github.com/o/r/pull/7\n')).toBe('https://github.com/o/r/pull/7');
      expect(prUrlOf('https://ghe.example.com/team/app/pull/12 https://github.com/o/r/pull/7')).toBe('https://ghe.example.com/team/app/pull/12');
      expect(prUrlOf('https://github.com/o/r/issues/7\n')).toBeNull();
    });
  });

  describe('push plan', () => {
    it('names the program, the argv, every push destination without user-info and the head the sheet shows', async () => {
      const { sources } = makeSources(world);
      expect(await planPush(sources, {})).toEqual({
        plan: {
          kind: 'push', cwd: '/repo', program: '/opt/homebrew/bin/git', argv: ['push', '--progress', '--recurse-submodules=no', 'origin', 'refs/heads/main:refs/heads/main'],
          remote: 'origin', remoteUrl: 'https://github.com/o/r.git', pushUrls: ['https://github.com/o/r.git', '/srv/mirror.git'], repository: null,
          branch: 'main', head: HEAD, upstream: 'origin/main',
        },
        basis: { upstream: 'origin/main', ownUpstream: true },
      } satisfies PlanDraft);
    });

    it('publishes a branch without an upstream with --set-upstream to origin', async () => {
      world.status = statusOf({ branch: 'feat', upstream: null, ahead: 0 });
      world.upstream = null;
      const draft = await planPush(makeSources(world).sources, {});
      expect(draft).toMatchObject({
        plan: { argv: ['push', '--progress', '--recurse-submodules=no', '--set-upstream', 'origin', 'refs/heads/feat:refs/heads/feat'], upstream: 'origin/feat', branch: 'feat' },
        basis: { upstream: null, ownUpstream: false },
      });
    });

    it('a branch tracking another branch (made from origin/main) publishes under its own name and is not held by that branch being ahead', async () => {
      world.status = statusOf({ branch: 'feat', upstream: 'origin/main', behind: 3 });
      world.upstream = { remote: 'origin', ref: 'refs/heads/main' };
      expect(await planPush(makeSources(world).sources, {})).toMatchObject({
        plan: { argv: ['push', '--progress', '--recurse-submodules=no', '--set-upstream', 'origin', 'refs/heads/feat:refs/heads/feat'], upstream: 'origin/feat' },
        basis: { upstream: 'origin/main', ownUpstream: false },
      });
    });

    it('chooses the asked remote, else the upstream remote, else origin, else the sole remote', async () => {
      world.remotes = ['fork', 'origin'];
      world.pushUrls.fork = ['git@github.com:me/r.git'];
      world.fetchUrls.fork = 'git@github.com:me/r.git';
      expect(await planPush(makeSources(world).sources, { remote: 'fork' })).toMatchObject({ plan: { remote: 'fork', pushUrls: ['git@github.com:me/r.git'] } });
      world.upstream = { remote: 'fork', ref: 'refs/heads/main' };
      world.status = statusOf({ upstream: 'fork/main' });
      expect(await planPush(makeSources(world).sources, {})).toMatchObject({ plan: { remote: 'fork' } });
      world.upstream = null;
      world.status = statusOf({ upstream: null });
      expect(await planPush(makeSources(world).sources, {})).toMatchObject({ plan: { remote: 'origin' } });
      world.remotes = ['fork'];
      expect(await planPush(makeSources(world).sources, {})).toMatchObject({ plan: { remote: 'fork' } });
    });

    it('pushing to another remote than the upstream sets the upstream there, and the upstream elsewhere being ahead holds nothing', async () => {
      world.remotes = ['fork', 'origin'];
      world.pushUrls.fork = ['git@github.com:me/r.git'];
      world.fetchUrls.fork = 'git@github.com:me/r.git';
      world.status = statusOf({ behind: 4 }); // main tracks origin/main and is behind it
      expect(await planPush(makeSources(world).sources, { remote: 'fork' })).toMatchObject({
        plan: { remote: 'fork', argv: ['push', '--progress', '--recurse-submodules=no', '--set-upstream', 'fork', 'refs/heads/main:refs/heads/main'], upstream: 'fork/main' },
        basis: { upstream: 'origin/main', ownUpstream: false },
      });
      expect(await planPush(makeSources(world).sources, { remote: 'origin' })).toMatchObject({ refused: 'behind' });
    });

    it('with an own upstream on the chosen remote, the push keeps it: no --set-upstream, the same upstream', async () => {
      expect(await planPush(makeSources(world).sources, { remote: 'origin' })).toMatchObject({
        plan: { argv: ['push', '--progress', '--recurse-submodules=no', 'origin', 'refs/heads/main:refs/heads/main'], upstream: 'origin/main' },
        basis: { ownUpstream: true },
      });
    });

    it('reads nothing past the trust gate when untrusted', async () => {
      world.trusted = false;
      const { sources, status, read } = makeSources(world);
      expect(await planPush(sources, {})).toMatchObject({ refused: 'untrusted' });
      expect(status).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    });

    it.each<[string, (w: World) => void, string, RegExp]>([
      ['not a repository', (w) => { w.status = new NotARepositoryError(); }, 'not_repository', /Not a git repository/],
      ['detached', (w) => { w.status = statusOf({ branch: null }); }, 'detached', /detached/],
      // E11 (tracker row E6 "two short windows"): an unborn branch is refused at planning, not by the push in the Output
      ['a branch with no commits yet', (w) => { w.status = statusOf({ head: '', upstream: null, ahead: 0 }); w.upstream = null; }, 'unborn', /^main has no commits yet/],
      ['no remote', (w) => { w.remotes = []; }, 'no_remote', /no remote/],
      ['an unknown asked remote', () => {}, 'no_remote', /"elsewhere"/],
      ['several remotes, none origin, none upstream', (w) => { w.remotes = ['a', 'b']; w.upstream = null; }, 'no_remote', /Choose/],
      ['a remote named like an option', (w) => { w.remotes = ['-x']; w.upstream = null; }, 'no_remote', /"-x"/],
      ['a remote without a push URL', (w) => { w.pushUrls.origin = []; }, 'no_remote', /no URL/],
      ['behind its own upstream', (w) => { w.status = statusOf({ behind: 2 }); }, 'behind', /Pull in a terminal first/],
      ['a branch name git refuses', (w) => { w.invalidNames = ['main']; }, 'git_failed', /not a valid branch name/],
    ])('refuses %s', async (name, arrange, refused, detail) => {
      arrange(world);
      const answer = await planPush(makeSources(world).sources, name === 'an unknown asked remote' ? { remote: 'elsewhere' } : {});
      expect(answer).toMatchObject({ refused, detail: expect.stringMatching(detail) });
    });

    it('refuses in the order of the rules: detached before no remote, no remote before behind', async () => {
      world.status = statusOf({ branch: null, behind: 1 });
      world.remotes = [];
      expect(await planPush(makeSources(world).sources, {})).toMatchObject({ refused: 'detached' });
      world.status = statusOf({ behind: 1 });
      expect(await planPush(makeSources(world).sources, {})).toMatchObject({ refused: 'no_remote' });
    });

    it('refuses behind before a branch name git refuses', async () => {
      world.status = statusOf({ behind: 1 });
      world.invalidNames = ['main'];
      const { sources, read } = makeSources(world);
      expect(await planPush(sources, {})).toMatchObject({ refused: 'behind' });
      expect(read.mock.calls.some(([, args]) => args[0] === 'check-ref-format')).toBe(false);
    });
  });

  describe('pr plan', () => {
    const input = { title: 'Panel PR', body: '', base: 'main', draft: false };

    beforeEach(() => {
      world.status = statusOf({ ahead: 0 });
    });

    it('binds the repository gh resolves with --repo and names gh as the program', async () => {
      const { sources, runGh } = makeSources(world);
      expect(await planPr(sources, input)).toEqual({
        plan: {
          kind: 'pr', cwd: '/repo', program: '/opt/homebrew/bin/gh',
          argv: ['pr', 'create', '--repo', 'o/r', '--head', 'main', '--base', 'main', '--title=Panel PR', '--body='],
          remote: 'origin', remoteUrl: 'https://github.com/o/r.git', pushUrls: ['https://github.com/o/r.git', '/srv/mirror.git'], repository: 'o/r',
          branch: 'main', head: HEAD, upstream: 'origin/main',
        },
        basis: { upstream: 'origin/main', ownUpstream: true },
      } satisfies PlanDraft);
      expect(runGh).toHaveBeenCalledWith('/opt/homebrew/bin/gh', ['repo', 'view', '--json', 'nameWithOwner,url']);
    });

    it('adds --draft when asked and a GHE host to the repository', async () => {
      world.repoView = { ...REPO_VIEW, stdout: '{"nameWithOwner":"team/app","url":"https://ghe.example.com/team/app"}' };
      world.pushUrls = { origin: ['https://ghe.example.com/team/app.git'] };
      expect(await planPr(makeSources(world).sources, { ...input, draft: true })).toMatchObject({
        plan: { repository: 'ghe.example.com/team/app', argv: ['pr', 'create', '--repo', 'ghe.example.com/team/app', '--head', 'main', '--base', 'main', '--title=Panel PR', '--body=', '--draft'] },
      });
    });

    it.each<[string, (w: World) => void, string, RegExp]>([
      ['untrusted', (w) => { w.trusted = false; }, 'untrusted', /trust/],
      ['not a repository', (w) => { w.status = new NotARepositoryError(); }, 'not_repository', /Not a git repository/],
      ['detached', (w) => { w.status = statusOf({ branch: null, ahead: 0 }); }, 'detached', /detached/],
      ['gh missing', (w) => { w.gh = { state: 'missing' }; }, 'gh_missing', /GitHub CLI/],
      ['gh signed out', (w) => { w.gh = { state: 'unauthenticated', path: '/opt/gh', version: null, detail: 'You are not logged into any GitHub hosts.' }; }, 'gh_unauthenticated', /not logged into/],
      ['no upstream', (w) => { w.status = statusOf({ upstream: null, ahead: 0 }); w.upstream = null; }, 'not_pushed', /not pushed/],
      ['an upstream of another name', (w) => { w.upstream = { remote: 'origin', ref: 'refs/heads/dev' }; }, 'not_pushed', /tracks origin\/main/],
      ['commits not pushed', (w) => { w.status = statusOf({ ahead: 2 }); }, 'not_pushed', /2 commits/],
      ['behind its upstream', (w) => { w.status = statusOf({ ahead: 0, behind: 1 }); }, 'not_pushed', /behind/],
      ['gh resolving no repository', (w) => { w.repoView = { exitCode: 1, signal: null, stdout: '', stderr: 'none of the git remotes configured for this repository point to a known GitHub host\nmore\n', failure: null }; }, 'no_remote', /^none of the git remotes/],
      ['gh timing out', (w) => { w.repoView = { exitCode: null, signal: 'SIGKILL', stdout: '', stderr: '', failure: 'timed out after 30 s' }; }, 'no_remote', /timed out/],
      ['gh answering no JSON', (w) => { w.repoView = { ...REPO_VIEW, stdout: 'oops' }; }, 'no_remote', /no GitHub repository/],
      ['a base git refuses', (w) => { w.invalidNames = ['main']; }, 'git_failed', /not a valid branch name/],
      ['a base that names another branch', (w) => { w.expands = { main: 'feat' }; }, 'git_failed', /not a branch name/],
    ])('refuses %s', async (_name, arrange, refused, detail) => {
      arrange(world);
      expect(await planPr(makeSources(world).sources, input)).toMatchObject({ refused, detail: expect.stringMatching(detail) });
    });

    // `gh repo fork --clone`: origin is the fork, upstream the parent, and gh resolves the parent. The branch went to the
    // fork, so the head names the fork's owner (`gh pr create --help`: "`--head` supports `<user>:<branch>` syntax to
    // select a head repo owned by `<user>`"); unqualified, gh would ask for `parent:<branch>`.
    describe('a branch pushed to a fork', () => {
      const headOf = (draft: unknown) => {
        const argv = (draft as PlanDraft).plan.argv;
        return argv[argv.indexOf('--head') + 1];
      };
      const plannedHead = async (pushUrls: string[], repoView: { nameWithOwner: string; url: string } = { nameWithOwner: 'parent/r', url: 'https://github.com/parent/r' }) => {
        world.pushUrls = { origin: pushUrls };
        world.repoView = { ...REPO_VIEW, stdout: JSON.stringify(repoView) };
        return headOf(await planPr(makeSources(world).sources, input));
      };

      it('names the fork’s owner when the branch’s remote is another repository than the one gh targets (https and scp forms)', async () => {
        expect(await plannedHead(['https://github.com/me/r.git'])).toBe('me:main');
        expect(await plannedHead(['git@github.com:me/r.git'])).toBe('me:main');
        expect(await plannedHead(['ssh://git@github.com/me/r'])).toBe('me:main');
        expect(await plannedHead(['https://github.com/me/r.git/'])).toBe('me:main');
        const draft = await planPr(makeSources(world).sources, input);
        expect((draft as PlanDraft).plan.argv).toEqual(['pr', 'create', '--repo', 'parent/r', '--head', 'me:main', '--base', 'main', '--title=Panel PR', '--body=']);
      });

      it('reads a GHE remote’s host as the repository’s host', async () => {
        const ghe = { nameWithOwner: 'team/app', url: 'https://ghe.example.com/team/app' };
        expect(await plannedHead(['git@ghe.example.com:me/app.git'], ghe)).toBe('me:main');
        expect(await plannedHead(['https://ghe.example.com/team/app.git'], ghe)).toBe('main');
        expect(await plannedHead(['https://github.com/team/app.git'], ghe)).toBe('team:main'); // the same names on another host
      });

      it('keeps the bare branch when the remote is the repository gh targets, or names none git can read', async () => {
        expect(await plannedHead(['https://github.com/parent/r.git'])).toBe('main');
        expect(await plannedHead(['git@github.com:Parent/R.git'])).toBe('main'); // GitHub's names ignore case
        expect(await plannedHead(['/srv/mirror.git'])).toBe('main');
        expect(await plannedHead(['file:///srv/r.git'])).toBe('main');
        expect(await plannedHead(['https://github.com/parent'])).toBe('main');
        // several destinations: one of them is the target, so the branch is there
        expect(await plannedHead(['https://github.com/me/r.git', 'https://github.com/parent/r.git'])).toBe('main');
        expect(await plannedHead(['/srv/mirror.git', 'git@github.com:me/r.git'])).toBe('me:main');
      });
    });

    it('refuses in the order of the rules: gh before not pushed, not pushed before the repository', async () => {
      world.gh = { state: 'missing' };
      world.status = statusOf({ ahead: 3 });
      const { sources, runGh } = makeSources(world);
      expect(await planPr(sources, input)).toMatchObject({ refused: 'gh_missing' });
      world.gh = GH;
      expect(await planPr(sources, input)).toMatchObject({ refused: 'not_pushed' });
      expect(runGh).not.toHaveBeenCalled();
    });

    it('refuses the repository before a base git refuses', async () => {
      world.repoView = { exitCode: 1, signal: null, stdout: '', stderr: 'no GitHub remote\n', failure: null };
      world.invalidNames = ['main'];
      const { sources, read } = makeSources(world);
      expect(await planPr(sources, input)).toMatchObject({ refused: 'no_remote', detail: 'no GitHub remote' });
      expect(read.mock.calls.some(([, args]) => args[0] === 'check-ref-format')).toBe(false);
    });

    it('throws on a title holding a newline and on a NUL anywhere, before reading anything', async () => {
      const { sources, trusted } = makeSources(world);
      await expect(planPr(sources, { ...input, title: 'one\ntwo' })).rejects.toThrow(/newline/);
      await expect(planPr(sources, { ...input, title: 'one\rtwo' })).rejects.toThrow(/newline/);
      await expect(planPr(sources, { ...input, body: 'a\0b' })).rejects.toThrow(/NUL/);
      await expect(planPr(sources, { ...input, base: 'ma\0in' })).rejects.toThrow(/NUL/);
      expect(trusted).not.toHaveBeenCalled();
    });
  });

  describe('plans expire tokens', () => {
    let now: number;
    let table: PlanTable;
    const draft = (kind: 'push' | 'pr' = 'push'): PlanDraft => ({
      plan: {
        kind, cwd: '/repo', program: '/usr/bin/git', argv: ['push'], remote: 'origin', remoteUrl: null, pushUrls: ['/o.git'], repository: null,
        branch: 'main', head: HEAD, upstream: 'origin/main',
      },
      basis: { upstream: 'origin/main', ownUpstream: true },
    });
    const presented = (over: Partial<{ appSessionId: AppSessionId; key: string; kind: 'push' | 'pr' }> = {}) => ({ appSessionId: ID, key: '/repo', kind: 'push' as const, ...over });

    beforeEach(() => {
      now = Date.parse('2026-10-06T12:00:00.000Z');
      table = new PlanTable(() => now);
    });

    it('issues a fresh uuid per plan, expiring in 5 minutes', () => {
      const a = table.issue(draft(), { appSessionId: ID, key: '/repo' });
      const b = table.issue(draft(), { appSessionId: ID, key: '/repo' });
      expect(a.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(b.token).not.toBe(a.token);
      expect(a).toEqual({ ...draft().plan, token: a.token, expiresAt: '2026-10-06T12:05:00.000Z' });
      expect(PLAN_TTL_MS).toBe(5 * 60_000);
    });

    it('a new plan retires the older ones of its session, checkout and kind, and only those', () => {
      const old = table.issue(draft('pr'), { appSessionId: ID, key: '/repo' });
      const push = table.issue(draft('push'), { appSessionId: ID, key: '/repo' });
      const otherSession = table.issue(draft('pr'), { appSessionId: OTHER, key: '/repo' });
      const otherCheckout = table.issue(draft('pr'), { appSessionId: ID, key: '/elsewhere' });
      const fresh = table.issue(draft('pr'), { appSessionId: ID, key: '/repo' }); // the sheet re-planned after an edit
      expect(table.consume(old.token, presented({ kind: 'pr' }))).toMatchObject({ refused: 'plan_expired' });
      expect(table.consume(fresh.token, presented({ kind: 'pr' }))).toMatchObject({ plan: { token: fresh.token } });
      expect(table.consume(push.token, presented())).toMatchObject({ plan: { token: push.token } });
      expect(table.consume(otherSession.token, presented({ kind: 'pr', appSessionId: OTHER }))).toMatchObject({ plan: { token: otherSession.token } });
      expect(table.consume(otherCheckout.token, presented({ kind: 'pr', key: '/elsewhere' }))).toMatchObject({ plan: { token: otherCheckout.token } });
    });

    it('consumes a token once', () => {
      const { token } = table.issue(draft(), { appSessionId: ID, key: '/repo' });
      const issued = table.consume(token, presented());
      expect(issued).toMatchObject({ plan: { token }, basis: { upstream: 'origin/main', ownUpstream: true }, appSessionId: ID, key: '/repo' });
      expect(table.consume(token, presented())).toMatchObject({ refused: 'plan_expired' });
    });

    it.each<[string, () => void, ReturnType<typeof presented>]>([
      ['expired', () => { now += PLAN_TTL_MS; }, presented()],
      ['of the other kind', () => {}, presented({ kind: 'pr' })],
      ['presented by another session', () => {}, presented({ appSessionId: OTHER })],
      ['presented for another checkout', () => {}, presented({ key: '/elsewhere' })],
    ])('answers plan_expired for a token %s, and the token is spent', (_name, arrange, wrong) => {
      const { token } = table.issue(draft(), { appSessionId: ID, key: '/repo' });
      arrange();
      expect(table.consume(token, wrong)).toMatchObject({ refused: 'plan_expired', detail: expect.stringMatching(/review/) });
      now = Date.parse('2026-10-06T12:00:00.000Z');
      expect(table.consume(token, presented())).toMatchObject({ refused: 'plan_expired' });
    });

    it('answers plan_expired for a token it never issued, and after clear', () => {
      expect(table.consume('33333333-3333-4333-8333-333333333333', presented())).toMatchObject({ refused: 'plan_expired' });
      const { token } = table.issue(draft(), { appSessionId: ID, key: '/repo' });
      table.clear();
      expect(table.consume(token, presented())).toMatchObject({ refused: 'plan_expired' });
    });

    it('a token just inside its life is honoured', () => {
      const { token } = table.issue(draft(), { appSessionId: ID, key: '/repo' });
      now += PLAN_TTL_MS - 1;
      expect(table.consume(token, presented())).toMatchObject({ plan: { token } });
    });
  });

  describe('plans revalidate what the sheet showed', () => {
    const issued = (kind: 'push' | 'pr' = 'push', ownUpstream = true, over: Partial<RemotePlan> = {}): IssuedPlan => ({
      plan: {
        token: '11111111-1111-4111-8111-111111111111', kind, cwd: '/repo', program: '/usr/bin/git', argv: ['push'], remote: 'origin', remoteUrl: null,
        pushUrls: ['https://github.com/o/r.git'], repository: kind === 'pr' ? 'o/r' : null, branch: 'main', head: HEAD,
        upstream: 'origin/main', expiresAt: '2026-10-06T12:05:00.000Z', ...over,
      },
      basis: { upstream: 'origin/main', ownUpstream },
      appSessionId: ID, key: '/repo', expiresAtMs: Date.parse('2026-10-06T12:05:00.000Z'),
    });
    const fresh = (over: Partial<GitStatus> = {}, pushUrls: string[] | null = ['https://github.com/o/r.git'], trusted = true) => ({
      trusted, status: statusOf({ ahead: 0, ...over }), pushUrls,
    });

    it('passes when nothing moved (a push may be ahead; that is what it pushes)', () => {
      expect(revalidate(issued(), fresh({ ahead: 3 }))).toBeNull();
      expect(revalidate(issued('pr'), fresh())).toBeNull();
    });

    it.each<[string, IssuedPlan, ReturnType<typeof fresh>, string, RegExp]>([
      ['trust withdrawn', issued(), fresh({}, undefined, false), 'untrusted', /trust/],
      ['another branch', issued(), fresh({ branch: 'other' }), 'changed', /^branch changed since the sheet opened; review it again$/],
      ['a detached head', issued(), fresh({ branch: null }), 'changed', /^branch changed/],
      ['another head', issued(), fresh({ head: 'f'.repeat(40) }), 'changed', /^head changed since the sheet opened; review it again$/],
      ['another upstream', issued(), fresh({ upstream: 'fork/main' }), 'changed', /^upstream changed/],
      ['the upstream moved ahead (push)', issued(), fresh({ behind: 1 }), 'changed', /^origin\/main changed/],
      ['the upstream moved (pr, ahead)', issued('pr'), fresh({ ahead: 1 }), 'changed', /^origin\/main changed/],
      ['the upstream moved (pr, behind)', issued('pr'), fresh({ behind: 1 }), 'changed', /^origin\/main changed/],
      ['a changed push URL', issued(), fresh({}, ['https://github.com/evil/r.git']), 'changed', /^destination changed/],
      ['an added push URL', issued(), fresh({}, ['https://github.com/o/r.git', '/srv/m.git']), 'changed', /^destination changed/],
      ['a removed remote', issued(), fresh({}, null), 'changed', /^destination changed/],
    ])('answers %s', (_name, plan, facts, refused, detail) => {
      expect(revalidate(plan, facts)).toMatchObject({ refused, detail: expect.stringMatching(detail) });
    });

    it('a push publishing a branch that tracks another is not held by that branch moving', () => {
      expect(revalidate(issued('push', false), fresh({ behind: 4 }))).toBeNull();
    });

    it('reads trust first, then the status and the destinations of the plan remote', async () => {
      world.status = statusOf({ ahead: 0 });
      world.pushUrls.origin = ['https://github.com/o/r.git'];
      const { sources, status, read } = makeSources(world);
      expect(await revalidatePlan(sources, issued())).toBeNull();
      expect(read).toHaveBeenCalledWith('/repo', ['remote', 'get-url', '--push', '--all', 'origin']);
      world.pushUrls = {};
      expect(await revalidatePlan(sources, issued())).toMatchObject({ refused: 'changed', detail: expect.stringMatching(/^destination/) });
      world.status = new NotARepositoryError();
      expect(await revalidatePlan(sources, issued())).toMatchObject({ refused: 'not_repository' });
      world.trusted = false;
      status.mockClear();
      expect(await revalidatePlan(sources, issued())).toMatchObject({ refused: 'untrusted' });
      expect(status).not.toHaveBeenCalled();
    });
  });

  describe('plans against a real repository', () => {
    let repo: GitFixture;
    let origin: string;

    beforeEach(async () => {
      repo = await GitFixture.create();
      origin = await repo.addBareRemote();
    });
    afterEach(() => repo.dispose());

    it('reads every push destination and the upstream git itself reports, then sees a new commit as a moved head', async () => {
      await repo.git('remote', 'set-url', '--add', '--push', 'origin', origin);
      await repo.git('remote', 'set-url', '--add', '--push', 'origin', 'https://user:pass@example.invalid/o/r.git');
      await repo.write('a.txt', 'a\n');
      await repo.git('add', 'a.txt');
      await repo.git('commit', '-q', '-m', 'ahead');
      const read = createGitRunner({ env: repo.serviceEnv() });
      const git = new GitService({ env: repo.serviceEnv() });
      const sources: PlanSources = {
        cwd: repo.root, trusted: async () => true, status: () => git.status(repo.root), read, pushRead: read, git: async () => '/usr/bin/git', gh: async () => GH,
        runGh: async () => REPO_VIEW,
      };
      const draft = await planPush(sources, {});
      expect(draft).toMatchObject({
        plan: { argv: ['push', '--progress', '--recurse-submodules=no', 'origin', 'refs/heads/main:refs/heads/main'], remote: 'origin', remoteUrl: origin, pushUrls: [origin, 'https://example.invalid/o/r.git'], upstream: 'origin/main' },
        basis: { upstream: 'origin/main', ownUpstream: true },
      });
      expect(await planPr(sources, { title: 't', body: '', base: 'main', draft: false })).toMatchObject({ refused: 'not_pushed', detail: expect.stringMatching(/1 commit not pushed/) });

      await repo.git('checkout', '-q', '-b', 'feat', 'origin/main'); // tracks origin/main, as a branch made from it does
      expect(await planPush(sources, {})).toMatchObject({
        plan: { argv: ['push', '--progress', '--recurse-submodules=no', '--set-upstream', 'origin', 'refs/heads/feat:refs/heads/feat'] }, basis: { upstream: 'origin/main', ownUpstream: false },
      });
      await repo.git('checkout', '-q', 'main');

      const table = new PlanTable();
      const plan = table.issue(draft as PlanDraft, { appSessionId: ID, key: repo.root });
      const issued = table.consume(plan.token, { appSessionId: ID, key: repo.root, kind: 'push' }) as IssuedPlan;
      expect(await revalidatePlan(sources, issued)).toBeNull();
      await repo.write('b.txt', 'b\n');
      await repo.git('add', 'b.txt');
      await repo.git('commit', '-q', '-m', 'while the sheet was open');
      expect(await revalidatePlan(sources, issued)).toMatchObject({ refused: 'changed', detail: 'head changed since the sheet opened; review it again' });
      git.dispose();
    });

    // E11 scale review B scalpel-4#1: the sheet lists the superproject's push destinations only, so the planned push
    // must not follow an owner's `push.recurseSubmodules` (or `submodule.recurse`) to a submodule's remote
    it('the planned push reaches only the remote the sheet shows, even with the owner set to push submodules', async () => {
      const library = await GitFixture.create();
      const libraryRemote = await library.addBareRemote();
      try {
        await repo.git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', libraryRemote, 'lib'); // the fixture's remotes are local paths
        await repo.git('commit', '-q', '-m', 'add lib');
        const lib = repo.path('lib');
        await runGit(lib, ['config', 'protocol.file.allow', 'always']);
        await runGit(lib, ['commit', '-q', '--allow-empty', '-m', 'not on the library remote']);
        const unpushed = (await runGit(lib, ['rev-parse', 'HEAD'])).trim();
        await repo.git('add', 'lib');
        await repo.git('commit', '-q', '-m', 'bump lib');
        await repo.git('config', 'push.recurseSubmodules', 'on-demand');
        await repo.git(...pushArgv({ remote: 'origin', branch: 'main', setUpstream: false }));
        expect((await runGit(origin, ['rev-parse', 'main'])).trim()).toBe((await repo.git('rev-parse', 'HEAD')).trim());
        expect((await runGit(libraryRemote, ['rev-parse', 'main'])).trim()).not.toBe(unpushed);
      } finally {
        library.dispose();
      }
    });
  });
});
