// The summary's git facts per directory (C8a execution document, Interfaces *Git store*): C4's status through a
// ref-counted `git.watch`, kept current from `git.changed` for its repository root, and the uncommitted change
// (`git.diff { scope: 'all' }`, the working tree against HEAD) for the change line. Main counts watches per root and per
// window, releasing whatever a window holds when it reloads, so this store only has to unwatch symmetrically. It adds
// no trigger of its own: a content change to an already-dirty file emits `git.changed` (C4's watcher compares each
// listed file's size and mtime), so the line is as fresh as the events plus one diff each time a watch starts.
// P5 O6 M4 (docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "Path-keyed stores"): a directory is a machine's,
// so entries key by `checkoutKey(machine, directory)`, every call goes to that machine, and a `git.changed` reaches only
// the directories of the machine it came from.
// P5 O3-E (the final review of docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, D25): on the daemon shape main's
// watch replay answers a git.watch `host_unavailable` while the machine host is crashed and `timeout` at the command's
// budget, rather than holding it until the host comes back. Such a watch is asked again whenever that machine's
// `host.status` is heard (main emits one after re-reading the daemon at each ready of the machine host), so the
// Environment row recovers with the host's restart; a re-ask while the host is still down is answered at once.
// P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The checkout rule and its boundary"): a watch is
// made from a session when a panel has one, and every call of the watch (its git.watch, diffs, re-asks and git.unwatch)
// names the session of its first watcher, by which another machine bounds the checkout read and counts the watch.
import { create } from 'zustand';
import type { CommandName, CommandResult, EventPayload, MawsBridge } from '@shared/ipc/schema';
import type { GitDiffFile, GitStatus } from '@shared/ipc/schema/git';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { checkoutKey, pathTarget } from '../ipc/machine';

export interface GitEntry {
  root: string | null; // the status's repoRoot; null until git.watch answers, and after it failed
  status: GitStatus | null;
  uncommitted: { files: GitDiffFile[]; at: string } | null; // null until git.diff answers, while the tree is clean, after a failure
  error: string | null; // why the last call failed: git.watch's while there is no status, git.diff's once there is one
}

export interface GitStore {
  entries: Map<string, GitEntry>; // by checkoutKey(machine, session.worktree?.path ?? session.directory)
  watch(machine: MachineRef, directory: string, session?: AppSessionId): () => void; // ref-counted here; the first watcher invokes git.watch, then git.diff when dirty
  applyChanged(event: EventPayload<'git.changed'>, machine: MachineRef): void; // every watched directory of the root on that machine takes the status and re-runs git.diff
  retryUnanswered(machine: MachineRef): void; // that machine's host was heard again (host.status): its watches it could not answer are asked again
}

export const GIT_DIFF_DELAY_MS = 250; // trailing debounce of the diffs git.changed schedules

interface Watched {
  machine: MachineRef;
  directory: string;
  session: AppSessionId | undefined; // P5 O7 M4: the first watcher's session, named on every call of this watch
  count: number;
  landed: Promise<void>; // the git.watch call settled (unwatch waits for it, or main would count the watch after)
  timer: ReturnType<typeof setTimeout> | null;
  diffing: boolean;
  again: boolean; // a change arrived during the diff in flight: run once more when it ends
  unanswered: boolean; // git.watch was answered host_unavailable or timeout: the machine could not answer it then
}

const EMPTY: GitEntry = { root: null, status: null, uncommitted: null, error: null };
const UNANSWERED: ReadonlySet<string> = new Set(['host_unavailable', 'timeout']); // the machine could not answer: ask again when it is heard

// A bridge that throws (not a command's failure answer) is a failure too, with its message, so nothing stays in flight
// and nothing escapes as an unhandled rejection.
async function settled<N extends CommandName>(call: Promise<CommandResult<N>>): Promise<CommandResult<N>> {
  try {
    return await call;
  } catch (error) {
    return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } };
  }
}

export function createGitStore(client: MawsBridge, options: { diffDelayMs?: number } = {}) {
  const delay = options.diffDelayMs ?? GIT_DIFF_DELAY_MS;
  const watched = new Map<string, Watched>(); // by checkoutKey

  return create<GitStore>()((set, get) => {
    const patch = (key: string, next: Partial<GitEntry>) =>
      set((s) => ({ entries: new Map(s.entries).set(key, { ...(s.entries.get(key) ?? EMPTY), ...next }) }));

    const diff = async (key: string) => {
      const w = watched.get(key);
      if (!w) return;
      if (w.diffing) {
        w.again = true;
        return;
      }
      w.diffing = true;
      const result = await settled(client.invoke('git.diff', { directory: w.directory, scope: 'all' }, pathTarget(w.machine, w.session)));
      w.diffing = false;
      if (watched.get(key) !== w) return; // released meanwhile
      if (get().entries.get(key)?.status?.dirty) {
        if (result.ok) patch(key, { uncommitted: { files: result.value.files, at: new Date().toISOString() }, error: null });
        else patch(key, { uncommitted: null, error: result.error.message });
      }
      if (w.again) {
        w.again = false;
        void diff(key);
      }
    };

    const schedule = (key: string, w: Watched) => {
      if (w.timer !== null) clearTimeout(w.timer);
      w.timer = setTimeout(() => {
        w.timer = null;
        void diff(key);
      }, delay);
    };

    // A new status for a watched directory: a dirty tree needs a (fresh) sum, a clean one none.
    const take = (key: string, status: GitStatus) => {
      patch(key, { root: status.repoRoot, status, error: null, ...(status.dirty ? {} : { uncommitted: null }) });
    };

    // One git.watch for the directory; `landed` follows the latest, so a release unwatches after it.
    const install = (key: string, w: Watched) => {
      w.unanswered = false;
      w.landed = settled(client.invoke('git.watch', { directory: w.directory }, pathTarget(w.machine, w.session))).then((result) => {
        if (watched.get(key) !== w) return;
        if (!result.ok) {
          w.unanswered = UNANSWERED.has(result.error.code);
          return patch(key, { root: null, status: null, uncommitted: null, error: result.error.message });
        }
        take(key, result.value);
        if (result.value.dirty) void diff(key);
      });
    };

    return {
      entries: new Map(),

      watch(machine, directory, session) {
        const key = checkoutKey(machine, directory);
        let w = watched.get(key);
        if (w) w.count += 1;
        else {
          w = { machine, directory, session, count: 1, landed: Promise.resolve(), timer: null, diffing: false, again: false, unanswered: false };
          watched.set(key, w);
          install(key, w);
        }
        const held = w;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          if (--held.count > 0) return;
          watched.delete(key);
          if (held.timer !== null) clearTimeout(held.timer);
          // Forgotten: a re-mount shows nothing of this mount's branch or sum, and no stale root takes a git.changed.
          set((s) => {
            const entries = new Map(s.entries);
            entries.delete(key);
            return { entries };
          });
          void held.landed.then(() => settled(client.invoke('git.unwatch', { directory }, pathTarget(machine, held.session))));
        };
      },

      applyChanged({ repoRoot, status }, machine) {
        for (const [key, w] of watched) {
          if (w.machine !== machine || get().entries.get(key)?.root !== repoRoot) continue;
          take(key, status);
          if (status.dirty) schedule(key, w);
        }
      },

      retryUnanswered(machine) {
        for (const [key, w] of watched) if (w.machine === machine && w.unanswered) install(key, w);
      },
    };
  });
}

export const useGit = createGitStore(ipc);
