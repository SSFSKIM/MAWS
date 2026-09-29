// The git detail of the Store section (C4 execution document, M6; acceptance item 8): one selected session directory
// is watched through `git.watch` (main ref-counts it per repository root) and its status kept current from `git.changed`
// for that root. Selecting another directory, clearing the selection or disconnecting releases the watch; a watch that
// answers after the selection moved on is released at once, so the page never leaves a root watched.
import { create } from 'zustand';
import type { MawsBridge } from '@shared/ipc/schema';
import type { GitFileStatus, GitStatus } from '@shared/ipc/schema/git';
import { ipc } from '../ipc/client';

export interface GitDiagnosticsStore {
  directory: string | null; // the selected session's directory (its worktree path when it has one)
  status: GitStatus | null; // null until git.watch answers, and after a failure
  error: string | null; // why the watch failed (`not a git repository`, …)
  connect(): () => void;
  select(directory: string | null): Promise<void>;
}

export function createGitDiagnosticsStore(client: MawsBridge) {
  // The directory whose watch main is holding for this page, if any.
  let held: string | null = null;
  const release = () => {
    if (held === null) return;
    const directory = held;
    held = null;
    void client.invoke('git.unwatch', { directory });
  };

  return create<GitDiagnosticsStore>()((set, get) => ({
    directory: null,
    status: null,
    error: null,
    connect() {
      const off = client.on('git.changed', ({ repoRoot, status }) => {
        if (get().status?.repoRoot === repoRoot) set({ status });
      });
      return () => {
        off();
        release();
        set({ directory: null, status: null, error: null });
      };
    },
    async select(directory) {
      release();
      set({ directory, status: null, error: null });
      if (directory === null) return;
      const result = await client.invoke('git.watch', { directory });
      if (!result.ok) {
        if (get().directory === directory) set({ error: result.error.message });
        return;
      }
      if (get().directory !== directory || held !== null) {
        void client.invoke('git.unwatch', { directory }); // the selection moved on while this watch was in flight
        return;
      }
      held = directory;
      set({ status: result.value });
    },
  }));
}

// `main · ahead 2 / behind 1 · dirty · 3 files`, the acceptance's reading of branch, ahead/behind and the dirty count.
export function describeGit(status: GitStatus): string {
  const branch = status.branch ?? `detached ${status.head.slice(0, 7)}`;
  const tracking = status.upstream === null ? 'no upstream' : `ahead ${status.ahead} / behind ${status.behind}`;
  const count = status.files.length;
  const tree = status.dirty ? `dirty · ${count} ${count === 1 ? 'file' : 'files'}` : 'clean';
  return `${branch} · ${tracking} · ${tree}`;
}

// `.M src/a.ts`, `?? notes.txt`, `R. old.ts → new.ts`: porcelain's XY code, then the path.
export function describeGitFile(file: GitFileStatus): string {
  return `${file.index}${file.worktree} ${file.oldPath === null ? '' : `${file.oldPath} → `}${file.path}`;
}

export const useGitDiagnostics = createGitDiagnosticsStore(ipc);
