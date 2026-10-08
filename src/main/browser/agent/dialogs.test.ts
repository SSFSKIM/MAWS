import { EventEmitter } from 'node:events';
import type { WebContentsView } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { BROWSER_DIALOG_EXCERPT_MAX_CHARS, BROWSER_DIALOG_MESSAGE_MAX_CHARS, BROWSER_DIALOGS_MAX } from '@shared/browser/dialog';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { TabStore, type TabEntry } from '../tabs';
import { DIALOG_BOUND_WINDOW_MS, PageDialogs, routeDialog, wrapRunDialog, type RunDialogInfo } from './dialogs';

// The `-run-dialog` wrap (E4c Decision Log 33, 35 and A-42's conditions 1 to 4; Decision Log 44 (a), 60): the guard (one
// listener, Electron's own, or no wrap), the routing table, the agent's buffer `take` drains, the never-placed tab's
// `dialogAnswered` held until it is shown, and the bound on an adopted pop-up's repeated dialogs.

const A = 'App-A' as AppSessionId;
type Callback = (accept: boolean, text: string) => void;
const info = (dialogType: string, messageText = 'Hello', defaultPromptText = ''): RunDialogInfo => ({ frame: null, dialogType, messageText, defaultPromptText });

// A view's webContents as Electron 44.4.5 makes it: one `-run-dialog` listener of its own (the native dialog).
class FakeContents extends EventEmitter {
  safeDialogs = true;
  readonly native = vi.fn((_info: unknown, callback: Callback) => this.answerNative(callback));
  answerNative: (callback: Callback) => void = (callback) => callback(false, ''); // the person dismissed it at once
  constructor(listeners = 1) {
    super();
    for (let i = 0; i < listeners; i++) this.on('-run-dialog', this.native);
  }
  readonly loadURL = () => Promise.resolve();
  readonly close = () => {};
  readonly isDestroyed = () => false;
  readonly getLastWebPreferences = () => ({ safeDialogs: this.safeDialogs });
  dialog(type: string, message?: string): ReturnType<typeof vi.fn> {
    const callback = vi.fn<Callback>();
    this.emit('-run-dialog', info(type, message), callback);
    return callback;
  }
}

