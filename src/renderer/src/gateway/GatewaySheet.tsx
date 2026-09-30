// The small confirmation sheets whose answer is owed to a caller (the route switch's machine, `pickDirectModel`'s
// promise, the Settings tab's confirms): C10's `Sheet` and `SheetForm` (D-20) with that caller's close callback, so
// Escape, the overlay and Cancel all reach `onClose`. It opens with
// focus on its first control, which is Cancel when the sheet holds no list: the sheets hold no text field, so Enter
// never confirms on its own, and stopping a session's process takes a deliberate press of the confirm button.
import type { ReactNode } from 'react';
import { Sheet, SheetForm } from '../sessions/Sheet';
import { PRIMARY } from '../sessions/ui';

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
  return (
    <Sheet title={title} onClose={onClose} {...data}>
      <SheetForm canSubmit={canSubmit} onSubmit={onSubmit} submitLabel={submitLabel} submitClass={PRIMARY} cancelLabel={cancelLabel}>
        {children}
      </SheetForm>
    </Sheet>
  );
}
