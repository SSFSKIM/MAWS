// Whether the frame's draft (the box and the toolbar) is shown. A docked card hides the draft but keeps it mounted
// (Frame.tsx), so a menu anchored in the toolbar would stay open on an anchor that takes no space, and Radix would
// place it at the window's top corner (the O9 sitting, item 8, the same for every lane). Each toolbar menu closes as
// the draft hides, and stays closed when it shows again.
import { createContext, useContext, useState } from 'react';

export const DraftShownContext = createContext(true);

export function useDraftShown(): boolean {
  return useContext(DraftShownContext);
}

// A toolbar menu's open state: closed while the draft is hidden, and closed, not reopened, once it shows again.
export function useOpenWhileShown(): [boolean, (open: boolean) => void] {
  const shown = useDraftShown();
  const [open, setOpen] = useState(false);
  const [wasShown, setWasShown] = useState(shown);
  if (wasShown !== shown) {
    setWasShown(shown);
    if (!shown) setOpen(false);
  }
  return [open && shown, setOpen];
}
