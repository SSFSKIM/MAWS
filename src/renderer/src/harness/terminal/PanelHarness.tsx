// The `#panel` harness page (C9 M4): a fake right panel that hosts the Terminal tool, with two fake sessions, until
// C8a's product host lands. Header: session switcher, a fake docked request card (with key counters), a theme
// toggle, a Ping button with its click count and wait, a plain text field. Then the mockup's tab strip (pinned tabs
// first, a permanent "Review" placeholder, "+" over the registered tools), the selected tab's tool, and a debug strip
// (host state and pid, `pty.list` rows with a latch for a pty ever seen paused, per-pty byte counters, each
// terminal's status, acceleration and reattach path). Exposes `window.__maws_harness` for Playwright. Tokens only.
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import { mountPanelHost, panelHost, registerPanelTool, type AddToolOptions } from '../../panel/host';
import type { PanelToolContext } from '../../panel/tool';
import { useSettings } from '../../stores/settings';
import { useTerminals } from '../../stores/terminals';
import type { TerminalId } from '../../terminal/registry';
import { openTerminal, TERMINAL_TOOL_ID, terminalTool } from '../../tools/terminal';
import { counterText, countersOf, ping, tap, useSamples, wasPausedSeen } from './debug-tap';
import { FAKE_SESSIONS, SESSION_A, SESSION_B } from './fakeSessions';
import { armInputGuard, type InputGuard } from './input-guard';
import {
  addTool,
  adoptTerminals,
  closeTab,
  panelHostImplementation,
  REVIEW_TAB,
  selectTab,
  switchSession,
  tabTitle,
  terminalOf,
  togglePin,
  usePanel,
  visibleTabs,
  type PanelTab,
} from './panel-state';
import { createTerminalsApi, type TerminalsHarnessApi } from './terminals-api';

registerPanelTool(terminalTool);

// The fake docked card's counters: what C5's dispatcher delivered to the card's `request.accept` and
// `request.decline` handlers and to the page's `tab.next` handler. They stay at zero until the dispatcher is mounted.
export interface KeyCounts {
  accept: number;
  decline: number;
  tabNext: number;
}
const useKeys = create<KeyCounts>()(() => ({ accept: 0, decline: 0, tabNext: 0 }));
export const countKey = (key: keyof KeyCounts) => useKeys.setState((s) => ({ [key]: s[key] + 1 }));

export interface PanelTabSnapshot {
  id: string;
  toolId: string;
  title: string;
  pinned: boolean;
  home: AppSessionId;
  selected: boolean; // selected in the session shown now
  terminalId: TerminalId | null;
}

export interface PanelHarnessApi {
  ready(): Promise<TerminalId[]>; // the re-adopted terminals, once their tabs exist
  session(): AppSessionId;
  sessions: { A: AppSessionId; B: AppSessionId };
  switchSession(id: AppSessionId): void;
  addTool(toolId: string, opts?: Partial<AddToolOptions<unknown>>): string;
  pin(tabId: string): void; // toggles
  selectTab(tabId: string | null): void; // a tab id, 'review', or null for the summary
  closeTab(tabId: string): Promise<boolean>;
  tabs(): PanelTabSnapshot[];
  inputGuard: { arm(): void; disarm(): number }; // physical wheel, key and touch events cancelled and counted while armed
}

let adoption: Promise<TerminalId[]> | null = null;
function ready(): Promise<TerminalId[]> {
  tap();
  adoption ??= adoptTerminals();
  return adoption;
}

let guard: InputGuard | null = null;

const snapshot = (): PanelTabSnapshot[] => {
  const s = usePanel.getState();
  return Object.values(s.tabs).map((tab) => ({
    id: tab.id,
    toolId: tab.toolId,
    title: tabTitle(tab),
    pinned: s.pinned.includes(tab.id),
    home: tab.home,
    selected: s.active[s.session] === tab.id,
    terminalId: terminalOf(tab),
  }));
};

const tabOfTerminal = (id: TerminalId) => Object.values(usePanel.getState().tabs).find((tab) => terminalOf(tab) === id);

export const panelApi: PanelHarnessApi = {
  ready,
  session: () => usePanel.getState().session,
  sessions: { A: SESSION_A, B: SESSION_B },
  switchSession,
  addTool: (toolId, opts = {}) => addTool(toolId, { appSessionId: usePanel.getState().session, ...opts }),
  pin: togglePin,
  selectTab,
  closeTab,
  tabs: snapshot,
  inputGuard: {
    arm() {
      guard ??= armInputGuard(window);
    },
    disarm() {
      const blocked = guard?.disarm() ?? 0;
      guard = null;
      return blocked;
    },
  },
};

