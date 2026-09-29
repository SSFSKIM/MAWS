// The Terminal tool (C9 Residue *Terminal tool and X5*): an X5 `PanelTool` whose state is the identity of a terminal in
// the registry (plus its close confirmation), so the shell, its emulator and its scrollback outlive every tab switch,
// panel close and session switch under a pin; and `openTerminal`, C10's entry point for "attach in a terminal tab".
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { PtyInfo } from '@shared/ipc/schema';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { panelHost } from '../../panel/host';
import type { PanelTool, PanelToolInit } from '../../panel/tool';
import { terminals, type TerminalId } from '../../terminal/registry';
import { sessionDirectory, TerminalIcon, TerminalView } from './TerminalView';

export const TERMINAL_TOOL_ID = 'terminal';

export interface TerminalParams {
  cwd?: string; // default: the session's worktree path, else its directory
  command?: string; // typed into the first shell followed by a newline (C10's attach path)
}

// The close confirmation lives beside the terminal's identity (the host may ask to close a tab that is not shown);
// `confirmed` is the owner's "Close" in that bar, after which the host's second `beforeClose` lets the close through;
// `closeError` is why the last close could not end the shell (the tab stays until one does).
export interface TerminalTabUi {
  confirmClose: boolean;
  process: string | null; // what runs in the foreground; null when the host could not say
  confirmed: boolean;
  closeError: string | null;
  terminalId: TerminalId | null; // null until the tab has a session and a directory to start in
}

export interface TerminalTabState {
  readonly terminalId: TerminalId | null; // the registry's terminal, once started (reads `ui`)
  readonly ui: StoreApi<TerminalTabUi>;
  readonly instanceId: string; // the terminal's label, which is how a reloaded page re-adopts it
  params: TerminalParams;
  owner: AppSessionId | null; // the session the tab was opened for, when known
  focusSeen: number; // the last X5 `focusRequest` the view acted on or used up (the counter outlives the view's mounts)
}

// The states the host has disposed (`dispose` below); a pending tab's retry checks it.
const disposed = new WeakSet<TerminalTabState>();

// Re-adoption after a renderer reload (C8a's ruling, 2026-09-29): the page starts it once, before any tab could want a
// shell, and until it has answered no terminal opens, so a restored tab reattaches to the pty still running under its
// label (the checkpoint reattach) instead of starting a second shell. The panel host restores tabs when the layout
// hydrates, which C5 drives, so the order is enforced here rather than by starting adoption first.
let adoption: Promise<TerminalId[]> | null = null;
let adoptionSettled = false;
export function adoptTerminals(accept?: (info: PtyInfo) => boolean): Promise<TerminalId[]> {
  adoption ??= terminals
    .adopt(accept)
    .catch((error: unknown) => {
      console.error('[terminal] re-adoption failed; tabs open new shells', error);
      return [];
    })
    .finally(() => void (adoptionSettled = true));
  return adoption;
}
// Tests: forget the page's adoption.
export function resetTerminalAdoption(): void {
  adoption = null;
  adoptionSettled = false;
}

// Starts the tab's terminal if it has none: the one the registry re-adopted under this tab's label after a reload, or
// a new one in `params.cwd`, else the session's directory. A tab with no session yet (X5 allows a pinned tab to be
// restored while Overview is shown) stays pending; its view asks for a session and calls this again when one is shown.
// While the page's adoption is in flight the tab also stays pending and is retried when it answers.
export function ensureTerminal(state: TerminalTabState, shown: { appSessionId: AppSessionId | null; session: SessionRecord | null }): TerminalId | null {
  // A tab disposed while it waited (closed, reconciled or unregistered before the adoption answered) opens nothing, and
  // a shell the adoption re-created under its label is released, so no shell is left running with no tab.
  if (disposed.has(state)) {
    const orphan = terminals.list().find((info) => info.label === state.instanceId);
    if (orphan) terminals.close(orphan.id).catch((error: unknown) => console.error(`[terminal] could not end ${orphan.id} of a closed tab`, error));
    return null;
  }
  const current = state.ui.getState().terminalId;
  if (current) return current;
  if (adoption && !adoptionSettled) {
    void adoption.then(() => ensureTerminal(state, shown));
    return null;
  }
  const adopted = terminals.list().find((info) => info.label === state.instanceId);
  const owner = state.owner ?? shown.appSessionId ?? shown.session?.appId ?? null;
  const cwd = state.params.cwd ?? (shown.session ? sessionDirectory(shown.session) : undefined);
  let terminalId: TerminalId | null = adopted?.id ?? null;
  if (!terminalId && owner && cwd) {
    const { command } = state.params;
    terminalId = terminals.open({ appSessionId: owner, label: state.instanceId, cwd, ...(command ? { command } : {}) });
  }
  if (terminalId) state.ui.setState({ terminalId });
  return terminalId;
}

