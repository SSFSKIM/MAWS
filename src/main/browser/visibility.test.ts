import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { TabDebugger } from './debugger';
import type { TabEntry } from './tabs';
import { attachFocusEmulation, setFocusEmulation } from './visibility';

const settle = () => new Promise((resolve) => setImmediate(resolve));

// A tab with a view and a TabDebugger stand-in that records what was sent.
function tab(attached = false) {
  const sent: unknown[] = [];
  const tabDebugger = {
    attached,
    attaching: false,
    attach: vi.fn(() => Promise.resolve()),
    send: vi.fn((method: string, params: unknown) => {
      sent.push([method, params]);
      return Promise.resolve({});
    }),
  };
  const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false });
  const entry = { view: { webContents }, debugger: tabDebugger } as unknown as TabEntry;
  return { entry, webContents, tabDebugger, sent };
}

// A tab over a real TabDebugger whose webContents.debugger answers Page.getFrameTree only when the test says so.
function tabWithPendingAttach() {
  const sent: unknown[] = [];
  let frameTree: () => void = () => {};
  const dbg = Object.assign(new EventEmitter(), {
    on: EventEmitter.prototype.on,
    attachedTo: false,
    attach() {
      dbg.attachedTo = true;
    },
    detach() {
      dbg.attachedTo = false;
    },
    isAttached: () => dbg.attachedTo,
    sendCommand(method: string, params?: unknown) {
      if (method === 'Page.getFrameTree') return new Promise((resolve) => (frameTree = () => resolve({ frameTree: { frame: { id: 'F' } } })));
      sent.push([method, params]);
      return Promise.resolve({});
    },
  });
  const webContents = Object.assign(new EventEmitter(), { debugger: dbg, isDestroyed: () => false });
  const entry = { view: { webContents }, debugger: new TabDebugger(webContents as never) } as unknown as TabEntry;
  return { entry, sent, settleAttach: () => frameTree() };
}

describe('focus emulation through the TabDebugger (E4a Design §3; A-33; Decision Log 39, 41)', () => {
  it('enables through send (which attaches when needed); disables only an attachment made or being made', () => {
    const detached = tab(false);
    setFocusEmulation(detached.entry, false);
    expect(detached.sent).toEqual([]); // the emulation went with the attachment
    setFocusEmulation(detached.entry, true);
    expect(detached.sent).toEqual([['Emulation.setFocusEmulationEnabled', { enabled: true }]]);
    const attached = tab(true);
    setFocusEmulation(attached.entry, false);
    expect(attached.sent).toEqual([['Emulation.setFocusEmulationEnabled', { enabled: false }]]);
    const closed = tab(true);
    setFocusEmulation({ ...closed.entry, debugger: null } as TabEntry, true); // no debugger (a closed tab)
    expect(closed.sent).toEqual([]);
  });

  it('a disable that follows an enable while the attach is still settling goes out after it: the last wanted value wins', async () => {
    const t = tabWithPendingAttach();
    void t.entry.debugger!.attach(); // at view creation, under 'on'
    setFocusEmulation(t.entry, true);
    setFocusEmulation(t.entry, false); // covered before the first page painted
    await settle();
    expect(t.sent).toEqual([]);
    t.settleAttach();
    await settle();
    expect(t.sent).toEqual([
      ['Emulation.setFocusEmulationEnabled', { enabled: true }],
      ['Emulation.setFocusEmulationEnabled', { enabled: false }],
    ]);
  });

  it('a failed command is logged, never thrown into Electron', async () => {
    const t = tab(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    t.tabDebugger.send.mockReturnValueOnce(Promise.reject(new Error('target closed')));
    setFocusEmulation(t.entry, true);
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('attaches at view creation; after each navigation attaches again (after a crash) and re-enables while wanted', () => {
    const t = tab(true);
    let wanted = false;
    attachFocusEmulation(t.entry, () => wanted);
    expect(t.tabDebugger.attach).toHaveBeenCalledTimes(1);
    t.webContents.emit('did-navigate', {}, 'https://a.test/'); // not wanted (say, still covered): attached all the same
    expect(t.tabDebugger.attach).toHaveBeenCalledTimes(2);
    expect(t.sent).toEqual([]);
    wanted = true;
    t.webContents.emit('did-navigate', {}, 'https://a.test/b');
    expect(t.sent).toEqual([['Emulation.setFocusEmulationEnabled', { enabled: true }]]);
    (t.entry as { view: unknown }).view = null; // the tab's view is gone
    t.webContents.emit('did-navigate', {}, 'https://a.test/c');
    expect(t.sent).toHaveLength(1);
    expect(t.tabDebugger.attach).toHaveBeenCalledTimes(3);
  });
});
