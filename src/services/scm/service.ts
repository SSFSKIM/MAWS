// Main's source control service (E6 execution document, Design §1, §3, §10; parent §3 F, P-12). Every command names a
// session; the checkout is resolved here from main's read model (the session's working folder,
// `workingFolder(record).path`, through the files service's admission: `capture`, UX wave U8c-2), so the renderer
// cannot aim git at a directory the session does not work in; no act runs while that is not the launch folder. Everything
// but `status` runs only in a checkout the engine trusts, read on demand with the captured login-shell environment (the
// file the engine itself reads). A local mutation validates the renderer's paths against a fresh status, runs through
// the mutating runner (hooks on, transport off), answers the status read after, and asks C4's watcher to re-read the
// root so `git.changed` stays the one ordered path to every surface. Mutations of one repository run one at a time,
// keyed by its common git dir (keysOf). Nothing is retried or forced.
//
// The remote half (Design §4, §6): a push or a pull request runs only through a plan (plans.ts) the sheet showed, by its
// one-shot token; the run is refused `busy` before the token is spent, then revalidated against fresh reads, and spawned
// by the remote runner only when nothing moved. The revalidation and the spawn take their turn in the repository's
// chain, so a panel commit already under way lands before the head is compared; the run itself does not hold the
// chain. Runs, plans and PR state belong to the checkout (its worktree's top level). gh is probed once per process (10
// minutes) outside any checkout; PR state is kept 60 s per checkout and branch and dropped when a run of that checkout
// ends.
//
// P5 O3-E M2 (Interfaces §H; D14, D17): a mutation, a push and a pull request are admitted within SCM_ADMIT_MS of their
// call or refused `busy` with nothing run (a push or a pull request then keeps its unspent token); the runs in flight
// are reported (`runs`), so the spine's release or yield waits for them.
import { realpath } from 'node:fs/promises';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
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
import { coversHome } from '@shared/machine/machine-home';
import type { SpineView } from '@shared/spine/view';
import { workingFolder } from '@shared/sessions/working-folder';
import { admittedFolder } from '../files/allowlist';
import { FILES_REFUSAL } from '../files/service';
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
import type { Settling } from '../work';

export const LOCAL_TIMEOUT_MS = 10_000; // add, restore, rm, clean
export const COMMIT_TIMEOUT_MS = 60_000; // hooks run linters
// P5 O3-E M2 (docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, Interfaces §H; D11, D17): one deadline per
// mutation, from its invocation, over everything before its work runs (the checkout's key-resolution queue, the
// resolution, the repository's chain). Past it a mutation answers `busy` and runs nothing, so a mutation main's
// request deadline has already answered for (the daemon shape's `timeout`) never starts afterwards, and the command's
// budget covers the wait rather than accepting it.
export const SCM_ADMIT_MS = 30_000;
// UX wave U8c-2 (docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md, M3 decision 8, §G): a caller's
// check of the folder a request uses, awaited on the folder the request captured before anything reads there; it throws
// to refuse the request (scm's handlers give one to a request from another machine: the home rule, `coversHomeAt`).
export type FolderGuard = (folder: string) => Promise<void>;
// Every act while the session's working folder is not its launch folder: the existing code for a view that no longer
// matches, since an added code would take a wire major.
export const AWAY_DETAIL = 'The session is working in another folder now, so nothing was changed';
const GH_PROBE_KEPT_MS = 10 * 60_000;
const PR_STATE_KEPT_MS = 60_000;
const GH_PROBE_CWD = '/'; // the probe reads no repository, so it runs in none

