// The writer's door (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §E; S1; X2): every change MAWS
// makes to a sheet is inbox lines appended by `sminos sheet put --session <id>`, the one code path that holds the
// record's lock. The command runs with `execFile`, no shell, the lines as compact JSON on standard input, one a line;
// each exit is read as C2's I3 and the set's README give it. What became of an act is read from the model's `sent`
// (S15), never from this: the door's results are only its first word.
//
// After `busy` or `failed` a surface sends the same inbox lines again, under the same keys: after a timeout nobody
// knows whether the lines were appended, and the key is what makes a resend the same act (composite §4.2).
import { execFile } from 'node:child_process';
import { SheetPutEntrySchema, type SheetLine, type SheetPutResult } from '@shared/sheet/model';

/** A `sminos` MAWS found, with the environment it runs under: the login shell's, `SMINOS_HOME` the reader's home. */
export interface SminosCli {
  path: string;
  env: Record<string, string>;
  source: 'named' | 'plugin';
}

/** What a run of the command came to. */
export type SminosRun =
  | { started: false } // the executable could not be started (missing, not executable)
  | { started: true; code: number | null; timedOut: boolean; stdout: string; stderr: string };

const OUTPUT_MAX = 4 * 1024 * 1024; // the door prints one result per line it took, at most fifty

/** Runs the command once, with `input` on standard input, killed at `timeoutMs`. Never rejects. */
export function runSminos(cli: Pick<SminosCli, 'path' | 'env'>, args: readonly string[], input: string, timeoutMs: number): Promise<SminosRun> {
  return new Promise((resolve) => {
    const child = execFile(cli.path, args, { env: cli.env, timeout: timeoutMs, maxBuffer: OUTPUT_MAX, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      if (error === null) return resolve({ started: true, code: 0, timedOut: false, stdout, stderr });
      const code = (error as NodeJS.ErrnoException & { code?: unknown }).code;
      // A spawn failure carries the system's code (`ENOENT`, `EACCES`); an exit, its number.
      if (typeof code === 'string' && child.pid === undefined) return resolve({ started: false });
      const timedOut = (error as { killed?: boolean }).killed === true && child.exitCode === null;
      resolve({ started: true, code: typeof code === 'number' ? code : null, timedOut, stdout, stderr });
    });
    child.stdin?.on('error', () => {}); // a command that exits before reading its input closes the pipe: its exit says why
    child.stdin?.end(input);
  });
}

/** Why a put failed when the command itself could not be started; the service locates the command again on it. */
export const DOOR_NOT_STARTED = 'The sminos command could not be started.';

const firstLine = (text: string): string => text.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';

/** One call of the door: the lines appended as one act (one batch when there are several), and its first word on each. */
export async function putLines(cli: SminosCli, session: string, lines: readonly SheetLine[], timeoutMs: number): Promise<SheetPutResult> {
  const input = lines.map((line) => `${JSON.stringify(line)}\n`).join('');
  const run = await runSminos(cli, ['sheet', 'put', '--session', session], input, timeoutMs);
  if (!run.started) return { ok: false, why: 'failed', message: DOOR_NOT_STARTED };
  if (run.timedOut) return { ok: false, why: 'failed', message: 'The sminos command did not answer in time; send again.' };
  switch (run.code) {
    case 0:
      return resultsOf(run.stdout);
    case 2:
      return { ok: false, why: 'refused', message: firstLine(run.stderr) || 'The sminos command refused the lines; nothing was appended.' };
    case 3:
      return { ok: false, why: 'no-sheet', message: 'This session has no question sheet on this Mac.' };
    case 75:
      return { ok: false, why: 'busy', message: 'The sheet was busy; send again.' };
    default:
      return { ok: false, why: 'failed', message: 'The sminos command could not append the lines; send again.' };
  }
}

// Exit 0's standard output: `{ session, results }`, one result a line taken.
function resultsOf(stdout: string): SheetPutResult {
  const unreadable: SheetPutResult = { ok: false, why: 'failed', message: 'The sminos command answered in a form MAWS does not read; send again.' };
  let printed: unknown;
  try {
    printed = JSON.parse(stdout);
  } catch {
    return unreadable;
  }
  const results = (printed as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return unreadable;
  const parsed = results.map((entry) => SheetPutEntrySchema.safeParse(entry));
  if (!parsed.every((entry) => entry.success)) return unreadable;
  return { ok: true, results: parsed.map((entry) => entry.data!) };
}
