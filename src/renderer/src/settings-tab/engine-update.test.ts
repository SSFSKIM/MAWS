// W13: Settings › Engine's "Update Claude Code…" is a pinned Terminal tab no session owns, running the user's own
// `claude update` from the home directory.
import { describe, expect, it, vi } from 'vitest';
import { panelHost } from '../panel/host';
import { ENGINE_UPDATE_OWNER, openEngineUpdate, UPDATE_COMMAND } from './engine-update';

describe('openEngineUpdate', () => {
  it('asks the panel host for a pinned Terminal tab, with no session, running claude update from home', () => {
    const addTool = vi.spyOn(panelHost, 'addTool').mockReturnValue('terminal:9');
    try {
      expect(openEngineUpdate()).toBe('terminal:9');
      expect(UPDATE_COMMAND).toBe('cd ~ && claude update');
      expect(addTool).toHaveBeenCalledExactlyOnceWith('terminal', { appSessionId: null, pin: true, params: { cwd: '/', command: UPDATE_COMMAND, owner: ENGINE_UPDATE_OWNER } });
    } finally {
      addTool.mockRestore();
    }
  });
});
