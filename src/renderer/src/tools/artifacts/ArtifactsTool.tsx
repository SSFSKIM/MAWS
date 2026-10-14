// The panel's Artifacts tool (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5; Decision Log 8, 21a, 25b): one
// single-instance, pinnable tool whose view is the session's list or one artifact's record view (Back is a state change;
// the host sees one tab), in E2's Deliverables tool's shape: a small handle holding an immutable snapshot the body reads
// through useSyncExternalStore. M6b: the Deliverables tool is gone; this is the `artifact` pane's tool (`show_pane`).
//
// X32's lifetime rule: the editor a record view mounts keeps its state in the registry's hold for this tab's scope, so
// its closeGuard and actions read it while the tab is hidden. The handle gives that state back, and clears the editor's
// header registration, whenever the tab stops showing that artifact: at Back, at a re-target to another artifact (or to
// the list) and when the host disposes the instance; a body unmounting because the tab went inactive keeps both. Back
// and a re-target ask the editor's closeGuard first, as closing the tab does (the host asks it before disposing): a
// false keeps the record view, so a replica with unacknowledged edits is not dropped by a move the owner did not
// confirm. While the tab is closing (from the host marking it closing, in the tick it asks the shown editor's guard,
// until the close resolves) the record view is frozen: a Back or re-target asked meanwhile is dropped (not replayed
// after a veto, which would ask the guard the owner just answered again), and a move already waiting on a guard does not
// land. So the guard the host asked covers the only artifact the close can dispose.
//
// Artifacts belong to no session (§4.1), so a pinned tab keeps the artifact it shows when the shown session changes; its
// list follows the shown session.
import { useEffect, useSyncExternalStore } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { ARTIFACTS_TOOL_ID } from '@shared/maws/panes';
import { Icon } from '../../app/IconButton';
import type { ArtifactOpenAt } from '../../artifacts/open-at';
import { releaseArtifactEditorState } from '../../artifacts/registry';
import { askEditorHostClose, clearEditorHost, type EditorHostScope } from '../../panel/editor-host';
import { panelHost, usePanelHost } from '../../panel/host';
import type { PanelTool, PanelToolContext } from '../../panel/tool';
import { ARTIFACTS_TOOL_COPY } from './copy';
import { ArtifactsList, type ArtifactsScope } from './List';
import { ArtifactRecordView } from './RecordView';
import { ArtifactsSummary } from './Summary';
import { cancelVersionRequest, requestArtifactVersion } from './viewers/requests';

// The panel tool's id (shared with `show_pane`'s `artifact` pane); E2's Deliverables tool's (`deliverables`) gave way
// to it at the cutover (Decision Log 10).
export { ARTIFACTS_TOOL_ID };

// X5 params: an artifact to show (`target`; none shows the list), the version of it to show (`at`, M6b fix wave 2;
// none: the latest), and the list's scope.
export interface ArtifactsParams {
  target?: string;
  at?: ArtifactOpenAt;
  scope?: ArtifactsScope;
}

// An artifact in the panel's Artifacts tool, in the session's panel, activated (P3-L M5b: the comment card's re-dock;
// M6b: a transcript row's Open, `TranscriptActions.openArtifact`), at the version `at` asks for (none: the latest,
// followed as new ones land). Until a build registers the tool, nothing.
export function openArtifactInPanel(appSessionId: AppSessionId, artifactId: string, at?: ArtifactOpenAt): void {
  if (!usePanelHost.getState().tools.has(ARTIFACTS_TOOL_ID)) return;
  panelHost.addTool<ArtifactsParams>(ARTIFACTS_TOOL_ID, { appSessionId, params: { target: artifactId, ...(at !== undefined && { at }) }, activate: true });
}

export type ArtifactsView = { kind: 'list' } | { kind: 'record'; artifactId: string };

export interface ArtifactsState {
  appSessionId: AppSessionId | null; // the session the list belongs to
  view: ArtifactsView;
  scope: ArtifactsScope;
  scrollTop: number;
}

const LIST: ArtifactsView = { kind: 'list' };

export class ArtifactsHandle {
  private state: ArtifactsState;
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private closing = false; // the host is closing the tab: record moves are frozen
  private readonly unwatchClose: () => void;

