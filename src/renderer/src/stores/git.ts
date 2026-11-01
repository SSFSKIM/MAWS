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
// made from a session when a panel has one, by which another machine bounds the checkout read. Main gives a remote
// session's watches back by the session whose feed reopened (src/main/lane-b/remote-checkout.ts), so each session holds
// its own git.watch and git.unwatch (M4's milestone review): one entry per directory, one hold per session on it, its
// diffs named by a session still holding it.
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

// P5 O7 M4: one session's hold on a watched directory (none: a local panel's), its own git.watch and git.unwatch
interface Hold {
  session: AppSessionId | undefined;
  count: number;
  landed: Promise<void>; // the git.watch call settled (unwatch waits for it, or main would count the watch after)
  unanswered: boolean; // git.watch was answered host_unavailable or timeout: the machine could not answer it then
}

interface Watched {
  machine: MachineRef;
  directory: string;
  holds: Map<string, Hold>; // by session ('' for none), in the order they came
  timer: ReturnType<typeof setTimeout> | null;
  diffing: boolean;
  again: boolean; // a change arrived during the diff in flight: run once more when it ends
}

const holdKey = (session: AppSessionId | undefined) => session ?? '';
// The session the entry's reads are made from: the earliest still holding it.
const readerOf = (w: Watched): AppSessionId | undefined => w.holds.values().next().value?.session;

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
      const result = await settled(client.invoke('git.diff', { directory: w.directory, scope: 'all' }, pathTarget(w.machine, readerOf(w))));
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

    // One git.watch for the hold; `landed` follows the latest, so a release unwatches after it.
    const install = (key: string, w: Watched, hold: Hold) => {
      hold.unanswered = false;
      hold.landed = settled(client.invoke('git.watch', { directory: w.directory }, pathTarget(w.machine, hold.session))).then((result) => {
        if (watched.get(key) !== w || w.holds.get(holdKey(hold.session)) !== hold) return;
        if (!result.ok) {
          hold.unanswered = UNANSWERED.has(result.error.code);
          if (get().entries.get(key)?.status) return; // another hold's status stands
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
        if (!w) {
          w = { machine, directory, holds: new Map(), timer: null, diffing: false, again: false };
          watched.set(key, w);
        }
        let hold = w.holds.get(holdKey(session));
        if (hold) hold.count += 1;
        else {
          hold = { session, count: 1, landed: Promise.resolve(), unanswered: false };
          w.holds.set(holdKey(session), hold);
          install(key, w, hold);
        }
        const entry = w;
        const held = hold;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          if (--held.count > 0) return;
          entry.holds.delete(holdKey(session));
          void held.landed.then(() => settled(client.invoke('git.unwatch', { directory }, pathTarget(machine, held.session))));
          if (entry.holds.size > 0) return;
          watched.delete(key);
          if (entry.timer !== null) clearTimeout(entry.timer);
          // Forgotten: a re-mount shows nothing of this mount's branch or sum, and no stale root takes a git.changed.
          set((s) => {
            const entries = new Map(s.entries);
            entries.delete(key);
            return { entries };
          });
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
        for (const [key, w] of watched) if (w.machine === machine) for (const hold of w.holds.values()) if (hold.unanswered) install(key, w, hold);
      },
    };
  });
}

export const useGit = createGitStore(ipc);
