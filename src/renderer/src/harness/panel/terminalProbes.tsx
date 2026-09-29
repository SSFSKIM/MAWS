// C9's `#panel` probes, carried into C8a's panel harness by the stand-in fold (C8a ruling O2): the fake docked request
// card with its key counters, the Ping button and the paste field, the debug rows (PTY host state, each terminal,
// `pty.list` with byte counters), the input guard, C5's key dispatcher with the page's `tab.next`, and
// `window.__maws_harness.terminals`. The stand-in's own host and tab strip are gone: the Terminal tool runs in the
// product host, so `e2e/terminal.spec.ts` drives the real strip. Written by C9 (M4); moved here unchanged in intent.
import { useRef } from 'react';
import { create } from 'zustand';
import { registerAction } from '../../keymap/actions-runtime';
import { connectKeys } from '../../keymap/dispatcher';
import { useKeyChord } from '../../keymap/useKeyChord';
import { instanceIds, instanceOf } from '../../panel/host';
import { useTerminals } from '../../stores/terminals';
import { terminals, type TerminalId } from '../../terminal/registry';
import { TERMINAL_TOOL_ID, type TerminalTabState } from '../../tools/terminal';
import { counterText, countersOf, ping, tap, useSamples, wasPausedSeen } from '../terminal/debug-tap';
import { armInputGuard, type InputGuard } from '../terminal/input-guard';
import { createTerminalsApi, type TerminalsHarnessApi } from '../terminal/terminals-api';

// The fake docked card's counters: what C5's dispatcher delivered to the card's `request.accept` and
// `request.decline` handlers, and what reached the page's `tab.next` action (the terminal forwards ⌃Tab to it).
export interface KeyCounts {
  accept: number;
  decline: number;
  tabNext: number;
}
const useKeys = create<KeyCounts>()(() => ({ accept: 0, decline: 0, tabNext: 0 }));
const countKey = (key: keyof KeyCounts) => useKeys.setState((s) => ({ [key]: s[key] + 1 }));
export const keysApi = { counts: (): KeyCounts => ({ ...useKeys.getState() }) };

// The registry terminal a panel tab holds, when the tab is a Terminal with an instance.
export function terminalOf(tabId: string): TerminalId | null {
  const instance = instanceOf(tabId);
  return instance?.tool.id === TERMINAL_TOOL_ID ? (instance.state as TerminalTabState).terminalId : null;
}
const tabOfTerminal = (id: TerminalId) => instanceIds().find((tabId) => terminalOf(tabId) === id);

// After a reload, the host's ptys for the page's sessions are re-adopted before the layout hydrates, so a restored
// Terminal tab's `createState` finds its shell under its label instead of opening a second one.
let adoption: Promise<TerminalId[]> | null = null;
export function adoptTerminals(accept: (appSessionId: string) => boolean): Promise<TerminalId[]> {
  tap();
  adoption ??= terminals.adopt((info) => accept(info.appSessionId));
  return adoption;
}

// C5's key dispatcher, as the app mounts it, and the page's `tab.next` in place of the shell's tab cycle (registered
// after the shell's actions, so it wins).
export function connectTerminalProbes(): () => void {
  const disconnectKeys = connectKeys();
  const offTabNext = registerAction('tab.next', () => countKey('tabNext'));
  return () => {
    offTabNext();
    disconnectKeys();
  };
}

let guard: InputGuard | null = null;
export const inputGuard = {
  arm() {
    guard ??= armInputGuard(window);
  },
  disarm() {
    const blocked = guard?.disarm() ?? 0;
    guard = null;
    return blocked;
  },
};

export function createPanelTerminalsApi(page: {
  ready(): Promise<string[]>; // the re-adopted terminal ids
  addTerminal(command?: string): string; // a Terminal tab in the shown session; its id
  selectTab(tabId: string | null): void; // null: the summary, every tool unmounted
  closeTab(tabId: string): Promise<boolean>;
}): TerminalsHarnessApi {
  return createTerminalsApi({
    ready: () => page.ready() as Promise<TerminalId[]>,
    open: (command) => terminalOf(page.addTerminal(command))!,
    select: (id) => page.selectTab(id ? (tabOfTerminal(id) ?? null) : null),
    async close(id) {
      const tabId = tabOfTerminal(id);
      if (tabId) await page.closeTab(tabId);
    },
  });
}

const button = 'rounded-sm border border-border px-2 py-0.5 text-ui text-fg hover:bg-bg-hover';

// The header's C9 controls. The stand-in for a pending request docked beside the terminal answers Enter and Escape
// only while it holds focus (C5's focused-pane rule), which is what the terminal's Enter must never reach.
export function TerminalControls() {
  const pings = useSamples((s) => s.pings);
  const keys = useKeys();
  const card = useRef<HTMLDivElement>(null);
  useKeyChord('request.accept', () => countKey('accept'), { within: card });
  useKeyChord('request.decline', () => countKey('decline'), { within: card });
  return (
    <>
      <div
        ref={card}
        tabIndex={0}
        aria-label="fake request card"
        className="rounded-md border border-border-strong bg-bg px-2 py-0.5 text-ui-sm text-fg-muted focus-visible:outline-2 focus-visible:outline-accent"
      >
        request · accept {keys.accept} · decline {keys.decline} · tab.next {keys.tabNext}
      </div>
      <button type="button" aria-label="ping" onClick={(ev) => ping(ev)} className={button}>
        ping {pings.count}
        {pings.lastMs === null ? '' : ` · ${pings.lastMs} ms (max ${pings.maxMs})`}
      </button>
      <input aria-label="paste target" placeholder="paste here" className="w-28 rounded-sm border border-border bg-bg px-2 py-0.5 font-mono text-ui-sm text-fg" />
    </>
  );
}

// The debug strip's C9 rows: the PTY host, each registry terminal, and the host's `pty.list` with byte counters.
export function TerminalDebugRows() {
  const infos = useTerminals((s) => s.terminals);
  const host = useTerminals((s) => s.host);
  const rows = useSamples((s) => s.rows);
  return (
    <>
      <p aria-label="pty host state">
        host {host?.state ?? '…'} pid {host?.pid ?? '—'} restarts {host?.restarts ?? 0}
      </p>
      {infos.map((info) => (
        <p key={info.id} data-terminal={info.id}>
          terminal {info.label} · {info.status}
          {info.exit ? ` (code ${info.exit.exitCode ?? 'null'}, signal ${info.exit.signal ?? 'null'})` : ''} · {info.acceleration} ·{' '}
          {info.visible ? 'visible' : 'hidden'} · reattach: {info.reconnect ?? '—'} · pid {info.pid ?? '—'}
          {info.error ? <span className="text-danger"> · {info.error}</span> : null}
        </p>
      ))}
      {rows.map((pty) => (
        <p key={pty.ptyId} data-pty={pty.ptyId}>
          pty.list {pty.appSessionId}/{pty.label} · pid {pty.pid} · {pty.alive ? 'alive' : 'dead'} · paused {String(pty.paused)}
          {wasPausedSeen(pty.ptyId) ? ' (paused seen)' : ''} · offset {pty.offset} · {counterText(countersOf(pty.ptyId))}
        </p>
      ))}
    </>
  );
}

export type { TerminalsHarnessApi };
