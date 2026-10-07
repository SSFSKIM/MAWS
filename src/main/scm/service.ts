// Main's source control service (E6 execution document, Design §1, §3, §10; parent §3 F, P-12). Every command names a
// session; the checkout is resolved here from main's read model (`worktree.path ?? directory`), so the renderer cannot
// aim git at a directory the session does not work in. Everything but `status` runs only in a checkout the engine
// trusts, read on demand with the captured login-shell environment (the file the engine itself reads). A local mutation
// validates the renderer's paths against a fresh status, runs through the mutating runner (hooks on, transport off),
// answers the status read after, and asks C4's watcher to re-read the root so `git.changed` stays the one ordered path
// to every surface. Mutations of one checkout run one at a time, keyed by its realpath. Nothing is retried or forced.
//
// The remote half (Design §4, §6): a push or a pull request runs only through a plan (plans.ts) the sheet showed, by its
// one-shot token; the run is refused `busy` before the token is spent, then revalidated against fresh reads, and spawned
// by the remote runner only when nothing moved. The revalidation and the spawn take their turn in the checkout's chain,
// so a panel commit already under way lands before the head is compared; the run itself does not hold the chain. gh is
// probed once per process (10 minutes) outside any checkout; PR state is kept 60 s per checkout and branch and dropped
// when a run of that checkout ends.
import { realpath } from 'node:fs/promises';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import type {
  ScmCommitInput,
  ScmDiscardInput,
  ScmGhState,
  ScmMutation,
  ScmPathsInput,
  ScmPlanResult,
  ScmPrPlanInput,
  ScmPrState,
  ScmPrStateInput,
  ScmPushPlanInput,
  ScmRefusal,
  ScmRemoteLast,
  ScmRemoteOutput,
  ScmRunInput,
  ScmRunStarted,
  ScmStatus,
} from '@shared/ipc/schema/scm';
import type { SessionRecord } from '@shared/graph/session';
import type { MutateRun } from '../git/mutate';
import { GitCommandError, NotARepositoryError, type GitRun } from '../git/runner';
import { withoutUserInfo } from '../git/service';
import { trustedKeyOf, type TrustedKey } from '../sessions/trust';
import { PlanTable, planPr, planPush, revalidatePlan, type PlanSources } from './plans';
import { GH_READ_TIMEOUT_MS, prChecksArgv, prViewArgv, readChecks, readGhProbe, readPrView } from './pr-state';
import { childEnvironment } from './remote-env';
import { BUSY_DETAIL, pushGitRead, RemoteRunner, runCollected, type KillFn, type SpawnFn } from './remote-runner';
import { commitRefusal, discardTargets, isRefusal, refusal, stageTargets, UNTRUSTED_DETAIL, unstageTargets } from './validate';
import { ghProgram, gitProgram } from './which';

const LOCAL_TIMEOUT_MS = 10_000; // add, restore, rm, clean
const COMMIT_TIMEOUT_MS = 60_000; // hooks run linters
const GH_PROBE_KEPT_MS = 10 * 60_000;
const PR_STATE_KEPT_MS = 60_000;
const GH_PROBE_CWD = '/'; // the probe reads no repository, so it runs in none

export interface ScmServiceDeps {
  records(appSessionId: AppSessionId): Pick<SessionRecord, 'directory' | 'worktree'> | null; // sessions.model.record
  read: GitRun; // createGitRunner(): trust's key, remotes, the new commit
  status(directory: string): Promise<GitStatus>; // C4's GitService.status: the fresh status a mutation validates against and answers
  mutate: MutateRun;
  refresh(directory: string): void; // GitService.refresh: the watcher re-reads the root after a mutation
  captured: () => Promise<Record<string, string>>; // the login-shell capture (index.ts's engineEnv): the trust reader's env and both runners' base
  env: NodeJS.ProcessEnv; // MAWS_GIT, MAWS_GH only
  emit(event: ScmRemoteOutput): void;
  spawn?: SpawnFn; // the remote runner's and gh reads' seam for tests
  kill?: KillFn; // with `spawn`: a fake child's pid is no process group to signal
  pushRead?: typeof pushGitRead; // the plans' destination reads (the push's git under the remote environment); tests
  now?: () => number;
}

