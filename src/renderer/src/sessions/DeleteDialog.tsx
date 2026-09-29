// Delete conversation, a small confirmation sheet (D-20; mockup 05 vignette 07 for the copy): the title, the directory,
// what moves to the Trash (the transcript, its subagent transcripts, its recordings, from `session.deletions.preview`,
// which also names the store they move from: the config home the engine reads),
// and the acknowledgement "Move the transcript to the Trash" before the button acts; "Stop and delete" for a live
// session. A stop the host could not confirm and a delete that stopped half-way are said with their next step.
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandOutput } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import { closeDialog } from './dialogs';
import { deleteOutcomeWords, deleteSession, useRecord } from './record-ops';
import { Sheet, SheetForm } from './Sheet';
import { CHOICE, DANGER } from './ui';

type Preview = CommandOutput<'session.deletions.preview'>;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function deletionWords(preview: Preview): string {
  const parts = [preview.transcript === null ? 'Removes what is left of the conversation' : 'Removes the transcript'];
  if (preview.subagents > 0) parts.push(`its ${count(preview.subagents, 'subagent transcript', 'subagent transcripts')}`);
  if (preview.recordings > 0) parts.push(count(preview.recordings, 'recording', 'recordings'));
  const what = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `${what} from ${preview.store} to the Trash. The terminal cannot resume it afterwards either. Files the session edited stay where they are.`;
}

export function DeleteDialog({ appSessionId }: { appSessionId: AppSessionId }) {
  const record = useRecord(appSessionId);
  const live = useSessions((s) => {
    const process = s.engine.get(appSessionId)?.process;
    return process !== undefined && process !== 'exited';
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void ipc.invoke('session.deletions.preview', { appSessionId }).then((result) => {
      if (!active) return;
      if (result.ok) setPreview(result.value);
      else setError(result.error.message);
    });
    return () => {
      active = false;
    };
  }, [appSessionId]);

  if (record === null) return null;
  const submit = async () => {
    setBusy(true);
    setError(null);
    const outcome = await deleteSession(appSessionId, live);
    setBusy(false);
    const words = deleteOutcomeWords(outcome);
    if (words === null) closeDialog();
    else setError(words);
  };

  return (
    <Sheet title={`Delete “${record.title.text}”?`}>
      <SheetForm canSubmit={acknowledged && !busy} onSubmit={() => void submit()} submitLabel={live ? 'Stop and delete' : 'Delete'} submitClass={DANGER}>
        <p className="m-0 font-mono text-ui-sm break-all text-fg-muted">{record.worktree?.path ?? record.directory}</p>
        <p className="m-0 text-fg-muted">{preview ? deletionWords(preview) : 'Reading what would move…'}</p>
        {live && <p className="m-0 text-ui-sm text-fg-muted">The session is running; it stops before anything moves.</p>}
        <label className="flex items-center gap-2 text-ui-sm text-fg">
          <input type="checkbox" aria-label="Move the transcript to the Trash" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className={CHOICE} />
          Move the transcript to the Trash
        </label>
        {error && <p className="m-0 text-ui-sm text-danger">{error}</p>}
      </SheetForm>
    </Sheet>
  );
}
