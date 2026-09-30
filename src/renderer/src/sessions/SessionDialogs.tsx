// The one place C10's sheets render (App.tsx's C10 block mounts it beside the shell), and what a session's tab shows
// of C10 above its composer: a delete that stopped half-way ("Finish deleting" or "Keep"). The card a start or a
// resume waits on docks in the composer's place (`SetupCard.tsx`).
import { useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../ipc/client';
import { ArchiveDialog } from './ArchiveDialog';
import { ArchivedSessionsDialog } from './ArchivedSessionsDialog';
import { CleanupDialog } from './CleanupDialog';
import { DeleteDialog } from './DeleteDialog';
import { closeDialog, useDialogs } from './dialogs';
import { ForkSheet } from './ForkSheet';
import { deleteOutcomeWords, deleteSession } from './record-ops';
import { RenameDialog } from './RenameDialog';
import { Sheet, SheetForm } from './Sheet';
import { useSetup } from './store';
// C12 start
import { WorktreesDialog } from './WorktreesDialog';
// C12 end
import { DANGER, PRIMARY, SECONDARY } from './ui';

export function SessionDialogs() {
  const open = useDialogs((s) => s.open);
  switch (open?.kind) {
    case undefined:
      return null;
    case 'rename':
      return <RenameDialog key={open.appSessionId} appSessionId={open.appSessionId} />;
    case 'fork':
      return <ForkSheet key={open.appSessionId} appSessionId={open.appSessionId} />;
    case 'archive':
      return <ArchiveDialog key={open.appSessionId} appSessionId={open.appSessionId} />;
    case 'delete':
      return <DeleteDialog key={open.appSessionId} appSessionId={open.appSessionId} />;
    case 'cleanup':
      return <CleanupDialog key={open.target.path} target={open.target} />;
    case 'archived':
      return <ArchivedSessionsDialog key={open.projectId} projectId={open.projectId} />;
    // C12 start: the project menu's Worktrees… (a cleanup it opens returns here, mounting it afresh)
    case 'worktrees':
      return <WorktreesDialog key={open.projectId} projectId={open.projectId} />;
    // C12 end
    case 'confirm':
      return (
        <Sheet title={open.title}>
          <SheetForm
            focusSubmit
            canSubmit
            onSubmit={() => {
              open.answer(true);
              closeDialog();
            }}
            submitLabel={open.confirmLabel}
            submitClass={open.destructive ? DANGER : PRIMARY}
          >
            <p className="m-0 text-fg-muted">{open.body}</p>
          </SheetForm>
        </Sheet>
      );
  }
}

// What a session's tab shows of C10 above its composer.
export function SessionTabNotes({ appSessionId }: { appSessionId: AppSessionId }) {
  return <DeletionNotice appSessionId={appSessionId} />;
}

// A delete of this conversation that stopped part-way (found at start, or answered `partial`).
export function DeletionNotice({ appSessionId }: { appSessionId: AppSessionId }) {
  const manifest = useSetup((s) => s.deletions.get(appSessionId) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (manifest === null) return null;

  const finish = async () => {
    setBusy(true);
    const words = deleteOutcomeWords(await deleteSession(appSessionId, false));
    setBusy(false);
    setError(words);
  };
  const keep = async () => {
    const result = await ipc.invoke('session.deletions.keep', { appSessionId });
    if (!result.ok) return setError(result.error.message);
    useSetup.getState().setDeletion(appSessionId, null);
  };

  return (
    <div role="note" className="flex flex-col gap-2 rounded-lg border border-l-2 border-border border-l-warning bg-bg-raised px-3 py-2.5 text-ui-sm">
      <p className="m-0 text-fg">
        {`Deleting this conversation stopped part-way: ${manifest.trashed.length} of ${manifest.paths.length} files moved to the Trash.`}
      </p>
      {error && <p className="m-0 text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void finish()} className={DANGER}>
          Finish deleting
        </button>
        <button type="button" disabled={busy} onClick={() => void keep()} className={SECONDARY}>
          Keep
        </button>
      </div>
    </div>
  );
}
