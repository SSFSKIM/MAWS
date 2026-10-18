// DX4's `output` answer (composite DX4, "`output`"), as the fake machine gives it: a known task's output tail, served
// only at the path the loop's rows named for it and only under DX4's containment rule — the named path carries
// `<session>/tasks/<taskId>.output`, and its realpath is exactly `<realpath of a root>/<taskId>.output` and a regular
// file. DC8's shared vectors pin it (dx4/dx4-jobs.json, `outputCases`). It reads the tail synchronously: the fake has no
// thread to spare, and a recording's files are small.
import { closeSync, fstatSync, lstatSync, openSync, readlinkSync, readSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TaskOutput } from '../src/protocol/session';
import type { LoopIndex } from './jobs';

/**
 * Where on this machine's disk a path the rows named lies, or null when it is nowhere this machine keeps task outputs.
 * The plane reads the named path itself (the identity); the fake machine models the engine's temporary directory and
 * maps the session's canonical roots onto its recording's `tasks/`.
 */
export type Locate = (named: string) => string | null;

/** How many symlinks one resolution follows before it gives up (the kernel's own limit on macOS and Linux). */
const MAX_LINKS = 32;

/**
 * The realpath of `path` as the filesystem resolves it: component by component from `base` (or `/` for an absolute
 * path), each symlink expanded where it stands — a dangling one to the target it names — and a `..` applied to the
 * prefix resolved so far, never collapsed lexically past a link before it. What does not exist is kept as named, so a
 * link pointing outside the roots is never taken for a missing file under one. Null when the destination cannot be
 * established — a loop past `MAX_LINKS`, an unreadable component, or a `..` after a component that does not exist —
 * and the caller refuses.
 */
function resolvedPath(path: string, links = { followed: 0 }, base = '/'): string | null {
  let current = path.startsWith('/') ? '/' : base;
  const parts = path.split('/');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '' || part === '.') continue;
    if (part === '..') {
      current = dirname(current);
      continue;
    }
    const next = current === '/' ? `/${part}` : `${current}/${part}`;
    let stat;
    try {
      stat = lstatSync(next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
      const rest = parts.slice(i + 1).filter((p) => p !== '' && p !== '.');
      return rest.includes('..') ? null : [next, ...rest].join('/');
    }
    if (!stat.isSymbolicLink()) {
      current = next;
      continue;
    }
    if (++links.followed > MAX_LINKS) return null;
    const resolved = resolvedPath(readlinkSync(next), links, current);
    if (resolved === null) return null;
    current = resolved;
  }
  return current;
}

/**
 * Answers `output {taskId, tail}` from the loop's index: `unknown-task` for a task no row names; `missing` with `path:
 * null` before any row names a file; `refused` for a path that fails containment; `missing` with the path for one that
 * passes with nothing there; else `ok`, the last `tail` bytes, cut forward past the first line break inside the window
 * when the window does not start the file, decoded as UTF-8 with replacement.
 */
export function answerOutput(request: { taskId: string; tail: number }, index: LoopIndex, session: string, roots: string[], locate: Locate = (p) => p): TaskOutput {
  const { taskId, tail } = request;
  if (!index.known.has(taskId)) return { taskId, result: 'unknown-task' };
  const path = index.paths.get(taskId);
  if (path === undefined) return { taskId, result: 'missing', path: null };
  const refuse = (reason: string): TaskOutput => ({ taskId, result: 'refused', path, reason });
  const parts = path.split('/');
  if (parts.length < 4 || parts.at(-3) !== session || parts.at(-2) !== 'tasks' || parts.at(-1) !== `${taskId}.output`) {
    return refuse(`The path the session named for ${taskId} is not its own tasks file (${session}/tasks/${taskId}.output), so it is not read.`);
  }
  const local = locate(path);
  if (local === null) return refuse(`The path the session named for ${taskId} is outside the session's task directories, so it is not read.`);
  const target = resolvedPath(local);
  const allowed = roots.map((root) => resolvedPath(root)).filter((root): root is string => root !== null).map((root) => join(root, `${taskId}.output`));
  if (target === null || !allowed.includes(target)) {
    return refuse(`The path the session named for ${taskId} resolves outside the session's task directories, or to another file, so it is not read.`);
  }
  // What is opened is the path that was checked, every link already expanded, never the named one again.
  let fd: number;
  try {
    fd = openSync(target, 'r');
  } catch {
    return { taskId, result: 'missing', path };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return refuse(`The path the session named for ${taskId} is not a regular file, so it is not read.`);
    const size = stat.size;
    const start = Math.max(0, size - tail);
    const window = Buffer.alloc(size - start);
    let read = 0;
    while (read < window.length) {
      const n = readSync(fd, window, read, window.length - read, start + read);
      if (n === 0) break;
      read += n;
    }
    const bytes = window.subarray(0, read);
    const breakAt = start > 0 ? bytes.indexOf(0x0a) : -1;
    const cut = breakAt >= 0 ? breakAt + 1 : 0;
    const from = start + cut;
    return { taskId, result: 'ok', path, size, from, text: new TextDecoder('utf-8').decode(bytes.subarray(cut)), truncated: from > 0 };
  } finally {
    closeSync(fd);
  }
}
