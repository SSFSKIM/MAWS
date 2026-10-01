import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({ windows: [] as { webContents: { send: ReturnType<typeof vi.fn>; isDestroyed: () => boolean } }[] }));
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => electron.windows } }));

import { emit, onEmitted } from './events';
import { SETTINGS_DEFAULTS_V5 } from '@shared/settings/defaults';

const window = (destroyed = false) => ({ webContents: { send: vi.fn(), isDestroyed: () => destroyed } });

describe('main event emitter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    electron.windows = [];
  });

  it('sends a valid payload to every live window on the event channel', () => {
    const [a, b, closed] = [window(), window(), window(true)];
    electron.windows = [a, b, closed];
    const state = { settings: { ...SETTINGS_DEFAULTS_V5, theme: 'dark' as const }, resolvedTheme: 'dark' as const };
    expect(emit('settings.changed', state)).toBe(true);
    expect(a.webContents.send).toHaveBeenCalledExactlyOnceWith('maws:evt:settings.changed', state);
    expect(b.webContents.send).toHaveBeenCalledExactlyOnceWith('maws:evt:settings.changed', state);
    expect(closed.webContents.send).not.toHaveBeenCalled();
  });

  it('refuses to send an invalid payload and logs the event name and issues', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = window();
    electron.windows = [w];
    expect(emit('pty.data', { ptyId: 'p1', offset: 0, data: 42 } as never)).toBe(false);
    expect(w.webContents.send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('pty.data'), [expect.objectContaining({ path: ['data'] })]);
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
