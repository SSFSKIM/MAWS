// `customization.skillFile` (UX wave U11, a skill's actions; docs/doperpowers/ledgers/2026-11-18-ux-wave-U11-skill-actions.md,
// decisions 1, 2, 6 and 11): a skill's SKILL.md, from Customize, to a row of "Open in": an editor opens it, Finder shows
// it. The window names the place, the row's path and the app; main reads the inventory of that place itself and admits the
// path only when one of its skills has exactly it, then hands the real path, and only a regular file, to U6b-4a's launcher
// (`launchFile`, ../open-in/open-in.ts). A path the window made up, a skill removed since the list was read and a file no
// longer there answer `missing`; nothing is opened for them.
import { realpath, stat } from 'node:fs/promises';
import type { CommandInput } from '@shared/ipc/schema';
import type { SkillFileOutput } from '@shared/ipc/schema/customization';
import type { OpenIn } from '../open-in/open-in';

export type InventoryAnswer = { ok: true; skillPaths: readonly string[] } | { ok: false; message: string };

export interface SkillFileDeps {
  inventory(cwd: string | null): Promise<InventoryAnswer>; // main's own read of `customization.inventory`
  launcher: Pick<OpenIn, 'launchFile'>;
}

const refused = (reason: 'missing' | 'unreadable' | 'launch', message: string | null = null): SkillFileOutput => ({ status: 'refused', reason, message });

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

export async function skillFile(input: CommandInput<'customization.skillFile'>, deps: SkillFileDeps): Promise<SkillFileOutput> {
  const admitted = await admitSkillFile(input.cwd, input.path, deps.inventory);
  if (!admitted.ok) return admitted.refusal;
  const launched = await deps.launcher.launchFile(input.app, admitted.real);
  return launched.opened ? { status: 'opened' } : refused('launch', launched.message);
}
