// P5 O3-G (research/org/p5-o3-linux-repo-watch.md): two recursive watches in one process whose trees overlap, as
// watcher.ts makes them for a checkout and a linked worktree nested in it (`.claude/worktrees/<name>`, the worktree's
// own root and its common dir, which is the checkout's `.git`). What the kernel and the process pay for the second.
//   node --expose-gc overlap.mjs <checkout> <nested worktree>
import { watch, readdirSync, readlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const watches = () => { let w = 0; for (const fd of readdirSync('/proc/self/fd')) { try { if (readlinkSync('/proc/self/fd/' + fd) === 'anon_inode:inotify') w += readFileSync('/proc/self/fdinfo/' + fd, 'utf8').split('\n').filter((l) => l.startsWith('inotify wd:')).length; } catch {} } return w; };
const rss = () => { globalThis.gc?.(); return +(process.memoryUsage().rss / 2 ** 20).toFixed(1); };
const [checkout, worktree] = process.argv.slice(2);
const steps = [{ step: 'start', watches: watches(), rssMiB: rss() }];
const a = watch(checkout, { recursive: true }, () => {});
steps.push({ step: 'checkout', watches: watches(), rssMiB: rss() });
const b = watch(worktree, { recursive: true }, () => {});
steps.push({ step: 'worktree root', watches: watches(), rssMiB: rss() });
const c = watch(join(checkout, '.git'), { recursive: true }, () => {});
steps.push({ step: 'common dir', watches: watches(), rssMiB: rss() });
console.log(JSON.stringify(steps));
a.close(); b.close(); c.close();
