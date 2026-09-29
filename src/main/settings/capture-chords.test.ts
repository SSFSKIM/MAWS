// layout.captureChords (C11 M5 fix wave, item 1): while the Settings tab records a chord, the window's application menu
// gives up its key equivalents, so ⌘W, ⌘K or ⌘1 reach the capture instead of closing a tab or opening the palette.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { captureChords } from './capture-chords';

function sender() {
  const contents = Object.assign(new EventEmitter(), { setIgnoreMenuShortcuts: vi.fn() });
  return contents as unknown as Electron.WebContents & { setIgnoreMenuShortcuts: ReturnType<typeof vi.fn> } & EventEmitter;
}

describe('layout.captureChords', () => {
  it("turns the sender's menu shortcuts off while recording and back on after", () => {
    const s = sender();
    captureChords({ active: true }, { sender: s });
    expect(s.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
    captureChords({ active: false }, { sender: s });
    expect(s.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
  });

  it('a page that reloads or navigates mid-recording gets its menu shortcuts back; a hash route or a subframe does not count', () => {
    const s = sender();
    captureChords({ active: true }, { sender: s });
    captureChords({ active: true }, { sender: s });
    s.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    expect(s.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
    expect(s.listenerCount('did-start-navigation')).toBe(0);
    captureChords({ active: true }, { sender: s });
    s.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true }); // a hash route is the same page
    s.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false }); // a subframe's is not the page's
    expect(s.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
  });
});
