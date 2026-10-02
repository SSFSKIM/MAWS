// The `diffTab` slot (C8c execution document, M3's decisions; K4): Review in the main area for a `ref`
// (`scope [' @ ' path]`, a TurnId its own scope word), beside the transcript. The same shell and the same data as the
// panel's Review (one `git.diff` per directory and scope, shared), with its own view state per tab (mode, selection,
// hunk, scroll, viewed marks), so the two share data and not scroll. A ref's scope is the tab's identity (C5's tab id
// holds it), so the tab shows no scope chips.
import type { StoreApi } from 'zustand/vanilla';
import type { TabRef } from '@shared/ipc/schema/layout';
import { useLayout } from '../../../stores/layout';
import { allTabs } from '../../../stores/layout-model';
import { useSessions } from '../../../stores/sessions';
import { REVIEW_COPY } from '../copy';
import { parseRef } from './review-model';
import { ReviewShell } from './ReviewShell';
import { createReviewUi, type ReviewUi } from './view-state';

type DiffTabRef = Extract<TabRef, { kind: 'diff' }>;

// One view state per diff tab, created on first render and dropped as soon as the layout no longer holds the tab, so a
// tab closed and opened again starts from its ref.
const views = new Map<string, StoreApi<ReviewUi>>();
let following: (() => void) | null = null;

function prune(): void {
  const open = new Set(allTabs(useLayout.getState().main).map((t) => t.id)); // W12: every project's tab set
  for (const id of views.keys()) if (!open.has(id)) views.delete(id);
}

function viewOf(tab: DiffTabRef, ref: NonNullable<ReturnType<typeof parseRef>>): StoreApi<ReviewUi> {
  following ??= useLayout.subscribe((state, prev) => {
    if (state.main !== prev.main) prune();
  });
  let view = views.get(tab.id);
  if (!view) {
    view = createReviewUi({ session: tab.appSessionId });
    view.setState({ scope: ref.scope, turnId: ref.turnId, selected: ref.path });
    views.set(tab.id, view);
  }
  return view;
}

// Tests: forget every tab's view state.
export const resetDiffTabs = () => views.clear();

function Unavailable({ message, detail }: { message: string; detail: string }) {
  return (
    <div role="status" data-review-unavailable className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
      <p className="text-ui text-fg">{message}</p>
      <p className="font-mono text-ui-sm text-fg-muted break-all">{detail}</p>
    </div>
  );
}

export function DiffTab({ tab }: { tab: DiffTabRef }) {
  const ref = parseRef(tab.ref);
  const directory = useSessions((s) => {
    const record = s.records.get(tab.appSessionId);
    return record ? (record.worktree?.path ?? record.directory) : null;
  });
  if (!ref) return <Unavailable message={REVIEW_COPY.unavailable(REVIEW_COPY.unknownRef)} detail={tab.ref} />;
  if (directory === null) return <Unavailable message={REVIEW_COPY.noSession} detail={tab.ref} />;
  return (
    <div data-diff-tab={tab.ref} className="h-full min-h-0">
      <ReviewShell key={`${tab.id}\0${directory}`} appSessionId={tab.appSessionId} directory={directory} ui={viewOf(tab, ref)} chips={false} />
    </div>
  );
}
