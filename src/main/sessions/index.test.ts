import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import type { MainContext } from '../ipc/router';
import type { AppSessionId } from '@shared/graph/ids';
import { item } from '../../../test/support/builders';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import { IndexSessionSource } from '../index/source';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } }));
const handlers = new Map<string, (input: unknown, context?: MainContext) => unknown>();
const interceptors = new Map<string, (input: unknown) => unknown>();
vi.mock('../ipc/router', () => ({
  registerMainHandler: (name: string, handler: (input: unknown) => unknown) => handlers.set(name, handler),
  interceptCommand: (name: string, handler: (input: unknown) => unknown) => { interceptors.set(name, handler); return () => interceptors.delete(name); },
  CommandFailure: class extends Error {},
}));

import { startSessions } from '.';

// The source is real: after the renderer disappears, a disk advance must stay unread.
describe('visibility belongs to the reporting renderer', () => {
  afterEach(() => { handlers.clear(); interceptors.clear(); });
  it.each(['destroyed', 'render-process-gone', 'did-start-navigation'])('releases visibility on %s, and a replacement page may report it again', (event) => {
    const dir = tempDir();
    const index = new Index(join(dir.path, 'index.sqlite'));
    const disk = summary();
    const appId = index.sessions.upsertFromSummary(disk).record.appId;
    const listeners = new Map<string, (payload: unknown) => void>();
    const source = new IndexSessionSource(index, {
      ...hosts,
      onEvent: (name, listener) => { listeners.set(name, listener as (payload: unknown) => void); return () => { listeners.delete(name); }; },
      snapshot: () => ({ state: 'starting', pid: null, restarts: 0, revision: 1 }),
    }, { emit: () => true, warmLinkedWorktrees: async () => {} });
    const sessions = startSessions({ env: {}, packaged: false, appRoot: process.cwd(), hosts, indexSource: source });
    const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false }) as unknown as MainContext['sender'];
    const visible = handlers.get('session.setVisible')!;
    try {
      visible({ appSessionId: appId, visible: true }, { sender });
      sender.emit(event, { url: 'file:///index.html', isMainFrame: true, isSameDocument: false, frame: null });
      listeners.get('fs.sessionChanged')!({ summary: { ...disk, size: disk.size + 100, leafUuid: 'new-leaf', lastRecordAt: '2026-10-02T12:00:00Z' } });
      expect(index.sessions.get(appId)?.unread).toBe(true);
      visible({ appSessionId: appId, visible: true }, { sender });
      expect(index.sessions.get(appId)?.unread).toBe(false);
    } finally { sessions.stop(); index.close(); dir.dispose(); }
  });

  it.each([
    { name: 'subframe', isMainFrame: false, isSameDocument: false },
    { name: 'same-document', isMainFrame: true, isSameDocument: true },
  ])('retains visibility during $name navigation and loading', ({ isMainFrame, isSameDocument }) => {
    const visibility = vi.fn();
    const sessions = startSessions({ env: {}, packaged: false, appRoot: process.cwd(), hosts, indexSource: { start: () => () => {}, onSetVisible: visibility } });
    const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false }) as unknown as MainContext['sender'];
    try {
      handlers.get('session.setVisible')!({ appSessionId: 'app', visible: true }, { sender });
      sender.emit('did-start-navigation', { url: 'file:///index.html#preview', isMainFrame, isSameDocument, frame: null });
      sender.emit('did-start-loading');
      expect(visibility.mock.calls).toEqual([['app', true]]);
    } finally { sessions.stop(); }
  });

  it('does not let one window hide a session still visible in another', () => {
    const visibility = vi.fn();
    const sessions = startSessions({ env: {}, packaged: false, appRoot: process.cwd(), hosts, indexSource: { start: () => () => {}, onSetVisible: visibility } });
    const a = Object.assign(new EventEmitter(), { isDestroyed: () => false }) as unknown as MainContext['sender'];
    const b = Object.assign(new EventEmitter(), { isDestroyed: () => false }) as unknown as MainContext['sender'];
    const set = handlers.get('session.setVisible')!;
    set({ appSessionId: 'app', visible: true }, { sender: a });
    set({ appSessionId: 'app', visible: true }, { sender: b });
    set({ appSessionId: 'app', visible: false }, { sender: a });
    expect(visibility.mock.calls).toEqual([['app', true]]);
    b.emit('destroyed');
    expect(visibility.mock.calls).toEqual([['app', true], ['app', false]]);
    sessions.stop();
  });
});

describe('answers cannot outlive attention', () => {
  afterEach(() => { handlers.clear(); interceptors.clear(); hosts.dispatch.mockClear(); });
  it('refuses an answer after host-loss retirement instead of forwarding it to the replacement host', async () => {
    const sessions = startSessions({ env: {}, packaged: false, appRoot: process.cwd(), hosts });
    const id = 'app' as AppSessionId;
    const pending = item(id, 'permission', '2026-10-02T00:00:00Z');
    let publish!: (items: typeof pending[]) => void;
    sessions.model.register({ start: (writer) => { publish = (items) => writer.observeAttention(id, items); return () => {}; } });
    publish([pending]);
    const answer = interceptors.get('session.answer');
    expect(answer).toBeTypeOf('function');
    const input = { appSessionId: id, requestId: pending.request.requestId, answer: { kind: 'permission', decision: 'deny', message: 'No' } };
    expect(await answer!(input)).toEqual({ outcome: 'delivered' });
    publish([]); // attention service's host-loss update
    expect(await answer!(input)).toEqual({ outcome: 'not_pending' });
    expect(hosts.dispatch).toHaveBeenCalledTimes(1);
    sessions.stop();
  });
});

const hosts = { dispatch: vi.fn(async () => ({ ok: true as const, value: { outcome: 'delivered' as const } })), onEvent: () => () => {}, onState: () => () => {} }; // C12: onState

describe('launch mode reaches the page', () => {
  afterEach(() => handlers.clear());

  it('session.launchMode answers the mode decided at start', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const index = startSessions({ env: {}, packaged: false, appRoot: process.cwd(), hosts });
    expect(handlers.get('session.launchMode')!(undefined)).toEqual({ mode: 'index' });
    index.stop();

    const env = { MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/empty.json', MAWS_SCENARIO_CLOCK: 'manual', MAWS_E2E: '1' };
    const scenario = startSessions({ env, packaged: false, appRoot: process.cwd(), hosts });
    expect(handlers.get('session.launchMode')!(undefined)).toEqual({ mode: 'scenario' });
    scenario.stop();
    log.mockRestore();
  });
});

describe('C4’s index source attaches through the read model', () => {
  afterEach(() => handlers.clear());

  const indexSource = () => {
    const stop = vi.fn();
    return { stop, start: vi.fn(() => stop) };
  };

  it('starts in launch mode index and stops with the sessions', () => {
    const source = indexSource();
    const sessions = startSessions({ env: {}, packaged: false, appRoot: process.cwd(), hosts, indexSource: source });
    expect(source.start).toHaveBeenCalledOnce();
    sessions.stop();
    expect(source.stop).toHaveBeenCalledOnce();
  });

  it('is refused unstarted in launch mode scenario, so the index never scans', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const source = indexSource();
    const env = { MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/empty.json', MAWS_SCENARIO_CLOCK: 'manual', MAWS_E2E: '1' };
    startSessions({ env, packaged: false, appRoot: process.cwd(), hosts, indexSource: source }).stop();
    expect(source.start).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('read-model: scenario mode, source ignored');
    log.mockRestore();
  });
});
