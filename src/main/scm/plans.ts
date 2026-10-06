// Plans (E6 execution document, Design §4, §10; P-12): main's record of the one remote command it is willing to run.
// A plan names the program, the exact argv, the cwd and what the confirm sheet shows (the remote, every push
// destination, the repository a PR targets, the branch and the head); it is issued under a one-shot token bound to its
// session and checkout that expires in 5 minutes; the run consumes the token and first revalidates what the sheet
// showed against fresh reads, so a remote re-pointed or a commit made while the sheet was open never runs under the old
// confirm. The renderer never composes a command: it sees the plan and sends back the token.
//
// The rules are checked in Design §4's order, each answering a refusal value the sheet explains. Every argv is built
// from names git or gh answered (the remote from `git remote`, branches through `check-ref-format --branch`, the
// repository from `gh repo view`); user text goes in `--flag=value` form. MAWS never force-pushes.
//
// A branch's "own upstream" is `<remote>/<branch>` on the remote it goes to, under the same name (`refs/heads/<branch>`
// on that side). A branch made from `origin/main` tracks `origin/main` (git's `branch.autoSetupMerge`); pushing it
// publishes `refs/heads/<branch>` and sets that as its upstream, and how far it is behind `origin/main` says nothing
// about the destination, so only an own upstream holds a push back for being behind. Pushing to another remote than the
// upstream's likewise publishes there and sets the upstream to it, as `git push -u` would: the plan's `upstream` is what
// the argv makes it. A pull request needs an own upstream even with the branch, so `--head <branch>` names exactly the
// commits the sheet showed; when that upstream's remote is a fork of the repository gh targets, the head names the
// fork's owner (`<owner>:<branch>`, prHead).
import { randomUUID } from 'node:crypto';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { RemotePlan, ScmGhState, ScmPrPlanInput, ScmPushPlanInput, ScmRefusal } from '@shared/ipc/schema/scm';
import { GitCommandError, NotARepositoryError, type GitRun } from '../git/runner';
import { withoutUserInfo } from '../git/service';
import { runReason, type CollectedRun } from './remote-runner';
import { isRefusal, refusal, UNTRUSTED_DETAIL } from './validate';

export const PLAN_TTL_MS = 5 * 60_000;

// What a plan is computed from; the service binds each to the checkout.
export interface PlanSources {
  cwd: string; // the checkout: the run's cwd and every read's directory
  trusted(): Promise<boolean>; // the engine's trust for the checkout, read now
  status(): Promise<GitStatus>; // C4's fresh status; NotARepositoryError outside a repository
  read: GitRun; // the read runner
  git(): Promise<string>; // the git a push runs (which.ts on the remote environment)
  gh(): Promise<ScmGhState>; // gh resolved and probed (Design §6)
  runGh(program: string, argv: string[]): Promise<CollectedRun>; // gh in the checkout under the remote environment
}

// What the sheet's confirm rests on beyond the plan itself, kept with the plan for its revalidation.
export interface PlanBasis {
  upstream: string | null; // the branch's upstream when planned
  ownUpstream: boolean; // that upstream is `<remote>/<branch>` under the branch's own name
}
export interface PlanDraft {
  plan: Omit<RemotePlan, 'token' | 'expiresAt'>;
  basis: PlanBasis;
}
export interface IssuedPlan {
  plan: RemotePlan;
  basis: PlanBasis;
  appSessionId: AppSessionId;
  key: string; // the checkout's realpath
  expiresAtMs: number;
}

export function pushArgv({ remote, branch, setUpstream }: { remote: string; branch: string; setUpstream: boolean }): string[] {
  // The explicit refspec: no option parsing reaches the branch name and no `push.default` rule redirects it.
  return ['push', '--progress', ...(setUpstream ? ['--set-upstream'] : []), remote, `refs/heads/${branch}:refs/heads/${branch}`];
}

