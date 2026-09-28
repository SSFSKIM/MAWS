// `#` memory append (charter §4.2; C3 execution document, Interfaces "Rewind, `!`, `#`", M4). No wire mechanism
// exists for `#`: the host reads `get_memory_dialog`, picks the file by target (`project`, `user`, or a path that must
// be one of the listed files or inside one of the listed folders, so this command can never write anywhere else),
// creates it when missing and appends `\n- ${text}\n`; the engine re-reads CLAUDE.md on the next turn.
import { appendFile, mkdir, stat } from 'node:fs/promises';
import { dirname, relative, resolve, isAbsolute } from 'node:path';
import { getMemoryDialog } from './controls';
import type { EngineSession } from './session';

export interface MemoryTarget { kind: 'user' | 'project' | 'path'; path: string | null }

export async function memoryAppend(session: EngineSession, args: { text: string; target: MemoryTarget }): Promise<{ path: string; created: boolean }> {
  const client = session.control;
  if (!client || session.status().process !== 'ready') throw new Error(`session ${session.status().appSessionId} is not ready`);
  const dialog = await getMemoryDialog(client, {});
  const path = chooseFile(dialog, args.target);
  const created = !(await stat(path).then(() => true, () => false));
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `\n- ${args.text}\n`);
  return { path, created };
}

function chooseFile(dialog: { files: { kind: string; path: string }[]; folders: { path: string }[] }, target: MemoryTarget): string {
  if (target.kind !== 'path') {
    const file = dialog.files.find((f) => f.kind === target.kind);
    if (!file) throw new Error(`get_memory_dialog lists no ${target.kind} memory file`);
    return file.path;
  }
  if (target.path === null) throw new Error('a path target needs a path');
  const wanted = resolve(target.path);
  const inside = (folder: string) => {
    const rel = relative(resolve(folder), wanted);
    return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
  };
  if (dialog.files.some((f) => resolve(f.path) === wanted) || dialog.folders.some((f) => inside(f.path))) return wanted;
  throw new Error(`${target.path} is not one of the memory files or folders get_memory_dialog listed`);
}
