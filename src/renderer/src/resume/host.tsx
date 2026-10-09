// The resume chooser opened from the sidebar (the P2 spec, child P2-D, G1): a project row's search icon and its context
// menu's Resume… open the same chooser `/resume` opens, scoped to that project, in X19's library box over the dimmed
// window. `/resume` opens it through the widget dialog (registered `library`, widgets/index.ts), which returns the
// keyboard to the session's composer; here a dismissal returns it to the control that opened it (an opened session's
// tab keeps it). Esc in a search field that holds text clears it first, as the widget dialog does for a
// `data-escape-clears` field, and an Esc that ends an IME composition is the IME's.
import { Dialog } from 'radix-ui';
import { useMemo, useRef } from 'react';
import { create } from 'zustand';
import type { ProjectId } from '@shared/graph/ids';
import { WIDGET_DIALOG_BOX } from '../composer/WidgetDialog';
import { RESUME_COPY } from './copy';
import { ResumeChooser } from './ResumeChooser';

export const useResumeChooser = create<{ open: { projectId: ProjectId; nonce: number; opener: HTMLElement | null } | null }>()(() => ({ open: null }));
let nonce = 0;
// `opener`: the control the keyboard returns to when the chooser is dismissed (null: focus stays where it lands).
export const openResumeChooser = (projectId: ProjectId, opener: HTMLElement | null = null): void =>
  useResumeChooser.setState({ open: { projectId, nonce: ++nonce, opener } });
const closeResumeChooser = () => useResumeChooser.setState({ open: null });

const clearsFirst = (target: EventTarget | null): boolean => target instanceof HTMLInputElement && target.matches('[data-escape-clears]') && target.value !== '';

// The opener, else (one hidden since, as a row's hover action is) its nearest focusable ancestor.
function returnFocus(opener: HTMLElement): void {
  opener.focus();
  if (document.activeElement !== opener) opener.parentElement?.closest<HTMLElement>('[tabindex]')?.focus();
}

export function ResumeChooserHost() {
  const open = useResumeChooser((s) => s.open);
  const context = useMemo(() => (open === null ? null : { projectId: open.projectId, exclude: null }), [open]);
  const opened = useRef(false); // the close opened a session
  if (open === null || context === null) return null;
  const close = (reason?: 'opened') => {
    opened.current = reason === 'opened';
    closeResumeChooser();
  };
  return (
    <Dialog.Root open onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg opacity-60" />
        <Dialog.Content
          aria-describedby={undefined}
          data-resume-chooser-host
          data-widget-size="library"
          onEscapeKeyDown={(event) => {
            if (event.isComposing || clearsFirst(event.target)) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault(); // not Radix's return (what held focus as it opened, else the body)
            if (!opened.current && open.opener?.isConnected) returnFocus(open.opener);
          }}
          className={`fixed top-1/2 left-1/2 z-50 flex ${WIDGET_DIALOG_BOX.library} -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border-strong bg-bg-overlay p-3 text-ui text-fg shadow-composer outline-none`}
        >
          <Dialog.Title className="sr-only">{RESUME_COPY.title}</Dialog.Title>
          <ResumeChooser key={open.nonce} context={context} close={close} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
