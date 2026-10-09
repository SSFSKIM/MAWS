// The resume chooser opened from the sidebar (the P2 spec, child P2-D, G1): a project row's search icon and its context
// menu's Resume… open the same chooser `/resume` opens, scoped to that project, in X19's library box over the dimmed
// window. `/resume` opens it through the widget dialog (registered `library`, widgets/index.ts), which returns the
// keyboard to the session's composer; here Radix returns it to the control that opened it. Esc in a search field that
// holds text clears it first, as the widget dialog does for a `data-escape-clears` field.
import { Dialog } from 'radix-ui';
import { useMemo } from 'react';
import { create } from 'zustand';
import type { ProjectId } from '@shared/graph/ids';
import { WIDGET_DIALOG_BOX } from '../composer/WidgetDialog';
import { RESUME_COPY } from './copy';
import { ResumeChooser } from './ResumeChooser';

export const useResumeChooser = create<{ open: { projectId: ProjectId; nonce: number } | null }>()(() => ({ open: null }));
let nonce = 0;
export const openResumeChooser = (projectId: ProjectId): void => useResumeChooser.setState({ open: { projectId, nonce: ++nonce } });
const closeResumeChooser = () => useResumeChooser.setState({ open: null });

const clearsFirst = (target: EventTarget | null): boolean => target instanceof HTMLInputElement && target.matches('[data-escape-clears]') && target.value !== '';

export function ResumeChooserHost() {
  const open = useResumeChooser((s) => s.open);
  const context = useMemo(() => (open === null ? null : { projectId: open.projectId, exclude: null }), [open]);
  if (open === null || context === null) return null;
  return (
    <Dialog.Root open onOpenChange={(next) => !next && closeResumeChooser()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg opacity-60" />
        <Dialog.Content
          aria-describedby={undefined}
          data-resume-chooser-host
          data-widget-size="library"
          onEscapeKeyDown={(event) => {
            if (clearsFirst(event.target)) event.preventDefault();
          }}
          className={`fixed top-1/2 left-1/2 z-50 flex ${WIDGET_DIALOG_BOX.library} -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border-strong bg-bg-overlay p-3 text-ui text-fg shadow-composer outline-none`}
        >
          <Dialog.Title className="sr-only">{RESUME_COPY.title}</Dialog.Title>
          <ResumeChooser key={open.nonce} context={context} close={closeResumeChooser} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