// `head` is the branch, or `<owner>:<branch>` when the branch lives in a fork of the repository (prHead).
export function prArgv(input: { repository: string; head: string; base: string; title: string; body: string; draft: boolean }): string[] {
  const { repository, head, base, title, body, draft } = input;
  return ['pr', 'create', '--repo', repository, '--head', head, '--base', base, `--title=${title}`, `--body=${body}`, ...(draft ? ['--draft'] : [])];
}

const NAME_WITH_OWNER = /^[\w.][\w.-]*\/[\w.][\w.-]*$/;

// `OWNER/REPO` on github.com, `HOST/OWNER/REPO` elsewhere: what `--repo` takes.
const qualified = (host: string, nameWithOwner: string) => (host === 'github.com' ? nameWithOwner : `${host}/${nameWithOwner}`);

// `gh repo view --json nameWithOwner,url`: `OWNER/REPO`, or `HOST/OWNER/REPO` off github.com (what `--repo` takes).
export function repositoryOf(stdout: string): string | null {
  let answer: unknown;
  try {
    answer = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof answer !== 'object' || answer === null) return null;
  const { nameWithOwner, url } = answer as { nameWithOwner?: unknown; url?: unknown };
  if (typeof nameWithOwner !== 'string' || !NAME_WITH_OWNER.test(nameWithOwner) || typeof url !== 'string') return null;
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
  return qualified(host, nameWithOwner);
}

// The repository a remote URL names, spelled as `repositoryOf` spells gh's, with its owner: a URL with a host
// (`https://host/owner/repo.git`, `ssh://git@host/owner/repo`) or git's scp form (`git@host:owner/repo.git`). Null for a
// local path, a `file:` URL or a path that is not `owner/repo`.
export function remoteRepositoryOf(url: string): { repository: string; owner: string } | null {
  let host: string;
  let path: string;
  if (url.includes('://')) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol === 'file:' || parsed.hostname === '') return null;
    host = parsed.hostname;
    path = parsed.pathname;
  } else {
    // git reads `[user@]host:path` as scp-like only when the colon comes before any slash
    const scp = /^(?:[^@/]*@)?([^/:]+):(.*)$/.exec(url);
    if (scp === null) return null;
    [, host, path] = scp;
  }
  const nameWithOwner = path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  if (!NAME_WITH_OWNER.test(nameWithOwner)) return null;
  return { repository: qualified(host.toLowerCase(), nameWithOwner), owner: nameWithOwner.split('/')[0] };
}

// The head `gh pr create` takes: the branch, or `<owner>:<branch>` when the branch's remote is a fork of the repository
// the PR targets (`gh repo fork --clone` leaves origin the fork while gh resolves the parent; the branch went to the
// fork, and an unqualified head would name the parent's branch of that name). Read from the remote's push URLs (its
// fetch URL when it has no push URL of its own): when one of them is the target, or none names a repository, the branch
// stands. GitHub's names ignore case.
export function prHead(branch: string, repository: string, pushUrls: readonly string[]): string {
  const named = pushUrls.map(remoteRepositoryOf).filter((remote) => remote !== null);
  const target = repository.toLowerCase();
  if (named.length === 0 || named.some((remote) => remote.repository.toLowerCase() === target)) return branch;
  return `${named[0].owner}:${branch}`;
}

// The pull request `gh pr create` printed.
export function prUrlOf(stdout: string): string | null {
  return /https?:\/\/\S+?\/pull\/\d+/.exec(stdout)?.[0] ?? null;
}

