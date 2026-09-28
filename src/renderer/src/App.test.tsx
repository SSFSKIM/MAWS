import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge, SettingsState } from '@shared/ipc/schema';

// The page against a fake `window.maws` that behaves like main: `settings.set` answers the new state and emits
// `settings.changed` first, as the router does.
function fakeMain(initial: SettingsState['settings']['theme']) {
  let theme = initial;
  const listeners = new Set<(payload: unknown) => void>();
  const state = () => ({ settings: { version: 1, theme }, resolvedTheme: theme === 'dark' ? 'dark' : 'light' });
  window.maws = {
    invoke: vi.fn(async (name: string, input: { theme: typeof theme }) => {
      if (name === 'settings.set') {
        theme = input.theme;
        listeners.forEach((l) => l(state()));
      }
      return { ok: true, value: state() };
    }),
    on: vi.fn((_name: string, listener: (payload: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  } as unknown as MawsBridge;
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
