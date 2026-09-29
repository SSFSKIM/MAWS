// The small confirmation sheet Claude Desktop and Codex use for rename, fork, archive and delete (D-20): a Radix
// Dialog, tokens only, keyboard-operable. The body is a form: Enter submits the default action, which a destructive
// sheet keeps disabled until its acknowledgement is checked, so Enter alone never destroys anything; Escape and Cancel
// close it.
import { Dialog } from 'radix-ui';
import type { FormEvent, ReactNode } from 'react';
import { closeDialog } from './dialogs';
import { SECONDARY } from './ui';

export function Sheet({ title, width = 'w-[min(440px,90vw)]', children }: { title: string; width?: string; children: ReactNode }) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && closeDialog()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className={`fixed top-[18%] left-1/2 z-50 ${width} -translate-x-1/2 rounded-lg border border-border-strong bg-bg-overlay p-4 text-ui text-fg`}
        >
          <Dialog.Title className="m-0 mb-3 text-ui font-medium text-fg">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// The sheet's form: `onSubmit` runs only while `canSubmit`; the footer holds Cancel and the default button.
export function SheetForm({
  canSubmit,
  onSubmit,
  submitLabel,
  submitClass,
  children,
  extra,
  focusSubmit = false,
}: {
  focusSubmit?: boolean; // a sheet with no field: the default button takes focus, so Enter confirms it
  canSubmit: boolean;
  onSubmit(): void;
  submitLabel: string;
  submitClass: string;
  children: ReactNode;
  extra?: ReactNode; // buttons before Cancel
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSubmit) onSubmit();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {children}
      <div className="flex items-center justify-end gap-2">
        {extra}
        <button type="button" onClick={closeDialog} className={SECONDARY}>
          Cancel
        </button>
        <button type="submit" autoFocus={focusSubmit} disabled={!canSubmit} className={submitClass}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
