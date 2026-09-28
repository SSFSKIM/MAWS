import { beforeAll, describe, expect, it, vi } from 'vitest';

// Loads the real `src/main/index.ts` against a fake Electron `app` that records its listeners, with the modules it
// wires (hosts, router, settings, window) replaced, so what is under test is the app lifecycle alone.
const fake = vi.hoisted(() => {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const windows: object[] = [];
  const hosts = { start: vi.fn(async () => {}), stop: vi.fn(), dispatch: vi.fn() };
  const app = {
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return app;
    },
    whenReady: () => Promise.resolve(),
    getPath: () => '/tmp/maws-lifecycle-test',
    setPath: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
    quit: vi.fn(),
    exit: vi.fn(),
  };
  const emit = (event: string) => (listeners.get(event) ?? []).forEach((listener) => listener());
  return { listeners, windows, hosts, app, emit, createWindow: vi.fn(() => void windows.push({})) };
});

vi.mock('electron', () => ({ app: fake.app, BrowserWindow: { getAllWindows: () => fake.windows } }));
vi.mock('./hosts', () => ({ createHosts: () => fake.hosts }));
vi.mock('./ipc/router', () => ({ installRouter: vi.fn() }));
vi.mock('./settings', () => ({ startSettings: () => ({ state: () => ({ resolvedTheme: 'light' }) }) }));
vi.mock('./window', () => ({ appUrl: 'file:///index.html', createWindow: fake.createWindow, installContentSecurityPolicy: vi.fn() }));

beforeAll(async () => {
  await import('./index');
  await Promise.resolve(); // let `whenReady().then(...)` run
});

describe('app lifecycle (macOS, D-11)', () => {
  it('keeps the app, its hosts and their ptys running when the last window closes', () => {
    // Electron quits when the last window closes unless a `window-all-closed` listener exists.
    expect(fake.listeners.get('window-all-closed')).toHaveLength(1);
    fake.windows.length = 0;
    fake.emit('window-all-closed');
    expect(fake.app.quit).not.toHaveBeenCalled();
    expect(fake.app.exit).not.toHaveBeenCalled();
    expect(fake.hosts.stop).not.toHaveBeenCalled();
  });

  it('re-creates the window on activate when none is open, and not otherwise', () => {
    fake.windows.length = 0;
    const created = fake.createWindow.mock.calls.length;
    fake.emit('activate');
    expect(fake.createWindow).toHaveBeenCalledTimes(created + 1);
    fake.emit('activate');
    expect(fake.createWindow).toHaveBeenCalledTimes(created + 1);
  });

  it('stops the hosts on will-quit', () => {
    fake.emit('will-quit');
    expect(fake.hosts.stop).toHaveBeenCalledOnce();
  });
});
