// The Log tool (C8b execution document, Interfaces *Tools* and *Log paging*; M3): a transient, multi-instance tab over one
// file the engine reported (a background task's output file, a spilled tool result), read through `fs.readSpill` in
// pages chained by the answered `length`, at most four pages in the DOM; or, with no path, the "no file reported" state
// that reads nothing. Never offered from "+", never pinned, never restored: the host prunes restored Log tabs, and a
// tab created without params says so rather than failing. `openLog` keeps one tab per session and path.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { Icon } from '../../../app/IconButton';
import { instanceOf, panelHost } from '../../../panel/host';
import type { PanelTool, PanelToolContext } from '../../../panel/tool';
import { agentWorkClient } from '../client';
import { LOG_COPY } from '../copy';
import { AGENT_TOOL_IDS } from '../tool-ids';
import { atEnd, earlierRead, formatBytes, LOG_PAGE_BYTES, nextRead, NO_PAGES, refreshRead, withPage, type LogPages, type PageRead } from './log-model';

// path null: the cell reported no file (the "no file reported" state; nothing is read).
export interface LogParams {
  path: string | null;
  title: string;
}

// The snapshot the body renders. `restored`: created without params (a tab layout.json kept despite the host's prune).
export interface LogState extends LogPages {
  appSessionId: AppSessionId | null;
  path: string | null;
  title: string;
  restored: boolean;
  loading: boolean;
  error: string | null;
  scrollTop: number;
}

// One tab per session and path (tabs live in per-session lists, so a path-only key would select another session's tab):
// `${appSessionId}:${path}` → the tab id, filled by createState (the newest wins) and cleared by dispose.
const openTabs = new Map<string, string>();
const keyOf = (appSessionId: AppSessionId, path: string) => `${appSessionId}:${path}`;

