// `/rename` (C11 execution document, the widget table; M3 refresh task "rename and resume through C10's landed
// actions"): with a title, the session is renamed at once through C10's `session.rename` (`/rename Live C11`: through
// the engine while its process is ready, so the terminal sees it; the record's override otherwise) and the widget
// closes once it took; without one, C10's rename dialog opens (the session action `rename` C10 registers into C5's registry), or, while
// no dialog is registered, the widget offers the title to edit.
// P5 O7 M8: a session on another machine can't be renamed from here yet (lane-b/remote-unavailable.ts): nothing is asked
// and no dialog opens; the title field and Rename are greyed, with the reason. The word cut (P635, P637): the field is
// named "New title" without a label drawn over it, and a rename that took closes the dialog, the new title showing where
// the session is named; a typed title's rename shows the quiet spinner while it is out, so the dialog is never blank. A
// widget put away while its rename is out sets nothing when it lands, and its close is bound to the open it was handed
// (WidgetDialog's nonce), so it never puts away a widget opened in its place.
import { useEffect, useRef, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { runSessionAction, useSessionActionEnabled } from '../app/session-actions';
import { ipc } from '../ipc/client';
import { remoteUnavailableOf, useRemoteUnavailable } from '../lane-b/remote-unavailable'; // P5 O7 M8
import { useSessions } from '../stores/sessions';
import { QuietSpinner } from '../ui/spinner';
import { RENAME, WIDGET_TITLE } from './copy';
import { WidgetFrame } from './WidgetFrame';

type Outcome = { refused: string } | null;

async function renameSession(appSessionId: AppSessionId, title: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await ipc.invoke('session.rename', { appSessionId, title });
  return result.ok ? { ok: true } : { ok: false, error: result.error.message };
}

export function RenameWidget({ appSessionId, args, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const given = args.trim();
  const dialog = useSessionActionEnabled('rename');
  const current = useSessions((s) => s.records.get(appSessionId)?.title.text ?? '');
  const [title, setTitle] = useState(current);
  const [busy, setBusy] = useState(given !== '' && remoteUnavailableOf(appSessionId, 'session.rename') === null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const unavailable = useRemoteUnavailable(appSessionId, 'session.rename');
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true; // StrictMode runs setup, cleanup, setup
    return () => void (mounted.current = false);
  }, []);

  const renamed = (answer: Awaited<ReturnType<typeof renameSession>>) => {
    if (!mounted.current) return;
    setBusy(false);
    if (answer.ok) close();
    else setOutcome({ refused: answer.error });
  };
  const rename = (next: string) => {
    setBusy(true);
    void renameSession(appSessionId, next).then(renamed);
  };
  // once, on open: the palette's title renames; no title hands over to C10's dialog when it is registered
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (unavailable !== null) return;
    if (given !== '') void renameSession(appSessionId, given).then(renamed);
    else if (dialog) {
      close();
      runSessionAction('rename', appSessionId);
    }
  });

  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.rename} command="rename" state="ready" error={null} close={close}>
      <div className="flex flex-col gap-2">
        {unavailable !== null && (
          <p role="status" className="m-0 text-ui-sm text-fg-muted">
            {unavailable}
          </p>
        )}
        {given !== '' && busy && <QuietSpinner label={RENAME.renaming} />}
        {given === '' && (
          <div className="flex items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-ui-sm">
              <input
                aria-label={RENAME.title}
                value={title}
                disabled={unavailable !== null}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && title.trim() !== '' && unavailable === null) rename(title.trim());
                }}
                className="rounded-sm border border-border bg-bg px-2 py-0.5 text-ui outline-accent focus-visible:outline-2"
              />
            </label>
            <button
              type="button"
              disabled={busy || title.trim() === '' || unavailable !== null}
              title={unavailable ?? undefined}
              onClick={() => rename(title.trim())}
              className="rounded-sm bg-accent px-2 py-0.5 text-ui-sm text-bg outline-accent focus-visible:outline-2 disabled:bg-bg-active disabled:text-fg-faint"
            >
              {RENAME.rename}
            </button>
          </div>
        )}
        {outcome && (
          <p role="alert" className="m-0 text-ui-sm text-danger">
            {outcome.refused}
          </p>
        )}
      </div>
    </WidgetFrame>
  );
}
