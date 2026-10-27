// layout.captureChords (C11 M5 fix wave, item 1): while the Settings tab records a chord, the window's application menu
// gives up its key equivalents, so ⌘W, ⌘K or ⌘1 reach the capture instead of closing a tab or opening the palette.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { clientOf } from '../ipc/clients';
import { captureChords } from './capture-chords';

let ids = 0;
function sender() {
  const contents = Object.assign(new EventEmitter(), { id: ++ids, destroyed: false, isDestroyed: () => contents.destroyed, setIgnoreMenuShortcuts: vi.fn() });
  return contents;
}
// The context the router builds for the page's invoke: its live ClientRef.
const from = (s: ReturnType<typeof sender>) => ({ client: clientOf(s as never) });

describe('layout.captureChords', () => {
  it("turns the sender's menu shortcuts off while recording and back on after", () => {
    const s = sender();
    captureChords({ active: true }, from(s));
    expect(s.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
    captureChords({ active: false }, from(s));
    expect(s.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
  });

  it('a page that reloads or navigates mid-recording gets its menu shortcuts back; a hash route or a subframe does not count', () => {
    const s = sender();
    captureChords({ active: true }, from(s));
    captureChords({ active: true }, from(s));
    s.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    expect(s.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
    expect(s.setIgnoreMenuShortcuts).toHaveBeenCalledTimes(3); // restored once, however many starts
    captureChords({ active: true }, from(s));
    s.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true }); // a hash route is the same page
    s.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false }); // a subframe's is not the page's
    expect(s.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
  });

  it('a crashed page gets its menu shortcuts back; a closed one is not touched again', () => {
    const crashed = sender();
    captureChords({ active: true }, from(crashed));
    crashed.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    expect(crashed.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
    const closed = sender();
    captureChords({ active: true }, from(closed));
    closed.destroyed = true;
    closed.emit('destroyed');
    expect(closed.setIgnoreMenuShortcuts.mock.calls).toEqual([[true]]);
  });
});
