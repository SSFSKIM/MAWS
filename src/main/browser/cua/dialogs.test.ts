import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TabEntry } from '../tabs';
import { DIALOG_DEFAULT_MS, HeldDialogs } from './dialogs';

// A leased tab's dialog (A-53; S1 promoted the native path): held unanswered while the vendor answers through CDP, the
// 30 s default answered through the held callback, each dialog's answer told to the windows.

afterEach(() => vi.useRealTimers());

function stand() {
  vi.useFakeTimers();
  const listeners = new Map<string, Set<(params: unknown) => void>>();
  const entry = {
    tab: { tabId: 'b_000000000001' },
    debugger: {
      on(method: string, listener: (params: unknown) => void) {
        if (!listeners.has(method)) listeners.set(method, new Set());
        listeners.get(method)!.add(listener);
        return () => void listeners.get(method)!.delete(listener);
      },
    },
  } as unknown as TabEntry;
  const told: unknown[] = [];
  const lines: string[] = [];
  const dialogs = new HeldDialogs({ activity: (_entry, activity) => void told.push(activity), log: (line) => void lines.push(line) });
  const closed = (result: boolean) => {
    for (const listener of [...(listeners.get('Page.javascriptDialogClosed') ?? [])]) listener({ result, userInput: '' });
  };
  const listening = () => listeners.get('Page.javascriptDialogClosed')?.size ?? 0;
  return { entry, dialogs, told, lines, closed, listening };
}

describe('HeldDialogs', () => {
  it('holds the callback unanswered; the vendor\'s answer (CDP\'s Closed) ends it, told with that answer, and no default follows', async () => {
    const s = stand();
    const callback = vi.fn();
    s.dialogs.hold(s.entry, { dialogType: 'confirm', messageText: 'Leave this page?' }, callback);
    expect(callback).not.toHaveBeenCalled();
    s.closed(false);
    expect(s.told).toEqual([{ kind: 'dialog', type: 'confirm', excerpt: 'Leave this page?', answered: 'dismissed' }]);
    await vi.advanceTimersByTimeAsync(DIALOG_DEFAULT_MS);
    expect(callback).not.toHaveBeenCalled();
    expect(s.told).toHaveLength(1);
    expect(s.listening()).toBe(0);
  });

  it(`a dialog nobody answers within ${DIALOG_DEFAULT_MS / 1000} s gets the page's default through the held callback, not CDP`, async () => {
    const s = stand();
    const callback = vi.fn();
    s.dialogs.hold(s.entry, { dialogType: 'alert', messageText: 'x'.repeat(300) }, callback);
    await vi.advanceTimersByTimeAsync(DIALOG_DEFAULT_MS - 1);
    expect(callback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(callback).toHaveBeenCalledExactlyOnceWith(false, '');
    expect(s.told).toEqual([{ kind: 'dialog', type: 'alert', excerpt: 'x'.repeat(200), answered: 'default' }]);
    s.closed(false); // Chromium's own Closed after the callback answered: nothing more
    expect(s.told).toHaveLength(1);
  });

  it('two dialogs held in turn close oldest first; a callback that throws is logged, not raised', async () => {
    const s = stand();
    const first = vi.fn(() => {
      throw new Error('One-time callback was called more than once');
    });
    s.dialogs.hold(s.entry, { dialogType: 'alert', messageText: 'one' }, first);
    s.dialogs.hold(s.entry, { dialogType: 'confirm', messageText: 'two' }, vi.fn());
    expect(s.listening()).toBe(1);
    s.closed(true);
    expect(s.told).toEqual([{ kind: 'dialog', type: 'alert', excerpt: 'one', answered: 'accepted' }]);
    await vi.advanceTimersByTimeAsync(DIALOG_DEFAULT_MS);
    expect(s.told.at(-1)).toEqual({ kind: 'dialog', type: 'confirm', excerpt: 'two', answered: 'default' });
    expect(first).not.toHaveBeenCalled();
    expect(s.lines).toEqual([]);
    s.dialogs.hold(s.entry, { dialogType: 'alert', messageText: 'three' }, first);
    await vi.advanceTimersByTimeAsync(DIALOG_DEFAULT_MS);
    expect(s.lines).toEqual([expect.stringContaining('One-time callback')]);
  });
});
