// The harness entry: a hash router over development pages. `#transcript` (the default) is C6's transcript harness;
// C9 adds `#probe` and `#panel` (pages under harness/terminal/). One page is mounted per load, and each assigns
// `window.__maws_harness` on mount.
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/app.css';
import { Harness } from './Harness';
// C7 start
import { ComposerHarness } from './composer/ComposerHarness';
import { EditorHarness } from './composer/EditorHarness';
// C7 end

const ROUTES: Record<string, () => ReactNode> = {
  transcript: () => <Harness />,
  // C7 start: the composer and request card page; the editor page (M3)
  composer: () => <ComposerHarness />,
  editor: () => <EditorHarness />,
  // C7 end
};

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
