// `settings.reveal` (C11 execution document, Interfaces "X2 additions"; ruled 2026-09-29): shows a file the widgets
// name (a settings file, a memory file, a hook's source) in Finder, and nothing else: it never opens or edits the file.
// The guard resolves the real path first, so `..` and a symlink that leaves are judged by where they land, and admits it
// only under the engine's config home or a session record's directory or additional directory. Main sees no host
// answers, so it keeps no list of the paths the engine's reads named; every file the widgets name lies under those roots.
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';

export interface RevealDeps {
  configHome(): string; // CLAUDE_CONFIG_DIR, else ~/.claude
  sessionDirectories(): string[]; // every known session record's directory and additional directories
  showItemInFolder(path: string): void; // Electron's shell.showItemInFolder
}

export async function revealPath(path: string, deps: RevealDeps): Promise<{ revealed: boolean }> {
  if (!isAbsolute(path)) return { revealed: false };
  const real = await resolved(path);
  if (real === null) return { revealed: false }; // nothing there to show
  const roots = await Promise.all([...new Set([deps.configHome(), ...deps.sessionDirectories()])].map(resolved)); // many sessions share a directory
  if (!roots.some((root) => root !== null && within(root, real))) return { revealed: false };
  deps.showItemInFolder(real);
  return { revealed: true };
}

async function resolved(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel));
}
