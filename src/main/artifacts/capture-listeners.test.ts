// P3-E (E2 M5 correction; P3-E Decision Log 33): the capture window's load helpers release what they attached. A window
// reused for many pages (a dashboard export's pictures) navigates once per page, so a helper that leaves its own failure
// listener after a success, its own load listener after a failure, or its own paint listener after its timeout grows
// the window's listeners with every page. Each helper removes only its own callbacks and timer; a listener someone else
// attached stays; the answers are as before.
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ BrowserWindow: class {} }));
import { loadSettled, settled } from './capture';

type Contents = EventEmitter & { loadURL(url: string): Promise<void> };
const EVENTS = ['did-finish-load', 'did-fail-load', 'paint'] as const;

/** A window whose page loads, then paints (or not), or fails, as `next` says. */
function windowOf(next: () => 'paint' | 'quiet' | 'fail') {
  const contents = new EventEmitter() as Contents;
  contents.loadURL = async () => {
    const outcome = next();
    if (outcome === 'fail') {
      setImmediate(() => contents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///x', true));
      throw new Error('ERR_FILE_NOT_FOUND');
    }
    setImmediate(() => {
      contents.emit('did-finish-load');
      if (outcome === 'paint') setImmediate(() => contents.emit('paint'));
    });
  };
  return { win: { webContents: contents } as never, contents };
}
const counts = (contents: EventEmitter) => Object.fromEntries(EVENTS.map((event) => [event, contents.listenerCount(event)]));
const none = { 'did-finish-load': 0, 'did-fail-load': 0, paint: 0 };

afterEach(() => vi.useRealTimers());

describe('the capture window’s load helpers on a reused window', () => {
  it('leave no listener of their own after 25 loads that paint, and keep another’s', async () => {
    const { win, contents } = windowOf(() => 'paint');
    const theirs = () => {};
    contents.on('did-fail-load', theirs);
    for (let i = 0; i < 25; i++) await loadSettled(win, `file:///tmp/figure-${i}.html`);
    expect(counts(contents)).toEqual({ ...none, 'did-fail-load': 1 });
    expect(contents.listeners('did-fail-load')).toEqual([theirs]);
  });

  it('leave none after loads whose paint never comes (the settle timeout), each still settling', async () => {
    const { win, contents } = windowOf(() => 'quiet');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    for (let i = 0; i < 5; i++) {
      const done = loadSettled(win, `file:///tmp/figure-${i}.html`);
      await vi.waitFor(() => expect(contents.listenerCount('did-finish-load')).toBe(0)); // loaded; now waiting for paint
      await vi.advanceTimersByTimeAsync(600);
      await done;
    }
    expect(counts(contents)).toEqual(none);
  });

  it('leave none after a failed load, which still rejects with the load’s failure', async () => {
    const { win, contents } = windowOf(() => 'fail');
    for (let i = 0; i < 3; i++) await expect(loadSettled(win, `file:///tmp/missing-${i}.html`)).rejects.toThrow('the page did not load (-6 ERR_FILE_NOT_FOUND)');
    expect(counts(contents)).toEqual(none);
  });

  it('settled alone: a paint resolves it, a timeout resolves it, neither leaves its listener', async () => {
    const contents = new EventEmitter();
    const win = { webContents: contents } as never;
    const painted = settled(win);
    contents.emit('paint');
    await painted;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const quiet = settled(win);
    await vi.advanceTimersByTimeAsync(600);
    await quiet;
    expect(contents.listenerCount('paint')).toBe(0);
  });
});
