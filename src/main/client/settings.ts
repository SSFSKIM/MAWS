// Main owns the settings (charter §12 C1 *Theme switching*): it answers `settings.get` and `settings.set`, drives
// native chrome through `nativeTheme.themeSource`, resolves `system` against the OS, keeps the window background on
// the resolved theme's `--bg`, and emits `settings.changed` on start, on every set, and when the OS moves the
// resolved theme. The renderer only mirrors what it is told onto `<html data-theme>`.
// P5 O3-A (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §3; contract O3X3): this is the client half, moved out of
// the machine-bound `src/main/settings/`. It composes the renderer's one `Settings` (its version the client file's) from
// its own file (./settings-store.ts) and the machine half's service (src/services/settings/machine.ts), routes each field of
// a patch to its owner, and publishes on a change to either. The renderer's `settings.*` keeps its shape.
import { nativeTheme } from 'electron';
import type { SettingsState, ThemeSetting } from '@shared/ipc/schema';
import { emit } from '../ipc/events';
import { registerMainHandler } from '../ipc/router';
import type { MachineSettingsService } from '@shared/spine/machine-settings';
import { applyWindowBackground } from '../window';
import { composeSettings, resolveTheme } from './settings-store';

export interface SettingsService {
  state(): SettingsState;
  // P2-C M4 (2026-10-09): main's own readers of a setting that acts at once (the to-human lane's switch), told after
  // every publish
  onChange(listener: (state: SettingsState) => void): () => void;
}

export function startSettings({ clientFile, machine }: { clientFile: string; machine: MachineSettingsService }): SettingsService {
  const store = composeSettings({ clientFile, machine });
  const state = (): SettingsState => ({ settings: store.settings, resolvedTheme: resolveTheme(store.settings.theme, nativeTheme.shouldUseDarkColors) });

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
  // P5 O3-A: a change to the machine half publishes, except the one a set below makes, which publishes once itself.
  // P5 O3-D M5b: a set awaits the machine half (Interfaces §G), so sets may overlap; each one in flight is counted
  let setting = 0;
  machine.onChange(() => {
    if (setting === 0) publish();
  });

  registerMainHandler('settings.get', state);
  registerMainHandler('settings.set', async (patch) => {
    // P5 O3-A: each half takes only its own fields (composeSettings). A half that refuses its write (a file this build
    // cannot own; the machine file in a run refused the spine; P5 O3-D M5b: `mawsd`'s refusal on the daemon shape) fails
    // the set; what the other half already wrote is published before the error is answered.
    setting += 1;
    try {
      setThemeSource((await store.update(patch)).theme);
    } catch (error) {
      publish();
      throw error;
    } finally {
      setting -= 1;
    }
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
