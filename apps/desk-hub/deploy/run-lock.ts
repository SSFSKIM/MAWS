// The lock a deployment tool holds for the whole of a run that reads, checks and moves state kept beside it
// (access-sync's checkpoint): two runs that overlap, an operator's retry beside a slow run, in this process or another,
// could each read the state, and the older finish last. The lock is a file created only if absent (a whole copy hard-
// linked into place, so it never exists half written), naming the process that holds it. Any lock already there
// refuses the run before it starts, naming its holder; one left by a run that died is the operator's to remove, after
// checking that nothing runs. A stale lock is never taken over: two runs that each judged it stale could each remove
// it, the second removing the first's fresh one, and no reread makes a removal conditional.
import { randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';

type Holder = { pid: number; host: string; at: string; token: string };

/** Runs `run` holding the lock `file`; refuses (throws, `run` not called) while any lock is there. */
export async function withRunLock<T>(file: string, run: () => Promise<T>): Promise<T> {
  const holder = take(file);
  try {
    return await run();
  } finally {
    if (tokenOf(file) === holder.token) unlinkSync(file);
  }
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
    throw new Error(`another run holds ${file} (${described(file)}): wait for it, or remove the file once no run is going`, { cause: error });
  } finally {
    unlinkSync(draft);
  }
}

/** The lock's holder, as it recorded itself. */
function described(file: string): string {
  try {
    const held = JSON.parse(readFileSync(file, 'utf8')) as Partial<Holder>;
    return `pid ${held.pid} on ${held.host}, since ${held.at}`;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'released just now' : 'not a run lock';
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
