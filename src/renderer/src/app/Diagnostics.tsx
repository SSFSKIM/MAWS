// The diagnostics strip in the main region: the theme control (M3), each utility process's state and pid, and the
// PTY echo test (M4). The strip is how C1's acceptance is read by eye and by the smoke.
import { useEffect } from 'react';
import type { HostState, ThemeSetting } from '@shared/ipc/schema';
import { useEcho, type EchoState } from '../stores/echo';
import { useHosts } from '../stores/hosts';
import { useSettings } from '../stores/settings';
import { StoreDiagnostics } from './StoreDiagnostics';

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

const STATE_DOT: Record<HostState['state'], string> = {
  starting: 'bg-warning',
  restarting: 'bg-warning',
  ready: 'bg-success',
  crashed: 'bg-danger',
};

export function Diagnostics() {
  const theme = useSettings((s) => s.state?.settings.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const engine = useHosts((s) => s.hosts.engine);
  const pty = useHosts((s) => s.hosts.pty);
  const echo = useEcho((s) => s.echo);
  const runEcho = useEcho((s) => s.run);

  useEffect(() => useHosts.getState().connect(), []);

  return (
    <section
      aria-label="Diagnostics"
      className="m-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-border bg-bg-raised px-3 py-2 text-ui-sm text-fg-muted"
    >
      <div className="flex items-center gap-3">
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
      </div>
      <HostRow label="engine host" state={engine} />
      <HostRow label="pty host" state={pty} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={echo.status === 'running'}
          onClick={() => void runEcho()}
          className="rounded-sm border border-border px-2 py-0.5 text-fg hover:bg-bg-hover disabled:text-fg-faint"
        >
          Spawn echo test
        </button>
        <output aria-label="echo test" className="font-mono">
          {describeEcho(echo)}
        </output>
      </div>
      {/* C4: the engine's store as the filesystem state service sees it, on a row of its own */}
      <StoreDiagnostics />
      {/* end C4 */}
    </section>
  );
}

function HostRow({ label, state }: { label: string; state: HostState | null }) {
  return (
    <output aria-label={label} className="flex items-center gap-2">
      <span aria-hidden className={`size-2 rounded-full ${state ? STATE_DOT[state.state] : 'bg-fg-faint'}`} />
      {describeHost(label, state)}
    </output>
  );
}

export function describeHost(label: string, state: HostState | null): string {
  if (!state) return `${label} · unknown`;
  return state.pid === null ? `${label} · ${state.state}` : `${label} · ${state.state} · pid ${state.pid}`;
}

// Only a successful run shows the shell's output line; nothing else here may contain the marker, or a reader looking
// for it would find it before the shell answered.
function describeEcho(echo: EchoState): string {
  switch (echo.status) {
    case 'idle':
      return '';
    case 'running':
      return 'waiting for the shell…';
    case 'ok':
      return `${echo.line} · shell pid ${echo.pid}`;
    case 'failed':
      return `echo failed: ${echo.error}${echo.pid === undefined ? '' : ` · shell pid ${echo.pid}`}`;
  }
}
