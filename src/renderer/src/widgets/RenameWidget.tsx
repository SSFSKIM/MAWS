// `/rename` (C11 execution document, the widget table; M3 refresh task "rename and resume through C10's landed
// actions"): with a title, the session is renamed at once through C10's `session.rename` (`/rename Live C11`: through
// the engine while its process is ready, so the terminal sees it; the record's override otherwise) and the widget says
// so; without one, C10's rename dialog opens (the session action `rename` C10 registers into C5's registry), or, while
// no dialog is registered, the widget offers the title to edit.
import { useEffect, useRef, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { runSessionAction, useSessionActionEnabled } from '../app/session-actions';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import { RENAME, WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { WidgetFrame } from './WidgetFrame';

type Outcome = { renamed: string } | { refused: string } | null;

async function renameSession(appSessionId: AppSessionId, title: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await ipc.invoke('session.rename', { appSessionId, title });
  return result.ok ? { ok: true } : { ok: false, error: result.error.message };
}

export function RenameWidget({ appSessionId, args, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const given = args.trim();
  const dialog = useSessionActionEnabled('rename');
  const current = useSessions((s) => s.records.get(appSessionId)?.title.text ?? '');
  const [title, setTitle] = useState(current);
  const [busy, setBusy] = useState(given !== '');
  const [outcome, setOutcome] = useState<Outcome>(null);

  const renamed = (next: string) => (answer: Awaited<ReturnType<typeof renameSession>>) => {
    setBusy(false);
    setOutcome(answer.ok ? { renamed: next } : { refused: answer.error });
  };
  const rename = (next: string) => {
    setBusy(true);
    void renameSession(appSessionId, next).then(renamed(next));
  };
  // once, on open: the palette's title renames; no title hands over to C10's dialog when it is registered
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (given !== '') void renameSession(appSessionId, given).then(renamed(given));
    else if (dialog) {
      close();
      runSessionAction('rename', appSessionId);
    }
  });

  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.rename} command="rename" foot={WIDGET_FOOT.rename} state="ready" error={null} close={close}>
      <div className="flex flex-col gap-2">
        {given === '' && (
          <div className="flex items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-ui-sm">
              <span className="text-fg-muted">{RENAME.title}</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && title.trim() !== '') rename(title.trim());
                }}
                className="rounded-sm border border-border bg-bg px-2 py-0.5 text-ui outline-accent focus-visible:outline-2"
              />
            </label>
            <button
              type="button"
              disabled={busy || title.trim() === ''}
              onClick={() => rename(title.trim())}
              className="rounded-sm bg-accent px-2 py-0.5 text-ui-sm text-bg outline-accent focus-visible:outline-2 disabled:bg-bg-active disabled:text-fg-faint"
            >
              {RENAME.rename}
            </button>
          </div>
        )}
        {outcome && 'renamed' in outcome && (
          <p role="status" className="m-0 text-ui-sm">
            {RENAME.renamed(outcome.renamed)}
          </p>
        )}
        {outcome && 'refused' in outcome && (
          <p role="alert" className="m-0 text-ui-sm text-danger">
            {outcome.refused}
          </p>
        )}
      </div>
    </WidgetFrame>
  );
}
