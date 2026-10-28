# P5 O3-G: the recursive repository watch on Linux (measured)

> **Cites** `docs/doperpowers/plans/2026-10-28-p5-o3-spine.md`, child **O3-G**, document blob `67da2f63a992c9c6f6369ffe1ff3fc7605999c89` at master `1d1d71937`; parent `docs/doperpowers/plans/2026-10-27-p5-org.md` (P5). Findings only, never a merge. 2026-10-28.
>
> **Question** (headless-cut survey §2 item 5, inferred there): git's watcher (`src/main/git/watcher.ts`) takes one recursive `fs.watch` per repository root, plus its git dir when it lies outside the root and, for a linked worktree, the common dir (`:321`, `:335`, `:348`). O3-E moves it into `mawsd`, which runs on the devcloud VMs. What do inotify's limits and costs make of that on Linux?

## Recommendation for O3-E

**Ignore rules, applied by a directory-level watch that MAWS owns, not by Node's recursive call.** On Linux, replace the three `watch(…, { recursive: true })` calls with a watch tree that:

1. puts one non-recursive `fs.watch` on each directory, never on a file (inotify names a directory's changed children, which is all the watcher's classifiers read);
2. never walks what git ignores (`git ls-files -o -i --exclude-standard --directory` at start, `git check-ignore` for a directory created later) nor, inside the git dir, `.git/objects` and `.git/lfs` (what was measured). The prune predicate is not `classifyGitPath`'s null: it must keep every ancestor of a classified path and the paths read before classification. `refs/` itself classifies null though the refs under it matter (`src/main/git/watcher.ts:54`), and the linked worktrees' registrations under `worktrees/` are read by `registration` before any classification (`:314-317`);
3. walks asynchronously and adds a directory from its parent's creation event, so the event loop is never held for a tree;
4. treats ENOSPC or EMFILE from a watch call as that root's exhaustion: close its partial tree, poll `git status` for it (5 to 10 s, with the backoff `watcher.ts` already applies after a status timeout), and say so in the root's status;
5. reconciles on its own, since Node cannot report an inotify queue overflow. libuv looks each event up by its watch descriptor and skips the ones it does not know ([`deps/uv/src/unix/linux.c` L2617-L2619](https://github.com/nodejs/node/blob/v24.21.0/deps/uv/src/unix/linux.c#L2617-L2619)), and the kernel's `IN_Q_OVERFLOW` carries descriptor -1, so an overflow is dropped without a callback. So while a root is watched, the tree re-walks it for directories it does not watch yet and runs one status, on a slow timer and at once after a burst (many events in a short window). It keeps treating an event with no filename as a rescan plus one status, as `changed(root, 'worktree')` already does for the status, but only as a precaution. The 40,000-file run below shows only that no overflow happened there, not that one would be seen.

macOS keeps the recursive call: there it is one native FSEvents stream per root. The engine host's store watcher (`src/engine-host/fs/watcher.ts:137`) makes the same recursive call over `projects/`, `jobs/` and `tasks/` and has the same costs on Linux today (below), so the tree belongs in one shared module both use.

Leave `devenv/setup.sh` alone for MAWS's sake: with directory watches the image's default 64,104 is ample (MAWS's checkout needs 1,081 watches under git's rules, the Linux kernel's tree 6,359). Raising the limit would not touch the costs that matter: memory and event-loop stalls, which the limit does not bound. If another tool on the VMs needs more (VS Code's guidance is 524,288), that is a separate devenv decision.

Why the other three are not the answer:
- **Ignore rules on Node's recursive call** (its `ignore` option, documented in 24.21.0) fix the budget and the memory, 52,174 watches and 171 MiB down to 10,452 and 30 MiB for MAWS, but not the stalls: 2,000 files created in one directory still held the loop 35 to 40 s and their removal 7 s, because the cost is per event times directory size and per removal times every watched path.
- **A cap** would refuse or degrade the common case (MAWS's own checkout with `node_modules`, 81% of the per-user budget), and does nothing for the stalls a 10,000-entry repository already has.
- **Polling** costs a `git status` per root per tick: 45 ms for MAWS, 392 ms for the Linux kernel's tree, warm. It is the right fallback at exhaustion, not the design.

## What the recursive call is on Linux

Node 24.21.0, the runtime O2 pins for `mawsd` on Linux (`packaging/mawsd/node.json` on O2's branch, `origin/p5-o2`; master carries no Linux runtime yet), implements `fs.watch(dir, { recursive: true })` on Linux in JavaScript, [`lib/internal/fs/recursive_watch.js`](https://github.com/nodejs/node/blob/v24.21.0/lib/internal/fs/recursive_watch.js) (libuv has no recursive inotify watch):

- **A watch per file as well as per directory.** `#watchFolder` walks with `readdirSync` and calls `#watchFile` on every entry, which `statSync`s it, keeps the `Stats` and opens a non-recursive `fs.watch` on it ([L121-L167](https://github.com/nodejs/node/blob/v24.21.0/lib/internal/fs/recursive_watch.js#L121-L167), [L169-L220](https://github.com/nodejs/node/blob/v24.21.0/lib/internal/fs/recursive_watch.js#L169-L220)). libuv shares one inotify instance per process and one watch per inode, so the kernel count is the distinct inodes; Node's own count is every path.
- **Synchronous.** The whole walk runs inside the `fs.watch` call ([L222-L240](https://github.com/nodejs/node/blob/v24.21.0/lib/internal/fs/recursive_watch.js#L222-L240)); the event loop is held for it.
- **A rescan per event.** Any event on a directory re-runs `#watchFolder` on it: a `readdirSync` of the whole directory and a `path.relative` per entry ([L213](https://github.com/nodejs/node/blob/v24.21.0/lib/internal/fs/recursive_watch.js#L213), [L135](https://github.com/nodejs/node/blob/v24.21.0/lib/internal/fs/recursive_watch.js#L135)). n files created one by one in a directory cost O(n²).
- **A full scan per removal.** A removed entry runs `#unwatchFiles`, which iterates every watched path ([L107-L119](https://github.com/nodejs/node/blob/v24.21.0/lib/internal/fs/recursive_watch.js#L107-L119)).
- **Errors in the walk vanish.** A failed watch in the walk is emitted as `'error'` ([L164](https://github.com/nodejs/node/blob/v24.21.0/lib/internal/fs/recursive_watch.js#L164)) before any listener can exist; the throw that makes is caught by `kFSWatchStart`, which rethrows only ENOENT ([L237](https://github.com/nodejs/node/blob/v24.21.0/lib/internal/fs/recursive_watch.js#L237)). `fs.watch` attaches the change listener only after the walk ([`lib/fs.js` L2602-L2618](https://github.com/nodejs/node/blob/v24.21.0/lib/fs.js#L2602-L2618)), and `watcher.ts` attaches its `'error'` listener after the call returns.

## Where and how it was measured

- **Host.** devcloud VM `dc-o3spikes-b0eb`: GCE `e2-custom-4-8192` (4 vCPU, 8 GB), us-west1-b, the devcloud image (Ubuntu 24.04, kernel 7.0.0-1014-gcp). Leased 6 h, deleted after the recording.
- **Runtime.** Node 24.21.0 linux-x64 from nodejs.org, its sha256 checked against O2's `node.json`.
- **Trees.**
  - MAWS at master `1d1d71937` as devcloud clones it, with `node_modules` from `pnpm install --frozen-lockfile`, which O2's `devenv/setup.sh` runs on Linux: 58,034 entries, 5,903 directories, 47,571 entries in `node_modules`.
  - The same as a bare clone: 10,398 entries, 1,082 directories.
  - `torvalds/linux` at `65ba8f34e`, depth 1: 103,664 entries, 6,359 directories.
  - A synthetic store: one project directory of 5,000 transcripts and one of 200.
- **One fresh process per measurement.** `spikes/linux-repo-watch/watch-measure.mjs` counts the process's inotify watches from `/proc/self/fdinfo`. It measures:
  - RSS and heap with forced GC, and the time the call holds the loop;
  - notification latency, 30 writes per site: the root, the deepest directory, the largest directory, and a directory made after the watch;
  - idle CPU;
  - bursts: another process writes, then removes, n files in one new directory; the measure is the time until every burst file has been named by an event (timed by that event), this process's CPU, and its worst event-loop lag.
- **The alternative, measured beside it.** `--mode dirs` is the directory-tree sketch the recommendation describes.
- **Other scripts.** `inotify-census.sh` counts instances and watches per user and process. `overlap.mjs` measures overlapping roots. Raw output: `spikes/linux-repo-watch/results.json`.

## The image's limits

| | Value |
|---|---|
| `max_user_watches` | **64,104**: the kernel's default from RAM. No `sysctl.d` override on the image. |
| `max_user_instances` | **128** |
| `max_queued_events` | **16,384** |
| Already held by the owner's user | 3 instances, 11 watches (`systemd --user`) |
| One idle engine 2.1.283 process | 1 instance, 5 watches |

Both limits are per user. On a VM, `mawsd`, the engine host, every engine and the owner's other tools draw on one budget, so exhausting it breaks watching for all of them, not only for MAWS.

## Results

Each burst cell gives the event loop's worst lag (the longest the daemon could not answer anything), then in parentheses the time until every burst file had been named by an event. In the Node-recursive rows the lag is the whole time: the work is all synchronous.

| Tree | Call | Watches (share of 64,104) | Loop held at start | RSS | 200 / 2,000 created | 200 / 2,000 removed |
|---|---|---|---|---|---|---|
| MAWS + `node_modules` | Node recursive | 52,174 (81%) | 1.4 s | 171 MiB | 0.36 s / **32.9 s** | 3.3 s / **33.4 s** |
| MAWS, `ignore`: node_modules, out, dist, worktrees, `.git/objects` | Node recursive | 10,452 | 0.31 s | 30 MiB | 0.36 s / **35.5 s** | 0.65 s / 6.8 s |
| MAWS, `ignore`: what git ignores | Node recursive | 10,446 | 0.29 s | 30 MiB | 0.39 s / **40.4 s** | 0.60 s / 7.0 s |
| MAWS bare clone | Node recursive | 10,398 | 0.27 s | 30 MiB | 0.29 s / **30.0 s** | 0.47 s / 5.4 s |
| Linux kernel | Node recursive | 64,093 (**exhausted**) | 1.7 s | 188 MiB | | |
| Linux kernel, limit raised to 1,048,576 | Node recursive | 103,558 (162%) | 2.4 s | 278 MiB | 0.31 s / | 3.9 s / |
| MAWS + `node_modules` | directory tree | 5,903 (9%) | 0 | 13 MiB | 4 ms (0.09 s) / 20 ms (0.37 s) | 5 ms (0.07 s) / 40 ms (0.18 s) |
| MAWS, what git ignores | directory tree | 1,081 (2%) | 0 | 1 MiB | 12 ms (0.07 s) / 104 ms (0.37 s) | 7 ms (0.07 s) / 179 ms (0.24 s) |
| Linux kernel | directory tree | 6,359 (10%) | 0 | 14 MiB | 2 ms (0.06 s) / 19 ms (0.23 s) | 2 ms (0.07 s) / 114 ms (0.22 s) |

Other measurements:

- **Notification latency** (p50, then p95):
  - Recursive: 0.4 to 1.1 ms in small directories. But every event re-reads its directory:
    - a write to a file in a 1,188-entry directory (`node_modules/es-toolkit/compat`): 7.0 ms (7.5 ms);
    - one in the kernel tree's largest directory: 7.4 ms (8.6 ms);
    - one in a 5,000-entry directory: 20 ms (27 ms);
    - a new file there: 4.6 ms.
  - Directory tree: 0.3 to 0.4 ms (at most 3.5 ms) whatever the directory's size.
  - None of the 1,960 timed writes outside the exhaustion runs was missed.
- **Idle.** 9 to 15 ms of CPU per 10 to 20 s, with no events, for either call: inotify does not poll.
- **A 40,000-file burst against the tree** (`max_queued_events` 16,384). Every one of the 40,000 files was named within 3.97 s, with a worst lag of 174 ms; 80,000 events in all (two per created file). Removing the 40,000 files lagged 1.4 s, from the sketch's one `lstat` per event; a real implementation can skip that for names that are known files. No overflow happened here, which says nothing about whether one would be seen (recommendation item 5).
- **Overlapping roots.** MAWS puts session worktrees at `.claude/worktrees/<name>`, inside the checkout.
  - The checkout's recursive watch takes them all in: one nested worktree took the bare checkout from 10,398 to 20,765 watches.
  - The worktree's own recursive watch and its common dir's added no kernel watch (one per inode per process) but 33 MiB of RSS.
  - With `node_modules` in each, two worktrees exhaust the budget.
  - `.claude/worktrees/` is in MAWS's `.gitignore`, so git's rules drop them from the checkout's tree, and each worktree is its own root.
- **Memory.** 2.7 to 3.4 KiB of RSS per watched path for the recursive call (a `Stats` object and an `FSWatcher` per path), against 0.9 to 2.3 KiB per watched directory for the tree.
  - For scale only: one recursive watch of MAWS's own checkout (171 MiB) is larger than the whole idle footprint P5 allows `mawsd` (101,113 KiB, acceptance 14 and P5 Decision Log 101; a Mac physical-footprint bound, not a Linux one).

## What the watcher sees at exhaustion

| Limit hit | Node's recursive call | The directory tree |
|---|---|---|
| Watches, at start | Nothing: no throw, no `'error'`. The walk stops at the first failed watch, and the call returns a watch over the part already walked (the Linux kernel: 64,093 watches; writes in 9 of 20 directories sampled across the walk, the later ones, were never reported). | The watch call throws ENOSPC at the directory where it happens (measured at a limit of 600), so the root knows it is partial. |
| Watches, later | ENOSPC `'error'` events appear only when something changes in a watched directory next to entries it could not watch: once per such event, naming the entry the rescan tried. In a directory the walk did watch, a new file's creation is reported, since the rename is emitted before its watch is tried ([L142-L150](https://github.com/nodejs/node/blob/v24.21.0/lib/internal/fs/recursive_watch.js#L142-L150)). Its watch then fails with an `'error'`, and every later change to that file is silent: modifications were missed 10 of 10 at the root and 10 of 10 in the deepest directory. Nothing is reported in a directory the walk never reached: the largest directory, `include/linux`, missed 10 of 10 creations; so did a directory made after the start. A rescan stops at the first entry it cannot watch, so a new entry after such an entry in `readdir` order would also go unreported; that is inferred from the source, not measured on its own. `watcher.ts` logs a warning, and `git.changed` stays silent for the dark part. | The same throw, at the new directory. |
| Instances (`max_user_instances` at the user's count) | Nothing at all: 0 instances, 0 watches, no throw, no `'error'` ever; no write anywhere was reported. | The first watch call throws EMFILE. |

So on Linux today the answer is **silence**. At exhaustion the watch is partial (or, out of instances, empty) and says so nowhere at the start. Then:
- the directories the walk never reached report nothing;
- in the walked ones, a new file is announced once and is silent after;
- errors come late, naming whatever entry a rescan happened to try.

Only a watch made directory by directory surfaces the failure where a caller can act on it.

## Adjacent: the engine host's store watcher

`src/engine-host/fs/watcher.ts:137` opens the same recursive call over the engine's store. On a Linux host that means:

- one watch, and about 3 KiB, per transcript, sidecar and tool result;
- a re-read of a project directory on every append to one of its transcripts: 20 ms (p50) per write in a 5,000-transcript directory in the synthetic store, against 0.4 ms for the tree, with 5,203 watches against 3;
- a busy owner's `~/.claude/projects` runs to thousands of files.

This already runs wherever O2 puts the engine host on Linux. O3-E's tree should serve this watcher too. Whether that change is O3-E's or the engine host's own is for O3-E's plan; it is recorded here because the measurement is the same.

## Rerunning

On a Linux VM, with Node 24.21.0 (Linux only; it reads `/proc`):

```
node --expose-gc spikes/linux-repo-watch/watch-measure.mjs <root> [--mode recursive|dirs] [--ignore none|maws|git] \
  [--latency 30] [--idle 20] [--churn 200,2000] [--probe-unwatched]
sudo bash spikes/linux-repo-watch/inotify-census.sh
node --expose-gc spikes/linux-repo-watch/overlap.mjs <checkout> <checkout>/.claude/worktrees/<name>
```

Exhaustion runs lower the limit around one measurement (`sudo sysctl -w fs.inotify.max_user_watches=600`, or `fs.inotify.max_user_instances=<the user's count>`) and restore it afterwards. In `results.json`, the four MAWS recursive rows predate the script's `mode` field, so they carry none. From the overlap run on, `maws-bare` carried one linked worktree at `.claude/worktrees/wt1`.

The burst's completion rule was fixed after review. A burst is now complete when every burst file has been named by an event, timed by that event; the count was first a threshold on raw callbacks, which the directory tree reaches at half the files, since it gives two callbacks per created file. The four directory-tree runs with bursts were re-recorded with the fixed rule, and their figures above are the re-recordings: `maws-nm-dirs`, `maws-nm-dirs-git`, `linux-dirs` and `maws-bare-dirs-overflow`. The recursive call gives one callback per burst file, so the recursive runs' figures stand as first recorded.