export async function planPush(sources: PlanSources, { remote: asked }: Pick<ScmPushPlanInput, 'remote'>): Promise<PlanDraft | ScmRefusal> {
  if (asked !== undefined && asked.includes('\0')) throw new Error('a remote name cannot hold a NUL character');
  const status = await gate(sources);
  if (isRefusal(status)) return status;
  const branch = status.branch;
  if (branch === null) return refusal('detached', 'HEAD is detached; check out a branch to push it');
  const upstream = await upstreamOf(sources);
  const remote = await chooseRemote(sources, asked, upstream.remote);
  if (isRefusal(remote)) return remote;
  const destination = await destinationOf(sources, remote);
  if (isRefusal(destination)) return destination;
  const ownUpstream = isOwnUpstream(status, upstream, branch, remote);
  if (ownUpstream && status.behind > 0) {
    return refusal('behind', `${branch} is ${commits(status.behind)} behind ${status.upstream}. Pull in a terminal first; MAWS never force-pushes`);
  }
  const named = await branchNameRefusal(sources, branch);
  if (named !== null) return named;
  return {
    plan: {
      kind: 'push', cwd: sources.cwd, program: await sources.git(), argv: pushArgv({ remote, branch, setUpstream: !ownUpstream }), remote,
      ...destination, repository: null, branch, head: status.head, upstream: `${remote}/${branch}`,
    },
    basis: { upstream: status.upstream, ownUpstream },
  };
}

export async function planPr(sources: PlanSources, input: Omit<ScmPrPlanInput, 'appSessionId'>): Promise<PlanDraft | ScmRefusal> {
  const { title, body, base, draft } = input;
  if ([title, body, base].some((text) => text.includes('\0'))) throw new Error('a pull request field cannot hold a NUL character');
  if (/[\r\n]/.test(title)) throw new Error('a pull request title cannot hold a newline');
  const status = await gate(sources);
  if (isRefusal(status)) return status;
  const branch = status.branch;
  if (branch === null) return refusal('detached', 'HEAD is detached; check out the branch to open a pull request from');
  const gh = await sources.gh();
  if (gh.state === 'missing') return refusal('gh_missing', 'The GitHub CLI (gh) is not installed');
  if (gh.state === 'unauthenticated') return refusal('gh_unauthenticated', gh.detail);
  const upstream = await upstreamOf(sources);
  const unpushed = notPushed(status, upstream, branch);
  if (unpushed !== null) return unpushed;
  const remote = upstream.remote as string; // an own upstream names its remote
  const view = await sources.runGh(gh.path, ['repo', 'view', '--json', 'nameWithOwner,url']);
  const repository = view.exitCode === 0 ? repositoryOf(view.stdout) : null;
  if (repository === null) {
    return refusal('no_remote', runReason(view, 'gh resolved no GitHub repository for this checkout'), joinStreams(view));
  }
  const named = await branchNameRefusal(sources, base);
  if (named !== null) return named;
  const destination = await destinationOf(sources, remote);
  if (isRefusal(destination)) return destination;
  const head = prHead(branch, repository, destination.pushUrls);
  return {
    plan: {
      kind: 'pr', cwd: sources.cwd, program: gh.path, argv: prArgv({ repository, head, base, title, body, draft }), remote, ...destination,
      repository, branch, head: status.head, upstream: status.upstream,
    },
    basis: { upstream: status.upstream, ownUpstream: true },
  };
}

// Plans issued and not yet run, by token. Any presentation spends the token: a second use, an expired one, one of the
// other kind or one presented for another session or checkout answers `plan_expired`, and the sheet plans again. A new
// plan retires the older ones of its session, checkout and kind, so a submit racing a re-plan (a PR sheet re-plans as
// its fields are edited) can never run what the sheet no longer shows.
export class PlanTable {
  private readonly plans = new Map<string, IssuedPlan>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = PLAN_TTL_MS,
  ) {}

  issue(draft: PlanDraft, binding: { appSessionId: AppSessionId; key: string }): RemotePlan {
    const now = this.now();
    for (const [token, issued] of this.plans) {
      const superseded = issued.appSessionId === binding.appSessionId && issued.key === binding.key && issued.plan.kind === draft.plan.kind;
      if (superseded || now >= issued.expiresAtMs) this.plans.delete(token);
    }
    const expiresAtMs = now + this.ttlMs;
    const plan: RemotePlan = { ...draft.plan, token: randomUUID(), expiresAt: new Date(expiresAtMs).toISOString() };
    this.plans.set(plan.token, { plan, basis: draft.basis, ...binding, expiresAtMs });
    return plan;
  }

  consume(token: string, presented: { appSessionId: AppSessionId; key: string; kind: RemotePlan['kind'] }): IssuedPlan | ScmRefusal {
    const issued = this.plans.get(token);
    this.plans.delete(token);
    if (
      issued === undefined || this.now() >= issued.expiresAtMs || issued.plan.kind !== presented.kind ||
      issued.appSessionId !== presented.appSessionId || issued.key !== presented.key
    ) {
      return refusal('plan_expired', 'This confirmation is no longer valid; review the command again');
    }
    return issued;
  }

  clear(): void {
    this.plans.clear();
  }
}

