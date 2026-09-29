// The Terminal tool (C9 Residue *Terminal tool and X5*): an X5 `PanelTool` whose state is the identity of a terminal in
// the registry (plus its close confirmation), so the shell, its emulator and its scrollback outlive every tab switch,
// panel close and session switch under a pin; and `openTerminal`, C10's entry point for "attach in a terminal tab".
import type { AppSessionId } from '@shared/graph/ids';
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
}

export interface TerminalTabState {
  readonly terminalId: TerminalId;
  readonly ui: StoreApi<TerminalTabUi>;
}

function createState({ appSessionId, session, instanceId, params }: PanelToolInit<TerminalParams>): TerminalTabState {
  const ui = createStore<TerminalTabUi>()(() => ({ confirmClose: false, process: null, confirmed: false, closeError: null }));
  // After a reload the registry has already re-adopted this tab's shell under its label (the tab id).
  const adopted = terminals.list().find((info) => info.label === instanceId);
  if (adopted) return { terminalId: adopted.id, ui };
  const owner = appSessionId ?? session?.appId ?? null;
  const cwd = params?.cwd ?? (session ? sessionDirectory(session) : undefined);
  if (!owner || !cwd) throw new Error('a terminal needs a session to belong to and a directory to start in');
  const terminalId = terminals.open({ appSessionId: owner, label: instanceId, cwd, ...(params?.command ? { command: params.command } : {}) });
  return { terminalId, ui };
}

// A running terminal asks before it closes when a program other than the shell is in the foreground, and when the
// host cannot say (fail closed). Otherwise, or once the owner confirmed, the close happens here: the shell is killed
// and the handle disposed before the host may remove the tab, so a kill that fails keeps the tab with the reason
// instead of leaving a shell running behind no tab.
async function beforeClose(state: TerminalTabState): Promise<boolean> {
  const { confirmed } = state.ui.getState();
  if (!confirmed && terminals.get(state.terminalId)?.info.status === 'running') {
    let foreground: { process: string | null; busy: boolean };
    try {
      foreground = await terminals.foreground(state.terminalId);
    } catch {
      foreground = { process: null, busy: true };
    }
    if (foreground.busy) {
      state.ui.setState({ confirmClose: true, process: foreground.process, closeError: null });
      return false;
    }
  }
  try {
    await terminals.close(state.terminalId);
  } catch (error) {
    state.ui.setState({ closeError: error instanceof Error ? error.message : String(error) });
    return false;
  }
  state.ui.setState({ closeError: null });
  return true;
}

// The shell is already gone (`beforeClose` closed it); the tab's own state holds nothing else to release. A tab the
// host removes without asking (its tool unregistered) leaves its shell to the registry, which re-adopts it on reload.
function dispose(state: TerminalTabState): void {
  state.ui.setState({ confirmClose: false, process: null, closeError: null });
}

export const terminalTool: PanelTool<TerminalTabState, TerminalParams> = {
  id: TERMINAL_TOOL_ID,
  title: 'Terminal',
  icon: TerminalIcon,
  pinnable: true,
  multiInstance: true,
  createState,
  beforeClose,
  dispose,
  render: TerminalView,
};

// C10's "attach in a terminal tab": a new Terminal tab in `cwd` whose shell runs `command` first. Returns the tab id.
export function openTerminal({ appSessionId, cwd, command }: { appSessionId: AppSessionId; cwd: string; command?: string }): string {
  return panelHost.addTool<TerminalParams>(TERMINAL_TOOL_ID, { appSessionId, params: { cwd, ...(command ? { command } : {}) } });
}
