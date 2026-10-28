import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientOf } from '../ipc/clients';
import { emit } from '../ipc/events';
import { registerMainHandler } from '../ipc/router';
import { appWindows } from '../windows';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import { SETTINGS_DEFAULTS_V19 } from '@shared/settings/defaults';
import { digest, item, record } from '../../../test/support/builders';
import { SessionReadModel } from '../sessions/read-model';
import { PERSIST_RETRY_MS, startAttentionService } from './service';
import { electronClientPort } from '../client/electron-port';
import { startAttention } from './index';

const electron = vi.hoisted(() => ({ shown: vi.fn(), badge: vi.fn(), bounce: vi.fn(), notices: [] as { fire(event: string, ...args: unknown[]): void }[] }));
vi.mock('electron', () => ({
  app: { on: vi.fn(), dock: { setBadge: electron.badge, bounce: electron.bounce } },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    static isSupported() { return true; }
    private listeners = new EventEmitter();
    constructor() { electron.notices.push(this); }
    on(event: string, listener: (...args: unknown[]) => void) { this.listeners.on(event, listener); return this; }
    fire(event: string, ...args: unknown[]) { this.listeners.emit(event, {}, ...args); }
    show() { electron.shown(); }
    close() {}
  },
}));
vi.mock('../ipc/router', () => ({ registerMainHandler: vi.fn() }));
vi.mock('../ipc/events', () => ({ emit: vi.fn() }));
vi.mock('../windows', () => ({ appWindows: vi.fn(() => []), isAppWindow: vi.fn(() => true) }));

describe('attention startup', () => {
  beforeEach(() => { vi.clearAllMocks(); electron.notices = []; vi.mocked(appWindows).mockReturnValue([]); });
  afterEach(() => vi.useRealTimers());
  it('keeps viewing across child-frame loads, and releases only a main-frame navigation without accumulating listeners', () => {
    const sender = Object.assign(new EventEmitter(), { id: 7, isDestroyed: () => false });
    const win = Object.assign(new EventEmitter(), { webContents: sender, isFocused: () => true });
    vi.mocked(appWindows).mockReturnValue([win as never]);
    const model = new SessionReadModel('index');
    const id = 'viewed' as AppSessionId;
    let observe!: (items: AttentionItem[]) => void;
    model.register({ start: (writer) => {
      writer.observeRecord(record(id));
      observe = (items) => writer.observeAttention(id, items);
      return () => {};
    } });
    const stop = startAttention(model, { restoredIds: new Set(), settings: () => SETTINGS_DEFAULTS_V19, port: electronClientPort({ env: {}, openWindow: () => { throw new Error('already open'); } }) });
    const handler = vi.mocked(registerMainHandler).mock.calls.find(([name]) => name === 'attention.viewing')![1] as (input: { appSessionId: AppSessionId }, context: unknown) => void;
    const view = () => handler({ appSessionId: id }, { client: clientOf(sender as never) });
    try {
      view();
      sender.emit('did-start-loading'); // also fires for an iframe
      sender.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
      observe([item(id, 'question', '2026-10-23T00:00:00Z')]);
      expect(emit).not.toHaveBeenCalled();
      sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
      observe([item(id, 'question', '2026-10-23T01:00:00Z')]);
      expect(emit).not.toHaveBeenCalled();
      for (let n = 0; n < 3; n++) {
        sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
        view();
        expect(sender.listenerCount('did-start-navigation')).toBe(2); // followAppPages and the page's ClientRef, however many pages
        expect(sender.listenerCount('destroyed')).toBe(1);
      }
      sender.emit('render-process-gone');
      observe([item(id, 'question', '2026-10-23T02:00:00Z')]);
      expect(emit).toHaveBeenCalledWith('attention.notified', expect.objectContaining({ appSessionId: id, delivery: 'in-app' }));
    } finally { stop(); }
  });

  it('delivers a failed notification reply only after the newly created page asks for pending navigation', async () => {
    const model = new SessionReadModel('index');
    const id = 'cold-window' as AppSessionId;
    let writer!: import('../sessions/read-model').ReadModelWriter;
    model.register({ start: (w) => { writer = w; w.observeRecord(record(id)); return () => {}; } });
    const win = { isMinimized: () => false, show: vi.fn(), focus: vi.fn() };
    const openWindow = vi.fn(() => win as never);
    const stop = startAttention(model, { restoredIds: new Set(), settings: () => SETTINGS_DEFAULTS_V19, port: electronClientPort({ env: {}, openWindow }),
      actions: { reply: vi.fn().mockRejectedValue(new Error('Host unavailable')), canAllow: vi.fn(), allow: vi.fn() } });
    try {
      writer.setDigest(digest(id, { phase: 'working' }));
      writer.setDigest(digest(id, { lastTurnEndedAt: '2026-10-23T00:00:00Z' }));
      electron.notices[0].fire('reply', 'Recover this exact reply');
      await vi.waitFor(() => expect(openWindow).toHaveBeenCalledOnce());
      expect(emit).not.toHaveBeenCalled(); // no subscriber yet in the new window
      const pending = vi.mocked(registerMainHandler).mock.calls.find(([name]) => name === 'attention.pendingNavigate')![1] as () => { navigate: unknown };
      expect(pending()).toEqual({ navigate: { appSessionId: id, attentionId: null, source: 'notification' } });
      expect(emit).toHaveBeenCalledExactlyOnceWith('attention.notified', { appSessionId: id, attentionId: null, delivery: 'in-app', at: expect.any(String), error: 'Host unavailable', reply: 'Recover this exact reply' });
      expect(pending()).toEqual({ navigate: null });
      expect(emit).toHaveBeenCalledOnce();
    } finally { stop(); }
  });

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
    const stop = startAttention(model, { restoredIds: service.restoredIds, settings: () => SETTINGS_DEFAULTS_V19, port: electronClientPort({ env: {}, openWindow: () => { throw new Error('not clicked'); } }) });
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
    const stop = startAttention(model, { restoredIds: service.restoredIds, settings: () => SETTINGS_DEFAULTS_V19, port: electronClientPort({ env: {}, openWindow: () => { throw new Error('not clicked'); } }) });
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
