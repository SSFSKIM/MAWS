// P3-H "Send to" a connector (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H; Decision Log 87, 88): the library's
// confirmation sheet, opened from a row's Export submenu (./RowMenu.tsx). C10's Sheet and button weights, X7's tokens.
// It names the target, offers the formats the kind's exporters serve (the target's default first chosen, the owner's to
// change), and says which session sends it: the artifact's live session, or the one that resumes or starts first, which
// the Send gesture confirms ("Start session and send"). The run (./send-to.ts) is the dialog's, so the sheet only shows
// it: its pending phase in the status line, a failure in words with Try again and, when a session holds the reason (a
// trust card, a waiting prompt), Open session. Closing the sheet cancels the run; a sent run opens its session.
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { LibraryRow } from '@shared/ipc/schema/library';
import type { ArtifactExportFormat } from '@shared/maws/tools';
import { NO_SESSION_CONTEXT, startArtifactSession, useArtifactSessionContext, type ArtifactSessionContext } from '../artifacts/session-context';
import { sendHumanPrompt } from '../composer/submit/send-human-prompt';
import { ipc } from '../ipc/client';
import { Sheet, SheetForm } from '../sessions/Sheet';
import { FIELD, PRIMARY, SECONDARY } from '../sessions/ui';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { VIEWERS_COPY } from '../tools/artifacts/viewers/copy';
import { SEND_TO_COPY as C } from './copy';
import { closeLibraryDialog, openLibraryDialog, type SheetOf } from './dialogs';
import { useExportFormats } from './export';
import { createSendToRun, defaultSendFormat, isPending, SEND_TARGETS, type SendTarget, type SendToPhase } from './send-to';

const openBeside = (appSessionId: Parameters<ReturnType<typeof useLayout.getState>['openSession']>[0]) => useLayout.getState().openSession(appSessionId, { how: 'tab' });

// The owner's gesture on a row: the sheet, with a run over the app's own seams.
export function openSendTo(artifact: LibraryRow, target: SendTarget): void {
  const run = createSendToRun({
    client: ipc,
    start: (context, previous) => startArtifactSession(context, previous),
    send: (appSessionId, prompt, options) => sendHumanPrompt(appSessionId, prompt, options),
    isLive: (appSessionId) => useSessions.getState().engine.get(appSessionId)?.process === 'ready',
    open: openBeside,
  });
  openLibraryDialog({ kind: 'sendTo', artifact, target, run });
}

export function SendToSheet({ dialog }: SheetOf<'sendTo'>) {
  const { artifact, target, run } = dialog;
  const service = SEND_TARGETS[target].name;
  const formats = useExportFormats(artifact.kind);
  const [picked, setPicked] = useState<ArtifactExportFormat | null>(null);
  const format = picked !== null && formats.includes(picked) ? picked : defaultSendFormat(target, formats);
  const context = useArtifactSessionContext(artifact);
  const state = useStore(run.state);
  const pending = isPending(state);
  // the session that would send now: the own one, or the one an earlier attempt of this run started
  const sender = context.kind === 'session' ? context.appSessionId : context.kind === 'directory' ? run.previous() : null;
  const live = useSessions((s) => sender !== null && s.engine.get(sender)?.process === 'ready');
  const recordTitle = useSessions((s) => (sender === null ? undefined : s.records.get(sender)?.title?.text));
  const senderTitle = artifact.sessions.find((session) => session.appSessionId === sender)?.title || recordTitle || C.ownSession;

  const close = () => {
    run.cancel();
    closeLibraryDialog(dialog);
  };
  useEffect(() => {
    if (state.phase === 'sent') closeLibraryDialog(dialog);
  }, [state.phase, dialog]);

  const failed = state.phase === 'failed' ? state : null;
  const submitLabel = failed ? C.tryAgain : live || context.kind === 'none' ? C.send : context.kind === 'session' ? C.resumeAndSend : C.startAndSend;
  const opener = failed?.appSessionId ?? null;
  return (
    <Sheet title={C.title(service)} width="w-[min(480px,90vw)]" onClose={close} data-send-to={target}>
      <SheetForm
        canSubmit={!pending && format !== null && context.kind !== 'none'}
        onSubmit={() => format !== null && void run.send({ artifactId: artifact.id, kind: artifact.kind, target, format, context })}
        submitLabel={submitLabel}
        submitClass={PRIMARY}
        extra={
          opener !== null && (
            <button
              type="button"
              onClick={() => {
                close();
                openBeside(opener);
              }}
              className={SECONDARY}
            >
              {C.openSession}
            </button>
          )
        }
      >
        <p className="m-0 text-fg-muted">{C.body(artifact.title, service)}</p>
        <label className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-ui-sm text-fg-muted">{C.format}</span>
          <select aria-label={C.format} disabled={pending || formats.length === 0} value={format ?? ''} onChange={(event) => setPicked(event.target.value as ArtifactExportFormat)} className={`${FIELD} py-0.5`}>
            {formats.map((option) => (
              <option key={option} value={option}>
                {VIEWERS_COPY.exportFormats[option]}
              </option>
            ))}
          </select>
        </label>
        <p className="m-0 text-ui-sm text-fg" data-send-to-session="">
          {sessionLine(context, live, senderTitle)}
        </p>
        {context.kind !== 'none' && <p className="m-0 text-ui-sm text-fg-muted">{C.approval}</p>}
        <p role="status" className={`m-0 min-h-[1lh] text-ui-sm ${failed ? 'text-danger' : 'text-fg-muted'}`}>
          {statusWords(state, format)}
        </p>
      </SheetForm>
    </Sheet>
  );
}

function sessionLine(context: ArtifactSessionContext, live: boolean, title: string): string {
  if (context.kind === 'none') return NO_SESSION_CONTEXT;
  if (live) return C.fromLive(title);
  return context.kind === 'session' ? C.resumes(title) : C.startsIn(context.path);
}

function statusWords(state: SendToPhase, format: ArtifactExportFormat | null): string {
  switch (state.phase) {
    case 'exporting':
      return C.exporting(format === null ? '' : VIEWERS_COPY.exportFormats[format]);
    case 'starting':
      return C.starting;
    case 'sending':
      return C.sending;
    case 'failed':
      return state.words;
    default:
      return '';
  }
}
