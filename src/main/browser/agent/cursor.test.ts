import { EventEmitter } from 'node:events';
import type { WebContentsView } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { BROWSER_CURSOR_CHANNEL, type AgentCursorMessage } from '@shared/browser/cursor';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import { BROWSER_AGENT_IDLE_MS } from '@shared/maws/browser';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { TabDebugger } from '../debugger';
import { TabStore, type TabEntry } from '../tabs';
import { TabControls } from './control';
import { AgentCursor } from './cursor';

// The main side of the agent's cursor (E4c Design §9; Decision Log 10, 23): a message to the tab's own page for each mouse
// command the tab's TabDebugger sends while the agent holds it, `move` and `target` before an action from the element's
// box, `hide` when the agent lets go; nothing for anything else.

const A = 'App-A' as AppSessionId;

class FakeElectronDebugger extends EventEmitter {
  attached = false;
  attach() {
    this.attached = true;
  }
  detach() {
    this.attached = false;
  }
  isAttached() {
    return this.attached;
  }
  async sendCommand(method: string): Promise<unknown> {
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'FRAME-MAIN' } } };
    return {};
  }
}

function harness() {
  vi.useFakeTimers({ now: Date.parse('2026-10-07T09:00:00.000Z') });
  const emit = (() => undefined) as <N extends EventName>(name: N, payload: EventPayload<N>) => unknown;
  const sent: [string, AgentCursorMessage][][] = [];
  const store = new TabStore({
    emit,
    createView: () => {
      const messages: [string, AgentCursorMessage][] = [];
      sent.push(messages);
      const webContents = {
        debugger: new FakeElectronDebugger(),
        loadURL: () => Promise.resolve(),
        close: () => {},
        isDestroyed: () => false,
        setBackgroundThrottling: () => {},
        send: (channel: string, message: AgentCursorMessage) => void messages.push([channel, message]),
      };
      return { webContents } as unknown as WebContentsView;
    },
    resolvePartition: () => DEFAULT_PARTITION,
    schedule: () => {},
    now: Date.now,
  });
  const controls = new TabControls({ store });
  const cursor = new AgentCursor({ store, controls });
  const open = () => store.entry(store.open({ appSessionId: A, url: 'https://a.test/', select: true }).tab.tabId)!;
  const mouse = (entry: TabEntry, type: string, x = 10, y = 20, sessionId?: string) => entry.debugger!.send('Input.dispatchMouseEvent', { type, x, y, button: 'left' }, sessionId);
  return { store, controls, cursor, sent, open, mouse };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the agent cursor in main (Design §9)', () => {
  it('sends move, press and release for the mouse commands the agent sends, to the tab\'s own page only', async () => {
    const h = harness();
    const entry = h.open();
    const other = h.open();
    h.controls.markActing(entry);
    await h.mouse(entry, 'mouseMoved', 12.5, 40);
    await h.mouse(entry, 'mousePressed', 12.5, 40);
    await h.mouse(entry, 'mouseReleased', 12.5, 40);
    expect(h.sent[0]).toEqual([
      [BROWSER_CURSOR_CHANNEL, { kind: 'move', x: 12.5, y: 40 }],
      [BROWSER_CURSOR_CHANNEL, { kind: 'press', x: 12.5, y: 40 }],
      [BROWSER_CURSOR_CHANNEL, { kind: 'release', x: 12.5, y: 40 }],
    ]);
    expect(h.sent[1]).toEqual([]);
    expect(h.cursor.messages(entry)).toBe(3);
    expect(h.cursor.messages(other)).toBe(0);
  });

  it('sends nothing for wheels, keys, a child session\'s commands, or a tab the agent does not hold', async () => {
    const h = harness();
    const entry = h.open();
    await h.mouse(entry, 'mouseMoved'); // idle: another holder's CDP (E4b, E4d) draws no agent cursor
    h.controls.markActing(entry);
    await h.mouse(entry, 'mouseWheel');
    await entry.debugger!.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a' });
    await entry.debugger!.send('Input.insertText', { text: 'Ada' });
    await h.mouse(entry, 'mouseMoved', 1, 2, 'CHILD-SESSION');
    expect(h.sent[0]).toEqual([]);
  });

  it('aims before an action: move to the box\'s centre, then the target with its box', () => {
    const h = harness();
    const entry = h.open();
    h.controls.markActing(entry);
    h.cursor.aim(entry, { x: 100, y: 50, width: 40, height: 21 });
    expect(h.sent[0]).toEqual([
      [BROWSER_CURSOR_CHANNEL, { kind: 'move', x: 120, y: 60.5 }],
      [BROWSER_CURSOR_CHANNEL, { kind: 'target', x: 120, y: 60.5, box: { x: 100, y: 50, width: 40, height: 21 } }],
    ]);
  });

  it('hides when the agent lets go: its lapse to idle, or the person taking the page', () => {
    const h = harness();
    const entry = h.open();
    h.controls.markActing(entry);
    h.controls.actionEnded(entry);
    vi.advanceTimersByTime(BROWSER_AGENT_IDLE_MS);
    expect(h.sent[0]).toEqual([[BROWSER_CURSOR_CHANNEL, { kind: 'hide' }]]);
    h.controls.markActing(entry);
    entry.input.emit({ kind: 'mouse', source: 'human', at: Date.now() });
    expect(entry.tab.control).toBe('human');
    expect(h.sent[0]).toEqual([
      [BROWSER_CURSOR_CHANNEL, { kind: 'hide' }],
      [BROWSER_CURSOR_CHANNEL, { kind: 'hide' }],
    ]);
  });

  it("lets go of a view's debugger when the view goes (suspended or closed), so nothing keeps a closed tab", async () => {
    const original = TabDebugger.prototype.onCommand;
    const released: TabDebugger[] = [];
    vi.spyOn(TabDebugger.prototype, 'onCommand').mockImplementation(function (this: TabDebugger, observer) {
      const off = original.call(this, observer);
      return () => {
        released.push(this);
        off();
      };
    });
    const h = harness();
    const suspended = h.open();
    const closed = h.open();
    const [first, second] = [suspended.debugger!, closed.debugger!];
    h.store.suspend(suspended.tab.tabId);
    h.store.close(closed.tab.tabId);
    expect(released).toEqual([first, second]);
    h.cursor.dispose();
    expect(released).toEqual([first, second]); // nothing else was held
  });

  it('a new view of the tab is followed too, and a destroyed page is sent nothing', async () => {
    const h = harness();
    const entry = h.open();
    h.store.suspend(entry.tab.tabId);
    h.store.load(entry.tab.tabId, 'https://a.test/');
    h.controls.markActing(entry);
    await h.mouse(entry, 'mouseMoved');
    expect(h.sent[1]).toEqual([[BROWSER_CURSOR_CHANNEL, { kind: 'move', x: 10, y: 20 }]]);
    (entry.view!.webContents as unknown as { isDestroyed: () => boolean }).isDestroyed = () => true;
    h.cursor.hide(entry);
    expect(h.sent[1]).toHaveLength(1);
  });
});
