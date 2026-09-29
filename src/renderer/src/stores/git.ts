// The summary's git facts per directory (C8a execution document, Interfaces *Git store*): C4's status through a
// ref-counted `git.watch`, kept current from `git.changed` for its repository root, and the uncommitted change
// (`git.diff { scope: 'all' }`, the working tree against HEAD) for the change line. Main counts watches per root and per
// window, releasing whatever a window holds when it reloads, so this store only has to unwatch symmetrically. It adds
// no trigger of its own: a content change to an already-dirty file emits `git.changed` (C4's watcher compares each
// listed file's size and mtime), so the line is as fresh as the events plus one diff each time a watch starts.
import { create } from 'zustand';
import type { CommandName, CommandResult, EventPayload, MawsBridge } from '@shared/ipc/schema';
import type { GitDiffFile, GitStatus } from '@shared/ipc/schema/git';
import { ipc } from '../ipc/client';

export interface GitEntry {
  root: string | null; // the status's repoRoot; null until git.watch answers, and after it failed
  status: GitStatus | null;
  uncommitted: { files: GitDiffFile[]; at: string } | null; // null until git.diff answers, while the tree is clean, after a failure
  error: string | null; // why the last call failed: git.watch's while there is no status, git.diff's once there is one
}

export interface GitStore {
  entries: Map<string, GitEntry>; // by directory (session.worktree?.path ?? session.directory)
  watch(directory: string): () => void; // ref-counted here; the first watcher invokes git.watch, then git.diff when dirty
  applyChanged(event: EventPayload<'git.changed'>): void; // every watched directory of the root takes the status and re-runs git.diff
}

export const GIT_DIFF_DELAY_MS = 250; // trailing debounce of the diffs git.changed schedules

interface Watched {
  count: number;
  landed: Promise<void>; // the git.watch call settled (unwatch waits for it, or main would count the watch after)
  timer: ReturnType<typeof setTimeout> | null;
  diffing: boolean;
  again: boolean; // a change arrived during the diff in flight: run once more when it ends
}

const EMPTY: GitEntry = { root: null, status: null, uncommitted: null, error: null };

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
  const watched = new Map<string, Watched>();

  return create<GitStore>()((set, get) => {
    const patch = (directory: string, next: Partial<GitEntry>) =>
      set((s) => ({ entries: new Map(s.entries).set(directory, { ...(s.entries.get(directory) ?? EMPTY), ...next }) }));

    const diff = async (directory: string) => {
      const w = watched.get(directory);
      if (!w) return;
      if (w.diffing) {
        w.again = true;
        return;
      }
      w.diffing = true;
      const result = await settled(client.invoke('git.diff', { directory, scope: 'all' }));
      w.diffing = false;
      if (watched.get(directory) !== w) return; // released meanwhile
      if (get().entries.get(directory)?.status?.dirty) {
        if (result.ok) patch(directory, { uncommitted: { files: result.value.files, at: new Date().toISOString() }, error: null });
        else patch(directory, { uncommitted: null, error: result.error.message });
      }
      if (w.again) {
        w.again = false;
        void diff(directory);
      }
    };

    const schedule = (directory: string, w: Watched) => {
      if (w.timer !== null) clearTimeout(w.timer);
      w.timer = setTimeout(() => {
        w.timer = null;
        void diff(directory);
      }, delay);
    };

    // A new status for a watched directory: a dirty tree needs a (fresh) sum, a clean one none.
    const take = (directory: string, status: GitStatus) => {
      patch(directory, { root: status.repoRoot, status, error: null, ...(status.dirty ? {} : { uncommitted: null }) });
    };

    return {
      entries: new Map(),

      watch(directory) {
        let w = watched.get(directory);
        if (w) w.count += 1;
        else {
          const created: Watched = { count: 1, landed: Promise.resolve(), timer: null, diffing: false, again: false };
          w = created;
          watched.set(directory, created);
          created.landed = settled(client.invoke('git.watch', { directory })).then((result) => {
            if (watched.get(directory) !== created) return;
            if (!result.ok) return patch(directory, { root: null, status: null, uncommitted: null, error: result.error.message });
            take(directory, result.value);
            if (result.value.dirty) void diff(directory);
          });
        }
        const held = w;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          if (--held.count > 0) return;
          watched.delete(directory);
          if (held.timer !== null) clearTimeout(held.timer);
          // Forgotten: a re-mount shows nothing of this mount's branch or sum, and no stale root takes a git.changed.
          set((s) => {
            const entries = new Map(s.entries);
            entries.delete(directory);
            return { entries };
          });
          void held.landed.then(() => settled(client.invoke('git.unwatch', { directory })));
        };
      },

      applyChanged({ repoRoot, status }) {
        for (const [directory, w] of watched) {
          if (get().entries.get(directory)?.root !== repoRoot) continue;
          take(directory, status);
          if (status.dirty) schedule(directory, w);
        }
      },
    };
  });
}

export const useGit = createGitStore(ipc);
