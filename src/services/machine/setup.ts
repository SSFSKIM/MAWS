// A remote setup's guarded handlers (P5 O7 M9, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Remote
// setup"; the task review's findings 2 and 3): the registration and the trust read another machine's owner asks, run on
// exactly the directory the endpoint's setup policy resolved and checked (src/endpoint/policy.ts), never the input as the
// device spelled it.
//
// - The registration is `session.projects.addFolder` claimed under `machine.op` (`HandlerContext.op`), its input the
//   checked directory, the sealed action keeping what was signed. A local client's own (no claim) runs as before.
// - The trust read is `machine.setupTrust` (`internal`), the endpoint's call for a remote `session.trust.check`.
//
// Each first checks the directory again, here, before any git call or read: it is still its own real path (a folder
// swapped for a link since the endpoint's check is refused), and every pointer git or the trust read follows from it
// touches no protected folder but the ones the directory itself is in (which the endpoint held to the member's opens) and
// the ones this machine's folder list read with `open: true` (`SetupOpens`, src/services/machine/folders.ts). The
// endpoint's per-member record is the authorization; this one only keeps a change made between its check and the run
// from reading anywhere nobody opened. The trust read's files are guarded again at each read.
import { homedir } from 'node:os';
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName } from '@shared/ipc/schema';
import { walk, within, type Home, type HomeRefusal } from '@shared/machine/home-folders';
import { readable, setupReadsRefusal } from '@shared/machine/setup-reads';
import type { TrustState } from '@shared/sessions/trust';
import type { ServiceHandler } from '@shared/spine/bus';

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

/** A remote registration: the checked directory, checked again, then `register` (the index's `addFolder`) on it. */
export async function setupAddFolder<T>(directory: string, guard: SetupGuard, register: (directory: string) => T): Promise<T> {
  await checkSetupDirectory(directory, guard, { trustFiles: false });
  return register(directory);
}

/** Registers `machine.setupTrust`: the checked directory, checked again, then the trust read with each file guarded. */
export function registerSetupTrust(
  register: <N extends CommandName>(name: N, handler: ServiceHandler<N>) => void,
  sessions: { trustCheck(directory: string, guard?: (path: string) => Promise<boolean>): Promise<TrustState> },
  guard: SetupGuard,
): void {
  register('machine.setupTrust', async ({ directory }) => {
    await checkSetupDirectory(directory, guard, { trustFiles: true });
    return sessions.trustCheck(directory, (path) => readable(path, guard.where, openedFor(directory, guard.opens)));
  });
}
