import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import { SETTINGS_DEFAULTS_V10 } from '@shared/settings/defaults';
import { item, record } from '../../../test/support/builders';
import { SessionReadModel } from '../sessions/read-model';
import { PERSIST_RETRY_MS, startAttentionService } from './service';
import { startAttention } from './index';

const electron = vi.hoisted(() => ({ shown: vi.fn(), badge: vi.fn(), bounce: vi.fn() }));
vi.mock('electron', () => ({
  app: { on: vi.fn(), dock: { setBadge: electron.badge, bounce: electron.bounce } },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    static isSupported() { return true; }
    on() { return this; }
    show() { electron.shown(); }
  },
}));
vi.mock('../ipc/router', () => ({ registerMainHandler: vi.fn() }));

describe('attention startup', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());
  it('seeds persisted attention after hydration without launch notifications, then announces new items', async () => {
    const model = new SessionReadModel('index');
    const id = 'app' as AppSessionId;
    let observe!: (items: AttentionItem[]) => void;
    model.register({ start: (writer) => {
      writer.observeRecord(record(id));
      observe = (items) => writer.observeAttention(id, items);
      return () => {};
    } });
    let loaded!: (items: AttentionItem[]) => void;
    const service = startAttentionService({
      onEvent: () => () => {}, onState: () => () => {},
      dispatch: async () => ({ ok: true, value: { event: null } }),
      register: () => {},
      emit: (name, payload) => { if (name === 'attention.changed') observe((payload as { items: AttentionItem[] }).items); },
      store: { list: () => new Promise((resolve) => { loaded = resolve; }), replaceForSession: async () => {}, retireForSession: async () => {} },
    });
    const stop = startAttention(model, { restoredIds: service.restoredIds, settings: () => SETTINGS_DEFAULTS_V10, openWindow: () => { throw new Error('not clicked'); } });
    const old = item(id, 'error', '2026-10-01T00:00:00Z');
    loaded([old]); // window still hidden/unfocused while the persisted table arrives
    await service.ready;
    expect(electron.shown).not.toHaveBeenCalled();
    expect(electron.bounce).not.toHaveBeenCalled();
    expect(electron.badge).toHaveBeenLastCalledWith('1');
    observe([old, item(id, 'question', '2026-10-02T00:00:00Z')]);
    expect(electron.shown).toHaveBeenCalledTimes(1);
    stop(); service.stop(); await service.settled();
  });
  it('notifies live approvals during load retries while restoring persisted items silently', async () => {
    vi.useFakeTimers();
    const model = new SessionReadModel('index');
    const id = 'live' as AppSessionId;
    const restoredId = 'restored' as AppSessionId;
    let observe!: (id: AppSessionId, items: AttentionItem[]) => void;
    model.register({ start: (writer) => {
      writer.observeRecord(record(id));
      writer.observeRecord(record(restoredId));
      observe = (id, items) => writer.observeAttention(id, items);
      return () => {};
    } });
    const listeners = new Map<string, (payload: { appSessionId: AppSessionId; items: AttentionItem[] }) => void>();
    const old = item(restoredId, 'error', '2026-10-01T00:00:00Z');
    const list = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue([old]);
    const service = startAttentionService({
      onEvent: (name, listener) => { listeners.set(name, listener as (payload: { appSessionId: AppSessionId; items: AttentionItem[] }) => void); return () => {}; },
      onState: () => () => {}, dispatch: async () => ({ ok: true, value: { event: null } }), register: () => {}, log: () => {},
      emit: (name, payload) => { if (name === 'attention.changed') { const change = payload as { appSessionId: AppSessionId; items: AttentionItem[] }; observe(change.appSessionId, change.items); } },
      store: { list, replaceForSession: async () => {}, retireForSession: async () => {} },
    });
    const stop = startAttention(model, { restoredIds: service.restoredIds, settings: () => SETTINGS_DEFAULTS_V10, openWindow: () => { throw new Error('not clicked'); } });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(list).toHaveBeenCalledTimes(2);
      const approval = item(id, 'permission', '2026-10-02T00:00:00Z');
      listeners.get('session.brokerItems')!({ appSessionId: id, items: [approval] });
      expect(electron.shown).toHaveBeenCalledTimes(1);
      expect(electron.badge).toHaveBeenLastCalledWith('1');
      await vi.advanceTimersByTimeAsync(PERSIST_RETRY_MS);
      await service.ready;
      expect(model.allAttention().get(restoredId)).toEqual([old]);
      expect(electron.shown).toHaveBeenCalledTimes(1);
      expect(electron.badge).toHaveBeenLastCalledWith('2');
      listeners.get('session.brokerItems')!({ appSessionId: id, items: [approval, item(id, 'question', '2026-10-02T01:00:00Z')] });
      expect(electron.shown).toHaveBeenCalledTimes(2);
      await service.settled();
    } finally { stop(); service.stop(); }
  });

});
