// The Source control tool (E6 execution document, Design §5, T3.4; UX wave U5b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md,
// M10 and §H): X5's declaration. `id: 'source-control'` (the interface ledger's `show_pane` value), pinnable,
// single-instance; it mounts Source control's page, a page to read that changes nothing, and takes no params (a
// `show_pane` for it that names a file opens Review there, tools/maws/panes/connect.ts). Its state is a store handle (C8a's
// React Compiler rule) holding the page's own two folds, reset when the session or its working folder changes. The git
// watch and the branch read are the mounted page's, so `dispose` has nothing to release. No summary: the summary card's
// row is E6's edit of PushState (Design §6).
import { useEffect } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { PanelTool, PanelToolContext, PanelToolInit } from '../../panel/tool';
import { SCM_COPY } from './copy';
import { createPageUi, FOLDED, SourceControlPage, type PageUi } from './SourceControlPage';
import { workingFolder } from '@shared/sessions/working-folder';

export const SCM_TOOL_ID = 'source-control';

export interface ScmState {
  readonly ui: StoreApi<PageUi>;
}

function createState({ appSessionId, session }: PanelToolInit): ScmState {
  return { ui: createPageUi(appSessionId, session ? workingFolder(session).path : null) };
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
  const directory = ctx.session ? workingFolder(ctx.session).path : null;
  // A pinned tool shown for another session starts over there, and so does a session whose working folder changed (UX
  // wave U8c-2: the agent moved): the two folds go back to folded. Until then nothing renders, so nothing of the old
  // checkout is shown or read for the new one.
  const synced = useStore(ui, (s) => s.session === shown && s.directory === directory);
  useEffect(() => {
    if (!synced) ui.setState({ session: shown, directory, ...FOLDED });
  }, [ui, shown, directory, synced]);

  if (shown === null || directory === null) {
    return <p className="flex h-full items-center justify-center p-4 text-center text-ui text-fg-muted">{SCM_COPY.noSession}</p>;
  }
  if (!synced) return null;
  return <SourceControlPage key={`${shown}\0${directory}`} appSessionId={shown} directory={directory} ui={ui} visible={ctx.visible} />;
}

export const scmTool: PanelTool<ScmState> = {
  id: SCM_TOOL_ID,
  title: SCM_COPY.title,
  icon: ScmIcon,
  pinnable: true,
  multiInstance: false,
  createState,
  beforeClose: async () => true, // the folds are state the host drops with the tab
  dispose: () => {}, // the watch and the branch read are the mounted page's, released when it unmounts
  render: ScmBody,
};
