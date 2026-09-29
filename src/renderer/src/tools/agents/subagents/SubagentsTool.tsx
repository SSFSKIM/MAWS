// The Subagents tool (C8b execution document, Interfaces *Tools*; M2): one single-instance, pinnable tool whose view is
// the three lists or one agent's drill-in (Back is a state change; the host sees one tab). Its state is a small handle
// holding an immutable snapshot the body reads through useSyncExternalStore (under the React Compiler a body renders
// from what it selects), plus the task-graph store watch for the session it shows, released by `dispose` and moved by
// `follow` when a pinned tab's session changes under it.
import { useEffect, useSyncExternalStore } from 'react';
import type { AgentId, AppSessionId, ToolUseId } from '@shared/graph/ids';
import { Icon } from '../../../app/IconButton';
import type { PanelTool, PanelToolContext } from '../../../panel/tool';
import { AGENT_TOOL_IDS } from '../tool-ids';
import { SUBAGENTS_COPY } from '../copy';
import { useTaskGraph } from '../store';
import { AgentList } from './AgentList';
import { DrillIn, PendingAgent } from './DrillIn';
import { agentOfToolUse } from './shared';
import { SubagentsSummary } from './SubagentsSummary';

// Additive to the document's `{ agentId? }`: `toolUseId`, C6's placeholder ref before `subagent.started` names the
// agent (the pending view); `appSessionId`, the session the selection belongs to, so a pinned tab still holding another
// session's view (not shown since) follows it before selecting rather than resetting the selection when it next renders.
export interface SubagentsParams {
  agentId?: AgentId;
  toolUseId?: ToolUseId;
  appSessionId?: AppSessionId;
}

export type SubagentsView = { kind: 'lists' } | { kind: 'agent'; agentId: AgentId } | { kind: 'pending'; toolUseId: ToolUseId };
export type ListSection = 'active' | 'done' | 'disk';

// The snapshot. `appSessionId` is the session the view state belongs to, so a pinned tab never shows one session's
// drill-in over another's while the follow lands.
export interface SubagentsState {
  appSessionId: AppSessionId | null;
  view: SubagentsView;
  expanded: { active: boolean; done: boolean; disk: boolean };
  shown: { active: number; done: number };
  scrollTop: number;
  draft: string;
}

export const INITIAL_SHOWN = { active: 4, done: 10 } as const; // Codex's bounds
const LISTS: SubagentsView = { kind: 'lists' };

export class SubagentsHandle {
  private state: SubagentsState;
  private readonly listeners = new Set<() => void>();
  private release: (() => void) | null = null;
  private draftFor: AgentId | null = null; // the agent the draft was typed to: it survives Back and a return to that agent

