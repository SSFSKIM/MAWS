// P3-G (§D5): the one way to open the Artifacts tab, shared by the sidebar's row and the `artifacts.open` action. The
// tab lives in the main area, so a maximized or floating panel docks first (`revealMain`, §D1.2's last row): otherwise
// the tab would be selected behind an inert, zero-width main region while the card kept its session.
import { useLayout } from '../stores/layout';

export function openArtifacts(): void {
  const layout = useLayout.getState();
  layout.revealMain();
  layout.openTab({ kind: 'artifacts' });
}
