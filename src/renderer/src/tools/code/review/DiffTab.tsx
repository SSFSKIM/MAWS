// The `diffTab` slot (C8c execution document, M3's decisions; K4): Review in the main area for a `ref`
// (`scope [' @ ' path]`, a TurnId its own scope word), beside the transcript. The same shell and the same data as the
// panel's Review (one `git.diff` per directory and scope, shared), with its own view state per tab (mode, selection,
// hunk, scroll, viewed marks), so the two share data and not scroll. A ref's scope is the tab's identity (C5's tab id
// holds it), so the tab shows no scope chips.
import { useEffect } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { TabRef } from '@shared/ipc/schema/layout';
import { useWorkingFolder } from '../../../sessions/working-folder';
import { useLayout } from '../../../stores/layout';
import { allTabs } from '../../../stores/layout-model';
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

type Ref = NonNullable<ReturnType<typeof parseRef>>;

// A tab's view as its ref starts it in `directory`: the ref's scope, turn and file, the scroll at the top.
const fromRef = (ref: Ref, directory: string): Partial<ReviewUi> => ({ directory, scope: ref.scope, turnId: ref.turnId, selected: ref.path, hunk: 0, scrollTop: 0, redecide: null });

function viewOf(tab: DiffTabRef, ref: Ref, directory: string): StoreApi<ReviewUi> {
  following ??= useLayout.subscribe((state, prev) => {
    if (state.main !== prev.main) prune();
  });
  let view = views.get(tab.id);
  if (!view) {
    view = createReviewUi({ session: tab.appSessionId });
    view.setState(fromRef(ref, directory));
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
  const directory = useWorkingFolder(tab.appSessionId)?.path ?? null;
  if (!ref) return <Unavailable message={REVIEW_COPY.unavailable(REVIEW_COPY.unknownRef)} detail={tab.ref} />;
  if (directory === null) return <Unavailable message={REVIEW_COPY.noSession} detail={tab.ref} />;
  return <DiffTabBody tab={tab} parsed={ref} directory={directory} />;
}

// UX wave U8c-2 (M4 decision 5): a change of the session's working folder starts the tab again from its ref there, as
// the tool starts over; nothing renders until then, so nothing chosen in the old folder is applied to the new one.
function DiffTabBody({ tab, parsed, directory }: { tab: DiffTabRef; parsed: Ref; directory: string }) {
  const ui = viewOf(tab, parsed, directory);
  const synced = useStore(ui, (s) => s.directory === directory);
  useEffect(() => {
    if (!synced) ui.setState(fromRef(parsed, directory));
  }, [ui, parsed, directory, synced]);
  if (!synced) return null;
  return (
    <div data-diff-tab={tab.ref} className="h-full min-h-0">
      <ReviewShell key={`${tab.id}\0${directory}`} appSessionId={tab.appSessionId} directory={directory} ui={ui} chips={false} />
    </div>
  );
}