  constructor(appSessionId: AppSessionId | null, params: SubagentsParams | undefined) {
    this.state = { appSessionId, view: LISTS, expanded: { active: true, done: true, disk: true }, shown: { ...INITIAL_SHOWN }, scrollTop: 0, draft: '' };
    this.watch(appSessionId);
    this.open(params);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  snapshot = () => this.state;

  private update(patch: Partial<SubagentsState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private watch(appSessionId: AppSessionId | null): void {
    this.release?.();
    this.release = appSessionId === null ? null : useTaskGraph.getState().watch(appSessionId);
  }

  // X5's `open`: an agent selects it; a tool use resolves to its agent when the graph or a sidecar names it, else waits
  // in the pending view; no params (the summary's Open) shows the lists.
  open = (params: SubagentsParams | undefined) => {
    if (params?.appSessionId !== undefined) this.follow(params.appSessionId);
    if (params?.agentId) return this.openAgent(params.agentId);
    if (params?.toolUseId) {
      const { appSessionId } = this.state;
      const agentId = appSessionId === null ? null : agentOfToolUse(useTaskGraph.getState().entries.get(appSessionId), params.toolUseId);
      if (agentId) return this.openAgent(agentId);
      return this.update({ view: { kind: 'pending', toolUseId: params.toolUseId } });
    }
    this.back();
  };

  // Another agent clears the draft; the same one keeps it.
  openAgent = (agentId: AgentId) => {
    const { view } = this.state;
    if (view.kind === 'agent' && view.agentId === agentId) return;
    const keep = this.draftFor === agentId;
    this.draftFor = agentId;
    this.update({ view: { kind: 'agent', agentId }, ...(keep ? {} : { draft: '' }) });
  };

  resolvePending = (toolUseId: ToolUseId, agentId: AgentId) => {
    const { view } = this.state;
    if (view.kind === 'pending' && view.toolUseId === toolUseId) this.openAgent(agentId);
  };

  back = () => {
    if (this.state.view.kind !== 'lists') this.update({ view: LISTS });
  };

  setDraft = (draft: string) => {
    if (draft !== this.state.draft) this.update({ draft });
  };

  // A relay's steer was answered: its text leaves the box, unless the draft now belongs to another agent.
  clearDraftFor = (agentId: AgentId) => {
    if (this.draftFor === agentId) this.setDraft('');
  };

  setScrollTop = (scrollTop: number) => {
    if (scrollTop !== this.state.scrollTop) this.update({ scrollTop });
  };

  toggle = (section: ListSection) => this.update({ expanded: { ...this.state.expanded, [section]: !this.state.expanded[section] } });

  showMore = (section: 'active' | 'done', count: number) => this.update({ shown: { ...this.state.shown, [section]: count } });

  // A pinned tab's session changed under it: that session's lists, with this tab's view, scroll and draft reset. No
  // session shown (the Overview) changes nothing: returning to the same session finds the tab as it was.
  follow = (appSessionId: AppSessionId | null) => {
    if (appSessionId === null || appSessionId === this.state.appSessionId) return;
    this.watch(appSessionId);
    this.draftFor = null;
    this.update({ appSessionId, view: LISTS, shown: { ...INITIAL_SHOWN }, scrollTop: 0, draft: '' });
  };

  dispose = () => {
    this.release?.();
    this.release = null;
  };
}

function SubagentsBody({ state, ctx }: { state: SubagentsHandle; ctx: PanelToolContext }) {
  const snapshot = useSyncExternalStore(state.subscribe, state.snapshot);
  useEffect(() => state.follow(ctx.appSessionId), [state, ctx.appSessionId]);
  const { appSessionId } = ctx;
  if (appSessionId === null) {
    return <p className="flex h-full items-center justify-center p-4 text-center text-ui text-fg-muted">{SUBAGENTS_COPY.noSession}</p>;
  }
  const own = snapshot.appSessionId === appSessionId; // until the follow lands, another session's view state is not shown
  const view = own ? snapshot.view : LISTS;
  if (view.kind === 'agent') return <DrillIn key={view.agentId} appSessionId={appSessionId} agentId={view.agentId} handle={state} draft={snapshot.draft} ctx={ctx} />;
  if (view.kind === 'pending') return <PendingAgent appSessionId={appSessionId} toolUseId={view.toolUseId} handle={state} />;
  return (
    <AgentList
      key={appSessionId} // another session's lists mount afresh, their scroll restored from this session's state
      appSessionId={appSessionId}
      handle={state}
      expanded={snapshot.expanded}
      shown={own ? snapshot.shown : INITIAL_SHOWN}
      scrollTop={own ? snapshot.scrollTop : 0}
      ctx={ctx}
    />
  );
}

export function SubagentsIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <circle cx="8" cy="4" r="2" />
      <circle cx="4" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M8 6v2M8 8l-3 2.4M8 8l3 2.4" />
    </Icon>
  );
}

export const subagentsTool: PanelTool<SubagentsHandle, SubagentsParams> = {
  id: AGENT_TOOL_IDS.subagents,
  title: SUBAGENTS_COPY.title,
  icon: SubagentsIcon,
  pinnable: true,
  multiInstance: false,
  createState: (init) => new SubagentsHandle(init.appSessionId, init.params),
  open: (state, params) => state.open(params),
  beforeClose: () => Promise.resolve(true), // no veto: a pending relay lives in the relay store, not in the tab
  dispose: (state) => state.dispose(),
  render: SubagentsBody,
  summary: SubagentsSummary,
};
