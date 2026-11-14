// Triggerless dialogs remember the actual opener on each opening. Do not undo an action that deliberately
// moved focus elsewhere while closing (for example, revealing a project from the command palette).
// UX wave U11a M3 (fix wave 3, the stacked dialogs of e2e run 43359967651): an opener that has left the document (a
// menu's item, gone with its menu) hands the keyboard to the topmost dialog still open under the closing one, as a sheet
// over the Plugins dialog does; Radix pauses that dialog's focus scope under the sheet and does not take the keyboard back
// itself. With no dialog under it, the keyboard stays where it was, as before.
import { useRef, useState } from 'react';

/**
 * The topmost dialog still open other than the one closing: the last in the document, as layers portal in opening order.
 * Radix's open layers only (`data-state="open"`, focusable content), not the hover and comment cards that also say
 * `role="dialog"`.
 */
function dialogUnder(closing: EventTarget | null): HTMLElement | null {
  const open = [...document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')].filter((dialog) => !(closing instanceof Node && (dialog === closing || dialog.contains(closing) || closing.contains(dialog))));
  return open.at(-1) ?? null;
}

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
        else dialogUnder(content)?.focus({ preventScroll: true });
      }
    },
  };
}
