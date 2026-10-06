// E2 (M4): an artifact's version switcher in the viewer's header (Design §4; Claude Desktop's frame header): `v1 … vN`,
// the last marked latest, the shown one selected. Offered only for a record of more than one version.
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { DELIVERABLES_COPY } from './copy';
import { latestVersion } from './model';

export function Versions({ record, shown, onChange }: { record: DeliverableRecord; shown: number; onChange(version: number): void }) {
  const latest = latestVersion(record);
  if (latest < 2) return null;
  return (
    <select
      aria-label={DELIVERABLES_COPY.versionLabel}
      value={shown}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
      className="h-6 shrink-0 rounded-sm border border-border bg-bg px-1 text-ui-sm text-fg outline-accent focus-visible:outline-2"
    >
      {Array.from({ length: latest }, (_, i) => i + 1).map((n) => (
        <option key={n} value={n}>
          {DELIVERABLES_COPY.version(n, n === latest)}
        </option>
      ))}
    </select>
  );
}