const terminalsApi: TerminalsHarnessApi = createTerminalsApi({
  ready,
  open(command) {
    const tabId = panelApi.addTool(TERMINAL_TOOL_ID, command ? { params: { command } } : {});
    return terminalOf(usePanel.getState().tabs[tabId])!;
  },
  select(id) {
    selectTab(id ? (tabOfTerminal(id)?.id ?? null) : REVIEW_TAB);
  },
  async close(id) {
    const tab = tabOfTerminal(id);
    if (tab) await closeTab(tab.id);
  },
});

const button = 'rounded-sm border border-border px-2 py-0.5 text-fg hover:bg-bg-hover [app-region:no-drag]';

export function PanelHarness() {
  useEffect(() => {
    window.__maws_harness = { page: 'panel', panel: panelApi, terminals: terminalsApi, keys: { counts: () => ({ ...useKeys.getState() }) }, openTerminal };
    window.openTerminal = openTerminal;
    const unmount = mountPanelHost(panelHostImplementation);
    void ready();
    return unmount;
  }, []);

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <Header />
      <TabStrip />
      <div className="min-h-0 flex-1">
        <Body />
      </div>
      <DebugStrip />
    </div>
  );
}

function Header() {
  const session = usePanel((s) => s.session);
  const resolvedTheme = useSettings((s) => s.state?.resolvedTheme);
  const setTheme = useSettings((s) => s.setTheme);
  const pings = useSamples((s) => s.pings);
  const keys = useKeys();
  // C5's dispatcher mounts on this page after the rebase over C5 (wave-2 ledger, keymap dispatcher row): the card's
  // `useKeyChord('request.accept' | 'request.decline', () => countKey('accept' | 'decline'), { within: card })` and a
  // `tab.next` handler calling `countKey('tabNext')`. Until then nothing counts, and the end-to-end test that reads
  // these counters is skipped by name.
  const card = useRef<HTMLDivElement>(null);
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-bg-raised px-3 py-2 text-ui-sm">
      <span className="font-mono text-fg-faint">#panel</span>
      <div role="group" aria-label="session" className="flex gap-1 [app-region:no-drag]">
        {[SESSION_A, SESSION_B].map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={session === id}
            onClick={() => switchSession(id)}
            className="rounded-sm px-2 py-0.5 text-fg-muted hover:bg-bg-hover aria-pressed:bg-bg-active aria-pressed:text-fg"
          >
            {FAKE_SESSIONS[id]!.title.text}
          </button>
        ))}
      </div>
      <div
        ref={card}
        tabIndex={0}
        aria-label="fake request card"
        className="rounded-md border border-border-strong bg-bg px-2 py-0.5 text-fg-muted focus-visible:outline-2 focus-visible:outline-accent [app-region:no-drag]"
      >
        request · accept {keys.accept} · decline {keys.decline} · tab.next {keys.tabNext}
      </div>
      <button type="button" onClick={() => void setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')} className={button}>
        theme: {resolvedTheme ?? '…'}
      </button>
      <button type="button" aria-label="ping" onClick={(ev) => ping(ev)} className={button}>
        ping {pings.count}
        {pings.lastMs === null ? '' : ` · ${pings.lastMs} ms (max ${pings.maxMs})`}
      </button>
      <input aria-label="paste target" placeholder="paste here" className="rounded-sm border border-border bg-bg px-2 py-0.5 font-mono text-fg [app-region:no-drag]" />
    </header>
  );
}

