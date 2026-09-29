// The `#panel` page's block for the agent tools (C8b execution document, Interfaces *Harness API*; M4). `installAgentsHarness`
// registers Subagents, Background work and the Log before the page registers its own tools (so the page's `log` stub
// yields to the real Log), installs the fake agent-work client (the tools' and stores' only route to X2 here) and sets
// the drill-in's `childSourceFor` seam to the loaded fixture's `HarnessSession.childSource`, one source object per
// child, so the drill-in and a second child transcript share one store attachment as C5's agent tab and the drill-in do
// in the product. `feed` binds the fake client's wire half to the loaded player and starts the task graph over. The
// column (`AgentsHarnessBlock`) renders the fed session's transcript with `agentTranscriptActions`, so a subagent row and
// "Open full log" are the real hand-offs, and, when asked, a second child transcript standing in for C5's agent tab. A
// child's permission request seeds C5's attention store as main's attention service would (nothing supplies it here),
// so C7's inline card renders in the drill-in and the row reads `waiting`.
import { useSyncExternalStore } from 'react';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, AttentionId, TaskId } from '@shared/graph/ids';
import { useAttention } from '../../stores/attention';
import { useSessions } from '../../stores/sessions';
import { agentTranscriptActions, registerAgentTools, useRelays, useTaskGraph } from '../../tools/agents';
import { setAgentWorkClient } from '../../tools/agents/client';
import { setChildSourceFor } from '../../tools/agents/subagents/DrillIn';
import { Transcript, useTranscriptStore, type SubagentRef, type TranscriptSource } from '../../transcript';
import type { TranscriptListHandle } from '../../transcript/view/Transcript';
import { loadFixture } from '../fixtures';
import type { HarnessSession } from '../player';
import { FAKE_RECORDS, fakeId, liveStatus } from '../panel/fakeSessions';
import { loadedSession, summaryProbes } from '../panel/summaryProbes';
import type { AgentsFakeId } from './api';
import { createFakeAgentWorkClient, snapshotOf, type FakeWire } from './fakeClient';

export const REPLAY_LAUNCH = 'journal'; // the launch segment of every replayed and derived event id

export const fake = createFakeAgentWorkClient({ session: fakeId('A') });

// ---- the column's state: what was fed, and the second child transcript -------------------------------------------------

interface ColumnView {
  session: HarnessSession | null; // the fed session A's transcript
  agentTab: AgentId | null;
}
let view: ColumnView = { session: null, agentTab: null };
const viewListeners = new Set<() => void>();
const setView = (patch: Partial<ColumnView>) => {
  view = { ...view, ...patch };
  viewListeners.forEach((listener) => listener());
};
const subscribeView = (listener: () => void) => {
  viewListeners.add(listener);
  return () => void viewListeners.delete(listener);
};
const currentView = () => view;
export const columnView = currentView;
export const setAgentTab = (agentId: AgentId | null) => setView({ agentTab: agentId });

// The column's session transcript list, for the probes (scrolling to reach a row the virtualiser has not mounted).
export const columnHandle: { current: TranscriptListHandle | null } = { current: null };

// ---- the drill-in's child source ----------------------------------------------------------------------------------------

const childSources = new WeakMap<HarnessSession, Map<string, TranscriptSource>>();
const emptySource = (key: string): TranscriptSource => ({ key, snapshot: () => Promise.resolve([]), subscribe: () => () => {} });

// The ref C6's childSource reads: the agent's id and the tool use that dispatched it (the parent's activity knows it, else
// the task graph's start event); with neither, the child's own events are found by their agent id.
function refOf(session: HarnessSession, appSessionId: AppSessionId, agentId: AgentId): SubagentRef {
  const fromActivity = useTranscriptStore
    .getState()
    .activity(session.key)
    .flatMap((turn) => turn.subagents)
    .find((ref) => (ref.agentId ?? ref.taskId) === (agentId as string));
  if (fromActivity) return fromActivity;
  const node = useTaskGraph.getState().entries.get(appSessionId)?.graph.tasks.get(agentId as string as TaskId);
  return { taskId: agentId, agentId, toolUseId: node?.toolUseId ?? null } as unknown as SubagentRef;
}

