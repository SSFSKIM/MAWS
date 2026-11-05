// A remote setup's guarded handlers (P5 O7 M9, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Remote
// setup"; the task review's findings 2 and 3): the registration and the trust read another machine's owner asks, run on
// exactly the directory the endpoint's setup policy resolved and checked (src/endpoint/policy.ts), never the input as the
// device spelled it.
//
// - The registration is `session.projects.addFolder` claimed under `machine.op` (`HandlerContext.op`), its input the
//   checked directory, the sealed action keeping what was signed. A local client's own (no claim) runs as before.
// - The trust read is `machine.setupTrust` (`internal`), the endpoint's call for a remote `session.trust.check`.
//
// Neither runs git (round 2): until the folder's trust is accepted, what they need of git (the trust key's repository,
// the project fold's main worktree) is read from git's files directly, each through the walk, nothing a config names
// followed (src/shared/machine/git-reads.ts). Each first checks the directory again, here, before any read: it is
// still its own real path (a folder swapped for a link since the endpoint's check is refused), and every pointer git or
// the trust read follows from it touches no protected folder but the ones the directory itself is in (which the endpoint
// held to the member's opens) and the ones the asking member opened (`opened`, the endpoint's per-member record, sent
// with the call; M9's review: another member's opens are never this one's). The endpoint's record is the authorization;
// this check keeps a change made between its check and the run from reading anywhere that member didn't open. The trust
// read's files, its store, and each of git's files are guarded again at each read.
import { homedir } from 'node:os';
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName } from '@shared/ipc/schema';
import { discoverRepo, guardedFiles, SetupReadRefused, type GitFiles } from '@shared/machine/git-reads';
import { walk, within, type Home, type HomeRefusal } from '@shared/machine/home-folders';
import { readable, setupReadsRefusal } from '@shared/machine/setup-reads';
import type { TrustState } from '@shared/sessions/trust';
import type { ServiceHandler } from '@shared/spine/bus';
import { warmLinkedWorktreeRead } from '../index/projects';
import type { RepoDirs, TrustDeps } from '../sessions/trust';

/** This process's home, for a registration with no guard given. */
export const thisGuard = (): SetupGuard => ({ where: { home: homedir(), platform: process.platform } });

const WORDS: Record<HomeRefusal | 'changed', string> = {
  'no-folder': 'there is no folder there',
  'outside-home': "it isn't under this machine's home folder",
  'symlink-escape': "it goes through a link out of this machine's home folder",
  protected: 'it reads in a folder macOS protects that was not opened',
  changed: 'the folder changed since it was checked',
};
const refuse = (reason: HomeRefusal | 'changed', path: string) => new HostCommandError(ipcError('invalid_input', `${reason === 'changed' ? 'no-folder' : reason}: ${path}: ${WORDS[reason]}`));

/** Where a remote setup is checked again: the machine's home. */
export type SetupGuard = { where: Home };

/**
 * The protected folders a run may read in: the ones the checked directory is, or lies in, and the ones the asking member
 * opened (`opened`, the endpoint's record of their listings with `open: true`, real paths, sent with the call): a folder
 * that is, or holds, one of those. Another member's opens are never this member's (the review of M9).
 */
const openedFor = (directory: string, opened: readonly string[]) => (folder: string) => within(directory, folder) || opened.some((listed) => within(listed, folder));

/** The checked directory, checked again before anything reads in it or past it, by the asking member's opens; throws the refusal. */
export async function checkSetupDirectory(directory: string, asking: readonly string[], { where }: SetupGuard, options: { trustFiles: boolean }): Promise<void> {
  const opened = openedFor(directory, asking);
  const resolved = await walk(directory, where, { opened });
  if (!resolved.ok) throw refuse(resolved.reason, directory);
  if (resolved.real !== directory) throw refuse('changed', directory);
  const reads = await setupReadsRefusal(directory, where, opened, options);
  if (reads !== null) throw refuse(reads, directory);
}

/** git's files as a run on the checked `directory` may read them (round 2: no git runs before trust; git-reads.ts). */
const setupFiles = (directory: string, asking: readonly string[], { where }: SetupGuard): GitFiles => guardedFiles(where, openedFor(directory, asking));

/** A refused read as the handler's refusal; anything else as it is. */
async function refusing<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof SetupReadRefused) throw refuse(error.reason, error.path);
    throw error;
  }
}

/**
 * The repository a folder is in, read from git's files as `git rev-parse` answers it (`trustKeyOf`'s `repoOf`, the same
 * trust key): none outside one; no work tree (a bare repository, a folder inside a git dir) fails as git fails.
 */
export const setupRepoDirs =
  (files: GitFiles): RepoDirs =>
  async (directory) => {
    const repo = await discoverRepo(directory, files);
    if (repo === null) return null;
    if (repo.workTree === null) throw new Error(`no work tree for ${directory}: a bare repository, or a folder inside a git dir`);
    return { toplevel: repo.workTree, commonDir: repo.commonDir, gitDir: repo.gitDir };
  };

/**
 * A remote registration: the checked directory, checked again, its linked-worktree question answered from git's files
 * (no git run in it), then `register` (the index's `addFolder`) on it with the checked reader, which the new project's
 * org derivation reads through.
 */
export async function setupAddFolder<T>(directory: string, asking: readonly string[], guard: SetupGuard, register: (directory: string, files: GitFiles) => T): Promise<T> {
  await checkSetupDirectory(directory, asking, guard, { trustFiles: false });
  const files = setupFiles(directory, asking, guard);
  await refusing(() => warmLinkedWorktreeRead(directory, files));
  return register(directory, files);
}

/**
 * Registers `machine.setupTrust`: the checked directory, checked again, then the trust read with each file guarded and
 * its repository read from git's files (no git run in it).
 */
export function registerSetupTrust(
  register: <N extends CommandName>(name: N, handler: ServiceHandler<N>) => void,
  sessions: { trustCheck(directory: string, guarded?: Pick<TrustDeps, 'guard' | 'repo'>): Promise<TrustState> },
  guard: SetupGuard,
): void {
  register('machine.setupTrust', async ({ directory, opened: asking = [] }) => {
    await checkSetupDirectory(directory, asking, guard, { trustFiles: true });
    const repo = setupRepoDirs(setupFiles(directory, asking, guard));
    return refusing(() => sessions.trustCheck(directory, { guard: (path) => readable(path, guard.where, openedFor(directory, asking)), repo }));
  });
}