export interface FreshFacts {
  trusted: boolean;
  status: GitStatus;
  pushUrls: string[] | null; // null when the remote has no push URL any more
}

// What the sheet showed, against fresh reads: the branch, the head, the upstream and how far the branch stands from it
// (a push with an own upstream must not be behind it; a pull request's branch must still be even with it), and every
// push destination of the plan's remote. The first difference is named.
export function revalidate({ plan, basis }: Pick<IssuedPlan, 'plan' | 'basis'>, { trusted, status, pushUrls }: FreshFacts): ScmRefusal | null {
  if (!trusted) return refusal('untrusted', UNTRUSTED_DETAIL);
  const moved = (what: string) => refusal('changed', `${what} changed since the sheet opened; review it again`);
  if (status.branch !== plan.branch) return moved('branch');
  if (status.head !== plan.head) return moved('head');
  if (status.upstream !== basis.upstream) return moved('upstream');
  const held = plan.kind === 'pr' ? status.ahead !== 0 || status.behind !== 0 : basis.ownUpstream && status.behind !== 0;
  if (held) return moved(status.upstream ?? 'upstream');
  if (pushUrls === null || !sameList(pushUrls, plan.pushUrls)) return moved('destination');
  return null;
}

// The reads `revalidate` compares, trust first (nothing else is read for an untrusted checkout).
export async function revalidatePlan(sources: PlanSources, issued: Pick<IssuedPlan, 'plan' | 'basis'>): Promise<ScmRefusal | null> {
  if (!(await sources.trusted())) return refusal('untrusted', UNTRUSTED_DETAIL);
  let status: GitStatus;
  try {
    status = await sources.status();
  } catch (error) {
    if (error instanceof NotARepositoryError) return refusal('not_repository', 'Not a git repository');
    throw error;
  }
  return revalidate(issued, { trusted: true, status, pushUrls: await pushUrlsOf(sources, issued.plan.remote) });
}

// Trust, then a repository: the first two rules of every plan.
async function gate(sources: PlanSources): Promise<GitStatus | ScmRefusal> {
  if (!(await sources.trusted())) return refusal('untrusted', UNTRUSTED_DETAIL);
  try {
    return await sources.status();
  } catch (error) {
    if (error instanceof NotARepositoryError) return refusal('not_repository', 'Not a git repository');
    throw error;
  }
}

interface UpstreamFacts {
  remote: string | null; // `%(upstream:remotename)`: the remote's name exactly (it may hold a slash)
  ref: string | null; // `%(upstream:remoteref)`: the branch on the remote side
}

// The current branch's upstream as git configured it.
async function upstreamOf(sources: PlanSources): Promise<UpstreamFacts> {
  const out = await sources.read(sources.cwd, ['for-each-ref', '--format=%(HEAD)%00%(upstream:remotename)%00%(upstream:remoteref)', 'refs/heads']);
  const [, remote = '', ref = ''] = out.split('\n').find((line) => line.startsWith('*\0'))?.split('\0') ?? [];
  return { remote: remote === '' ? null : remote, ref: ref === '' ? null : ref };
}

// The branch tracks `<remote>/<branch>` on the remote it goes to, under its own name.
function isOwnUpstream(status: GitStatus, upstream: UpstreamFacts, branch: string, remote: string | null): boolean {
  return status.upstream !== null && upstream.remote !== null && upstream.remote === remote && upstream.ref === `refs/heads/${branch}`;
}

