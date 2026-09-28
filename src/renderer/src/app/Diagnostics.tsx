// The diagnostics strip in the main region. M3: the theme control, the first feature that crosses the bridge.
// M4 adds the host rows and the echo test.
import type { ThemeSetting } from '@shared/ipc/schema';
import { useSettings } from '../stores/settings';

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function Diagnostics() {
  const theme = useSettings((s) => s.state?.settings.theme);
  const setTheme = useSettings((s) => s.setTheme);

  return (
    <section
      aria-label="Diagnostics"
      className="m-3 flex items-center gap-3 rounded-md border border-border bg-bg-raised px-3 py-2 text-ui-sm text-fg-muted"
    >
      <span id="theme-label">Theme</span>
      <div role="group" aria-labelledby="theme-label" className="flex gap-1">
        {THEMES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={theme === value}
            disabled={theme === undefined}
            onClick={() => void setTheme(value)}
            className="rounded-sm px-2 py-0.5 text-fg-muted hover:bg-bg-hover aria-pressed:bg-bg-active aria-pressed:text-fg disabled:text-fg-faint"
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
