// `maws project`'s words (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §K), one source for the command
// line (src/mawsd/maws-cli.ts), which acts on this machine's folders, and for main (src/main/org/project-acts.ts), which
// acts on another machine's for a terminal on this Mac and answers with the same lines. Where a line names "this
// machine", an act on another machine names that machine instead (`machine`), since the terminal is not on it.
import { PROJECT_REFUSALS } from '../ipc/schema/session';

/** What an add, a link or an unlink answers of the row: its id there, its name and folder, and its project. */
export type ActRow = { name: string; directory: string; org?: { name: string; smnsId: string | null } };
type Where = { nameOf(id: string): string | null; machine?: string };

const notConfirmed = (machine?: string) => `sminos has not confirmed yet; a session started now may be filed under ${machine ?? 'this machine'} for a moment`;
const projectName = (row: ActRow, id: string, nameOf: Where['nameOf']) => nameOf(id) ?? row.org?.name ?? row.name;
const withConfirmation = (line: string, restated: boolean | undefined, machine?: string) => (restated === false ? `${line}\n${notConfirmed(machine)}` : line);

/**
 * `add`'s words (§K): a new project when the rule's answer is a minted id at the folder itself; a location of the project
 * the folder is in otherwise; the machine's own project when the rule leaves it there (or the answer says nothing of
 * how it was decided, which is a machine that makes no stored statement now). Not enrolled, it is the machine's alone.
 */
export function addWords(answer: { project: ActRow; by?: string; at?: string | null; restated?: boolean }, where: Where & { enrolled: boolean }): string {
  const { project, by, at, restated } = answer;
  if (!where.enrolled) return `added ${project.directory}; this machine is not enrolled, so it is a project of this machine only`;
  const id = project.org?.smnsId ?? null;
  const line =
    by === 'minted' && at === project.directory && id !== null
      ? `added ${project.name} as a new project (${id})`
      : id !== null
        ? `added ${project.directory} as a location of ${projectName(project, id, where.nameOf)} (${id})`
        : where.machine === undefined
          ? `added ${project.directory}; it stays under this machine until sminos here is updated`
          : `added ${project.directory}; it stays under ${where.machine} until sminos there is updated`;
  return withConfirmation(line, restated, where.machine);
}

/** `link`'s words: the project a link puts the folder in, or the one an unlink leaves it in. */
export function linkWords(answer: { project: ActRow; restated: boolean }, where: Where & { into: string | null }): string {
  const { project, restated } = answer;
  const id = project.org?.smnsId ?? null;
  const line =
    where.into !== null
      ? `linked ${project.directory} into ${projectName(project, where.into, where.nameOf)} (${where.into})`
      : id !== null
        ? `unlinked ${project.directory}; its project is ${projectName(project, id, where.nameOf)} (${id})`
        : `unlinked ${project.directory}; it is under ${where.machine ?? 'this machine'}`;
  return withConfirmation(line, restated, where.machine);
}

export const removeWords = (directory: string) => `removed ${directory}`;

/** A request aimed at another machine, as a terminal names it (`projects.forward`'s input). */
export type AimedAct = { verb: 'add' | 'remove' | 'link'; machine: string; path: string; into?: string | null; own?: true; name?: string };

// A word as a POSIX shell reads it back: bare when it is plain, else single-quoted.
const shellWord = (word: string) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`);

/** The command that does the same on the machine itself. */
export function runThere(act: Omit<AimedAct, 'machine'>): string {
  const words = ['maws', 'project', act.verb, act.path];
  if (act.verb === 'link') words.push(...(act.into === null || act.into === undefined ? ['--none'] : ['--into', act.into]));
  if (act.verb === 'add') {
    if (typeof act.into === 'string') words.push('--into', act.into);
    if (act.own === true) words.push('--new');
    if (act.name !== undefined) words.push('--name', act.name);
  }
  return words.map(shellWord).join(' ');
}

// §K's refusals of a request aimed at another machine. The first three are "not available here" (exit 2).
export const notRunningHere = (act: AimedAct) => `MAWS is not running on this machine, so it cannot ask ${act.machine}. Run this on ${act.machine}: ${runThere(act)}`;
export const notSignedIn = (act: AimedAct) => `MAWS is not signed in on this Mac, so it cannot ask ${act.machine}. Run this on ${act.machine}: ${runThere(act)}`;
export const NO_WINDOW = 'MAWS has no window open to confirm this. Open MAWS and run the command again.';
export const NOT_CONFIRMED = 'Not confirmed in MAWS.';
const NOT_HERE: ReadonlySet<string> = new Set(['no-app', 'signed-out', 'no-window']);

/** `maws`'s exit code for a refusal's code (mawsd's: 2 not available here, 1 refused). */
export const exitOf = (code: string): 1 | 2 => (NOT_HERE.has(code) ? 2 : 1);

/**
 * A project act's refusal as `maws` prints it: the code the machine's words start with (`<code>: …`, Interfaces §G), else
 * the one lane B names (`issues.refusal`), else the error's own code; the text is the error's words.
 */
export function actRefusal(error: { code: string; message: string; issues?: unknown }): { ok: false; code: string; text: string } {
  const lead = /^([a-z][a-z-]*): /.exec(error.message)?.[1];
  const named = (error.issues as { refusal?: unknown } | undefined)?.refusal;
  const code = lead !== undefined && (PROJECT_REFUSALS as readonly string[]).includes(lead) ? lead : typeof named === 'string' ? named : error.code;
  return { ok: false, code, text: error.message };
}
