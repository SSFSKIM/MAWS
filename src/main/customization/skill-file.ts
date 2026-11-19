// `customization.skillFile` (UX wave U11, a skill's actions; docs/doperpowers/ledgers/2026-11-18-ux-wave-U11-skill-actions.md,
// decisions 2 and 6): shows a skill's SKILL.md in Finder from Customize. The window names the place and the row's path;
// main reads the inventory of that place itself and admits the path only when one of its skills has exactly it, then
// shows the real path, and only a regular file. A path the window made up, a skill removed since the list was read and a
// file no longer there answer `missing`; nothing is shown for them.
import { realpath, stat } from 'node:fs/promises';
import { isNoClient, type ClientPort } from '@shared/client/port';
import type { ClientRef } from '@shared/ipc/client';
import type { CommandInput } from '@shared/ipc/schema';
import type { SkillFileOutput } from '@shared/ipc/schema/customization';

export type InventoryAnswer = { ok: true; skillPaths: readonly string[] } | { ok: false; message: string };

export interface SkillFileDeps {
  inventory(cwd: string | null): Promise<InventoryAnswer>; // main's own read of `customization.inventory`
  port: Pick<ClientPort, 'reveal'>; // the client port (OX4), asked through the requesting client
}

const refused = (reason: 'missing' | 'unreadable' | 'no-window', message: string | null = null): SkillFileOutput => ({ status: 'refused', reason, message });

/** The real path of a regular file the inventory of `cwd` lists as a skill's file at exactly `path`, else why not. */
export async function admitSkillFile(cwd: string | null, path: string, inventory: SkillFileDeps['inventory']): Promise<{ ok: true; real: string } | { ok: false; refusal: SkillFileOutput }> {
  const answer = await inventory(cwd);
  if (!answer.ok) return { ok: false, refusal: refused('unreadable', answer.message) };
  if (!answer.skillPaths.includes(path)) return { ok: false, refusal: refused('missing') };
  try {
    const real = await realpath(path);
    if (!(await stat(real)).isFile()) return { ok: false, refusal: refused('missing') };
    return { ok: true, real };
  } catch {
    return { ok: false, refusal: refused('missing') };
  }
}

export async function skillFile(input: CommandInput<'customization.skillFile'>, client: ClientRef | null, deps: SkillFileDeps): Promise<SkillFileOutput> {
  const admitted = await admitSkillFile(input.cwd, input.path, deps.inventory);
  if (!admitted.ok) return admitted.refusal;
  return isNoClient(await deps.port.reveal(client, admitted.real)) ? refused('no-window') : { status: 'revealed' };
}
