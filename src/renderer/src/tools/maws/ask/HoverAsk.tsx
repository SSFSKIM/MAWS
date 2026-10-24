// The hover card answers the same ask as the sheet: shared controls, drafts and submit guard, never a composer follow-up.
import { useEffect } from 'react';
import { useStore } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../../../ipc/client';
import { CardButton } from '../../../request-card/controls';
import { selectProjectOrder, useSessions } from '../../../stores/sessions';
import { TranscriptActionsProvider } from '../../../transcript/view/context';
import { openFile } from '../../code/open-file';
import { SHEET } from './copy';
import { canSubmit, EMPTY_DRAFT } from './draft';
import { QuestionSection } from './QuestionSection';
import { askSheet, editDraft, ensureLoaded, loadAsks, submitAsk } from './store';

export function HoverAsk({ appSessionId, askId }: { appSessionId: AppSessionId; askId: string }) {
  const state = useStore(askSheet(appSessionId));
  const projects = useSessions(selectProjectOrder);
  const record = useSessions((s) => s.records.get(appSessionId));
  useEffect(() => ensureLoaded(appSessionId, ipc), [appSessionId]);
  const ask = state.asks.get(askId);
  if (!ask) {
    if (state.readError !== null) return <div role="alert" className="flex items-center gap-2 text-danger">
      <span>{SHEET.readFailed}</span>
      <CardButton disabled={state.reading} onClick={() => void loadAsks(appSessionId, ipc)}>{SHEET.retry}</CardButton>
    </div>;
    return <p role="status" className="m-0 text-fg-muted">{state.loaded ? (state.notice ?? 'No longer waiting for an answer') : 'Loading the question…'}</p>;
  }
  if (ask.state !== 'pending') return <p role="status" className="m-0 text-fg-muted">{SHEET.cancelled(ask.cancelReason)}</p>;

  const drafts = state.drafts.get(askId);
  const busy = state.submitting !== null;
  const ready = canSubmit(ask.questions, drafts);
  const failed = state.failed?.askId === askId ? state.failed : null;
  const submit = () => void submitAsk(appSessionId, askId, ipc, projects);
  const skipped = ask.questions.filter((question) => drafts?.get(question.id ?? '')?.skip).length;
  return <div data-hover-ask={askId} className="flex max-h-[50vh] min-h-0 flex-col">
    {state.notice && <p role="status" className="m-0 pb-2 text-fg-muted">{state.notice}</p>}
    <div className="min-h-0 overflow-y-auto">
      {ask.context && <p className="m-0 whitespace-pre-wrap pb-2 text-fg-muted">{ask.context}</p>}
      <TranscriptActionsProvider actions={{ openFile: (path, line) => openFile(appSessionId, path, line) }}>
        {ask.questions.map((question) => <QuestionSection key={`${askId}:${question.id}`} question={question}
          draft={drafts?.get(question.id ?? '') ?? EMPTY_DRAFT} disabled={busy}
          edit={(change) => editDraft(appSessionId, askId, question.id ?? '', change)}
          directory={record?.worktree?.path ?? record?.directory ?? null} projects={projects} />)}
      </TranscriptActionsProvider>
    </div>
    <div className="flex shrink-0 flex-col gap-2 border-t border-border pt-2">
      {failed && <div role="alert" className="flex items-center gap-2 text-danger">
        <span className="flex-1" title={failed.detail ?? undefined}>{SHEET.failed}</span>
        <CardButton disabled={busy || !ready} onClick={submit}>{SHEET.retry}</CardButton>
      </div>}
      <div className="flex justify-end">
        <CardButton tone="primary" disabled={busy || !ready} title={ready ? undefined : SHEET.incomplete} onClick={submit}>
          {state.submitting === askId ? SHEET.submitting : skipped > 0 ? SHEET.submitSkipping(skipped) : SHEET.submit}
        </CardButton>
      </div>
    </div>
  </div>;
}
