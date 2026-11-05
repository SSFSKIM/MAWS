// `machine.folders.list` (P5 O7 M9, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Remote setup", §U): the
// folders under the machine's home, a page at a time, names only, which "+ Session" on a machine with no checkout of the
// project browses for the folder that holds it. Nothing here raises a privacy prompt by itself: the path is resolved by
// src/shared/machine/home-folders.ts, touching nothing inside a protected folder unless the call opens it (`open: true`
// opens the folders the named path itself enters), and a folder's entries are read by their directory entry types
// alone, no entry stat'ed or followed. A link is not listed (its target may be anywhere); a file is not either.
//
// A refusal is `invalid_input` whose message starts with its reason (`no-folder`, `outside-home`, `symlink-escape`,
// `protected`), as the endpoint's setup refusals name them.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandOutput } from '@shared/ipc/schema';
import { expandHome, isProtected, walk, type Home, type HomeRefusal } from '@shared/machine/home-folders';
import type { ServiceHandler } from '@shared/spine/bus';
import type { SetupGuard } from './setup';

/** The entries one page holds. */
export const FOLDERS_PAGE = 200;

const WORDS: Record<HomeRefusal, string> = {
  'no-folder': 'there is no folder there',
  'outside-home': "it isn't under this machine's home folder",
  'symlink-escape': "it goes through a link out of this machine's home folder",
  protected: 'it is in a folder macOS protects; open that folder first',
};
const refuse = (reason: HomeRefusal, path: string) => new HostCommandError(ipcError('invalid_input', `${reason}: ${path}: ${WORDS[reason]}`));

/** Hidden folders after the rest, each part by name. */
const order = (a: string, b: string): number => Number(a.startsWith('.')) - Number(b.startsWith('.')) || (a < b ? -1 : a > b ? 1 : 0);

export async function listFolders(input: CommandInput<'machine.folders.list'>, where: Home, page = FOLDERS_PAGE): Promise<CommandOutput<'machine.folders.list'>> {
  const asked = input.path ?? '~';
  const named = expandHome(asked, where.home);
  if (named === null) throw refuse('outside-home', asked);
  // `open` opens the protected folders the named path enters itself, no other (a link inside one into another is refused)
  const resolved = await walk(named, where, { opened: () => false, open: input.open === true });
  if (!resolved.ok) throw refuse(resolved.reason, asked);
  let names: string[];
  try {
    names = (await readdir(resolved.real, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    throw refuse('no-folder', asked);
  }
  names.sort(order);
  const cursor = input.cursor;
  const start = cursor === undefined ? 0 : names.filter((name) => order(name, cursor) <= 0).length;
  const shown = names.slice(start, start + page);
  return {
    entries: shown.map((name) => ({ name, path: join(resolved.real, name), protected: isProtected(join(resolved.real, name), where) })),
    cursor: start + page < names.length ? shown.at(-1)! : null,
  };
}

/** Registers the handler with the machine's home and platform. Who opened what is the endpoint's record, per member. */
export function registerFolders(register: <N extends CommandName>(name: N, handler: ServiceHandler<N>) => void, guard: SetupGuard): void {
  register('machine.folders.list', (input) => listFolders(input, guard.where, FOLDERS_PAGE));
}
