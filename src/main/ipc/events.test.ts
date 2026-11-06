import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({ windows: [] as { webContents: { send: ReturnType<typeof vi.fn>; isDestroyed: () => boolean } }[] }));
vi.mock('../windows', () => ({ appWindows: () => electron.windows })); // E2: the emitter sends to app windows only

import { emit, emitFrom, emitTo, onEmitted } from './events';
import { hostEventToWindows } from '../hosts/window-events';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import type { MachineRef } from '@shared/machine/ref';
import { bindLocalMachine } from '../machine/local';

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const OTHER = 'OtherMachineRef0000000' as MachineRef;
bindLocalMachine(LOCAL);

const window = (destroyed = false) => ({ webContents: { send: vi.fn(), isDestroyed: () => destroyed } });

describe('main event emitter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    electron.windows = [];
  });

  it('sends a valid payload to every live window on the event channel', () => {
    const [a, b, closed] = [window(), window(), window(true)];
    electron.windows = [a, b, closed];
    const state = { settings: { ...SETTINGS_DEFAULTS_V21, theme: 'dark' as const }, resolvedTheme: 'dark' as const };
    expect(emit('settings.changed', state)).toBe(true);
    expect(a.webContents.send).toHaveBeenCalledExactlyOnceWith('maws:evt:settings.changed', state, LOCAL); // P5 O6 M2: stamped local
    expect(b.webContents.send).toHaveBeenCalledExactlyOnceWith('maws:evt:settings.changed', state, LOCAL);
    expect(closed.webContents.send).not.toHaveBeenCalled();
  });

  // P5 O6 M2 (OX2)
  it('stamps an event sent to one page with the local machine too', () => {
    const page = { send: vi.fn(), isDestroyed: () => false };
    expect(emitTo(page, 'layout.selectAll', {})).toBe(true);
    expect(page.send).toHaveBeenCalledExactlyOnceWith('maws:evt:layout.selectAll', {}, LOCAL);
  });

  it('sends another machine’s event to the windows with that machine, validated, and no main-side tap hears it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = window();
    electron.windows = [w];
    const heard: unknown[] = [];
    const off = onEmitted('attention.changed', (payload) => heard.push(payload));
    const change = { appSessionId: 'a1', items: [] };
    expect(emitFrom(OTHER, 'attention.changed', change as never)).toBe(true);
    expect(emitFrom(OTHER, 'attention.changed', { appSessionId: 'a1', items: 'nope' } as never)).toBe(false);
    off();
    expect(w.webContents.send).toHaveBeenCalledExactlyOnceWith('maws:evt:attention.changed', change, OTHER);
    expect(heard).toEqual([]);
  });

  it('refuses to send an invalid payload and logs the event name and issues', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = window();
    electron.windows = [w];
    expect(emit('pty.data', { ptyId: 'p1', offset: 0, data: 42 } as never)).toBe(false);
    expect(w.webContents.send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('pty.data'), [expect.objectContaining({ path: ['data'] })]);
  });

  // P5 O8 M7b: a main-only event (`MAIN_ONLY_EVENTS`) reaches no window by any path: main's own emit (which the local
  // host's relay calls), another machine's over its link, or one page; main's taps still hear the local machine's
  it('sends a main-only event, channel.changed, to no window from any path, and main’s taps hear the local one', () => {
    const [w, page] = [window(), { send: vi.fn(), isDestroyed: () => false }];
    electron.windows = [w];
    const heard: unknown[] = [];
    const off = onEmitted('channel.changed', (payload) => heard.push(payload));
    const change = { project: 'proj-1', entry: { id: '1', project: 'proj-1', appSessionId: null, engineSessionId: null, lane: 'A' as const, kind: 'message' as const, text: 'Hi.', at: '2026-11-06T12:00:00.000Z', src: 'proj-1/w/1' } };
    expect(hostEventToWindows(emit)('channel.changed', change)).toBe(true); // the local host's relay
    expect(emitFrom(OTHER, 'channel.changed', change)).toBe(true); // a machine link's
    expect(emitTo(page, 'channel.changed', change)).toBe(true);
    off();
    expect(w.webContents.send).not.toHaveBeenCalled();
    expect(page.send).not.toHaveBeenCalled();
    expect(heard).toEqual([change, change]);
  });

  // ---- C5: onEmitted ----
  it('hands every validated emit to main-side taps of that name, never an invalid one, until unsubscribed', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const heard: unknown[] = [];
    const off = onEmitted('attention.changed', (payload) => heard.push(payload));
    const change = { appSessionId: 'a1', items: [] };
    emit('attention.changed', change as never);
    emit('attention.changed', { appSessionId: 'a1', items: 'nope' } as never);
    emit('attention.navigate', { appSessionId: 'a1', attentionId: null, source: 'menu' } as never);
    off();
    emit('attention.changed', change as never);
    expect(heard).toEqual([change]);
  });
  // ---- end C5 ----
});
