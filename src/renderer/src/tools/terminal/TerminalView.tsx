// The Terminal tool's render (C9 Residue *Persistence*, *Lifecycle and close*, *Copy, paste and links*): it lends the
// registry a box to mount the terminal's container into while the tab is shown and gives it back when it is not, so
// the emulator is never re-created; above the terminal it shows the bars of the lifecycle (exited, lost, could not
// start), the lossy-reconnect notice, the worktree warning and the busy-close confirmation. Tokens only.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { SessionRecord } from '@shared/graph/session';
import type { PanelToolContext } from '../../panel/tool';
import { useTerminals } from '../../stores/terminals';
import { terminals, type TerminalInfo } from '../../terminal/registry';
import { ensureTerminal, type TerminalTabState } from './index';

// Where a session runs: its worktree when it has one, else its directory (the worktree warning compares against it).
export const sessionDirectory = (session: SessionRecord): string => session.worktree?.path ?? session.directory;

const bar = 'flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-bg-raised px-2 py-1 text-ui-sm';
const barButton = 'rounded-sm border border-border px-2 py-0.5 text-fg hover:bg-bg-hover disabled:text-fg-faint disabled:hover:bg-transparent';

export function TerminalView({ state, ctx }: { state: TerminalTabState; ctx: PanelToolContext }) {
  const confirm = useStore(state.ui);
  const id = confirm.terminalId;
  const info = useTerminals((s) => s.terminals.find((terminal) => terminal.id === id)) ?? null;
  const hostReady = useTerminals((s) => s.host?.state === 'ready');
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { setTitle, visible, focusRequest, appSessionId, session } = ctx;
  const title = info?.title ?? null;

  // A tab restored with no session starts its terminal in the first session shown.
  useEffect(() => {
    if (!id) ensureTerminal(state, { appSessionId, session });
  }, [id, state, appSessionId, session]);

  // Mounting never takes focus (a restored or session-switched tab must not steal it from the composer); the host
  // asks for focus through `focusRequest`.
  useEffect(() => {
    if (!id || !visible) return;
    terminals.mount(id, surfaceRef.current!);
    return () => terminals.unmount(id);
  }, [id, visible]);

  useEffect(() => {
    if (id && focusRequest) terminals.focus(id);
  }, [id, focusRequest]);

  useEffect(() => setTitle(title), [setTitle, title]);

  const shownDirectory = ctx.session ? sessionDirectory(ctx.session) : null;
  const moved = info !== null && shownDirectory !== null && info.cwd !== shownDirectory;

  const openContextMenu = (ev: ReactMouseEvent<HTMLDivElement>) => {
    ev.preventDefault();
    const box = ev.currentTarget.getBoundingClientRect();
    setMenu({ x: ev.clientX - box.left, y: ev.clientY - box.top });
  };

  return (
    <div data-tool="terminal" data-terminal={id} className="flex h-full min-h-0 flex-col">
      {confirm.confirmClose ? (
        <div role="alert" aria-label="close confirmation" className={bar}>
          <span className="text-fg">
            {confirm.process ? (
              <>
                A command is running: <code className="font-mono">{confirm.process}</code>. Close anyway?
              </>
            ) : (
              'The terminal service did not say what is running. Close anyway?'
            )}
          </span>
          <button
            type="button"
            className={barButton}
            onClick={() => {
              state.ui.setState({ confirmed: true, confirmClose: false });
              ctx.close();
            }}
          >
            Close
          </button>
          <button type="button" className={barButton} onClick={() => state.ui.setState({ confirmClose: false, process: null })}>
            Keep
          </button>
        </div>
      ) : null}
      {confirm.closeError ? (
        <div role="alert" aria-label="close failed" className={`${bar} text-danger`}>
          <span>Could not close: {confirm.closeError}</span>
          <button type="button" className={barButton} onClick={ctx.close}>
            Close
          </button>
        </div>
      ) : null}
      {id ? null : (
        <div role="status" aria-label="terminal pending" className={`${bar} text-fg-muted`}>
          Open a session to start a terminal
        </div>
      )}
      {info ? <StatusBar info={info} hostReady={hostReady} close={ctx.close} /> : null}
      {info?.reconnect === 'lossy' ? (
        <div role="status" aria-label="reconnect notice" className={`${bar} text-fg-muted`}>
          Reconnected; earlier output was not kept
        </div>
      ) : null}
      {moved ? (
        <div role="status" aria-label="worktree warning" className={`${bar} text-fg`}>
          <span>
            This terminal is in <code className="font-mono">{info.cwd}</code>; the session now runs in <code className="font-mono">{shownDirectory}</code>.
          </span>
          <button type="button" className={barButton} onClick={() => ctx.openTool('terminal', { appSessionId: ctx.appSessionId, params: { cwd: shownDirectory } })}>
            New terminal here
          </button>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <div ref={surfaceRef} data-testid="terminal-surface" onContextMenu={openContextMenu} className="absolute inset-0 overflow-hidden bg-[var(--term-bg)] p-1" />
        {menu ? <ContextMenu at={menu} state={state} dismiss={() => setMenu(null)} /> : null}
      </div>
    </div>
  );
}

function StatusBar({ info, hostReady, close }: { info: TerminalInfo; hostReady: boolean; close(): void }) {
  const dead = info.status === 'exited' || info.status === 'lost';
  if (!dead && !info.error) return null;
  let message: ReactNode;
  if (info.status === 'lost') message = 'Terminal lost, the terminal service restarted';
  else if (info.error) message = info.error.charAt(0).toUpperCase() + info.error.slice(1);
  else if (info.exit?.exitCode != null) message = `Process exited (code ${info.exit.exitCode})`;
  else if (info.exit?.signal != null) message = `Process exited (signal ${info.exit.signal})`;
  else message = 'Process exited';
  return (
    <div role="status" aria-label="terminal status" className={`${bar} ${info.status === 'lost' || info.error ? 'text-danger' : 'text-fg-muted'}`}>
      <span>{message}</span>
      {dead ? (
        <button
          type="button"
          className={barButton}
          disabled={!hostReady}
          onClick={() => terminals.respawn(info.id).catch(() => {} /* the reason is in info.error, shown above */)}
        >
          New terminal
        </button>
      ) : null}
      <button type="button" className={barButton} onClick={close}>
        Close
      </button>
    </div>
  );
}

function ContextMenu({ at, state, dismiss }: { at: { x: number; y: number }; state: TerminalTabState; dismiss(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const renderer = (state.terminalId && terminals.get(state.terminalId)?.renderer) || null;

  useEffect(() => {
    const outside = (ev: Event) => {
      if (!ref.current?.contains(ev.target as Node)) dismiss();
    };
    const escape = (ev: KeyboardEvent) => ev.key === 'Escape' && dismiss();
    window.addEventListener('mousedown', outside, true);
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('mousedown', outside, true);
      window.removeEventListener('keydown', escape, true);
    };
  }, [dismiss]);

  const items: { label: string; enabled: boolean; run(): void }[] = [
    { label: 'Copy', enabled: !!renderer?.hasSelection(), run: () => void navigator.clipboard.writeText(renderer!.getSelection()) },
    { label: 'Paste', enabled: !!renderer, run: () => void navigator.clipboard.readText().then((text) => renderer!.paste(text)) },
    { label: 'Select all', enabled: !!renderer, run: () => renderer!.selectAll() },
    { label: 'Clear', enabled: !!renderer, run: () => renderer!.clear() },
  ];
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="terminal"
      style={{ left: at.x, top: at.y }}
      className="absolute z-10 flex min-w-32 flex-col rounded-md border border-border bg-bg-overlay py-1 text-ui-sm"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={!item.enabled}
          onClick={() => {
            item.run();
            dismiss();
          }}
          className="px-3 py-1 text-left text-fg hover:bg-bg-hover disabled:text-fg-faint disabled:hover:bg-transparent"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M4.5 6l2 2-2 2M8.5 10.5h3" />
    </svg>
  );
}
