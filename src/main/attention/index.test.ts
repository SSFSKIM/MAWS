import { describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import { SETTINGS_DEFAULTS_V8 } from '@shared/settings/defaults';
import { item, record } from '../../../test/support/builders';
import { SessionReadModel } from '../sessions/read-model';
import { startAttentionService } from './service';
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
    const stop = startAttention(model, { ready: service.ready, settings: () => SETTINGS_DEFAULTS_V8, openWindow: () => { throw new Error('not clicked'); } });
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
});
