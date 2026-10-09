// The slash widgets' one place (W3, C6; charter §5.4 as amended 2026-10-01): a registered widget opens as a floating
// dialog centred over the window, as Claude Desktop opens /mcp, /plugins and /sandbox, never inside the composer's box
// and never in the right panel. One host at the app level shows the widget last opened (a second open replaces it);
// Esc or the widget's own close puts it away and hands the keyboard back to that session's composer. The widget
// contract is unchanged: `{ appSessionId, args, close() }`. The model selector's names open in the model chip instead
// (`placement: 'modelChip'`, C4).
import { Dialog } from 'radix-ui';
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import { useComposerStore } from '../stores/composer';
import { slashWidget, useRegisteredWidgets } from './mentions/widgets';

interface OpenWidget {
  appSessionId: AppSessionId;
  name: string;
  args: string;
  nonce: number;
}

export const useWidgetDialog = create<{ open: OpenWidget | null }>()(() => ({ open: null }));

let nonce = 0;
export function openWidgetDialog(appSessionId: AppSessionId, name: string, args: string): void {
  nonce += 1;
  useWidgetDialog.setState({ open: { appSessionId, name, args, nonce } });
}

export function closeWidgetDialog(): void {
  if (useWidgetDialog.getState().open !== null) useWidgetDialog.setState({ open: null });
}

// P2-B start (2026-10-09): X19 (the P2-B execution document §5.2): the content box by the widget's size, one table so
// P2-D's chooser host can reuse the library's. The library's height is fixed, not a maximum, so switching tabs, filtering
// to nothing or drilling into a detail never resizes the dialog under the pointer (Claude Desktop's library shell caps
// it at 50rem, readable/app-2.16120.0/web/app/v1/shared-25-C_M72Q4j.js:1455-1505).
export type WidgetSize = 'utility' | 'library';
export const WIDGET_DIALOG_BOX: Record<WidgetSize, string> = {
  utility: 'max-h-[85vh] w-[min(560px,calc(100vw-48px))]',
  library: 'h-[min(85vh,800px)] w-[min(960px,calc(100vw-48px))]',
};
// Radix's layer dismisses on Escape from a document-level capture listener before any React handler runs
// (@radix-ui/react-dismissable-layer 1.1.19, dist/index.mjs:91-105): in a search field that holds text (marked
// `data-escape-clears`), the dialog stays and the field, which sees the same event next, clears itself.
const clearsFirst = (target: EventTarget | null): boolean => target instanceof HTMLInputElement && target.matches('[data-escape-clears]') && target.value !== '';
// P2-B end

export function WidgetDialogHost() {
  useRegisteredWidgets(); // a widget registered after the open shows once it lands
  const open = useWidgetDialog((s) => s.open);
  const widget = open ? slashWidget(open.name) : null;
  if (!open || !widget) return null;
  const Widget = widget.component;
  return (
    <Dialog.Root open onOpenChange={(next) => !next && closeWidgetDialog()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg opacity-60" />
        <Dialog.Content
          aria-describedby={undefined}
          data-widget-dialog={open.name}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            useComposerStore.getState().focusTargets.get(open.appSessionId)?.focusEditor();
          }}
          // P2-B start (2026-10-09)
          onEscapeKeyDown={(event) => {
            if (clearsFirst(event.target)) event.preventDefault();
          }}
          data-widget-size={widget.size ?? 'utility'}
          className={`fixed top-1/2 left-1/2 z-50 flex ${WIDGET_DIALOG_BOX[widget.size ?? 'utility']} -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border-strong bg-bg-overlay p-3 text-ui text-fg shadow-composer outline-none`}
          // P2-B end
        >
          <Dialog.Title className="sr-only">{widget.title}</Dialog.Title>
          <Widget key={open.nonce} appSessionId={open.appSessionId} args={open.args} close={closeWidgetDialog} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
