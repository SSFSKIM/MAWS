// The lock a deployment tool holds for the whole of a run that reads, checks and moves state kept beside it
// (access-sync's checkpoint): two runs that overlap, an operator's retry beside a slow run, in this process or another,
// could each read the state, and the older finish last. The lock is a file created only if absent (a whole copy hard-
// linked into place, so it never exists half written), naming the process that holds it. A lock whose process is gone
// from this host is stale and taken over; any other refuses the run before it starts, naming its holder. The state is
// kept on the operator's machine, so a lock from another host is never judged: the operator removes it.
import { randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';

type Holder = { pid: number; host: string; at: string; token: string };

/** Runs `run` holding the lock `file`; refuses (throws, `run` not called) while another live run holds it. */
export async function withRunLock<T>(file: string, run: () => Promise<T>): Promise<T> {
  const holder = take(file);
  try {
    return await run();
  } finally {
    if (holderOf(file)?.token === holder.token) unlinkSync(file);
  }
}

function take(file: string): Holder {
  mkdirSync(dirname(file), { recursive: true });
  const holder: Holder = { pid: process.pid, host: hostname(), at: new Date().toISOString(), token: randomUUID() };
  const draft = `${file}.${holder.token}`;
  writeFileSync(draft, `${JSON.stringify(holder)}\n`);
  try {
    // A second pass after a stale lock is removed, or after the holder released it between the link and the read.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        linkSync(draft, file);
        return holder;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const held = holderOf(file);
      if (held === null) continue;
      if (!stale(held)) throw new Error(`another run holds ${file} (pid ${held.pid} on ${held.host}, since ${held.at}): wait for it, or remove the file if no run is going`);
      removeStale(file, held);
    }
    throw new Error(`${file} is taken and released over and over: another run is going`);
  } finally {
    unlinkSync(draft);
  }
}

/** The lock's holder; null once it is gone. */
function holderOf(file: string): Holder | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const held = JSON.parse(text) as Holder;
  if (!Number.isSafeInteger(held.pid) || typeof held.host !== 'string' || typeof held.token !== 'string') throw new Error(`${file} is not a run lock: remove it if no run is going`);
  return held;
}

/** A lock taken on this host by a process that no longer runs. */
function stale(held: Holder): boolean {
  if (held.host !== hostname()) return false;
  try {
    process.kill(held.pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

/** Removes the stale lock `held`, unless another run took it over first. */
function removeStale(file: string, held: Holder): void {
  if (holderOf(file)?.token !== held.token) return;
  try {
    unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