function harness({ listeners = 1, leased = new Set<string>() }: { listeners?: number; leased?: Set<string> } = {}) {
  vi.useFakeTimers({ now: Date.parse('2026-10-07T09:00:00.000Z') });
  const emitted: { name: EventName; payload: unknown }[] = [];
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => void emitted.push({ name, payload });
  const contents: FakeContents[] = [];
  const store = new TabStore({
    emit,
    createView: () => {
      const wc = new FakeContents(listeners);
      contents.push(wc);
      return { webContents: wc } as unknown as WebContentsView;
    },
    resolvePartition: () => DEFAULT_PARTITION,
    schedule: () => {},
    now: Date.now,
  });
  const lines: string[] = [];
  const heldCalls: { tabId: string; type: string; message: string; callback: Callback }[] = [];
  const held = { holds: (tabId: string) => leased.has(tabId), hold: (entry: TabEntry, dialog: RunDialogInfo, callback: Callback) => void heldCalls.push({ tabId: entry.tab.tabId, type: dialog.dialogType, message: dialog.messageText, callback }) };
  const dialogs = new PageDialogs({ store, emit, log: (line) => void lines.push(line), held });
  const open = () => {
    const entry = store.entry(store.open({ appSessionId: A, url: 'https://a.test/', select: true }).tab.tabId)!;
    return { entry, wc: contents.at(-1)! };
  };
  const place = (entry: TabEntry, placed = true) => store.update(entry.tab.tabId, { placedIn: placed ? { paneId: 'p1', surface: 'panel' } : null });
  const notices = () => emitted.filter((e) => e.name === 'browser.notice').map((e) => e.payload);
  return { store, dialogs, open, place, notices, lines, contents, leased, heldCalls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('routeDialog: the routing table (A-42 conditions 1 to 3; Decision Log 60; A-53)', () => {
  const base = { control: 'idle' as const, placed: true, safeDialogs: true, recent: 0, leased: false };
  it.each([
    ['an agent-held tab, placed or not', { ...base, control: 'agent' as const }, 'agent'],
    ['an agent-held unplaced tab', { ...base, control: 'agent' as const, placed: false }, 'agent'],
    ['an unplaced tab the person holds', { ...base, placed: false }, 'hidden'],
    ['an unplaced tab under human', { ...base, control: 'human' as const, placed: false }, 'hidden'],
    ['a placed tab, idle', base, 'native'],
    ['a placed tab under human', { ...base, control: 'human' as const }, 'native'],
    ['a placed ordinary tab after many dialogs (Electron\'s safeDialogs bounds it)', { ...base, recent: 9 }, 'native'],
    ['a placed adopted pop-up, its first two dialogs', { ...base, safeDialogs: false, recent: 1 }, 'native'],
    ['a placed adopted pop-up, its third within the window', { ...base, safeDialogs: false, recent: 2 }, 'bounded'],
    ['A-53: a tab under a cua lease, whoever holds it, placed or not', { ...base, leased: true, control: 'human' as const }, 'held'],
    ['A-53: a leased unplaced agent tab', { ...base, leased: true, control: 'agent' as const, placed: false }, 'held'],
  ])('alert and confirm: %s → %s', (_name, facts, route) => {
    expect(routeDialog({ ...facts, type: 'alert' })).toBe(route);
    expect(routeDialog({ ...facts, type: 'confirm' })).toBe(route);
  });

  it('a prompt is always Electron\'s (it answers at once and shows nothing), as is any other kind', () => {
    for (const control of ['idle', 'agent', 'human'] as const) {
      for (const placed of [true, false]) for (const leased of [true, false]) expect(routeDialog({ type: 'prompt', control, placed, safeDialogs: false, recent: 5, leased })).toBe('native');
    }
    expect(routeDialog({ type: 'beforeunload', control: 'agent', placed: false, safeDialogs: true, recent: 0, leased: true })).toBe('native');
  });
});

describe('wrapRunDialog: the guard (A-42 condition 4)', () => {
  it('wraps exactly one listener: the wrapper replaces it and can hand a dialog to it', () => {
    const wc = new FakeContents(1);
    const handled = vi.fn((_dialog: RunDialogInfo, callback: Callback, native: (callback: Callback) => void) => native(callback));
    expect(wrapRunDialog(wc, handled)).toBe(true);
    expect(wc.listenerCount('-run-dialog')).toBe(1);
    const callback = wc.dialog('alert');
    expect(handled).toHaveBeenCalledTimes(1);
    expect(wc.native).toHaveBeenCalledTimes(1);
    expect(wc.native.mock.contexts[0]).toBe(wc); // Electron's listener runs as a method of its webContents
    expect(callback).toHaveBeenCalledWith(false, '');
  });

  it.each([0, 2])('refuses %i listeners: nothing changes', (count) => {
    const wc = new FakeContents(count);
    expect(wrapRunDialog(wc, vi.fn())).toBe(false);
    expect(wc.listenerCount('-run-dialog')).toBe(count);
  });

  it('a view whose webContents does not have exactly one listener is left native, with one log line', () => {
    const h = harness({ listeners: 2 });
    const { entry, wc } = h.open();
    expect(h.lines).toEqual([expect.stringContaining('-run-dialog')]);
    expect(h.lines[0]).toContain(entry.tab.tabId);
    h.store.setControl(entry.tab.tabId, 'agent');
    wc.dialog('alert');
    expect(wc.native).toHaveBeenCalledTimes(2); // both of the unexpected listeners, untouched
  });
});

describe('PageDialogs: the agent\'s dialogs (A-42 condition 2; Decision Log 37, 68)', () => {
  it('answers an agent-held tab\'s alert and confirm with the page\'s defaults, never natively, and keeps them for the next result', () => {
    const h = harness();
    const { entry, wc } = h.open();
    h.store.setControl(entry.tab.tabId, 'agent');
    const alert = wc.dialog('alert', 'Saved.');
    const confirm = wc.dialog('confirm', 'Leave this page?');
    expect(alert).toHaveBeenCalledWith(false, '');
    expect(confirm).toHaveBeenCalledWith(false, '');
    expect(wc.native).not.toHaveBeenCalled();
    expect(h.dialogs.take(entry.tab.tabId)).toEqual([
      { type: 'alert', message: 'Saved.' },
      { type: 'confirm', message: 'Leave this page?' },
    ]);
    expect(h.dialogs.take(entry.tab.tabId)).toEqual([]);
    expect(h.notices()).toEqual([]);
  });

  it('keeps the last ten, each message cut to the cap as plain text', () => {
    const h = harness();
    const { entry, wc } = h.open();
    h.store.setControl(entry.tab.tabId, 'agent');
    for (let i = 0; i < 12; i++) wc.dialog('alert', `n${i}`);
    wc.dialog('confirm', `<b>${'x'.repeat(600)}</b>`);
    const taken = h.dialogs.take(entry.tab.tabId);
    expect(taken).toHaveLength(BROWSER_DIALOGS_MAX);
    expect(taken[0]).toEqual({ type: 'alert', message: 'n3' });
    expect(taken.at(-1)!.message).toHaveLength(BROWSER_DIALOG_MESSAGE_MAX_CHARS);
    expect(taken.at(-1)!.message.startsWith('<b>xxx')).toBe(true);
  });

  it('never cuts a message inside a surrogate pair', () => {
    const h = harness();
    const { entry, wc } = h.open();
    h.store.setControl(entry.tab.tabId, 'agent');
    wc.dialog('alert', `${'x'.repeat(BROWSER_DIALOG_MESSAGE_MAX_CHARS - 1)}😀tail`);
    expect(h.dialogs.take(entry.tab.tabId)[0]!.message).toBe('x'.repeat(BROWSER_DIALOG_MESSAGE_MAX_CHARS - 1));
  });

  it('a prompt is left to Electron (unsupported: answered at once, shown nowhere) and not reported', () => {
    const h = harness();
    const { entry, wc } = h.open();
    h.store.setControl(entry.tab.tabId, 'agent');
    const callback = wc.dialog('prompt');
    expect(wc.native).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalled();
    expect(h.dialogs.take(entry.tab.tabId)).toEqual([]);
  });

  it('forgets a closed tab\'s dialogs', async () => {
    const h = harness();
    const { entry, wc } = h.open();
    h.store.setControl(entry.tab.tabId, 'agent');
    wc.dialog('alert');
    h.store.close(entry.tab.tabId);
    await Promise.resolve();
    expect(h.dialogs.take(entry.tab.tabId)).toEqual([]);
  });
});

describe('PageDialogs: a tab under a cua lease (A-53)', () => {
  it('hands alert and confirm to the held route unanswered, never natively, whoever holds the tab; a prompt stays Electron\'s', () => {
    const h = harness();
    const { entry, wc } = h.open();
    h.leased.add(entry.tab.tabId);
    h.place(entry);
    const alert = wc.dialog('alert', 'Saved.');
    h.store.setControl(entry.tab.tabId, 'human');
    const confirm = wc.dialog('confirm', 'Leave?');
    expect(alert).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(wc.native).not.toHaveBeenCalled();
    expect(h.heldCalls.map(({ tabId, type, message }) => ({ tabId, type, message }))).toEqual([
      { tabId: entry.tab.tabId, type: 'alert', message: 'Saved.' },
      { tabId: entry.tab.tabId, type: 'confirm', message: 'Leave?' },
    ]);
    h.heldCalls[0]!.callback(false, '');
    expect(alert).toHaveBeenCalledWith(false, ''); // the held route answers with the page's own callback
    wc.dialog('prompt');
    expect(wc.native).toHaveBeenCalledTimes(1);
    expect(h.dialogs.take(entry.tab.tabId)).toEqual([]); // nothing for the old tools' results
  });
});

describe('PageDialogs: the person\'s tabs (A-42 conditions 1 and 3; Decision Log 44 (a))', () => {
  it('a placed tab the person holds keeps Electron\'s own dialog, with the page\'s callback', () => {
    const h = harness();
    const { entry, wc } = h.open();
    h.place(entry);
    const callback = wc.dialog('confirm');
    expect(wc.native).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(false, '');
    h.store.setControl(entry.tab.tabId, 'human');
    wc.dialog('alert');
    expect(wc.native).toHaveBeenCalledTimes(2);
    expect(h.notices()).toEqual([]);
  });

  it('a never-placed tab\'s dialogs are answered with their defaults and told once, when the tab is next shown', () => {
    const h = harness();
    const { entry, wc } = h.open();
    expect(wc.dialog('alert', 'First')).toHaveBeenCalledWith(false, '');
    expect(wc.dialog('confirm', `Leave? ${'y'.repeat(300)}`)).toHaveBeenCalledWith(false, '');
    expect(wc.native).not.toHaveBeenCalled();
    h.store.update(entry.tab.tabId, { title: 'still hidden' });
    expect(h.notices()).toEqual([]); // nothing while the tab stays unshown
    h.place(entry);
    expect(h.notices()).toEqual([
      { appSessionId: A, tabId: entry.tab.tabId, kind: 'dialogAnswered', dialogType: 'confirm', excerpt: `Leave? ${'y'.repeat(BROWSER_DIALOG_EXCERPT_MAX_CHARS - 7)}`, count: 2 },
    ]);
    h.place(entry, false);
    h.place(entry);
    expect(h.notices()).toHaveLength(1);
    expect(h.dialogs.take(entry.tab.tabId)).toEqual([]); // the person's, never the agent's
  });

  it('a released tab is unplaced too: its dialog is answered rather than raised over a window that does not show it', () => {
    const h = harness();
    const { entry, wc } = h.open();
    h.place(entry);
    h.place(entry, false);
    expect(wc.dialog('alert')).toHaveBeenCalledWith(false, '');
    expect(wc.native).not.toHaveBeenCalled();
  });

  it("a dialog from a view no longer the tab's is dismissed: it has no pane, and Electron's would be the parentless modal", () => {
    const h = harness();
    const { entry, wc } = h.open();
    h.store.setControl(entry.tab.tabId, 'agent');
    h.store.suspend(entry.tab.tabId);
    expect(wc.dialog('alert')).toHaveBeenCalledWith(false, '');
    expect(wc.dialog('confirm')).toHaveBeenCalledWith(false, '');
    expect(wc.native).not.toHaveBeenCalled();
    expect(h.dialogs.take(entry.tab.tabId)).toEqual([]);
    expect(h.notices()).toEqual([]);
  });
});

describe('PageDialogs: an adopted pop-up\'s repeated dialogs (Decision Log 60)', () => {
  const adopted = () => {
    const h = harness();
    const { entry, wc } = h.open();
    wc.safeDialogs = false; // what Electron 44.4.5 reports for an adopted window.open child, and reads itself
    h.place(entry);
    return { ...h, entry, wc };
  };

  it('the first two stay native; from the third within the window they are dismissed, told once', () => {
    const h = adopted();
    h.wc.dialog('alert', 'one');
    vi.advanceTimersByTime(1000);
    h.wc.dialog('confirm', 'two');
    expect(h.wc.native).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(h.wc.dialog('alert', 'three')).toHaveBeenCalledWith(false, '');
    expect(h.wc.dialog('confirm', 'four')).toHaveBeenCalledWith(false, '');
    expect(h.wc.native).toHaveBeenCalledTimes(2);
    expect(h.notices()).toEqual([{ appSessionId: A, tabId: h.entry.tab.tabId, kind: 'dialogAnswered', dialogType: 'alert', excerpt: 'three' }]);
    expect(h.dialogs.take(h.entry.tab.tabId)).toEqual([]);
  });

  it('counts a native dialog from when the person closed it, so a slow loop is still bounded', () => {
    const h = adopted();
    const pending: Callback[] = [];
    h.wc.answerNative = (callback) => void pending.push(callback); // the sheet stays up until the person answers
    h.wc.dialog('alert');
    vi.advanceTimersByTime(4000);
    pending.shift()!(false, '');
    h.wc.dialog('alert');
    vi.advanceTimersByTime(4000);
    pending.shift()!(false, '');
    h.wc.dialog('alert'); // 8 s after the first opened, but both ended within the last 5 s
    expect(h.wc.native).toHaveBeenCalledTimes(2);
  });

  it('the window slides: after 5 s without a dialog they are native again, and the next run is told again', () => {
    const h = adopted();
    for (let i = 0; i < 3; i++) h.wc.dialog('alert', `a${i}`);
    expect(h.wc.native).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(DIALOG_BOUND_WINDOW_MS);
    h.wc.dialog('alert', 'b0');
    h.wc.dialog('alert', 'b1');
    expect(h.wc.native).toHaveBeenCalledTimes(4);
    h.wc.dialog('alert', 'b2');
    expect(h.wc.native).toHaveBeenCalledTimes(4);
    expect(h.notices()).toHaveLength(2);
  });

  it('a committed navigation resets the count', () => {
    const h = adopted();
    h.wc.dialog('alert');
    h.wc.dialog('alert');
    h.wc.emit('did-navigate', {}, 'https://b.test/', 200, 'OK');
    h.wc.dialog('alert');
    expect(h.wc.native).toHaveBeenCalledTimes(3);
  });

  it('an ordinary tab (safeDialogs on) is left to Electron\'s own bound', () => {
    const h = harness();
    const { entry, wc } = h.open();
    h.place(entry);
    for (let i = 0; i < 5; i++) wc.dialog('alert');
    expect(wc.native).toHaveBeenCalledTimes(5);
  });
});
