// `#` memory append (charter §4.2; C3 execution document, Interfaces "Rewind, `!`, `#`", M4). No wire mechanism
// exists for `#`: the host reads `get_memory_dialog`, picks the file by target (`project`, `user`, or a path that must
// be one of the listed files or inside one of the listed folders, so this command can never write anywhere else),
// creates it when missing and appends `\n- ${text}\n`; the engine re-reads CLAUDE.md on the next turn. The path guard
// compares real paths (M4 review): the target's and every listed file's and folder's, each resolved through its
// nearest existing ancestor, so a symlink inside a listed folder cannot carry a write outside it.
import { appendFile, lstat, mkdir, readlink, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { getMemoryDialog } from './controls';
import type { EngineSession } from './session';

export interface MemoryTarget { kind: 'user' | 'project' | 'path'; path: string | null }

export async function memoryAppend(session: EngineSession, args: { text: string; target: MemoryTarget }): Promise<{ path: string; created: boolean }> {
  const client = session.control;
  if (!client || session.status().process !== 'ready') throw new Error(`session ${session.status().appSessionId} is not ready`);
  const dialog = await getMemoryDialog(client, {});
  const path = await chooseFile(dialog, args.target);
  const created = !(await stat(path).then(() => true, () => false));
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `\n- ${args.text}\n`);
  return { path, created };
}

async function chooseFile(dialog: { files: { kind: string; path: string }[]; folders: { path: string }[] }, target: MemoryTarget): Promise<string> {
  if (target.kind !== 'path') {
    const file = dialog.files.find((f) => f.kind === target.kind);
    if (!file) throw new Error(`get_memory_dialog lists no ${target.kind} memory file`);
    return file.path;
  }
  if (target.path === null) throw new Error('a path target needs a path');
  const wanted = resolve(target.path);
  const real = await realPathOf(wanted);
  const files = await Promise.all(dialog.files.map((f) => realPathOf(f.path)));
  const folders = await Promise.all(dialog.folders.map((f) => realPathOf(f.path)));
  const inside = (folder: string) => {
    const rel = relative(folder, real);
    return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
  };
  if (files.includes(real) || folders.some(inside)) return wanted;
  throw new Error(`${target.path} is not one of the memory files or folders get_memory_dialog listed`);
}

// The real path of `p`, which may not exist yet: its nearest existing ancestor resolved through `realpath`, with the
// missing tail appended. `realpath` answers ENOENT for a dangling symlink too, which `appendFile` would follow and
// create outside (M4 re-review), so a component is treated as missing only when `lstat` says it does not exist; a
// component that exists as a link whose target is missing is replaced by its would-be target (`readlink`, relative to
// its directory) and resolved again, so the caller checks where the write would really land.
async function realPathOf(p: string, hops = 0): Promise<string> {
  if (hops > MAX_LINK_HOPS) throw Object.assign(new Error(`too many symbolic links resolving ${p}`), { code: 'ELOOP' });
  let current = resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      return join(await realpath(current), ...tail);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const entry = await lstat(current).catch((e: NodeJS.ErrnoException) => (e.code === 'ENOENT' ? null : Promise.reject(e)));
      if (entry?.isSymbolicLink()) return realPathOf(join(resolve(dirname(current), await readlink(current)), ...tail), hops + 1); // a dangling link
      const parent = dirname(current);
      if (parent === current) throw error;
      tail.unshift(basename(current)); // genuinely missing: keep walking up
      current = parent;
    }
  }
}

const MAX_LINK_HOPS = 40;
