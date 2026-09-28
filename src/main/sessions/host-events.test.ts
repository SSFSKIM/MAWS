import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } }));

import type { AppSessionId } from '@shared/graph/ids';
import { humanTurn, status } from '../../../test/support/builders';
import { ev } from '../../../test/support/events';
import { hostEventSource } from '.';
import { SessionReadModel } from './read-model';

describe('read model snapshot matches events', () => {
  it('folds the engine host’s batches and statuses in index mode', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const hosts = {
      onEvent: (name: string, listener: (payload: unknown) => void) => {
        listeners.set(name, listener);
        return () => listeners.delete(name);
      },
    };
    const model = new SessionReadModel('index');
    const stop = model.register(hostEventSource(hosts as never));
    listeners.get('session.status')!({ appSessionId: 'a1', status: status('a1', { engineState: 'running', turn: humanTurn }) });
    listeners.get('session.eventBatch')!({ appSessionId: 'a1', events: [ev('turn.started', {}), ev('tool.use', { toolName: 'Grep' })] });
    expect(model.midTurnCount()).toBe(1);
    expect(model.digests()).toMatchObject([{ appSessionId: 'a1' as AppSessionId, phase: 'working', activity: 'Searching' }]);
    stop();
    expect(listeners.size).toBe(0);
  });
});
