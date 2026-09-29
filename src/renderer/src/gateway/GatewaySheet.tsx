// The gateway's small confirmation sheets (the route switch's confirm and `pickDirectModel`'s choice) in C10's sheet
// geometry and buttons (D-20: dialogs follow Claude Desktop's small confirmation sheets as C10 uses them): a Radix
// Dialog whose body is a form, so Enter runs the default action while it can, and Escape, the overlay and Cancel close
// it through `onClose`. C10's own `Sheet`/`SheetForm` close through C10's dialog store (`closeDialog`) and take no close
// callback, so a sheet whose answer is owed to a caller (the switch's machine, `pickDirectModel`'s promise) cannot be
// told it was dismissed there; this is the same sheet with that callback.
import { Dialog } from 'radix-ui';
import type { FormEvent, ReactNode } from 'react';
import { PRIMARY, SECONDARY } from '../sessions/ui';

export function GatewaySheet({
  title,
  onClose,
  canSubmit,
  onSubmit,
  submitLabel,
  cancelLabel,
  children,
  ...data
}: {
  title: string;
  onClose(): void;
  canSubmit: boolean;
  onSubmit(): void;
  submitLabel: string;
  cancelLabel: string;
  children: ReactNode;
} & Record<`data-${string}`, string>) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSubmit) onSubmit();
  };
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/60" />
        <Dialog.Content
          {...data}
          aria-describedby={undefined}
          className="fixed top-[18%] left-1/2 z-50 w-[min(440px,90vw)] -translate-x-1/2 rounded-lg border border-border-strong bg-bg-overlay p-4 text-ui text-fg"
        >
          <Dialog.Title className="m-0 mb-3 text-ui font-medium text-fg">{title}</Dialog.Title>
          <form onSubmit={submit} className="flex flex-col gap-3">
            {children}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className={SECONDARY}>
                {cancelLabel}
              </button>
              <button type="submit" disabled={!canSubmit} className={PRIMARY}>
                {submitLabel}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
