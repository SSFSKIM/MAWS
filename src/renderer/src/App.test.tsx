import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostState, MawsBridge, SettingsState } from '@shared/ipc/schema';

const HOSTS: Record<'engine.hostState' | 'pty.hostState', HostState> = {
  'engine.hostState': { state: 'ready', pid: 1111, restarts: 0, revision: 1 },
  'pty.hostState': { state: 'ready', pid: 2222, restarts: 0, revision: 1 },
};

// The page against a fake `window.maws` that behaves like main: `settings.set` answers the new state and emits
// `settings.changed` first, as the router does; both hosts are ready; the PTY host answers a write to its shell with
// the terminal's echo of the line and then the command's output.
function fakeMain(initial: SettingsState['settings']['theme']) {
  let theme = initial;
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const send = (name: string, payload: unknown) => listeners.get(name)?.forEach((l) => l(payload));
  const state = () => ({ settings: { version: 1, theme }, resolvedTheme: theme === 'dark' ? 'dark' : 'light' });
  const answer = (name: string, input: { theme: typeof theme; data: string }) => {
    switch (name) {
      case 'settings.set':
        theme = input.theme;
        send('settings.changed', state());
        return state();
      case 'settings.get':
        return state();
      case 'engine.hostState':
      case 'pty.hostState':
        return HOSTS[name];
      case 'fs.state':
        return { configHome: '/Users/new/.claude', watching: true, projects: 1, sessions: 1, bound: 0, followed: [], holders: [], lastScanAt: null };
      case 'fs.scan':
        return { projects: 3, sessions: 1, changed: 1, durationMs: 1234 };
      case 'session.list':
        return { sessions: [], revision: 1 };
      case 'session.projects.list':
        return { projects: [{ id: 'p1', name: 'maws-accept', directory: '/private/tmp/maws-accept', order: 0, createdAt: '2026-09-28T10:00:00.000Z' }], revision: 1 };
      case 'pty.spawn':
        return { ptyId: 'p1', pid: 3333 };
      case 'pty.write':
        setTimeout(() => {
          send('pty.data', { ptyId: 'p1', data: `${input.data}\n` });
          send('pty.data', { ptyId: 'p1', data: 'MAWS_ECHO_OK\r\n$ ' });
        });
        return undefined;
      default:
        throw new Error(`unexpected ${name}`);
    }
  };
  window.maws = {
    invoke: vi.fn(async (name: string, input: { theme: typeof theme; data: string }) => ({ ok: true, value: answer(name, input) })),
    on: vi.fn((name: string, listener: (payload: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => listeners.get(name)!.delete(listener);
    }),
  } as unknown as MawsBridge;
  return { send };
}

async function renderApp() {
  vi.resetModules(); // a fresh settings store per test
  const { App } = await import('./App');
  await act(async () => void render(<App />));
}

describe('theme in the page', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'light';
  });
  afterEach(() => {
    cleanup();
    delete (window as { maws?: MawsBridge }).maws;
  });

  it('mirrors the persisted theme onto <html data-theme>', async () => {
    fakeMain('dark');
    await renderApp();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('switches through settings.set when a theme is chosen in the diagnostics strip', async () => {
    fakeMain('light');
    await renderApp();
    expect(document.documentElement.dataset.theme).toBe('light');
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Dark' })));
    expect(window.maws.invoke).toHaveBeenCalledWith('settings.set', { theme: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('renders the strip inside the main region', async () => {
    fakeMain('light');
    await renderApp();
    const strip = screen.getByRole('region', { name: 'Diagnostics' });
    expect(strip.closest('[data-region]')?.getAttribute('data-region')).toBe('main');
  });
});

describe('hosts in the diagnostics strip', () => {
  afterEach(() => {
    cleanup();
    delete (window as { maws?: MawsBridge }).maws;
  });

  it('reads both hosts ready with their pids from the snapshots', async () => {
    fakeMain('light');
    await renderApp();
    expect(screen.getByRole('status', { name: 'engine host' }).textContent).toBe('engine host · ready · pid 1111');
    expect(screen.getByRole('status', { name: 'pty host' }).textContent).toBe('pty host · ready · pid 2222');
  });

  it('follows a host through crashed, restarting and ready', async () => {
    const main = fakeMain('light');
    await renderApp();
    const pty = () => screen.getByRole('status', { name: 'pty host' }).textContent;
    act(() => main.send('pty.hostState', { state: 'crashed', pid: 2222, restarts: 0, revision: 2 }));
    expect(pty()).toBe('pty host · crashed · pid 2222');
    act(() => main.send('pty.hostState', { state: 'restarting', pid: null, restarts: 1, revision: 3 }));
    expect(pty()).toBe('pty host · restarting');
    act(() => main.send('pty.hostState', { state: 'ready', pid: 4444, restarts: 1, revision: 4 }));
    expect(pty()).toBe('pty host · ready · pid 4444');
  });

  it('runs the echo test and shows the output line with the shell’s pid', async () => {
    fakeMain('light');
    await renderApp();
    const echo = () => screen.getByRole('status', { name: 'echo test' }).textContent;
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Spawn echo test' })));
    // Until the shell answers, nothing in the strip may contain the marker a reader (or the smoke) looks for.
    expect(echo()).not.toBe('');
    expect(echo()).not.toContain('MAWS_ECHO_OK');
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 10))));
    expect(window.maws.invoke).toHaveBeenCalledWith('pty.spawn', expect.objectContaining({ shell: '/bin/sh' }));
    expect(echo()).toBe('MAWS_ECHO_OK · shell pid 3333');
  });
});

describe('store section of the diagnostics strip', () => {
  afterEach(() => {
    cleanup();
    delete (window as { maws?: MawsBridge }).maws;
  });

  it('shows the watched config home, the counts (projects from the index), and each record with its title, source, directory, pin and holder badge', async () => {
    const main = fakeMain('light');
    await renderApp();
    expect(screen.getByRole('status', { name: 'store' }).textContent).toBe('store · /Users/new/.claude · watching');
    expect(screen.getByRole('status', { name: 'store scan' }).textContent).toBe('projects 1 · sessions 1 · scan 1.2 s');

    const record = {
      appId: 'aaaaaaaa-1111-4111-8111-111111111111',
      engineSessionId: '11111111-1111-4111-8111-111111111111',
      projectId: 'p1',
      directory: '/private/tmp/maws-accept',
      additionalDirectories: [],
      worktree: null,
      branch: null,
      title: { text: 'Remembering fruit', source: 'generated' },
      pinned: false,
      archived: false,
      holder: { kind: 'terminal', pid: 78212 },
      lastSeen: { messageUuid: null, at: null },
      unread: false,
      engineVersion: '2.1.283',
      gateway: { routed: true, baseUrl: null, autoModeServer: 'unknown' },
      model: { requested: null, resolved: null },
      effort: null,
      permissionMode: { requested: 'auto', effective: 'auto', refusal: null },
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-28T10:00:00.000Z',
    };
    await act(async () => {
      main.send('session.changed', { record, cause: 'discovered', revision: 2 });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const row = within(screen.getByRole('list', { name: 'Discovered sessions' })).getByRole('listitem');
    expect(row.textContent).toBe('Remembering fruitgenerated/private/tmp/maws-acceptterminal · 78212Follow');

    await act(async () => {
      main.send('session.changed', { record: { ...record, pinned: true, holder: { kind: 'none' } }, cause: 'holder', revision: 3 });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(row.textContent).toBe('pinRemembering fruitgenerated/private/tmp/maws-acceptFollow');
  });
});