export function childSourceFor(appSessionId: AppSessionId, agentId: AgentId): TranscriptSource {
  const session = loadedSession(appSessionId);
  if (!session) return emptySource(`${appSessionId}:${agentId}`); // nothing loaded: nothing to show (never the real bridge)
  let known = childSources.get(session);
  if (!known) childSources.set(session, (known = new Map()));
  let source = known.get(agentId);
  if (!source) known.set(agentId, (source = session.childSource(refOf(session, appSessionId, agentId))));
  return source;
}

// ---- attention: a child's permission request, as main's attention service would list it ---------------------------------

function seedAttention(appSessionId: AppSessionId, events: SessionEvent[]): void {
  for (const event of events) {
    if (event.kind === 'permission.requested' && event.agentId !== null) {
      const item: AttentionItem = {
        id: `harness-attention-${event.requestId}` as AttentionId,
        appSessionId,
        sessionId: event.sessionId,
        kind: 'permission',
        request: { requestId: event.requestId, toolUseId: event.toolUseId, taskId: null, agentId: event.agentId },
        summary: event.toolName,
        createdAt: event.at,
        state: 'pending',
        stateChangedAt: event.at,
        expiresAt: null,
      };
      useAttention.setState((s) => {
        const items = (s.bySession.get(appSessionId) ?? []).filter((other) => other.id !== item.id);
        return {
          bySession: new Map(s.bySession).set(appSessionId, [...items, item]),
          version: s.version + 1,
          requests: new Map(s.requests).set(item.id, event), // the card makes no attention.request call
        };
      });
    }
    if (event.kind === 'permission.resolved') {
      useAttention.setState((s) => {
        const items = s.bySession.get(appSessionId) ?? [];
        const kept = items.filter((item) => item.request.requestId !== event.requestId);
        return kept.length === items.length ? {} : { bySession: new Map(s.bySession).set(appSessionId, kept), version: s.version + 1 };
      });
    }
  }
}

// ---- install and feed -----------------------------------------------------------------------------------------------------

// Every `attach` into the transcript store, by key: the calls and the distinct sources (the shared-attachment case: one
// source attached twice is one attachment, counted twice; a second source would replace the first).
const attachLog = new Map<string, { attaches: number; sources: Set<TranscriptSource> }>();
export const attachesOf = (key: string) => attachLog.get(key) ?? { attaches: 0, sources: new Set<TranscriptSource>() };

let installed = false;
export function installAgentsHarness(): void {
  if (installed) return; // once per page load: registration is never undone (a registration's disposer closes the tabs)
  installed = true;
  registerAgentTools();
  setAgentWorkClient(fake.client);
  setChildSourceFor(childSourceFor);
  fake.client.onEventBatch(({ appSessionId, events }) => seedAttention(appSessionId, events));
  const attach = useTranscriptStore.getState().attach;
  useTranscriptStore.setState({
    attach(key, source, options) {
      const logged = attachLog.get(key) ?? { attaches: 0, sources: new Set<TranscriptSource>() };
      attachLog.set(key, { attaches: logged.attaches + 1, sources: logged.sources.add(source) });
      return attach(key, source, options);
    },
  });
}

// The fed status: A's live status with the replayed ids' launch, and no background task the fixture did not start.
function fedStatus(id: AgentsFakeId) {
  return { ...liveStatus(FAKE_RECORDS.get(fakeId(id))!), launchId: REPLAY_LAUNCH, backgroundTasks: [] };
}

const watching = new Map<AppSessionId, () => void>();
const fedEvents = new Map<AppSessionId, SessionEvent[]>();