function TabStrip() {
  const session = usePanel((s) => s.session);
  const tabs = usePanel((s) => s.tabs);
  const pinned = usePanel((s) => s.pinned);
  const sessionTabs = usePanel((s) => s.sessionTabs);
  const active = usePanel((s) => s.active[s.session] ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const ids = visibleTabs({ session, tabs, pinned, sessionTabs, active: {} }, session);
  const offered = panelHost.tools().filter((tool) => tool.menu !== false && (tool.multiInstance || !ids.some((id) => tabs[id]?.toolId === tool.id)));
  const tabClass = 'flex h-7 items-center gap-px rounded-sm border px-1 whitespace-nowrap';
  const glyph = 'flex h-5 w-4 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg';
  return (
    <div role="tablist" aria-label="panel tabs" className="relative flex shrink-0 items-center gap-1 border-b border-border bg-bg-raised px-1.5 py-1 text-ui-sm">
      {ids.map((id) => {
        const tab = tabs[id]!;
        const selected = active === id;
        const isPinned = pinned.includes(id);
        return (
          <div
            key={id}
            role="tab"
            aria-selected={selected}
            data-tab-id={id}
            data-pinned={isPinned || undefined}
            className={`${tabClass} ${selected ? 'border-border bg-bg-active text-fg' : 'border-transparent text-fg-muted'}`}
          >
            <button type="button" onClick={() => selectTab(id)} className="max-w-60 truncate px-1 leading-6">
              {tabTitle(tab)}
            </button>
            <button type="button" aria-label={isPinned ? 'unpin tab' : 'pin tab'} aria-pressed={isPinned} onClick={() => togglePin(id)} className={glyph}>
              <PinGlyph pinned={isPinned} />
            </button>
            <button type="button" aria-label="close tab" onClick={() => void closeTab(id)} className={glyph}>
              ×
            </button>
          </div>
        );
      })}
      <div
        role="tab"
        aria-selected={active === REVIEW_TAB}
        data-tab-id={REVIEW_TAB}
        className={`${tabClass} ${active === REVIEW_TAB ? 'border-border bg-bg-active text-fg' : 'border-transparent text-fg-muted'}`}
      >
        <button type="button" onClick={() => selectTab(REVIEW_TAB)} className="px-1 leading-6">
          Review
        </button>
      </div>
      <button type="button" aria-label="add tool" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} className={glyph}>
        +
      </button>
      {menuOpen ? (
        <div role="menu" aria-label="add tool" className="absolute top-full left-1 z-10 flex min-w-32 flex-col rounded-md border border-border bg-bg-overlay py-1">
          {offered.map((tool) => (
            <button
              key={tool.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                addTool(tool.id, { appSessionId: session });
              }}
              className="flex items-center gap-2 px-3 py-1 text-left text-fg hover:bg-bg-hover"
            >
              <tool.icon className="size-3.5" />
              {tool.title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PinGlyph({ pinned }: { pinned: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-2.5" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round">
      <path d="M6 1.5h4l-.5 4.5 3 3H3.5l3-3zM8 9v5.5" />
    </svg>
  );
}

function Body() {
  const session = usePanel((s) => s.session);
  const active = usePanel((s) => s.active[s.session] ?? null);
  const tab = usePanel((s) => (active && active !== REVIEW_TAB ? s.tabs[active] : undefined));
  const pinned = usePanel((s) => (active ? s.pinned.includes(active) : false));
  if (active === REVIEW_TAB) return <div className="p-4 text-fg-muted">Review (placeholder: selecting it unmounts the other tools)</div>;
  if (!tab) return <div className="p-4 text-fg-muted">Summary (no tab selected). “+” adds a tool.</div>;
  return <ToolBody key={tab.id} tab={tab} session={session} pinned={pinned} />;
}

function ToolBody({ tab, session, pinned }: { tab: PanelTab; session: AppSessionId; pinned: boolean }) {
  const { tool } = tab;
  const ctx = useMemo<PanelToolContext>(
    () => ({
      appSessionId: session,
      session: FAKE_SESSIONS[session] ?? null,
      status: null,
      pinned,
      visible: true,
      focusRequest: tab.focusRequest,
      setTitle: tab.setTitle,
      close: () => void closeTab(tab.id),
      openTool: panelHost.addTool,
    }),
    [session, pinned, tab.focusRequest, tab.setTitle, tab.id],
  );
  return <tool.render state={tab.state} ctx={ctx} />;
}

function DebugStrip() {
  const infos = useTerminals((s) => s.terminals);
  const host = useTerminals((s) => s.host);
  const rows = useSamples((s) => s.rows);
  return (
    <output aria-label="panel debug" className="flex max-h-48 shrink-0 flex-col gap-0.5 overflow-auto border-t border-border px-2 py-1 font-mono text-ui-sm text-fg-muted">
      <div aria-label="pty host state">
        host {host?.state ?? '…'} pid {host?.pid ?? '—'} restarts {host?.restarts ?? 0}
      </div>
      {infos.map((info) => (
        <div key={info.id} data-terminal={info.id}>
          terminal {info.label} · {info.status}
          {info.exit ? ` (code ${info.exit.exitCode ?? 'null'}, signal ${info.exit.signal ?? 'null'})` : ''} · {info.acceleration} ·{' '}
          {info.visible ? 'visible' : 'hidden'} · reattach: {info.reconnect ?? '—'} · pid {info.pid ?? '—'}
          {info.error ? <span className="text-danger"> · {info.error}</span> : null}
        </div>
      ))}
      {rows.map((pty) => (
        <div key={pty.ptyId} data-pty={pty.ptyId}>
          pty.list {pty.appSessionId}/{pty.label} · pid {pty.pid} · {pty.alive ? 'alive' : 'dead'} · paused {String(pty.paused)}
          {wasPausedSeen(pty.ptyId) ? ' (paused seen)' : ''} · offset {pty.offset} · {counterText(countersOf(pty.ptyId))}
        </div>
      ))}
    </output>
  );
}
