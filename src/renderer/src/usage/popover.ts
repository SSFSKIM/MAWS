// Whether the usage ring's popover is open (W6, E1; UX wave U7b, O-47): a store, so the menu's and the palette's Usage
// action open it as the ring does.
import { create } from 'zustand';

export const useUsagePopover = create<{ open: boolean; setOpen(open: boolean): void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
