// P5 O15 M2b §H (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): main's log file, `<profile>/logs/main.log`,
// every line `<ISO-8601 UTC with ms> <text>` as host.log and mawsd.log have them, 8 MiB and one previous generation
// (`main.log.1`). It is written beside stdout and stderr, which keep every line they have.
//
// Two steps, so that one process alone ever writes or rotates a profile's file. `captureMainLog` wraps the console at
// the app root's load and, until `install`, holds what main says in memory, each line with the time it was said. Only
// the instance that holds the profile lock calls `install` (the first statement of the start `startWithProfileLock`
// runs), which writes the held lines with their own times and every later line as it comes. A second launch never
// installs: its lines go to its own stdout and stderr and nowhere else.
//
// The writer is main's own, not the hosts' `openSupervisorLog`: that one creates its directory outside its guard, leaves
// an existing directory's mode as it finds it, and stamps a line when it is written, where a held line carries the time
// it was said. Opening the file never stops a launch: whatever cannot be made or tightened turns the file log off with
// one line on stderr. The file is a private diagnostic that holds whatever main's console holds; it is never evidence
// as a whole (§H, §K).
import { appendFileSync, chmodSync, lstatSync, mkdirSync, renameSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { format } from 'node:util';
import { errorWords } from '@shared/host/error-words';
import { LOG_ROTATE_BYTES } from '../engine-host/supervisor-log';

export const MAIN_LOG_HELD_LINES = 1_000;

export interface MainLog {
  /** Opens <dir>/main.log, writes the lines held so far with their own times, and writes every later line as it comes. Never throws. False: the file log is off. */
  install(dir: string): boolean;
}

const WRAPPED = ['log', 'info', 'warn', 'error'] as const;

/** Wraps the console's log, info, warn and error, once. Until `install`, the newest MAIN_LOG_HELD_LINES lines are held in memory with their times. */
export function captureMainLog(console: Console, deps: { maxBytes?: number; now?(): Date; stderr?(text: string): void } = {}): MainLog {
  const maxBytes = deps.maxBytes ?? LOG_ROTATE_BYTES;
  const now = deps.now ?? (() => new Date());
  const stderr = deps.stderr ?? ((text: string) => void process.stderr.write(text));

  let state: 'holding' | 'writing' | 'off' = 'holding';
  let held: { at: Date; text: string }[] = [];
  let dropped = 0; // held lines let go past the bound
  let path = '';
  let size = 0; // the file's bytes: this process is its one writer
  let failed = false; // a write that failed, said once

  const write = (at: Date, text: string): void => {
    const line = `${at.toISOString()} ${text}\n`;
    const bytes = Buffer.byteLength(line);
    try {
      if (size > 0 && size + bytes > maxBytes) {
        renameSync(path, `${path}.1`);
        size = 0;
      }
      appendFileSync(path, line, { mode: 0o600 });
      size += bytes;
    } catch (error) {
      if (failed) return;
      failed = true;
      stderr(`[main] the file log dropped a line, and drops any other it cannot write: ${errorWords(error)}\n`);
    }
  };

  const record = (at: Date, text: string): void => {
    for (const line of text.split('\n')) {
      if (state === 'writing') write(at, line);
      else if (state === 'holding') {
        held.push({ at, text: line });
        if (held.length > MAIN_LOG_HELD_LINES) {
          held.shift();
          dropped += 1;
        }
      }
    }
  };

  for (const method of WRAPPED) {
    const original = console[method];
    console[method] = (...args: unknown[]) => {
      const at = now();
      original.apply(console, args);
      try {
        record(at, format(...args));
      } catch {
        // a line that cannot be formatted or kept never fails the call that said it
      }
    };
  }

  return {
    install(dir) {
      if (state !== 'holding') return state === 'writing';
      try {
        privateDirectory(dir);
        path = join(dir, 'main.log');
        size = privateFile(path);
      } catch (error) {
        state = 'off';
        held = [];
        stderr(`[main] the file log is off: ${error instanceof Refusal ? error.message : errorWords(error)}\n`);
        return false;
      }
      state = 'writing';
      if (dropped > 0 && held.length > 0) write(held[0].at, `${dropped} earlier lines were not held`);
      for (const line of held) write(line.at, line.text);
      held = [];
      return true;
    },
  };
}

/** A path that is there but not what the file log needs: said in its own words, not an errno's. */
class Refusal extends Error {}

const lstatOrNull = (path: string): Stats | null => {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

/** `dir`, made 0700 if missing; a directory and not a symlink; set to 0700 when its mode is wider. */
function privateDirectory(dir: string): void {
  if (lstatOrNull(dir) === null) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink()) throw new Refusal(`${dir} is a symlink`);
  if (!stat.isDirectory()) throw new Refusal(`${dir} is not a directory`);
  if ((stat.mode & 0o077) !== 0) chmodSync(dir, 0o700);
}

/** `path`, created 0600 or an existing regular file set to 0600; its size. */
function privateFile(path: string): number {
  const stat = lstatOrNull(path);
  if (stat !== null && !stat.isFile()) throw new Refusal(`${path} is not a regular file`);
  if (stat === null) appendFileSync(path, '', { mode: 0o600 });
  chmodSync(path, 0o600);
  return stat?.size ?? 0;
}
