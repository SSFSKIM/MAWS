// The small confirmation sheet Claude Desktop and Codex use for rename, fork, archive and delete (D-20): a Radix
// Dialog, tokens only, keyboard-operable. The body is a form: Enter submits the default action, which a destructive
// sheet keeps disabled until its acknowledgement is checked, so Enter alone never destroys anything; Escape, the
// overlay and Cancel close it. A sheet closes through C10's dialog store (`closeDialog`) unless its opener passes
// `onClose`: a sheet whose answer is owed to a caller (C11's route switch, `pickDirectModel`) hears its dismissal there.
import { useDialogFocus } from '../app/dialog-focus';
import { Dialog } from 'radix-ui';
import { createContext, useContext, type FormEvent, type ReactNode } from 'react';
import { closeDialog } from './dialogs';
import { SECONDARY } from './ui';

// What the sheet's Cancel calls: the sheet's own close.
const SheetClose = createContext<() => void>(closeDialog);

export function Sheet({
  title,
  width = 'w-[min(440px,90vw)]',
  onClose = closeDialog,
  children,
  ...data
}: { title: string; width?: string; onClose?: () => void; children: ReactNode } & Record<`data-${string}`, string>) {
  const focus = useDialogFocus();
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/60" />
        <Dialog.Content
          {...focus}
          {...data}
          aria-describedby={undefined}
          className={`fixed top-[18%] left-1/2 z-50 ${width} -translate-x-1/2 rounded-lg border border-border-strong bg-bg-overlay p-4 text-ui text-fg`}
        >
          <Dialog.Title className="m-0 mb-3 text-ui font-medium text-fg">{title}</Dialog.Title>
          <SheetClose.Provider value={onClose}>{children}</SheetClose.Provider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// The sheet's form: `onSubmit` runs only while `canSubmit`; the footer holds Cancel (the sheet's close) and the default
// button.
export function SheetForm({
  canSubmit,
  onSubmit,
  submitLabel,
  submitClass,
  cancelLabel = 'Cancel',
  children,
  extra,
  focusSubmit = false,
}: {
  focusSubmit?: boolean; // a sheet with no field: the default button takes focus, so Enter confirms it
  canSubmit: boolean;
  onSubmit(): void;
  submitLabel: string;
  submitClass: string;
  cancelLabel?: string;
  children: ReactNode;
  extra?: ReactNode; // buttons before Cancel
}) {
  const close = useContext(SheetClose);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSubmit) onSubmit();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {children}
      <div className="flex items-center justify-end gap-2">
        {extra}
        <button type="button" onClick={() => close()} className={SECONDARY}>
          {cancelLabel}
        </button>
        <button type="submit" autoFocus={focusSubmit} disabled={!canSubmit} className={submitClass}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
