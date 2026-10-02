// Which of C10's small sheets is open (C10 execution document, Actions: rename, fork to a new worktree, archive,
// delete, the worktree cleanup, the archived sessions list, and a plain confirmation). One at a time, rendered by
// `SessionDialogs`; opening another replaces the one shown (an unanswered confirmation answers no).
import { create } from 'zustand';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';

// The worktree a cleanup is about, as the session's record names it: the repository (whose root outlives the
// checkout), the checkout's path, and its branch, which stays reachable after the checkout was removed in an earlier
// sitting. The dialog reads git's identity at open and every step revalidates it.
export interface CleanupTarget {
  repoRoot: string;
  path: string;
  branch: string | null;
}

const MANAGED = '/.claude/worktrees/';

// The cleanup target of a worktree: a managed worktree's repository root is the part of its path before
// `.claude/worktrees/`, so it stays valid after the checkout is gone; a hand-made one is asked through `directory`, any
// path inside its repository (main normalises it to the main root).
export function cleanupTargetAt(worktree: { path: string; branch: string | null }, directory: string): CleanupTarget {
  const at = worktree.path.indexOf(MANAGED);
  return { repoRoot: at > 0 ? worktree.path.slice(0, at) : directory, path: worktree.path, branch: worktree.branch };
}

// "Remove worktree…" on a notice about a worktree no session record names yet (a failed attempt's checkout).
export function removeWorktreeAction(target: CleanupTarget): { label: string; run: () => void } {
  return { label: 'Remove worktree…', run: () => openDialog({ kind: 'cleanup', target }) };
}

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  destructive: boolean;
}

// C12 start: the Worktrees… dialog (C12 execution document, Interfaces "Worktrees dialog"). A cleanup it opens returns
// to it when that cleanup closes, which mounts it afresh and so reads the repository again.
export interface WorktreesDialogRef {
  kind: 'worktrees';
  projectId: ProjectId;
}
// C12 end

export type OpenDialog =
  | { kind: 'rename'; appSessionId: AppSessionId }
  | { kind: 'fork'; appSessionId: AppSessionId }
  | { kind: 'archive'; appSessionId: AppSessionId }
  | { kind: 'delete'; appSessionId: AppSessionId }
  | { kind: 'cleanup'; target: CleanupTarget; returnTo?: WorktreesDialogRef } // C12: returnTo, the dialog a close goes back to
  | { kind: 'archived'; projectId: ProjectId }
  | { kind: 'hiddenProjects' } // W11 (I5)
  | WorktreesDialogRef // C12
  | ({ kind: 'confirm'; answer(yes: boolean): void } & ConfirmRequest);

export const useDialogs = create<{ open: OpenDialog | null }>()(() => ({ open: null }));

export function openDialog(dialog: OpenDialog): void {
  const previous = useDialogs.getState().open;
  useDialogs.setState({ open: dialog });
  if (previous?.kind === 'confirm') previous.answer(false);
}

export function closeDialog(): void {
  const previous = useDialogs.getState().open;
  useDialogs.setState({ open: previous?.kind === 'cleanup' ? (previous.returnTo ?? null) : null }); // C12: returnTo
  if (previous?.kind === 'confirm') previous.answer(false);
}

// A plain yes or no, answered once: confirm, cancel, Escape and a replacing dialog all settle it.
export function confirm(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const answer = (yes: boolean) => {
      if (settled) return;
      settled = true;
      resolve(yes);
    };
    openDialog({ kind: 'confirm', ...request, answer });
  });
}