// One operation's git commands, decided from the fresh status before any of them runs.
interface Decided {
  commands: string[][];
  timeoutMs: number;
}

interface Kept<T> {
  at: number;
  value: T;
}

export class ScmService {
  private readonly chains = new Map<string, Promise<unknown>>();
  private admission: Promise<unknown> = Promise.resolve(); // the last key resolved for a chain (admit)
  private readonly now: () => number;
  private readonly plans: PlanTable;
  private readonly runner: RemoteRunner;
  private ghProbe: Kept<Promise<ScmGhState>> | null = null;
  private readonly prStates = new Map<string, Map<string, Kept<ScmPrState>>>(); // checkout key, then branch
  private readonly runsEnded = new Map<string, number>(); // checkout key: how many of its runs ended (a read keeps its answer only if none did meanwhile)

  constructor(private readonly deps: ScmServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.plans = new PlanTable(this.now);
    this.runner = new RemoteRunner({ emit: deps.emit, spawn: deps.spawn, kill: deps.kill, now: this.now, onExit: (key) => this.runEnded(key) });
  }

  // Trust, the remotes, the defaults a push or PR would start from and gh's state; answered for any checkout, trusted or
  // not (gh is probed outside it). `refresh` probes gh again.
  async status(appSessionId: AppSessionId, { refresh = false }: { refresh?: boolean } = {}): Promise<ScmStatus> {
    const checkout = this.checkout(appSessionId);
    const [trust, gh] = await Promise.all([this.trust(checkout), this.gh(refresh)]);
    const repository = trust.keyKind === 'repo';
    const remotes = repository ? await this.remotes(trust.directory, await this.pushReader()) : [];
    const defaultRemote = remotes.length > 0 ? await this.defaultRemote(trust.directory, remotes.map((r) => r.name)) : null;
    return {
      directory: trust.directory,
      repository,
      trusted: trust.trusted,
      trustKey: trust.trustKey,
      remotes,
      defaultRemote,
      defaultBase: defaultRemote === null ? null : await this.defaultBase(trust.directory, defaultRemote),
      gh,
      checkedAt: new Date(this.now()).toISOString(),
    };
  }

  stage({ appSessionId, paths }: ScmPathsInput): Promise<ScmMutation> {
    return this.mutation(appSessionId, (status) => {
      const targets = stageTargets(status, paths);
      return isRefusal(targets) ? targets : { commands: [['add', '--', ...targets.paths.map(literal)]], timeoutMs: LOCAL_TIMEOUT_MS };
    });
  }

  // Without a commit yet `restore` cannot resolve HEAD; `rm --cached` takes the entry out of the index instead. Its `-f`
  // only lifts the check that the index matches the file or HEAD (an added file edited since, `AM`, fails it): with
  // `--cached` the working tree is never touched, so this unstages exactly as `restore --staged` would.
  unstage({ appSessionId, paths }: ScmPathsInput): Promise<ScmMutation> {
    return this.mutation(appSessionId, (status) => {
      const targets = unstageTargets(status, paths);
      if (isRefusal(targets)) return targets;
      const verb = status.head === '' ? ['rm', '--cached', '-r', '-f'] : ['restore', '--staged'];
      return { commands: [[...verb, '--', ...targets.paths.map(literal)]], timeoutMs: LOCAL_TIMEOUT_MS };
    });
  }

