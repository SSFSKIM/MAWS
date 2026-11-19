// `customization.skillFile` (UX wave U11, a skill's actions; docs/doperpowers/ledgers/2026-11-18-ux-wave-U11-skill-actions.md,
// decisions 1, 2, 6 and 11): a skill's SKILL.md, from Customize, to a row of "Open in": an editor opens it, Finder shows
// it. The window names the place, the row's path and the app; main reads the inventory of that place itself and admits the
// path only when one of its skills has exactly it and the file there now is the one the inventory read (its real path
// and its identity, decision 12), then hands that real path to U6b-4a's launcher
// (`launchFile`, ../open-in/open-in.ts). A path the window made up, a skill removed since the list was read and a file no
// longer there answer `missing`; nothing is opened for them.
import { realpath, stat } from 'node:fs/promises';
import type { CommandInput } from '@shared/ipc/schema';
import type { SkillFileOutput } from '@shared/ipc/schema/customization';
import type { OpenIn } from '../open-in/open-in';

// What main's own read of the place's inventory says about skills: each skill's listed path with the real path and the
// identity of the file the inventory read (absent from an engine host of an earlier build), whether every skill folder
// was read (`complete`), and the read's own words when it was not.
export interface ListedSkill { path: string; realPath?: string; fileId?: string }
export type InventoryAnswer = { ok: true; skills: readonly ListedSkill[]; complete: boolean; problem: string | null } | { ok: false; message: string };

export interface SkillFileDeps {
  inventory(cwd: string | null): Promise<InventoryAnswer>; // main's own read of `customization.inventory`
  launcher: Pick<OpenIn, 'launchFile'>;
}

export const SKILL_FILE_WORDS = {
  olderHost: 'the engine host is an older version, which does not say which file it read',
  incomplete: 'the list of skills is incomplete',
} as const;

const refused = (reason: 'missing' | 'unreadable' | 'launch', message: string | null = null): SkillFileOutput => ({ status: 'refused', reason, message });

/** The real path of the file the inventory of `cwd` read for the skill listed at exactly `path`, when the same file (its
 * real path and its identity) is there now; else why not. A skill not listed is `missing` only when every skill folder was
 * read; otherwise the read's failure is the answer. */
export async function admitSkillFile(cwd: string | null, path: string, inventory: SkillFileDeps['inventory']): Promise<{ ok: true; real: string } | { ok: false; refusal: SkillFileOutput }> {
  const answer = await inventory(cwd);
  if (!answer.ok) return { ok: false, refusal: refused('unreadable', answer.message) };
  const listed = answer.skills.find((skill) => skill.path === path);
  if (listed === undefined) return { ok: false, refusal: answer.complete ? refused('missing') : refused('unreadable', answer.problem ?? SKILL_FILE_WORDS.incomplete) };
  if (listed.realPath === undefined || listed.fileId === undefined) return { ok: false, refusal: refused('unreadable', SKILL_FILE_WORDS.olderHost) };
  try {
    const real = await realpath(path);
    const now = await stat(real, { bigint: true });
    if (real !== listed.realPath || !now.isFile() || `${now.dev}:${now.ino}` !== listed.fileId) return { ok: false, refusal: refused('missing') };
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
