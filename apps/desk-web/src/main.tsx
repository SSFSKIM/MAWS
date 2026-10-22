import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LoadBoundary } from './pwa/LoadBoundary';
import { installChunkRecovery } from './pwa/load-chunk';
import { connectDepth } from './depth/connect';
import { installLatency } from './latency/latency';
import { followLandings, registerServiceWorker } from './pwa/service-worker';
import { installPreviewPolicy } from './views/requests/preview-policy';
import './styles/app.css';

document.documentElement.dataset.theme = 'light'; // light first (MAWS's D-4); the desk has no theme setting yet
installChunkRecovery();
connectDepth(); // DC6: the depth column (DX8's `depth` slot) and a direct channel's unfolded working record (`transcript`)
void registerServiceWorker(); // the PWA's worker (§4): draws pushes, opens their cards
// A tapped notification's card, from the start URL or from the worker's message to this window: followed from the first
// moment, before the sign-in is known, since a message no listener takes once the page has loaded is dropped. A landing
// only sets the route and the landing, which the desk reads when it is drawn.
followLandings();
installPreviewPolicy(); // a question preview's frame fetches nothing (the page sets no policy for it to inherit)
installLatency(); // desk ticket #57: every hop measured always; the readout drawn when `desk.latency` or `?latency` asks

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LoadBoundary>
      <App />
    </LoadBoundary>
  </StrictMode>,
);