  // Unstaged entries take the index's content; untracked ones are deleted (`-d` for a directory entry; never `-x`, so
  // ignored files are never touched). Both run in one chained operation, the restore first.
  discard({ appSessionId, entries }: ScmDiscardInput): Promise<ScmMutation> {
    return this.mutation(appSessionId, (status) => {
      const targets = discardTargets(status, entries);
      if (isRefusal(targets)) return targets;
      const commands: string[][] = [];
      if (targets.restore.length > 0) commands.push(['restore', '--worktree', '--', ...targets.restore.map(literal)]);
      if (targets.clean.length > 0) {
        const directories = targets.clean.some((path) => path.endsWith('/'));
        commands.push(['clean', '-f', ...(directories ? ['-d'] : []), '--', ...targets.clean.map(literal)]);
      }
      return { commands, timeoutMs: LOCAL_TIMEOUT_MS };
    });
  }

  // The message is one argument after `-m` (a leading dash is its value, a multi-line message stays whole); the
  // repository's hooks run unless the owner asked to skip them for this commit.
  async commit({ appSessionId, message, noVerify }: ScmCommitInput): Promise<ScmMutation> {
    if (message.includes('\0')) throw new Error('a commit message cannot hold a NUL character');
    return this.mutation(
      appSessionId,
      (status) => commitRefusal(status, message) ?? { commands: [['commit', '-m', message, ...(noVerify ? ['--no-verify'] : [])]], timeoutMs: COMMIT_TIMEOUT_MS },
      async (checkout) => {
        // One read gives the sha and subject of the same commit, still inside the checkout's chain.
        const [sha, subject = ''] = (await this.deps.read(checkout, ['log', '-1', '--format=%H%x00%s'])).replace(/\n$/, '').split('\0');
        return { commit: { sha, subject } };
      },
    );
  }

  async planPush({ appSessionId, remote }: ScmPushPlanInput): Promise<ScmPlanResult> {
    const checkout = this.checkout(appSessionId);
    const draft = await planPush(await this.sources(checkout), { remote });
    return isRefusal(draft) ? draft : this.plans.issue(draft, { appSessionId, key: await keyOf(checkout) });
  }

  async planPr({ appSessionId, ...fields }: ScmPrPlanInput): Promise<ScmPlanResult> {
    const checkout = this.checkout(appSessionId);
    const draft = await planPr(await this.sources(checkout), fields);
    return isRefusal(draft) ? draft : this.plans.issue(draft, { appSessionId, key: await keyOf(checkout) });
  }

  // `scm.push` and `scm.pr.create`: busy is decided before the token is spent (the sheet keeps it for after the run in
  // flight); then the token, then the revalidation in the checkout's turn, then the spawn only when nothing moved.
  async run({ appSessionId, token }: ScmRunInput, kind: 'push' | 'pr'): Promise<ScmRunStarted> {
    const checkout = this.checkout(appSessionId);
    return this.admit(checkout, async (key): Promise<ScmRunStarted> => {
      if (this.runner.isRunning(key)) return refusal('busy', BUSY_DETAIL);
      const issued = this.plans.consume(token, { appSessionId, key, kind });
      if (isRefusal(issued)) return issued;
      return this.serial(key, async (): Promise<ScmRunStarted> => {
        const moved = await revalidatePlan(await this.sources(checkout), issued);
        if (moved !== null) return moved;
        return this.runner.start({ appSessionId, key, plan: issued.plan, captured: await this.deps.captured() });
      });
    });
  }

  // Cancel and the latest run start nothing of the owner's, so they are not behind the trust gate: a run started before
  // trust was withdrawn can still be watched and stopped.
  async cancel({ appSessionId, token }: ScmRunInput): Promise<void> {
    this.runner.cancel(await keyOf(this.checkout(appSessionId)), token);
  }

  async last(appSessionId: AppSessionId): Promise<ScmRemoteLast> {
    return this.runner.last(await keyOf(this.checkout(appSessionId)));
  }

