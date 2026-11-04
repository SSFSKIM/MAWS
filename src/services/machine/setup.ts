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
// held to the member's opens) and the ones this machine's folder list read with `open: true` (`SetupOpens`,
// src/services/machine/folders.ts). The endpoint's per-member record is the authorization; this one only keeps a change
// made between its check and the run from reading anywhere nobody opened. The trust read's files, and each of git's, are
// guarded again at each read.
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
export const thisGuard = (): SetupGuard => ({ where: { home: homedir(), platform: process.platform }, opens: new SetupOpens() });

const WORDS: Record<HomeRefusal | 'changed', string> = {
  'no-folder': 'there is no folder there',
  'outside-home': "it isn't under this machine's home folder",
  'symlink-escape': "it goes through a link out of this machine's home folder",
  protected: 'it reads in a folder macOS protects that was not opened',
  changed: 'the folder changed since it was checked',
};
const refuse = (reason: HomeRefusal | 'changed', path: string) => new HostCommandError(ipcError('invalid_input', `${reason === 'changed' ? 'no-folder' : reason}: ${path}: ${WORDS[reason]}`));

/** The latest protected folders this machine's folder list read inside with `open: true`. */
export const SETUP_OPENS_MAX = 64;

/** The protected folders (real paths) this machine's folder list read inside with `open: true`, the latest SETUP_OPENS_MAX. */
export class SetupOpens {
  #folders: string[] = [];

  open(folder: string): void {
    this.#folders = [...this.#folders.filter((held) => held !== folder), folder].slice(-SETUP_OPENS_MAX);
  }

  /** Whether `folder` is, or holds, one the list opened. */
  opened(folder: string): boolean {
    return this.#folders.some((held) => within(held, folder));
  }
}

/** Where a remote setup is checked again: the machine's home, and what its folder list opened. */
export type SetupGuard = { where: Home; opens: SetupOpens };

/** The protected folders a run may read in: the ones the checked directory is, or lies in, and the ones the list opened. */
const openedFor = (directory: string, opens: SetupOpens) => (folder: string) => within(directory, folder) || opens.opened(folder);

/** The checked directory, checked again before anything reads in it or past it; throws the refusal. */
export async function checkSetupDirectory(directory: string, { where, opens }: SetupGuard, options: { trustFiles: boolean }): Promise<void> {
  const opened = openedFor(directory, opens);
  const resolved = await walk(directory, where, { opened });
  if (!resolved.ok) throw refuse(resolved.reason, directory);
  if (resolved.real !== directory) throw refuse('changed', directory);
  const reads = await setupReadsRefusal(directory, where, opened, options);
  if (reads !== null) throw refuse(reads, directory);
}

/** git's files as a run on the checked `directory` may read them (round 2: no git runs before trust; git-reads.ts). */
const setupFiles = (directory: string, { where, opens }: SetupGuard): GitFiles => guardedFiles(where, openedFor(directory, opens));

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
export async function setupAddFolder<T>(directory: string, guard: SetupGuard, register: (directory: string, files: GitFiles) => T): Promise<T> {
  await checkSetupDirectory(directory, guard, { trustFiles: false });
  const files = setupFiles(directory, guard);
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
  register('machine.setupTrust', async ({ directory }) => {
    await checkSetupDirectory(directory, guard, { trustFiles: true });
    const repo = setupRepoDirs(setupFiles(directory, guard));
    return refusing(() => sessions.trustCheck(directory, { guard: (path) => readable(path, guard.where, openedFor(directory, guard.opens)), repo }));
  });
}
