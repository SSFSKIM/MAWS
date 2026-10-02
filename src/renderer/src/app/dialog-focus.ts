// Triggerless dialogs remember the actual opener on each opening. Do not undo an action that deliberately
// moved focus elsewhere while closing (for example, revealing a project from the command palette).
import { useRef, useState } from 'react';

export function useDialogFocus() {
  // Sheets mount already open; snapshot before an autoFocus child takes focus during commit. Radix skips
  // onOpenAutoFocus when a child already holds focus. Persistent dialogs refresh this snapshot on each opening.
  const [initialOpener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const opener = useRef<HTMLElement | null>(initialOpener);
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      const focused = document.activeElement;
      const content = event.target;
      if (focused === document.body || focused === null || (content instanceof HTMLElement && content.contains(focused))) {
        if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
      }
    },
  };
}
