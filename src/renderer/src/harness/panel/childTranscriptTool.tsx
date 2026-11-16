// The harness-only `child` tool (C8a execution document, M4; R7): C6's `Transcript variant: 'child'` inside the panel
// region, over `HarnessSession.childSource(ref)` for the first child agent of the transcript loaded into the tab's
// session, exactly the seam C8b's drill-in mounts. The tool builds no source of its own. `childProbes` is
// `window.__maws_harness.panel.child`: it steps the parent's player (the child's events arrive through childSource's
// filter) and reads what R7 asserts about the container at each width.
import { useEffect, useSyncExternalStore, type RefObject } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { Icon } from '../../app/IconButton';
import { ipc } from '../../ipc/client';
import type { PanelTool } from '../../panel/tool';
import { useAttention } from '../../stores/attention';
import { useTranscriptStore } from '../../stores/transcript';
import { Transcript, type SubagentRef, type TranscriptSource } from '../../transcript';
import { OVERSCAN, type TranscriptListHandle } from '../../transcript/view/Transcript';
import type { HarnessSession } from '../player';
import type { PanelChildMetrics, PanelHarnessApi } from './api';
import { loadedSession, onTranscriptLoaded } from './summaryProbes';

export const CHILD_TOOL_ID = 'child';

// What the tab shows: the transcript loaded into its session, that transcript's first child agent (as the parent's
// activity names it) and the child's source. An immutable snapshot, replaced when a load lands (the React Compiler
// memoises a body on its inputs, so the body reads this through useSyncExternalStore, never the mutable state).
export interface ChildView {
  session: HarnessSession | null;
  ref: SubagentRef | null;
  source: TranscriptSource | null;
}
const NOTHING: ChildView = { session: null, ref: null, source: null };

export class ChildTabState {
  readonly handle: RefObject<TranscriptListHandle | null> = { current: null };
  private view: ChildView = NOTHING;
  private readonly listeners = new Set<() => void>();

  // A load into the tab's session rebinds it, selected or not.
  private readonly offLoads = onTranscriptLoaded((appSessionId) => {
    if (appSessionId === this.appSessionId) this.resolve();
  });

  constructor(readonly appSessionId: string | null) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  snapshot = () => this.view;

  // Binds the tab to the transcript loaded into its session now: at creation, on open(), when a load lands and
  // wherever the source is first needed. A tab created or restored before the load finds its child once it lands; a
  // later load (which retired the previous player and its children's keys) rebinds it to the new one.
  resolve(): ChildView {
    const session = this.appSessionId ? loadedSession(this.appSessionId) : null;
    if (session === this.view.session && (this.view.source !== null || session === null)) return this.view;
    const ref = session ? firstChild(session) : null;
    if (session === this.view.session && ref === null) return this.view;
    this.release();
    this.view = { session, ref, source: session && ref ? session.childSource(ref) : null };
    this.listeners.forEach((listener) => listener());
    return this.view;
  }

  // The child's entry leaves the store, so the next binding starts the child over; the requests it raised leave the
  // session's attention list with it.
  private release(): void {
    if (this.view.source?.key) useTranscriptStore.getState().drop(this.view.source.key);
    if (this.raised && this.appSessionId) useAttention.getState().applyChanged({ appSessionId: this.appSessionId as AppSessionId, items: [] }, ipc.localMachine);
    this.raised = false;
  }

  // UX wave U1b: nothing answers `attention.list` on this page, so the requests the child's transcript holds pending (the
  // fixture's own `permission.requested` events) reach the tab's session's list as main's attention service lists them
  // (the broker's item: its ids and agent from the event, its summary), applied as an `attention.changed` of that session
  // is. The child's transcript, keyed under that session, then places each at its end and its call's row says it waits.
  private raised = false;
  raisePending(): number {
    const key = this.view.source?.key;
    const appSessionId = this.appSessionId as AppSessionId | null;
    if (!key || !appSessionId) throw new Error('child: no child tab open over a loaded transcript');
    const pending = [...(useTranscriptStore.getState().entries[key]?.state.pending.values() ?? [])];
    const items = pending.flatMap((event): AttentionItem[] => (event.kind === 'permission.requested' ? [brokerItem(appSessionId, event)] : []));
    useAttention.getState().applyChanged({ appSessionId, items }, ipc.localMachine);
    this.raised = true;
    return items.length;
  }

  dispose(): void {
    this.offLoads();
    this.release();
  }
}

// A permission request's attention item as the engine host's broker lists it (`src/engine-host/broker.ts`, `shapeOf`).
function brokerItem(appSessionId: AppSessionId, event: Extract<SessionEvent, { kind: 'permission.requested' }>): AttentionItem {
  const input = (event.input ?? {}) as { command?: unknown; description?: unknown };
  const name = event.displayName ?? event.toolName;
  const detail = typeof input.command === 'string' ? input.command : (event.description ?? (typeof input.description === 'string' ? input.description : ''));
  return {
    id: addressOf(ipc.localMachine, `harness-attention-${event.requestId}` as AttentionId),
    appSessionId,
    sessionId: event.sessionId,
    kind: 'permission',
    request: { requestId: event.requestId, toolUseId: event.toolUseId, taskId: null, agentId: event.agentId },
    summary: detail.length > 0 ? `${name}: ${detail.slice(0, 80)}` : name,
    createdAt: event.at,
    state: 'pending',
    stateChangedAt: event.at,
    expiresAt: null,
  };
}

