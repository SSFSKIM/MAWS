// The Question sheet (E1 execution document, Interfaces "The renderer" and M4; P1 spec §3 A, P-13): the X5 tool that
// shows a session's asks. One tab per session (single-instance, never pinned, not offered from "+"), re-targeted by
// `open` for each new ask (`connect.ts`) and for a capsule's *Open* or *View answers* (`openAsk`, residue 14). Its state
// is the session alone; the asks, the drafts and the selection are the session's store (`store.ts`), which outlives
// the tab, so a closed and reopened sheet still holds its half-filled answers.
//
// Shown: a pending ask as a form (one section per question, a sticky Submit bar); a cancelled ask with its notice and
// nothing to submit; a capsule's ask the store does not hold, read-only from the capsule's data; or the resting state.
import { useEffect, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import { ASK_SHEET_TOOL_ID } from '@shared/maws/panes';
import type { AskAnswer, AskQuestion } from '@shared/maws/tools';
import { Icon } from '../../../app/IconButton';
import { ipc } from '../../../ipc/client';
import type { PanelTool, PanelToolContext, PanelToolInit } from '../../../panel/tool';
import { CardButton } from '../../../request-card/controls';
import { selectProjectOrder, useSessions } from '../../../stores/sessions';
import { TranscriptActionsProvider } from '../../../transcript/view/context'; // P2-C3
import { openFile } from '../../code/open-file'; // P2-C3
import type { AskSheetParams } from '../actions';
import { SHEET } from './copy';
import { canSubmit, EMPTY_DRAFT, skippedCount } from './draft';
import { AnsweredSection, QuestionSection } from './QuestionSection';
import { askSheet, dismissAsk, editDraft, ensureLoaded, loadAsks, selectAsk, shownAsk, submitAsk, type AskSheetState as SheetStore, type SheetAsk } from './store';

export interface AskSheetState {
  appSessionId: AppSessionId | null;
}

// A tab restored from layout.json has no params: it shows what the store holds once read.
function apply(appSessionId: AppSessionId | null, params: AskSheetParams | undefined): void {
  if (appSessionId !== null && params?.askId !== undefined) selectAsk(appSessionId, params.askId, params.historical ?? null);
}

function QuestionsIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M6.4 6.4a1.7 1.7 0 1 1 2.3 1.6c-.45.2-.7.55-.7 1v.3M8 11.1v.01" />
    </Icon>
  );
}

const SCROLL = 'flex h-full min-h-0 flex-col bg-bg text-ui text-fg';

function Centered({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
      <p className="m-0 text-ui text-fg-muted">{title}</p>
      {detail && <p className="m-0 text-ui-sm text-fg-faint">{detail}</p>}
    </div>
  );
}

function Header({ title, status, tone = 'muted', context }: { title: string | null; status: string | null; tone?: 'muted' | 'danger'; context: string | null }) {
  return (
    <header className="flex flex-col gap-1.5 px-4 pt-4 pb-1">
      <h2 className="m-0 text-prose leading-snug font-semibold text-fg">{title ?? SHEET.untitled}</h2>
      {status !== null && (
        <p role="status" className={`m-0 text-ui-sm ${tone === 'danger' ? 'text-danger' : 'text-fg-muted'}`}>
          {status}
        </p>
      )}
      {context !== null && <p className="m-0 whitespace-pre-wrap text-ui text-fg-muted">{context}</p>}
    </header>
  );
}

// The asks the session holds, when there is more than one to choose between.
function Switcher({ appSessionId, asks, shown }: { appSessionId: AppSessionId; asks: SheetAsk[]; shown: string | null }) {
  if (asks.length < 2) return null;
  return (
    <nav aria-label={SHEET.asks(asks.length)} className="flex flex-wrap gap-1 border-b border-border px-4 py-2">
      {asks.map((ask) => (
        <button
          key={ask.askId}
          type="button"
          aria-current={ask.askId === shown ? 'true' : undefined}
          data-ask-state={ask.state}
          onClick={() => selectAsk(appSessionId, ask.askId)}
          className="max-w-full truncate rounded-sm border border-transparent px-2 py-0.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 aria-[current=true]:border-border-strong aria-[current=true]:bg-bg-active aria-[current=true]:text-fg data-[ask-state=cancelled]:line-through"
        >
          {ask.title ?? SHEET.untitled}
        </button>
      ))}
    </nav>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 flex-col gap-2 border-t border-border bg-bg px-4 py-3">{children}</div>;
}

function ReadOnly({ questions, answers }: { questions: readonly AskQuestion[]; answers: readonly AskAnswer[] | null }) {
  return (
    <div className="flex flex-col">
      {questions.map((question) => (
        <AnsweredSection key={question.id} question={question} answers={answers} />
      ))}
    </div>
  );
}

function LiveAsk({ appSessionId, ask, state, directory }: { appSessionId: AppSessionId; ask: SheetAsk; state: SheetStore; directory: string | null }) {
  const projects = useSessions(selectProjectOrder);
  const drafts = state.drafts.get(ask.askId);
  const sending = state.submitting === ask.askId;
  const busy = state.submitting !== null; // one answer in flight at a time, across the session's asks (store.ts)
  const failed = state.failed?.askId === ask.askId ? state.failed : null;
  const submit = () => void submitAsk(appSessionId, ask.askId, ipc, projects);

  if (ask.state === 'cancelled') {
    return (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Header title={ask.title} status={SHEET.cancelled(ask.cancelReason)} context={ask.context} />
          <ReadOnly questions={ask.questions} answers={null} />
        </div>
        <Footer>
          <div className="flex justify-end">
            <CardButton onClick={() => dismissAsk(appSessionId, ask.askId)}>{SHEET.dismiss}</CardButton>
          </div>
        </Footer>
      </>
    );
  }

  const ready = canSubmit(ask.questions, drafts); // Submit's rule, Retry's too (submitAsk enforces it)
  const skipped = skippedCount(ask.questions, drafts);
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Header title={ask.title} status={ask.blocking ? SHEET.waitingNote : SHEET.asyncNote} context={ask.context} />
        {/* P2-C3: a preview's file references open in the ask's own session, as the plan card's do */}
        <TranscriptActionsProvider actions={{ openFile: (path, line) => openFile(appSessionId, path, line) }}>
          <div className="flex flex-col">
            {ask.questions.map((question) => (
              <QuestionSection
                key={`${ask.askId}:${question.id}`} // P2-C3: per ask, so a section's own state (the focused preview) never outlives it
                question={question}
                draft={drafts?.get(question.id ?? '') ?? EMPTY_DRAFT}
                disabled={sending}
                edit={(change) => editDraft(appSessionId, ask.askId, question.id ?? '', change)}
                directory={directory}
                projects={projects}
              />
            ))}
          </div>
        </TranscriptActionsProvider>
      </div>
      <Footer>
        {failed && (
          <div role="alert" className="flex items-center gap-2 rounded-sm border border-danger px-2.5 py-1.5 text-danger">
            <span className="flex-1" title={failed.detail ?? undefined}>
              {SHEET.failed}
            </span>
            <CardButton disabled={busy || !ready} title={ready ? undefined : SHEET.incomplete} onClick={submit}>
              {SHEET.retry}
            </CardButton>
          </div>
        )}
        <div className="flex justify-end">
          <CardButton tone="primary" disabled={busy || !ready} title={ready ? undefined : SHEET.incomplete} onClick={submit}>
            {sending ? SHEET.submitting : skipped > 0 ? SHEET.submitSkipping(skipped) : SHEET.submit}
          </CardButton>
        </div>
      </Footer>
    </>
  );
}

