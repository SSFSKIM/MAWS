// `mawsd run`'s arguments (P5 O2 M5): `run --unit|--private --dir <profile>/mawsd`, the profile itself in MAWS_USER_DATA.
// The directory is absolute: a unit starts in `/`, so a relative one would name somewhere else.
import { isAbsolute } from 'node:path';

export const USAGE = 'usage: mawsd run --unit|--private --dir <profile>/mawsd (with MAWS_USER_DATA=<profile>)';

export interface RunArgs {
  kind: 'unit' | 'private';
  dir: string;
}

// `run`'s arguments, or why they are refused.
export function parseRun(argv: readonly string[]): RunArgs | string {
  let kind: RunArgs['kind'] | null = null;
  let dir: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--unit' || arg === '--private') {
      if (kind !== null) return 'run takes one of --unit and --private';
      kind = arg === '--unit' ? 'unit' : 'private';
    } else if (arg === '--dir') {
      dir = argv[++i] ?? null;
      if (!dir) return '--dir needs a directory';
      if (!isAbsolute(dir)) return `--dir needs an absolute path, not ${dir}`;
    } else return `run does not take ${arg}`;
  }
  if (kind === null) return 'run needs --unit or --private';
  if (dir === null) return 'run needs --dir <profile>/mawsd';
  return { kind, dir };
}