export interface ScmServiceDeps {
  view: Pick<SpineView, 'record'>; // the spine's view (P5 O3-C reader R15): a session's checkout, from its record
  read: GitRun; // createGitRunner(): trust's key, remotes, the new commit
  status(directory: string): Promise<GitStatus>; // C4's GitService.status: the fresh status a mutation validates against and answers
  mutate: MutateRun;
  refresh(directory: string): void; // GitService.refresh: the watcher re-reads the root after a mutation
  captured: () => Promise<Record<string, string>>; // the login-shell capture (the roots' engineEnv): the trust reader's env and both runners' base
  env: NodeJS.ProcessEnv; // MAWS_GIT, MAWS_GH only
  emit(event: ScmRemoteOutput): void;
  spawn?: SpawnFn; // the remote runner's and gh reads' seam for tests
  admitMs?: number; // SCM_ADMIT_MS unless a test shortens it
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

/** The folder a request works in and whether its session is away from its launch folder, from its one read of the record. */
interface Captured {
  checkout: string;
  moved: boolean;
}

// A checkout's two keys (keysOf).
interface Keys {
  checkout: string; // its worktree's top level: one run, its plans and its PR state
  repository: string; // its common git dir: one mutation chain
}

export class ScmService {
  private readonly chains = new Map<string, Promise<unknown>>(); // repository key
  private readonly admissions = new Map<string, Promise<unknown>>(); // working folder as its record names it: its last admission (admitted)
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
  async status(appSessionId: AppSessionId, { refresh = false }: { refresh?: boolean } = {}, guard?: FolderGuard): Promise<ScmStatus> {
    const { checkout } = await this.capture(appSessionId, guard);
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

  async stage({ appSessionId, paths }: ScmPathsInput, guard?: FolderGuard): Promise<ScmMutation> {
    return this.mutation(appSessionId, guard, (status) => {
      const targets = stageTargets(status, paths);
      return isRefusal(targets) ? targets : { commands: [['add', '--', ...targets.paths.map(literal)]], timeoutMs: LOCAL_TIMEOUT_MS };
    });
  }

  // Without a commit yet `restore` cannot resolve HEAD; `rm --cached` takes the entry out of the index instead. Its `-f`
  // only lifts the check that the index matches the file or HEAD (an added file edited since, `AM`, fails it): with
  // `--cached` the working tree is never touched, so this unstages exactly as `restore --staged` would.
  async unstage({ appSessionId, paths }: ScmPathsInput, guard?: FolderGuard): Promise<ScmMutation> {
    return this.mutation(appSessionId, guard, (status) => {
      const targets = unstageTargets(status, paths);
      if (isRefusal(targets)) return targets;
      const verb = status.head === '' ? ['rm', '--cached', '-r', '-f'] : ['restore', '--staged'];
      return { commands: [[...verb, '--', ...targets.paths.map(literal)]], timeoutMs: LOCAL_TIMEOUT_MS };
    });
  }

  // Unstaged entries take the index's content; untracked ones are deleted (`-d` for a directory entry; never `-x`, so
  // ignored files are never touched). Both run in one chained operation, the restore first.
  async discard({ appSessionId, entries }: ScmDiscardInput, guard?: FolderGuard): Promise<ScmMutation> {
    return this.mutation(appSessionId, guard, (status) => {
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
  async commit({ appSessionId, message, noVerify }: ScmCommitInput, guard?: FolderGuard): Promise<ScmMutation> {
    if (message.includes('\0')) throw new Error('a commit message cannot hold a NUL character');
    return this.mutation(
      appSessionId,
      guard,
      (status) => commitRefusal(status, message) ?? { commands: [['commit', '-m', message, ...(noVerify ? ['--no-verify'] : [])]], timeoutMs: COMMIT_TIMEOUT_MS },
      async (checkout) => {
        // One read gives the sha and subject of the same commit, still inside the checkout's chain.
        const [sha, subject = ''] = (await this.deps.read(checkout, ['log', '-1', '--format=%H%x00%s'])).replace(/\n$/, '').split('\0');
        return { commit: { sha, subject } };
      },
    );
  }

  async planPush({ appSessionId, remote }: ScmPushPlanInput, guard?: FolderGuard): Promise<ScmPlanResult> {
    const { checkout, moved } = await this.capture(appSessionId, guard);
    if (moved) return away();
    const draft = await planPush(await this.sources(checkout), { remote });
    return isRefusal(draft) ? draft : this.plans.issue(draft, { appSessionId, key: (await this.keysOf(checkout)).checkout });
  }

  async planPr({ appSessionId, ...fields }: ScmPrPlanInput, guard?: FolderGuard): Promise<ScmPlanResult> {
    const { checkout, moved } = await this.capture(appSessionId, guard);
    if (moved) return away();
    const draft = await planPr(await this.sources(checkout), fields);
    return isRefusal(draft) ? draft : this.plans.issue(draft, { appSessionId, key: (await this.keysOf(checkout)).checkout });
  }

  // `scm.push` and `scm.pr.create`: busy is decided before the token is spent (the sheet keeps it for after the run in
  // flight), once the checkout's key is known and again at admission; then the token, the revalidation in the
  // repository's turn, and the spawn only when nothing moved. Refused `busy` from the queue (P5 O3-E, SCM_ADMIT_MS), the
  // token is unspent and the sheet's Retry runs it.
  async run({ appSessionId, token }: ScmRunInput, kind: 'push' | 'pr', guard?: FolderGuard): Promise<ScmRunStarted> {
    const running = ({ checkout: key }: Keys) => (this.runner.isRunning(key) ? refusal('busy', BUSY_DETAIL) : null);
    // moved: refused `changed` before the token is spent
    return this.admitted(appSessionId, guard, async (checkout, keys): Promise<ScmRunStarted> => {
      const busy = running(keys);
      if (busy !== null) return busy;
      const issued = this.plans.consume(token, { appSessionId, key: keys.checkout, kind });
      if (isRefusal(issued)) return issued;
      const moved = await revalidatePlan(await this.sources(checkout), issued);
      if (moved !== null) return moved;
      return this.runner.start({ appSessionId, key: keys.checkout, plan: issued.plan, captured: await this.deps.captured() });
    }, running);
  }

  // The push and pull request runs in flight (P5 O3-E, D14): they outlive their command's answer, so the spine's
  // release or yield waits for them, bounded by the runner's own timeout.
  get runs(): Settling {
    return this.runner.inFlight;
  }

  // Cancel and the latest run start nothing of the owner's, so they are not behind the trust gate: a run started before
  // trust was withdrawn can still be watched and stopped.
  async cancel({ appSessionId, token }: ScmRunInput, guard?: FolderGuard): Promise<void> {
    const { checkout } = await this.capture(appSessionId, guard);
    this.runner.cancel((await this.keysOf(checkout)).checkout, token);
  }

  async last(appSessionId: AppSessionId, guard?: FolderGuard): Promise<ScmRemoteLast> {
    const { checkout } = await this.capture(appSessionId, guard);
    return this.runner.last((await this.keysOf(checkout)).checkout);
  }

  // The current branch's PR and its checks. Without an answer to ask for (untrusted, not a repository, detached, no
  // remote, gh missing or signed out) `pr` is null and `error` names the refusal; a failure to ask is gh's reason. An
  // answer is kept 60 s per checkout and branch, a failure is not, nor one a run of the checkout ended under; `refresh`
  // asks gh again and probes gh itself again.
  async prState({ appSessionId, refresh }: ScmPrStateInput, guard?: FolderGuard): Promise<ScmPrState> {
    const { checkout } = await this.capture(appSessionId, guard);
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

    const key = (await this.keysOf(checkout)).checkout;
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
    this.admissions.clear();
  }

  /**
   * 2026-11-06 (the home-root rule, src/shared/machine/machine-home.ts): whether a checkout is a home of the machine
   * (`homes`) or above one, by its realpath, by git's top level there, or by its repository's trust key (the main
   * worktree's root), a checkout another machine's caller reaches nothing of. A checkout that doesn't resolve, or whose
   * top level git doesn't answer, is one too: nothing of it is known to lie below a home. UX wave U8c-2: judged on the
   * folder a request captured (`checkout` here), which the handlers' guard hands it, so the check and the request read
   * one folder.
   */
  async coversHomeAt(checkout: string, homes: readonly string[]): Promise<boolean> {
    const real = await realpath(checkout).catch(() => null);
    if (real === null || coversHome(real, homes)) return true;
    // the final review: git's own top level there, the work tree every command acts on (a home that is a linked worktree
    // of a repository kept elsewhere, a `core.worktree`), as well as the trust key; a git answer that isn't one is no
    let top: string | null;
    try {
      top = (await this.deps.read(checkout, ['rev-parse', '--path-format=absolute', '--show-toplevel'])).trim() || null;
    } catch (error) {
      if (!(error instanceof NotARepositoryError)) return true;
      top = null;
    }
    if (top !== null && coversHome((await realpath(top).catch(() => null)) ?? top, homes)) return true;
    const key = await this.trust(checkout);
    return key.keyKind === 'repo' && coversHome(key.trustKey, homes);
  }

  // UX wave U8c-2 (M3 decision 8): the one read of the record a request makes, serving the whole of it. The folder is the
  // session's working folder as the admission takes it (the record's own folder as it names it; a folder one of its facts
  // names, as the realpath the admission checked; one not admitted fails the request with the files service's refusal);
  // the caller's guard is awaited on that folder before anything reads there; `moved` says whether it is the launch
  // folder, from the same record, so an act's check and its folder cannot come from two reads.
  private async capture(appSessionId: AppSessionId, guard?: FolderGuard): Promise<Captured> {
    return this.captureOf(this.recordOf(appSessionId), guard);
  }

  // The record a request reads once; an act takes it at its call (`admitted`), a read inside `capture`.
  private recordOf(appSessionId: AppSessionId): SessionRecord {
    const record = this.deps.view.record(appSessionId);
    if (record === null) throw new Error(`unknown app session: ${appSessionId}`);
    return record;
  }

  private async captureOf(record: SessionRecord, guard?: FolderGuard): Promise<Captured> {
    const admitted = await admittedFolder(record, 'path');
    if (admitted === null) throw new Error(FILES_REFUSAL);
    await guard?.(admitted.folder);
    return { checkout: admitted.folder, moved: workingFolder(record).moved };
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
    guard: FolderGuard | undefined,
    decide: (status: GitStatus) => Decided | ScmRefusal,
    facts: (checkout: string) => Promise<{ commit?: { sha: string; subject: string } }> = async () => ({}),
  ): Promise<ScmMutation> {
    return this.admitted(appSessionId, guard, async (checkout): Promise<ScmMutation> => {
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
    });
  }

  // An act's way to its work (P5 O3-E, Interfaces §H): its place in the queue of the folder its record names, taken at the
  // call (the branch review of U8c-2, finding 5: before anything is awaited, so acts on one folder keep the order they
  // were asked in however long each one's admission takes); in that place, the request's capture of its folder (UX wave
  // U8c-2: the admission's reads and the caller's guard; a moved session refused `changed`) and its keys; then its turn
  // in the repository's chain (serial), all within SCM_ADMIT_MS of the call; `before` may refuse once the keys are
  // known, ahead of the chain. A refused or failed capture gives the place up having run nothing. Past the deadline with
  // its work not started, it answers `busy` and runs nothing: a capture ending later starts nothing, and its place in
  // each queue becomes a no-op that lets the queue's tail run on in order. A capture or key resolution that fails before
  // the deadline fails the call, as it did.
  private admitted<T>(
    appSessionId: AppSessionId,
    guard: FolderGuard | undefined,
    work: (checkout: string, keys: Keys) => Promise<T>,
    before: (keys: Keys) => T | null = () => null,
  ): Promise<T | ScmRefusal> {
    let record: SessionRecord;
    try {
      record = this.recordOf(appSessionId);
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise<T | ScmRefusal>((resolve, reject) => {
      let state: 'waiting' | 'started' | 'expired' = 'waiting';
      const deadline = setTimeout(() => {
        if (state !== 'waiting') return;
        state = 'expired';
        resolve(refusal('busy', BUSY_DETAIL));
      }, this.deps.admitMs ?? SCM_ADMIT_MS);
      const end = () => {
        state = 'started';
        clearTimeout(deadline);
      };
      const fail = (error: unknown) => {
        if (state !== 'waiting') return;
        end();
        reject(error);
      };
      const admission = async (): Promise<{ checkout: string; keys: Keys } | null> => {
        if (state !== 'waiting') return null;
        const { checkout, moved } = await this.captureOf(record, guard);
        if (state !== 'waiting') return null;
        if (moved) {
          end();
          resolve(away());
          return null;
        }
        return { checkout, keys: await this.keysOf(checkout) };
      };
      queue(this.admissions, workingFolder(record).path, admission).then((admitted) => {
        if (admitted === null || state !== 'waiting') return;
        const { checkout, keys } = admitted;
        const refused = before(keys);
        if (refused !== null) {
          end();
          return resolve(refused);
        }
        return this.serial(keys.repository, async () => {
          if (state !== 'waiting') return;
          end();
          try {
            resolve(await work(checkout, keys));
          } catch (error) {
            reject(error);
          }
        });
      }, fail);
    });
  }

  // The checkout's keys, resolved in call order (`admitted` keeps the order): each call reaches its chain in the order
  // the owner asked for it, since a call reaches `serial` without awaiting once its keys resolved. P4 W2-B
  // (tracker 2026-10-06 "The mutation chain and admission queue are keyed by the checkout's realpath…"): the order is
  // kept per checkout as the session's record names it, each in a queue of its own, so one whose resolution hangs (a
  // stalled mount) holds up only its own calls; calls naming two directories of one repository are not ordered between
  // them.
  // One promise chain per repository: work starts after every earlier work of the repository settled.
  private serial<T>(repository: string, work: () => Promise<T>): Promise<T> {
    return queue(this.chains, repository, work);
  }

  // A checkout's keys from one read bounded by the read runner's timeout (a read that times out rejects, for the router
  // to answer). `--path-format=absolute` answers canonical paths, so `/tmp` and `/private/tmp` share keys and no
  // realpath runs on main. The repository key is the common git dir, which every worktree of a repository shares: a
  // session at the root and one in a subdirectory write one index, so their mutations take turns; linked worktrees
  // have an index each but share refs, packed-refs and the objects, and take turns too (the safe reading: one
  // worktree's slow commit hook delays another's mutations). The checkout key is the worktree's top level: a linked
  // worktree has its own branch, so its own run, plans and PR state. Where git cannot answer (outside any repository, a
  // directory gone, a repository of another owner) both keys are the directory as given; trust and status fail there
  // too, so nothing mutates or runs under them.
  private async keysOf(checkout: string): Promise<Keys> {
    try {
      const [top, common] = (await this.deps.read(checkout, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])).split('\n');
      return { checkout: top, repository: common };
    } catch (error) {
      if (error instanceof NotARepositoryError || error instanceof GitCommandError) return { checkout, repository: checkout };
      throw error;
    }
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

// An act while the session is away from its launch folder (UX wave U8c-2): nothing is run.
const away = (): ScmRefusal => refusal('changed', AWAY_DETAIL);

// One promise chain per key of `chains`: work starts after every earlier work of the key settled, whichever way it
// settled; the key is dropped once its last work settled.
function queue<T>(chains: Map<string, Promise<unknown>>, key: string, work: () => Promise<T>): Promise<T> {
  const result = (chains.get(key) ?? Promise.resolve()).then(work); // a kept tail never rejects
  const tail = result.then(() => {}, () => {});
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return result;
}

// A repository-relative path, taken literally (no globbing) from the top level, as the read service passes it.
function literal(path: string): string {
  return `:(top,literal)${path}`;
}

// What git printed, in order, without empty parts or their trailing newlines.
function joinOutput(parts: string[]): string {
  return parts.filter((part) => part !== '').map((part) => part.replace(/\n$/, '')).join('\n');
}
