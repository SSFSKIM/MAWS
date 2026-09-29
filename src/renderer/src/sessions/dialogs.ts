// Which of C10's small sheets is open (C10 execution document, Actions: rename, fork to a new worktree, archive,
// delete, the worktree cleanup, the archived sessions list, and a plain confirmation). One at a time, rendered by
// `SessionDialogs`; opening another replaces the one shown (an unanswered confirmation answers no).
import { create } from 'zustand';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';

// The worktree a cleanup is about, as git reported it when the dialog was asked for (every step revalidates it).
export interface CleanupTarget {
  repoRoot: string;
  path: string;
}

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  destructive: boolean;
}

export type OpenDialog =
  | { kind: 'rename'; appSessionId: AppSessionId }
  | { kind: 'fork'; appSessionId: AppSessionId }
  | { kind: 'archive'; appSessionId: AppSessionId }
  | { kind: 'delete'; appSessionId: AppSessionId }
  | { kind: 'cleanup'; target: CleanupTarget }
  | { kind: 'archived'; projectId: ProjectId }
  | ({ kind: 'confirm'; answer(yes: boolean): void } & ConfirmRequest);

export const useDialogs = create<{ open: OpenDialog | null }>()(() => ({ open: null }));

export function openDialog(dialog: OpenDialog): void {
  const previous = useDialogs.getState().open;
  useDialogs.setState({ open: dialog });
  if (previous?.kind === 'confirm') previous.answer(false);
}

export function closeDialog(): void {
  const previous = useDialogs.getState().open;
  useDialogs.setState({ open: null });
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