  // The current branch's PR and its checks. Without an answer to ask for (untrusted, not a repository, detached, no
  // remote, gh missing or signed out) `pr` is null and `error` names the refusal; a failure to ask is gh's reason. An
  // answer is kept 60 s per checkout and branch, a failure is not, nor one a run of the checkout ended under; `refresh`
  // asks gh again and probes gh itself again.
  async prState({ appSessionId, refresh }: ScmPrStateInput): Promise<ScmPrState> {
    const checkout = this.checkout(appSessionId);
    const [trusted, gh] = await Promise.all([this.trust(checkout).then((trust) => trust.trusted), this.gh(refresh)]);
    const answer = (branch: string | null, error: string | null, pr: ScmPrState['pr'] = null): ScmPrState =>
      ({ checkedAt: new Date(this.now()).toISOString(), branch, gh, pr, error });
    if (!trusted) return answer(null, 'untrusted');
    let status: GitStatus;
    try {
      status = await this.deps.status(checkout);
    } catch (error) {
      if (error instanceof NotARepositoryError) return answer(null, 'not_repository');
      throw error;
    }
    const branch = status.branch;
    if (branch === null) return answer(null, 'detached');
    if ((await this.remoteNames(checkout, await this.pushReader())).length === 0) return answer(branch, 'no_remote');
    if (gh.state === 'missing') return answer(branch, 'gh_missing');
    if (gh.state === 'unauthenticated') return answer(branch, 'gh_unauthenticated');
    // git refuses such a name, but a ref written by hand can carry one; gh would read it as an option
    if (branch.startsWith('-')) return answer(branch, `MAWS does not ask gh about a branch named ${JSON.stringify(branch)}`);

    const key = await keyOf(checkout);
    const ended = this.runsEnded.get(key) ?? 0;
    const kept = this.prStates.get(key)?.get(branch);
    if (!refresh && kept !== undefined && this.now() - kept.at < PR_STATE_KEPT_MS) return kept.value;
    const captured = await this.deps.captured();
    const view = readPrView(await this.collect(gh.path, prViewArgv(branch), checkout, captured));
    const pr = view.pr === null ? null : { ...view.pr, checks: readChecks(await this.collect(gh.path, prChecksArgv(branch), checkout, captured)) };
    const value = answer(branch, view.error, pr);
    if (view.error === null && (this.runsEnded.get(key) ?? 0) === ended) {
      const branches = this.prStates.get(key) ?? new Map<string, Kept<ScmPrState>>();
      branches.set(branch, { at: this.now(), value });
      this.prStates.set(key, branches);
    }
    return value;
  }

  // A run of the checkout ended: its PR state moved (a push, a new PR), and a read still out may hold the state before it.
  private runEnded(key: string): void {
    this.prStates.delete(key);
    this.runsEnded.set(key, (this.runsEnded.get(key) ?? 0) + 1);
  }

  // The app is quitting: every remote run is asked to stop; plans, caches and latest runs are dropped.
  dispose(): void {
    this.runner.dispose();
    this.plans.clear();
    this.prStates.clear();
    this.runsEnded.clear();
    this.ghProbe = null;
    this.chains.clear();
  }

  private checkout(appSessionId: AppSessionId): string {
    const record = this.deps.records(appSessionId);
    if (record === null) throw new Error(`unknown app session: ${appSessionId}`);
    return record.worktree?.path ?? record.directory;
  }

  // E11: the key and the store only; the files trust would load are the session's trust card's to read
  private async trust(checkout: string): Promise<TrustedKey> {
    return trustedKeyOf(checkout, { git: this.deps.read, env: await this.deps.captured() });
  }

  // What a plan reads, bound to the checkout: trust and the status read now, git and gh as the remote environment's PATH
  // resolves them, the remote's names and URLs read by that git under that environment (as the push will read them),
  // gh's reads in the checkout under that environment.
  private async sources(checkout: string): Promise<PlanSources> {
    const captured = await this.deps.captured();
    const remoteEnv = childEnvironment(captured, 'remote');
    const git = gitProgram(remoteEnv, this.deps.env);
    const pushReader = git.then((program) => (this.deps.pushRead ?? pushGitRead)(program, captured));
    return {
      cwd: checkout,
      trusted: async () => (await this.trust(checkout)).trusted,
      status: () => this.deps.status(checkout),
      read: this.deps.read,
      pushRead: async (directory, args, options) => (await pushReader)(directory, args, options),
      git: () => git,
      gh: () => this.gh(false),
      runGh: (program, argv) => this.collect(program, argv, checkout, captured),
    };
  }

