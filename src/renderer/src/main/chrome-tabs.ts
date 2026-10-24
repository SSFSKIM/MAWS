import { create } from 'zustand';
// Strips keep their pane ownership (and aria ids), but render in the window's single chrome row.
export const useChromeTabs = create<{ panes: readonly (HTMLDivElement | null)[] }>(() => ({ panes: [null, null] }));
export function mountChromeTabs(host: HTMLDivElement | null) {
  // Fixed targets keep both visual and keyboard order when a floated pane remounts after its sibling.
  useChromeTabs.setState({ panes: [0, 1].map((index) => host?.querySelector<HTMLDivElement>(`[data-chrome-slot="${index}"]`) ?? null) });
}
