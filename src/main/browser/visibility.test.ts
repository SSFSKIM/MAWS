import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { TabEntry } from './tabs';
import { attachFocusEmulation, setFocusEmulation } from './visibility';

const settle = () => new Promise((resolve) => setImmediate(resolve));

// A tab with a view and a TabDebugger stand-in that records what was sent.
function tab(attached = false) {
  const sent: unknown[] = [];
  const tabDebugger = {
    attached,
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

describe('focus emulation through the TabDebugger (E4a Design §3; A-33; Decision Log 39, 41)', () => {
  it('enables through send (which attaches when needed); disables only an attachment that still exists', () => {
    const detached = tab(false);
    setFocusEmulation(detached.entry, false);
    expect(detached.sent).toEqual([]); // the emulation went with the attachment
    setFocusEmulation(detached.entry, true);
    expect(detached.sent).toEqual([['Emulation.setFocusEmulationEnabled', { enabled: true }]]);
    const attached = tab(true);
    setFocusEmulation(attached.entry, false);
    expect(attached.sent).toEqual([['Emulation.setFocusEmulationEnabled', { enabled: false }]]);
    setFocusEmulation({ ...attached.entry, debugger: null } as TabEntry, true); // no debugger (a closed tab): nothing
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

  it('attaches at view creation and re-enables after each navigation while the view should have it', () => {
    const t = tab(true);
    let wanted = false;
    attachFocusEmulation(t.entry, () => wanted);
    expect(t.tabDebugger.attach).toHaveBeenCalledTimes(1);
    t.webContents.emit('did-navigate', {}, 'https://a.test/');
    expect(t.sent).toEqual([]);
    wanted = true;
    t.webContents.emit('did-navigate', {}, 'https://a.test/b');
    expect(t.sent).toEqual([['Emulation.setFocusEmulationEnabled', { enabled: true }]]);
    (t.entry as { view: unknown }).view = null; // the tab's view is gone
    t.webContents.emit('did-navigate', {}, 'https://a.test/c');
    expect(t.sent).toHaveLength(1);
  });
});