export const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1) || path;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class LogHandle {
  private state: LogState;
  private readonly listeners = new Set<() => void>();
  private readonly key: string | null;
  private disposed = false;

  constructor(
    appSessionId: AppSessionId | null,
    private readonly instanceId: string,
    params: LogParams | undefined,
  ) {
    const path = params?.path ?? null;
    this.state = { ...NO_PAGES, appSessionId, path, title: params?.title ?? LOG_COPY.title, restored: params === undefined, loading: false, error: null, scrollTop: 0 };
    this.key = appSessionId !== null && path !== null ? keyOf(appSessionId, path) : null;
    if (this.key !== null) openTabs.set(this.key, instanceId);
    if (path !== null) void this.read(nextRead(this.state));
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  snapshot = () => this.state;

  private update(patch: Partial<LogState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  // One read at a time; a refusal is shown with the path and never retried on its own.
  private async read(target: PageRead | null): Promise<void> {
    const { path } = this.state;
    if (target === null || path === null || this.state.loading || this.disposed) return;
    this.update({ loading: true });
    try {
      const answer = await agentWorkClient().readSpill({ path, offset: target.offset, length: LOG_PAGE_BYTES });
      if (this.disposed) return;
      this.update({ ...withPage(this.state, target.index, answer), loading: false, error: null });
    } catch (error) {
      if (this.disposed) return;
      this.update({ loading: false, error: messageOf(error) });
    }
  }

  loadMore = () => this.read(nextRead(this.state));
  showEarlier = () => this.read(earlierRead(this.state));
  refresh = () => this.read(refreshRead(this.state));

  setScrollTop = (scrollTop: number) => {
    this.state = { ...this.state, scrollTop }; // kept for the next mount; nothing renders from it meanwhile
  };

  dispose = () => {
    this.disposed = true;
    if (this.key !== null && openTabs.get(this.key) === this.instanceId) openTabs.delete(this.key);
  };
}

// Opens the Log on a file the engine reported, in the session's own list. With a path, the tab already open for that
// session and path is selected rather than doubled; with none, a new tab shows the "no file reported" state. Returns the
// tab id. Log is unpinnable, so a session is required.
export function openLog(appSessionId: AppSessionId, path: string | null, title: string): string {
  if (path !== null) {
    const open = openTabs.get(keyOf(appSessionId, path));
    if (open !== undefined && instanceOf(open)) {
      panelHost.selectTab(open);
      return open;
    }
  }
  return panelHost.addTool<LogParams>(AGENT_TOOL_IDS.log, { appSessionId, params: { path, title } });
}

const ACTION = 'shrink-0 rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';

function LogBody({ state, ctx }: { state: LogHandle; ctx: PanelToolContext }) {
  const s = useSyncExternalStore(state.subscribe, state.snapshot);
  const { setTitle } = ctx;
  const suffix = s.restored ? null : s.path !== null ? basename(s.path) : s.title;
  useEffect(() => setTitle(suffix), [setTitle, suffix]);

  if (s.restored) return <Note>{LOG_COPY.notRestored}</Note>;
  if (s.path === null) return <Note>{LOG_COPY.noFile}</Note>;
  const refused = s.error !== null && s.window === null;
  return (
    <div data-log className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-col gap-1 border-b border-border px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-ui font-semibold">{s.title}</h2>
          {s.bytes !== null && (
            <span data-part="size" className="shrink-0 text-ui-sm text-fg-muted tabular-nums">
              {formatBytes(s.bytes)}
            </span>
          )}
          {!refused && (
            <button type="button" className={ACTION} disabled={s.loading} onClick={() => void state.refresh()}>
              {LOG_COPY.refresh}
            </button>
          )}
        </div>
        <PathLine path={s.path} />
      </header>
      {refused ? <p className="p-3.5 text-ui text-danger">{LOG_COPY.refused(s.error!)}</p> : <Pages state={state} snapshot={s} />}
    </div>
  );
}

function Note({ children }: { children: string }) {
  return <p className="flex h-full items-center justify-center p-4 text-center text-ui text-fg-muted">{children}</p>;
}

function PathLine({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(path).then(() => setCopied(true));
  };
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <code data-part="path" title={path} className="min-w-0 flex-1 truncate font-mono text-ui-sm text-fg-muted">
        {path}
      </code>
      <button type="button" aria-label={LOG_COPY.copyPath} title={copied ? LOG_COPY.copied : LOG_COPY.copyPath} onClick={copy} className="shrink-0 rounded-sm p-0.5 text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
        <Icon className="size-3.5">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
        </Icon>
      </button>
    </div>
  );
}

// The window's pages as one `<pre>` each, flush so a line cut by a page boundary reads as one line.
function Pages({ state, snapshot: s }: { state: LogHandle; snapshot: LogState }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [restoreTo] = useState(s.scrollTop);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = restoreTo;
  }, [restoreTo]);
  const shown = s.window === null ? [] : Array.from({ length: s.window.to - s.window.from + 1 }, (_, i) => s.pages.get(s.window!.from + i)).filter((p) => p !== undefined);
  const end = atEnd(s);
  return (
    <div ref={scroller} onScroll={(e) => state.setScrollTop(e.currentTarget.scrollTop)} className="flex min-h-0 flex-1 flex-col overflow-auto">
      {s.window !== null && s.window.from > 0 && (
        <button type="button" disabled={s.loading} onClick={() => void state.showEarlier()} className={`${ACTION} m-2 self-start`}>
          {LOG_COPY.showEarlier}
        </button>
      )}
      <div className="px-3.5 py-2">
        {shown.map((page) => (
          <pre key={page.offset} data-log-page data-offset={page.offset} className="m-0 font-mono text-ui-sm break-words whitespace-pre-wrap text-fg">
            {page.text}
          </pre>
        ))}
      </div>
      {s.error !== null && <p className="px-3.5 text-ui-sm text-danger">{LOG_COPY.refused(s.error)}</p>}
      {s.window !== null && (
        <div className="flex items-center gap-2 px-3.5 pb-3">
          <button type="button" disabled={end || s.loading} onClick={() => void state.loadMore()} className={ACTION}>
            {LOG_COPY.loadMore}
          </button>
          {end && <span className="text-ui-sm text-fg-muted">{LOG_COPY.endOfFile}</span>}
        </div>
      )}
    </div>
  );
}

export function LogIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M4 2.5h5.5L12 5v8.5H4z" />
      <path d="M6 7.5h4M6 10h4" />
    </Icon>
  );
}

export const logTool: PanelTool<LogHandle, LogParams> = {
  id: AGENT_TOOL_IDS.log,
  title: LOG_COPY.title,
  icon: LogIcon,
  pinnable: false,
  multiInstance: true,
  menu: false,
  createState: (init) => new LogHandle(init.appSessionId, init.instanceId, init.params),
  beforeClose: () => Promise.resolve(true),
  dispose: (state) => state.dispose(),
  render: LogBody,
};