  // E11 (tracker row E6 "PR-state answer naming another branch not re-asked"): the push's own git under the remote
  // environment, as a plan reads the destination; the remote picker and the PR state's remote check list remotes
  // through it, so a remote only that git sees (a non-default XDG_CONFIG_HOME) is listed where a plan would find it
  private async pushReader(): Promise<GitRun> {
    const captured = await this.deps.captured();
    const program = await gitProgram(childEnvironment(captured, 'remote'), this.deps.env);
    return (this.deps.pushRead ?? pushGitRead)(program, captured);
  }

  private collect(program: string, argv: string[], cwd: string, captured: Record<string, string>) {
    return runCollected({ program, argv, cwd, captured, timeoutMs: GH_READ_TIMEOUT_MS, spawn: this.deps.spawn, kill: this.deps.kill });
  }

  // gh resolved on the captured PATH (`MAWS_GH` first) and probed with `--version` and `auth status --active`;
  // concurrent callers share one probe. Only a `ready` answer is kept (10 minutes per process): a missing or signed-out
  // gh is probed again on the next ask, so an install or `gh auth login` shows at once.
  private gh(refresh: boolean): Promise<ScmGhState> {
    const kept = this.ghProbe;
    if (!refresh && kept !== null && this.now() - kept.at < GH_PROBE_KEPT_MS) return kept.value;
    const value = (async (): Promise<ScmGhState> => {
      const captured = await this.deps.captured();
      const path = await ghProgram(childEnvironment(captured, 'remote'), this.deps.env);
      if (path === null) return { state: 'missing' };
      const [version, auth] = await Promise.all([
        this.collect(path, ['--version'], GH_PROBE_CWD, captured),
        this.collect(path, ['auth', 'status', '--active'], GH_PROBE_CWD, captured),
      ]);
      return readGhProbe(path, version, auth);
    })();
    const probe = { at: this.now(), value };
    this.ghProbe = probe;
    // E11: a probe that failed is dropped as an unready answer is, and its rejection is handled here (the caller's await
    // handles its own)
    const drop = () => {
      if (this.ghProbe === probe) this.ghProbe = null;
    };
    value.then((state) => state.state !== 'ready' && drop(), drop);
    return value;
  }

  // Trust, then the status read before (what the paths are validated against), then the commands, then the status read
  // after (what is answered). Git's own failure is the refusal `git_failed` with both streams; a timeout goes to the
  // router. Once any command ran, the watcher is asked to re-read the root, whatever the outcome.
  private async mutation(
    appSessionId: AppSessionId,
    decide: (status: GitStatus) => Decided | ScmRefusal,
    facts: (checkout: string) => Promise<{ commit?: { sha: string; subject: string } }> = async () => ({}),
  ): Promise<ScmMutation> {
    const checkout = this.checkout(appSessionId);
    return this.admit(checkout, (key) => this.serial(key, async (): Promise<ScmMutation> => {
      if (!(await this.trust(checkout)).trusted) return refusal('untrusted', UNTRUSTED_DETAIL);
      let before: GitStatus;
      try {
        before = await this.deps.status(checkout);
      } catch (error) {
        if (error instanceof NotARepositoryError) return refusal('not_repository', 'Not a git repository');
        throw error;
      }
      const decided = decide(before);
      if (isRefusal(decided)) return decided;
      const outputs: string[] = [];
      try {
        for (const args of decided.commands) {
          const { stdout, stderr } = await this.deps.mutate(checkout, args, { timeoutMs: decided.timeoutMs });
          outputs.push(stdout, stderr);
        }
      } catch (error) {
        if (error instanceof GitCommandError) return refusal('git_failed', error.message, joinOutput([...outputs, error.stdout, error.stderr]));
        throw error;
      } finally {
        this.deps.refresh(checkout);
      }
      const status = await this.deps.status(checkout);
      return { ok: true, status, output: joinOutput(outputs), ...(await facts(checkout)) };
    }));
  }

