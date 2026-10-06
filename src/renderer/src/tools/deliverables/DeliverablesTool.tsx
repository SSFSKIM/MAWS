// E2 (M4): the Deliverables tool (E2 execution document, Design §4; X5): one single-instance, pinnable tool whose view
// is the list or one record's viewer (Back is a state change; the host sees one tab), in the Subagents tool's shape: a
// small handle holding an immutable snapshot the body reads through useSyncExternalStore. A record view carries its own
// session, since a row of the All scope belongs to another session and `deliverables.get`, the files admission and the
// scheme URL all need the record's. A pinned tab follows the shown session and returns to its list when it changes.
import { useEffect, useSyncExternalStore } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { PANES } from '@shared/maws/panes';
import type { PanelTool, PanelToolContext } from '../../panel/tool';
import { DELIVERABLES_COPY } from './copy';
import { DeliverablesSummary } from './DeliverablesSummary';
import { DeliverablesIcon } from './icons';
import { DeliverablesList, type DeliverablesScope } from './List';
import { DeliverableViewer } from './Viewer';

export const DELIVERABLES_TOOL_ID = (PANES.deliverable as { toolId: string }).toolId;

// X5 params (ledger §5): a record by its id (`target`), at a version (else the latest), of a session other than the
// shown one (`appSessionId`, an All-scope row's or a transcript row's), and the list's scope.
export interface DeliverablesParams {
  target?: string;
  appSessionId?: AppSessionId;
  version?: number;
  scope?: DeliverablesScope;
}

export type DeliverablesView = { kind: 'list' } | { kind: 'record'; appSessionId: AppSessionId; id: string; version: number | null; picking: boolean };

export interface DeliverablesState {
  appSessionId: AppSessionId | null; // the session the view state belongs to
  view: DeliverablesView;
  scope: DeliverablesScope;
  scrollTop: number;
  notice: string | null; // the list's heading after a record turned out gone
}

const LIST: DeliverablesView = { kind: 'list' };

export class DeliverablesHandle {
  private state: DeliverablesState;
  private readonly listeners = new Set<() => void>();

  constructor(appSessionId: AppSessionId | null, params: DeliverablesParams | undefined) {
    this.state = { appSessionId, view: LIST, scope: 'session', scrollTop: 0, notice: null };
    this.open(params);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  snapshot = () => this.state;

  private update(patch: Partial<DeliverablesState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  // X5's `open`: a target shows that record (of the given session, else the shown one); no target shows the list.
  open = (params: DeliverablesParams | undefined) => {
    if (params?.scope !== undefined && params.scope !== this.state.scope) this.update({ scope: params.scope });
    const appSessionId = params?.appSessionId ?? this.state.appSessionId;
    if (params?.target === undefined || appSessionId === null) return this.back();
    this.update({ view: { kind: 'record', appSessionId, id: params.target, version: params.version ?? null, picking: false }, notice: null });
  };

  openRecord = (record: DeliverableRecord) => this.open({ target: record.id, appSessionId: record.appSessionId });

  back = () => {
    if (this.state.view.kind !== 'list' || this.state.notice !== null) this.update({ view: LIST, notice: null });
  };

  // The record is gone: the list, headed by the notice (Design §4, §11).
  gone = (id: string) => this.update({ view: LIST, notice: DELIVERABLES_COPY.notRecorded(id) });

  setVersion = (version: number) => {
    const { view } = this.state;
    if (view.kind === 'record' && view.version !== version) this.update({ view: { ...view, version } });
  };

  setScope = (scope: DeliverablesScope) => {
    if (scope !== this.state.scope) this.update({ scope, scrollTop: 0 });
  };

  setScrollTop = (scrollTop: number) => {
    if (scrollTop !== this.state.scrollTop) this.update({ scrollTop });
  };

  // A pinned tab's session changed under it: that session's list. No session shown changes nothing.
  follow = (appSessionId: AppSessionId | null) => {
    if (appSessionId === null || appSessionId === this.state.appSessionId) return;
    this.update({ appSessionId, view: LIST, scrollTop: 0, notice: null });
  };
}

function DeliverablesBody({ state, ctx }: { state: DeliverablesHandle; ctx: PanelToolContext }) {
  const snapshot = useSyncExternalStore(state.subscribe, state.snapshot);
  useEffect(() => state.follow(ctx.appSessionId), [state, ctx.appSessionId]);
  const { appSessionId } = ctx;
  if (appSessionId === null) {
    return <p className="flex h-full items-center justify-center p-4 text-center text-ui text-fg-muted">{DELIVERABLES_COPY.noSession}</p>;
  }
  const own = snapshot.appSessionId === appSessionId; // until the follow lands, another session's view state is not shown
  const view = own ? snapshot.view : LIST;
  if (view.kind === 'record') {
    return (
      <DeliverableViewer
        key={`${view.appSessionId}/${view.id}`}
        appSessionId={view.appSessionId}
        id={view.id}
        version={view.version}
        mode="panel"
        onBack={state.back}
        onVersion={state.setVersion}
        onGone={state.gone}
      />
    );
  }
  return (
    <DeliverablesList
      key={appSessionId} // another session's list mounts afresh, its scroll restored from this state
      appSessionId={appSessionId}
      scope={snapshot.scope}
      scrollTop={own ? snapshot.scrollTop : 0}
      notice={own ? snapshot.notice : null}
      onScope={state.setScope}
      onScroll={state.setScrollTop}
      onOpen={state.openRecord}
    />
  );
}

export const deliverablesTool: PanelTool<DeliverablesHandle, DeliverablesParams> = {
  id: DELIVERABLES_TOOL_ID,
  title: DELIVERABLES_COPY.title,
  icon: DeliverablesIcon,
  pinnable: true,
  multiInstance: false,
  menu: true,
  createState: (init) => new DeliverablesHandle(init.appSessionId, init.params),
  open: (state, params) => state.open(params),
  beforeClose: () => Promise.resolve(true),
  dispose: () => {}, // the store is the window's; the handle holds nothing to release
  render: DeliverablesBody,
  summary: DeliverablesSummary,
};
