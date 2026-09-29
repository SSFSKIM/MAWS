// `#` memory append (charter §4.2; C3 execution document, Interfaces "Rewind, `!`, `#`", M4). No wire mechanism
// exists for `#`: the host reads `get_memory_dialog`, picks the file by target (`project`, `user`, or a path that must
// be one of the listed files or inside one of the listed folders, so this command can never write anywhere else),
// creates it when missing and appends `\n- ${text}\n`; the engine re-reads CLAUDE.md on the next turn.
//
// Confinement never predicts where a path resolves (M4 re-review 2: two predictions in a row were defeated by
// dangling and nested symlinks). It checks what exists and lets the kernel refuse the rest: the target's parent
// directory must already exist and its real path must be a listed folder's real path or lie strictly inside one (or
// the target is a file the dialog lists, followed once through its own real path), and the final component is opened
// `O_NOFOLLOW`, so a symlink there, existing or dangling, is refused rather than followed. Nothing here calls a
// path-based write on a caller-controlled path.
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { getMemoryDialog, REQUEST_TIMEOUT_MS } from './controls';
import type { EngineSession } from './session';

export interface MemoryTarget { kind: 'user' | 'project' | 'path'; path: string | null }

type Dialog = { files: { kind: string; path: string }[]; folders: { path: string }[] };

const OPEN_FLAGS = constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW;

// `session.memoryAppend` is bounded (M5 review): the bridge answers `timeout` when the handler's budget is spent, so the
// append is committed only inside it: the dialog read gets what is left of the budget, and nothing is created or
// appended once it is gone (a file created just before the deadline and not yet written is removed again).
export class MemoryAppendBudgetSpent extends Error {
  constructor(budgetMs: number) {
    super(`# ran past its ${Math.round(budgetMs / 1000)} s budget; nothing was written`);
    this.name = 'MemoryAppendBudgetSpent';
  }
}

export async function memoryAppend(
  session: EngineSession,
  args: { text: string; target: MemoryTarget },
  opts: { budgetMs?: number; now?: () => number } = {},
): Promise<{ path: string; created: boolean }> {
  const now = opts.now ?? Date.now;
  const budgetMs = opts.budgetMs ?? REQUEST_TIMEOUT_MS.read;
  const deadline = now() + budgetMs;
  const withinBudget = () => {
    if (now() >= deadline) throw new MemoryAppendBudgetSpent(budgetMs);
  };
  const client = session.control;
  if (!client || session.status().process !== 'ready') throw new Error(`session ${session.status().appSessionId} is not ready`);
  const dialog = await getMemoryDialog(client, {}, { timeoutMs: deadline - now() });
  const { path, open: where } = await confine(dialog, args.target);
  withinBudget(); // before anything is created
  const { handle, created } = await openConfined(where, path);
  try {
    withinBudget();
    await handle.appendFile(`\n- ${args.text}\n`);
  } catch (error) {
    await handle.close();
    if (created && error instanceof MemoryAppendBudgetSpent) await unlink(where).catch(() => {});
    throw error;
  }
  await handle.close();
  return { path, created };
}

// The path to report and the path to open: `<realpath of an existing parent>/<final component>`.
async function confine(dialog: Dialog, target: MemoryTarget): Promise<{ path: string; open: string }> {
  if (target.kind !== 'path') {
    const file = dialog.files.find((f) => f.kind === target.kind);
    if (!file) throw new Error(`get_memory_dialog lists no ${target.kind} memory file`);
    return { path: file.path, open: await listedFile(file.path, true) };
  }
  if (target.path === null) throw new Error('a path target needs a path');
  const wanted = resolve(target.path);
  const listed = dialog.files.find((f) => resolve(f.path) === wanted);
  if (listed) return { path: wanted, open: await listedFile(listed.path, false) };
  const parent = await realpath(dirname(wanted)).catch(() => {
    throw new Error(`${target.path} is not in an existing directory; # writes only inside the memory folders get_memory_dialog listed`);
  });
  const folders = (await Promise.all(dialog.folders.map((f) => realpath(f.path).catch(() => null)))).filter((f): f is string => f !== null);
  if (!folders.some((folder) => parent === folder || parent.startsWith(folder.endsWith(sep) ? folder : folder + sep))) {
    throw new Error(`${target.path} is not one of the memory files or folders get_memory_dialog listed`);
  }
  return { path: wanted, open: join(parent, basename(wanted)) };
}

// A file the dialog lists: followed once through its own real path when it exists; otherwise opened beside its
// parent's real path, the parent created only for the dialog's own `project` / `user` file.
async function listedFile(path: string, createParent: boolean): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (await lstat(path).then((s) => s.isSymbolicLink(), () => false)) throw symlinkRefused(path); // a dangling link
  if (createParent) await mkdir(dirname(path), { recursive: true });
  return join(await realpath(dirname(path)), basename(path));
}

// Created exclusively when absent (O_EXCL: also fails on any link there), else opened for append; O_NOFOLLOW makes the
// kernel refuse a symlink at the final component in both cases.
async function openConfined(path: string, shown: string): Promise<{ handle: FileHandle; created: boolean }> {
  try {
    return { handle: await open(path, OPEN_FLAGS | constants.O_CREAT | constants.O_EXCL, 0o644), created: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw refusal(error, shown);
  }
  try {
    return { handle: await open(path, OPEN_FLAGS), created: false };
  } catch (error) {
    throw refusal(error, shown);
  }
}

function refusal(error: unknown, shown: string): Error {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ELOOP' || code === 'EMLINK' ? symlinkRefused(shown) : (error as Error);
}

function symlinkRefused(path: string): Error {
  return new Error(`${path} is a symbolic link; # writes only regular files inside the memory folders get_memory_dialog listed`);
}