  // The checkout's key, resolved in call order: `enter` runs for each call in the order the calls were made, so work
  // reaches its chain in the order the owner asked for it, even when a later call's realpath answers first. `enter`
  // must reach `serial` without awaiting.
  private admit<T>(checkout: string, enter: (key: string) => Promise<T>): Promise<T> {
    const key = this.admission.then(() => keyOf(checkout)); // keyOf never rejects
    this.admission = key;
    return key.then(enter);
  }

  // One promise chain per key: work starts after every earlier work of the key settled, whichever way it settled.
  private serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = (this.chains.get(key) ?? Promise.resolve()).then(work); // a kept tail never rejects
    const tail = result.then(() => {}, () => {});
    this.chains.set(key, tail);
    void tail.then(() => {
      if (this.chains.get(key) === tail) this.chains.delete(key);
    });
    return result;
  }

  private async remoteNames(directory: string, read: GitRun): Promise<string[]> {
    return (await read(directory, ['remote'])).split('\n').filter((name) => name !== '');
  }

  // Every remote with its configured fetch URL (without user-info), null when it has none, from one `git remote -v`
  // (E11): a `<name>\t<url> (fetch)` line per remote with a URL (the first of several; a partial clone's carries a
  // ` [<filter>]` suffix), `<name>\t` for one without.
  private async remotes(directory: string, read: GitRun): Promise<ScmStatus['remotes']> {
    const urls = new Map<string, string | null>();
    for (const line of (await read(directory, ['remote', '-v'])).split('\n')) {
      const tab = line.indexOf('\t');
      if (tab <= 0) continue;
      const name = line.slice(0, tab);
      const fetch = /^(.*) \(fetch\)(?: \[[^\]]*\])?$/.exec(line.slice(tab + 1));
      if (!urls.has(name) || (urls.get(name) === null && fetch)) urls.set(name, fetch ? withoutUserInfo(fetch[1]!.trim()) : null);
    }
    return [...urls].map(([name, url]) => ({ name, url }));
  }

  // The current branch's upstream remote, else `origin`, else the sole remote.
  private async defaultRemote(directory: string, names: string[]): Promise<string | null> {
    const current = (await this.deps.read(directory, ['for-each-ref', '--format=%(HEAD)%00%(upstream:remotename)', 'refs/heads']))
      .split('\n')
      .find((line) => line.startsWith('*\0'));
    const upstream = current?.slice(2) ?? '';
    if (names.includes(upstream)) return upstream;
    if (names.includes('origin')) return 'origin';
    return names.length === 1 ? names[0] : null;
  }

  // The remote's HEAD branch (`refs/remotes/<remote>/HEAD`, set by clone or `remote set-head`), when git knows it. The
  // full ref, not `--short`: a local branch named like the remote ref would make the short name ambiguous.
  private async defaultBase(directory: string, remote: string): Promise<string | null> {
    try {
      const ref = (await this.deps.read(directory, ['symbolic-ref', '-q', `refs/remotes/${remote}/HEAD`])).trim();
      const prefix = `refs/remotes/${remote}/`;
      return ref.startsWith(prefix) && ref.length > prefix.length ? ref.slice(prefix.length) : null;
    } catch (error) {
      if (error instanceof GitCommandError) return null;
      throw error;
    }
  }
}

// A checkout's key: its realpath, so `/tmp` and `/private/tmp` share one chain, one run and one cache.
function keyOf(checkout: string): Promise<string> {
  return realpath(checkout).catch(() => checkout);
}

// A repository-relative path, taken literally (no globbing) from the top level, as the read service passes it.
function literal(path: string): string {
  return `:(top,literal)${path}`;
}

// What git printed, in order, without empty parts or their trailing newlines.
function joinOutput(parts: string[]): string {
  return parts.filter((part) => part !== '').map((part) => part.replace(/\n$/, '')).join('\n');
}
