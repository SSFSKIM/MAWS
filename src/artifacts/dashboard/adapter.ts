// The dashboard `KindAdapter` (P3-E2 M2; parent §2 "What it is"): a dashboard is B's document plus the `datasets` root,
// so its adapter is B's document adapter under the `dashboard` kind: the same forwarding, id repair, anchor refresh,
// threads mirror, provenance carries (in its own registry, which B's tools reach by the artifact's kind), restore scope
// (conversations kept; the datasets revert with the rest of the doc) and first tab. Portable; the host wraps it with the
// derived change index (src/engine-host/dashboards/).
import { documentAdapter, type DocumentAdapter, type DocumentAdapterOptions } from '../document/adapter';

export function dashboardAdapter(options?: DocumentAdapterOptions): DocumentAdapter {
  return { ...documentAdapter(options), kind: 'dashboard' };
}