  constructor(
    readonly editorScope: EditorHostScope,
    appSessionId: AppSessionId | null,
    params: ArtifactsParams | undefined,
  ) {
    this.state = { appSessionId, view: LIST, scope: 'session', scrollTop: 0 };
    this.open(params);
    // The host marks the tab closing in the tick it asks the editor's guard, before any move can land.
    this.unwatchClose = usePanelHost.subscribe((now) => {
      this.closing = now.closing.has(editorScope.tabId);
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  snapshot = () => this.state;

  private update(patch: Partial<ArtifactsState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  // The tab stops showing its artifact: the editor's state and its header registration go.
  private leave(): void {
    if (this.state.view.kind !== 'record') return;
    releaseArtifactEditorState(this.editorScope);
    clearEditorHost(this.editorScope);
  }

  // Moves away from the artifact shown (if any) once its editor's closeGuard allows: at once when there is no guard,
  // else after it answers true, and only if nothing else moved the view meanwhile and the tab is not closing. `refused`
  // runs when the move does not happen.
  private leaveThen(view: ArtifactsView, refused: () => void = () => {}): void {
    if (this.closing) return refused();
    const shown = this.state.view;
    const go = () => {
      this.leave();
      this.update({ view });
    };
    if (shown.kind !== 'record') return go();
    const asked = askEditorHostClose(this.editorScope);
    if (asked === null) return go();
    void asked.then((allowed) => {
      if (allowed && !this.disposed && !this.closing && this.state.view === shown) go();
      else refused();
    });
  }

  // X5's `open`: a target shows that artifact (the one already shown keeps its state) at the version `at` asks for (fix
  // wave 2: every open asks, the latest when it names none, superseding any earlier ask; a move the guard refused
  // cancels its own); no target shows the list.
  open = (params: ArtifactsParams | undefined) => {
    if (params?.scope !== undefined && params.scope !== this.state.scope) this.update({ scope: params.scope, scrollTop: 0 });
    const target = params?.target;
    if (target === undefined) return this.back();
    const serial = requestArtifactVersion(target, params?.at ?? 'latest', this.editorScope.surface);
    const { view } = this.state;
    if (view.kind === 'record' && view.artifactId === target) return;
    this.leaveThen({ kind: 'record', artifactId: target }, () => cancelVersionRequest(serial));
  };

  back = () => {
    if (this.state.view.kind !== 'list') this.leaveThen(LIST);
  };

  setScope = (scope: ArtifactsScope) => {
    if (scope !== this.state.scope) this.update({ scope, scrollTop: 0 });
  };

  setScrollTop = (scrollTop: number) => {
    if (scrollTop !== this.state.scrollTop) this.update({ scrollTop });
  };

  // A pinned tab's session changed under it: the list is that session's; an artifact shown stays. No session shown
  // changes nothing.
  follow = (appSessionId: AppSessionId | null) => {
    if (appSessionId === null || appSessionId === this.state.appSessionId) return;
    this.update({ appSessionId, scrollTop: 0 });
  };

  // The host disposes after the tab's close asked the guard, or without asking when the tab's session went.
  dispose = () => {
    this.disposed = true;
    this.unwatchClose();
    this.leave();
  };
}

function ArtifactsBody({ state, ctx }: { state: ArtifactsHandle; ctx: PanelToolContext }) {
  const snapshot = useSyncExternalStore(state.subscribe, state.snapshot);
  useEffect(() => state.follow(ctx.appSessionId), [state, ctx.appSessionId]);
  const { view } = snapshot;
  if (view.kind === 'record') return <ArtifactRecordView key={view.artifactId} artifactId={view.artifactId} scope={state.editorScope} visible={ctx.visible} onBack={state.back} />;
  const own = snapshot.appSessionId === ctx.appSessionId; // until the follow lands, another session's scroll is not restored
  return (
    <ArtifactsList
      key={ctx.appSessionId ?? ''} // another session's list mounts afresh, its scroll restored from this state
      appSessionId={ctx.appSessionId}
      scope={snapshot.scope}
      scrollTop={own ? snapshot.scrollTop : 0}
      onScope={state.setScope}
      onScroll={state.setScrollTop}
      onOpen={(target) => state.open({ target })}
    />
  );
}

// A grid of four squares, the library's glyph (the sidebar's Artifacts row draws the same).
export const ArtifactsIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
  </Icon>
);

export const artifactsTool: PanelTool<ArtifactsHandle, ArtifactsParams> = {
  id: ARTIFACTS_TOOL_ID,
  title: ARTIFACTS_TOOL_COPY.title,
  icon: ArtifactsIcon,
  pinnable: true,
  multiInstance: false,
  menu: true,
  createState: (init) => new ArtifactsHandle({ surface: 'panel', tabId: init.instanceId }, init.appSessionId, init.params),
  open: (state, params) => state.open(params),
  beforeClose: () => Promise.resolve(true), // the editor's own closeGuard is asked by the host first (X32), the view frozen meanwhile
  dispose: (state) => state.dispose(),
  render: ArtifactsBody,
  summary: ArtifactsSummary, // M6b: the panel summary's Artifacts section
};
