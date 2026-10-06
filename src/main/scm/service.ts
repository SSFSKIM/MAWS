// Main's source control service (E6 execution document, Design §1, §3, §10; parent §3 F, P-12). Every command names a
// session; the checkout is resolved here from main's read model (`worktree.path ?? directory`), so the renderer cannot
// aim git at a directory the session does not work in. Everything but `status` runs only in a checkout the engine
// trusts, read on demand with the captured login-shell environment (the file the engine itself reads). A local mutation
// validates the renderer's paths against a fresh status, runs through the mutating runner (hooks on, transport off),
// answers the status read after, and asks C4's watcher to re-read the root so `git.changed` stays the one ordered path
// to every surface. Mutations of one checkout run one at a time, keyed by its realpath. Nothing is retried or forced.
import { realpath } from 'node:fs/promises';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import type {
  ScmCommitInput,
  ScmDiscardInput,
  ScmMutation,
  ScmPathsInput,
  ScmRefusal,
  ScmRemoteOutput,
  ScmStatus,
} from '@shared/ipc/schema/scm';
import type { SessionRecord } from '@shared/graph/session';
import type { TrustState } from '@shared/sessions/trust';
import type { MutateRun } from '../git/mutate';
import { GitCommandError, NotARepositoryError, type GitRun } from '../git/runner';
import { withoutUserInfo } from '../git/service';
import { trustStateOf } from '../sessions/trust';
import { commitRefusal, discardTargets, isRefusal, refusal, stageTargets, unstageTargets } from './validate';

const LOCAL_TIMEOUT_MS = 10_000; // add, restore, rm, clean
const COMMIT_TIMEOUT_MS = 60_000; // hooks run linters

export const UNTRUSTED_DETAIL = 'MAWS runs git here only after you trust the folder in a session';

export interface ScmServiceDeps {
  records(appSessionId: AppSessionId): Pick<SessionRecord, 'directory' | 'worktree'> | null; // sessions.model.record
  read: GitRun; // createGitRunner(): trust's key, remotes, the new commit
  status(directory: string): Promise<GitStatus>; // C4's GitService.status: the fresh status a mutation validates against and answers
  mutate: MutateRun;
  refresh(directory: string): void; // GitService.refresh: the watcher re-reads the root after a mutation
  captured: () => Promise<Record<string, string>>; // the login-shell capture (index.ts's engineEnv): the trust reader's env and both runners' base
  env: NodeJS.ProcessEnv; // MAWS_GIT, MAWS_GH only
  emit(event: ScmRemoteOutput): void;
  now?: () => number;
}

// One operation's git commands, decided from the fresh status before any of them runs.
interface Decided {
  commands: string[][];
  timeoutMs: number;
}

export class ScmService {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly now: () => number;

  constructor(private readonly deps: ScmServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  // Trust, the remotes and the defaults a push or PR would start from; answered for any checkout, trusted or not.
  async status(appSessionId: AppSessionId): Promise<ScmStatus> {
    const trust = await this.trust(this.checkout(appSessionId));
    const repository = trust.keyKind === 'repo';
    const remotes = repository ? await this.remotes(trust.directory) : [];
    const defaultRemote = remotes.length > 0 ? await this.defaultRemote(trust.directory, remotes.map((r) => r.name)) : null;
    return {
      directory: trust.directory,
      repository,
      trusted: trust.trusted,
      trustKey: trust.trustKey,
      remotes,
      defaultRemote,
      defaultBase: defaultRemote === null ? null : await this.defaultBase(trust.directory, defaultRemote),
      gh: { state: 'missing' }, // M2 probes gh
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

  // Nothing is held across commands in M1; M2's runs, plans and caches are dropped here.
  dispose(): void {
    this.chains.clear();
  }

  private checkout(appSessionId: AppSessionId): string {
    const record = this.deps.records(appSessionId);
    if (record === null) throw new Error(`unknown app session: ${appSessionId}`);
    return record.worktree?.path ?? record.directory;
  }

  private async trust(checkout: string): Promise<TrustState> {
    return trustStateOf(checkout, { git: this.deps.read, env: await this.deps.captured() });
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
    return this.serial(await realpath(checkout).catch(() => checkout), async (): Promise<ScmMutation> => {
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

  // One promise chain per key: work starts after every earlier work of the key settled, whichever way it settled.
  private serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = (this.chains.get(key) ?? Promise.resolve()).then(work, work);
    const tail = result.then(() => {}, () => {});
    this.chains.set(key, tail);
    void tail.then(() => {
      if (this.chains.get(key) === tail) this.chains.delete(key);
    });
    return result;
  }

  // Every remote with its configured fetch URL (as `remote get-url` answers it, without user-info), null when it has none.
  private async remotes(directory: string): Promise<ScmStatus['remotes']> {
    const names = (await this.deps.read(directory, ['remote'])).split('\n').filter((name) => name !== '');
    return Promise.all(names.map(async (name) => {
      try {
        return { name, url: withoutUserInfo((await this.deps.read(directory, ['remote', 'get-url', name])).trim()) };
      } catch (error) {
        if (error instanceof GitCommandError) return { name, url: null };
        throw error;
      }
    }));
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

  // The remote's HEAD branch (`refs/remotes/<remote>/HEAD`, set by clone or `remote set-head`), when git knows it.
  private async defaultBase(directory: string, remote: string): Promise<string | null> {
    try {
      const ref = (await this.deps.read(directory, ['symbolic-ref', '-q', '--short', `refs/remotes/${remote}/HEAD`])).trim();
      return ref.startsWith(`${remote}/`) && ref.length > remote.length + 1 ? ref.slice(remote.length + 1) : null;
    } catch (error) {
      if (error instanceof GitCommandError) return null;
      throw error;
    }
  }
}

// A repository-relative path, taken literally (no globbing) from the top level, as the read service passes it.
function literal(path: string): string {
  return `:(top,literal)${path}`;
}

// What git printed, in order, without empty parts or their trailing newlines.
function joinOutput(parts: string[]): string {
  return parts.filter((part) => part !== '').map((part) => part.replace(/\n$/, '')).join('\n');
}
