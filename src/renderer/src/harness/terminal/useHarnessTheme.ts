// The terminal harness pages' settings wiring: each page connects the settings store and applies the resolved theme to
// the root element itself, so the harness router (C6's after the rebase) stays inert. Returns the resolved theme and
// the setter for the pages' theme toggle.
import { useEffect } from 'react';
import { useSettings } from '../../stores/settings';
import { connectMonoFont } from '../../settings-tab/mono-font'; // C11

export function useHarnessTheme() {
  const resolvedTheme = useSettings((s) => s.state?.resolvedTheme);
  const setTheme = useSettings((s) => s.setTheme);
  useEffect(() => useSettings.getState().connect(), []);
  useEffect(() => connectMonoFont(), []); // C11: appearance.monoFont as the root --font-mono override, as the app applies it
  useEffect(() => {
    if (resolvedTheme) document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);
  return { resolvedTheme, setTheme };
}
