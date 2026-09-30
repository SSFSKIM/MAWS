// The harness entry: a hash router over development pages. `#transcript` (the default) is C6's transcript harness;
// C9 adds `#probe` (harness/terminal/) and C8a `#panel` (harness/panel/, into which C9's stand-in was folded). One page
// is mounted per load, and each assigns `window.__maws_harness` on mount.
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/app.css';
import { Harness } from './Harness';
// C8a start
import { PanelHarness } from './panel/PanelHarness';
// C8a end
// C7 start
import { ComposerHarness } from './composer/ComposerHarness';
import { EditorHarness } from './composer/EditorHarness';
// C7 end
// C11 start
import { WidgetsHarness } from './widgets/WidgetsHarness';
// C11 end

const ROUTES: Record<string, () => ReactNode> = {
  transcript: () => <Harness />,
  // C8a start
  panel: () => <PanelHarness />, // the panel host over fake sessions (run under the harness scenario, ruling O1)
  // C8a end
  // C7 start: the composer and request card page; the editor page (M3)
  composer: () => <ComposerHarness />,
  editor: () => <EditorHarness />,
  // C7 end
  // C11 start: the widgets over the composer, on the fixture-backed backend or passively over C3's strict replay
  widgets: () => <WidgetsHarness />,
  // C11 end
};

// C9 block begin: the terminal probe page (harness/terminal/), routed as `#probe`; its `#panel` stand-in was folded
// into C8a's page (ruling O2)
import { Probe } from './terminal/Probe';
ROUTES.probe = () => <Probe />;
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
