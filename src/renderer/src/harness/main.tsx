// carried by C9 until the rebase over C6 (wave-2 ledger d.13)
// The harness entry: a second renderer page loaded instead of the app under MAWS_HARNESS=1, routed on
// `location.hash`. C6 lands this router with `#transcript` as its default; C9 adds its routes as a block below.
// Each page assigns `window.__maws_harness` on mount; one page per load.
import { StrictMode, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { useSettings } from '../stores/settings';
import '../styles/app.css';

function TranscriptPlaceholder() {
  return <div className="p-4 text-fg-muted">Transcript harness (C6) lands with the rebase; use #probe.</div>;
}

// C9 block begin: terminal harness routes
import { PanelHarness } from './terminal/PanelHarness';
import { Probe } from './terminal/Probe';
const C9_ROUTES: Record<string, () => ReactNode> = {
  '#probe': () => <Probe />,
  '#panel': () => <PanelHarness />,
};
// C9 block end

const ROUTES: Record<string, () => ReactNode> = {
  '#transcript': () => <TranscriptPlaceholder />,
  ...C9_ROUTES,
};

const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

function Harness() {
  const resolvedTheme = useSettings((s) => s.state?.resolvedTheme);
  const hash = useSyncExternalStore(subscribeHash, () => location.hash);
  useEffect(() => useSettings.getState().connect(), []);
  useEffect(() => {
    if (resolvedTheme) document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);
  const route = ROUTES[hash] ?? ROUTES['#transcript']!;
  return (
    <div className="flex h-full flex-col">
      <nav aria-label="harness pages" className="flex shrink-0 gap-3 border-b border-border py-1 pr-3 pl-20 text-ui-sm text-fg-muted [app-region:drag]">
        {Object.keys(ROUTES).map((page) => (
          <a key={page} href={page} className={`[app-region:no-drag] ${page === (ROUTES[hash] ? hash : "#transcript") ? "text-fg" : "hover:text-fg"}`}>
            {page}
          </a>
        ))}
      </nav>
      <div className="min-h-0 flex-1">{route()}</div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
// carried by C9 until the rebase over C6 (wave-2 ledger d.13)
