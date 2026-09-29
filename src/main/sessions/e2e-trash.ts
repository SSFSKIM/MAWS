// The e2e seam for Delete's Trash move (C10 M4a, post-review): under `MAWS_E2E=1` with `MAWS_E2E_TRASH_DIR=<dir>`,
// the session service's injected `trash` moves each path into that directory instead of the user's Trash, so an
// end-to-end run never writes into the owner's `~/.Trash` and can assert where every file went. Never active outside
// MAWS_E2E; a directory that does not exist refuses the move, which Delete reports as `partial` with nothing lost.
import { cp, lstat, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

type Trash = (path: string) => Promise<void>;

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export function trashFor(env: NodeJS.ProcessEnv, trashItem: Trash): Trash {
  const dir = env.MAWS_E2E === '1' ? env.MAWS_E2E_TRASH_DIR : undefined;
  if (!dir) return trashItem;
  return async (path) => {
    const target = await stat(dir).catch(() => null);
    if (!target?.isDirectory()) throw new Error(`MAWS_E2E_TRASH_DIR is not a directory: ${dir}`);
    // the Trash keeps a name and never overwrites: a second file of that name gets a suffix
    let dest = join(dir, basename(path));
    for (let n = 1; await exists(dest); n += 1) dest = join(dir, `${basename(path)}.${n}`);
    try {
      await rename(path, dest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await cp(path, dest, { recursive: true, errorOnExist: true, force: false });
      await rm(path, { recursive: true, force: true });
    }
  };
}
