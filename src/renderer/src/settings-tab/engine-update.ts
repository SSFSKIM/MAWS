// Settings › Engine's "Update Claude Code…" (W13; charter D-1 as amended 2026-10-01): a pinned Terminal tab whose login
// shell runs the user's own `claude update` from the home directory, so the user's installer and channel decide what
// arrives. MAWS's own launches set DISABLE_AUTOUPDATER=1, so this is the update's way in from MAWS; the host resolves the
// binary at every launch, so new sessions start on the new version and running ones keep theirs.
import type { AppSessionId } from '@shared/graph/ids';
import { panelHost } from '../panel/host';
import { TERMINAL_TOOL_ID, type TerminalParams } from '../tools/terminal';

export const UPDATE_COMMAND = 'cd ~ && claude update';
// The label the update's shell is filed under in the PTY host: no session owns it (Settings shows none).
export const ENGINE_UPDATE_OWNER = 'maws-engine-update' as AppSessionId;

export function openEngineUpdate(): string {
  return panelHost.addTool<TerminalParams>(TERMINAL_TOOL_ID, { appSessionId: null, pin: true, params: { cwd: '/', command: UPDATE_COMMAND, owner: ENGINE_UPDATE_OWNER } });
}
