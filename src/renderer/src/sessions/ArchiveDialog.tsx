// Archive, a small confirmation sheet (D-20; mockup 05 vignette 07 for the copy): what archive does, the session's
// running background work by count and description (§4.4), and afterwards the cleanup dialog when the session was the
// last of a managed worktree. Archive stops a live process (the one place a process is stopped from a sheet), keeps the
// store file (queue and grants), and hides the row; unarchive is the Archived sessions dialog.
// The UX wave, U9 (S-02, A9): a session on another machine is archived there, from its listing alone where this Mac holds
// no record (the listing's title; nothing of the worktree's other sessions, which read records), and its sheet names the
// machine whose process it ends. No cleanup follows there: removing a worktree on another machine is not offered. While
// the act can't work there (the window's helper: the link connects, reconnects or is offline, or the build lacks the act)
// the sheet says why and its Archive is disabled, whenever that begins.
import { useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { machineOf } from '@shared/machine/address';
import { ipc } from '../ipc/client';
import { useRemoteUnavailable } from '../lane-b/remote-unavailable';
import { useMachines } from '../stores/machines';
import { machineName } from '../stores/org-projects';
import { useSessions } from '../stores/sessions';
import { BackgroundWorkDisclosure } from './BackgroundWorkDisclosure';
import { cleanupTargetOf } from './CleanupDialog';
import { closeDialog, openDialog } from './dialogs';
import { archiveSession, onAnotherMachine } from './record-ops';
import { Sheet, SheetForm } from './Sheet';
import { PRIMARY } from './ui';
import { displayTitle, listedTitle } from './title';

export const isManagedWorktree = (path: string) => path.includes('/.claude/worktrees/');

// The worktree to offer for cleanup after archiving `record`: its managed worktree, when no other session there is
// still in the sidebar.
export function lastOfWorktree(record: SessionRecord, records: Iterable<SessionRecord>): string | null {
  const path = record.worktree?.path ?? null;
  if (path === null || !isManagedWorktree(path)) return null;
  for (const other of records) if (other.appId !== record.appId && !other.archived && (other.worktree?.path ?? other.directory) === path) return null;
  return path;
}

export function ArchiveDialog({ appSessionId }: { appSessionId: AppSessionId }) {
  const record = useSessions((s) => s.records.get(appSessionId) ?? null);
  const listing = useSessions((s) => (record === null ? (s.listed.get(appSessionId) ?? null) : null)); // the UX wave, U9
  const project = useSessions((s) => (record?.projectId ? (s.projects.get(record.projectId)?.name ?? null) : null));
  const there = onAnotherMachine(appSessionId);
  const machine = useMachines((s) => (there ? machineName(s.machines, machineOf(appSessionId), ipc.localMachine) : null));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unavailable = useRemoteUnavailable(appSessionId, 'session.archive'); // the UX wave, U9: null on this Mac
  if (record === null && listing === null) return null;

  const submit = async () => {
    setBusy(true);
    const cleanup = record === null || there ? null : lastOfWorktree(record, useSessions.getState().records.values());
    const answer = await archiveSession(appSessionId);
    setBusy(false);
    if ('error' in answer) return setError(answer.error);
    if ('skipped' in answer) return setError(`Live in ${answer.skipped}`);
    const target = cleanup !== null && record !== null ? cleanupTargetOf(record) : null;
    if (target !== null) openDialog({ kind: 'cleanup', target });
    else closeDialog();
  };

  return (
    <Sheet title={`Archive “${record !== null ? displayTitle(record) : listedTitle(listing!)}”?`}>
      <SheetForm focusSubmit canSubmit={!busy && unavailable === null} onSubmit={() => void submit()} submitLabel="Archive" submitClass={PRIMARY}>
        <p className="m-0 text-fg-muted">
          Ends its engine process{machine !== null ? ` on ${machine}` : ''} and hides it{project ? ` from ${project}` : ''}. The transcript stays where Claude Code keeps it; resume it from Archived sessions or with claude
          --resume in the terminal. The worktree is not touched.
        </p>
        <BackgroundWorkDisclosure appSessionId={appSessionId} />
        {unavailable !== null && <p className="m-0 text-ui-sm text-fg-muted">{unavailable}</p>}
        {error && <p className="m-0 text-ui-sm text-danger">{error}</p>}
      </SheetForm>
    </Sheet>
  );
}
