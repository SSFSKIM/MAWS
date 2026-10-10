// Main owns the settings (charter §12 C1 *Theme switching*): it answers `settings.get` and `settings.set`, drives
// native chrome through `nativeTheme.themeSource`, resolves `system` against the OS, keeps the window background on
// the resolved theme's `--bg`, and emits `settings.changed` on start, on every set, and when the OS moves the
// resolved theme. The renderer only mirrors what it is told onto `<html data-theme>`.
import { nativeTheme } from 'electron';
import type { SettingsState, ThemeSetting } from '@shared/ipc/schema';
import { emit } from '../ipc/events';
import { registerMainHandler } from '../ipc/router';
import { applyWindowBackground } from '../window';
import { openSettingsStore, resolveTheme } from './store';

export interface SettingsService {
  state(): SettingsState;
  // P2-C M4 (2026-10-09): main's own readers of a setting that acts at once (the to-human lane's switch), told after
  // every publish
  onChange(listener: (state: SettingsState) => void): () => void;
}

export function startSettings(file: string): SettingsService {
  const store = openSettingsStore(file);
  const state = (): SettingsState => ({
    settings: store.settings,
    resolvedTheme: resolveTheme(store.settings.theme, nativeTheme.shouldUseDarkColors),
  });

  const listeners = new Set<(state: SettingsState) => void>(); // P2-C M4
  let published: SettingsState | null = null;
  const publish = (): SettingsState => {
    published = state();
    applyWindowBackground(published.resolvedTheme);
    emit('settings.changed', published);
    for (const listener of listeners) listener(published); // P2-C M4
    return published;
  };

  // Our own `themeSource` writes may fire `updated` (synchronously or not); the set that made them publishes once
  // itself. `updated` also fires for changes that move nothing here, such as high contrast.
  let writingThemeSource = false;
  const setThemeSource = (theme: ThemeSetting) => {
    writingThemeSource = true;
    try {
      nativeTheme.themeSource = theme;
    } finally {
      writingThemeSource = false;
    }
  };
  nativeTheme.on('updated', () => {
    if (!writingThemeSource && state().resolvedTheme !== published?.resolvedTheme) publish();
  });

  registerMainHandler('settings.get', state);
  registerMainHandler('settings.set', (patch) => {
    setThemeSource(store.update(patch).theme);
    return publish();
  });

  setThemeSource(store.settings.theme);
  publish();
  return {
    state,
    onChange: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
