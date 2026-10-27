// The git detail of the Store section (C4 execution document, M6; acceptance item 8): one selected session directory
// is watched through `git.watch` (main ref-counts it per repository root) and its status kept current from `git.changed`
// for that root. Selecting another directory, clearing the selection or disconnecting releases the watch; a watch that
// answers after the selection moved on is released at once, so the page never leaves a root watched.
// P5 O6 M4: the directory is its session's machine's, which every call names and whose `git.changed` alone it takes.
import { create } from 'zustand';
import type { MawsBridge } from '@shared/ipc/schema';
import type { GitFileStatus, GitStatus } from '@shared/ipc/schema/git';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';

export interface GitCheckout {
  machine: MachineRef;
  directory: string;
}

export interface GitDiagnosticsStore {
  selected: GitCheckout | null; // the selected session's directory (its worktree path when it has one) on its machine
  status: GitStatus | null; // null until git.watch answers, and after a failure
  error: string | null; // why the watch failed (`not a git repository`, …)
  connect(): () => void;
  select(checkout: GitCheckout | null): Promise<void>;
}

const same = (a: GitCheckout | null, b: GitCheckout | null) => a?.machine === b?.machine && a?.directory === b?.directory;

export function createGitDiagnosticsStore(client: MawsBridge) {
  // The directory whose watch main is holding for this page, if any.
  let held: GitCheckout | null = null;
  const unwatch = ({ machine, directory }: GitCheckout) => void client.invoke('git.unwatch', { directory }, { machine });
  const release = () => {
    if (held === null) return;
    const checkout = held;
    held = null;
    unwatch(checkout);
  };

  return create<GitDiagnosticsStore>()((set, get) => ({
    selected: null,
    status: null,
    error: null,
    connect() {
      const off = client.on('git.changed', ({ repoRoot, status }, { machine }) => {
        if (get().selected?.machine === machine && get().status?.repoRoot === repoRoot) set({ status });
      });
      return () => {
        off();
        release();
        set({ selected: null, status: null, error: null });
      };
    },
    async select(checkout) {
      release();
      set({ selected: checkout, status: null, error: null });
      if (checkout === null) return;
      const result = await client.invoke('git.watch', { directory: checkout.directory }, { machine: checkout.machine });
      if (!result.ok) {
        if (same(get().selected, checkout)) set({ error: result.error.message });
        return;
      }
      if (!same(get().selected, checkout) || held !== null) {
        unwatch(checkout); // the selection moved on while this watch was in flight
        return;
      }
      held = checkout;
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
