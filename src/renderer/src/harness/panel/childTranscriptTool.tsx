// The harness-only `child` tool (C8a execution document, M4; R7): C6's `Transcript variant: 'child'` inside the panel
// region, over `HarnessSession.childSource(ref)` for the first child agent of the transcript loaded into the tab's
// session, exactly the seam C8b's drill-in mounts. The tool builds no source of its own. `childProbes` is
// `window.__maws_harness.panel.child`: it steps the parent's player (the child's events arrive through childSource's
// filter) and reads what R7 asserts about the container at each width.
import type { RefObject } from 'react';
import { Icon } from '../../app/IconButton';
import type { PanelTool } from '../../panel/tool';
import { useTranscriptStore } from '../../stores/transcript';
import { Transcript, type SubagentRef, type TranscriptSource } from '../../transcript';
import { OVERSCAN, type TranscriptListHandle } from '../../transcript/view/Transcript';
import type { HarnessSession } from '../player';
import type { PanelChildMetrics, PanelHarnessApi } from './api';
import { loadedSession } from './summaryProbes';

export const CHILD_TOOL_ID = 'child';

export interface ChildTabState {
  session: HarnessSession | null; // the transcript loaded into the tab's session when the tab was created
  ref: SubagentRef | null; // its first child agent, as the parent's activity names it
  source: TranscriptSource | null;
  handle: RefObject<TranscriptListHandle | null>;
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
    const session = init.appSessionId ? loadedSession(init.appSessionId) : null;
    const ref = session ? firstChild(session) : null;
    const state: ChildTabState = { session, ref, source: session && ref ? session.childSource(ref) : null, handle: { current: null } };
    current = state;
    return state;
  },
  beforeClose: () => Promise.resolve(true),
  dispose(state) {
    if (state.source?.key) useTranscriptStore.getState().drop(state.source.key); // the next tab starts the child over
    if (current === state) current = null;
  },
  render: ChildBody,
};

function ChildBody({ state }: { state: ChildTabState }) {
  if (!state.source) {
    return <p className="flex h-full items-center justify-center p-4 text-center text-ui text-fg-muted">Load a transcript with a child agent into this session first.</p>;
  }
  return <Transcript source={state.source} variant="child" handle={state.handle} className="h-full" />;
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
const childKey = () => current?.source?.key ?? null;
const rowsOfChild = () => {
  const key = childKey();
  return key ? useTranscriptStore.getState().rows(key) : [];
};

// The region's slot: the element C5's PanelRegion scrolls the host in (the host's own root is its only child).
const slotElement = () => document.getElementById('panel-host-body')?.parentElement?.parentElement ?? null;

export const childProbes: PanelHarnessApi['child'] = {
  async release(n) {
    const session = current?.session;
    if (!session) throw new Error('child: no child tab open');
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
