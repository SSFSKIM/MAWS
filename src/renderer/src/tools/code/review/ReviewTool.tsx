// The Review tool (C8c execution document, Interfaces *Tools, slots and the open-file seam*; M3's decisions): what
// changed under the scope that fits, in the right panel. X5: `id: 'review'`, pinnable, single-instance,
// `params { scope?, path?, turnId? }`, `open` re-targeting, and a `summary` for Environment's diff stats. Its state is a
// store handle (C8a's React Compiler rule): the scope, the turn, the selected file, the hunk, the scroll, the mode and
// the viewed marks. The git watch and the scope's diff are the mounted body's (the host unmounts an unselected tool),
// so `dispose` has nothing left to release.
import { useEffect } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { PanelTool, PanelToolContext, PanelToolInit } from '../../../panel/tool';
import { REVIEW_COPY } from '../copy';
import type { ReviewParams } from './review-model';
import { ReviewShell } from './ReviewShell';
import { ReviewSummary } from './ReviewSummary';
import { applyRequest, createReviewUi, forSession, type ReviewUi } from './view-state';

export const REVIEW_TOOL_ID = 'review';

export interface ReviewState {
  readonly ui: StoreApi<ReviewUi>;
}

// `params` is undefined for a tab restored from layout.json (X5); a request is applied against the shown session.
function createState({ appSessionId, params }: PanelToolInit<ReviewParams>): ReviewState {
  return { ui: createReviewUi({ session: appSessionId, params: params ?? null }) };
}

// Re-targeting (X5): a receipt's `{ scope: 'turn', turnId, path }`, C11's `{}` or `{ scope, path }`. Applied by the
// body against the session it then shows, since `addTool` activates the target session with the tab.
function open(state: ReviewState, params: ReviewParams | undefined): void {
  state.ui.setState({ request: params ?? {} });
}

export function ReviewIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2.5v11M4 5.5h4.5a2 2 0 0 1 2 2v1M12 10.5v3M10.5 12h3M2.5 5.5h1" />
    </svg>
  );
}

function ReviewBody({ state, ctx }: { state: ReviewState; ctx: PanelToolContext }) {
  const { ui } = state;
  const shown = ctx.appSessionId;
  // A pinned tool shown for another session starts over there; an open() waiting is applied after that. A new session
  // renders nothing until then, so no read is made for its old scope; the same session keeps its shell mounted while
  // an open() re-targets it (the shell decides no default while the request waits).
  const synced = useStore(ui, (s) => s.session === shown);
  const requested = useStore(ui, (s) => s.request !== null);
  useEffect(() => {
    const current = ui.getState();
    const next: Partial<ReviewUi> = current.session === shown ? {} : forSession(shown);
    const merged = { ...current, ...next };
    if (merged.request) Object.assign(next, applyRequest(merged, merged.request));
    if (Object.keys(next).length > 0) ui.setState(next);
  }, [ui, shown, synced, requested]);

  if (shown === null || ctx.session === null) {
    return <p className="flex h-full items-center justify-center p-4 text-center text-ui text-fg-muted">{REVIEW_COPY.noSession}</p>;
  }
  if (!synced) return null;
  const directory = ctx.session.worktree?.path ?? ctx.session.directory;
  return <ReviewShell key={`${shown}\0${directory}`} appSessionId={shown} directory={directory} ui={ui} chips focusRequest={ctx.focusRequest} visible={ctx.visible} />;
}

export const reviewTool: PanelTool<ReviewState, ReviewParams> = {
  id: REVIEW_TOOL_ID,
  title: REVIEW_COPY.title,
  icon: ReviewIcon,
  pinnable: true,
  multiInstance: false,
  createState,
  open,
  beforeClose: async () => true, // read-only: nothing to lose
  dispose: () => {}, // the watch and the diff are the mounted body's, released when it unmounts
  render: ReviewBody,
  summary: ReviewSummary,
};