export async function feed(id: AgentsFakeId, fixture: string): Promise<void> {
  const appSessionId = fakeId(id);
  const session = loadedSession(appSessionId);
  if (!session) throw new Error(`agents.feed: load a transcript into ${id} first (panel.loadTranscript)`);
  const { events } = await loadFixture(fixture);
  reset(id, () => {
    const wire: FakeWire = {
    snapshot: (afterSeq) => snapshotOf(events, useTranscriptStore.getState().entries[appSessionId]?.state.seen ?? new Set(), afterSeq),
    subscribe: (listener) => session.player.subscribe(listener),
    };
    fake.bindWire(appSessionId, wire);
    fedEvents.set(appSessionId, events);
    seedAttention(appSessionId, wire.snapshot(null).events);
  });
  setView({ session, agentTab: null });
}

// Starts the session's task graph over: the wire goes (a snapshot in flight is stale), the entry and the session's relays
// are dropped, `bind` runs (feed's new wire), the status comes back with the replayed launch and no background task the
// facts did not start, the session is watched, and the disk half is announced again so the new entry merges it.
export function reset(id: AgentsFakeId, bind: () => void = () => fake.bindWire(fakeId(id), null)): void {
  const appSessionId = fakeId(id);
  const status = useSessions.getState().engine.get(appSessionId) ?? null;
  if (status) summaryProbes.setStatus(id, null);
  useTaskGraph.setState((s) => {
    const entries = new Map(s.entries);
    entries.delete(appSessionId);
    return { entries };
  });
  for (const key of useRelays.getState().relays.keys()) if (key.startsWith(`${appSessionId}:`)) useRelays.getState().dismiss(key);
  bind();
  if (status) summaryProbes.setStatus(id, { ...status, launchId: REPLAY_LAUNCH, backgroundTasks: [] });
  if (!watching.has(appSessionId)) watching.set(appSessionId, useTaskGraph.getState().watch(appSessionId));
  fake.announceDisk();
}

export function patchStatus(id: AgentsFakeId, patch: Partial<EngineSessionStatus>): void {
  const current = useSessions.getState().engine.get(fakeId(id)) ?? fedStatus(id);
  summaryProbes.setStatus(id, { ...current, ...patch });
}

// The fed fixture's events through `seq` that the transcript has not applied yet, released through C8a's probe (the
// player releases in fixture order, so they are the next ones).
export function releaseThrough(id: AgentsFakeId, seq: number): number {
  const appSessionId = fakeId(id);
  const seen = useTranscriptStore.getState().entries[appSessionId]?.state.seen ?? new Set();
  const n = (fedEvents.get(appSessionId) ?? []).filter((event) => event.seq !== null && event.seq <= seq && !seen.has(event.id)).length;
  return summaryProbes.transcript(id).release(n);
}

// ---- the column -------------------------------------------------------------------------------------------------------

export function AgentsHarnessBlock() {
  const { session, agentTab } = useSyncExternalStore(subscribeView, currentView);
  if (!session) return null;
  const A = fakeId('A');
  return (
    <div data-agents-harness className="mt-3 flex flex-col gap-2 border-t border-border pt-3 font-sans">
      <p>agents: the fed transcript of A</p>
      <div data-agents-harness-transcript className="flex h-[26rem] min-h-0 flex-col rounded-sm border border-border bg-bg">
        <Transcript key={session.key} source={session.source} variant="session" actions={agentTranscriptActions} handle={columnHandle} className="min-h-0 flex-1" />
      </div>
      {agentTab !== null && (
        <div data-agents-harness-agent-tab={agentTab} className="flex h-64 min-h-0 flex-col rounded-sm border border-border bg-bg">
          <Transcript key={`${session.key}:${agentTab}`} source={childSourceFor(A, agentTab)} variant="child" className="min-h-0 flex-1" />
        </div>
      )}
    </div>
  );
}
