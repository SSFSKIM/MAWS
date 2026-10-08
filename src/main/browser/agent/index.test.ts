import { EventEmitter } from 'node:events';
import type { WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { TabStore } from '../tabs';
import { TabControls } from './control';
import { AgentCursor } from './cursor';
import { e2eTabIds, reachableSessions, startAgentPresence } from './index';

// What stays of E4c's browser tools in main (P1 A-54; the in-app browser spec of 2026-10-08, M4): the lineage rule, the
// e2e's tab ids, and the agent's presence over E4a's real store (the dialogs' wrap, parking, the e2e seam).

const A = 'App-A' as AppSessionId;

describe('reachableSessions (P-24, Decision Log 29)', () => {
  const T = 'App-T' as AppSessionId;
  it('reaches a side thread and its parent; a fork, a plain session or an unreadable index reach themselves', () => {
    const records: Record<string, unknown> = {
      [T]: { lineage: { kind: 'side-thread', parentAppSessionId: A } },
      'App-F': { lineage: { kind: 'fork', parentAppSessionId: A } },
      [A]: { lineage: null },
    };
    const sessions = { get: (id: AppSessionId) => (records[id] ?? null) as never };
    expect(reachableSessions(sessions, T)).toEqual([T, A]);
    expect(reachableSessions(sessions, 'App-F' as AppSessionId)).toEqual(['App-F']);
    expect(reachableSessions(sessions, A)).toEqual([A]);
    expect(reachableSessions(sessions, 'App-unknown' as AppSessionId)).toEqual(['App-unknown']);
    const broken = {
      get: () => {
        throw new Error('index unavailable');
      },
    };
    expect(reachableSessions(broken, T)).toEqual([T]);
  });
});

describe('e2eTabIds (Design §13 (b); Decision Log 36)', () => {
  it('mints b_000000000001 upward under MAWS_E2E=1, above any sequence id restored, and nothing otherwise', () => {
    expect(e2eTabIds({}, [])).toBeUndefined();
    const fresh = e2eTabIds({ MAWS_E2E: '1' }, [])!;
    expect([fresh(), fresh()]).toEqual(['b_000000000001', 'b_000000000002']);
    const restored = e2eTabIds({ MAWS_E2E: '1' }, [{ tabId: 'b_000000000007' }, { tabId: 'b_3fa9c0de12ab' }])!;
    expect(restored()).toBe('b_000000000008');
  });
});

// The wiring over E4a's real store: every new view's dialogs wrapped, parking by control and by lease, the seam.
describe('startAgentPresence', () => {
  class FakeWebContents extends EventEmitter {
    readonly loadURL = vi.fn(() => Promise.resolve());
    readonly close = vi.fn();
    readonly isDestroyed = () => false;
    readonly isLoading = () => false;
    readonly setBackgroundThrottling = vi.fn();
    readonly send = vi.fn();
    readonly sendInputEvent = vi.fn();
    readonly getLastWebPreferences = () => ({ safeDialogs: true });
    readonly native = vi.fn((_info: unknown, callback: (accept: boolean, text: string) => void) => callback(false, ''));
    constructor() {
      super();
      this.on('-run-dialog', this.native); // Electron's own dialog listener
    }
  }

  function wired() {
    const emit = (() => undefined) as <N extends EventName>(name: N, payload: EventPayload<N>) => unknown;
    let ids = 0;
    const store = new TabStore({
      emit,
      createView: () => ({ webContents: new FakeWebContents(), getBounds: () => ({ x: 0, y: 0, width: 0, height: 0 }) }) as unknown as WebContentsView,
      resolvePartition: () => DEFAULT_PARTITION,
      newTabId: () => `b_${String(++ids).padStart(12, '0')}`,
      schedule: () => {},
    });
    const views = { park: vi.fn() };
    const controls = new TabControls({ store });
    const cursor = new AgentCursor({ store, controls });
    const leased = new Set<string>();
    const held: string[] = [];
    const cua = {
      holds: (tabId: string) => leased.has(tabId),
      onChange: () => () => {},
      dialogs: { holds: (tabId: string) => leased.has(tabId), hold: (entry: { tab: { tabId: string } }) => void held.push(entry.tab.tabId) },
    };
    const presence = startAgentPresence({ store, emit, views, controls, cursor, cua });
    const open = (select = true) => store.open({ appSessionId: A, url: 'https://a.test/', select }).tab.tabId;
    const contentsOf = (tabId: string) => store.entry(tabId)!.view!.webContents as unknown as FakeWebContents;
    const stop = () => {
      presence.dispose();
      cursor.dispose();
      controls.dispose();
    };
    return { store, presence, views, controls, leased, held, open, contentsOf, stop };
  }

  it("wraps every new view's dialogs: an agent-held tab's alert is answered with its default, a leased one's goes to cua's held route", () => {
    const w = wired();
    const tabId = w.open(false);
    w.store.setControl(tabId, 'agent');
    const callback = vi.fn();
    w.contentsOf(tabId).emit('-run-dialog', { dialogType: 'alert', messageText: 'Saved.', defaultPromptText: '' }, callback);
    expect(callback).toHaveBeenCalledWith(false, '');
    expect(w.contentsOf(tabId).native).not.toHaveBeenCalled();
    w.leased.add(tabId);
    const heldCallback = vi.fn();
    w.contentsOf(tabId).emit('-run-dialog', { dialogType: 'confirm', messageText: 'Leave?', defaultPromptText: '' }, heldCallback);
    expect(w.held).toEqual([tabId]);
    expect(heldCallback).not.toHaveBeenCalled();
    w.stop();
  });

  it('parks an unplaced tab the agent acts on, through the view manager', () => {
    const w = wired();
    const tabId = w.open();
    w.controls.markActing(w.store.entry(tabId)!);
    expect(w.views.park).toHaveBeenCalledWith(w.store.entry(tabId), { x: 0, y: 0, width: 1280, height: 800 });
    w.stop();
  });

  it("the seam reads the tab's control and the person's last inputs, sends input with its screen point, and counts the cursor's messages", () => {
    const w = wired();
    const tabId = w.open();
    const entry = w.store.entry(tabId)!;
    expect(w.presence.seam.control(tabId)).toEqual({ control: 'idle', controlSince: entry.tab.controlSince });
    expect(w.presence.seam.control('b_00000000dead')).toBeNull();
    entry.input.emit({ kind: 'mouse', source: 'human', at: Date.now() });
    expect(w.presence.seam.lastInputs(tabId)).toEqual([{ kind: 'mouse', source: 'human', at: expect.any(Number) }]);
    entry.host = { isDestroyed: () => false, getContentBounds: () => ({ x: 100, y: 30, width: 800, height: 600 }) } as never;
    (entry.view as unknown as { getBounds: () => object }).getBounds = () => ({ x: 400, y: 50, width: 300, height: 200 });
    const contents = w.contentsOf(tabId);
    expect(w.presence.seam.sendInput(tabId, { type: 'mouseDown', x: 10, y: 20, button: 'left', clickCount: 1 })).toBe(true);
    expect(w.presence.seam.sendInput(tabId, { type: 'keyDown', keyCode: 'a' })).toBe(true);
    expect(contents.sendInputEvent.mock.calls).toEqual([[{ type: 'mouseDown', x: 10, y: 20, button: 'left', clickCount: 1, globalX: 510, globalY: 100 }], [{ type: 'keyDown', keyCode: 'a' }]]);
    expect(w.presence.seam.sendInput('b_00000000dead', { type: 'keyDown', keyCode: 'a' })).toBe(false);
    w.store.setControl(tabId, 'agent');
    w.store.setControl(tabId, 'idle'); // the agent lets go: the cursor hides
    expect(w.presence.seam.cursorMessages(tabId)).toBe(1);
    expect(contents.send).toHaveBeenCalledWith('browser:cursor', { kind: 'hide' });
    w.stop();
  });

  it('dispose lets go of the dialogs, parking and inputs: nothing parks afterwards', () => {
    const w = wired();
    w.presence.dispose();
    const tabId = w.open();
    w.controls.markActing(w.store.entry(tabId)!);
    expect(w.views.park).not.toHaveBeenCalled();
    expect(w.presence.seam.lastInputs(tabId)).toEqual([]);
    w.stop();
  });
});
