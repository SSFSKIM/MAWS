// The Settings dialog (UX wave U7b, O-40; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md,
// M5 decision 9 and Interfaces §H): a modal dialog over the window, mounted once at the shell, drawing the `settingsTab`
// slot's view at the layout store's section. Its box is the library dialogs' (`WIDGET_DIALOG_BOX.library`), with no
// padding of its own, since U11's view measures its one-line notes against the body's 760 px. Close sits outside the
// scrolling body, and the dialog gives that body (`[data-settings-body]`, U11's mark) a right inset of 30 px from here, so
// a right-aligned control never passes under Close: 6 px in from the edge and 22 px wide, Close ends 28 px in. The 30 px
// hold the body's own scroll bar: a classic bar (a Mac with a mouse and no trackpad) takes its 15 px out of the inset
// rather than out of the 760 px (`watchBodyBar`); an overlay bar takes none. Behind it everything stays drawn and on
// screen, dimmed by the one scrim (`Backdrop`). The keyboard returns where it was (`useDialogFocus`). Esc: Radix
// dismisses from a capture listener before anything inside speaks, so what takes the key first is decided here
// (`escapeTaker`, §H rows 1 and 3 to 5); a layer over the dialog is Radix's own (row 2).
import { Dialog } from 'radix-ui';
import { useCallback, useRef } from 'react';
import { useDialogFocus } from '../app/dialog-focus';
import { Icon } from '../app/IconButton';
import { useSlot } from '../app/slots';
import { WIDGET_DIALOG_BOX } from '../composer/WidgetDialog';
import { focusPaneElement } from '../main/pane-dom';
import { Backdrop } from '../sessions/scrim';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { DESTINATION } from './copy';
import { escapeTaker, leaveField } from './escape';

// An open dialog drawn after the Settings dialog and outside it: a layer opened over it, such as a sheet from one of its
// sections, portaled after it.
const layerOver = (content: HTMLElement | null): boolean =>
  content !== null &&
  [...document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')].some(
    (layer) => layer !== content && !content.contains(layer) && !layer.contains(content) && (content.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );

const INSET = 30; // px: the body's right inset, its scroll bar included

// The body's scroll bar is in its inset: its width (none for an overlay bar), read into `--settings-bar` on the dialog
// and again whenever the body's content box changes, which it does when the bar comes or goes or the mode changes
// while Settings is open. Clamped to the inset.
const watchBodyBar = (content: HTMLElement): (() => void) => {
  const body = content.querySelector<HTMLElement>('[data-settings-body]');
  if (body === null) return () => {};
  const measure = () => content.style.setProperty('--settings-bar', `${Math.min(INSET, Math.max(0, body.offsetWidth - body.clientWidth))}px`);
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(body);
  return () => observer.disconnect();
};

export function SettingsDialog() {
  const settings = useLayout((s) => s.settings);
  const focus = useDialogFocus();
  const content = useRef<HTMLDivElement>(null);
  // The content mounts when Settings opens and unmounts when it closes; the watch lives exactly as long.
  const contentRef = useCallback((element: HTMLDivElement | null) => {
    content.current = element;
    if (element === null) return;
    const stop = watchBodyBar(element);
    return () => {
      stop();
      content.current = null;
    };
  }, []);
  const View = useSlot('settingsTab');
  // The keyboard returns where it was; where that cannot take it (an opener folded away meanwhile, such as the gear of the
  // sidebar drawn over a narrow window, which goes when Settings opens), to the page, else to the focused pane.
  const onCloseAutoFocus = (event: Event) => {
    focus.onCloseAutoFocus(event);
    const now = document.activeElement;
    if (now !== null && now !== document.body && now.closest('[inert]') === null) return;
    const page = document.querySelector<HTMLElement>('[data-region="page"]');
    if (page !== null) page.focus({ preventScroll: true });
    else focusPaneElement(currentSet(useLayout.getState().main).focusedPane);
  };
  const onEscapeKeyDown = (event: KeyboardEvent) => {
    // §H row 2: a layer over the dialog takes Esc. Radix makes a sheet the top layer a few frames after it is drawn (its
    // layer registers in an effect), and until then this listener is still the top one: an Esc in those frames is not
    // the dialog's (the second Mac run, where it closed Settings with the sheet in it).
    if (layerOver(content.current)) return event.preventDefault();
    const taker = escapeTaker(event.target, event); // an input method's Esc ends its composition, nothing else
    if (taker === null) return;
    event.preventDefault();
    if (taker === 'field') leaveField(event.target, () => content.current);
  };
  return (
    <Dialog.Root open={settings !== null} onOpenChange={(open) => !open && useLayout.getState().closeSettings()}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <Backdrop className="fixed inset-0 z-40" />
        </Dialog.Overlay>
        <Dialog.Content
          ref={contentRef}
          aria-describedby={undefined}
          data-settings-dialog=""
          onOpenAutoFocus={focus.onOpenAutoFocus}
          onCloseAutoFocus={onCloseAutoFocus}
          onEscapeKeyDown={onEscapeKeyDown}
          className={`fixed top-1/2 left-1/2 z-50 flex ${WIDGET_DIALOG_BOX.library} -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border-strong bg-bg-overlay text-ui text-fg shadow-composer outline-none [&_[data-settings-body]]:pr-[calc(30px_-_var(--settings-bar,0px))]`}
        >
          <Dialog.Title className="sr-only">{DESTINATION.settings}</Dialog.Title>
          {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render */}
          {settings !== null && <View section={settings.section} request={settings} />}
          <Dialog.Close asChild>
            <button
              type="button"
              aria-label={DESTINATION.close}
              title={DESTINATION.close}
              data-settings-close=""
              className="absolute top-1.5 right-1.5 inline-flex size-5.5 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
            >
              <Icon className="size-3.5">
                <path d="M4 4l8 8M12 4l-8 8" />
              </Icon>
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