function Sheet({ appSessionId, ctx }: { appSessionId: AppSessionId; ctx: PanelToolContext }) {
  const state = useStore(askSheet(appSessionId));
  const shown = shownAsk(state);
  const title = shown.kind === 'rest' ? null : (shown.ask.title ?? null);
  const { setTitle } = ctx;
  useEffect(() => {
    setTitle(title);
  }, [setTitle, title]);
  const directory = ctx.session?.worktree?.path ?? ctx.session?.directory ?? null;
  const held = [...state.asks.values()];

  let body: ReactNode;
  if (shown.kind === 'live') {
    body = <LiveAsk appSessionId={appSessionId} ask={shown.ask} state={state} directory={directory} />;
  } else if (shown.kind === 'historical') {
    const { ask } = shown;
    const waiting = ask.state === 'pending' || ask.state === 'asked';
    const status = ask.state === 'answered' ? SHEET.answered : ask.state === 'cancelled' ? SHEET.cancelled(ask.cancelReason) : ask.state === 'error' ? ask.error : waiting && state.loaded ? SHEET.notHeld : null;
    body = (
      <div className="min-h-0 flex-1 overflow-y-auto" data-ask-readonly="">
        <Header title={ask.title} status={status} tone={ask.state === 'error' ? 'danger' : 'muted'} context={ask.context} />
        <ReadOnly questions={ask.questions} answers={ask.state === 'answered' ? (ask.answers ?? []) : null} />
      </div>
    );
  } else if (state.readError === null) {
    body = <Centered title={SHEET.rest} detail={SHEET.restDetail} />;
  }

  return (
    <div className={SCROLL} data-ask-sheet="" data-ask-id={shown.kind === 'rest' ? undefined : shown.ask.askId}>
      {state.notice !== null && (
        <p role="status" className="m-0 border-b border-border px-4 py-2 text-ui-sm text-fg-muted">
          {state.notice}
        </p>
      )}
      {state.readError !== null && (
        // the host's table could not be read: "No open questions" would hide a pending ask, so say so and offer a read
        <div role="alert" className="mx-4 mt-3 flex items-center gap-2 rounded-sm border border-danger px-2.5 py-1.5 text-ui text-danger">
          <span className="flex-1" title={state.readError}>
            {SHEET.readFailed}
          </span>
          <CardButton disabled={state.reading} onClick={() => void loadAsks(appSessionId, ipc)}>
            {SHEET.retry}
          </CardButton>
        </div>
      )}
      <Switcher appSessionId={appSessionId} asks={held} shown={shown.kind === 'live' ? shown.ask.askId : null} />
      {body}
    </div>
  );
}

function AskSheetBody({ ctx }: { state: AskSheetState; ctx: PanelToolContext }) {
  const appSessionId = ctx.appSessionId;
  useEffect(() => {
    if (appSessionId !== null) ensureLoaded(appSessionId, ipc);
  }, [appSessionId]);
  if (appSessionId === null) {
    return (
      <div className={SCROLL}>
        <Centered title={SHEET.noSession} />
      </div>
    );
  }
  return <Sheet appSessionId={appSessionId} ctx={ctx} />;
}

export const askSheetTool: PanelTool<AskSheetState, AskSheetParams> = {
  id: ASK_SHEET_TOOL_ID,
  title: SHEET.title,
  icon: QuestionsIcon,
  pinnable: false,
  multiInstance: false,
  menu: false,
  createState({ appSessionId, params }: PanelToolInit<AskSheetParams>) {
    apply(appSessionId, params);
    return { appSessionId };
  },
  open(state, params) {
    apply(state.appSessionId, params);
  },
  beforeClose: async () => true, // the asks are the host's and the drafts the store's: closing loses nothing
  dispose: () => {},
  render: AskSheetBody,
};
