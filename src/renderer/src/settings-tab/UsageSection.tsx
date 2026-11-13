// Settings › Usage (UX wave U7b, O-47; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md,
// M7 decisions 4 and 7): the whole usage panel, with its grid, account actions, add row, Codex accounts, routing and relay,
// in the section's own measure; the title bar's ring opens only a glance. The panel is one declared row, `usage.accounts`,
// drawn and marked here, so the search finds it and a chosen result lands on it. The account cards are not rows.
import { UsagePanel } from '../usage/UsagePanel';
import { useDrawnRow } from './drawn';
import { LANDING } from './parts';

export function UsageSection() {
  useDrawnRow('usage.accounts', 'default');
  return (
    <div data-settings-row="usage.accounts" data-settings-state="default" tabIndex={-1} className={`mt-1 ${LANDING}`}>
      <UsagePanel />
    </div>
  );
}
