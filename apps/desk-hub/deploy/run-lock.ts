// The lock a deployment tool holds for the whole of a run that reads, checks and moves state kept beside it
// (access-sync's checkpoint): two runs that overlap, an operator's retry beside a slow run, in this process or another,
// could each read the state, and the older finish last. The lock is a file created only if absent (a whole copy hard-
// linked into place, so it never exists half written), naming the process that holds it. Any lock already there
// refuses the run before it starts, naming its holder; one left by a run that died is the operator's to remove, after
// checking that nothing runs. A stale lock is never taken over: two runs that each judged it stale could each remove
// it, the second removing the first's fresh one, and no reread makes a removal conditional.
//
// A run ended by a signal releases its lock too: Node's default action for SIGINT, SIGHUP and SIGTERM ends the process
// without running a `finally`, so an `admin pair` interrupted in its wait (Ctrl-C, or its terminal closed) left its lock
// behind. While any lock is held, those signals remove each lock that is still this process's own (by its token) and
// exit with 128 plus the signal's number; once none is held, the handlers go and the signals act as they did before.
import { randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { constants, hostname } from 'node:os';
import { dirname } from 'node:path';

type Holder = { pid: number; host: string; at: string; token: string };

const SIGNALS = ['SIGINT', 'SIGHUP', 'SIGTERM'] as const;
/** The locks this process holds now, each with its release. */
const held = new Set<() => void>();

/** Runs `run` holding the lock `file`; refuses (throws, `run` not called) while any lock is there. */
export async function withRunLock<T>(file: string, run: () => Promise<T>): Promise<T> {
  const holder = take(file);
  const release = () => {
    if (tokenOf(file) === holder.token) unlinkSync(file);
  };
  hold(release);
  try {
    return await run();
  } finally {
    unhold(release);
    release();
  }
}

function hold(release: () => void): void {
  if (held.size === 0) for (const signal of SIGNALS) process.on(signal, stopped);
  held.add(release);
}

function unhold(release: () => void): void {
  held.delete(release);
  if (held.size === 0) for (const signal of SIGNALS) process.off(signal, stopped);
}

/** A signal while a lock is held: each lock this process still holds is released, and the process exits. */
function stopped(signal: NodeJS.Signals): never {
  for (const release of held) {
    try {
      release();
    } catch {
      // Removing it failed (it went from under us): the exit is what the signal asked for.
    }
  }
  process.exit(128 + constants.signals[signal]);
}

function take(file: string): Holder {
  mkdirSync(dirname(file), { recursive: true });
  const holder: Holder = { pid: process.pid, host: hostname(), at: new Date().toISOString(), token: randomUUID() };
  const draft = `${file}.${holder.token}`;
  writeFileSync(draft, `${JSON.stringify(holder)}\n`);
  try {
    linkSync(draft, file);
    return holder;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error(refusal(file), { cause: error });
  } finally {
    unlinkSync(draft);
  }
}

/**
 * The refusal of a lock that is there: its holder as it recorded itself, and what the operator can do. A holder on this
 * host whose process no longer exists is named gone; the file stays the operator's to remove all the same.
 */
function refusal(file: string): string {
  let holder: Partial<Holder>;
  try {
    holder = JSON.parse(readFileSync(file, 'utf8')) as Partial<Holder>;
  } catch (error) {
    const what = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'released just now' : 'not a run lock';
    return `another run holds ${file} (${what}): wait for it, or remove the file once no run is going`;
  }
  const who = `pid ${holder.pid} on ${holder.host}`;
  if (holder.host === hostname() && isGone(holder.pid)) return `another run holds ${file} (${who}, since ${holder.at}): ${who} is gone: remove the file once you've checked no run is going`;
  return `another run holds ${file} (${who}, since ${holder.at}): wait for it, or remove the file once no run is going`;
}

/** Whether no process on this host has the pid (one owned by another user exists: EPERM). */
function isGone(pid: unknown): boolean {
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0) return false;
  try {
    process.kill(pid as number, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

/** The lock's token; null once it is gone, or if it is not a run lock (never this run's, so left as it is). */
function tokenOf(file: string): string | null {
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as Partial<Holder>).token ?? null;
  } catch {
    return null;
  }
}
