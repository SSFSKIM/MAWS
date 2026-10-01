// Whether the usage popover is open (W6, E1): a store, so the menu's and palette's Usage action open it, and the
// account actions open it again after their confirm (whose sheet takes the focus, which closes the popover).
import { create } from 'zustand';

export const useUsagePopover = create<{ open: boolean; setOpen(open: boolean): void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
