// P3-HD M1: the `projects` key a launch's engine reads its local-scope MCP servers under, captured by the host once,
// before the engine spawns (./launcher.ts), and held host-private in that launch's ConnectorLaunchContext. Never a
// LaunchSpec field, a journal row or an IPC answer; route D never re-derives it later, so a repository created or
// removed after the launch cannot retarget a lookup.
//
// The engine's own derivation (2.1.300 readable bundle, cli.pretty.js:959390-959396 `oje`, 181050 `II`, 30654-30675
// `Rr`, 30725-30780 `Et`): walk up from the resolved cwd to the first directory holding `.git`; a `.git` directory makes
// that directory the key; a `.git` file may be a linked worktree or submodule the engine folds to another root; with no
// `.git` anywhere the key is the cwd. Probe run 39007800364 proved the cwd key outside a repository and the root key at a
// repository root and in its child directory (e2e/fixtures/connectors-direct/run-39007800364). Only those are captured;
// everything else is unidentified, so local scope stays engine-only there: a `.git` file or link (the folding is not
// yet proven), a cwd reached through a symlink (which spelling the engine keys is not proven), and any probe that
// failed or ran out of time (never read as "no repository"). P3-F L244: APFS answers a realpath in the Unicode form it
// stored, so a composed (NFC) cwd can come back decomposed (NFD) for the very same directory; that is the cwd itself
// when no component of it is a link, and a link anywhere stays refused whatever its target's spelling.
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';

export type ConnectorLocalKey =
  | { kind: 'directory'; key: string } // no repository above the cwd: the cwd
  | { kind: 'repository'; key: string } // the nearest ancestor holding a `.git` directory
  | { kind: 'unidentified'; why: 'linkedCheckout' | 'symlinkedCwd' | 'unreadable' | 'timeout' | 'notAbsolute' | 'notCaptured' };

export const LOCAL_KEY_TIMEOUT_MS = 1_500;

export interface LocalKeyFiles {
  gitEntry(path: string): Promise<'directory' | 'other' | 'absent'>; // `<dir>/.git`, not followed; throws when unreadable
  realpath(path: string): Promise<string>;
  isLink(path: string): Promise<boolean>; // the entry itself, not followed; throws when unreadable
}

export const nodeLocalKeyFiles: LocalKeyFiles = {
  async gitEntry(path) {
    try {
      return (await lstat(path)).isDirectory() ? 'directory' : 'other';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return 'absent';
      throw error;
    }
  },
  realpath: (path) => realpath(path),
  isLink: async (path) => (await lstat(path)).isSymbolicLink(),
};

export async function captureLocalKey(cwd: string, options: { files?: LocalKeyFiles; timeoutMs?: number } = {}): Promise<ConnectorLocalKey> {
  if (!isAbsolute(cwd)) return { kind: 'unidentified', why: 'notAbsolute' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<ConnectorLocalKey>((settle) => (timer = setTimeout(() => settle({ kind: 'unidentified', why: 'timeout' }), options.timeoutMs ?? LOCAL_KEY_TIMEOUT_MS)));
  try {
    return await Promise.race([derive(resolve(cwd), options.files ?? nodeLocalKeyFiles), late]);
  } finally {
    clearTimeout(timer);
  }
}

async function derive(cwd: string, files: LocalKeyFiles): Promise<ConnectorLocalKey> {
  try {
    const top = parse(cwd).root;
    if (!(await reachedDirectly(cwd, top, files))) return { kind: 'unidentified', why: 'symlinkedCwd' };
    for (let at = cwd; ; at = dirname(at)) {
      const entry = await files.gitEntry(join(at, '.git'));
      if (entry === 'directory') return { kind: 'repository', key: at.normalize('NFC') };
      if (entry === 'other') return { kind: 'unidentified', why: 'linkedCheckout' };
      if (at === top) return { kind: 'directory', key: cwd.normalize('NFC') };
    }
  } catch {
    return { kind: 'unidentified', why: 'unreadable' };
  }
}

// Whether the cwd is its own realpath: identical, or equal under NFC with no link from the cwd up to the root. A
// normalization-sensitive filesystem can hold the other spelling as another directory, which only a link would reach.
async function reachedDirectly(cwd: string, top: string, files: LocalKeyFiles): Promise<boolean> {
  const real = await files.realpath(cwd);
  if (real === cwd) return true;
  if (real.normalize('NFC') !== cwd.normalize('NFC')) return false;
  for (let at = cwd; at !== top; at = dirname(at)) if (await files.isLink(at)) return false;
  return true;
}