// Whether X5's `focusRequest` counter carries a request the tab has not yet acted on or used up; marks it seen.
export function takeFocusRequest(state: TerminalTabState, request: number): boolean {
  if (request <= state.focusSeen) return false;
  state.focusSeen = request;
  return true;
}

function createState({ appSessionId, session, instanceId, params }: PanelToolInit<TerminalParams>): TerminalTabState {
  const ui = createStore<TerminalTabUi>()(() => ({ confirmClose: false, process: null, confirmed: false, closeError: null, terminalId: null }));
  const state: TerminalTabState = {
    get terminalId() {
      return ui.getState().terminalId;
    },
    ui,
    instanceId,
    params: { ...params },
    owner: appSessionId ?? session?.appId ?? null,
    focusSeen: 0,
  };
  ensureTerminal(state, { appSessionId, session });
  return state;
}

// New parameters for a tab (X5's re-targeting); a tab still waiting for its terminal starts it with them.
function open(state: TerminalTabState, params: TerminalParams): void {
  if (state.terminalId) return;
  state.params = { ...state.params, ...params };
  ensureTerminal(state, { appSessionId: null, session: null });
}

// A running terminal asks before it closes when a program other than the shell is in the foreground, and when the
// host cannot say (fail closed). Otherwise, or once the owner confirmed, the close happens here: the shell is killed
// and the handle disposed before the host may remove the tab, so a kill that fails keeps the tab with the reason
// instead of leaving a shell running behind no tab.
async function beforeClose(state: TerminalTabState): Promise<boolean> {
  const { confirmed, terminalId } = state.ui.getState();
  if (!terminalId) return true; // never started: nothing runs
  if (!confirmed && terminals.get(terminalId)?.info.status === 'running') {
    let foreground: { process: string | null; busy: boolean };
    try {
      foreground = await terminals.foreground(terminalId);
    } catch {
      foreground = { process: null, busy: true };
    }
    if (foreground.busy) {
      state.ui.setState({ confirmClose: true, process: foreground.process, closeError: null });
      return false;
    }
  }
  try {
    await terminals.close(terminalId);
  } catch (error) {
    state.ui.setState({ closeError: error instanceof Error ? error.message : String(error) });
    return false;
  }
  state.ui.setState({ closeError: null });
  return true;
}

// The backstop: a host may dispose a tab without asking (C8a removes a deleted session's tabs without `beforeClose`), so
// a terminal still in the registry is ended here, fire-and-forget, the failure only logged since no tab is left to show
// it. After a completed `beforeClose` the registry no longer has the terminal and nothing is killed; a second dispose
// of the same state does nothing. The owner's own close keeps `beforeClose`'s contract (ask when busy, veto a failed kill).
function dispose(state: TerminalTabState): void {
  if (disposed.has(state)) return;
  disposed.add(state);
  const { terminalId } = state.ui.getState();
  state.ui.setState({ confirmClose: false, process: null, confirmed: false, closeError: null });
  if (!terminalId || !terminals.get(terminalId)) return;
  terminals.close(terminalId).catch((error: unknown) => console.error(`[terminal] could not end ${terminalId} on dispose`, error));
}

export const terminalTool: PanelTool<TerminalTabState, TerminalParams> = {
  id: TERMINAL_TOOL_ID,
  title: 'Terminal',
  icon: TerminalIcon,
  pinnable: true,
  multiInstance: true,
  createState,
  open,
  beforeClose,
  dispose,
  render: TerminalView,
};

// C10's "attach in a terminal tab": a new Terminal tab in `cwd` whose shell runs `command` first. Returns the tab id.
export function openTerminal({ appSessionId, cwd, command }: { appSessionId: AppSessionId; cwd: string; command?: string }): string {
  return panelHost.addTool<TerminalParams>(TERMINAL_TOOL_ID, { appSessionId, params: { cwd, ...(command ? { command } : {}) } });
}
