// The harness entry: a hash router over development pages. `#transcript` (the default) is C6's transcript harness;
// C9 adds `#probe` and `#panel` (pages under harness/terminal/). One page is mounted per load, and each assigns
// `window.__maws_harness` on mount.
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/app.css';
import { Harness } from './Harness';
// C8a start
import { PanelHarness } from './panel/PanelHarness';
// C8a end

const ROUTES: Record<string, () => ReactNode> = {
  transcript: () => <Harness />,
  // C8a start
  panel: () => <PanelHarness />, // the panel host over fake sessions (run under the harness scenario, ruling O1)
  // C8a end
};

// C9 block begin: the terminal harness pages (pages under harness/terminal/), routed as `#probe` and `#panel`
import { PanelHarness } from './terminal/PanelHarness';
import { Probe } from './terminal/Probe';
ROUTES.probe = () => <Probe />;
ROUTES.panel = () => <PanelHarness />;
// C9 block end

const routeOf = () => location.hash.replace(/^#/, '') || 'transcript';

function Router() {
  const [route, setRoute] = useState(routeOf);
  useEffect(() => {
    const onHashChange = () => setRoute(routeOf());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const page = ROUTES[route] ?? ROUTES.transcript;
  return <div key={route} className="h-full">{page()}</div>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router />
  </StrictMode>,
);
