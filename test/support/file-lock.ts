// A lock between the processes of this Mac (concurrent test runs from any checkout): a file created exclusively, its
// holder's pid inside. A waiter polls it, and takes it over once its holder has died (a run killed while holding it).
// Two waiters that find the same dead holder at once could both take it over; it guards test steps, not data.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

export interface FileLockOptions {
  waitMs: number; // how long to wait for a live holder before failing
  pollMs?: number; // default 200
}

// Resolves with the release once the lock is held. Releasing removes the file only while it still names this process.
export async function acquireFileLock(path: string, { waitMs, pollMs = 200 }: FileLockOptions): Promise<() => void> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      writeFileSync(path, String(process.pid), { flag: 'wx' });
      return () => {
        if (holderOf(path) === process.pid) rmSync(path, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const holder = holderOf(path);
    if (holder === null) continue; // released between the two reads
    if (holder > 0 && !alive(holder)) rmSync(path, { force: true });
    else if (Date.now() >= deadline) throw new Error(`the lock ${path} is still held (pid ${holder || 'not yet written'})`);
    else await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

// The pid in the lock file: null with no file, 0 while its holder has created it but not yet written it.
function holderOf(path: string): number | null {
  try {
    return Number(readFileSync(path, 'utf8')) || 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
