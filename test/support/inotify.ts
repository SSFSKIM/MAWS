// The inotify instances and watches this process holds, read from /proc/self/fdinfo as O3-G's measure read them
// (spikes/linux-repo-watch/watch-measure.mjs). Linux only.
import { readdirSync, readFileSync, readlinkSync } from 'node:fs';

export function inotifyOf(): { instances: number; watches: number } {
  let instances = 0;
  let watches = 0;
  for (const fd of readdirSync('/proc/self/fd')) {
    let target: string;
    try {
      target = readlinkSync(`/proc/self/fd/${fd}`);
    } catch {
      continue; // closed meanwhile (readdir's own descriptor among them)
    }
    if (target !== 'anon_inode:inotify') continue;
    instances++;
    try {
      watches += readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8').split('\n').filter((line) => line.startsWith('inotify wd:')).length;
    } catch {
      // closed meanwhile
    }
  }
  return { instances, watches };
}

// Polls `check` every 5 ms; answers how long it took, or throws once `withinMs` passed.
export async function until(check: () => boolean, withinMs: number, what: string): Promise<number> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > withinMs) throw new Error(`${what}: not within ${withinMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return Date.now() - start;
}
