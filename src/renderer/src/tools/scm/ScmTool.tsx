// The Source control tool (E6 execution document, Design §5, T3.4): X5's declaration. `id: 'source-control'` (the
// interface ledger's `show_pane` value), pinnable, single-instance, `params { target? }`, `open` re-targeting. Its
// state is a store handle (C8a's React Compiler rule): the selection, the diff's place, the collapsed groups, the commit
// draft per session, the open sheet, the last commit and the notice. The git watch and the diffs are the mounted body's
// (the host unmounts an unselected tool), so `dispose` has nothing to release. No summary: the summary card's row is
// E6's edit of PushState (Design §6).
import { useEffect } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { PanelTool, PanelToolContext, PanelToolInit } from '../../panel/tool';
import { SCM_COPY } from './copy';
import { ScmShell } from './ScmShell';
import { createScmUi, forFolder, forSession, type ScmParams, type ScmUi } from './view-state';
import { workingFolder } from '@shared/sessions/working-folder';

export const SCM_TOOL_ID = 'source-control';

export interface ScmState {
  readonly ui: StoreApi<ScmUi>;
}

// `params` is undefined for a tab restored from layout.json (X5); a request is applied by the body once the shown
// session's status is known.
function createState({ appSessionId, session, params }: PanelToolInit<ScmParams>): ScmState {
  return { ui: createScmUi({ session: appSessionId, directory: session ? workingFolder(session).path : null, params: params ?? null }) };
}

// Re-targeting (X5): E1's `show_pane { pane: 'source-control', target }` and the summary's row pass `{ target? }`; the
// body selects the target in whichever group lists it, since `addTool` activates the target session with the tab.
function open(state: ScmState, params: ScmParams | undefined): void {
  state.ui.setState({ request: params ?? {} });
}

export function ScmIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5.5" r="1.5" />
      <path d="M4.5 5v6M11.5 7c0 2.5-3 3-6.2 4.3" />
    </svg>
  );
}

function ScmBody({ state, ctx }: { state: ScmState; ctx: PanelToolContext }) {
  const { ui } = state;
  const shown = ctx.appSessionId;
  const folder = ctx.session ? workingFolder(ctx.session) : null;
  const directory = folder?.path ?? null;
  // A pinned tool shown for another session starts over there (each session's draft comes back to it), and so does a
  // session whose working folder changed (UX wave U8c-2: the agent moved; its draft stays); until then nothing renders,
  // so nothing of the old checkout is shown, read or acted on for the new one.
  const synced = useStore(ui, (s) => s.session === shown && s.directory === directory);
  useEffect(() => {
    if (!synced) ui.setState((s) => ({ ...forSession(s, shown), ...forFolder(s, directory) }));
  }, [ui, shown, directory, synced]);

  if (shown === null || folder === null || directory === null) {
    return <p className="flex h-full items-center justify-center p-4 text-center text-ui text-fg-muted">{SCM_COPY.noSession}</p>;
  }
  if (!synced) return null;
  // M4 decision 6: while the session works away from its launch folder the page draws its reads and none of its acts
  return <ScmShell key={`${shown}\0${directory}`} appSessionId={shown} directory={directory} ui={ui} acts={!folder.moved} />;
}

export const scmTool: PanelTool<ScmState, ScmParams> = {
  id: SCM_TOOL_ID,
  title: SCM_COPY.title,
  icon: ScmIcon,
  pinnable: true,
  multiInstance: false,
  createState,
  open,
  beforeClose: async () => true, // a draft message is state the host drops with the tab, as Review drops its selection
  dispose: () => {}, // the watch and the diffs are the mounted body's, released when it unmounts
  render: ScmBody,
};
