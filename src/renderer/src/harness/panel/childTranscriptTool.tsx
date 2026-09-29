// The harness-only `child` tool (C8a execution document, M4; R7): C6's `Transcript variant: 'child'` inside the panel
// region, over `HarnessSession.childSource(ref)` for the first child agent of the transcript loaded into the tab's
// session, exactly the seam C8b's drill-in mounts. The tool builds no source of its own. `childProbes` is
// `window.__maws_harness.panel.child`: it steps the parent's player (the child's events arrive through childSource's
// filter) and reads what R7 asserts about the container at each width.
import { useEffect, useSyncExternalStore, type RefObject } from 'react';
import { Icon } from '../../app/IconButton';
import type { PanelTool } from '../../panel/tool';
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

  // The child's entry leaves the store, so the next binding starts the child over.
  private release(): void {
    if (this.view.source?.key) useTranscriptStore.getState().drop(this.view.source.key);
  }

  dispose(): void {
    this.offLoads();
    this.release();
  }
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

// The region's slot: the element C5's PanelRegion scrolls the host in (the host's own root is its only child).
const slotElement = () => document.getElementById('panel-host-body')?.parentElement?.parentElement ?? null;

export const childProbes: PanelHarnessApi['child'] = {
  async release(n) {
    const session = bound()?.session;
    if (!session) throw new Error('child: no child tab open over a loaded transcript');
    for (let i = 0; i < n && !session.player.done; i += 1) session.player.step();
    await frame();
    await frame();
    return rowsOfChild().length;
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
    const body = document.getElementById('panel-host-body');
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
      pendingRequests: rows.filter((row) => row.kind === 'request_slot').length,
    };
  },
};
