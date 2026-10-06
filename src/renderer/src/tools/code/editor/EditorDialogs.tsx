// The editor's sheets (E5 execution document, Interfaces *Dialogs*): the close sheet a dirty file tab's close guard
// asks with (Save, Don't save, Cancel). Its own store rather than C10's `confirm()`, which answers yes or no; a save
// prompt needs three answers. Rendered through C10's `Sheet` and `SheetForm`, mounted once from App.tsx, so a guard for a
// tab that is not shown still has a surface. One sheet at a time: opening another answers the one shown `cancel`.
import { create } from 'zustand';
import { Sheet, SheetForm } from '../../../sessions/Sheet';
import { PRIMARY, SECONDARY } from '../../../sessions/ui';
import { EDITOR_COPY } from '../copy';

export type CloseChoice = 'save' | 'discard' | 'cancel';

export type EditorDialog = { kind: 'close'; tabId: string; name: string; answer(choice: CloseChoice): void };

export const useEditorDialog = create<{ open: EditorDialog | null }>()(() => ({ open: null }));

// Asks whether to save a dirty tab before it closes; answered once, by the sheet or by a sheet that replaces it.
export function askClose(tabId: string, name: string): Promise<CloseChoice> {
  return new Promise((resolve) => {
    let settled = false;
    const answer = (choice: CloseChoice) => {
      if (settled) return;
      settled = true;
      if (useEditorDialog.getState().open?.answer === answer) useEditorDialog.setState({ open: null });
      resolve(choice);
    };
    const previous = useEditorDialog.getState().open;
    useEditorDialog.setState({ open: { kind: 'close', tabId, name, answer } });
    previous?.answer('cancel');
  });
}

export function EditorDialogs() {
  const open = useEditorDialog((s) => s.open);
  if (open === null) return null;
  return (
    <Sheet title={EDITOR_COPY.closeTitle(open.name)} onClose={() => open.answer('cancel')} data-editor-close={open.tabId}>
      <SheetForm
        focusSubmit
        canSubmit
        onSubmit={() => open.answer('save')}
        submitLabel={EDITOR_COPY.save}
        submitClass={PRIMARY}
        extra={
          <button type="button" className={SECONDARY} onClick={() => open.answer('discard')}>
            {EDITOR_COPY.dontSave}
          </button>
        }
      >
        <p className="m-0 text-fg-muted">{EDITOR_COPY.closeBody}</p>
      </SheetForm>
    </Sheet>
  );
}
