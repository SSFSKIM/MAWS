import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { artifactHost } from './artifacts'; // P3-A M4
import { e2eRequested, installDocumentsSeam } from './artifacts/e2e-seam'; // P3-A M4
import { installDesignSystemFixture } from './artifacts/design-system/e2e-fixture'; // P3-D M7
import { installPresentationsSeam } from './tools/presentation/e2e-seam'; // P3-C M4
import './styles/app.css';

// P3-A M4: the store's e2e seam, in a window main loaded for the e2e harness only
if (e2eRequested(location.search)) installDocumentsSeam(window, artifactHost);
// P3-D M7: the design-system document fixture, the same way
if (e2eRequested(location.search)) installDesignSystemFixture(window);
// P3-C M4: the presentations' seam (a deck seeded from files, timings), the same way
if (e2eRequested(location.search)) installPresentationsSeam(window, artifactHost);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