// The asked remote, else the upstream's, else `origin`, else the sole remote; always one `git remote` lists.
async function chooseRemote(sources: PlanSources, asked: string | undefined, upstreamRemote: string | null): Promise<string | ScmRefusal> {
  const names = (await sources.read(sources.cwd, ['remote'])).split('\n').filter((name) => name !== '');
  if (names.length === 0) return refusal('no_remote', 'This repository has no remote to push to');
  let remote: string | undefined;
  if (asked !== undefined) {
    if (!names.includes(asked)) return refusal('no_remote', `There is no remote named ${JSON.stringify(asked)}`);
    remote = asked;
  } else {
    remote = [upstreamRemote, 'origin'].find((name) => name !== null && names.includes(name)) ?? (names.length === 1 ? names[0] : undefined);
  }
  if (remote === undefined) return refusal('no_remote', `Choose a remote: ${names.join(', ')}`);
  // Read as an option where the push puts the remote; git allows the name, MAWS does not push to it.
  if (remote.startsWith('-')) return refusal('no_remote', `MAWS does not push to a remote named ${JSON.stringify(remote)}`);
  return remote;
}

// Every URL the remote pushes to (a `pushurl` may differ from the fetch URL, and there may be several), and the fetch
// URL the GitHub link is made from, each without user-info.
async function destinationOf(sources: PlanSources, remote: string): Promise<Pick<RemotePlan, 'remoteUrl' | 'pushUrls'> | ScmRefusal> {
  const pushUrls = await pushUrlsOf(sources, remote);
  if (pushUrls === null) return refusal('no_remote', `The remote ${JSON.stringify(remote)} has no URL to push to`);
  let remoteUrl: string | null = null;
  try {
    remoteUrl = withoutUserInfo((await sources.read(sources.cwd, ['remote', 'get-url', remote])).trim()) || null;
  } catch (error) {
    if (!(error instanceof GitCommandError)) throw error;
  }
  return { remoteUrl, pushUrls };
}

async function pushUrlsOf(sources: PlanSources, remote: string): Promise<string[] | null> {
  try {
    const urls = (await sources.read(sources.cwd, ['remote', 'get-url', '--push', '--all', remote])).split('\n').filter((url) => url !== '');
    return urls.length === 0 ? null : urls.map(withoutUserInfo);
  } catch (error) {
    if (error instanceof GitCommandError) return null;
    throw error;
  }
}

// `check-ref-format --branch` must accept the name and answer it unchanged (it expands `@{-1}` to another branch).
// A refusal here is git's (`git_failed`, its words in `output`): the refusal codes have no closer one.
async function branchNameRefusal(sources: PlanSources, name: string): Promise<ScmRefusal | null> {
  try {
    const answered = (await sources.read(sources.cwd, ['check-ref-format', '--branch', name])).trim();
    return answered === name ? null : refusal('git_failed', `${JSON.stringify(name)} is not a branch name (git reads it as ${JSON.stringify(answered)})`);
  } catch (error) {
    if (error instanceof GitCommandError) return refusal('git_failed', error.message, joinStreams(error));
    throw error;
  }
}

function notPushed(status: GitStatus, upstream: UpstreamFacts, branch: string): ScmRefusal | null {
  if (status.upstream === null || upstream.remote === null) return refusal('not_pushed', `${branch} is not pushed yet; push it first`);
  if (!isOwnUpstream(status, upstream, branch, upstream.remote)) {
    return refusal('not_pushed', `${branch} tracks ${status.upstream}; push it to a branch of its own name first`);
  }
  if (status.behind > 0) return refusal('not_pushed', `${branch} is ${commits(status.behind)} behind ${status.upstream}; pull in a terminal first`);
  if (status.ahead > 0) return refusal('not_pushed', `${branch} has ${commits(status.ahead)} not pushed; push first`);
  return null;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

const commits = (n: number) => `${n} commit${n === 1 ? '' : 's'}`;
const joinStreams = ({ stdout, stderr }: { stdout: string; stderr: string }) =>
  [stdout, stderr].filter((part) => part !== '').map((part) => part.replace(/\n$/, '')).join('\n');
