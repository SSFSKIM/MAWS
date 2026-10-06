// Which `git` and `gh` a remote command runs (E6 execution document, Design §4): the first executable regular file of
// that name across the remote environment's `PATH` (the owner's login-shell `PATH`, so the git their credential helpers
// are configured for is the one that pushes, and their `gh` is the one signed in). `MAWS_GIT` and `MAWS_GH`, read from
// MAWS's own process environment (tests and a developer), override; `git` falls back to Apple's, `gh` has none.
//
// Only absolute entries count: an empty or relative entry would resolve against the process's working directory, and
// no directory a checkout or a cwd can choose may pick the program MAWS runs with the owner's credentials. The answer
// is the path as the entry spells it (a Homebrew link stays the link), which is what a shell would run.
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const APPLE_GIT = '/usr/bin/git';

export async function findExecutable(name: string, path: string | undefined): Promise<string | null> {
  for (const entry of (path ?? '').split(':')) {
    if (!isAbsolute(entry)) continue;
    const candidate = join(entry, name);
    if (await isExecutableFile(candidate)) return candidate;
  }
  return null;
}

export async function gitProgram(remoteEnv: Record<string, string | undefined>, env: NodeJS.ProcessEnv): Promise<string> {
  return env.MAWS_GIT || ((await findExecutable('git', remoteEnv.PATH)) ?? APPLE_GIT);
}

export async function ghProgram(remoteEnv: Record<string, string | undefined>, env: NodeJS.ProcessEnv): Promise<string | null> {
  return env.MAWS_GH || findExecutable('gh', remoteEnv.PATH);
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false; // follows links; a dangling one throws
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
