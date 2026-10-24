import { create } from 'zustand';
// Strips keep their pane ownership (and aria ids), but render in the window's single chrome row.
export const useChromeTabs = create<{ host: HTMLDivElement | null }>(() => ({ host: null }));
export function mountChromeTabs(host: HTMLDivElement | null) { useChromeTabs.setState({ host }); }
