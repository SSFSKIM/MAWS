// P3-G (§D5): the one way to open the Artifacts library, shared by the sidebar's row, the `artifacts.open` action and the
// Artifacts list's "Open library". UX wave U7b (O-40; its execution document, Interfaces §J, "Every way in"): the library
// is a page beside the sidebar, not a tab, and since a page covers the side column whatever its state, and Back must find
// it as it was, a maximized or floating panel is no longer docked first.
import { useLayout } from '../stores/layout';

export function openArtifacts(): void {
  useLayout.getState().openDestination({ kind: 'library' });
}
