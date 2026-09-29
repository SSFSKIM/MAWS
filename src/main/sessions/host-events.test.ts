import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } }));

import type { AppSessionId } from '@shared/graph/ids';
import { humanTurn, record, status } from '../../../test/support/builders';
import { ev } from '../../../test/support/events';
import { item } from '../../../test/support/builders';
import { emit } from '../ipc/events';
import { emittedAttentionSource, hostEventSource } from '.';
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
    model.register({ start: (writer) => (writer.observeRecord(record('a1')), () => {}) });
    const stop = model.register(hostEventSource(hosts as never));
    listeners.get('session.status')!({ appSessionId: 'a1', status: status('a1', { engineState: 'running', turn: humanTurn }) });
    listeners.get('session.eventBatch')!({ appSessionId: 'a1', events: [ev('turn.started', {}), ev('tool.use', { toolName: 'Grep' })] });
    expect(model.midTurnCount()).toBe(1);
    expect(model.digests()).toMatchObject([{ appSessionId: 'a1' as AppSessionId, phase: 'working', activity: 'Searching' }]);
    stop();
    expect(listeners.size).toBe(0);
  });

  it('folds a C4 replay run in full once the host reports its progress, with no engine status', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const hosts = { onEvent: (name: string, listener: (payload: unknown) => void) => (listeners.set(name, listener), () => listeners.delete(name)) };
    const model = new SessionReadModel('index');
    model.register({ start: (writer) => (writer.observeRecord(record('r1')), () => {}) });
    model.register(hostEventSource(hosts as never));
    listeners.get('session.eventBatch')!({ appSessionId: 'r1', events: [ev('turn.started', { seq: null })] });
    expect(model.digests()[0]?.phase ?? 'idle').toBe('idle'); // history: no live process yet
    listeners.get('session.replay.progress')!({ appSessionId: 'r1', state: 'running', index: 0, total: 3, at: null, speed: 1, message: null });
    listeners.get('session.eventBatch')!({ appSessionId: 'r1', events: [ev('turn.started', { seq: null }), ev('tool.use', { seq: null, toolName: 'Grep' })] });
    expect(model.digests()).toMatchObject([{ appSessionId: 'r1' as AppSessionId, phase: 'working', activity: 'Searching' }]);
  });

  it('sees attention.changed as emitted through main’s emit, in either launch mode', () => {
    for (const mode of ['index', 'scenario'] as const) {
      const model = new SessionReadModel(mode);
      const stop = mode === 'index' ? model.register(emittedAttentionSource()) : model.registerScenario(emittedAttentionSource());
      const items = [item('a1', 'permission', '2026-09-28T10:00:00Z')];
      expect(emit('attention.changed', { appSessionId: 'a1' as AppSessionId, items })).toBe(true);
      expect(model.attention('a1' as AppSessionId)).toEqual(items);
      stop();
      emit('attention.changed', { appSessionId: 'a1' as AppSessionId, items: [] });
      expect(model.attention('a1' as AppSessionId)).toEqual(items);
    }
  });
});