// The newest instance: what the probes act on (the tool is single-instance).
let current: ChildTabState | null = null;

function firstChild(session: HarnessSession): SubagentRef | null {
  return useTranscriptStore.getState().activity(session.key).flatMap((turn) => turn.subagents)[0] ?? null; // the ref, with its status
}

export const childTranscriptTool: PanelTool<ChildTabState> = {
  id: CHILD_TOOL_ID,
  title: 'Child transcript',
  icon: ChildIcon,
  pinnable: false,
  multiInstance: false,
  menu: false, // opened by the harness API only, so "+" lists what the product would
  createState(init) {
    const state = new ChildTabState(init.appSessionId);
    state.resolve();
    current = state;
    return state;
  },
  open(state) {
    state.resolve();
    current = state;
  },
  beforeClose: () => Promise.resolve(true),
  dispose(state) {
    state.dispose(); // the next tab starts the child over
    if (current === state) current = null;
  },
  render: ChildBody,
};

function ChildBody({ state }: { state: ChildTabState }) {
  const view = useSyncExternalStore(state.subscribe, state.snapshot);
  useEffect(() => void state.resolve(), [state]); // wherever the source is first needed: here, on mount
  if (!view.source) {
    return <p className="flex h-full items-center justify-center p-4 text-center text-ui text-fg-muted">Load a transcript with a child agent into this session first.</p>;
  }
  return <Transcript key={view.source.key} source={view.source} variant="child" handle={state.handle} className="h-full" />;
}

function ChildIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M4 3v6a2 2 0 0 0 2 2h6" />
      <path d="M10 9l2 2-2 2" />
    </Icon>
  );
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const bound = () => current?.resolve() ?? null; // the source is resolved wherever it is first needed
const childKey = () => bound()?.source?.key ?? null;
const rowsOfChild = () => {
  const key = childKey();
  return key ? useTranscriptStore.getState().rows(key) : [];
};

// UX wave U8b: a group's body is named by its group, so the child's is the tab panel of the surface that shows it.
const bodyElement = () => document.querySelector<HTMLElement>(`[data-surface="${CHILD_TOOL_ID}"] [role="tabpanel"]`);
// The region’s scroll slot wraps the surface stack; an individual tool body lives inside its own section.
const slotElement = () => bodyElement()?.closest<HTMLElement>('[data-surface-stack]')?.parentElement ?? null;

export const childProbes: PanelHarnessApi['child'] = {
  async release(n) {
    const session = bound()?.session;
    if (!session) throw new Error('child: no child tab open over a loaded transcript');
    for (let i = 0; i < n && !session.player.done; i += 1) session.player.step();
    await frame();
    await frame();
    return rowsOfChild().length;
  },

  async raisePending() {
    if (!current) throw new Error('child: no child tab open');
    bound();
    const raised = current.raisePending();
    await frame();
    await frame();
    return raised;
  },

  async expandAll() {
    const key = childKey();
    if (!key) throw new Error('child: no child tab open');
    useTranscriptStore.getState().expandAll(key);
    await frame();
    await frame();
  },

  metrics(): PanelChildMetrics {
    const rows = rowsOfChild();
    const scroller = current?.handle.current?.scrollElement ?? null;
    const rendered = scroller ? Array.from(scroller.querySelectorAll<HTMLElement>('[data-index]')) : [];
    const view = scroller?.getBoundingClientRect();
    const inView = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      return view !== undefined && rect.bottom > view.top && rect.top < view.bottom;
    };
    const last = rendered.find((el) => Number(el.dataset.index) === rows.length - 1);
    const lastRect = last?.getBoundingClientRect();
    const slot = slotElement();
    const body = bodyElement();
    return {
      rows: rows.length,
      domRows: rendered.length,
      visibleRows: rendered.filter(inView).length,
      overscan: OVERSCAN,
      following: current?.handle.current?.following ?? false,
      lastRowInView: view !== undefined && lastRect !== undefined && lastRect.top >= view.top - 1 && lastRect.bottom <= view.bottom + 1,
      scrollWidth: slot?.scrollWidth ?? 0,
      clientWidth: slot?.clientWidth ?? 0,
      overflowX: Math.max(0, ...[slot, body, scroller].map((el) => (el ? el.scrollWidth - el.clientWidth : 0))),
      regionWidth: document.querySelector('[data-region="panel"]')?.getBoundingClientRect().width ?? 0,
      // UX wave U1b (§I): the waiting rows, and the transcript's end row while it stands
      pendingRequests: rows.filter((row) => (row.kind === 'question' || row.kind === 'plan' || row.kind === 'ask') && row.waiting === true).length + (scroller?.querySelector('[data-row-id="request-end"]') ? 1 : 0),
    };
  },
};
