// The Side pane (X5; E3 execution document, Design §6 and §7): one tab per session (single-instance, never pinned,
// offered from "+"), holding that session's side questions and side threads. A strip of chips leads with the question
// view (`/btw`), then lists the threads, newest first, each with its phase glyph as the sidebar draws it; the selected
// one is drawn below (BtwView, ThreadView). Its view is the per-session side store's, set by whoever opened the pane
// (`open` re-targets it); with none chosen it shows the newest thread, and with no thread the empty state says how to
// start one.
import { useMemo } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { Icon } from '../app/IconButton';
import { GlyphMark } from '../attention/GlyphMark';
import { glyphFor } from '../attention/glyph';
import type { PanelTool, PanelToolContext, PanelToolInit } from '../panel/tool';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useSessions } from '../stores/sessions';
import { SIDE_TOOL_ID, type SideParams } from './actions';
import { BtwView } from './BtwView';
import { SIDE_COPY } from './copy';
import { setSideView, sidePaneOf, useSidePane } from './store';
import { ThreadView } from './ThreadView';

const COPY = SIDE_COPY.pane;

export interface SideToolState {
  appSessionId: AppSessionId | null;
}

function apply(appSessionId: AppSessionId | null, params: SideParams | undefined): void {
  if (appSessionId !== null && params?.view !== undefined) setSideView(appSessionId, params.view);
}

function SideIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M4 2v12M4 9c0-2.2 1.8-4 4-4h4M10 3l2 2-2 2" />
    </Icon>
  );
}

// The session's side threads (records whose lineage names it as a side thread's parent), newest first.
export function sideThreadsOf(records: ReadonlyMap<AppSessionId, SessionRecord>, parent: AppSessionId): SessionRecord[] {
  return [...records.values()]
    .filter((record) => record.lineage?.kind === 'side-thread' && record.lineage.parentAppSessionId === parent)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const CHIP =
  'flex max-w-[220px] min-w-0 items-center gap-1.5 rounded-sm border border-transparent px-2 py-0.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 aria-[current=true]:border-border-strong aria-[current=true]:bg-bg-active aria-[current=true]:text-fg';

function ThreadChip({ child, record, selected, onSelect }: { child: AppSessionId; record: SessionRecord | null; selected: boolean; onSelect(): void }) {
  const digest = useSessions((s) => s.digests.get(child) ?? null);
  const pending = useAttention((s) => selectPendingOf(s, child));
  const label = SIDE_COPY.label(record?.lineage?.anchor?.label ?? null, record?.lineage?.openedBy ?? null);
  return (
    <button type="button" aria-current={selected ? 'true' : undefined} data-side-chip={child} onClick={onSelect} className={CHIP}>
      {record !== null && <GlyphMark glyph={glyphFor(record, digest, pending)} className="w-[12px] shrink-0" />}
      <span className="truncate font-mono">{label}</span>
    </button>
  );
}

// The question view's chip, first in the strip whatever the threads are.
function QuestionsChip({ selected, onSelect }: { selected: boolean; onSelect(): void }) {
  return (
    <button type="button" aria-current={selected ? 'true' : undefined} data-side-chip="btw" title={COPY.questionsTitle} onClick={onSelect} className={CHIP}>
      <Icon className="size-[12px]">
        <circle cx="8" cy="8" r="6" />
        <path d="M6.3 6.3a1.8 1.8 0 1 1 2.4 1.7c-.4.2-.7.5-.7 1v.5M8 11.3v.1" />
      </Icon>
      <span className="truncate font-mono">{COPY.questions}</span>
    </button>
  );
}

function SideBody({ ctx }: { state: SideToolState; ctx: PanelToolContext }) {
  const parent = ctx.appSessionId;
  const records = useSessions((s) => s.records);
  const unstarted = useSessions((s) => s.unstarted);
  const view = useSidePane((s) => (parent === null ? null : sidePaneOf(s, parent).view));
  const threads = useMemo(() => (parent === null ? [] : sideThreadsOf(records, parent)), [records, parent]);
  if (parent === null) return <Empty text={COPY.noSession} />;
  // a thread just opened may have no record yet (its setup is running): it is listed from the view until it does; a
  // viewed thread that is gone (deleted) gives way to the newest
  const listed = threads.map((record) => record.appId);
  const wanted = view?.kind === 'thread' ? view.childAppSessionId : null;
  const viewed = wanted !== null && (listed.includes(wanted) || unstarted.has(wanted)) ? wanted : null;
  const children = viewed !== null && !listed.includes(viewed) ? [viewed, ...listed] : listed;
  const questions = view?.kind === 'btw';
  const selected = questions ? null : (viewed ?? children[0] ?? null);
  return (
    <div data-side-pane={parent} className="flex h-full min-h-0 flex-col bg-bg text-ui text-fg">
      <nav aria-label={COPY.threads} className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-2">
        <QuestionsChip selected={questions} onSelect={() => setSideView(parent, { kind: 'btw' })} />
        {children.length > 0 && <span aria-hidden className="mx-0.5 h-3.5 w-px bg-border" />}
        {children.map((child) => (
          <ThreadChip key={child} child={child} record={records.get(child) ?? null} selected={child === selected} onSelect={() => setSideView(parent, { kind: 'thread', childAppSessionId: child })} />
        ))}
      </nav>
      {questions ? <BtwView parent={parent} /> : selected === null ? <Empty text={COPY.empty} /> : <ThreadView key={selected} parent={parent} child={selected} visible={ctx.visible} />}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-1 items-center justify-center p-6 text-center">
      <p className="m-0 max-w-[280px] text-ui text-fg-muted">{text}</p>
    </div>
  );
}

export const sideTool: PanelTool<SideToolState, SideParams> = {
  id: SIDE_TOOL_ID,
  title: COPY.title,
  icon: SideIcon,
  pinnable: false,
  multiInstance: false,
  menu: true,
  createState({ appSessionId, params }: PanelToolInit<SideParams>) {
    apply(appSessionId, params);
    return { appSessionId };
  },
  open(state, params) {
    apply(state.appSessionId, params);
  },
  beforeClose: async () => true, // the threads are sessions of their own, the view is the store's, the questions the host's: closing loses nothing
  dispose: () => {},
  render: SideBody,
};
